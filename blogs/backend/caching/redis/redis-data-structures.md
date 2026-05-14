---
title: "Redis Data Structures"
description: "Master Redis data structures: strings, hashes, lists, sets, sorted sets, streams, and their optimal use cases"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - caching
  - redis
  - data-structures
  - database
coverImage: "/images/redis-data-structures.png"
draft: false
---

# Redis Data Structures

## Overview

Redis provides a rich set of data structures beyond simple key-value storage. Choosing the right structure for your use case significantly impacts performance, memory usage, and code complexity.

### Why Data Structures Matter

- **Strings**: Simple caching, counters, distributed locks
- **Hashes**: Object storage, partial updates
- **Lists**: Queues, message buffers, timelines
- **Sets**: Unique items, membership checks
- **Sorted Sets**: Leaderboards, priority queues
- **Streams**: Event logs, message queues

---

## Strings

### Basic Operations

```java
@Service
public class RedisStringService {

    private final RedisTemplate<String, String> redisTemplate;

    public void stringOperations() {
        ValueOperations<String, String> ops = redisTemplate.opsForValue();

        // Set and get
        ops.set("user:1:name", "Alice");
        String name = ops.get("user:1:name");

        // Set with TTL
        ops.set("session:abc123", "user_1", Duration.ofMinutes(30));

        // Set if not exists
        Boolean success = ops.setIfAbsent("lock:order:123", "locked");
        if (Boolean.TRUE.equals(success)) {
            // Acquired lock
        }

        // Increment and decrement
        Long count = ops.increment("page:visits");  // Returns 1
        ops.increment("page:visits", 5);            // Now 6
        ops.decrement("page:visits");               // Now 5

        // Multi-get
        List<String> values = ops.multiGet(Arrays.asList("key1", "key2", "key3"));

        // Append
        Integer length = ops.append("message", " world");  // Returns new length
    }

    // Distributed counter
    public long getAndIncrement(String key) {
        return redisTemplate.opsForValue().increment(key);
    }

    // Distributed lock
    public boolean tryLock(String key, Duration timeout) {
        return Boolean.TRUE.equals(
            redisTemplate.opsForValue().setIfAbsent(
                key, Thread.currentThread().getName(), timeout));
    }

    public void unlock(String key) {
        redisTemplate.delete(key);
    }
}
```

---

## Hashes

### Object Storage

```java
@Service
public class RedisHashService {

    private final RedisTemplate<String, Object> redisTemplate;

    public void hashOperations() {
        HashOperations<String, String, Object> ops = redisTemplate.opsForHash();

        // Store object fields
        Map<String, Object> user = new HashMap<>();
        user.put("id", "1");
        user.put("name", "Alice");
        user.put("email", "alice@example.com");
        user.put("age", "30");
        ops.putAll("user:1", user);

        // Get single field
        String name = (String) ops.get("user:1", "name");

        // Get multiple fields
        List<Object> fields = ops.multiGet("user:1", Arrays.asList("name", "email"));

        // Get all fields
        Map<String, Object> allFields = ops.entries("user:1");

        // Increment a field
        ops.increment("user:1", "loginCount", 1);

        // Check if field exists
        Boolean hasEmail = ops.hasKey("user:1", "email");

        // Delete fields
        ops.delete("user:1", "temporary_token");
    }

    // Session store with partial updates
    public void updateSessionField(String sessionId, String field, Object value) {
        redisTemplate.opsForHash().put("session:" + sessionId, field, value);
    }

    // Product with many attributes
    public Map<String, Object> getProductAttributes(Long productId) {
        return redisTemplate.opsForHash().entries("product:" + productId);
    }
}
```

---

## Lists

### Queue Implementation

```java
@Service
public class RedisListService {

    private final RedisTemplate<String, String> redisTemplate;

    public void listOperations() {
        ListOperations<String, String> ops = redisTemplate.opsForList();

        // Push to right (end) - FIFO queue
        ops.rightPush("queue:orders", "order:1");
        ops.rightPush("queue:orders", "order:2");
        ops.rightPush("queue:orders", "order:3");

        // Pop from left (front) - FIFO
        String order = ops.leftPop("queue:orders");  // "order:1"

        // Push to left (front) - Stack
        ops.leftPush("stack:actions", "action:1");
        ops.leftPush("stack:actions", "action:2");

        // Pop from left - LIFO
        String action = ops.leftPop("stack:actions");  // "action:2"

        // Range operations
        List<String> all = ops.range("queue:orders", 0, -1);  // All elements
        List<String> first3 = ops.range("queue:orders", 0, 2);  // First 3

        // Trim to a range
        ops.trim("queue:orders", 0, 99);  // Keep only first 100

        // Blocking pops (Thread-safe)
        String blocked = ops.leftPop("queue:orders", 5, TimeUnit.SECONDS);
        // Waits up to 5 seconds for an element
    }

    // Rate limiting with list
    public boolean allowRequest(String userId) {
        String key = "ratelimit:" + userId;
        ListOperations<String, String> ops = redisTemplate.opsForList();
        long now = System.currentTimeMillis();

        // Remove old entries
        while (true) {
            String oldest = ops.rightPop(key);
            if (oldest == null) break;
            if (now - Long.parseLong(oldest) < 60_000) {
                ops.rightPush(key, oldest);
                break;
            }
        }

        // Check count
        Long size = ops.size(key);
        if (size != null && size >= 10) {
            return false; // Rate limited
        }

        ops.leftPush(key, String.valueOf(now));
        return true;
    }
}
```

---

## Sets

### Unique Items

```java
@Service
public class RedisSetService {

    private final RedisTemplate<String, String> redisTemplate;

    public void setOperations() {
        SetOperations<String, String> ops = redisTemplate.opsForSet();

        // Add members
        ops.add("tags:article:1", "java", "redis", "performance");
        ops.add("tags:article:2", "java", "spring", "caching");

        // Check membership
        Boolean hasTag = ops.isMember("tags:article:1", "java");

        // Get all members
        Set<String> tags = ops.members("tags:article:1");

        // Intersection (common tags)
        Set<String> common = ops.intersect("tags:article:1", "tags:article:2");
        // Returns: ["java"]

        // Union (all tags)
        Set<String> union = ops.union("tags:article:1", "tags:article:2");
        // Returns: ["java", "redis", "performance", "spring", "caching"]

        // Difference (tags in 1 but not in 2)
        Set<String> diff = ops.difference("tags:article:1", "tags:article:2");
        // Returns: ["redis", "performance"]

        // Random member
        String random = ops.randomMember("tags:article:1");

        // Pop random member
        String popped = ops.pop("tags:article:1");

        // Size
        Long size = ops.size("tags:article:1");

        // Move between sets
        Boolean moved = ops.move("tags:article:1", "archived:tags", "redis");
    }

    // Track unique visitors
    public void trackVisitor(String pageId, String userId) {
        redisTemplate.opsForSet().add("visitors:" + pageId, userId);
    }

    public long getUniqueVisitors(String pageId) {
        Long size = redisTemplate.opsForSet().size("visitors:" + pageId);
        return size != null ? size : 0;
    }

    // Mutual friends
    public Set<String> getMutualFriends(String user1, String user2) {
        return redisTemplate.opsForSet()
            .intersect("friends:" + user1, "friends:" + user2);
    }
}
```

---

## Sorted Sets

### Leaderboard Implementation

```java
@Service
public class RedisSortedSetService {

    private final RedisTemplate<String, String> redisTemplate;

    public void sortedSetOperations() {
        ZSetOperations<String, String> ops = redisTemplate.opsForZSet();

        // Add members with scores
        ops.add("leaderboard:game1", "player:1", 1500);
        ops.add("leaderboard:game1", "player:2", 2300);
        ops.add("leaderboard:game1", "player:3", 1800);
        ops.add("leaderboard:game1", "player:4", 3000);

        // Increment score
        ops.incrementScore("leaderboard:game1", "player:1", 500);
        // player:1 now has 2000

        // Get rank (0-based, ascending)
        Long rank = ops.rank("leaderboard:game1", "player:4");
        // Returns 3 (highest rank)

        // Get reverse rank (0-based, descending)
        Long revRank = ops.reverseRank("leaderboard:game1", "player:4");
        // Returns 0 (top of leaderboard)

        // Get top 3 (reverse range by score)
        Set<String> top3 = ops.reverseRange("leaderboard:game1", 0, 2);

        // Get top 3 with scores
        Set<ZSetOperations.TypedTuple<String>> top3WithScores =
            ops.reverseRangeWithScores("leaderboard:game1", 0, 2);

        // Get players within a score range
        Set<String> withinRange = ops.rangeByScore(
            "leaderboard:game1", 1000, 2000);

        // Count players in score range
        Long count = ops.count("leaderboard:game1", 1500, 2500);

        // Remove by rank
        ops.removeRange("leaderboard:game1", 0, 0); // Remove lowest

        // Get score
        Double score = ops.score("leaderboard:game1", "player:1");

        // Size
        Long zsize = ops.zCard("leaderboard:game1");
    }

    // Time-based sorted set
    public void addTimedEvent(String eventType, String eventId) {
        double timestamp = System.currentTimeMillis() / 1000.0;
        redisTemplate.opsForZSet().add("events:" + eventType, eventId, timestamp);
    }

    // Get recent events
    public Set<String> getRecentEvents(String eventType, int count) {
        return redisTemplate.opsForZSet()
            .reverseRange("events:" + eventType, 0, count - 1);
    }
}
```

---

## Streams

### Event Log

```java
@Service
public class RedisStreamService {

    private final RedisTemplate<String, String> redisTemplate;

    public void streamOperations() {
        StreamOperations<String, String, String> ops = redisTemplate.opsForStream();

        // Add to stream
        Map<String, String> event = new HashMap<>();
        event.put("orderId", "123");
        event.put("userId", "456");
        event.put("amount", "99.99");
        event.put("timestamp", Instant.now().toString());

        RecordId id = ops.add(
            StreamRecords.newRecord()
                .in("orders:stream")
                .ofStrings(event)
        );

        // Read from stream (new entries only)
        List<MapRecord<String, String, String>> messages = ops.read(
            StreamReadOptions.empty()
                .count(10)
                .block(Duration.ofSeconds(5)),
            StreamOffset.create("orders:stream", ReadOffset.lastConsumed())
        );

        // Consumer group
        ops.createGroup("orders:stream", "order-processors");

        // Read as consumer group member
        List<MapRecord<String, String, String>> consumerMessages = ops.read(
            Consumer.from("order-processors", "processor-1"),
            StreamReadOptions.empty().count(10),
            StreamOffset.create("orders:stream", ReadOffset.lastConsumed())
        );

        // Acknowledge
        for (MapRecord<String, String, String> msg : consumerMessages) {
            processEvent(msg.getValue());
            ops.acknowledge("orders:stream", "order-processors", msg.getId());
        }
    }

    private void processEvent(Map<String, String> event) {
        log.info("Processing event: {}", event);
    }
}
```

---

## Best Practices

### 1. Choose the Right Structure

```java
// WRONG: Using strings for objects
redisTemplate.opsForValue().set("user:1", userJson);

// CORRECT: Using hashes for objects
redisTemplate.opsForHash().putAll("user:1", Map.of(
    "id", "1", "name", "Alice", "email", "alice@example.com"
));
```

### 2. Use Appropriate TTLs

```java
// WRONG: No expiration for time-sensitive data
redisTemplate.opsForValue().set("session:abc", "data");

// CORRECT: Always set TTL for ephemeral data
redisTemplate.opsForValue().set("session:abc", "data", Duration.ofHours(1));
```

---

## Common Mistakes

### Mistake 1: Not Using Pipelines for Batch Operations

```java
// WRONG: Multiple round trips
for (String key : keys) {
    redisTemplate.opsForValue().get(key);
}

// CORRECT: Pipeline operations
List<Object> results = redisTemplate.executePipelined(
    (RedisCallback<Object>) connection -> {
        for (String key : keys) {
            connection.stringCommands().get(key.getBytes());
        }
        return null;
    }
);
```

### Mistake 2: Ignoring Memory

```java
// WRONG: Storing unbounded lists
redisTemplate.opsForList().rightPush("logs", logEntry);
// List grows forever!

// CORRECT: Trim after push
redisTemplate.opsForList().rightPush("logs", logEntry);
redisTemplate.opsForList().trim("logs", -1000, -1); // Keep last 1000
```

---

## Summary

| Structure | Use Case | Example |
|-----------|----------|---------|
| String | Simple values, counters | Session tokens, page views |
| Hash | Objects with many fields | User profiles, product data |
| List | Ordered collections | Message queues, timelines |
| Set | Unique memberships | Tags, unique visitors |
| Sorted Set | Ordered unique members | Leaderboards, rate limits |
| Stream | Append-only event logs | Order events, audit logs |

---

## References

- [Redis Data Types](https://redis.io/docs/data-types/)
- [Redis Data Structures Documentation](https://redis.io/docs/data-types/data-types-tutorial/)
- [Spring Data Redis](https://spring.io/projects/spring-data-redis)

Happy Coding