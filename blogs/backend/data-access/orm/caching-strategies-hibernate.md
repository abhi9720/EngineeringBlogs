---
title: "Caching Strategies in Hibernate"
description: "Master Hibernate caching: first-level cache, second-level cache, query cache, cache regions, Ehcache/Redis configuration, and performance optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - hibernate
  - caching
  - performance
  - jpa
coverImage: "/images/backend/data-access/orm/caching-strategies-hibernate.png"
draft: false
---

# Caching Strategies in Hibernate

## Overview

Hibernate provides a multi-level caching architecture to reduce database load and improve application performance. The first-level cache is mandatory and operates at the session level. The second-level cache is optional, configurable, and shared across sessions. The query cache caches query results. Understanding these levels and their configuration is essential for production optimization.

---

## First-Level Cache (Persistence Context)

### How L1 Cache Works

```java
@Service
public class FirstLevelCacheDemo {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public void demonstrateL1Cache() {
        // First call - loads from database
        Product product1 = entityManager.find(Product.class, 1L);
        // SQL: SELECT * FROM products WHERE id = 1

        // Second call - loads from persistence context (L1 cache)
        Product product2 = entityManager.find(Product.class, 1L);
        // No SQL executed!

        // Same instance returned (identity map)
        assert product1 == product2;

        log.info("Same instance: {}", product1 == product2);
    }

    @Transactional
    public void L1CacheAndDirtyChecking() {
        Product product = entityManager.find(Product.class, 1L);
        // Loaded into L1 cache

        product.setPrice(new BigDecimal("49.99"));
        // Modified in L1 cache

        Product sameProduct = entityManager.find(Product.class, 1L);
        // Returns cached instance - sees the modification

        entityManager.flush();
        // Dirty checking detects modification
        // Generates UPDATE
    }

    @Transactional
    public void clearingL1Cache() {
        List<Product> products = entityManager.createQuery(
            "SELECT p FROM Product p", Product.class)
            .getResultList();

        // Process first batch
        for (int i = 0; i < 50; i++) {
            Product p = products.get(i);
            p.setViewed(true);
        }

        entityManager.flush();
        entityManager.clear();  // Clear L1 cache to free memory

        // After clear, next find will hit database
        Product product = entityManager.find(Product.class, 100L);
        // New SQL query executed
    }
}
```

### L1 Cache Best Practices

```java
// L1 cache scope: Session/EntityManager
// - EntityManager.find() checks L1 first
// - JPQL queries do NOT use L1 cache (bypass it)
// - L1 cache cannot be disabled
//
// Manage L1 cache:
// - clear(): Detach all entities
// - detach(entity): Detach specific entity
// - contains(entity): Check if entity is in L1

@Transactional
public void efficientBatchProcessing() {
    for (int i = 0; i < 1000; i++) {
        Order order = new Order();
        order.setOrderNumber("ORD-" + i);
        entityManager.persist(order);

        // Periodically flush and clear to prevent OOM
        if (i % 50 == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }
}
```

---

## Second-Level Cache (L2 Cache)

### Configuration with Ehcache

```java
@Configuration
public class L2CacheConfig {

    @Bean
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(
            DataSource dataSource) {

        LocalContainerEntityManagerFactoryBean emf = new LocalContainerEntityManagerFactoryBean();
        emf.setDataSource(dataSource);
        emf.setPackagesToScan("com.example.entity");

        Properties properties = new Properties();
        properties.put("hibernate.cache.use_second_level_cache", true);
        properties.put("hibernate.cache.region.factory_class",
            "jcache");
        properties.put("hibernate.cache.jcache.provider",
            "org.ehcache.jsr107.EhcacheCachingProvider");
        properties.put("hibernate.cache.jcache.missing_cache_strategy", "create");
        properties.put("hibernate.generate_statistics", true);
        properties.put("hibernate.cache.use_query_cache", true);

        emf.setJpaProperties(properties);
        return emf;
    }
}

// ehcache.xml configuration
// <config xmlns="http://www.ehcache.org/v3">
//     <cache alias="products">
//         <key-type>java.lang.Long</key-type>
//         <value-type>com.example.entity.Product</value-type>
//         <expiry>
//             <ttl unit="minutes">30</ttl>
//         </expiry>
//         <resources>
//             <heap unit="entries">1000</heap>
//             <offheap unit="MB">50</offheap>
//         </resources>
//     </cache>
//     <cache alias="com.example.entity.Product">
//         <expiry>
//             <ttl unit="minutes">60</ttl>
//         </expiry>
//         <resources>
//             <heap unit="entries">5000</heap>
//         </resources>
//     </cache>
// </config>
```

### Entity Caching

```java
@Entity
@Cacheable  // Enable L2 caching for this entity
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "products")
public class Product {

    @Id
    @GeneratedValue
    private Long id;

    private String name;

    private BigDecimal price;

    // Collections can also be cached
    @OneToMany(mappedBy = "product", fetch = FetchType.LAZY)
    @Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "product.reviews")
    private List<Review> reviews;

    // Cache concurrency strategies:
    // NONE: No caching
    // READ_ONLY: For immutable entities (best performance)
    // NONSTRICT_READ_WRITE: Relaxed locking
    // READ_WRITE: Pessimistic locking (soft locks)
    // TRANSACTIONAL: Full transaction isolation (needs JTA)
}

// READ_ONLY - Best performance, for reference data
@Entity
@Cacheable
@Cache(usage = CacheConcurrencyStrategy.READ_ONLY, region = "reference-data")
public class Country {
    @Id
    private String code;
    private String name;
    private String phonePrefix;
}

// READ_WRITE - Good for frequently read, occasionally updated
@Entity
@Cacheable
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "products")
public class Product {
    // ...
}
```

### L2 Cache Monitoring

```java
@Service
public class L2CacheMonitor {

    @PersistenceContext
    private EntityManager entityManager;

    public CacheStats getCacheStatistics() {
        SessionFactory sessionFactory = entityManager.getEntityManagerFactory()
            .unwrap(SessionFactory.class);

        Statistics statistics = sessionFactory.getStatistics();

        CacheStats stats = new CacheStats();
        stats.setL2CacheHitCount(statistics.getSecondLevelCacheHitCount());
        stats.setL2CacheMissCount(statistics.getSecondLevelCacheMissCount());
        stats.setL2CachePutCount(statistics.getSecondLevelCachePutCount());

        // Calculate hit ratio
        long totalQueries = stats.getL2CacheHitCount() + stats.getL2CacheMissCount();
        if (totalQueries > 0) {
            stats.setL2CacheHitRatio(
                (double) stats.getL2CacheHitCount() / totalQueries);
        }

        // Per-region statistics
        Map<String, CacheRegionStats> regionStats = new HashMap<>();
        for (String region : statistics.getSecondLevelCacheRegionNames()) {
            CacheRegionStatistics regionStats = statistics
                .getDomainDataRegionStatistics(region);

            CacheRegionStats rStats = new CacheRegionStats();
            rStats.setRegionName(region);
            rStats.setHitCount(regionStats.getHitCount());
            rStats.setMissCount(regionStats.getMissCount());
            rStats.setPutCount(regionStats.getPutCount());
            rStats.setElementCount(regionStats.getElementCountInMemory());

            regionStats.put(region, rStats);
        }
        stats.setRegionStats(regionStats);

        return stats;
    }
}
```

---

## Query Cache

### Configuring Query Cache

```java
@Service
public class QueryCacheDemo {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public List<Product> getActiveProducts() {
        TypedQuery<Product> query = entityManager.createQuery(
            "SELECT p FROM Product p WHERE p.active = :active",
            Product.class);

        query.setParameter("active", true);
        query.setHint("org.hibernate.cacheable", true);
        query.setHint("org.hibernate.cacheRegion", "product-search");

        // First execution: hits database, caches result IDs
        // Second execution: uses cached IDs, then checks L2 cache for each entity
        // Requires entities to also be cached in L2

        return query.getResultList();
    }

    @Transactional(readOnly = true)
    public List<Product> searchByName(String name) {
        TypedQuery<Product> query = entityManager.createQuery(
            "SELECT p FROM Product p WHERE LOWER(p.name) LIKE :name",
            Product.class);

        return query
            .setParameter("name", "%" + name.toLowerCase() + "%")
            .setHint("org.hibernate.cacheable", true)
            .setHint("org.hibernate.cacheRegion", "product-search")
            .getResultList();

        // Query caches are invalidated when any entity in the result is modified
        // Therefore, high-write entities should not use query cache
    }

    // Natural ID caching
    @Transactional(readOnly = true)
    public Product findBySku(String sku) {
        // Uses natural ID cache (separate from L2 entity cache)
        return entityManager
            .unwrap(Session.class)
            .bySimpleNaturalId(Product.class)
            .load(sku);
    }
}
```

---

## Redis as L2 Cache

### Redis Cache Region Factory

```java
@Configuration
@Profile("redis-cache")
public class RedisL2CacheConfig {

    @Bean
    public LocalContainerEntityManagerFactoryBean redisCachedEmf(
            DataSource dataSource,
            RedisCacheManager cacheManager) {

        LocalContainerEntityManagerFactoryBean emf = new LocalContainerEntityManagerFactoryBean();
        emf.setDataSource(dataSource);
        emf.setPackagesToScan("com.example.entity");

        Properties properties = new Properties();
        properties.put("hibernate.cache.use_second_level_cache", true);
        properties.put("hibernate.cache.region.factory_class",
            "com.example.cache.RedisRegionFactory");
        properties.put("hibernate.cache.use_query_cache", true);
        properties.put("hibernate.cache.region_prefix", "hibernate");
        properties.put("hibernate.generate_statistics", true);

        // Redis-specific TTL settings per region
        properties.put("hibernate.cache.redis.default_ttl", 3600);
        properties.put("hibernate.cache.redis.product_ttl", 1800);
        properties.put("hibernate.cache.redis.reference_ttl", 86400);

        emf.setJpaProperties(properties);
        return emf;
    }
}

@Component
public class RedisRegionFactory implements RegionFactory {

    private final RedisTemplate<String, Object> redisTemplate;
    private final CacheManager cacheManager;

    public RedisRegionFactory(RedisTemplate<String, Object> redisTemplate,
                              CacheManager cacheManager) {
        this.redisTemplate = redisTemplate;
        this.cacheManager = cacheManager;
    }

    @Override
    public DomainDataRegion buildDomainDataRegion(
            String regionName, DomainDataRegionConfig config,
            DomainDataStorageAccess domainDataStorageAccess) {

        return new RedisDomainDataRegion(regionName, redisTemplate,
            getTTLForRegion(regionName));
    }

    private Duration getTTLForRegion(String regionName) {
        if (regionName.contains("reference")) return Duration.ofHours(24);
        if (regionName.contains("product")) return Duration.ofMinutes(30);
        return Duration.ofHours(1);
    }
}
```

---

## Best Practices

1. **Use READ_ONLY for reference data**: Countries, status codes, config
2. **Use READ_WRITE for frequently read entities**: Products, categories
3. **Enable query cache carefully**: Only for read-mostly, stable data
4. **Monitor cache hit ratios**: Target >80% for effective caching
5. **Size cache regions appropriately**: Not too small, not too large
6. **Set TTL for cache entries**: Prevent stale data
7. **Use natural ID caching**: For business key lookups
8. **Disable L2 cache in dev/test**: Avoid stale data issues
9. **Warm cache on application startup**: Load reference data
10. **Evict cache on data changes**: Manual eviction when needed

```java
// Manual cache eviction
@Service
public class CacheEvictionService {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public void evictProductCache(Long productId) {
        Session session = entityManager.unwrap(Session.class);
        session.getSessionFactory().getCache()
            .evictEntityData(Product.class, productId);
    }

    @Transactional
    public void evictRegion(String regionName) {
        Session session = entityManager.unwrap(Session.class);
        session.getSessionFactory().getCache()
            .evictDomainDataRegion(regionName);
    }

    @Transactional
    public void evictAll() {
        Session session = entityManager.unwrap(Session.class);
        session.getSessionFactory().getCache()
            .evictAllRegions();
    }
}
```

---

## Common Mistakes

### Mistake 1: Caching Everything

```java
// WRONG: Caching frequently updated entities
@Entity
@Cacheable
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class Order {
    // Orders change frequently - cache invalidation overhead
}

// CORRECT: Cache reference data, not transactional data
```

### Mistake 2: Query Cache Without L2 Entity Cache

```java
// WRONG: Query cache enabled but entities not cached
// Query cache stores only entity IDs
// Each query result still hits database for entity data

// CORRECT: Enable both L2 entity cache and query cache
```

### Mistake 3: Ignoring Cache Invalidation

```java
// WRONG: Direct database updates bypass cache
jdbcTemplate.update("UPDATE products SET price = ? WHERE id = ?",
    newPrice, productId);
// L2 cache still has old price!

// CORRECT: Use Hibernate for updates, or evict cache manually
```

---

## Summary

1. L1 cache: Session-scoped, mandatory, identity map for managed entities
2. L2 cache: SessionFactory-scoped, optional, shared across sessions
3. Query cache: Caches query result IDs, requires L2 entity cache
4. Cache concurrency: READ_ONLY > READ_WRITE > NONSTRICT_READ_WRITE > TRANSACTIONAL
5. Cache regions: Logical groupings for TTL and sizing
6. Monitor hit ratios to validate cache effectiveness
7. Evict cache when data changes outside Hibernate
8. Don't cache frequently updated entities
9. Warm cache on startup for reference data
10. Test cache behavior under load

---

## References

- [Hibernate Caching Guide](https://docs.jboss.org/hibernate/orm/6.2/userguide/html_single/Hibernate_User_Guide.html#caching)
- [Ehcache Documentation](https://www.ehcache.org/documentation/)
- [Hibernate JCache Support](https://docs.jboss.org/hibernate/orm/6.2/userguide/html_single/Hibernate_User_Guide.html#jcache)
- [Redis Caching Patterns](https://redis.io/docs/manual/patterns/)

Happy Coding