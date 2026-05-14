---
title: "Caching Strategies Overview"
description: "Comprehensive overview of caching strategies: cache-aside, read-through, write-through, and hybrid approaches for backend systems"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - caching
  - performance
  - architecture
coverImage: "/images/caching-strategies-overview.png"
draft: false
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

The application reads from cache first, and only loads from the database on a miss:

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

### 2. Read-Through

The cache layer itself loads data from the database on a miss:

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

### 3. Write-Through

Data is written to cache first, then synchronously to the database:

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

### 4. Write-Behind (Write-Back)

Data is written to cache, then asynchronously persisted to the database:

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

Combine local (L1) and distributed (L2) caches for optimal performance:

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

---

## Common Mistakes

### Mistake 1: Using Cache as Primary Data Store

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