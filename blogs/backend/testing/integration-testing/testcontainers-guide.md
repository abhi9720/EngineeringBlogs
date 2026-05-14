---
title: "Testcontainers Guide"
description: "Comprehensive guide to Testcontainers for integration testing: database testing, service containers, and Spring Boot integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - testcontainers
  - integration-testing
  - docker
  - spring-boot
coverImage: "/images/testcontainers-guide.png"
draft: false
---

# Testcontainers for Integration Testing

## Overview

Testcontainers is a Java library that provides lightweight, disposable instances of databases, message brokers, and other services for integration testing. Unlike embedded databases (H2), Testcontainers runs the real service in a Docker container, ensuring your tests match production behavior exactly.

---

## Why Testcontainers Over Embedded Databases

| Aspect | H2 (Embedded) | Testcontainers (PostgreSQL) |
|--------|---------------|-----------------------------|
| SQL dialect | H2-specific | Real PostgreSQL |
| Data types | Limited compatibility | Exact PostgreSQL types |
| Indexes | Different behavior | Exact match |
| Functions | H2-specific | PostgreSQL native |
| Migration | May pass on H2, fail on PG | Same as production |
| Startup time | Instant | 5-10 seconds (first time) |

The first-time startup cost of Testcontainers is amortized when using static singleton containers—the Docker image is pulled once, and the container stays alive across all test classes in the suite. For CI pipelines, the image is typically cached on the runner.

---

## Setup

### Dependencies

```xml
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>testcontainers</artifactId>
    <version>1.19.3</version>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>postgresql</artifactId>
    <version>1.19.3</version>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>1.19.3</version>
    <scope>test</scope>
</dependency>

<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>rabbitmq</artifactId>
    <version>1.19.3</version>
    <scope>test</scope>
</dependency>
```

---

## Basic Usage

### Singleton Container Pattern

```java
@SpringBootTest
@Testcontainers
class UserRepositoryTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine")
        .withDatabaseName("testdb")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private UserRepository userRepository;

    @Test
    void shouldSaveAndFindUser() {
        User user = new User("alice", "alice@example.com");
        userRepository.save(user);

        Optional<User> found = userRepository.findByUsername("alice");

        assertTrue(found.isPresent());
        assertEquals("alice@example.com", found.get().getEmail());
    }
}
```

The singleton pattern (static `@Container` field) is the recommended approach. The container starts once before all tests in the class and stops after all tests complete. All test methods share the same database instance, but `@Transactional` rollback on each method keeps them isolated.

### With Sping Boot Testcontainers (1.2+)

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-testcontainers</artifactId>
    <scope>test</scope>
</dependency>
```

```java
@Testcontainers
@SpringBootTest
class OrderRepositoryTest {

    @Container
    static ServiceConnection postgres = new PostgreSQLContainer<>("postgres:15-alpine");
    // @ServiceConnection automatically configures datasource properties

    @Autowired
    private OrderRepository orderRepository;

    @Test
    void shouldPersistOrder() {
        Order order = new Order("customer-1");
        order.addItem(new OrderItem("item-1", 2, 10.00));

        Order saved = orderRepository.save(order);

        assertNotNull(saved.getId());
        Order loaded = orderRepository.findById(saved.getId()).orElseThrow();
        assertEquals(1, loaded.getItems().size());
    }
}
```

---

## Module-Specific Containers

### PostgreSQL

```java
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine")
    .withDatabaseName("integration_tests")
    .withUsername("tester")
    .withPassword("tester123")
    .withInitScript("db/init.sql");  // Optional initialization

// Custom configuration
postgres = new PostgreSQLContainer<>("postgres:15-alpine")
    .withEnv("POSTGRES_MAX_CONNECTIONS", "50")
    .withReuse(true);  // Container stays alive across test runs (faster)
```

### MySQL

```java
@Container
static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
    .withDatabaseName("test")
    .withUsername("test")
    .withPassword("test");
```

### MongoDB

```java
@Container
static MongoDBContainer mongo = new MongoDBContainer("mongo:6.0");

@DynamicPropertySource
static void mongoProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.data.mongodb.uri", mongo::getReplicaSetUrl);
}
```

### Redis

```java
@Container
static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
    .withExposedPorts(6379);

@DynamicPropertySource
static void redisProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.data.redis.host", redis::getHost);
    registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
}
```

### RabbitMQ

```java
@Container
static RabbitMQContainer rabbit = new RabbitMQContainer("rabbitmq:3.12-management");

@DynamicPropertySource
static void rabbitProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.rabbitmq.host", rabbit::getHost);
    registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
    registry.add("spring.rabbitmq.username", rabbit::getAdminUsername);
    registry.add("spring.rabbitmq.password", rabbit::getAdminPassword);
}
```

### Kafka

```java
@Container
static KafkaContainer kafka = new KafkaContainer(
    DockerImageName.parse("confluentinc/cp-kafka:7.4.0"));

@DynamicPropertySource
static void kafkaProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
}
```

---

## Custom Containers with Init Scripts

```java
public class CustomPostgresContainer extends PostgreSQLContainer<CustomPostgresContainer> {

    private static final String IMAGE_VERSION = "postgres:15-alpine";

    public CustomPostgresContainer() {
        super(IMAGE_VERSION);
    }

    @Override
    public void start() {
        withDatabaseName("integration")
            .withUsername("tester")
            .withPassword("tester123")
            .withInitScript("db/schema.sql");  // Load schema before tests
        super.start();
    }

    public static CustomPostgresContainer getInstance() {
        return new CustomPostgresContainer();
    }
}
```

### Init Script Example

```sql
-- db/schema.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES users(id),
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'NEW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (username, email) VALUES
    ('testuser', 'test@example.com'),
    ('admin', 'admin@example.com');
```

---

## Full Integration Test Example

```java
@SpringBootTest
@Testcontainers
class OrderServiceIntegrationTest {

    // Shared containers
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");

    @Container
    static RabbitMQContainer rabbit = new RabbitMQContainer("rabbitmq:3.12-management");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
    }

    @Autowired
    private OrderService orderService;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private UserRepository userRepository;

    private User testUser;

    @BeforeEach
    void setup() {
        testUser = userRepository.save(
            new User("testuser", "test@example.com")
        );
    }

    @AfterEach
    void cleanup() {
        orderRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void shouldPlaceOrderSuccessfully() {
        OrderRequest request = new OrderRequest(
            testUser.getId(),
            List.of(new OrderItem("ITEM-001", "Widget", 2, 25.00))
        );

        OrderConfirmation confirmation = orderService.placeOrder(request);

        assertNotNull(confirmation);
        assertNotNull(confirmation.getOrderId());

        // Verify persistence
        Order savedOrder = orderRepository.findById(confirmation.getOrderId())
            .orElseThrow();
        assertEquals(50.00, savedOrder.getTotal(), 0.001);
        assertEquals(OrderStatus.NEW, savedOrder.getStatus());

        // Verify event published to RabbitMQ (async)
        await().atMost(Duration.ofSeconds(5))
            .until(() -> checkMessageInQueue(confirmation.getOrderId()));
    }

    @Test
    void shouldRejectDuplicateOrder() {
        OrderRequest request = new OrderRequest(
            testUser.getId(),
            List.of(new OrderItem("ITEM-001", "Widget", 1, 25.00))
        );

        orderService.placeOrder(request);

        assertThrows(DuplicateOrderException.class,
            () -> orderService.placeOrder(request));
    }

    private boolean checkMessageInQueue(UUID orderId) {
        // Use RabbitMQ test utils to check the queue
        return true;  // Simplified for example
    }
}
```

---

## Testcontainers Lifecycle Management

```java
@SpringBootTest
@Testcontainers
class LifecycleManagementTest {

    // Singleton containers (start once, shared across tests)
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");

    // Per-test container (restarts for each test method)
    @Container
    private GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
        .withExposedPorts(6379);

    @Test
    void firstTest() {
        // postgres is already running (started once)
        // redis was just started for this test
    }

    @Test
    void secondTest() {
        // postgres still running
        // new redis container was started (old one stopped)
    }
}
```

---

## Common Mistakes

### Mistake 1: Using @Container on Non-Static Field

```java
// WRONG: Non-static field creates a new container for each test
// but @BeforeAll methods can't access instance fields
@Container
private PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(); // ERROR

// CORRECT: Static for singleton, instance for per-test
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>();
```

### Mistake 2: Not Setting Connection Timeout

```java
// WRONG: Default timeout may be too short for slow CI
PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");
postgres.start();  // Might timeout on first run (pulling image)

// CORRECT: Set appropriate timeout
postgres = new PostgreSQLContainer<>("postgres:15-alpine")
    .withStartupTimeout(Duration.ofMinutes(3));
```

### Mistake 3: Using @DynamicPropertySource Wrong

```java
// WRONG: Method must be static
@DynamicPropertySource
void configure(DynamicPropertyRegistry registry) { }  // Won't work

// CORRECT: Static method
@DynamicPropertySource
static void configure(DynamicPropertyRegistry registry) { }
```

---

## Summary

Testcontainers provides real service instances for integration testing, eliminating the gap between embedded databases and production. Use singleton containers for shared database instances, ServiceConnection for automatic Spring Boot configuration, and appropriate module-specific containers (PostgreSQL, MySQL, Mongo, Redis, Kafka, RabbitMQ) for each integration test.

---

## References

- [Testcontainers Documentation](https://testcontainers.com/guides/)
- [Testcontainers for Java](https://java.testcontainers.org/)
- [Spring Boot Testcontainers](https://docs.spring.io/spring-boot/reference/testing/testcontainers.html)
- [Testcontainers Best Practices](https://testcontainers.com/guides/testcontainers-for-integration-tests/)

Happy Coding
