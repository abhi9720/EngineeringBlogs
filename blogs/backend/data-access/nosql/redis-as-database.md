---
title: "Redis as a Database"
description: "Using Redis beyond caching: data structures, persistence, Redis Streams for messaging, RedisJSON, RediSearch, and production deployment patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - redis
  - database
  - nosql
  - caching
coverImage: "/images/backend/data-access/nosql/redis-as-database.png"
draft: false
---

# Redis as a Database

## Overview

Redis is an in-memory data structure store that can be used as a database, cache, message broker, and streaming engine. Beyond simple key-value caching, Redis supports rich data structures, persistence, replication, and modules that extend its capabilities for full-featured database use cases.

---

## Data Structures

### Strings, Lists, Sets, Sorted Sets, Hashes

Redis's power comes from its data structures. **Strings** are the simplest but support TTL-based expiration, making them ideal for session data. **Lists** enable queue patterns with blocking pop operations. **Sets** provide fast membership checks and set operations like union and intersection. **Sorted Sets** maintain a score-based ordering, perfect for leaderboards and rate limiters. **Hashes** store objects as field-value pairs within a single key, providing efficient partial updates without serializing and deserializing the entire object.

```java
@Service
public class RedisDataStructuresService {

    private final RedisTemplate<String, String> redisTemplate;

    public RedisDataStructuresService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    // STRING: Simple key-value
    public void setSession(String sessionId, String userData) {
        redisTemplate.opsForValue().set("session:" + sessionId, userData);
        redisTemplate.expire("session:" + sessionId, 30, TimeUnit.MINUTES);
    }

    public String getSession(String sessionId) {
        return redisTemplate.opsForValue().get("session:" + sessionId);
    }

    // LIST: Queue operations
    public void pushTask(String taskQueue, String task) {
        redisTemplate.opsForList().rightPush("queue:" + taskQueue, task);
    }

    public String popTask(String taskQueue) {
        // Blocking pop with timeout
        return redisTemplate.opsForList().leftPop("queue:" + taskQueue, 5, TimeUnit.SECONDS);
    }

    // SET: Unique members
    public void addUserToGroup(String groupId, String userId) {
        redisTemplate.opsForSet().add("group:" + groupId + ":members", userId);
    }

    public Set<String> getGroupMembers(String groupId) {
        return redisTemplate.opsForSet().members("group:" + groupId + ":members");
    }

    public boolean isUserInGroup(String groupId, String userId) {
        return redisTemplate.opsForSet().isMember("group:" + groupId + ":members", userId);
    }

    public Set<String> findCommonGroups(String userId1, String userId2) {
        return redisTemplate.opsForSet().intersect(
            Arrays.asList("user:" + userId1 + ":groups", "user:" + userId2 + ":groups"));
    }

    // SORTED SET: Leaderboards and rankings
    public void updatePlayerScore(String gameId, String playerId, double score) {
        redisTemplate.opsForZSet().add("leaderboard:" + gameId, playerId, score);
    }

    public Set<String> getTopPlayers(String gameId, int count) {
        return redisTemplate.opsForZSet().reverseRange("leaderboard:" + gameId, 0, count - 1);
    }

    public Long getPlayerRank(String gameId, String playerId) {
        return redisTemplate.opsForZSet().reverseRank("leaderboard:" + gameId, playerId);
    }

    public Double getPlayerScore(String gameId, String playerId) {
        return redisTemplate.opsForZSet().score("leaderboard:" + gameId, playerId);
    }

    // HASH: Object storage
    public void saveUserProfile(UserProfile profile) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("name", profile.getName());
        fields.put("email", profile.getEmail());
        fields.put("age", String.valueOf(profile.getAge()));
        fields.put("createdAt", profile.getCreatedAt().toString());

        redisTemplate.opsForHash().putAll("user:" + profile.getId(), fields);
    }

    public UserProfile getUserProfile(String userId) {
        Map<Object, Object> fields = redisTemplate.opsForHash()
            .entries("user:" + userId);

        if (fields.isEmpty()) return null;

        return UserProfile.builder()
            .name((String) fields.get("name"))
            .email((String) fields.get("email"))
            .age(Integer.parseInt((String) fields.get("age")))
            .build();
    }

    public void updateUserEmail(String userId, String newEmail) {
        redisTemplate.opsForHash().put("user:" + userId, "email", newEmail);
    }
}
```

---

## Redis Streams for Event Processing

### Stream Producer and Consumer

Redis Streams provide a persistent, append-only log with consumer group support—similar to Apache Kafka but with lower operational overhead. The producer adds messages with structured fields (event type, order ID, timestamp). The consumer reads from the stream in a consumer group, which distributes messages across multiple consumers and tracks which messages have been processed. Failed messages can be claimed by a recovery worker using the `XPENDING` and `XCLAIM` commands. The `MAXLEN` trim prevents unbounded stream growth.

```java
@Service
public class RedisStreamService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    private static final String ORDER_STREAM = "orders:stream";
    private static final String CONSUMER_GROUP = "order-processors";

    public RedisStreamService(RedisTemplate<String, String> redisTemplate,
                              ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    // Producer
    public String publishOrderEvent(OrderEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);

            Map<String, String> fields = new LinkedHashMap<>();
            fields.put("event_type", event.getType().name());
            fields.put("order_id", event.getOrderId().toString());
            fields.put("data", json);
            fields.put("timestamp", String.valueOf(Instant.now().toEpochMilli()));

            RecordId recordId = redisTemplate.opsForStream()
                .add(ORDER_STREAM, fields);

            // Trim stream to prevent unbounded growth
            redisTemplate.opsForStream().trim(
                ORDER_STREAM, 10000, TrimStrategy.MAXLEN);

            return recordId.getValue();

        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize event", e);
        }
    }

    // Consumer group setup
    @PostConstruct
    public void setupConsumerGroup() {
        try {
            redisTemplate.opsForStream().createGroup(ORDER_STREAM, CONSUMER_GROUP);
        } catch (Exception e) {
            log.info("Consumer group already exists: {}", CONSUMER_GROUP);
        }
    }

    // Consumer - read from stream
    @Scheduled(fixedDelay = 100)
    public void processOrderEvents() {
        StreamReadOptions options = StreamReadOptions.empty()
            .block(Duration.ofMillis(100))
            .count(10);

        StreamOffset<String> offset = StreamOffset.create(
            ORDER_STREAM, ReadOffset.lastConsumed(CONSUMER_GROUP));

        List<MapRecord<String, Object, Object>> records =
            redisTemplate.opsForStream().read(CONSUMER_GROUP, "processor-1", options, offset);

        for (MapRecord<String, Object, Object> record : records) {
            try {
                processRecord(record);
                redisTemplate.opsForStream().acknowledge(CONSUMER_GROUP, record);
            } catch (Exception e) {
                log.error("Failed to process stream record: {}", record.getId(), e);
                // Move to dead letter queue
                redisTemplate.opsForStream().add("orders:dead-letter", record.getValue());
            }
        }
    }

    private void processRecord(MapRecord<String, Object, Object> record) {
        Map<Object, Object> fields = record.getValue();
        String eventType = (String) fields.get("event_type");
        Long orderId = Long.parseLong((String) fields.get("order_id"));

        log.info("Processing {} for order {}", eventType, orderId);
        // Process based on event type
    }

    // Pending claims for failed consumers
    @Scheduled(fixedDelay = 60000)
    public void claimPendingMessages() {
        PendingMessages pendingMessages = redisTemplate.opsForStream()
            .pending(ORDER_STREAM, CONSUMER_GROUP);

        if (pendingMessages.getTotalPending() > 0) {
            log.info("Found {} pending messages", pendingMessages.getTotalPending());

            // Auto-claim messages older than 5 minutes
            Duration minIdleTime = Duration.ofMinutes(5);
            StreamReadOptions options = StreamReadOptions.empty()
                .count(10);

            List<MapRecord<String, Object, Object>> claimed =
                redisTemplate.opsForStream().claim(
                    ORDER_STREAM, CONSUMER_GROUP, "recovery-worker",
                    minIdleTime, options, pendingMessages.getPendingMessages()
                    .stream()
                    .map(PendingMessage::getId)
                    .toArray(RecordId[]::new));

            log.info("Claimed {} messages for reprocessing", claimed.size());
        }
    }
}
```

---

## Redis Modules: JSON and Search

### RedisJSON and RediSearch

Redis modules extend Redis with new data types and commands. **RedisJSON** allows storing, updating, and querying JSON documents with native JSONPath support, avoiding the need to serialize/deserialize in the application. **RediSearch** provides secondary indexes, full-text search, and aggregation queries on Redis hashes or JSON documents—turning Redis into a capable search engine.

```java
@Service
public class RedisModuleService {

    private final RedisTemplate<String, Object> redisTemplate;

    // Using RedisJSON
    public void storeJsonDocument(String key, Object document) {
        // Requires RedisJSON module
        redisTemplate.opsForValue().set(key, document);
    }

    public <T> T getJsonDocument(String key, Class<T> type) {
        return (T) redisTemplate.opsForValue().get(key);
    }

    public void updateJsonField(String key, String path, Object value) {
        // JSON.SET key path value
        // redisTemplate.opsForValue().set(key, ...) with JSON serializer
    }

    // Using RediSearch for full-text search
    public void createSearchIndex() {
        // Requires RediSearch module
        // FT.CREATE productIdx ON HASH PREFIX 1 "product:" SCHEMA
        //   name TEXT WEIGHT 5.0
        //   description TEXT WEIGHT 1.0
        //   price NUMERIC SORTABLE
        //   category TAG
    }

    public List<String> searchProducts(String query, int limit) {
        // FT.SEARCH productIdx "@name:(wireless) @price:[10 100]"
        // Returns matching product keys
        return Collections.emptyList();
    }

    public List<String> searchWithAggregation(String query, String category) {
        // FT.AGGREGATE productIdx "@category:{electronics}"
        //   GROUPBY 1 @category
        //   REDUCE AVG 1 @price AS avg_price
        return Collections.emptyList();
    }
}
```

---

## Persistence and Replication

### Configuration

When using Redis as a database (not just a cache), persistence is critical. The configuration below sets up both RDB snapshots and AOF (Append-Only File) for durability. RDB snapshots are point-in-time backups triggered by the `save` directives. AOF logs every write operation, providing finer-grained durability at the cost of disk I/O. In production, enable both: RDB for fast recovery, AOF for minimal data loss.

```java
@Configuration
public class RedisDatabaseConfig {

    @Bean
    public RedisConnectionFactory redisConnectionFactory() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration();
        config.setHostName("redis.example.com");
        config.setPort(6379);
        config.setPassword("redis-password");

        // Configure connection pool
        LettucePoolingClientConfiguration poolConfig = LettucePoolingClientConfiguration.builder()
            .poolConfig(new GenericObjectPoolConfig<>() {{
                setMaxTotal(20);
                setMaxIdle(10);
                setMinIdle(5);
            }})
            .commandTimeout(Duration.ofMillis(100))
            .shutdownTimeout(Duration.ofSeconds(1))
            .build();

        return new LettuceConnectionFactory(config, poolConfig);
    }

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory connectionFactory) {

        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        // Use JSON serializer for objects
        Jackson2JsonRedisSerializer<Object> jsonSerializer =
            new Jackson2JsonRedisSerializer<>(Object.class);

        template.setDefaultSerializer(jsonSerializer);
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());

        return template;
    }

    // RDB/AOF persistence configuration (redis.conf):
    // save 900 1       # Save after 900 sec if 1 key changed
    // save 300 10      # Save after 300 sec if 10 keys changed
    // save 60 10000    # Save after 60 sec if 10000 keys changed
    // appendonly yes   # Enable AOF
    // auto-aof-rewrite-percentage 100
    // auto-aof-rewrite-min-size 64mb
}
```

---

## Best Practices

1. **Use appropriate data structures**: Hashes for objects, Sorted Sets for rankings
2. **Set TTL for all keys**: Prevent memory leaks
3. **Use connection pooling**: Lettuce with pool configuration
4. **Enable persistence for database use**: RDB + AOF for durability
5. **Use Redis Streams for event processing**: Reliable message delivery
6. **Monitor memory usage**: Set maxmemory and eviction policy
7. **Use pipelining for batch operations**: Reduce round trips
8. **Implement retry logic**: Handle connection failures
9. **Use Redis Cluster for high availability**: Automatic sharding
10. **Profile slow queries**: Use SLOWLOG

Pipelining batches multiple commands into a single network round trip, dramatically improving throughput for batch operations like updating many scores in a leaderboard.

```java
// Pipelining for batch operations
public void batchUpdateScores(Map<String, Double> scores) {
    redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
        scores.forEach((playerId, score) -> {
            connection.zIncrBy("game:scores".getBytes(), score, playerId.getBytes());
        });
        return null;
    });
}
```

---

## Common Mistakes

### Mistake 1: Storing Large Values

Redis is an in-memory database—every byte of data consumes RAM. Storing large serialized objects as single string values wastes memory and hurts throughput. Use Hashes to store objects as field-value pairs, which are more memory-efficient and allow partial updates.

```java
// WRONG: Storing entire JSON documents as string values
// Limits throughput, memory usage

// CORRECT: Use Hashes for objects, split large data
redisTemplate.opsForHash().putAll("user:123", fields);
```

### Mistake 2: No TTL on Keys

Keys without TTLs accumulate indefinitely, eventually filling memory and triggering eviction. Every key stored in Redis should have a TTL, even if it is very long (e.g., 30 days for user profiles).

```java
// WRONG: Keys never expire
redisTemplate.opsForValue().set("session:123", data);
// Memory leak!

// CORRECT: Always set TTL
redisTemplate.opsForValue().set("session:123", data, 30, TimeUnit.MINUTES);
```

### Mistake 3: Using Redis as Primary Database Without Persistence

Without persistence, all data is lost if Redis restarts. For database use cases, enable both RDB snapshots and AOF. The `appendonly yes` directive enables AOF, and the `save` directives configure RDB snapshot frequency.

```java
// WRONG: No persistence - all data lost on restart
// maxmemory-policy noeviction

// CORRECT: Configure persistence for database use cases
// appendonly yes
// save 900 1
```

---

## Summary

1. Redis supports rich data structures: Strings, Lists, Sets, Sorted Sets, Hashes
2. Redis Streams provide reliable message queuing with consumer groups
3. RedisJSON and RediSearch extend Redis for document and search use cases
4. Configure persistence (RDB/AOF) when using Redis as a database
5. Use connection pooling and TTL for production readiness
6. Pipeline batch operations for performance
7. Monitor memory and configure eviction policies
8. Use Redis Cluster for high availability and scaling

---

## References

- [Redis Documentation](https://redis.io/docs/)
- [Redis Data Structures](https://redis.io/docs/data-types/)
- [Redis Streams Introduction](https://redis.io/docs/data-types/streams/)
- [Redis Persistence](https://redis.io/docs/management/persistence/)

Happy Coding
