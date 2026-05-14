---
title: "Caching with Redis"
description: "Master Redis caching in Spring Boot applications, from basic annotations to advanced patterns for high-performance systems"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - redis
  - caching
  - performance
coverImage: "/images/caching-with-redis.png"
draft: false
---

# Caching with Redis: Production-Grade Implementation

## Overview

Caching is one of the most effective optimizations for improving application performance. Redis, with its in-memory storage and rich data structures, has become the de facto standard for caching in Spring Boot applications.

However, caching introduces complexity: cache invalidation, serialization, distributed consistency, and monitoring. This guide covers everything from basic Spring Cache annotations to advanced patterns that handle real-world production challenges.

---

## How Spring Cache with Redis Works Internally

### The Cache Abstraction Architecture

Spring provides a cache abstraction that decouples caching from implementation. Redis is just one of many cache stores:

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

### Cache Key Generation

Spring generates cache keys from method parameters using `KeyGenerator`:

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

### The Caching Proxy Mechanism

When you use @Cacheable, Spring creates a proxy around your method:

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

For e-commerce product data that changes occasionally:

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

The standard pattern for handling cache with database:

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

Combine local (Caffeine) and distributed (Redis) caches:

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

Cache only under certain conditions:

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

Proper cache invalidation is critical:

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

Proper connection pooling and configuration:

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

Optimize serialization for better performance:

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

Track cache performance metrics:

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

Graceful degradation when Redis is unavailable:

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

Preload cache on application startup:

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

Happy Coding 👨‍💻