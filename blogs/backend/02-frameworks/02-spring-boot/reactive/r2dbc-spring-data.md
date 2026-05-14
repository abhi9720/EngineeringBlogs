---
title: R2DBC with Spring Data Reactive
description: >-
  Master reactive database access with R2DBC and Spring Data:
  ReactiveCrudRepository, R2DBC configuration, queries, transactions, and
  performance optimization
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - r2dbc
  - reactive
  - spring-data
coverImage: /images/r2dbc-spring-data.png
draft: false
order: 10
---
## Overview

R2DBC (Reactive Relational Database Connectivity) enables fully reactive, non-blocking database access for relational databases. Combined with Spring Data R2DBC, it provides a repository abstraction similar to Spring Data JPA but with reactive types (Mono/Flux).

The key difference from JPA is that R2DBC does NOT manage a persistence context or provide lazy loading. Each query is an independent operation that returns its results reactively. This eliminates the N+1 problem and the LazyInitializationException, but it also means you must explicitly fetch all needed data in each query.

## Dependencies

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-r2dbc</artifactId>
</dependency>

<!-- Database drivers -->
<dependency>
    <groupId>io.r2dbc</groupId>
    <artifactId>r2dbc-postgresql</artifactId>
</dependency>

<!-- For testing -->
<dependency>
    <groupId>io.r2dbc</groupId>
    <artifactId>r2dbc-h2</artifactId>
    <scope>test</scope>
</dependency>
```

## Configuration

The configuration below sets up connection pooling for R2DBC. Unlike JDBC connection pools that block when all connections are busy, R2DBC pools return `Mono.error` with a connection acquisition timeout when the pool is exhausted. This keeps the event loop non-blocking.

The `validation-query` is used to verify connections before they are borrowed from the pool. Some databases require this to detect stale connections after network interruptions.

```yaml
spring:
  r2dbc:
    url: r2dbc:postgresql://localhost:5432/mydb
    username: app_user
    password: ${DB_PASSWORD}
    pool:
      initial-size: 10
      max-size: 30
      max-idle-time: 30m
      validation-query: SELECT 1
```

### Programmatic Configuration

For environments where YAML configuration isn't sufficient (e.g., SSL certificates, custom connection factory settings), define the `ConnectionFactory` programmatically. The `AbstractR2dbcConfiguration` provides a base for custom configuration.

```java
@Configuration
@EnableR2dbcRepositories
public class R2dbcConfig extends AbstractR2dbcConfiguration {

    @Override
    @Bean
    public ConnectionFactory connectionFactory() {
        PostgresqlConnectionConfiguration config = PostgresqlConnectionConfiguration.builder()
            .host("localhost")
            .port(5432)
            .database("mydb")
            .username("app_user")
            .password(System.getenv("DB_PASSWORD"))
            .schema("public")
            .build();
        return new PostgresqlConnectionFactory(config);
    }

    @Bean
    public ConnectionPool connectionPool(ConnectionFactory connectionFactory) {
        ConnectionPoolConfiguration config = ConnectionPoolConfiguration.builder(connectionFactory)
            .maxSize(30)
            .initialSize(10)
            .maxIdleTime(Duration.ofMinutes(30))
            .validationQuery("SELECT 1")
            .build();
        return new ConnectionPool(config);
    }
}
```

## Entity Mapping

R2DBC entities use property-based access and do not support lazy loading. The `@Id` annotation identifies the primary key. Constructor-based creation is recommended for immutability. Unlike JPA, R2DBC does not require a no-arg constructor if you use constructor-based mapping.

Enums are mapped by their string name by default. Custom type converters are needed for complex types or when the database uses numeric codes for enums.

```java
public class User {
    @Id
    private Long id;
    private String email;
    private String name;
    private UserRole role;
    private Boolean active;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public User() {}

    public User(String email, String name, UserRole role) {
        this.email = email;
        this.name = name;
        this.role = role;
        this.active = true;
        this.createdAt = LocalDateTime.now();
    }

    // Getters and setters
}

public enum UserRole {
    USER, ADMIN, MODERATOR
}
```

### Custom Type Converters

```java
@ReadingConverter
public class LocalDateTimeReadConverter implements Converter<LocalDateTime, LocalDateTime> {
    @Override
    public LocalDateTime convert(LocalDateTime source) {
        return source;
    }
}

@WritingConverter
public class LocalDateTimeWriteConverter implements Converter<LocalDateTime, LocalDateTime> {
    @Override
    public LocalDateTime convert(LocalDateTime source) {
        return source;
    }
}

@Configuration
public class R2dbcConverterConfig {
    @Bean
    public R2dbcCustomConversions r2dbcCustomConversions() {
        return new R2dbcCustomConversions(List.of(
            new LocalDateTimeReadConverter(),
            new LocalDateTimeWriteConverter()
        ));
    }
}
```

## Repository Patterns

### ReactiveCrudRepository

`ReactiveCrudRepository` provides standard CRUD operations with reactive return types. Derive queries from method names just like in Spring Data JPA. The `@Query` annotation allows custom SQL queries.

```java
public interface UserRepository extends ReactiveCrudRepository<User, Long> {
    Mono<User> findByEmail(String email);
    Flux<User> findByNameContaining(String name);
    Flux<User> findByRole(UserRole role);
    Mono<Boolean> existsByEmail(String email);
    Mono<Long> countByRole(UserRole role);

    @Query("SELECT * FROM users WHERE email LIKE '%' || :domain")
    Flux<User> findByEmailDomain(@Param("domain") String domain);

    @Query("SELECT u.*, o.id as order_id, o.total as order_total " +
           "FROM users u LEFT JOIN orders o ON u.id = o.user_id " +
           "WHERE u.id = :userId")
    Mono<UserWithOrders> findUserWithOrders(@Param("userId") Long userId);
}
```

### Custom Queries

For complex queries, use `DatabaseClient` directly. It provides a fluent API for building SQL statements, binding parameters, and mapping results to objects. `DatabaseClient` is fully reactive and integrates with connection pooling.

```java
@Repository
public class CustomUserRepository {
    private final DatabaseClient databaseClient;

    public CustomUserRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    public Flux<User> findActiveUsersWithPagination(int page, int size) {
        return databaseClient.sql("SELECT * FROM users WHERE active = true ORDER BY created_at DESC LIMIT :size OFFSET :offset")
            .bind("size", size)
            .bind("offset", (long) page * size)
            .map((row, metadata) -> mapUser(row))
            .all();
    }

    public Mono<Long> bulkUpdateRole(UserRole newRole, UserRole oldRole) {
        return databaseClient.sql("UPDATE users SET role = :newRole WHERE role = :oldRole")
            .bind("newRole", newRole.name())
            .bind("oldRole", oldRole.name())
            .fetch()
            .rowsUpdated();
    }

    public Flux<UserStats> getUserStatsByRole() {
        return databaseClient.sql("SELECT role, COUNT(*) as count, AVG(LENGTH(name)) as avg_name_length " +
                                 "FROM users GROUP BY role")
            .map((row, metadata) -> new UserStats(
                UserRole.valueOf(row.get("role", String.class)),
                row.get("count", Long.class),
                row.get("avg_name_length", Double.class)
            ))
            .all();
    }

    private User mapUser(Row row) {
        User user = new User();
        user.setId(row.get("id", Long.class));
        user.setEmail(row.get("email", String.class));
        user.setName(row.get("name", String.class));
        user.setRole(UserRole.valueOf(row.get("role", String.class)));
        user.setActive(row.get("active", Boolean.class));
        user.setCreatedAt(row.get("created_at", LocalDateTime.class));
        return user;
    }
}
```

## Transactions

### Transactional Operations

Reactive transactions use `@Transactional` just like imperative ones, but the underlying mechanism is different. The `R2dbcTransactionManager` binds the connection to the reactive subscriber context rather than to a thread. This means the connection is available throughout the reactive pipeline even though processing happens on different threads.

The `createOrder` method below demonstrates a multi-step transactional operation: validate the user exists, save the order, and deduct inventory. If any step fails, all previous database changes are rolled back.

```java
@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final InventoryRepository inventoryRepository;
    private final UserRepository userRepository;

    public OrderService(OrderRepository orderRepository,
                       InventoryRepository inventoryRepository,
                       UserRepository userRepository) {
        this.orderRepository = orderRepository;
        this.inventoryRepository = inventoryRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    public Mono<Order> createOrder(OrderRequest request) {
        return userRepository.findById(request.getUserId())
            .switchIfEmpty(Mono.error(new UserNotFoundException(request.getUserId())))
            .flatMap(user -> {
                Order order = new Order(user.getId(), request.getItems());
                return orderRepository.save(order)
                    .flatMap(savedOrder ->
                        Flux.fromIterable(request.getItems())
                            .flatMap(item -> inventoryRepository.deductStock(item.getProductId(), item.getQuantity()))
                            .then(Mono.just(savedOrder))
                    );
            });
    }

    @Transactional
    public Mono<Void> transferBalance(Long fromUserId, Long toUserId, BigDecimal amount) {
        return userRepository.findById(fromUserId)
            .zipWith(userRepository.findById(toUserId))
            .flatMap(tuple -> {
                User from = tuple.getT1();
                User to = tuple.getT2();

                from.setBalance(from.getBalance().subtract(amount));
                to.setBalance(to.getBalance().add(amount));

                return userRepository.save(from)
                    .then(userRepository.save(to))
                    .then();
            });
    }
}
```

### Transaction Configuration

```java
@Configuration
@EnableTransactionManagement
public class TransactionConfig {

    @Bean
    public ReactiveTransactionManager transactionManager(ConnectionFactory connectionFactory) {
        return new R2dbcTransactionManager(connectionFactory);
    }
}
```

## Relationships and Joins

R2DBC does not support automatic relationship mapping like JPA. Instead, you write explicit JOIN queries and map the flat result rows to nested objects. The `OrderWithItemsRepository` below demonstrates a one-to-many mapping using `LEFT JOIN` and `collectList()`.

The SQL query returns one row per order item. The Java code groups the items by order ID and constructs the nested `OrderWithItems` structure. This pattern is explicit, efficient, and avoids the N+1 problem.

```java
public class OrderWithItems {
    private Long orderId;
    private Long userId;
    private BigDecimal total;
    private String status;
    private List<OrderItem> items;

    public OrderWithItems(Long orderId, Long userId, BigDecimal total,
                          String status, List<OrderItem> items) {
        this.orderId = orderId;
        this.userId = userId;
        this.total = total;
        this.status = status;
        this.items = items;
    }
}

@Repository
public class OrderWithItemsRepository {
    private final DatabaseClient databaseClient;

    public OrderWithItemsRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    public Mono<OrderWithItems> findById(Long orderId) {
        return databaseClient.sql(
                "SELECT o.id as order_id, o.user_id, o.total, o.status, " +
                "i.id as item_id, i.product_id, i.quantity, i.price " +
                "FROM orders o LEFT JOIN order_items i ON o.id = i.order_id " +
                "WHERE o.id = :orderId ORDER BY i.id"
            )
            .bind("orderId", orderId)
            .map((row, metadata) -> new Tuple2<>(
                new OrderSummary(
                    row.get("order_id", Long.class),
                    row.get("user_id", Long.class),
                    row.get("total", BigDecimal.class),
                    row.get("status", String.class)
                ),
                new OrderItem(
                    row.get("item_id", Long.class),
                    row.get("product_id", Long.class),
                    row.get("quantity", Integer.class),
                    row.get("price", BigDecimal.class)
                )
            ))
            .all()
            .collectList()
            .map(tuples -> {
                if (tuples.isEmpty()) return null;
                OrderSummary summary = tuples.get(0).getT1();
                List<OrderItem> items = tuples.stream()
                    .map(Tuple2::getT2)
                    .filter(item -> item.getId() != null)
                    .toList();
                return new OrderWithItems(summary.getOrderId(), summary.getUserId(),
                    summary.getTotal(), summary.getStatus(), items);
            });
    }
}
```

## Testing

```java
@DataR2dbcTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.ANY)
class UserRepositoryTest {
    @Autowired
    private UserRepository userRepository;

    @BeforeEach
    void setUp() {
        userRepository.deleteAll().block();
    }

    @Test
    void shouldSaveAndFindUser() {
        User user = new User("test@example.com", "Test User", UserRole.USER);

        userRepository.save(user)
            .as(StepVerifier::create)
            .assertNext(saved -> {
                assertThat(saved.getId()).isNotNull();
                assertThat(saved.getEmail()).isEqualTo("test@example.com");
            })
            .verifyComplete();
    }

    @Test
    void shouldFindByEmail() {
        userRepository.save(new User("find@example.com", "Find Me", UserRole.USER)).block();

        userRepository.findByEmail("find@example.com")
            .as(StepVerifier::create)
            .assertNext(user -> assertThat(user.getName()).isEqualTo("Find Me"))
            .verifyComplete();
    }

    @Test
    void shouldReturnEmptyForNonExistentEmail() {
        userRepository.findByEmail("nonexistent@example.com")
            .as(StepVerifier::create)
            .verifyComplete();
    }
}
```

## Best Practices

1. **Use R2DBC for truly reactive applications** - avoid mixing with blocking JDBC
2. **Prefer DatabaseClient** for complex queries beyond repository methods
3. **Use connection pooling** to avoid per-request connection overhead
4. **Keep transactions short** - reactive transactions hold database connections
5. **Use @Transactional only when needed** - each transaction acquires a connection
6. **Handle schema migration** with Flyway or Liquibase (use r2dbc dialect)
7. **Monitor connection pool** metrics for tuning

## Common Mistakes

### Mistake 1: Blocking in Reactive Database Access

```java
// Wrong: Blocking to get results
@Service
public class UserService {
    public User getUser(Long id) {
        return userRepository.findById(id).block(); // BLOCKS the event loop
    }
}

// Correct: Keep the chain reactive
@Service
public class UserService {
    public Mono<User> getUser(Long id) {
        return userRepository.findById(id);
    }
}
```

### Mistake 2: Ignoring Connection Pool Limits

```java
// Wrong: Multiple parallel requests exhausting pool
@Transactional
public Mono<Void> processBatch(List<Long> ids) {
    return Flux.fromIterable(ids)
        .flatMap(this::processOne) // All parallel - can exhaust pool
        .then();
}

// Correct: Control concurrency
@Transactional
public Mono<Void> processBatch(List<Long> ids) {
    return Flux.fromIterable(ids)
        .flatMap(this::processOne, 10) // Max 10 concurrent connections
        .then();
}
```

## Summary

R2DBC with Spring Data Reactive provides non-blocking database access for relational databases. Use ReactiveCrudRepository for standard CRUD, DatabaseClient for custom queries, and @Transactional for atomicity. Keep the pipeline reactive, use connection pooling, and control concurrency with flatMap limits.

## References

- [Spring Data R2DBC](https://docs.spring.io/spring-data/r2dbc/docs/current/reference/html/)
- [R2DBC Specification](https://r2dbc.io/)
- [R2DBC PostgreSQL Driver](https://github.com/pgjdbc/r2dbc-postgresql)
- [R2DBC Transactions](https://docs.spring.io/spring-data/r2dbc/docs/current/reference/html/#r2dbc.transactions)

Happy Coding
