---
title: Caching Strategies Overview
description: >-
  Comprehensive overview of caching strategies: cache-aside, read-through,
  write-through, and hybrid approaches for backend systems
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - caching
  - performance
  - architecture
coverImage: /images/caching-strategies-overview.png
draft: false
order: 10
---
# Caching Strategies Overview

## Overview

Caching is the most effective performance optimization in backend systems. A well-designed cache reduces database load, decreases response latency, and improves system throughput. However, caching introduces complexity around consistency, invalidation, and failure modes.

This overview covers the fundamental caching strategies, when to use each, and how they impact system behavior.

### Why Cache?

| Metric | Without Cache | With Cache | Improvement |
|--------|--------------|------------|-------------|
| Response time (p95) | 200ms | 5ms | 40x |
| Database queries/sec | 10,000 | 500 | 20x |
| Infrastructure cost | High | Lower | 3-5x |

---

## Caching Strategy Patterns

### 1. Cache-Aside (Lazy Loading)

The application reads from cache first, and only loads from the database on a miss. This is the most widely used pattern because it is simple, resilient, and handles cache failures gracefully — if the cache is down, the application falls back to the database naturally.

```java
@Service
public class CacheAsideService {

    private final RedisTemplate<String, Product> redisTemplate;
    private final ProductRepository productRepository;

    public Product getProduct(Long id) {
        String key = "product:" + id;

        Product cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            return cached;
        }

        Product product = productRepository.findById(id)
            .orElseThrow(() -> new ProductNotFoundException(id));

        redisTemplate.opsForValue().set(key, product, Duration.ofMinutes(30));

        return product;
    }

    @CacheEvict(value = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        return productRepository.save(product);
    }
}
```

**Pros**: Simple, handles cache failures gracefully, only caches what is requested.
**Cons**: Cache miss penalty (three round trips), stale data until invalidation.

The cache miss penalty is three network hops: one to check cache, one to query the database (if miss), and one to populate the cache. For read-heavy workloads with high cache hit rates (>90%), this penalty is negligible.

### 2. Read-Through

The cache layer itself loads data from the database on a miss. This is transparent to the application code — the service simply calls the cache and the cache handles the rest.

```java
@Configuration
public class ReadThroughCacheConfig {

    @Bean
    public CacheManager readThroughCacheManager(RedisConnectionFactory cf) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(30));

        return RedisCacheManager.builder(cf)
            .cacheDefaults(config)
            .build();
    }
}

// Spring's @Cacheable implements read-through
@Service
public class ProductService {

    @Cacheable(value = "products", key = "#id")
    public Product getProduct(Long id) {
        return productRepository.findById(id)
            .orElseThrow(() -> new ProductNotFoundException(id));
    }
}
```

**Pros**: Transparent to application code, consistent behavior.
**Cons**: Cache provider must support read-through, less control over fallback.

Spring's `@Cacheable` annotation provides read-through semantics — the first invocation loads from the database and caches the result; subsequent invocations return the cached value. The `sync` attribute can prevent concurrent cache misses (cache stampede).

### 3. Write-Through

Data is written to cache first, then synchronously to the database. This ensures the cache is always up-to-date at the cost of increased write latency.

```java
// Redis with write-through via Spring
@Service
public class WriteThroughService {

    @CachePut(value = "products", key = "#product.id")
    public Product saveProduct(Product product) {
        return productRepository.save(product);
        // Return value is cached automatically
    }
}

// Manual write-through implementation
@Service
public class ManualWriteThroughService {

    public Product saveProduct(Product product) {
        Product saved = productRepository.save(product);

        String key = "product:" + saved.getId();
        redisTemplate.opsForValue().set(key, saved, Duration.ofMinutes(30));

        return saved;
    }
}
```

**Pros**: Cache is always up-to-date, no stale reads.
**Cons**: Write latency increases, cache failure breaks writes.

Write-through is ideal when read-after-write consistency is critical — for example, after updating a user's profile, the next read must return the new data. The trade-off is that every write waits for both cache and database updates.

### 4. Write-Behind (Write-Back)

Data is written to cache, then asynchronously persisted to the database. This provides the fastest write performance at the cost of potential data loss.

```java
@Service
public class WriteBehindService {

    private final RedisTemplate<String, Product> redisTemplate;
    private final ProductRepository productRepository;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();

    public Product saveProduct(Product product) {
        String key = "product:" + product.getId();
        redisTemplate.opsForValue().set(key, product, Duration.ofMinutes(30));

        executor.schedule(() -> {
            productRepository.save(product);
        }, 100, TimeUnit.MILLISECONDS);

        return product;
    }
}
```

**Pros**: Very fast writes, buffers database load.
**Cons**: Potential data loss on cache failure, complex consistency.

Write-behind is suitable for use cases like page view counters or analytics events where losing a few data points is acceptable. Production implementations should include a persistent write queue with retry and dead-letter mechanisms.

---

## Strategy Comparison

| Strategy | Read Latency | Write Latency | Consistency | Complexity |
|----------|-------------|--------------|-------------|------------|
| Cache-Aside | Low (hit), Medium (miss) | Low | Eventual | Low |
| Read-Through | Low (hit), Medium (miss) | Low | Eventual | Medium |
| Write-Through | Low | Medium | Strong | Low |
| Write-Behind | Low | Very Low | Eventual | High |

---

## Multi-Tier Caching

Combining a local (L1) cache with a distributed (L2) cache provides the best of both worlds: the speed of in-process memory + the capacity and sharing of a distributed cache.

```java
@Configuration
public class MultiTierCacheConfig {

    @Bean
    public CacheManager localCacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .recordStats());
        return cacheManager;
    }

    @Bean
    public CacheManager distributedCacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .cacheDefaults(RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(30)))
            .build();
    }
}

@Service
public class MultiTierService {

    @Cacheable(value = "products", cacheManager = "localCacheManager")
    @Cacheable(value = "products", cacheManager = "distributedCacheManager")
    public Product getProduct(Long id) {
        return productRepository.findById(id).orElse(null);
    }
}
```

The L1 cache (Caffeine) provides microsecond latency for hot data. The L2 cache (Redis) provides shared capacity across application instances. On a cache miss, L1 is checked first, then L2, then the database.

---

## Cache Eviction Policies

| Policy | Description | Use Case |
|--------|------------|----------|
| TTL | Expire after fixed time | Stale data acceptable |
| LRU | Evict least recently used | Memory-constrained |
| LFU | Evict least frequently used | Access patterns skewed |
| FIFO | Evict oldest first | Simple, uniform access |

```java
// Configuring eviction with TTL
@Configuration
public class EvictionConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .withCacheConfiguration("products",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(10)))
            .withCacheConfiguration("categories",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofHours(1)))
            .withCacheConfiguration("static-data",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofDays(7)))
            .build();
    }
}
```

TTL-based eviction is the simplest: data expires after a fixed duration regardless of access patterns. LRU is common for memory-constrained caches — when the cache is full, the least recently accessed entry is evicted. LFU is better for skewed access patterns where a small set of keys gets most requests.

---

## Common Mistakes

### Mistake 1: Using Cache as Primary Data Store

A cache is not a database. If the cache is the only copy of data, clearing the cache or a restart causes permanent data loss.

```java
// WRONG: Cache as source of truth
@Service
public class WrongService {

    public Order getOrder(Long id) {
        String key = "order:" + id;
        return redisTemplate.opsForValue().get(key);
        // If cache is cleared, data is lost
    }

    public void saveOrder(Order order) {
        redisTemplate.opsForValue().set("order:" + order.getId(), order);
        // Never persisted to database!
    }
}

// CORRECT: Database as source of truth
@Service
public class CorrectService {

    @Cacheable(value = "orders", key = "#id")
    public Order getOrder(Long id) {
        return orderRepository.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
    }
}
```

### Mistake 2: Ignoring Cache Stampede

When a popular cache key expires, hundreds of concurrent requests may hit the database simultaneously, overwhelming it.

```java
// WRONG: Multiple concurrent misses overload the database
@Cacheable(value = "products", key = "#id")
public Product getProduct(Long id) {
    return productRepository.findById(id).orElse(null);
    // 100 concurrent requests for a new product all hit the database
}

// CORRECT: Use locking or hedging
@Component
public class StampedePreventionService {

    private final Cache<String, Product> cache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(30))
        .build(key -> loadFromDatabase(key));
    // Caffeine handles concurrent loads internally

    public Product getProduct(Long id) {
        return cache.get("product:" + id);
    }
}
```

### Mistake 3: Caching Without Invalidation Strategy

Writing to the database without invalidating or updating the cache leaves stale data until the TTL expires.

```java
// WRONG: Write without cache invalidation
public Product updateProduct(Product product) {
    return productRepository.save(product);
    // Cache still has old data!
}

// CORRECT: Invalidate on write
@CacheEvict(value = "products", key = "#product.id")
public Product updateProduct(Product product) {
    return productRepository.save(product);
}
```

---

## Summary

Choosing the right caching strategy depends on your read/write ratio, consistency requirements, and failure tolerance:

1. **Cache-Aside**: Best for most use cases, simple and resilient
2. **Read-Through**: Good when cache provider handles loading
3. **Write-Through**: Needed for strong consistency
4. **Write-Behind**: Maximum write performance at consistency cost

Always instrument cache hit rates, set appropriate TTLs, handle cache failures gracefully, and never use cache as a primary data store.

---

## References

- [Redis Caching Patterns](https://redis.io/glossary/redis-caching/)
- [AWS Caching Best Practices](https://aws.amazon.com/caching/best-practices/)
- [Spring Cache Abstraction](https://docs.spring.io/spring-framework/reference/integration/cache.html)
- [Caffeine Cache Library](https://github.com/ben-manes/caffeine)

Happy Coding
