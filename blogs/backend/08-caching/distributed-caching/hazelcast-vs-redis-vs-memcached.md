---
title: Hazelcast vs Redis vs Memcached
description: >-
  Compare Hazelcast, Redis, and Memcached for distributed caching: features,
  performance, clustering, and use cases
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - caching
  - hazelcast
  - redis
  - memcached
coverImage: /images/hazelcast-vs-redis-vs-memcached.png
draft: false
order: 100
type: comparison
---
# Hazelcast vs Redis vs Memcached

## Overview

Hazelcast, Redis, and Memcached are three leading distributed caching solutions. Each has different strengths in data structures, clustering, persistence, and performance.

### Quick Comparison

| Feature | Hazelcast | Redis | Memcached |
|---------|-----------|-------|-----------|
| Type | In-memory data grid | In-memory data store | In-memory cache |
| Data Structures | Maps, queues, topics, sets | Rich (strings, hashes, etc.) | Simple key-value |
| Persistence | Native | RDB/AOF | None |
| Clustering | Built-in (P2P) | Sentinel/Cluster | None (client-side) |
| Processing | Distributed computing | Lua scripts | None |
| Multi-language | Java-native, clients exist | Many clients | Many clients |

---

## Hazelcast

### Architecture

Hazelcast runs embedded in the application JVM or as a standalone cluster. Its configuration below sets up discovery via Kubernetes, near-cache for local reads, and eviction policies.

```java
@Configuration
@EnableCaching
public class HazelcastConfig {

    @Bean
    public Config hazelcastConfig() {
        Config config = new Config();
        config.setInstanceName("cache-cluster");

        // Network configuration
        NetworkConfig network = config.getNetworkConfig();
        network.setPort(5701).setPortAutoIncrement(true);

        // Discovery (Kubernetes)
        JoinConfig join = network.getJoin();
        join.getMulticastConfig().setEnabled(false);
        join.getKubernetesConfig()
            .setEnabled(true)
            .setProperty("namespace", "production")
            .setProperty("service-name", "hazelcast");

        // Map configuration
        MapConfig mapConfig = config.getMapConfig("products");
        mapConfig.setBackupCount(1);
        mapConfig.setAsyncBackupCount(0);
        mapConfig.setTimeToLiveSeconds(1800);
        mapConfig.setMaxIdleSeconds(600);
        mapConfig.setEvictionConfig(new EvictionConfig()
            .setSize(100_000)
            .setMaxSizePolicy(MaxSizePolicy.FREE_HEAP_PERCENTAGE)
            .setEvictionPolicy(EvictionPolicy.LRU));

        config.addMapConfig(mapConfig);

        return config;
    }
}

@Service
public class HazelcastCacheService {

    private final HazelcastInstance hazelcast;

    public HazelcastCacheService(HazelcastInstance hazelcast) {
        this.hazelcast = hazelcast;
    }

    public void putProduct(Long id, Product product) {
        IMap<Long, Product> map = hazelcast.getMap("products");
        map.put(id, product);
    }

    public Product getProduct(Long id) {
        IMap<Long, Product> map = hazelcast.getMap("products");
        return map.get(id);
    }

    // Distributed query
    public Collection<Product> findProductsByCategory(String category) {
        IMap<Long, Product> map = hazelcast.getMap("products");
        return map.values(Predicates.equal("category", category));
    }

    // Distributed executor
    public void processInParallel() {
        IExecutorService executor = hazelcast.getExecutorService("processor");
        Map<Member, Object> results = executor.submitToAllMembers(new ProductProcessor());
    }
}

// Hazelcast provides near-cache (local + distributed)
@Bean
public NearCacheConfig nearCacheConfig() {
    NearCacheConfig nearCache = new NearCacheConfig();
    nearCache.setName("products");
    nearCache.setInMemoryFormat(InMemoryFormat.OBJECT);
    nearCache.setTimeToLiveSeconds(60);
    nearCache.setMaxIdleSeconds(30);
    nearCache.setEvictionConfig(new EvictionConfig()
        .setEvictionPolicy(EvictionPolicy.LRU)
        .setSize(10_000));
    return nearCache;
}
```

### Key Strengths

- **Embedded or Client-Server**: Can run in the same JVM as the application
- **Distributed Computing**: Execute code near the data
- **Native Spring Integration**: First-class Spring Boot support
- **WAN Replication**: Multi-datacenter replication built-in

---

## Redis

### Architecture

Redis is an in-memory data store with rich data structures. Its configuration below sets up serialization, TTLs per cache, and a template for programmatic access.

```java
@Configuration
public class RedisCacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(30))
            .serializeKeysWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new StringRedisSerializer()))
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer()));

        return RedisCacheManager.builder(cf)
            .cacheDefaults(config)
            .withCacheConfiguration("products",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(10)))
            .withCacheConfiguration("sessions",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofHours(2)))
            .build();
    }

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer());
        return template;
    }
}

@Service
public class RedisCacheService {

    private final RedisTemplate<String, Object> redisTemplate;

    public void cacheProduct(Product product) {
        // Rich data structures
        redisTemplate.opsForValue().set(
            "product:" + product.getId(), product, Duration.ofMinutes(30));

        // Also index in a sorted set for querying
        redisTemplate.opsForZSet().add(
            "products:by:price", product.getId().toString(),
            product.getPrice().doubleValue());

        // Add to category set
        redisTemplate.opsForSet().add(
            "category:" + product.getCategoryId(), product.getId().toString());
    }

    public void notifyOnUpdate(Long productId) {
        // Pub/Sub for real-time notifications
        redisTemplate.convertAndSend("product:updates",
            "Product " + productId + " was updated");
    }

    public boolean rateLimit(String userId) {
        // Atomic operations for rate limiting
        String key = "ratelimit:" + userId;
        Long count = redisTemplate.opsForValue().increment(key);
        if (count == 1) {
            redisTemplate.expire(key, Duration.ofMinutes(1));
        }
        return count <= 100;
    }
}
```

### Key Strengths

- **Rich Data Structures**: Strings, hashes, lists, sets, sorted sets, streams
- **High Performance**: Sub-millisecond latency
- **Persistence**: RDB snapshots and AOF logs
- **Ecosystem**: Wide client library support
- **Module System**: Search, JSON, Bloom filters, Time Series

---

## Memcached

### Architecture

Memcached is the simplest of the three: a distributed key-value store with no data structures beyond strings, no clustering, and no persistence. Its strength is raw speed and simplicity.

```java
// Memcached has simpler data model - key/value only
@Configuration
public class MemcachedConfig {

    @Bean
    public MemcachedClient memcachedClient() throws IOException {
        NettyConnectionFactory factory = new NettyConnectionFactory();
        return new MemcachedClient(
            new MemcachedConnectionFactoryBuilder()
                .setProtocol(ConnectionFactoryBuilder.Protocol.BINARY)
                .setLocatorType(ConnectionFactoryBuilder.Locator.CONSISTENT)
                .setHashAlg(DefaultHashAlgorithm.KETAMA_HASH)
                .setDaemon(true)
                .setFailureMode(FailureMode.Redistribute)
                .setTranscoder(new SerializingTranscoder())
                .build(),
            AddrUtil.getAddresses("memcached-1:11211 memcached-2:11211 memcached-3:11211")
        );
    }
}

@Service
public class MemcachedCacheService {

    private final MemcachedClient memcachedClient;

    public void set(String key, Object value, int expirationSeconds) {
        memcachedClient.set(key, expirationSeconds, value);
    }

    public Object get(String key) {
        return memcachedClient.get(key);
    }

    public boolean add(String key, Object value, int expirationSeconds) {
        // Atomic add - only if key doesn't exist
        Future<Boolean> future = memcachedClient.add(key, expirationSeconds, value);
        try {
            return future.get();
        } catch (Exception e) {
            return false;
        }
    }

    public long increment(String key, int by, long defaultValue) {
        try {
            return memcachedClient.incr(key, by, defaultValue);
        } catch (Exception e) {
            return -1;
        }
    }

    public void delete(String key) {
        memcachedClient.delete(key);
    }
}
```

### Key Strengths

- **Simplicity**: Minimal API surface, easy to use
- **Performance**: Very fast for simple operations
- **Memory Efficiency**: Low overhead per key
- **Multi-threaded**: Uses multiple threads for processing
- **Proven**: Battle-tested at massive scale (Facebook, YouTube)

---

## Feature Comparison

| Feature | Hazelcast | Redis | Memcached |
|---------|-----------|-------|-----------|
| Data types | Java objects, maps, queues | Rich structures | Strings, bytes |
| Cluster topology | P2P, client-server | Sentinel, Cluster | Client-side |
| Persistence | Native (map store) | RDB, AOF | None |
| Transactions | Yes | Limited (MULTI/EXEC) | No |
| Locks | Distributed | Redlock | CAS |
| Pub/Sub | Yes | Yes | No |
| Geo queries | No | Yes | No |
| Lua scripting | No | Yes | No |
| Connection count | Unlimited | Configurable | Unlimited |
| Eviction | LRU, LFU, TTL | LRU, LFU, TTL | LRU, TTL |

---

## Performance Comparison

| Operation | Hazelcast | Redis | Memcached |
|-----------|-----------|-------|-----------|
| GET (1KB) | ~200us | ~100us | ~80us |
| SET (1KB) | ~250us | ~120us | ~100us |
| Batch GET (10) | ~500us | ~300us | ~250us |
| Max throughput | 100K ops/s | 500K ops/s | 1M ops/s |
| Network overhead | Higher (Java serialization) | Low | Lowest |

---

## Selection Guide

### Choose Hazelcast When

- You need distributed computing (executors, entry processors)
- Java application with tight integration
- Need near-cache (local caching + distributed)
- WAN replication required
- Embeddable in the application JVM

### Choose Redis When

- Need rich data structures
- Persistence is required
- Need Pub/Sub or streams
- Multi-language ecosystem needed
- Modules needed (Search, JSON, Time Series)

### Choose Memcached When

- Simple key-value caching is sufficient
- Maximum raw performance needed
- Minimal operational complexity
- Data loss is acceptable (cache only)
- Very large scale (thousands of nodes)

---

## Common Mistakes

### Mistake 1: Hazelcast for Simple Caching

```java
// OVERKILL: Hazelcast for simple key-value cache
// Hazelcast's distributed computing features are wasted
// Redis or Memcached would be simpler and faster

// CORRECT: Use the right tool
// Hazelcast for compute + cache
// Redis for data structures + persistence
// Memcached for simple, high-speed caching
```

### Mistake 2: Memcached for Persistent Cache

```java
// WRONG: Using Memcached for data that must survive restarts
// Memcached has no persistence - restart loses everything

// CORRECT: Use Redis with AOF for persistent caching
```

### Mistake 3: Redis for Write-Heavy Workloads

```conf
# WRONG: appendfsync always with high write throughput
# Kills Redis performance

# CORRECT: Use Hazelcast or disable persistence
appendonly no
```

---

## Summary

| Requirement | Best Choice |
|-------------|-------------|
| Simple key-value cache | Memcached |
| Rich data structures | Redis |
| Data persistence | Redis |
| Distributed computing | Hazelcast |
| Java ecosystem | Hazelcast |
| Maximum performance | Memcached |
| Pub/Sub messaging | Redis |
| Multi-datacenter | Hazelcast |

---

## References

- [Hazelcast Documentation](https://docs.hazelcast.com/)
- [Redis Documentation](https://redis.io/documentation)
- [Memcached Wiki](https://github.com/memcached/memcached/wiki)

Happy Coding
