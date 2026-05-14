---
title: Caching with Redis
description: >-
  Master Redis caching in Spring Boot applications, from basic annotations to
  advanced patterns for high-performance systems
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - redis
  - caching
  - performance
coverImage: /images/caching-with-redis.png
draft: false
order: 10
---
# Caching with Redis: Production-Grade Implementation

## Overview

Caching is one of the most effective optimizations for improving application performance. Redis, with its in-memory storage and rich data structures, has become the de facto standard for caching in Spring Boot applications.

However, caching introduces complexity: cache invalidation, serialization, distributed consistency, and monitoring. This guide covers everything from basic Spring Cache annotations to advanced patterns that handle real-world production challenges.

---

## How Spring Cache with Redis Works Internally

### The Cache Abstraction Architecture

Spring provides a cache abstraction that decouples caching from implementation. Redis is just one of many cache stores.

The core `Cache` interface defines the fundamental operations — `get`, `put`, `evict`, and `clear` — while `CacheManager` is responsible for creating and managing named cache instances. At startup, Spring Boot auto-configures a `RedisCacheManager` when it detects Redis on the classpath and the `spring-boot-starter-data-redis` dependency.

The configuration below demonstrates how to customize serialization, set a default TTL, and disable null caching. Using `GenericJackson2JsonRedisSerializer` for values ensures that cached objects are stored as human-readable JSON rather than Java serialization bytes, which prevents deserialization issues when class definitions change.

```java
// Core interfaces
public interface Cache {
    String getName();
    
    Object get(Object key);
    
    <T> T get(Object key, Class<T> type);
    
    <T> T get(Object key, Callable<T> valueLoader);
    
    void put(Object key, Object value);
    
    void evict(Object key);
    
    void clear();
}

public interface CacheManager {
    Cache getCache(String name);
    Collection<String> getCacheNames();
}

// Default configuration
@Configuration
@EnableCaching
public class CacheConfig {
    
    @Bean
    public CacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        // Configure Redis cache with serialization
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(30))  // Default TTL
            .serializeKeysWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new StringRedisSerializer()
                )
            )
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer()
                )
            )
            .disableCachingNullValues();
        
        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(config)
            .transactionAware(true)
            .build();
    }
}
```

Setting `transactionAware(true)` ensures that cache put/evict operations participate in the current Spring-managed transaction. If the transaction rolls back, the cache changes are also rolled back. This prevents the common problem of stale cache entries when a database write fails after a cache update.

### Cache Key Generation

Spring generates cache keys from method parameters using `KeyGenerator`. The default generator uses the method parameters joined by a hyphen, but this can lead to collisions when different parameter types happen to produce the same string representation.

Using explicit SPEL expressions like `#id` or `#user.email` gives precise control over key creation. For more complex keys, combining multiple parameters with delimiters prevents ambiguity. The example below shows both simple key references and a custom `KeyGenerator` implementation that includes the class name and method name to guarantee uniqueness.

```java
// Default key generation: method name + parameters
@Service
public class UserService {
    
    @Cacheable(value = "users", key = "#id")
    public User getUserById(Long id) {
        // Key will be: "users:1", "users:2", etc.
        return userRepository.findById(id);
    }
    
    // SPEL expressions for custom keys
    @Cacheable(value = "users", key = "#user.email")
    public User getUserByEmail(User user) {
        return userRepository.findByEmail(user.getEmail());
    }
    
    // Complex keys
    @Cacheable(value = "userSearch", key = "#name.toLowerCase() + ':' + #page")
    public List<User> searchUsers(String name, int page) {
        return userRepository.search(name, page);
    }
}

// Custom key generator
@Component
public class CustomKeyGenerator implements KeyGenerator {
    
    @Override
    public Object generate(Object target, Method method, Object... params) {
        StringBuilder key = new StringBuilder();
        key.append(target.getClass().getSimpleName()).append(".");
        key.append(method.getName()).append(".");
        
        for (Object param : params) {
            if (param != null) {
                key.append(param.toString()).append(":");
            }
        }
        
        return key.toString();
    }
}
```

A custom `KeyGenerator` is useful when the same cache name is used across multiple services or when you need to guarantee cross-method key uniqueness. Be aware that custom generators add overhead for every cacheable invocation, so keep the key-building logic lightweight.

### The Caching Proxy Mechanism

When you use @Cacheable, Spring creates a proxy around your method. This proxy is generated via AOP: Spring's `BeanPostProcessor` wraps the bean in a JDK dynamic proxy (or CGLIB proxy) that intercepts calls to cache-annotated methods. The simplified interceptor below illustrates the logic flow: build the key, check the cache, return if found, otherwise invoke the target method and store the result.

A critical limitation is that self-invocation — calling a cache-annotated method from within the same class — bypasses the proxy entirely, so caching does not apply. This is a common source of subtle bugs where developers expect caching to work on internal method calls.

```java
// What Spring generates (simplified)
public class CachingInterceptor implements MethodInterceptor {
    
    public Object invoke(MethodInvocation invocation) {
        Method method = invocation.getMethod();
        Cacheable annotation = method.getAnnotation(Cacheable.class);
        
        // Build cache key
        String cacheName = annotation.value()[0];
        Object key = generateKey(annotation.key(), invocation.getArguments());
        
        // Get cache
        Cache cache = cacheManager.getCache(cacheName);
        
        // Check if value is in cache
        ValueWrapper cachedValue = cache.get(key);
        if (cachedValue != null) {
            return cachedValue.get();  // Return cached value
        }
        
        // Call the actual method
        Object result = invocation.proceed();
        
        // Put result in cache
        if (result != null) {
            cache.put(key, result);
        }
        
        return result;
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Product Catalog with TTL

For e-commerce product data that changes occasionally, a TTL-based caching strategy works well. Product details typically change infrequently — price updates, description edits — so a 10-minute TTL provides an excellent balance between freshness and database load reduction.

The configuration below demonstrates per-cache TTL customization. Setting different TTLs for different data types (products, users, categories) lets you match cache duration to each domain's update frequency. The `CaffeineCacheManager` shown here acts as a local L1 cache for highly-frequent data, reducing even the Redis round-trip.

```java
@Service
public class ProductService {
    
    @Autowired
    private ProductRepository productRepository;
    
    // Cache for 10 minutes - product details don't change often
    @Cacheable(value = "products", key = "#productId", 
               condition = "#productId > 0")
    public Product getProduct(Long productId) {
        log.info("Fetching product from database: {}", productId);
        return productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
    }
    
    // Cache with custom TTL using Caffeine
    @Cacheable(value = "featuredProducts", key = "'featured'", 
               cacheManager = "caffeineCacheManager")
    public List<Product> getFeaturedProducts() {
        log.info("Fetching featured products from database");
        return productRepository.findByFeaturedTrue();
    }
}

@Configuration
public class CacheManagersConfig {
    
    // Redis cache manager
    @Bean
    public RedisCacheManager redisCacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .cacheDefaults(RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(10))
                .serializeKeysWith(
                    RedisSerializationContext.SerializationPair.fromSerializer(
                        new StringRedisSerializer()
                    ))
                .serializeValuesWith(
                    RedisSerializationContext.SerializationPair.fromSerializer(
                        new GenericJackson2JsonRedisSerializer()
                    )))
            .withCacheConfiguration("products",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(10)))
            .withCacheConfiguration("users",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(30)))
            .withCacheConfiguration("categories",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofHours(1)))
            .build();
    }
    
    // Caffeine cache manager for local caching
    @Bean
    public CacheManager caffeineCacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .recordStats());
        return cacheManager;
    }
}
```

### Case 2: Cache-Aside Pattern with Redis

The standard pattern for handling cache with database is known as cache-aside (or lazy loading). The application code is responsible for loading data into the cache on demand. When a read request arrives, the application first checks the cache. On a hit, the cached data is returned immediately. On a miss, the data is fetched from the database, stored in the cache, and then returned.

Write operations must invalidate the corresponding cache entries to prevent stale data. The `updateUser` and `deleteUser` methods below delete the cache key directly using `RedisTemplate`, ensuring the next read fetches fresh data from the database.

Cache warming is a proactive strategy where frequently accessed data is preloaded into the cache, typically at application startup or on a scheduled interval. This prevents the initial request storm from hitting the database.

```java
@Service
public class UserCacheService {
    
    @Autowired
    private UserRepository userRepository;
    
    @Autowired
    private RedisTemplate<String, User> redisTemplate;
    
    private static final String USER_CACHE_KEY = "user:";
    
    public User getUserById(Long id) {
        String key = USER_CACHE_KEY + id;
        
        // 1. Check cache
        User cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            log.debug("Cache hit for user: {}", id);
            return cached;
        }
        
        // 2. Cache miss - fetch from database
        log.debug("Cache miss for user: {}", id);
        User user = userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
        
        // 3. Store in cache
        redisTemplate.opsForValue().set(key, user, Duration.ofMinutes(30));
        
        return user;
    }
    
    public void updateUser(User user) {
        userRepository.save(user);
        
        // Invalidate cache
        String key = USER_CACHE_KEY + user.getId();
        redisTemplate.delete(key);
        log.debug("Invalidated cache for user: {}", user.getId());
    }
    
    public void deleteUser(Long id) {
        userRepository.deleteById(id);
        
        // Invalidate cache
        String key = USER_CACHE_KEY + id;
        redisTemplate.delete(key);
    }
    
    // Warm up cache - preload frequently accessed data
    @Scheduled(fixedRate = 3600000)  // Every hour
    public void warmUpCache() {
        log.info("Warming up user cache");
        
        List<User> activeUsers = userRepository.findByActiveTrue();
        
        for (User user : activeUsers) {
            String key = USER_CACHE_KEY + user.getId();
            redisTemplate.opsForValue().set(key, user, Duration.ofMinutes(30));
        }
        
        log.info("Cached {} users", activeUsers.size());
    }
}
```

### Case 3: Multi-Level Caching

Combine local (Caffeine) and distributed (Redis) caches to get the best of both worlds. Local caching provides microsecond-level read latency because data resides in the same JVM heap. Redis provides a shared cache across all application instances, ensuring consistency in a distributed deployment.

The trade-off is cache coherence: different instances may have different local cache states. This pattern works best when data changes infrequently and eventual consistency is acceptable. For strongly consistent scenarios, bypass the local cache or use a cache invalidation mechanism like Redis Pub/Sub.

```java
@Configuration
@EnableCaching
public class MultiLevelCacheConfig {
    
    @Bean
    public CacheManager cacheManager(RedisConnectionFactory cf) {
        // Redis as L2 cache
        return RedisCacheManager.builder(cf)
            .cacheDefaults(RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofMinutes(30))
                .serializeKeysWith(
                    RedisSerializationContext.SerializationPair.fromSerializer(
                        new StringRedisSerializer()))
                .serializeValuesWith(
                    RedisSerializationContext.SerializationPair.fromSerializer(
                        new GenericJackson2JsonRedisSerializer())))
            .transactionAware(true)
            .build();
    }
    
    @Bean
    public KeyGenerator customKeyGenerator() {
        return (target, method, params) -> {
            StringBuilder sb = new StringBuilder();
            sb.append(target.getClass().getName()).append(":");
            sb.append(method.getName()).append(":");
            
            for (Object param : params) {
                if (param != null) {
                    sb.append(param.toString()).append(":");
                }
            }
            
            return sb.toString();
        };
    }
}

@Service
public class ProductCacheService {
    
    @Autowired
    private ProductRepository productRepository;
    
    // L1: Caffeine (local), L2: Redis (distributed)
    @Cacheable(value = "products", key = "#id")
    public Product getProduct(Long id) {
        log.info("Fetching from database: {}", id);
        return productRepository.findById(id).orElse(null);
    }
    
    // Force cache refresh
    @CachePut(value = "products", key = "#result.id")
    public Product refreshProductCache(Product product) {
        return product;
    }
}
```

### Case 4: Conditional Caching

Cache only under certain conditions. Use the `condition` attribute to control whether a method result is cached based on method parameters or the result itself. The `unless` attribute acts as a negative condition: caching occurs unless the condition is true.

This is especially useful for avoiding cache pollution with null values or error sentinels, and for selectively caching high-value data (e.g., premium users) while bypassing the cache for less important results.

```java
@Service
public class ConditionalCacheService {
    
    // Only cache if user is active
    @Cacheable(value = "users", key = "#id", 
               condition = "#result?.active == true")
    public User getActiveUser(Long id) {
        return userRepository.findById(id).orElse(null);
    }
    
    // Cache only for premium users
    @Cacheable(value = "premiumData", key = "#userId",
               condition = "#premium == true")
    public PremiumData getPremiumData(Long userId, boolean premium) {
        return premiumDataRepository.findByUserId(userId);
    }
    
    // Different caches based on result
    @Cacheable(value = "userData", key = "#userId", 
               unless = "#result == null")
    public UserData getUserData(Long userId) {
        return userDataRepository.findByUserId(userId);
    }
}
```

### Case 5: Cache Eviction Patterns

Proper cache invalidation is critical. `@CacheEvict` removes entries from the cache when data changes. You can evict a single key, all entries in a cache, or evict before the method executes (useful when the method itself might read the stale value).

The `@Caching` annotation groups multiple cache operations that must happen atomically. When updating a user, you likely need to evict the user's individual cache entry, the email index cache, and invalidate any search results — all in one declarative annotation.

```java
@Service
public class CacheEvictionService {
    
    // Single key eviction
    @CacheEvict(value = "users", key = "#user.id")
    public User updateUser(User user) {
        return userRepository.save(user);
    }
    
    // Evict all entries in a cache
    @CacheEvict(value = "users", allEntries = true)
    public void clearUserCache() {
        log.info("Cleared all user cache");
    }
    
    // Evict before method executes (useful for put operations)
    @CacheEvict(value = "userSearch", beforeInvocation = true)
    public List<User> searchUsers(String query) {
        return userRepository.search(query);
    }
    
    // Multiple cache operations
    @Caching(evict = {
        @CacheEvict(value = "users", key = "#user.id"),
        @CacheEvict(value = "userEmailIndex", key = "#user.email"),
        @CacheEvict(value = "userSearch", allEntries = true)
    })
    public User saveUser(User user) {
        return userRepository.save(user);
    }
}
```

---

## Trade-offs: When to Use Redis Cache

### Advantages

1. **Distributed caching**: Works across multiple application instances
2. **Rich data structures**: Strings, hashes, lists, sets, sorted sets
3. **TTL support**: Automatic expiration of stale data
4. **Persistence**: Optional persistence for durability
5. **Cluster support**: Horizontal scaling with Redis Cluster

### Disadvantages

1. **Network latency**: Cache operations add network round-trip time
2. **Serialization overhead**: Java serialization is slow, requires optimized serializers
3. **Consistency challenges**: Stale cache vs database synchronization
4. **Memory limitations**: Limited by available RAM

### Decision Matrix

| Scenario | Recommended Approach |
|----------|---------------------|
| Single instance application | Caffeine/Ehcache (local) |
| Multi-instance, simple data | Redis |
| Distributed, complex data | Redis |
| Write-heavy workload | Database first, Redis carefully |
| Read-heavy, stable data | Redis |
| Session storage | Redis |

---

## Production Considerations

### 1. Redis Connection Management

Proper connection pooling and configuration prevents resource exhaustion under load. Lettuce is the recommended Redis client for Spring Boot because it's netty-based and supports reactive, asynchronous, and synchronous communication.

The pool configuration below sets a maximum of 50 connections. Exceeding this causes operations to block or fail, so monitor connection usage in production. Setting command timeout and connection timeout prevents thread starvation when Redis becomes slow or unavailable.

```java
@Configuration
public class RedisConfiguration {
    
    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        LettuceClientConfiguration.LettuceClientConfigurationBuilder builder = 
            LettuceClientConfiguration.builder();
        
        // Connection settings
        builder.useSsl().disable();
        builder.connectTimeout(Duration.ofSeconds(10));
        builder.commandTimeout(Duration.ofSeconds(5));
        
        // Pool configuration
        LettucePoolingClientConfiguration poolConfig = builder
            .poolConfig(PoolConfig.builder()
                .minIdle(5)
                .maxIdle(20)
                .maxTotal(50)
                .build())
            .build();
        
        RedisStandaloneConfiguration redisConfig = new RedisStandaloneConfiguration();
        redisConfig.setHostName("localhost");
        redisConfig.setPort(6379);
        redisConfig.setDatabase(0);
        
        LettuceConnectionFactory factory = new LettuceConnectionFactory(
            redisConfig, poolConfig);
        
        return factory;
    }
    
    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory connectionFactory) {
        
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        
        // Key serializer
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        
        // Value serializer - use Jackson for better performance
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer());
        template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer());
        
        template.afterPropertiesSet();
        
        return template;
    }
}
```

### 2. Serialization Performance

Optimize serialization for better performance. The default JDK serialization is verbose, slow, and fragile when class definitions evolve. Jackson-based JSON serialization is the sweet spot: human-readable, language-independent, and resistant to class changes.

For high-throughput scenarios, consider using `Jackson2JsonRedisSerializer` with a custom `ObjectMapper` that registers `JavaTimeModule` for proper `java.time` type support. For primitive or numeric data, specialized serializers like `GenericToStringSerializer` avoid the overhead of full JSON marshalling.

```java
@Configuration
public class OptimizedRedisConfig {
    
    @Bean
    public RedisTemplate<String, Object> optimizedTemplate(
            RedisConnectionFactory cf) {
        
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(cf);
        
        // JSON serialization with Jackson
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        
        Jackson2JsonRedisSerializer<Object> serializer = 
            new Jackson2JsonRedisSerializer<>(objectMapper, Object.class);
        
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(serializer);
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(serializer);
        
        template.afterPropertiesSet();
        
        return template;
    }
    
    // For primitives, use specific serializers
    @Bean
    public RedisTemplate<String, Long> longTemplate(RedisConnectionFactory cf) {
        RedisTemplate<String, Long> template = new RedisTemplate<>();
        template.setConnectionFactory(cf);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericToStringSerializer<>(Long.class));
        return template;
    }
}
```

### 3. Cache Monitoring

Track cache performance metrics. The straightforward metrics tracked below — keyspace hits, misses, and total commands processed — tell you whether your cache is effective. A low hit rate suggests the wrong data is being cached, TTLs are too short, or cache keys don't align with access patterns.

Integrate these metrics with Prometheus/Grafana or your existing monitoring stack to set up alerts for sudden drops in hit rate, which may indicate a configuration issue or a deployment that changed cache key patterns.

```java
@Configuration
public class CacheMonitoringConfig {
    
    @Bean
    public MeterRegistryCustomizer<MeterRegistry> cacheMetrics() {
        return registry -> {
            registry.config().commonTags("app", "my-app");
        };
    }
}

@Service
public class CacheMonitorService {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    public CacheStats getCacheStats() {
        RedisServerCommands<String, Object> commands = redisTemplate.getConnectionFactory()
            .getConnection().serverCommands();
        
        Map<String, String> info = commands.info("stats");
        
        return CacheStats.builder()
            .totalCommandsProcessed(Long.parseLong(info.getOrDefault("total_commands_processed", "0")))
            .keyspaceHits(Long.parseLong(info.getOrDefault("keyspace_hits", "0")))
            .keyspaceMisses(Long.parseLong(info.getOrDefault("keyspace_misses", "0")))
            .build();
    }
    
    public void logCacheStats() {
        CacheStats stats = getCacheStats();
        
        long total = stats.getKeyspaceHits() + stats.getKeyspaceMisses();
        double hitRate = total > 0 ? (double) stats.getKeyspaceHits() / total : 0;
        
        log.info("Cache stats - Hits: {}, Misses: {}, Hit Rate: {:.2f}%", 
            stats.getKeyspaceHits(), stats.getKeyspaceMisses(), hitRate * 100);
    }
}
```

### 4. Handling Redis Failures

Graceful degradation when Redis is unavailable. A production application must never crash or return errors to users simply because the cache layer is down. The pattern below uses a circuit-breaker-like flag that disables caching when Redis becomes unreachable and periodically probes for recovery.

The key design decision is to catch all Redis-related exceptions at the data access layer and fall back to the database. This ensures availability at the cost of higher latency during Redis outages. The health check scheduled every 30 seconds minimizes the window of unnecessary database load.

```java
@Service
public class ResilientCacheService {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    @Autowired
    private UserRepository userRepository;
    
    private volatile boolean redisAvailable = true;
    
    @PostConstruct
    public void init() {
        // Start health check
        scheduleRedisHealthCheck();
    }
    
    public User getUser(Long id) {
        String key = "user:" + id;
        
        // Try cache first if Redis is available
        if (redisAvailable) {
            try {
                User cached = redisTemplate.opsForValue().get(key);
                if (cached != null) {
                    return cached;
                }
            } catch (Exception e) {
                log.warn("Redis unavailable, falling back to database", e);
                redisAvailable = false;
            }
        }
        
        // Fallback to database
        return userRepository.findById(id).orElse(null);
    }
    
    public void cacheUser(User user) {
        if (!redisAvailable) {
            return;
        }
        
        try {
            String key = "user:" + user.getId();
            redisTemplate.opsForValue().set(key, user, Duration.ofMinutes(30));
        } catch (Exception e) {
            log.warn("Failed to cache user: {}", e.getMessage());
        }
    }
    
    private void scheduleRedisHealthCheck() {
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(() -> {
            try {
                redisTemplate.getConnectionFactory().getConnection().ping();
                redisAvailable = true;
            } catch (Exception e) {
                redisAvailable = false;
            }
        }, 30, 30, TimeUnit.SECONDS);
    }
}
```

### 5. Cache Warming

Preload cache on application startup to avoid the initial burst of cache misses. When an application restarts, the cache is cold — every request hits the database until the cache is populated organically. For read-heavy workloads, this can cause a thundering herd problem where the database is overwhelmed immediately after a restart.

`CommandLineRunner` runs after the application context is fully initialized, making it the ideal hook for cache warming. Focus on the most heavily accessed data — the top products, active users, or configuration values — rather than warming the entire dataset.

```java
@Component
public class CacheWarmingRunner implements CommandLineRunner {
    
    @Autowired
    private ProductService productService;
    
    @Autowired
    private CategoryService categoryService;
    
    @Override
    public void run(String... args) {
        log.info("Starting cache warming...");
        
        // Warm product cache
        List<Product> products = productService.getAllProducts();
        log.info("Warmed product cache with {} items", products.size());
        
        // Warm category cache
        List<Category> categories = categoryService.getAllCategories();
        log.info("Warmed category cache with {} items", categories.size());
        
        log.info("Cache warming complete");
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Handling Null Values

```java
// WRONG: Null caching is enabled by default, but can cause issues
@Service
public class BrokenCacheService {
    
    @Cacheable(value = "users")
    public User findUser(Long id) {
        // Returns null if not found - cached as null!
        return userRepository.findById(id).orElse(null);
    }
    
    // Next call returns cached null - not from DB!
}

// CORRECT: Disable null caching for "not found" scenarios
@Service
public class CorrectCacheService {
    
    @Cacheable(value = "users", unless = "#result == null")
    public User findUser(Long id) {
        return userRepository.findById(id).orElse(null);
    }
}
```

The `unless` attribute ensures that null results are never stored in the cache. Without this, a cache miss for a non-existent entity would cache `null` permanently, making it impossible to "create" that entity later — the create would never be called because the read always returns the cached null.

### Mistake 2: Cache Key Collisions

```java
// WRONG: Default key is method params, may cause collisions
@Service
public class BrokenProductService {
    
    @Cacheable(value = "products")
    public Product getProduct(Long id) {
        return productRepository.findById(id);
    }
    
    // getProduct(1L) and getProduct(1) -> different keys!
    // getProduct(1L) and getProduct(1L, "basic") -> different keys!
}

// CORRECT: Use explicit keys
@Service
public class CorrectProductService {
    
    @Cacheable(value = "products", key = "#id")
    public Product getProduct(Long id) {
        return productRepository.findById(id);
    }
    
    @Cacheable(value = "productVariants", key = "#productId + ':' + #variant")
    public ProductVariant getVariant(Long productId, String variant) {
        return variantRepository.findByProductIdAndVariant(productId, variant);
    }
}
```

The default key generation uses `SimpleKey` which considers all method parameters. This means `getProduct(1L)` and `getProduct(1)` (int vs long) would generate different keys even though they refer to the same entity. Always use explicit keys when you have any ambiguity about parameter types.

### Mistake 3: Updating Without Invalidating

```java
// WRONG: Update doesn't invalidate cache - stale data!
@Service
public class BrokenUserService {
    
    @Cacheable(value = "users", key = "#user.id")
    public User getUser(Long id) {
        return userRepository.findById(id);
    }
    
    public User updateUser(User user) {
        return userRepository.save(user);
        // Cache still has old value!
    }
}

// CORRECT: Invalidate on update
@Service
public class CorrectUserService {
    
    @Cacheable(value = "users", key = "#id")
    public User getUser(Long id) {
        return userRepository.findById(id);
    }
    
    @CacheEvict(value = "users", key = "#user.id")
    public User updateUser(User user) {
        return userRepository.save(user);
    }
}
```

Forgetting to evict the cache on write operations is the most common caching bug. The application continues serving stale data until the TTL expires. A robust strategy is to pair every write method with a corresponding `@CacheEvict` or use `@CachePut` to atomically update the cache.

### Mistake 4: Large Objects Without Compression

```java
// WRONG: Large objects waste memory
@Service
public class BrokenCacheService {
    
    @Cacheable(value = "reports")
    public Report generateReport(String type) {
        // Large report object cached directly
        return reportGenerator.generate(type);
    }
}

// CORRECT: Compress large objects
@Configuration
public class CompressedRedisConfig {
    
    @Bean
    public RedisTemplate<String, Object> compressedTemplate(
            RedisConnectionFactory cf) {
        
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(cf);
        
        // GZIP compression for values
        RedisSerializer<Object> compressedSerializer = 
            new SerializingRedisSerializer(new GzipRedisSerializer(
                new Jackson2JsonRedisSerializer<>(Object.class)));
        
        template.setValueSerializer(compressedSerializer);
        
        return template;
    }
}
```

Caching large objects without compression wastes Redis memory and increases network transfer time. GZIP compression typically achieves 5-10x reduction for JSON data at the cost of some CPU overhead during serialization and deserialization. Benchmark with your actual data to decide whether the CPU trade-off is worthwhile.

### Mistake 5: Not Setting Appropriate TTLs

```java
// WRONG: No TTL - data stays forever, stale data
@Service
public class BrokenConfig {
    
    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .cacheDefaults(RedisCacheConfiguration.defaultCacheConfig()
                // No TTL - data never expires!
            )
            .build();
    }
}

// CORRECT: Set appropriate TTL per cache
@Configuration
public class CorrectCacheConfig {
    
    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory cf) {
        return RedisCacheManager.builder(cf)
            .withCacheConfiguration("users",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(30)))
            .withCacheConfiguration("products",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofMinutes(10)))
            .withCacheConfiguration("config",
                RedisCacheConfiguration.defaultCacheConfig()
                    .entryTtl(Duration.ofHours(1)))
            .build();
    }
}
```

Without TTLs, cache data lives forever. Even data that changes daily accumulates indefinitely, leading to memory exhaustion and serving increasingly stale data. Short TTLs (minutes to hours) force periodic cache refresh and bound memory usage. Use longer TTLs only for reference data that truly never changes.

---

## Summary

Redis caching dramatically improves application performance when implemented correctly. Key takeaways:

1. **Understand cache patterns**: Cache-aside is most common, but choose the right pattern
2. **Handle invalidation properly**: Update operations must invalidate cache
3. **Set appropriate TTLs**: Don't let stale data accumulate
4. **Handle failures gracefully**: Redis failures shouldn't break your app
5. **Monitor performance**: Track hit rates, memory usage, latency

Caching is not a set-it-and-forget-it optimization. It requires ongoing monitoring and tuning as your application evolves.

---

## References

- [Spring Cache Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#cache)
- [Spring Data Redis Documentation](https://docs.spring.io/spring-data/data-redis/docs/current/reference/html/)
- [Redis Documentation](https://redis.io/documentation)
- [Baeldung - Spring Cache Guide](https://www.baeldung.com/spring-cache)

---

Happy Coding
