---
title: "Cassandra in Backend"
description: "Master Apache Cassandra for backend applications: data modeling, CQL, partitioning, consistency levels, Spring Data Cassandra, and production patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - cassandra
  - nosql
  - distributed-database
  - spring-data
coverImage: "/images/backend/data-access/nosql/cassandra-in-backend.png"
draft: false
---

# Cassandra in Backend

## Overview

Apache Cassandra is a distributed NoSQL database designed for high availability, horizontal scaling, and fault tolerance. It excels at write-heavy workloads, time-series data, and applications requiring linear scalability across multiple data centers. Understanding Cassandra's data model and query patterns is essential for effective backend integration.

---

## Data Modeling

### Keyspace and Table Design

```java
@Configuration
public class CassandraConfig {

    @Bean
    public CassandraSessionFactoryBean session() {
        CassandraSessionFactoryBean session = new CassandraSessionFactoryBean();
        session.setKeyspaceName("ecommerce");
        session.setContactPoints("cassandra-node1,cassandra-node2,cassandra-node3");
        session.setPort(9042);
        session.setLocalDatacenter("us-east");

        // Consistency configuration
        session.setConsistencyLevel(ConsistencyLevel.LOCAL_QUORUM);
        session.setSerialConsistencyLevel(ConsistencyLevel.LOCAL_SERIAL);

        return session;
    }
}

// CQL schema creation
// CREATE KEYSPACE IF NOT EXISTS ecommerce
//   WITH replication = {
//     'class': 'NetworkTopologyStrategy',
//     'us-east': 3,
//     'us-west': 3
//   };
```

### Entity Mapping

```java
@Table("orders_by_user")
public class OrderByUser {

    @PrimaryKey
    private OrderByUserKey key;

    @Column("order_number")
    private String orderNumber;

    @Column("total_amount")
    private BigDecimal totalAmount;

    @Column("status")
    private String status;

    @Column("items_count")
    private int itemsCount;
}

@PrimaryKeyClass
public class OrderByUserKey implements Serializable {

    @PrimaryKeyColumn(name = "user_id", type = PrimaryKeyType.PARTITIONED)
    private String userId;

    @PrimaryKeyColumn(name = "order_date", type = PrimaryKeyType.CLUSTERED,
                      ordering = Ordering.DESCENDING)
    private LocalDate orderDate;

    @PrimaryKeyColumn(name = "order_id", type = PrimaryKeyType.CLUSTERED)
    private String orderId;
}

@Table("orders_by_date")
public class OrderByDate {

    @PrimaryKey
    private OrderByDateKey key;

    @Column("user_id")
    private String userId;

    @Column("total_amount")
    private BigDecimal totalAmount;

    @Column("status")
    private String status;
}

@PrimaryKeyClass
public class OrderByDateKey implements Serializable {

    @PrimaryKeyColumn(name = "date_bucket", type = PrimaryKeyType.PARTITIONED)
    private String dateBucket;

    @PrimaryKeyColumn(name = "order_timestamp", type = PrimaryKeyType.CLUSTERED,
                      ordering = Ordering.DESCENDING)
    private Instant orderTimestamp;

    @PrimaryKeyColumn(name = "order_id", type = PrimaryKeyType.CLUSTERED)
    private String orderId;
}
```

---

## Repository Pattern

### Cassandra Repository

```java
@Repository
public interface OrderByUserRepository extends CassandraRepository<OrderByUser, OrderByUserKey> {

    // Query by partition key
    List<OrderByUser> findByKeyUserId(String userId);

    // Query by partition key with clustering key range
    List<OrderByUser> findByKeyUserIdAndKeyOrderDateGreaterThan(
        String userId, LocalDate sinceDate);

    // Query with ordering (must match table clustering order)
    List<OrderByUser> findByKeyUserIdAndKeyOrderDateBetween(
        String userId, LocalDate startDate, LocalDate endDate);

    // Allow filtering (use with caution)
    @Query("SELECT * FROM orders_by_user WHERE status = ?0 ALLOW FILTERING")
    List<OrderByUser> findByStatus(String status);

    // Count by partition
    long countByKeyUserId(String userId);

    // Delete by partition
    void deleteByKeyUserId(String userId);
}

@Repository
public interface OrderByDateRepository extends CassandraRepository<OrderByDate, OrderByDateKey> {

    List<OrderByDate> findByKeyDateBucket(String dateBucket);

    List<OrderByDate> findByKeyDateBucketAndKeyOrderTimestampGreaterThan(
        String dateBucket, Instant since);
}
```

### CassandraTemplate

```java
@Service
public class OrderDataService {

    private final CassandraTemplate cassandraTemplate;

    public OrderDataService(CassandraTemplate cassandraTemplate) {
        this.cassandraTemplate = cassandraTemplate;
    }

    public List<OrderByUser> getRecentOrdersByUser(String userId, int limit) {
        // Use CassandraTemplate for queries that don't fit repository pattern
        Select select = QueryBuilder.select()
            .from("orders_by_user")
            .where(QueryBuilder.eq("user_id", userId))
            .limit(limit);

        return cassandraTemplate.select(select, OrderByUser.class);
    }

    public void insertOrderWithTimestamp(OrderEvent event) {
        // Write to multiple denormalized tables for different query patterns
        OrderByUser orderByUser = mapToOrderByUser(event);
        OrderByDate orderByDate = mapToOrderByDate(event);

        // Batch insert for atomicity (same partition)
        BatchStatement batch = QueryBuilder.batch()
            .add(cassandraTemplate.insert(orderByUser))
            .add(cassandraTemplate.insert(orderByDate))
            .build();

        cassandraTemplate.getCqlOperations().execute(batch);
    }

    public List<OrderByUser> getPagedOrdersByUser(String userId, String lastOrderId,
                                                   LocalDate lastDate, int pageSize) {
        Select select = QueryBuilder.select()
            .from("orders_by_user")
            .where(QueryBuilder.eq("user_id", userId));

        // Add paging based on last result
        if (lastOrderId != null) {
            select.where(QueryBuilder.lt("order_date", lastDate))
                .or(QueryBuilder.eq("order_date", lastDate))
                .where(QueryBuilder.lt("order_id", lastOrderId));
        }

        select.limit(pageSize);

        return cassandraTemplate.select(select, OrderByUser.class);
    }
}
```

---

## Consistency Levels

### Configuring Consistency

```java
@Service
public class ConsistencyService {

    private final CassandraTemplate cassandraTemplate;

    // Consistency levels in Cassandra:
    // - ONE: Fastest, lowest consistency
    // - LOCAL_ONE: Fastest within DC
    // - QUORUM: Majority of replicas ( (RF/2) + 1 )
    // - LOCAL_QUORUM: Quorum within local DC
    // - EACH_QUORUM: Quorum in each DC (multi-DC)
    // - ALL: All replicas (slowest, highest consistency)

    public OrderByUser readWithLocalQuorum(String userId, LocalDate orderDate, String orderId) {
        OrderByUserKey key = new OrderByUserKey(userId, orderDate, orderId);

        // Configure statement-level consistency
        Select select = QueryBuilder.select()
            .from("orders_by_user")
            .where(QueryBuilder.eq("user_id", userId))
            .and(QueryBuilder.eq("order_date", orderDate))
            .and(QueryBuilder.eq("order_id", orderId));

        select.setConsistencyLevel(ConsistencyLevel.LOCAL_QUORUM);

        return cassandraTemplate.selectOne(select, OrderByUser.class);
    }

    public void writeWithLocalOne(String userId, OrderByUser order) {
        // Fast write, lower consistency
        Insert insert = cassandraTemplate.insert(order);
        insert.setConsistencyLevel(ConsistencyLevel.LOCAL_ONE);

        cassandraTemplate.getCqlOperations().execute(insert);
    }

    public void writeWithLocalQuorum(String userId, OrderByUser order) {
        // Slower write, higher consistency
        Insert insert = cassandraTemplate.insert(order);
        insert.setConsistencyLevel(ConsistencyLevel.LOCAL_QUORUM);

        cassandraTemplate.getCqlOperations().execute(insert);
    }

    // Use LOCAL_SERIAL for lightweight transactions (compare-and-set)
    public boolean conditionalUpdate(String orderId, String expectedStatus, String newStatus) {
        Statement statement = QueryBuilder.update("orders_by_user")
            .with(QueryBuilder.set("status", newStatus))
            .where(QueryBuilder.eq("order_id", orderId))
            .and(QueryBuilder.eq("status", expectedStatus))
            .setSerialConsistencyLevel(ConsistencyLevel.LOCAL_SERIAL);

        return cassandraTemplate.getCqlOperations().execute(statement);
    }
}
```

---

## Time Series Data Modeling

### Bucketing Strategy

```java
@Service
public class TimeSeriesService {

    private final CassandraTemplate cassandraTemplate;

    // Time bucketing for efficient time series queries
    public void storeSensorReading(String sensorId, double value) {
        Instant now = Instant.now();

        // Create daily bucket
        String dayBucket = LocalDate.now().toString();

        Insert insert = QueryBuilder.insertInto("sensor_readings")
            .value("sensor_id", sensorId)
            .value("day_bucket", dayBucket)
            .value("reading_time", now)
            .value("value", value)
            .value("ingested_at", Instant.now());

        cassandraTemplate.getCqlOperations().execute(insert);
    }

    public List<SensorReading> getReadingsForDay(String sensorId, LocalDate date) {
        Select select = QueryBuilder.select()
            .from("sensor_readings")
            .where(QueryBuilder.eq("sensor_id", sensorId))
            .and(QueryBuilder.eq("day_bucket", date.toString()));

        return cassandraTemplate.select(select, SensorReading.class);
    }

    public List<SensorReading> getReadingsForRange(String sensorId, LocalDate startDate,
                                                    LocalDate endDate) {
        // Query multiple day buckets
        List<SensorReading> allReadings = new ArrayList<>();

        LocalDate current = startDate;
        while (!current.isAfter(endDate)) {
            Select select = QueryBuilder.select()
                .from("sensor_readings")
                .where(QueryBuilder.eq("sensor_id", sensorId))
                .and(QueryBuilder.eq("day_bucket", current.toString()));

            allReadings.addAll(cassandraTemplate.select(select, SensorReading.class));
            current = current.plusDays(1);
        }

        return allReadings;
    }

    // TTL for automatic data expiration
    public void storeWithTTL(String sensorId, double value, int ttlSeconds) {
        Insert insert = QueryBuilder.insertInto("sensor_readings")
            .value("sensor_id", sensorId)
            .value("day_bucket", LocalDate.now().toString())
            .value("reading_time", Instant.now())
            .value("value", value);

        insert.using(QueryBuilder.ttl(ttlSeconds));

        cassandraTemplate.getCqlOperations().execute(insert);
    }
}
```

---

## Best Practices

1. **Design tables for queries**: Query-first data modeling
2. **Use denormalization**: Store data in multiple tables per query pattern
3. **Choose partition key carefully**: Even data distribution, avoid hot partitions
4. **Limit partition size**: Target < 100MB per partition, < 100K rows
5. **Use time bucketing**: Hour/daily buckets for time series
6. **Set TTL for temporary data**: Automatic data expiration
7. **Use LOCAL_QUORUM for most operations**: Balance consistency and performance
8. **Avoid ALLOW FILTERING**: Design tables to avoid full scans
9. **Monitor compaction**: Size-tiered or leveled compaction strategies
10. **Use prepared statements**: Reuse query plans

```java
// Prepared statements
@Repository
public class PreparedStatementService {

    private final CassandraTemplate cassandraTemplate;
    private PreparedStatement insertPrepared;

    @PostConstruct
    public void prepareStatements() {
        String cql = "INSERT INTO orders_by_user " +
            "(user_id, order_date, order_id, total_amount, status) " +
            "VALUES (?, ?, ?, ?, ?)";

        insertPrepared = cassandraTemplate.getSession().prepare(cql);
        insertPrepared.setConsistencyLevel(ConsistencyLevel.LOCAL_QUORUM);
    }

    public void insertOrder(OrderByUser order) {
        BoundStatement bound = insertPrepared.bind(
            order.getKey().getUserId(),
            order.getKey().getOrderDate(),
            order.getKey().getOrderId(),
            order.getTotalAmount(),
            order.getStatus()
        );

        cassandraTemplate.getCqlOperations().execute(bound);
    }
}
```

---

## Common Mistakes

### Mistake 1: Using SQL-like Joins

```java
// WRONG: Trying to join tables
// Cassandra does not support joins

// CORRECT: Denormalize data for the query pattern
// Store all needed data in a single table per query
```

### Mistake 2: Large Partitions

```java
// WRONG: Poor partition key choice causes hot spots
PRIMARY KEY (user_id, timestamp)
// One user with millions of orders creates a huge partition

// CORRECT: Use composite partition key
PRIMARY KEY ((user_id, date_bucket), timestamp)
```

### Mistake 3: Read-Before-Write Pattern

```java
// WRONG: Read then write (Cassandra anti-pattern)
Order existing = findById(id);  // Read
existing.setStatus("UPDATED");  // Modify
save(existing);                 // Write

// CORRECT: Write directly (Cassandra optimized for writes)
UPDATE orders SET status = 'UPDATED' WHERE id = ?;
```

---

## Summary

1. Cassandra is optimized for write-heavy, horizontally scalable workloads
2. Design tables around query patterns, not entity relationships
3. Denormalize data across multiple tables for different queries
4. Choose partition keys for even data distribution
5. Use consistent naming conventions for time bucketing
6. Set TTL for data with limited lifespan
7. Use LOCAL_QUORUM as default consistency level
8. Avoid ALLOW FILTERING and read-before-write patterns
9. Use prepared statements for query plan caching
10. Monitor partition sizes and compaction strategies

---

## References

- [Cassandra Documentation](https://cassandra.apache.org/doc/latest/)
- [Spring Data Cassandra](https://docs.spring.io/spring-data/cassandra/reference/)
- [Cassandra Data Modeling](https://cassandra.apache.org/doc/latest/cassandra/data_modeling/)
- [Cassandra Consistency](https://cassandra.apache.org/doc/latest/cassandra/architecture/guarantees.html)

Happy Coding