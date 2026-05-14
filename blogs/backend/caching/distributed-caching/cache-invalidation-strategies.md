---
title: "Cache Invalidation Strategies"
description: "Explore cache invalidation strategies: TTL, write-invalidate, write-update, and handling stale data"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - caching
  - invalidation
  - consistency
coverImage: "/images/cache-invalidation-strategies.png"
draft: false
---

# Cache Invalidation Strategies

## Overview

Cache invalidation is one of the hardest problems in computer science. Choosing the right invalidation strategy determines whether users see stale data, and how consistent the system remains. This guide covers the major invalidation approaches with their trade-offs.

### The Invalidation Challenge

- **TTL-based**: Simple, but accept stale data
- **Write-invalidate**: Remove cache on write, next read loads fresh
- **Write-update**: Update cache on write, always fresh
- **Write-invalidate with delay**: Allow stale reads during propagation

---

## TTL-Based Invalidation

### Implementation

```java
@Service
public class TtlInvalidationService {

    private final RedisTemplate<String, Object> cache;

    // Different TTLs for different data types
    private static final Duration USER_TTL = Duration.ofMinutes(30);
    private static final Duration PRODUCT_TTL = Duration.ofMinutes(10);
    private static final Duration CONFIG_TTL = Duration.ofHours(1);
    private static final Duration STATIC_TTL = Duration.ofDays(7);

    public void setWithTtl(String key, Object value, Duration ttl) {
        cache.opsForValue().set(key, value, ttl);
    }

    public <T> T getWithTtl(String key, Class<T> type) {
        return (T) cache.opsForValue().get(key);
    }

    // TTL with jitter to prevent cache stampede
    public void setWithJitter(String key, Object value, Duration baseTtl) {
        long jitter = ThreadLocalRandom.current()
            .nextLong(-300, 301); // +/- 5 minutes jitter
        Duration ttl = baseTtl.plusSeconds(jitter);
        cache.opsForValue().set(key, value, ttl);
    }

    // Adaptive TTL based on access frequency
    public void setAdaptiveTtl(String key, Object value) {
        Duration baseTtl = PRODUCT_TTL;

        // Extend TTL for frequently accessed items
        String accessKey = "access:" + key;
        Long accessCount = cache.opsForValue().increment(accessKey);

        if (accessCount != null && accessCount > 100) {
            baseTtl = PRODUCT_TTL.multipliedBy(2);
        }

        cache.expire(key, baseTtl);
        cache.expire(accessKey, Duration.ofHours(1));
    }
}
```

---

## Write-Invalidate

### Pattern Implementation

```java
@Service
public class WriteInvalidateService {

    private final RedisTemplate<String, Object> cache;
    private final ProductRepository repository;

    // Read through cache (cache-aside)
    @Cacheable(value = "products", key = "#id")
    public Product getProduct(Long id) {
        return repository.findById(id).orElse(null);
    }

    // Write: invalidate cache, DB is source of truth
    @CacheEvict(value = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        return repository.save(product);
    }

    // Batch invalidation
    @CacheEvict(value = "products", allEntries = true)
    public void refreshAllProducts() {
        log.info("Invalidated all product cache entries");
    }

    // Conditional invalidation
    @Caching(evict = {
        @CacheEvict(value = "products", key = "#product.id"),
        @CacheEvict(value = "products", key = "#product.sku"),
        @CacheEvict(value = "productSearch", allEntries = true)
    })
    public Product saveProduct(Product product) {
        return repository.save(product);
    }
}
```

### Multi-Cache Invalidation

```java
@Service
public class MultiCacheInvalidationService {

    private final RedisTemplate<String, Object> cache;

    public void invalidateUserData(Long userId) {
        // Invalidate all caches related to a user
        String pattern = "user:" + userId + ":*";
        Set<String> keys = cache.keys(pattern);

        if (keys != null && !keys.isEmpty()) {
            cache.delete(keys);
            log.info("Invalidated {} cache entries for user {}", keys.size(), userId);
        }
    }

    // Invalidate with versioning
    public void invalidateWithVersion(String cacheName, int version) {
        // Store version in cache
        cache.opsForValue().set("version:" + cacheName, version);
    }

    public <T> T getWithVersion(String key, String cacheName, Class<T> type) {
        T value = (T) cache.opsForValue().get(key);
        if (value != null) {
            // Check version
            Integer currentVersion = (Integer) cache.opsForValue()
                .get("version:" + cacheName);
            // Invalidate if version doesn't match
            if (currentVersion != null) {
                // Version check logic
            }
        }
        return value;
    }
}
```

---

## Write-Update

### Implementation

```java
@Service
public class WriteUpdateService {

    private final RedisTemplate<String, Product> cache;
    private final ProductRepository repository;

    // Update cache synchronously with database write
    @CachePut(value = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        return repository.save(product);
    }

    // Manual write-update
    @Transactional
    public Product updateWithCache(Product product) {
        // 1. Update database
        Product saved = repository.save(product);

        // 2. Update cache
        String key = "product:" + saved.getId();
        cache.opsForValue().set(key, saved, Duration.ofMinutes(30));

        // 3. Update related caches
        invalidateRelatedCaches(saved);

        return saved;
    }

    private void invalidateRelatedCaches(Product product) {
        // Invalidate search index
        cache.delete("search:category:" + product.getCategoryId());

        // Update category product count
        cache.opsForHash().increment("category:" + product.getCategoryId(),
            "productCount", 1);
    }

    // Partial update (only change specific fields)
    public void updateProductName(Long id, String newName) {
        String key = "product:" + id;

        repository.updateName(id, newName);

        // Read-modify-write for cache
        Product cached = cache.opsForValue().get(key);
        if (cached != null) {
            cached.setName(newName);
            cache.opsForValue().set(key, cached, Duration.ofMinutes(30));
        }
    }
}
```

### Conditional Write-Update

```java
@Service
public class ConditionalWriteUpdateService {

    // Only update cache if newer than cached version
    public void updateIfNewer(String key, Product product, long timestamp) {
        cache.execute((RedisCallback<Boolean>) connection -> {
            byte[] keyBytes = key.getBytes();
            byte[] valueBytes = serialize(product);

            // Lua script: update only if timestamp is newer
            String script = """
                local current = redis.call('GET', KEYS[1])
                if current then
                    local currentTs = cjson.decode(current).timestamp
                    if tonumber(currentTs) >= tonumber(ARGV[1]) then
                        return 0
                    end
                end
                redis.call('SET', KEYS[1], ARGV[2])
                redis.call('EXPIRE', KEYS[1], 1800)
                return 1
                """;

            return connection.eval(script.getBytes(),
                ReturnType.BOOLEAN, 1, keyBytes,
                String.valueOf(timestamp).getBytes(), valueBytes);
        });
    }

    private byte[] serialize(Object obj) {
        try {
            return new ObjectMapper().writeValueAsBytes(obj);
        } catch (Exception e) {
            throw new RuntimeException("Serialization failed", e);
        }
    }
}
```

---

## Scheduled Invalidation

```java
@Component
public class ScheduledInvalidationService {

    private final RedisTemplate<String, Object> cache;

    // Periodic full cache refresh
    @Scheduled(cron = "0 0 3 * * ?") // 3 AM daily
    public void refreshProductCache() {
        log.info("Starting scheduled product cache refresh");

        Set<String> productKeys = cache.keys("product:*");
        if (productKeys != null) {
            cache.delete(productKeys);
            log.info("Cleared {} product cache entries", productKeys.size());
        }

        // Warm up cache with popular products
        warmupPopularProducts();
    }

    @Scheduled(fixedRate = 300_000) // Every 5 minutes
    public void refreshConfigCache() {
        cache.delete("config:*");
        log.info("Refreshed configuration cache");
    }

    private void warmupPopularProducts() {
        List<Product> popular = productRepository.findPopularProducts(100);
        for (Product product : popular) {
            cache.opsForValue().set(
                "product:" + product.getId(),
                product,
                Duration.ofMinutes(30)
            );
        }
        log.info("Warmed up {} popular products", popular.size());
    }
}
```

---

## Invalidation Strategies Comparison

| Strategy | Staleness Window | Write Latency | Read After Write | Complexity |
|----------|-----------------|---------------|------------------|------------|
| TTL | TTL duration | Low | May see stale | Low |
| Write-Invalidate | Until next read | Low | Always fresh on read | Low |
| Write-Update | None | Medium | Always fresh | Medium |
| Scheduler | Schedule interval | None | May see stale | Medium |

---

## Best Practices

### 1. Use a Hybrid Approach

```java
// Combine TTL with write-invalidate for defense in depth
// TTL as safety net for missed invalidations

@Configuration
public class HybridInvalidationConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .cacheDefaults(RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(30)) // TTL safety net
                .disableCachingNullValues())
            .build();
    }
}
```

### 2. Log Invalidation Events

```java
@CacheEvict(value = "products", key = "#product.id")
public Product saveProduct(Product product) {
    log.info("Invalidating cache for product: {}", product.getId());
    return repository.save(product);
}
```

### 3. Monitor Invalidation Health

```java
@Component
public class InvalidationMetrics {

    private final MeterRegistry registry;

    public void recordInvalidation(String cacheName, String strategy) {
        Counter.builder("cache.invalidation")
            .tag("cache", cacheName)
            .tag("strategy", strategy)
            .register(registry)
            .increment();
    }
}
```

---

## Common Mistakes

### Mistake 1: No TTL Safety Net

```java
// WRONG: No TTL, only write-invalidate
// If invalidation is missed, data is stale forever
@CacheEvict(value = "products", key = "#id")
public Product update(Long id) { ... }

// CORRECT: TTL as safety net
@CacheEvict(value = "products", key = "#id")
@Cacheable(value = "products", key = "#id")
public Product get(Long id) { ... }
// TTL: 30 minutes
```

### Mistake 2: Invalidating Too Aggressively

```java
// WRONG: Invalidating entire cache for a single change
@CacheEvict(value = "products", allEntries = true)
public Product updateOneProduct(Product product) {
    return repository.save(product);
    // Clears cache for ALL products!
}

// CORRECT: Target specific entry
@CacheEvict(value = "products", key = "#product.id")
public Product updateOneProduct(Product product) {
    return repository.save(product);
}
```

### Mistake 3: Not Invalidating Related Caches

```java
// WRONG: Only invalidating direct cache
@CacheEvict(value = "products", key = "#product.id")
public Product updatePrice(Product product) {
    return repository.save(product);
    // Search cache still has old price
}

// CORRECT: Invalidate all affected caches
@Caching(evict = {
    @CacheEvict(value = "products", key = "#product.id"),
    @CacheEvict(value = "productSearch", allEntries = true),
    @CacheEvict(value = "categoryProducts", key = "#product.categoryId")
})
public Product updatePrice(Product product) {
    return repository.save(product);
}
```

---

## Summary

1. **TTL**: Simple, always add as safety net
2. **Write-Invalidate**: Most common, good balance
3. **Write-Update**: Strong consistency, more expensive
4. **Scheduled**: Good for reference data
5. **Hybrid**: TTL + invalidation for defense in depth
6. **Monitor**: Track invalidation rates and cache hit rates

---

## References

- [Redis Cache Invalidation](https://redis.io/glossary/cache-invalidation/)
- [AWS Caching Invalidation](https://aws.amazon.com/caching/invalidation/)
- [Consistency Patterns](https://www.dragonflydb.io/guides/cache-invalidation-strategies)

Happy Coding