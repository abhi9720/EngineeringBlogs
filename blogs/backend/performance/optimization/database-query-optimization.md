---
title: "Database Query Optimization"
description: "Optimize database queries: indexing strategies, query plans, N+1 detection, and SQL performance tuning"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - optimization
  - database
  - query
  - indexing
coverImage: "/images/database-query-optimization.png"
draft: false
---

# Database Query Optimization

## Overview

Database query optimization is the most impactful performance improvement for most applications. A poorly written query can be 100-1000x slower than an optimized one. This guide covers indexing strategies, query analysis, and optimization techniques.

### The Cost of Bad Queries

| Query Type | Without Index | With Index | Improvement |
|-----------|--------------|------------|-------------|
| Single row lookup | 5s (full scan) | 2ms (index) | 2500x |
| Range query | 10s (full scan) | 5ms (index) | 2000x |
| JOIN | 30s (nested loop) | 10ms (index join) | 3000x |

---

## Indexing Strategies

### Choosing the Right Index

```sql
-- B-tree index: Default, good for equality and range queries
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- Composite index: Multiple columns, order matters!
CREATE INDEX idx_orders_customer_status ON orders(customer_id, status);
-- Good for: WHERE customer_id = ? AND status = ?
-- Bad for: WHERE status = ? (customer_id not used)

-- Covering index: Includes all needed columns
CREATE INDEX idx_orders_covering ON orders(customer_id, status, total)
    INCLUDE (created_at, updated_at);
-- Query can be served entirely from index (no table access)

-- Partial index: Only index relevant rows
CREATE INDEX idx_orders_active ON orders(created_at)
    WHERE status = 'PENDING';
-- Smaller index, faster maintenance

-- Unique index: Enforce uniqueness
CREATE UNIQUE INDEX idx_users_email ON users(email);
```

### JPA Index Configuration

```java
@Entity
@Table(name = "orders", indexes = {
    @Index(name = "idx_orders_customer", columnList = "customer_id"),
    @Index(name = "idx_orders_status_created", columnList = "status, created_at"),
    @Index(name = "idx_orders_customer_status", columnList = "customer_id, status")
})
public class Order {
    @Id
    private Long id;

    @Column(name = "customer_id")
    private Long customerId;

    @Enumerated(EnumType.STRING)
    private OrderStatus status;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
```

### Indexing for Queries

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    // Uses: idx_orders_customer
    List<Order> findByCustomerId(Long customerId);

    // Uses: idx_orders_status_created
    List<Order> findByStatusAndCreatedAtAfter(
        OrderStatus status, LocalDateTime after);

    // Uses: idx_orders_customer_status
    Optional<Order> findByCustomerIdAndStatus(
        Long customerId, OrderStatus status);

    // No index: full table scan!
    List<Order> findByTotalGreaterThan(BigDecimal amount);
    // Add: @Index(name = "idx_orders_total", columnList = "total")
}
```

---

## Query Plan Analysis

### Using EXPLAIN

```sql
-- Analyze query execution plan
EXPLAIN ANALYZE
SELECT o.*, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'PENDING'
  AND o.created_at > '2026-01-01'
ORDER BY o.created_at DESC
LIMIT 100;

-- Output:
-- ┌────────────────────────────────────────────────────────┐
-- │ Limit (cost=10.5..15.2 rows=100)                       │
-- │   -> Sort (cost=15.2..17.8 rows=1000)                  │
-- │        Sort Key: o.created_at DESC                     │
-- │       -> Nested Loop (cost=5.5..12.0 rows=1000)        │
-- │            -> Index Scan on orders_status_created       │
-- │                 Index Cond: (status = 'PENDING')       │
-- │                 Filter: (created_at > '2026-01-01')    │
-- │            -> Index Scan on customers_pkey             │
-- │                 Index Cond: (id = o.customer_id)       │
-- └────────────────────────────────────────────────────────┘
```

### Detect Full Table Scans

```java
@Component
public class QueryAnalyzer {

    @PersistenceContext
    private EntityManager entityManager;

    public void analyzeQuery(String query) {
        Query q = entityManager.createNativeQuery(
            "EXPLAIN ANALYZE " + query);

        @SuppressWarnings("unchecked")
        List<Object[]> results = q.getResultList();

        boolean hasSeqScan = false;
        for (Object[] row : results) {
            String planLine = (String) row[0];
            log.info("Plan: {}", planLine);

            if (planLine.contains("Seq Scan")) {
                hasSeqScan = true;
                log.warn("FULL TABLE SCAN DETECTED!");
            }
        }

        if (hasSeqScan) {
            suggestIndex(query);
        }
    }

    private void suggestIndex(String query) {
        // Parse WHERE clause and suggest index
        // In practice, use PostgreSQL's index suggestion extension
    }
}
```

---

## N+1 Query Prevention

### Detecting N+1

```java
@Entity
public class Order {
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    private List<OrderItem> items;
}

// BAD: N+1 queries
@Service
public class NPlusOneService {

    public void processOrders() {
        List<Order> orders = orderRepository.findAll();
        // 1 query

        for (Order order : orders) {
            List<OrderItem> items = order.getItems();
            // N queries (one per order)!
            processItems(items);
        }
        // Total: 1 + N queries
    }
}
```

### Fix N+1 with JOIN FETCH

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    // Fix 1: JOIN FETCH
    @Query("SELECT DISTINCT o FROM Order o JOIN FETCH o.items")
    List<Order> findAllWithItems();

    // Fix 2: Entity Graph
    @EntityGraph(attributePaths = {"items"})
    List<Order> findAll();

    // Fix 3: Batch fetching (application.yml)
    // spring.jpa.properties.hibernate.default_batch_fetch_size: 100
}

// Fix 2: Named Entity Graph
@Entity
@NamedEntityGraph(name = "Order.withItems",
    attributeNodes = @NamedAttributeNode("items"))
public class Order {
    // ...
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {
    @EntityGraph("Order.withItems")
    List<Order> findAll();
}
```

### Batch Fetching Configuration

```yaml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
        batch_fetch_style: padded
```

---

## Common SQL Optimizations

### Pagination

```sql
-- BAD: OFFSET pagination (slower as offset increases)
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000;
-- Scans 100,020 rows

-- GOOD: Keyset pagination (consistent performance)
SELECT * FROM orders
WHERE id > 100000
ORDER BY id
LIMIT 20;
-- Scans 20 rows
```

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    // Keyset pagination
    Page<Order> findByIdGreaterThan(Long lastId, Pageable pageable);

    // Cursor-based pagination
    Slice<Order> findByCreatedAtBefore(LocalDateTime cursor, Pageable pageable);
}
```

### Count Optimization

```java
// BAD: COUNT on large tables with WHERE clause
// SELECT COUNT(*) FROM orders WHERE status = 'PENDING';

// GOOD: Use approximate counts for dashboards
// Use materialized views or cached counts

@Service
public class CountOptimizationService {

    private final RedisTemplate<String, Long> redisTemplate;

    public long getOrderCount(OrderStatus status) {
        String key = "count:orders:" + status;
        Long cached = redisTemplate.opsForValue().get(key);

        if (cached != null) {
            return cached;
        }

        // Refresh in background
        CompletableFuture.supplyAsync(() -> {
            long count = orderRepository.countByStatus(status);
            redisTemplate.opsForValue().set(key, count, Duration.ofMinutes(5));
            return count;
        });

        return orderRepository.countByStatus(status);
    }
}
```

---

## Query Optimization Patterns

### Read-Modify-Write

```java
// BAD: Read then write (race condition)
@Service
public class BadInventoryService {

    @Transactional
    public void decrementStock(Long productId, int quantity) {
        Product product = productRepository.findById(productId).orElseThrow();
        if (product.getStock() >= quantity) {
            product.setStock(product.getStock() - quantity);
            productRepository.save(product);
        } else {
            throw new InsufficientStockException();
        }
    }
}

// GOOD: Single atomic UPDATE
@Service
public class GoodInventoryService {

    @Modifying
    @Query("UPDATE Product p SET p.stock = p.stock - :quantity " +
           "WHERE p.id = :productId AND p.stock >= :quantity")
    int decrementStock(@Param("productId") Long productId,
                       @Param("quantity") int quantity);

    @Transactional
    public void decrementStockSafe(Long productId, int quantity) {
        int updated = decrementStock(productId, quantity);
        if (updated == 0) {
            throw new InsufficientStockException();
        }
    }
}
```

### Batch Operations

```java
// BAD: Individual inserts (N queries)
@Service
public class BadBatchService {

    public void createOrders(List<OrderRequest> requests) {
        for (OrderRequest request : requests) {
            orderRepository.save(new Order(request));
        }
    }
}

// GOOD: Batch insert
@Service
public class GoodBatchService {

    @Transactional
    public void createOrders(List<OrderRequest> requests) {
        List<Order> orders = requests.stream()
            .map(Order::new)
            .toList();
        orderRepository.saveAll(orders);
    }
}
```

---

## Connection Management

### Pool Monitoring

```java
@Component
public class ConnectionPoolMonitor {

    private final DataSource dataSource;

    @Scheduled(fixedRate = 10_000)
    public void monitorPool() {
        if (dataSource instanceof HikariDataSource hikari) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();

            log.info("Connection pool: active={}, idle={}, pending={}, total={}",
                pool.getActiveConnections(),
                pool.getIdleConnections(),
                pool.getPendingThreads(),
                pool.getTotalConnections());

            if (pool.getPendingThreads() > 10) {
                log.warn("Connection pool contention: {} threads waiting for connection",
                    pool.getPendingThreads());
            }
        }
    }
}
```

---

## Best Practices

### 1. Index All JOIN and WHERE Columns

```sql
-- ALWAYS index: JOIN columns, WHERE columns, ORDER BY columns
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

### 2. Use EXPLAIN ANALYZE Before Optimization

```sql
EXPLAIN ANALYZE SELECT ...;
-- Shows actual execution time, not estimated
-- Identify Seq Scans, high-cost nodes
```

### 3. Monitor Slow Queries

```yaml
# application.yml
spring:
  jpa:
    properties:
      hibernate:
        generate_statistics: true
        session:
          events:
            log:
              LOG_QUERIES_SLOWER_THAN_MS: 100
```

---

## Common Mistakes

### Mistake 1: No Index on Foreign Keys

```sql
-- WRONG: No index on customer_id
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    customer_id BIGINT REFERENCES customers(id)
);

-- CORRECT: Index foreign keys
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
```

### Mistake 2: SELECT * in Production

```sql
-- WRONG: Retrieves all columns
SELECT * FROM orders WHERE customer_id = 1;

-- CORRECT: Select only needed columns
SELECT id, status, total FROM orders WHERE customer_id = 1;
```

### Mistake 3: Not Using Connection Pool

```java
// WRONG: Creating new connection per query
Connection conn = DriverManager.getConnection(url);

// CORRECT: Use connection pool (HikariCP)
@Bean
public DataSource dataSource() {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(url);
    config.setMaximumPoolSize(20);
    config.setMinimumIdle(5);
    config.setConnectionTimeout(5000);
    return new HikariDataSource(config);
}
```

---

## Summary

1. Index all WHERE, JOIN, and ORDER BY columns
2. Use composite indexes for multi-column queries
3. Analyze query plans with EXPLAIN ANALYZE
4. Fix N+1 with JOIN FETCH or Entity Graphs
5. Use keyset pagination for large datasets
6. Batch operations to reduce round trips
7. Monitor slow queries and connection pools

---

## References

- [PostgreSQL Indexing Guide](https://www.postgresql.org/docs/current/indexes.html)
- [MySQL Query Optimization](https://dev.mysql.com/doc/refman/8.0/en/query-optimization.html)
- [Hibernate Performance Tuning](https://docs.jboss.org/hibernate/orm/5.6/userguide/html_single/Hibernate_User_Guide.html#performance)

Happy Coding