---
title: "Integration Testing with Spring Cloud"
description: "Integration testing strategies for Spring Cloud microservices: Testcontainers for databases, Embedded Kafka, Spring Cloud Contract, @SpringBootTest slicing, and CI pipeline testing"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - integration-testing
  - spring-cloud
  - testcontainers
  - spring-boot
coverImage: "/images/integration-testing-spring-cloud.png"
draft: false
---

## Overview

Integration testing validates that microservice components work together correctly. Spring Cloud provides testing utilities for databases, messaging, service discovery, and configuration. This article covers Testcontainers, Embedded Kafka, Spring Cloud Contract, and testing sliced contexts.

## Testcontainers for Databases

```java
@SpringBootTest
@Testcontainers
class OrderRepositoryIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15")
        .withDatabaseName("testdb")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    void shouldSaveAndRetrieveOrder() {
        Order order = new Order("customer-1", BigDecimal.valueOf(150));
        order = entityManager.persistAndFlush(order);

        Optional<Order> found = orderRepository.findById(order.getId());

        assertThat(found).isPresent();
        assertThat(found.get().getCustomerId()).isEqualTo("customer-1");
        assertThat(found.get().getTotalAmount())
            .isEqualByComparingTo(BigDecimal.valueOf(150));
    }

    @Test
    void shouldFindOrdersByCustomerId() {
        entityManager.persist(new Order("customer-1", BigDecimal.valueOf(100)));
        entityManager.persist(new Order("customer-1", BigDecimal.valueOf(200)));
        entityManager.persist(new Order("customer-2", BigDecimal.valueOf(300)));
        entityManager.flush();

        List<Order> orders = orderRepository.findByCustomerId("customer-1");

        assertThat(orders).hasSize(2);
    }

    @Test
    void shouldHandleConcurrentWrites() {
        ExecutorService executor = Executors.newFixedThreadPool(5);
        List<Future<Order>> futures = new ArrayList<>();

        for (int i = 0; i < 5; i++) {
            int finalI = i;
            futures.add(executor.submit(() ->
                orderRepository.save(
                    new Order("customer-concurrent",
                        BigDecimal.valueOf(finalI * 100))
                )
            ));
        }

        List<Order> savedOrders = futures.stream()
            .map(f -> {
                try { return f.get(); }
                catch (Exception e) { throw new RuntimeException(e); }
            })
            .collect(Collectors.toList());

        assertThat(savedOrders).hasSize(5);
        assertThat(savedOrders)
            .extracting(Order::getCustomerId)
            .allMatch(id -> id.equals("customer-concurrent"));
    }

    @AfterAll
    static void shutdown() {
        postgres.stop();
    }
}
```

## Embedded Kafka Testing

```java
@SpringBootTest
@EmbeddedKafka(
    partitions = 3,
    topics = {"orders", "payments", "inventory"},
    controlledShutdown = true,
    bootstrapServersProperty = "spring.kafka.bootstrap-servers"
)
class KafkaIntegrationTest {

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @Autowired
    private EmbeddedKafkaBroker embeddedKafka;

    @ClassRule
    public static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.5.0")
    );

    @Test
    void shouldSendAndReceiveMessage() throws Exception {
        String orderId = "order-123";
        OrderCreatedEvent event = new OrderCreatedEvent(orderId, "customer-1");

        kafkaTemplate.send("orders", orderId, event).get(5, TimeUnit.SECONDS);

        // Use test consumer to verify
        Map<String, Object> consumerProps = KafkaTestUtils
            .consumerProps("test-group", "true", embeddedKafka);

        DefaultKafkaConsumerFactory<String, String> consumerFactory =
            new DefaultKafkaConsumerFactory<>(consumerProps,
                new StringDeserializer(),
                new JsonDeserializer<>(OrderCreatedEvent.class)
            );

        Consumer<String, OrderCreatedEvent> consumer =
            consumerFactory.createConsumer();

        embeddedKafka.consumeFromEmbeddedTopics(consumer, "orders");

        ConsumerRecord<String, OrderCreatedEvent> record =
            KafkaTestUtils.getSingleRecord(consumer, "orders");

        assertThat(record).isNotNull();
        assertThat(record.key()).isEqualTo(orderId);
        assertThat(record.value().getCustomerId()).isEqualTo("customer-1");
    }

    @Test
    void shouldHandleMultiplePartitions() {
        List<CompletableFuture<Void>> futures = new ArrayList<>();

        for (int i = 0; i < 100; i++) {
            String key = "order-" + i;
            futures.add(CompletableFuture.runAsync(() -> {
                kafkaTemplate.send("orders", key,
                    new OrderCreatedEvent(key, "customer-" + i));
            }));
        }

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .join();
    }

    @Test
    void shouldRetryOnFailure() {
        // Inject a failure and verify retry behavior
        kafkaTemplate.send("orders", "fail-order",
            new OrderCreatedEvent("fail-order", "customer-fail"));

        // Verify retry count
        verify(retryListener, timeout(5000).atLeast(1))
            .onRetry(any(), anyInt());
    }
}
```

## @SpringBootTest Slicing

### DataJpaTest

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@AutoConfigureEmbeddedDatabase
class OrderRepositorySliceTest {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    void shouldFindOrdersByStatus() {
        entityManager.persist(new Order("c1", BigDecimal.TEN, OrderStatus.PENDING));
        entityManager.persist(new Order("c2", BigDecimal.ONE, OrderStatus.CONFIRMED));

        List<Order> pending = orderRepository.findByStatus(OrderStatus.PENDING);

        assertThat(pending).hasSize(1);
    }
}
```

### WebMvcTest

```java
@WebMvcTest(OrderController.class)
class OrderControllerSliceTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private OrderService orderService;

    @Test
    void shouldReturnOrder() throws Exception {
        OrderResponse response = new OrderResponse("order-1", "customer-1",
            BigDecimal.valueOf(100), "PENDING");

        when(orderService.getOrder("order-1")).thenReturn(response);

        mockMvc.perform(get("/api/orders/order-1")
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.orderId").value("order-1"))
            .andExpect(jsonPath("$.customerId").value("customer-1"))
            .andExpect(jsonPath("$.status").value("PENDING"));
    }

    @Test
    void shouldReturn404WhenOrderNotFound() throws Exception {
        when(orderService.getOrder("nonexistent"))
            .thenThrow(new OrderNotFoundException("nonexistent"));

        mockMvc.perform(get("/api/orders/nonexistent")
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());
    }

    @Test
    void shouldValidateRequest() throws Exception {
        mockMvc.perform(post("/api/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest());
    }
}
```

### Kafka Test Slices

```java
@SpringBootTest(classes = KafkaTestConfiguration.class)
@EmbeddedKafka
class KafkaListenerSliceTest {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Autowired
    private OrderEventListener orderEventListener;

    @Test
    void shouldProcessIncomingOrderEvent() throws Exception {
        OrderCreatedEvent event = new OrderCreatedEvent("order-1", "customer-1");

        kafkaTemplate.send("orders", "order-1", toJson(event));

        Thread.sleep(2000);

        verify(orderEventListener, timeout(5000))
            .handleOrderCreated(any(OrderCreatedEvent.class));
    }
}
```

## Test Configuration Management

```java
@TestConfiguration
public class TestConfig {

    @Bean
    @Primary
    @Profile("test")
    public RestTemplate testRestTemplate() {
        return new RestTemplate();
    }

    @Bean
    @Primary
    public ObjectMapper objectMapper() {
        return JsonMapper.builder()
            .findAndAddModules()
            .build();
    }

    @Bean
    @Primary
    public Clock clock() {
        return Clock.fixed(
            Instant.parse("2026-01-01T00:00:00Z"),
            ZoneOffset.UTC
        );
    }
}

@SpringBootTest
@ActiveProfiles("test")
@Import(TestConfig.class)
class OrderServiceWithTestConfigTest {

    @Autowired
    private Clock clock;

    @Test
    void shouldUseFixedClock() {
        assertThat(Instant.now(clock))
            .isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));
    }
}
```

## Best Practices

- Use Testcontainers for realistic database and message broker testing.
- Use @EmbeddedKafka for Kafka integration tests without external dependencies.
- Use @WebMvcTest for controller layer testing with mocked services.
- Use @DataJpaTest for repository layer testing with embedded databases.
- Create test configuration classes for common test dependencies.
- Run integration tests in CI but separate from unit tests.

## Common Mistakes

### Mistake: Using H2 in-memory database for testing

```java
// Wrong - H2 behaves differently from PostgreSQL
@SpringBootTest
@AutoConfigureTestDatabase
class OrderRepositoryTest {
    // H2 may not support all PostgreSQL features
}
```

```java
// Correct - Testcontainers for production-like testing
@SpringBootTest
@Testcontainers
class OrderRepositoryTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15");
}
```

### Mistake: Mixing integration and unit tests

```java
// Wrong - slow integration tests run on every build
@SpringBootTest
class OrderServiceTest {
    // Heavy test, should be unit test
}
```

```java
// Correct - sliced test for focused testing
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    // Lightweight, fast test
}
```

## Summary

Integration testing with Spring Cloud requires realistic dependencies. Use Testcontainers for databases, Embedded Kafka for messaging, and Spring Boot test slicing for focused component tests. Separate integration tests from unit tests in CI pipelines for efficient feedback loops.

## References

- [Spring Boot Testing Documentation](https://docs.spring.io/spring-boot/reference/testing/index.html)
- [Testcontainers Documentation](https://testcontainers.com/guides/)
- [Spring Cloud Contract](https://spring.io/projects/spring-cloud-contract)

Happy Coding