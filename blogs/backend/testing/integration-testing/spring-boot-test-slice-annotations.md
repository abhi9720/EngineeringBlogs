---
title: "Spring Boot Test Slice Annotations"
description: "Comprehensive guide to Spring Boot test slice annotations: @WebMvcTest, @DataJpaTest, @JsonTest, @RestClientTest, and custom slices"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - testing
  - slice-tests
  - integration-testing
coverImage: "/images/spring-boot-test-slice-annotations.png"
draft: false
---

# Spring Boot Test Slice Annotations

## Overview

Spring Boot provides focused test slice annotations that create a minimal application context for testing specific layers. Instead of loading the entire application, each slice loads only the beans relevant to that layer, making tests faster and more focused.

---

## The Problem: Full Context Startup

```java
@SpringBootTest  // Loads ALL beans
class FullContextTest {

    // Starts entire application context
    // Takes 30-60 seconds
    // Tests are slow and fragile
    @Autowired
    private UserController userController;

    @Test
    void testEndpoint() {
        // ...
    }
}
```

Spring Boot slices solve this by loading only the minimal context needed.

---

## @WebMvcTest (Controller Layer)

Tests web controllers with the full Spring MVC infrastructure but without loading services, repositories, or other layers:

```java
@WebMvcTest(UserController.class)  // Only loads UserController and MVC infrastructure
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    void shouldReturnUser() throws Exception {
        User user = new User("alice", "alice@example.com");
        when(userService.findByUsername("alice")).thenReturn(user);

        mockMvc.perform(get("/api/users/alice")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("alice"))
            .andExpect(jsonPath("$.email").value("alice@example.com"));
    }

    @Test
    void shouldReturn404WhenUserNotFound() throws Exception {
        when(userService.findByUsername("unknown"))
            .thenThrow(new UserNotFoundException("unknown"));

        mockMvc.perform(get("/api/users/unknown")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());
    }

    @Test
    void shouldValidateRequestBody() throws Exception {
        String invalidUser = """
            {"username": "", "email": "invalid"}
            """;

        mockMvc.perform(post("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalidUser))
            .andExpect(status().isBadRequest());
    }

    @Test
    void shouldTestControllerAdvice() throws Exception {
        when(userService.findAll()).thenThrow(new DatabaseException("Connection failed"));

        mockMvc.perform(get("/api/users"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.error").value("Internal server error"));
    }
}
```

### What @WebMvcTest Loads

- MockMvc
- All @Controller, @ControllerAdvice, @JsonComponent beans
- Spring Security (if on classpath)
- Does NOT load @Service, @Repository, @Component beans
- Does NOT load full auto-configuration

---

## @DataJpaTest (Repository Layer)

Tests JPA repositories with an embedded database, loading only JPA infrastructure:

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
// ^ Use with Testcontainers instead of H2
class UserRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private UserRepository userRepository;

    @Test
    void shouldSaveAndFindUser() {
        User user = new User("alice", "alice@example.com");
        entityManager.persist(user);
        entityManager.flush();

        Optional<User> found = userRepository.findByUsername("alice");

        assertTrue(found.isPresent());
    }

    @Test
    void shouldFindUsersByEmailDomain() {
        entityManager.persist(new User("alice", "alice@example.com"));
        entityManager.persist(new User("bob", "bob@example.com"));
        entityManager.persist(new User("charlie", "charlie@other.com"));
        entityManager.flush();

        List<User> exampleUsers = userRepository.findByEmailEndingWith("@example.com");

        assertEquals(2, exampleUsers.size());
    }

    @Test
    void shouldReturnEmptyWhenUserNotFound() {
        Optional<User> found = userRepository.findByUsername("nonexistent");

        assertTrue(found.isEmpty());
    }

    @Test
    void shouldTestCustomQuery() {
        entityManager.persist(new User("alice", "alice@example.com", true));
        entityManager.persist(new User("bob", "bob@example.com", false));
        entityManager.flush();

        List<User> activeUsers = userRepository.findByActiveTrue();

        assertEquals(1, activeUsers.size());
    }
}
```

### What @DataJpaTest Loads

- In-memory database (H2 by default)
- All @Entity beans
- All JPA repositories
- EntityManager, TestEntityManager
- Does NOT load controllers, services, security

### Using with Testcontainers

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class RealDatabaseRepositoryTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private UserRepository userRepository;

    @Test
    void testNativeQuery() {
        // Native queries work because we're using real PostgreSQL
    }
}
```

---

## @JsonTest (Serialization Layer)

Tests JSON serialization and deserialization:

```java
@JsonTest
class OrderJsonTest {

    @Autowired
    private JacksonTester<Order> json;

    @Test
    void shouldSerializeOrder() throws Exception {
        Order order = new Order("customer-1");
        order.addItem(new OrderItem("ITEM-001", "Widget", 2, 25.00));

        String result = json.write(order).getJson();

        // Verify structure
        assertThat(result).contains("\"customerId\":\"customer-1\"");
        assertThat(result).contains("\"total\":50.0");

        // Verify exact JSON with JSONassert
        JSONAssert.assertEquals("""
            {
                "customerId": "customer-1",
                "items": [
                    {
                        "sku": "ITEM-001",
                        "name": "Widget",
                        "quantity": 2,
                        "price": 25.0
                    }
                ],
                "total": 50.0,
                "status": "NEW"
            }
            """, result, JSONCompareMode.STRICT);
    }

    @Test
    void shouldDeserializeOrder() throws Exception {
        String jsonContent = """
            {
                "customerId": "customer-1",
                "items": [
                    {"sku": "ITEM-001", "quantity": 2, "price": 25.0}
                ]
            }
            """;

        Order order = json.parseObject(jsonContent);

        assertEquals("customer-1", order.getCustomerId());
        assertEquals(1, order.getItems().size());
    }

    @Test
    void shouldHandleNullFields() throws Exception {
        Order emptyOrder = new Order(null);

        String result = json.write(emptyOrder).getJson();

        assertThat(result).doesNotContain("\"total\"");
        // Depending on @JsonInclude settings
    }
}

// Test specific custom serializer
@JsonTest
class CustomSerializerTest {

    @Autowired
    private JacksonTester<Money> json;

    @Test
    void shouldSerializeMoney() throws Exception {
        Money amount = new Money(new BigDecimal("100.50"), Currency.getInstance("USD"));

        String result = json.write(amount).getJson();

        JSONAssert.assertEquals("""
            {"amount": 100.50, "currency": "USD", "formatted": "$100.50"}
            """, result, JSONCompareMode.STRICT);
    }
}
```

---

## @RestClientTest (REST Client Layer)

Tests REST clients with mock HTTP responses:

```java
@RestClientTest(PaymentClient.class)
class PaymentClientTest {

    @Autowired
    private MockRestServiceServer server;

    @Autowired
    private PaymentClient paymentClient;

    @Test
    void shouldProcessPayment() {
        server.expect(requestTo("https://payment.example.com/charge"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(jsonPath("$.amount").value(100.00))
            .andRespond(withSuccess("""
                {"transactionId": "txn-123", "status": "COMPLETED"}
                """, MediaType.APPLICATION_JSON));

        PaymentResult result = paymentClient.charge("customer-1", 100.00);

        assertEquals("txn-123", result.transactionId());
        assertEquals("COMPLETED", result.status());
    }

    @Test
    void shouldHandlePaymentFailure() {
        server.expect(requestTo("https://payment.example.com/charge"))
            .andRespond(withServerError()
                .body("{\"error\": \"Insufficient funds\"}"));

        assertThrows(PaymentException.class,
            () -> paymentClient.charge("customer-1", 10000.00));
    }

    @Test
    void shouldHandleTimeout() {
        server.expect(requestTo("https://payment.example.com/charge"))
            .andRespond(withSuccess().withTimeout(5000));

        assertThrows(PaymentTimeoutException.class,
            () -> paymentClient.charge("customer-1", 50.00));
    }

    @AfterEach
    void tearDown() {
        server.verify();  // Verify all expectations were met
    }
}
```

---

## @DataRedisTest and @DataMongoTest

### Redis

```java
@DataRedisTest
@Testcontainers
class RedisRepositoryTest {

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
        .withExposedPorts(6379);

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Test
    void shouldStoreAndRetrieveValue() {
        redisTemplate.opsForValue().set("test:key", "test-value");

        String value = redisTemplate.opsForValue().get("test:key");

        assertEquals("test-value", value);
    }
}
```

### MongoDB

```java
@DataMongoTest
@Testcontainers
class MongoRepositoryTest {

    @Container
    static MongoDBContainer mongo = new MongoDBContainer("mongo:6.0");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", mongo::getReplicaSetUrl);
    }

    @Autowired
    private MongoTemplate mongoTemplate;

    @Test
    void shouldSaveDocument() {
        Document doc = new Document("name", "test").append("value", 42);
        mongoTemplate.save(doc, "test_collection");

        Document found = mongoTemplate.findById(doc.get("_id"), Document.class, "test_collection");
        assertNotNull(found);
        assertEquals("test", found.getString("name"));
    }
}
```

---

## @WebFluxTest (Reactive Controllers)

```java
@WebFluxTest(ReactiveUserController.class)
class ReactiveUserControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private ReactiveUserService userService;

    @Test
    void shouldReturnUser() {
        when(userService.findByUsername("alice"))
            .thenReturn(Mono.just(new User("alice", "alice@example.com")));

        webTestClient.get().uri("/api/users/alice")
            .accept(MediaType.APPLICATION_JSON)
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.username").isEqualTo("alice")
            .jsonPath("$.email").isEqualTo("alice@example.com");
    }
}
```

---

## Custom Test Slice

Create custom slices for your application's architecture:

```java
// 1. Define the annotation
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@BootstrapWith(SpringBootTestContextBootstrapper.class)
@ExtendWith(SpringExtension.class)
@TypeExcludeFilters(CustomSliceTypeExcludeFilter.class)
@AutoConfigureCache
@AutoConfigureJson
@AutoConfigureMockMvc
@ImportAutoConfiguration
public @interface MyServiceTest {
}

// 2. Define the filter
public class CustomSliceTypeExcludeFilter extends TypeExcludeFilter {

    @Override
    public boolean match(MetadataReader metadataReader, 
                          MetadataReaderFactory metadataReaderFactory) {
        // Exclude everything except service beans
        return !metadataReader.getAnnotationMetadata()
            .hasAnnotation(Service.class.getName());
    }

    @Override
    public boolean match(Class<?> clazz) {
        return !clazz.isAnnotationPresent(Service.class);
    }
}

// Usage
@MyServiceTest
class CustomSliceTest {

    @Autowired
    private UserService userService;

    // Only Service beans are loaded
    // No controllers, no repositories
}
```

---

## Slice Comparison

| Annotation | Loads | Does NOT Load | Ideal For |
|-----------|-------|---------------|-----------|
| @WebMvcTest | Controllers, MVC infra, Security | Services, Repositories | Controller logic, validation, security |
| @DataJpaTest | Entities, Repositories, JPA infra | Controllers, Services | Query logic, entity mapping |
| @JsonTest | JSON mappers, custom serializers | Other beans | JSON serialization format |
| @RestClientTest | RestTemplate, HTTP infra | Other beans | REST client behavior |
| @DataRedisTest | Redis template, repositories | Other beans | Redis operations |
| @DataMongoTest | Mongo template, repositories | Other beans | MongoDB operations |

---

## Common Mistakes

### Mistake 1: Missing @MockBean for Dependencies

```java
// WRONG: @WebMvcTest doesn't load services
@WebMvcTest(UserController.class)
class UserControllerTest {

    @Autowired
    private UserController controller;
    // Missing @MockBean for UserService!
    // Will throw NoSuchBeanDefinitionException
}

// CORRECT: Mock all service dependencies
@WebMvcTest(UserController.class)
class UserControllerTest {

    @MockBean
    private UserService userService;

    @MockBean
    private AuditService auditService;
}
```

### Mistake 2: Using @SpringBootTest Instead of Slices

```java
// WRONG: Loading full context for a controller test
@SpringBootTest  // Takes 30+ seconds
class UserControllerTest { ... }

// CORRECT: Use slice
@WebMvcTest(UserController.class)  // Takes 5 seconds
class UserControllerTest { ... }
```

### Mistake 3: Not Testing Real Database with @DataJpaTest

```java
// WRONG: Testing with H2 when production uses PostgreSQL
@DataJpaTest  // Uses H2 by default
class UserRepositoryTest { ... }

// CORRECT: Use Testcontainers
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class UserRepositoryTest { ... }
```

---

## Summary

Spring Boot test slices provide focused, fast integration tests by loading only the necessary beans for each layer. Use @WebMvcTest for controllers, @DataJpaTest for repositories, @JsonTest for serialization, and @RestClientTest for HTTP clients. Always mock dependencies from other layers, and combine slices with Testcontainers for realistic database tests.

---

## References

- [Spring Boot Testing](https://docs.spring.io/spring-boot/reference/testing/index.html)
- [Spring Boot Test Auto-configuration](https://docs.spring.io/spring-boot/reference/testing/auto-configured-tests.html)
- [Baeldung - Spring Boot Slices](https://www.baeldung.com/spring-boot-testing)
- [Test Slices in Spring Boot](https://spring.io/guides/gs/testing-web/)

Happy Coding
