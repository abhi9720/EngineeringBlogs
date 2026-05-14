---
title: "Database Read Replicas and Sharding"
description: "Scale databases with read replicas and sharding: replication lag, consistency models, and partitioning strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - scalability
  - database
  - replicas
  - sharding
coverImage: "/images/database-read-replicas-sharding.png"
draft: false
---

# Database Read Replicas and Sharding

## Overview

Read replicas and sharding are two primary strategies for scaling databases. Read replicas offload read traffic from the primary. Sharding distributes data across multiple databases for both read and write scaling.

### When to Use Each

| Strategy | Read Scaling | Write Scaling | Complexity |
|----------|-------------|---------------|------------|
| Read Replicas | Excellent | None (primary bottleneck) | Low |
| Sharding | Excellent | Excellent | High |
| Both | Excellent | Excellent | Very High |

---

## Read Replicas

### PostgreSQL Streaming Replication

```conf
# postgresql.conf (Primary)
wal_level = replica
max_wal_senders = 5
wal_keep_size = 1024  # MB
```

```conf
# postgresql.conf (Replica)
primary_conninfo = 'host=primary-host port=5432 user=replicator password=secret'
hot_standby = on
```

### Spring Boot Read/Write Routing

```yaml
spring:
  datasource:
    writer:
      jdbc-url: jdbc:postgresql://writer:5432/orders
      username: app_user
      password: secret
      hikari:
        maximum-pool-size: 10
    reader:
      jdbc-url: jdbc:postgresql://reader:5432/orders
      username: app_user
      password: secret
      hikari:
        maximum-pool-size: 30
```

```java
@Configuration
public class ReadWriteRoutingConfig {

    @Bean
    @ConfigurationProperties("spring.datasource.writer")
    public DataSource writerDataSource() {
        return DataSourceBuilder.create().type(HikariDataSource.class).build();
    }

    @Bean
    @ConfigurationProperties("spring.datasource.reader")
    public DataSource readerDataSource() {
        return DataSourceBuilder.create().type(HikariDataSource.class).build();
    }

    @Bean
    public DataSource routingDataSource(
            @Qualifier("writerDataSource") DataSource writer,
            @Qualifier("readerDataSource") DataSource reader) {

        ReadWriteRoutingDataSource routing = new ReadWriteRoutingDataSource();
        Map<Object, Object> targets = new HashMap<>();
        targets.put("WRITE", writer);
        targets.put("READ", reader);
        routing.setDefaultTargetDataSource(writer);
        routing.setTargetDataSources(targets);
        return routing;
    }
}
```

```java
@Component
public class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return ReadWriteContext.isReadOnly() ? "READ" : "WRITE";
    }
}

@Component
public class ReadWriteContext {

    private static final ThreadLocal<Boolean> readOnly = ThreadLocal.withInitial(() -> false);

    public static void setReadOnly(boolean isReadOnly) {
        readOnly.set(isReadOnly);
    }

    public static boolean isReadOnly() {
        return readOnly.get();
    }

    public static void clear() {
        readOnly.remove();
    }
}

@Aspect
@Component
public class ReadWriteAspect {

    @Around("@annotation(readOnly)") // Custom @ReadOnly annotation
    public Object routeReadOnly(ProceedingJoinPoint pjp) throws Throwable {
        try {
            ReadWriteContext.setReadOnly(true);
            return pjp.proceed();
        } finally {
            ReadWriteContext.clear();
        }
    }
}
```

### Handling Replication Lag

```java
@Service
public class ReplicationLagAwareService {

    @Autowired
    private EntityManager entityManager;

    // After a write, read from primary for a short time
    public Order getOrderAfterWrite(Long orderId) {
        // For 5 seconds after writing, route reads to primary
        if (wasRecentlyWritten(orderId)) {
            ReadWriteContext.setReadOnly(false);
        } else {
            ReadWriteContext.setReadOnly(true);
        }

        return orderRepository.findById(orderId).orElseThrow();
    }

    private boolean wasRecentlyWritten(Long entityId) {
        // Store write timestamps in Redis
        String key = "write:" + entityId;
        Long timestamp = redisTemplate.opsForValue().get(key);
        if (timestamp == null) return false;

        return (System.currentTimeMillis() - timestamp) < 5000; // 5 second window
    }

    public void recordWrite(Long entityId) {
        String key = "write:" + entityId;
        redisTemplate.opsForValue().set(key, System.currentTimeMillis(),
            Duration.ofSeconds(10));
    }
}
```

---

## Database Sharding

### Sharding Strategy

```java
public class ShardRouter {

    private final List<String> shards = List.of(
        "orders_shard_0", "orders_shard_1", "orders_shard_2", "orders_shard_3"
    );
    private static final int SHARD_COUNT = 4;

    /**
     * Shard key: customer_id
     * Algorithm: customer_id % SHARD_COUNT
     */
    public String getShardForCustomer(Long customerId) {
        int shardIndex = (int) (customerId % SHARD_COUNT);
        return shards.get(shardIndex);
    }

    /**
     * Range-based sharding:
     * Shard 0: customer IDs 1-1000000
     * Shard 1: customer IDs 1000001-2000000
     * etc.
     */
    public String getShardByRange(Long customerId) {
        if (customerId <= 1_000_000) return "orders_shard_0";
        if (customerId <= 2_000_000) return "orders_shard_1";
        if (customerId <= 3_000_000) return "orders_shard_2";
        return "orders_shard_3";
    }
}
```

### Spring Sharding with AbstractRoutingDataSource

```java
@Configuration
public class ShardingConfig {

    @Bean
    public DataSource shardingDataSource() {
        Map<Object, Object> shardDataSources = new HashMap<>();

        for (int i = 0; i < 4; i++) {
            HikariDataSource ds = new HikariDataSource();
            ds.setJdbcUrl("jdbc:postgresql://shard-" + i + ":5432/orders");
            ds.setUsername("app_user");
            ds.setPassword("secret");
            ds.setMaximumPoolSize(10);
            shardDataSources.put("shard_" + i, ds);
        }

        ShardRoutingDataSource routing = new ShardRoutingDataSource();
        routing.setTargetDataSources(shardDataSources);
        routing.setDefaultTargetDataSource(shardDataSources.get("shard_0"));
        return routing;
    }
}

@Component
public class ShardRoutingDataSource extends AbstractRoutingDataSource {

    private final ShardRouter shardRouter = new ShardRouter();

    @Override
    protected Object determineCurrentLookupKey() {
        Long customerId = ShardContext.getCustomerId();
        if (customerId == null) return "shard_0";
        return shardRouter.getShardForCustomer(customerId);
    }
}

@Component
public class ShardContext {

    private static final ThreadLocal<Long> customerId = new ThreadLocal<>();

    public static void setCustomerId(Long id) {
        customerId.set(id);
    }

    public static Long getCustomerId() {
        return customerId.get();
    }

    public static void clear() {
        customerId.remove();
    }
}
```

### Sharded Repository

```java
@Repository
public class ShardedOrderRepository {

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private ShardRouter shardRouter;

    public Order findByIdAndCustomer(Long orderId, Long customerId) {
        ShardContext.setCustomerId(customerId);
        try {
            return entityManager.find(Order.class, orderId);
        } finally {
            ShardContext.clear();
        }
    }

    public Order save(Order order) {
        ShardContext.setCustomerId(order.getCustomerId());
        try {
            entityManager.persist(order);
            return order;
        } finally {
            ShardContext.clear();
        }
    }

    // Cross-shard queries are complex
    public List<Order> findRecentOrdersByStatus(OrderStatus status) {
        // Must query ALL shards and combine results
        List<Order> allOrders = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            ShardContext.setCustomerId((long) i); // Dummy for routing
            try {
                String query = "SELECT o FROM Order o WHERE o.status = :status " +
                               "AND o.createdAt > :since ORDER BY o.createdAt DESC";
                TypedQuery<Order> q = entityManager.createQuery(query, Order.class);
                q.setParameter("status", status);
                q.setParameter("since", LocalDateTime.now().minusDays(7));
                allOrders.addAll(q.getResultList());
            } finally {
                ShardContext.clear();
            }
        }

        // Sort and limit after collecting from all shards
        allOrders.sort(Comparator.comparing(Order::getCreatedAt).reversed());
        return allOrders.stream().limit(100).toList();
    }
}
```

---

## Sharding Challenges

### Resharding

```java
@Service
public class ReshardingService {

    private static final int OLD_SHARD_COUNT = 4;
    private static final int NEW_SHARD_COUNT = 8;

    /**
     * Resharding strategy:
     * 1. Create new shards with new sharding function
     * 2. Write to both old and new shards (dual-write)
     * 3. Backfill historical data
     * 4. Verify consistency
     * 5. Switch reads to new shards
     * 6. Remove old shards
     */
    public void reshard() {
        // Phase 1: Prepare
        log.info("Creating {} new shards", NEW_SHARD_COUNT);
        createShards(NEW_SHARD_COUNT);

        // Phase 2: Dual-write
        log.info("Enabling dual-write mode");
        enableDualWrite();

        // Phase 3: Backfill
        log.info("Backfilling historical data");
        backfillHistoricalData();

        // Phase 4: Verify
        log.info("Verifying data consistency");
        verifyConsistency();

        // Phase 5: Switch
        log.info("Switching to new shards");
        switchToNewShards();

        // Phase 6: Cleanup
        log.info("Removing old shards");
        removeOldShards();
    }

    private void enableDualWrite() {
        // All writes go to both old and new shards
        // Reads come from old shards during transition
    }

    private void backfillHistoricalData() {
        // Migrate data from old to new shards
        // Run in background, throttled to avoid impact
    }
}
```

### Distributed Transactions

```java
@Service
public class CrossShardTransactionService {

    /**
     * Cross-shard transactions use the Saga pattern:
     * - Each shard operation runs in a local transaction
     * - Compensation actions undo on failure
     */
    @Transactional
    public void transferPoints(Long fromCustomer, Long toCustomer, int points) {
        try {
            deductPoints(fromCustomer, points);
            addPoints(toCustomer, points);
        } catch (Exception e) {
            // Compensate
            addPoints(fromCustomer, points);
            throw new CrossShardTransferException("Transfer failed", e);
        }
    }

    private void deductPoints(Long customerId, int points) {
        ShardContext.setCustomerId(customerId);
        try {
            // Deduct points in customer's shard
        } finally {
            ShardContext.clear();
        }
    }

    private void addPoints(Long customerId, int points) {
        ShardContext.setCustomerId(customerId);
        try {
            // Add points in customer's shard
        } finally {
            ShardContext.clear();
        }
    }
}
```

---

## Best Practices

### 1. Choose the Right Shard Key

```java
public class ShardKeySelection {

    // Good shard keys:
    // - customer_id (natural distribution)
    // - tenant_id (multi-tenant)
    // - geo_region (geographic distribution)

    // Bad shard keys:
    // - created_at (all writes to one shard)
    // - status (uneven distribution)
    // - auto-increment id (centralized writes)
}
```

### 2. Monitor Replication Lag

```java
@Component
public class ReplicationLagMonitor {

    @Scheduled(fixedRate = 10_000)
    public void monitorLag() {
        // PostgreSQL: SELECT pg_current_wal_lsn() - pg_stat_replication.sent_lsn
        // AWS RDS: SHOW REPLICA STATUS

        long lagBytes = getReplicaLagBytes();
        Duration lagTime = getReplicaLagTime();

        log.info("Replication lag: {} bytes, {} seconds", lagBytes, lagTime.getSeconds());

        if (lagTime.getSeconds() > 30) {
            log.error("Replication lag exceeds 30 seconds!");
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Sharding Without a Plan for Resharding

```java
// WRONG: Fixed shard count without resharding plan
// When the data grows, you're stuck

// CORRECT: Design for resharding from day one
// Use consistent hashing for minimal data movement
// Plan for 2-3x growth before resharding
```

### Mistake 2: Cross-Shard Joins

```sql
-- WRONG: JOIN across shards (impossible without application logic)
SELECT * FROM shard1.orders o
JOIN shard2.customers c ON o.customer_id = c.id  -- Different databases!

-- CORRECT: Denormalize or use application-level joins
-- Store customer data with orders, or aggregate in application
```

### Mistake 3: Reading from Replicas Immediately After Writes

```java
// WRONG: Read-after-write inconsistency
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = orderRepository.save(new Order(request));
    // Replica may not have the data yet!
    return readReplicaRepository.findById(order.getId());
}

// CORRECT: Read from primary after write
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = orderRepository.save(new Order(request));
    ReadWriteContext.setReadOnly(false);
    return orderRepository.findById(order.getId());
}
```

---

## Summary

1. Read replicas scale reads but not writes
2. Sharding scales both reads and writes
3. Handle replication lag with read-after-write consistency
4. Choose shard keys that distribute data evenly
5. Plan for resharding from day one
6. Cross-shard operations are complex (use Sagas)
7. Monitor replication lag and shard balance

---

## References

- [PostgreSQL Streaming Replication](https://www.postgresql.org/docs/current/warm-standby.html)
- [Database Sharding Patterns](https://aws.amazon.com/blogs/database/sharding-with-amazon-relational-database-service/)
- [Vitess Sharding](https://vitess.io/docs/14.0/concepts/sharding/)

Happy Coding