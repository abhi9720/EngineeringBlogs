---
title: "Cache-Aside, Read-Through, Write-Through"
description: "Deep dive into caching patterns: cache-aside, read-through, write-through, write-behind, and their trade-offs"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - caching
  - patterns
  - cache-aside
  - read-through
  - write-through
coverImage: "/images/cache-aside-read-through-write-through.png"
draft: false
---

# Cache-Aside, Read-Through, Write-Through

## Overview

Caching patterns define how applications interact with caches and databases. Choosing the right pattern impacts consistency, performance, and resilience. This guide covers the four primary patterns with implementation details and trade-offs.

### Pattern Comparison

| Pattern | Read Strategy | Write Strategy | Consistency | Complexity |
|---------|--------------|----------------|-------------|------------|
| Cache-Aside | Read cache, miss → DB | Invalidate cache | Eventual | Low |
| Read-Through | Cache reads DB on miss | Invalidate cache | Eventual | Medium |
| Write-Through | Read cache | Write cache + DB | Strong | Medium |
| Write-Behind | Read cache | Write cache, async DB | Eventual | High |

---

## Cache-Aside (Lazy Loading)

### Implementation

Cache-aside is the most intuitive pattern: the application is responsible for both reading from and writing to the cache. On a read, the application checks the cache first (fast path), falling back to the database (slow path) on a miss, then populates the cache for future reads.

```java
@Service
public class CacheAsideService {

    private final RedisTemplate<String, Product> cache;
    private final ProductRepository repository;

    public Product getProduct(Long id) {
        // 1. Try cache first
        String key = "product:" + id;
        Product cached = cache.opsForValue().get(key);

        if (cached != null) {
            log.debug("Cache hit: {}", key);
            return cached;
        }

        // 2. Cache miss - load from database
        log.debug("Cache miss: {}", key);
        Product product = repository.findById(id)
            .orElseThrow(() -> new ProductNotFoundException(id));

        // 3. Populate cache (with TTL)
        cache.opsForValue().set(key, product, Duration.ofMinutes(30));

        return product;
    }

    // Write operation: update database and invalidate cache
    @CacheEvict(value = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        return repository.save(product);
    }

    // Batch read
    public Map<Long, Product> getProducts(List<Long> ids) {
        Map<Long, Product> result = new HashMap<>();
        List<String> keys = ids.stream()
            .map(id -> "product:" + id)
            .toList();

        // Batch cache read
        List<Product> cached = cache.opsForValue().multiGet(keys);
        List<Long> missingIds = new ArrayList<>();

        for (int i = 0; i < ids.size(); i++) {
            Product p = cached.get(i);
            if (p != null) {
                result.put(ids.get(i), p);
            } else {
                missingIds.add(ids.get(i));
            }
        }

        // Batch load missing from DB
        if (!missingIds.isEmpty()) {
            List<Product> fromDb = repository.findAllById(missingIds);
            for (Product p : fromDb) {
                cache.opsForValue().set("product:" + p.getId(), p,
                    Duration.ofMinutes(30));
                result.put(p.getId(), p);
            }
        }

        return result;
    }
}
```

For batch reads, `multiGet` retrieves all cached keys in a single round trip, then the remaining IDs are fetched from the database in one batch query. This minimizes network overhead compared to individual gets.

### Spring Cache-Aside with Annotations

Spring's `@Cacheable` annotation implements cache-aside declaratively. The `unless` condition prevents caching null results. Multiple `@CacheEvict` annotations on delete handle keys from different lookup patterns.

```java
@Service
public class AnnotatedCacheAsideService {

    @Cacheable(value = "products", key = "#id", unless = "#result == null")
    public Product getProduct(Long id) {
        return repository.findById(id)
            .orElse(null);
    }

    @Cacheable(value = "products", key = "#sku", unless = "#result == null")
    public Product getProductBySku(String sku) {
        return repository.findBySku(sku);
    }

    @CacheEvict(value = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        return repository.save(product);
    }

    @Caching(evict = {
        @CacheEvict(value = "products", key = "#product.id"),
        @CacheEvict(value = "products", key = "#product.sku")
    })
    public Product deleteProduct(Product product) {
        repository.delete(product);
        return product;
    }
}
```

---

## Read-Through

### Caffeine Read-Through Cache

Read-through shifts the caching logic to the cache provider. Caffeine's `CacheLoader` is called automatically on a cache miss — the application never directly accesses the database for reads.

```java
@Configuration
public class ReadThroughCacheConfig {

    @Bean
    public Cache<String, Product> productCache(ProductRepository repository) {
        return Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofMinutes(30))
            .recordStats()
            .build(key -> {
                // Read-through: cache loads from DB on miss
                Long id = Long.parseLong(key.replace("product:", ""));
                return repository.findById(id)
                    .orElseThrow(() -> new ProductNotFoundException(id));
            });
    }
}

@Service
public class ReadThroughService {

    private final Cache<String, Product> cache;

    public Product getProduct(Long id) {
        // Cache automatically loads from DB if not present
        return cache.get("product:" + id);
    }

    public Product getProductOrNull(Long id) {
        // Returns null if not in cache and not in DB
        return cache.getIfPresent("product:" + id);
    }

    public void refreshProduct(Long id) {
        // Manually refresh cache entry
        cache.invalidate("product:" + id);
        getProduct(id); // Reloads from DB
    }
}
```

Caffeine's `recordStats()` enables hit rate, miss rate, and load time metrics. This is essential for tuning cache size and TTLs in production.

### Redis Read-Through with Lua Scripting

Redis does not natively support read-through — the cache cannot trigger a database load. Spring's `@Cacheable` with `sync = true` provides read-through-like semantics by synchronizing concurrent cache misses.

```java
// Redis doesn't natively support read-through
// Implement using Spring @Cacheable which provides read-through semantics
@Service
public class RedisReadThroughService {

    @Cacheable(value = "products", key = "#id",
               unless = "#result == null",
               sync = true) // Synchronized loading
    public Product getProduct(Long id) {
        return repository.findById(id).orElse(null);
    }
}
```

---

## Write-Through

### Implementation

Write-through ensures the cache is always synchronized with the database on writes. Every write updates both the database and the cache in the same transaction.

```java
@Service
public class WriteThroughService {

    private final RedisTemplate<String, Product> cache;
    private final ProductRepository repository;

    @Transactional
    public Product saveProduct(Product product) {
        // 1. Save to database
        Product saved = repository.save(product);

        // 2. Write to cache (synchronously)
        String key = "product:" + saved.getId();
        cache.opsForValue().set(key, saved, Duration.ofMinutes(30));

        return saved;
    }

    @CachePut(value = "products", key = "#result.id")
    public Product updateProduct(Product product) {
        // @CachePut writes to cache after method execution
        return repository.save(product);
    }

    // Batch write-through
    @Transactional
    public List<Product> saveAll(List<Product> products) {
        List<Product> saved = repository.saveAll(products);

        // Write all to cache
        Map<String, Product> cacheEntries = new HashMap<>();
        for (Product p : saved) {
            cacheEntries.put("product:" + p.getId(), p);
        }
        cache.opsForValue().multiSet(cacheEntries);

        // Set TTL for all
        for (String key : cacheEntries.keySet()) {
            cache.expire(key, Duration.ofMinutes(30));
        }

        return saved;
    }
}
```

### Write-Through with Write Invalidation

There are two strategies on write: update the cache (write-through) or invalidate it (write-invalidate). Update is better for frequently-read data; invalidation is simpler for infrequently-read data.

```java
@Service
public class WriteThroughInvalidationService {

    // Option 1: Write-through (update cache and DB)
    @CachePut(value = "products", key = "#product.id")
    public Product updateWithPut(Product product) {
        return repository.save(product);
    }

    // Option 2: Write-invalidate (update DB, remove from cache)
    @CacheEvict(value = "products", key = "#product.id")
    public Product updateWithEvict(Product product) {
        return repository.save(product);
    }

    // When to use each:
    // - write-through: Frequently read data, avoid cache miss
    // - write-invalidate: Infrequently read data, simpler
}
```

---

## Write-Behind (Write-Back)

### Implementation

Write-behind provides the fastest write path: data is written to the cache immediately and asynchronously flushed to the database. The trade-off is potential data loss if the cache fails before the flush.

```java
@Service
public class WriteBehindService {

    private final RedisTemplate<String, Product> cache;
    private final ProductRepository repository;
    private final ScheduledExecutorService executor =
        Executors.newSingleThreadScheduledExecutor();
    private final Queue<Product> writeQueue = new ConcurrentLinkedQueue<>();

    @PostConstruct
    public void init() {
        // Flush queue every 5 seconds
        executor.scheduleAtFixedRate(this::flushQueue, 5, 5, TimeUnit.SECONDS);
    }

    public Product saveProduct(Product product) {
        String key = "product:" + product.getId();

        // 1. Write to cache immediately
        cache.opsForValue().set(key, product, Duration.ofMinutes(30));

        // 2. Queue for async database write
        writeQueue.add(product);

        return product;
    }

    private void flushQueue() {
        List<Product> batch = new ArrayList<>();
        Product item;
        while ((item = writeQueue.poll()) != null && batch.size() < 100) {
            batch.add(item);
        }

        if (!batch.isEmpty()) {
            try {
                repository.saveAll(batch);
                log.info("Write-behind flushed {} items", batch.size());
            } catch (Exception e) {
                log.error("Write-behind flush failed, requeuing", e);
                writeQueue.addAll(batch);
            }
        }
    }

    @PreDestroy
    public void shutdown() {
        // Final flush before shutdown
        flushQueue();
        executor.shutdown();
    }
}
```

The `@PreDestroy` hook is critical — it flushes the remaining queue before the application shuts down, preventing data loss during graceful deployments.

---

## Pattern Selection Guide

### Decision Matrix

| Requirement | Recommended Pattern |
|------------|-------------------|
| Read-heavy, cacheable data | Cache-Aside |
| High read throughput, simple | Read-Through |
| Must return stale data on miss | Read-Through |
| Strong consistency needed | Write-Through |
| Highest write throughput | Write-Behind |
| Data can tolerate async writes | Write-Behind |
| First implementation | Cache-Aside |

### Anti-Patterns

```java
// WRONG: Write-around (never invalidating cache)
public Product updateProduct(Product product) {
    return repository.save(product);
    // Cache has stale data until TTL expires!
}

// WRONG: Read-through without invalidation
@Cacheable(value = "products")
public Product getProduct(Long id) {
    return repository.findById(id).orElse(null);
}
// Never invalidated - data grows stale
```

---

## Best Practices

### 1. Handle Cache Stampede

Without synchronization, concurrent cache misses all hit the database. The `sync = true` attribute ensures only one thread loads the data while others wait.

```java
// When 100 concurrent requests miss the cache:
// Without sync: 100 DB queries
// With sync: 1 DB query, 99 wait

@Cacheable(value = "products", key = "#id", sync = true)
public Product getProduct(Long id) {
    return repository.findById(id).orElse(null);
}
```

### 2. Use Appropriate TTLs

Different data types need different TTLs. Reference data can be cached for days, transactional data for minutes.

```java
// Shorter TTL for frequently changing data
// Longer TTL for reference data
// No TTL for immutable data (with eviction policy)

@Configuration
public class TtlConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .withCacheConfiguration("products",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(10)))  // Fast-changing
            .withCacheConfiguration("categories",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofHours(1)))      // Slow-changing
            .withCacheConfiguration("countries",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofDays(7)))       // Reference data
            .build();
    }
}
```

---

## Common Mistakes

### Mistake 1: Inconsistent Invalidation

Multiple write paths where some invalidate the cache and others don't lead to stale data.

```java
// WRONG: Multiple write paths, only some invalidate
public Product save(Product p) { repository.save(p); }
public Product update(Product p) { repository.save(p); cache.evict(...); }
public Product merge(Product p) { repository.save(p); }

// CORRECT: Single write path with consistent invalidation
@CacheEvict(value = "products", key = "#product.id")
public Product saveProduct(Product product) {
    return repository.save(product);
}
```

### Mistake 2: Cache and DB Not in Same Transaction

If the cache write succeeds but the database write fails, the cache contains phantom data.

```java
// WRONG: Cache write succeeds, DB write fails
cache.put(key, product); // Succeeds
repository.save(product); // Fails - cache has phantom data

// CORRECT: DB first, then cache (or use transactional)
@Transactional
public Product save(Product product) {
    Product saved = repository.save(product);
    cache.put("product:" + saved.getId(), saved);
    return saved;
}
```

### Mistake 3: Write-Behind Without Recovery

Without retry logic, a flush failure means permanent data loss.

```java
// WRONG: No retry on write-behind failure
public void flushQueue() {
    repository.saveAll(queue); // If this fails, data is lost
}

// CORRECT: Retry with dead letter queue
public void flushQueue() {
    try {
        repository.saveAll(queue);
        queue.clear();
    } catch (Exception e) {
        log.error("Flush failed, {} items pending", queue.size());
        // Items will be retried on next cycle
    }
}
```

---

## Summary

| Pattern | Best For | Avoid When |
|---------|----------|------------|
| Cache-Aside | General purpose, read-heavy | Strong consistency required |
| Read-Through | Transparent caching | Custom fallback logic needed |
| Write-Through | Strong consistency | Write performance critical |
| Write-Behind | High write throughput | Data loss unacceptable |

Start with Cache-Aside. Move to Write-Through for consistency. Use Write-Behind only when you understand the data loss risks.

---

## References

- [Redis Caching Patterns](https://redis.io/glossary/redis-caching/)
- [AWS Caching Patterns](https://aws.amazon.com/caching/implementation-considerations/)
- [Spring Cache Annotations](https://docs.spring.io/spring-framework/reference/integration/cache/annotations.html)

Happy Coding
