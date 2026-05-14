---
title: Database Testing Strategies
description: >-
  Database testing strategies with Testcontainers and H2: migration testing,
  fixture management, and transaction rollback patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - database-testing
  - testcontainers
  - h2
  - integration-testing
coverImage: /images/database-testing-strategies.png
draft: false
order: 10
---
# Database Testing Strategies

## Overview

Database testing verifies that your data access layer works correctly against a real database. The key challenges are test isolation (preventing tests from interfering with each other), fixture management (setting up and tearing down data), and choosing between embedded and real databases. This guide covers strategies for both approaches.

---

## Strategy 1: Testcontainers (Real Database)

### Setup

```java
@Testcontainers
@SpringBootTest
class DatabaseTestcontainersTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine")
        .withInitScript("db/migration/V1__init.sql");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        // Use validate to verify mappings against real schema
    }

    @Autowired
    private UserRepository userRepository;

    @Test
    void shouldExecuteNativeQueryCorrectly() {
        // Native queries work exactly as in production
        List<User> activeUsers = userRepository.findActiveUsersSince(
            LocalDate.now().minusDays(30));

        assertNotNull(activeUsers);
    }

    @Test
    void shouldFailConstraintViolation() {
        User user = new User();
        // Missing required fields
        assertThrows(DataIntegrityViolationException.class,
            () -> userRepository.save(user));
        // H2 might not catch this if constraints are different!
    }
}
```

The key trade-off here is speed vs. accuracy. Testcontainers provides exact PostgreSQL behavior (right down to PostgreSQL-specific constraint violations), but the container startup takes 5–10 seconds on first use. Setting `ddl-auto` to `validate` is a deliberate choice—it ensures your JPA entity mappings match the actual schema, catching misalignments early.

---

## Strategy 2: H2 (Embedded, Compatible Mode)

### Configuration for PostgreSQL Compatibility

```yaml
# application-test.yml
spring:
  datasource:
    url: jdbc:h2:mem:testdb;MODE=PostgreSQL;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
  jpa:
    database-platform: org.hibernate.dialect.H2Dialect
    hibernate:
      ddl-auto: create-drop
    properties:
      hibernate:
        dialect: org.hibernate.dialect.H2Dialect
```

### H2 Limitations

```java
class H2LimitationsTest {

    @Test
    void h2VsPostgresDifferences() {
        // PostgreSQL-specific functions don't work in H2:
        // 1. JSON operations
        // 2. Full-text search (tsvector/tsquery)
        // 3. PostgreSQL-specific indexing (GIN, GiST)
        // 4. ARRAY_AGG ordering guarantee
        // 5. DISTINCT ON
        // 6. RETURNING clause behavior
        // 7. Locking behavior differences
    }

    @Test
    void testNativeQuery() {
        // WARNING: Native PostgreSQL queries fail on H2
        // Use JPQL or HQL for portability, or test with Testcontainers
    }
}
```

H2's PostgreSQL compatibility mode is a pragmatic choice for fast CI feedback when your queries are all JPQL/HQL. The moment you introduce native queries or PostgreSQL-specific features, H2 will silently pass in tests but fail in production. Use H2 as a fast pre-filter and Testcontainers as the definitive validation.

---

## Strategy 3: Flyway/Flyway Migration Testing

### Verify Migrations Against Real Database

```java
@SpringBootTest
@Testcontainers
class FlywayMigrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.flyway.enabled", () -> true);
    }

    @Autowired
    private Flyway flyway;

    @Test
    void allMigrationsApplySuccessfully() {
        // Flyway automatically runs migrations on startup
        // This test verifies they all apply without errors
        MigrationInfoService info = flyway.info();
        assertThat(info.all().length).isPositive();
        assertThat(info.pending()).isEmpty();
    }

    @Test
    void migrationCanBeRolledBack() {
        // Test undo migration if using Flyway Pro
        flyway.migrate();
        flyway.undo();  // Enterprise only
        flyway.migrate();  // Re-apply
    }
}
```

### Test Specific Migration Version

```java
@SpringBootTest
@Testcontainers
class SpecificMigrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");

    @Test
    void testMigrationV2_AddEmailVerified() {
        // Get flyway instance configured for the test
        Flyway flyway = Flyway.configure()
            .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
            .locations("classpath:db/migration")
            .target(MigrationVersion.VERSION_2)  // Only run up to V2
            .load();

        flyway.migrate();

        // Verify V2 migration created the column
        JdbcTemplate jdbc = new JdbcTemplate(
            new SingleConnectionDataSource(postgres.getJdbcUrl(), 
                postgres.getUsername(), postgres.getPassword(), false)
        );

        List<String> columns = jdbc.queryForList(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'",
            String.class
        );

        assertTrue(columns.contains("email_verified"));
    }
}
```

---

## Fixture Management

### 1. SQL Fixtures

```java
@SpringBootTest
@Testcontainers
class SqlFixtureTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine");

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private OrderRepository orderRepository;

    @Test
    @Sql(statements = """
        INSERT INTO users (id, username, email) 
        VALUES ('550e8400-e29b-41d4-a716-446655440000', 'testuser', 'test@test.com');
        
        INSERT INTO orders (id, customer_id, total, status)
        VALUES ('660e8400-e29b-41d4-a716-446655440000', 
                '550e8400-e29b-41d4-a716-446655440000', 
                100.00, 'NEW');
    """)
    void testWithSqlFixture() {
        Order order = orderRepository.findById(
            UUID.fromString("660e8400-e29b-41d4-a716-446655440000")
        ).orElseThrow();

        assertEquals(100.00, order.getTotal());
    }

    @Test
    @Sql(scripts = "/fixtures/orders.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
    @Sql(scripts = "/fixtures/cleanup.sql", executionPhase = Sql.ExecutionPhase.AFTER_TEST_METHOD)
    void testWithFileFixture() {
        // Uses external SQL files for setup and teardown
    }
}
```

### 2. Programmatic Fixtures

```java
@SpringBootTest
@Testcontainers
class ProgrammaticFixtureTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private OrderRepository orderRepository;

    private User testUser;
    private Order testOrder;

    @BeforeEach
    void setUpFixtures() {
        testUser = userRepository.save(
            new User("fixture-user", "fixture@test.com")
        );

        testOrder = new Order(testUser.getId());
        testOrder.addItem(new OrderItem("ITEM-001", 2, 25.00));
        testOrder = orderRepository.save(testOrder);
    }

    @AfterEach
    void tearDownFixtures() {
        orderRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void testWithProgrammaticFixtures() {
        assertNotNull(testUser.getId());
        assertNotNull(testOrder.getId());
        assertTrue(orderRepository.findByCustomerId(testUser.getId()).isPresent());
    }
}
```

### 3. Test Data Builders

```java
// Test Data Builder Pattern
public class TestDataBuilder {

    public static UserBuilder aUser() {
        return new UserBuilder();
    }

    public static OrderBuilder anOrder() {
        return new OrderBuilder();
    }

    public static class UserBuilder {
        private String username = "default-user";
        private String email = "default@test.com";
        private Role role = Role.USER;

        public UserBuilder withUsername(String username) {
            this.username = username;
            return this;
        }

        public UserBuilder withEmail(String email) {
            this.email = email;
            return this;
        }

        public UserBuilder asAdmin() {
            this.role = Role.ADMIN;
            return this;
        }

        public User build() {
            return new User(username, email, role);
        }
    }

    public static class OrderBuilder {
        private UUID customerId;
        private List<OrderItem> items = new ArrayList<>();
        private OrderStatus status = OrderStatus.NEW;

        public OrderBuilder withCustomer(UUID customerId) {
            this.customerId = customerId;
            return this;
        }

        public OrderBuilder withItem(String sku, int qty, double price) {
            items.add(new OrderItem(sku, qty, price));
            return this;
        }

        public OrderBuilder withStatus(OrderStatus status) {
            this.status = status;
            return this;
        }

        public Order build() {
            Order order = new Order(customerId);
            items.forEach(order::addItem);
            order.setStatus(status);
            return order;
        }
    }
}

// Usage in tests
class TestDataBuilderUsageTest {

    @Autowired
    private OrderRepository orderRepository;

    @Test
    void testWithBuilder() {
        User admin = userRepository.save(
            TestDataBuilder.aUser()
                .withUsername("admin-user")
                .asAdmin()
                .build()
        );

        Order order = orderRepository.save(
            TestDataBuilder.anOrder()
                .withCustomer(admin.getId())
                .withItem("ITEM-1", 2, 10.00)
                .withItem("ITEM-2", 1, 50.00)
                .build()
        );

        assertEquals(70.00, order.getTotal(), 0.001);
    }
}
```

The Test Data Builder pattern is preferred over raw SQL fixtures because it is type-safe, refactorable, and composable. Each builder method returns `this` for fluent chaining, defaults ensure tests express only what matters (not every field), and `build()` constructs the final object with validated state.

---

## Transaction Rollback Strategy

### Automatic Rollback After Each Test

```java
@SpringBootTest
@Transactional  // Each test runs in a transaction that rolls back
class TransactionalTest {

    @Autowired
    private UserRepository userRepository;

    @Test
    void firstTest() {
        userRepository.save(new User("user1", "user1@test.com"));
        assertTrue(userRepository.findByUsername("user1").isPresent());
        // Transaction rolls back after test
    }

    @Test
    void secondTest() {
        // Database is clean - user1 is not present
        assertTrue(userRepository.findByUsername("user1").isEmpty());
    }
}
```

### Manual Transaction Management

```java
@SpringBootTest
class ManualTransactionTest {

    @Autowired
    private TestTransactionManager transactionManager;

    @Autowired
    private UserRepository userRepository;

    @Test
    void testWithManualTransaction() {
        // Start transaction
        transactionManager.begin();

        try {
            userRepository.save(new User("temp-user", "temp@test.com"));
            // Query within same transaction

            transactionManager.commit();
        } catch (Exception e) {
            transactionManager.rollback();
            throw e;
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Relying on H2 for PostgreSQL-Specific Features

```java
// WRONG: Testing with H2, query uses PostgreSQL feature
@Query(value = "SELECT * FROM search_vectors WHERE document @@ to_tsquery('english', :query)", 
       nativeQuery = true)
List<Document> searchByText(@Param("query") String query);
// Passes in PostgreSQL, fails in H2

// CORRECT: Use Testcontainers for native query tests
```

### Mistake 2: Not Cleaning Up Between Tests

```java
// WRONG: Tests leave data behind
@Test
void test1() {
    userRepository.save(new User("shared-user", "test@test.com"));
}

@Test
void test2() {
    // This test might see the user from test1 depending on execution order
    assertFalse(userRepository.findByUsername("shared-user").isEmpty()); // Flaky!
}

// CORRECT: Clean up
@AfterEach
void cleanup() {
    userRepository.deleteAll();
}
```

### Mistake 3: Shared Mutable Fixtures

```java
// WRONG: Static fixture modified by tests
static User sharedUser = new User("shared", "shared@test.com");

@Test
void testModifiesUser() {
    sharedUser.setEmail("newemail@test.com");  // Affects other tests!
}

// CORRECT: Fresh objects per test
@BeforeEach
void setup() {
    testUser = userRepository.save(new User("fresh", "fresh@test.com"));
}
```

---

## Summary

Use Testcontainers for tests that need production-accurate database behavior (native queries, PostgreSQL-specific features, migration testing). Use H2 compatible mode for fast-running tests that only use JPA/JPQL. Isolate tests with transaction rollback or explicit cleanup. Use test data builders to create readable, maintainable fixtures.

---

## References

- [Testcontainers Database Modules](https://java.testcontainers.org/modules/databases/)
- [Spring Testing with Databases](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management.html)
- [Flyway Testing](https://documentation.red-gate.com/flyway/)
- [H2 Database Compatibility](http://www.h2database.com/html/features.html#compatibility)

Happy Coding
