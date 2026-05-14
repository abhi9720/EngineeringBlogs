---
title: "Spring Data JPA Basics"
description: "Master Spring Data JPA from repositories to custom queries, understanding how Hibernate integrates with Spring"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - jpa
  - hibernate
  - database
coverImage: "/images/spring-data-jpa-basics.png"
draft: false
---

# Spring Data JPA: The Complete Production Guide

## Overview

Spring Data JPA dramatically reduces the boilerplate required for data access in Spring applications. By providing a repository abstraction that automatically implements data access logic based on method naming conventions, it allows developers to focus on business logic rather than persistence details.

However, using Spring Data JPA effectively requires understanding what's happening under the hood. Without this understanding, you'll encounter performance issues, N+1 queries, transaction problems, and subtle bugs that are difficult to diagnose.

This guide teaches you how Spring Data JPA actually works, when to use its built-in features versus custom implementations, and how to avoid common pitfalls.

---

## How Spring Data JPA Works Internally

### Repository Abstraction Architecture

When you define a repository interface extending `JpaRepository`, Spring Data generates a proxy implementation at runtime. This proxy translates method calls into JPA operations. The proxy is created by `JpaRepositoryFactoryBean`, which uses a `QueryLookupStrategy` to determine how to generate the query for each method.

The `SimpleJpaRepository` class is the default implementation behind every `JpaRepository` interface. It uses an `EntityManager` to execute all database operations. When Spring Data encounters a method like `findByEmail`, it parses the method name, extracts the property name (`email`), and builds a Criteria API query dynamically.

```java
// Your repository interface
public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByEmail(String email);
    Optional<User> findByUsername(String username);
}

// Spring creates a proxy like this at runtime
@Repository
public class SimpleJpaRepository<T, ID> implements JpaRepository<T, ID> {
    
    @PersistenceContext
    private EntityManager entityManager;
    
    @Override
    public List<T> findByEmail(String email) {
        // Spring Data generates this query:
        // SELECT * FROM users WHERE email = ?
        // Uses JpaEntityInformation to determine entity class
        // Builds query using QueryBuilder
        
        CriteriaQuery<T> query = entityManager.getCriteriaBuilder()
            .createQuery(getDomainClass());
        
        query.where(
            entityManager.getCriteriaBuilder().equal(
                query.from(getDomainClass()).get("email"), email)
        );
        
        return entityManager.createQuery(query).getResultList();
    }
}
```

### The Proxy Creation Process

Here's exactly how Spring creates your repository implementation. The process has three distinct phases. First, Spring Data detects interfaces extending `Repository` at startup via component scanning. Second, `JpaRepositoryFactoryBean` creates a JDK dynamic proxy for each detected interface. Third, the proxy's `QueryLookupStrategy` decides how to generate queries for each method — either from `@Query` annotations, `@NamedQuery`, or method name derivation.

The default lookup strategy is `CREATE_IF_NOT_FOUND`: it checks for `@Query` first, then `@NamedQuery`, and finally falls back to method name parsing. Understanding this order is essential for debugging — if your `@Query` annotation has a syntax error, you get an error at startup, but if the method name is ambiguous, you get a runtime error only when the method is called.

1. **Bean Definition**: At application startup, Spring Data detects interfaces extending `Repository`
2. **Factory Bean**: `JpaRepositoryFactoryBean` creates the proxy
3. **Query Lookup Strategy**: Based on configuration, Spring finds the query:
   - `CREATE_IF_NOT_FOUND` (default): Derives query from method name
   - `USE_DECLARED_QUERY`: Uses `@Query` annotations
   - `CREATE`: Always creates query from method name

```java
// How Spring finds queries (simplified)
public class QueryLookupStrategy {
    
    public static Query createQuery(Method method) {
        // Priority 1: Check for @Query annotation
        if (method.isAnnotationPresent(Query.class)) {
            return parseQueryAnnotation(method);
        }
        
        // Priority 2: Check for @NamedQuery
        String namedQuery = method.getDeclaringClass().getSimpleName() + "." + method.getName();
        if (entityManager.getEntityManagerFactory().getNamedQuery(namedQuery) != null) {
            return namedQuery;
        }
        
        // Priority 3: Derive from method name
        return deriveQueryFromMethodName(method);
    }
}
```

### Method Name Parsing

Spring Data parses method names into JPQL queries. Understanding the keyword mapping is essential because the parser has a specific grammar. The method name is split at camel-case boundaries and each segment is matched against a known set of keywords (`findBy`, `And`, `Or`, `Between`, `LessThan`, `GreaterThan`, `Containing`, `OrderBy`, etc.).

If a property name in your entity doesn't match the segment in the method name, Spring Data throws an exception at startup with a message like "No property 'xyz' found for type 'Entity'". The table below shows the complete keyword mapping.

| Method Fragment | SQL Equivalent |
|-----------------|-----------------|
| `findByFirstName` | WHERE first_name = ? |
| `findByAgeGreaterThan` | WHERE age > ? |
| `findByLastNameContaining` | WHERE last_name LIKE %?% |
| `findByBirthDateBetween` | WHERE birth_date BETWEEN ? AND ? |
| `findByActiveTrue` | WHERE active = true |
| `findByNameIn` | WHERE name IN (?, ?, ?) |
| `findByNameOrderByAgeDesc` | ORDER BY age DESC |
| `findTop5ByActive` | LIMIT 5 |

```java
// All these method name patterns work automatically
public interface UserRepository extends JpaRepository<User, Long> {
    
    // Basic equality
    List<User> findByFirstName(String firstName);
    
    // Multiple properties
    List<User> findByFirstNameAndLastName(String firstName, String lastName);
    
    // Comparison operators
    List<User> findByAgeGreaterThan(int age);
    List<User> findByAgeLessThanEqual(int age);
    
    // Pattern matching
    List<User> findByLastNameContaining(String substring);
    List<User> findByEmailStartingWith(String prefix);
    List<User> findByEmailEndingWith(String suffix);
    
    // Null handling
    Optional<User> findByPhoneNumberIsNull();
    List<User> findByPhoneNumberIsNotNull();
    
    // Collections
    List<User> findByIdIn(Collection<Long> ids);
    List<User> findByRoleIn(List<String> roles);
    
    // Boolean
    List<User> findByActiveTrue();
    List<User> findByActiveFalse();
    
    // Ordering
    List<User> findByLastNameOrderByFirstNameAsc();
    
    // Limiting
    Optional<User> findTopByOrderByAgeDesc();
    List<User> findFirst5ByActiveTrue();
}
```

### Transaction Management

Spring Data JPA methods are transactional by default. Understanding the propagation behavior is critical because it affects how transactions interact across service layers. Each `JpaRepository` method is annotated with `@Transactional(readOnly = true)` for read operations and `@Transactional` for write operations at the implementation level.

At the service layer, you typically wrap multiple repository calls in a single `@Transactional` annotation. This ensures all calls participate in the same database transaction — either all succeed or all roll back. The propagation behavior defaults to `REQUIRED`, which means the service transaction is reused by each repository method.

```java
// Default: REQUIRED - joins existing transaction or creates new one
public interface UserRepository extends JpaRepository<User, Long> {
    
    // This runs in a transaction (REQUIRED by default)
    @Transactional(propagation = Propagation.REQUIRED)
    User save(User user);
    
    // Override default transaction settings
    @Transactional(readOnly = true, timeout = 30)
    List<User> findAll();
}

// Custom transaction on repository method
public interface UserRepository extends JpaRepository<User, Long> {
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @Modifying
    @Query("UPDATE User u SET u.status = :status WHERE u.id = :id")
    int updateStatus(@Param("id") Long id, @Param("status") String status);
}

// Service-level transaction (most common pattern)
@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    @Transactional
    public User createUser(User user) {
        // Single transaction wraps entire operation
        user.setCreatedAt(Instant.now());
        user.setStatus("ACTIVE");
        return userRepository.save(user);
    }
    
    @Transactional
    public void createUsers(List<User> users) {
        // All saves in one transaction
        userRepository.saveAll(users);
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Paginated and Sorted Queries

Production applications always need pagination. Returning all records from a large table will exhaust memory and overwhelm the network. Spring Data JPA provides the `Page` return type, which encapsulates the results, total count, and pagination metadata in a single response.

Use `Pageable` for standard pagination and `Slice` when you only need to know if there's a "next page" (more efficient because it avoids the count query). For very large read-only datasets, use `Stream<T>` with `@Transactional(readOnly = true)` to process records one at a time without loading everything into memory.

```java
public interface UserRepository extends JpaRepository<User, Long> {
    
    // Simple pagination
    Page<User> findByActiveTrue(Pageable pageable);
    
    // Pagination with sorting
    Page<User> findByLastNameContaining(String name, Pageable pageable);
    
    // Stream for large result sets
    Stream<User> findByActiveTrue(Sort sort);
}

// Service using pagination
@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    public Page<User> getUsers(int page, int size, String sortField, boolean ascending) {
        Sort sort = ascending ? 
            Sort.by(sortField).ascending() : 
            Sort.by(sortField).descending();
        
        Pageable pageable = PageRequest.of(page, size, sort);
        
        return userRepository.findByActiveTrue(pageable);
    }
    
    // Streaming for memory-efficient processing of large datasets
    @Transactional(readOnly = true)
    public void processAllActiveUsers(Consumer<User> processor) {
        try (Stream<User> stream = userRepository.findByActiveTrue(Sort.by("id"))) {
            stream.forEach(processor);
        }
    }
}

// Controller endpoint
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping
    public Page<User> getUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sort,
            @RequestParam(defaultValue = "true") boolean ascending) {
        
        return userService.getUsers(page, size, sort, ascending);
    }
}
```

### Case 2: Custom Queries with @Query

When method names become unwieldy or you need complex queries, use the `@Query` annotation. JPQL queries are recommended over native SQL because they are database-independent and validated against the entity model at startup. Use native SQL only for database-specific features like window functions or full-text search.

The `@Modifying` annotation is mandatory for UPDATE, DELETE, or INSERT queries. Without it, Spring Data JPA throws an exception because it doesn't know the method modifies data. `@Modifying` also provides `clearAutomatically` (clears the persistence context after execution) and `flushAutomatically` (flushes before executing).

```java
public interface UserRepository extends JpaRepository<User, Long> {
    
    // JPQL query
    @Query("SELECT u FROM User u WHERE u.email = :email AND u.active = true")
    Optional<User> findActiveUserByEmail(@Param("email") String email);
    
    // Native SQL query
    @Query(value = "SELECT * FROM users WHERE created_at >= :startDate", 
           nativeQuery = true)
    List<User> findUsersCreatedAfter(@Param("startDate") LocalDateTime startDate);
    
    // Projection with native query
    @Query(value = "SELECT u.id, u.email, u.first_name FROM users u", 
           nativeQuery = true)
    List<UserSummary> findUserSummaries();
    
    // Pagination with custom query
    @Query("SELECT u FROM User u WHERE u.lastName LIKE %:name%")
    Page<User> findByLastName(@Param("name") String name, Pageable pageable);
    
    // Update query (requires @Modifying)
    @Modifying
    @Query("UPDATE User u SET u.status = :status WHERE u.lastLogin < :date")
    int deactivateUsersNotLoggedInSince(@Param("status") String status, 
                                        @Param("date") LocalDateTime date);
    
    // DELETE query
    @Modifying
    @Query("DELETE FROM User u WHERE u.status = 'DELETED' AND u.deletedAt < :cutoff")
    int purgeSoftDeletedUsers(@Param("cutoff") LocalDateTime cutoff);
}

// Projection interface
public interface UserSummary {
    Long getId();
    String getEmail();
    String getFirstName();
}
```

### Case 3: Entity Graph for Complex Fetching

The N+1 query problem occurs when you load an entity with lazy associations and then iterate over the collection, triggering a separate SQL query for each item. Entity graphs solve this by specifying which associations to fetch eagerly for a particular query, overriding the default fetch strategy.

`@NamedEntityGraph` defines reusable fetch plans at the entity level. The `@EntityGraph` annotation on repository methods references these plans or specifies inline attribute paths. Use `LOAD` to always fetch the specified attributes (even if they're LAZY) and `FETCH` to treat the specified attributes as EAGER while everything else remains LAZY.

```java
@Entity
@NamedEntityGraph(
    name = "User.withOrders",
    attributeNodes = @NamedAttributeNode("orders")
)
@EntityGraph(value = "User.withOrders", type = EntityGraph.EntityGraphType.LOAD)
public interface UserRepository extends JpaRepository<User, Long> {
    
    @EntityGraph(attributePaths = {"orders", "roles"})
    Optional<User> findByEmail(String email);
    
    // Using @EntityGraph annotation on method
    @EntityGraph(attributePaths = {"addresses"})
    List<User> findByActiveTrue();
}

// Entity definition
@Entity
@Table(name = "users")
@NamedEntityGraphs({
    @NamedEntityGraph(name = "User.detail", 
        attributeNodes = @NamedAttributeNode("orders")),
    @NamedEntityGraph(name = "User.withRoles",
        attributeNodes = @NamedAttributeNode("roles"))
})
public class User {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String email;
    
    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List<Order> orders;
    
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "user_roles")
    private Set<Role> roles;
    
    @OneToMany(mappedBy = "user")
    private List<Address> addresses;
}
```

### Case 4: Specification for Dynamic Queries

Build complex queries programmatically using the Specification pattern. This is the most flexible approach for dynamic search filters where the user can combine any subset of criteria. `JpaSpecificationExecutor` adds the `findAll(Specification<T>)` method to your repository.

Each specification method returns `null` when the corresponding filter is not provided, which the `Specification.where()` method ignores. This lets you compose optional filters without complex conditional logic. The resulting query uses JOINs and WHERE clauses that are efficient and use proper bind parameters (no SQL injection risk).

```java
public interface UserRepository extends JpaRepository<User, Long>, 
                                      JpaSpecificationExecutor<User> {
    // This interface provides findAll(Specification<T>)
}

@Service
public class UserSearchService {
    
    @Autowired
    private UserRepository userRepository;
    
    public List<User> search(UserSearchCriteria criteria) {
        Specification<User> spec = Specification
            .where(hasFirstName(criteria.getFirstName()))
            .and(hasLastName(criteria.getLastName()))
            .and(hasAgeBetween(criteria.getMinAge(), criteria.getMaxAge()))
            .and(hasActiveStatus(criteria.isActive()))
            .and(hasRole(criteria.getRole()));
        
        return userRepository.findAll(spec);
    }
    
    private Specification<User> hasFirstName(String firstName) {
        return (root, query, cb) -> {
            if (firstName == null || firstName.isEmpty()) return null;
            return cb.equal(root.get("firstName"), firstName);
        };
    }
    
    private Specification<User> hasLastName(String lastName) {
        return (root, query, cb) -> {
            if (lastName == null || lastName.isEmpty()) return null;
            return cb.like(cb.lower(root.get("lastName")), "%" + lastName.toLowerCase() + "%");
        };
    }
    
    private Specification<User> hasAgeBetween(Integer minAge, Integer maxAge) {
        return (root, query, cb) -> {
            if (minAge == null && maxAge == null) return null;
            if (minAge != null && maxAge != null) {
                return cb.between(root.get("age"), minAge, maxAge);
            }
            if (minAge != null) {
                return cb.greaterThanOrEqualTo(root.get("age"), minAge);
            }
            return cb.lessThanOrEqualTo(root.get("age"), maxAge);
        };
    }
    
    private Specification<User> hasActiveStatus(Boolean active) {
        return (root, query, cb) -> {
            if (active == null) return null;
            return cb.equal(root.get("active"), active);
        };
    }
    
    private Specification<User> hasRole(String role) {
        return (root, query, cb) -> {
            if (role == null || role.isEmpty()) return null;
            return cb.equal(root.get("role"), role);
        };
    }
}

// Usage
UserSearchCriteria criteria = new UserSearchCriteria();
criteria.setFirstName("John");
criteria.setMinAge(25);
criteria.setMaxAge(40);
criteria.setActive(true);

List<User> users = userSearchService.search(criteria);
```

---

## Trade-offs: Spring Data JPA vs Plain JPA/Hibernate

### Spring Data JPA Advantages

1. **Dramatically reduced boilerplate**: No more DAOs with identical methods
2. **Query derivation**: Method names become queries automatically
3. **Pagination support**: Built-in `Page` and `Slice` types
4. **Specification pattern**: Dynamic query building without string concatenation

### Spring Data JPA Disadvantages

1. **Magic behavior**: Hard to debug when queries don't work as expected
2. **Limited to CRUD+**: Complex queries still require JPQL
3. **Hidden complexity**: Easy to create performance issues without realizing it

### Decision Matrix

| Scenario | Recommended Approach |
|----------|---------------------|
| CRUD operations | Spring Data JPA repositories |
| Complex reports with joins | Custom JPQL/native queries |
| Dynamic search filters | Specification pattern |
| Batch processing | EntityManager + custom implementation |
| Performance-critical queries | Native queries with result set mapping |

---

## Production Considerations

### 1. Entity Manager Configuration

Proper entity manager setup is critical for production. The configuration below shows a tuned Hibernate setup with batching enabled, which reduces the number of SQL statements for bulk operations. Disable `show-sql` and `format-sql` in production — they add overhead and can leak schema information in logs.

The batch settings tell Hibernate to group multiple INSERT statements into a single JDBC batch. `order_inserts` and `order_updates` reorganize the statements so that Hibernate can batch them efficiently. Without these, Hibernate interleaves statements and can't batch them.

```java
@Configuration
@EnableJpaRepositories(
    basePackages = "com.example.repository",
    entityManagerFactoryRef = "entityManagerFactory",
    transactionManagerRef = "transactionManager"
)
public class JpaConfig {
    
    @Primary
    @Bean
    public LocalContainerEntityManagerFactoryBean entityManagerFactory(
            DataSource dataSource,
            JpaProperties jpaProperties) {
        
        LocalContainerEntityManagerFactoryBean em = new LocalContainerEntityManagerFactoryBean();
        em.setDataSource(dataSource);
        em.setPackagesToScan("com.example.entity");
        
        HibernateJpaVendorAdapter vendorAdapter = new HibernateJpaVendorAdapter();
        em.setJpaVendorAdapter(vendorAdapter);
        
        // Configure Hibernate properties
        jpaProperties.setShowSql(false);  // Disable in production
        jpaProperties.setProperties(Map.of(
            "hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect",
            "hibernate.format_sql", false,
            "hibernate.use_sql_comments", false,
            "hibernate.jdbc.batch_size", 50,
            "hibernate.order_inserts", true,
            "hibernate.order_updates", true,
            "hibernate.jdbc.batch_versioned_data", true
        ));
        
        em.setJpaPropertyMap(jpaProperties.getProperties());
        
        return em;
    }
}
```

### 2. Auditing:自动填充审计字段

Track creation and modification times automatically with Spring Data JPA auditing. Enable it with `@EnableJpaAuditing`, define an `AuditorAware` bean that extracts the current user from the security context, and extend your entities from an `Auditable` base class.

The `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, and `@LastModifiedBy` annotations are automatically populated by `AuditingEntityListener` when the entity is persisted or updated. This eliminates repetitive timestamp-setting code and ensures consistency across all entities.

```java
@Configuration
@EnableJpaAuditing
public class AuditConfig {
    
    @Bean
    public AuditorAware<String> auditorProvider() {
        // Get current user from security context
        return () -> {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            return (auth != null && auth.isAuthenticated()) ? 
                auth.getName() : "system";
        };
    }
}

@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class Auditable {
    
    @CreatedBy
    @Column(updatable = false)
    private String createdBy;
    
    @CreatedDate
    @Column(updatable = false)
    private LocalDateTime createdAt;
    
    @LastModifiedBy
    private String lastModifiedBy;
    
    @LastModifiedDate
    private LocalDateTime lastModifiedAt;
    
    // Getters and setters
}

@Entity
public class User extends Auditable {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String name;
    
    // Inherits createdBy, createdAt, lastModifiedBy, lastModifiedAt
}

// Now Spring automatically sets these fields on save/update
@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    @Transactional
    public User createUser(User user) {
        return userRepository.save(user);
        // createdBy, createdAt are automatically set
    }
    
    @Transactional
    public User updateUser(Long id, User updates) {
        User user = userRepository.findById(id).orElseThrow();
        user.setName(updates.getName());
        return userRepository.save(user);
        // lastModifiedBy, lastModifiedAt are automatically updated
    }
}
```

### 3. Soft Delete Pattern

Common in production to preserve data integrity. Instead of physically deleting rows, set a `deleted` flag. This allows data recovery, maintains referential integrity, and enables audit trails. The pattern requires overriding standard repository methods to filter out deleted records and providing custom methods for admin-level hard deletion and restoration.

The `@Where` annotation (Hibernate-specific) can also be used on entities to automatically filter out soft-deleted records in all queries, but it requires careful testing because it silently modifies every query.

```java
@MappedSuperclass
public abstract class SoftDeletable {
    
    @Column(nullable = false)
    private boolean deleted = false;
    
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;
    
    @Column(name = "deleted_by")
    private String deletedBy;
}

@Entity
public class User extends SoftDeletable {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String name;
    
    @Column(unique = true)
    private String email;
}

// Custom repository for soft delete queries
public interface UserRepository extends JpaRepository<User, Long> {
    
    // Override default methods to filter deleted records
    @Override
    @Query("SELECT u FROM User u WHERE u.id = :id AND u.deleted = false")
    Optional<User> findById(@Param("id") Long id);
    
    @Override
    @Query("SELECT u FROM User u WHERE u.deleted = false")
    List<User> findAll();
    
    @Query("SELECT u FROM User u WHERE u.deleted = true")
    List<User> findAllDeleted();
    
    // Hard delete for admin
    @Modifying
    @Query("DELETE FROM User u WHERE u.id = :id")
    void hardDelete(@Param("id") Long id);
}

@Repository
public class UserRepositoryImpl implements UserRepositoryExtension {
    
    @Autowired
    private EntityManager entityManager;
    
    @Override
    public void softDelete(User user) {
        user.setDeleted(true);
        user.setDeletedAt(Instant.now());
        
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        user.setDeletedBy(auth != null ? auth.getName() : "system");
        
        entityManager.merge(user);
    }
    
    @Override
    public void restore(Long id) {
        User user = entityManager.find(User.class, id);
        user.setDeleted(false);
        user.setDeletedAt(null);
        user.setDeletedBy(null);
    }
}
```

### 4. Connection Pool Monitoring

Monitor connection pool health to detect connection leaks, pool exhaustion, or database connectivity issues. HikariCP is the default connection pool in Spring Boot 2.x+ and provides comprehensive metrics.

Configure HikariCP with reasonable pool limits and expose metrics via Micrometer. The `maximumPoolSize` should be set based on the database's max connections divided by the number of application instances. The `connectionTimeout` controls how long a thread waits for a connection before throwing an exception.

```java
@Configuration
public class DataSourceConfiguration {
    
    @Bean
    public DataSource dataSource() {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        dataSource.setUsername("user");
        dataSource.setPassword("password");
        
        // Pool configuration
        dataSource.setMaximumPoolSize(20);
        dataSource.setMinimumIdle(5);
        dataSource.setConnectionTimeout(30000);
        dataSource.setIdleTimeout(600000);
        dataSource.setMaxLifetime(1800000);
        
        // Health check
        dataSource.setConnectionTestQuery("SELECT 1");
        
        return dataSource;
    }
    
    // Expose metrics for monitoring
    @Bean
    public MeterRegistryCustomizer<MeterRegistry> metrics() {
        return registry -> {
            registry.config().commonTags("application", "my-app");
            
            // HikariCP metrics
            DataSource ds = dataSource();
            if (ds instanceof HikariDataSource) {
                ((HikariDataSource) ds).setMetricRegistry(registry);
            }
        };
    }
}

// In application.yml for actuator
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,databases
  metrics:
    enable:
      hikaricp: true
```

### 5. Batch Operations for Bulk Inserts

For high-volume data import, bypass Spring Data JPA's `saveAll()` and use the `EntityManager` directly. The reason is that `saveAll()` still processes entities through the persistence context, which grows unboundedly and causes memory pressure.

The `flush()` and `clear()` calls every N items keep the persistence context at a manageable size. Without periodic clearing, the persistence context acts as a first-level cache that grows with each persisted entity, eventually causing out-of-memory errors.

```java
@Service
public class BulkImportService {
    
    @Autowired
    private EntityManager entityManager;
    
    @Transactional
    public void bulkInsertUsers(List<User> users) {
        int batchSize = 50;
        
        for (int i = 0; i < users.size(); i++) {
            entityManager.persist(users.get(i));
            
            // Flush and clear every batchSize items
            if (i > 0 && i % batchSize == 0) {
                entityManager.flush();
                entityManager.clear();
                
                log.info("Inserted {} users", i);
            }
        }
        
        // Final flush
        entityManager.flush();
        entityManager.clear();
    }
}

// Spring Data JPA batch insert
@Entity
@Table(name = "users")
@BatchSize(size = 50)
public class User {
    
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_seq")
    @SequenceGenerator(name = "user_seq", sequenceName = "user_id_seq")
    private Long id;
    
    private String name;
}

// Repository with bulk insert
public interface UserRepository extends JpaRepository<User, Long> {
    
    @Modifying
    @Query(value = "INSERT INTO users (name, email, created_at) " +
                   "VALUES (:#{#user.name}, ::#{#user.email}, ::#{#user.createdAt})", 
           nativeQuery = true)
    @QueryHints({@QueryHint(name = "org.hibernate.jdbc.batch_size", value = "50")})
    void bulkInsert(@Param("user") User user);
}
```

---

## Common Mistakes

### Mistake 1: Missing @Transactional on Service Methods

```java
// WRONG - No transaction, Hibernate will auto-commit after each statement
@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    public void createUsers(List<User> users) {
        for (User user : users) {
            userRepository.save(user);  // Each save is its own transaction
        }
    }
    
    public User createUser(User user) {
        return userRepository.save(user);  // Works but could fail silently
    }
}

// CORRECT - Wrap in transaction
@Service
public class UserService {
    
    @Transactional
    public void createUsers(List<User> users) {
        userRepository.saveAll(users);  // All in one transaction
    }
    
    @Transactional(rollbackFor = Exception.class)
    public User createUser(User user) {
        return userRepository.save(user);
    }
}
```

### Mistake 2: Using Entity inside @Transactional Boundaries Incorrectly

```java
// WRONG - Returning entity from service layer after transaction
@Service
public class UserService {
    
    @Transactional
    public User getUser(Long id) {
        User user = userRepository.findById(id).orElseThrow();
        
        // Problem: LazyInitializationException if accessed outside transaction
        return user;  // User object is detached after method returns
    }
}

// CORRECT - Use DTOs or fetch eagerly when needed
@Service
public class UserService {
    
    @Transactional(readOnly = true)
    public UserDTO getUserDTO(Long id) {
        User user = userRepository.findById(id).orElseThrow();
        
        // Map to DTO while in transaction
        return UserDTO.builder()
            .id(user.getId())
            .name(user.getName())
            .email(user.getEmail())
            // Fields are already loaded
            .build();
    }
    
    // Or use entity graph
    @Transactional(readOnly = true)
    public User getUserWithDetails(Long id) {
        return userRepository.findByIdWithDetails(id)
            .orElseThrow();
    }
}
```

### Mistake 3: Not Handling Unique Constraint Violations

```java
// WRONG - No error handling for duplicate emails
@Service
public class UserService {
    
    @Transactional
    public User createUser(User user) {
        return userRepository.save(user);  // Throws exception on duplicate
    }
}

// CORRECT - Handle DataIntegrityViolationException
@Service
public class UserService {
    
    @Transactional
    public User createUser(User user) {
        try {
            return userRepository.save(user);
        } catch (DataIntegrityViolationException e) {
            throw new DuplicateEmailException(
                "User with email " + user.getEmail() + " already exists", e);
        }
    }
}

// Custom exception
public class DuplicateEmailException extends RuntimeException {
    public DuplicateEmailException(String message, Throwable cause) {
        super(message, cause);
    }
}

// Global exception handler
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(DuplicateEmailException.class)
    public ResponseEntity<Map<String, String>> handleDuplicateEmail(
            DuplicateEmailException e) {
        return ResponseEntity.status(409)
            .body(Map.of("error", e.getMessage()));
    }
}
```

### Mistake 4: Forgetting @Modifying for Update/Delete Queries

```java
// WRONG - Missing @Modifying annotation
public interface UserRepository extends JpaRepository<User, Long> {
    
    @Query("UPDATE User u SET u.active = false WHERE u.lastLogin < :date")
    List<User> deactivateUsers(LocalDateTime date);  // Won't work!
}

// CORRECT - Add @Modifying
public interface UserRepository extends JpaRepository<User, Long> {
    
    @Modifying
    @Query("UPDATE User u SET u.active = false WHERE u.lastLogin < :date")
    int deactivateUsers(LocalDateTime date);  // Returns int (affected rows)
    
    @Modifying(clearAutomatically = true)
    @Query("DELETE FROM User u WHERE u.active = false AND u.createdAt < :cutoff")
    int deleteInactiveUsers(LocalDateTime cutoff);
}
```

### Mistake 5: Mixing Fetch Types Incorrectly

```java
// WRONG - LazyInitializationException from missing fetch
@Entity
public class Order {
    
    @Id
    @GeneratedValue
    private Long id;
    
    @ManyToOne  // Default is LAZY
    private User user;
}

@Service
public class OrderService {
    
    @Transactional(readOnly = true)
    public List<OrderDTO> getOrders() {
        List<Order> orders = orderRepository.findAll();
        
        return orders.stream()
            .map(order -> OrderDTO.builder()
                .orderId(order.getId())
                .userName(order.getUser().getName())  // LazyInitializationException!
                .build())
            .collect(Collectors.toList());
    }
}

// CORRECT - Use fetch join or entity graph
public interface OrderRepository extends JpaRepository<Order, Long> {
    
    @Query("SELECT o FROM Order o JOIN FETCH o.user")
    List<Order> findAllWithUser();
    
    @EntityGraph(attributePaths = {"user"})
    List<Order> findByStatus(String status);
}

@Service
public class OrderService {
    
    @Transactional(readOnly = true)
    public List<OrderDTO> getOrders() {
        List<Order> orders = orderRepository.findAllWithUser();
        
        return orders.stream()
            .map(order -> OrderDTO.builder()
                .orderId(order.getId())
                .userName(order.getUser().getName())  // Works!
                .build())
            .collect(Collectors.toList());
    }
}
```

### Mistake 6: Not Using @QueryHints for Read-Only Queries

```java
// WRONG - Using regular query for read-only operations
public interface UserRepository extends JpaRepository<User, Long> {
    
    @Query("SELECT u FROM User u")
    List<User> findAllUsers();  // No hint for read-only optimization
}

// CORRECT - Add query hints
public interface UserRepository extends JpaRepository<User, Long> {
    
    @QueryHints(value = @QueryHint(name = "org.hibernate.readOnly", value = "true"))
    @Query("SELECT u FROM User u")
    List<User> findAllUsers();
    
    // For projections
    @QueryHints(value = {
        @QueryHint(name = "org.hibernate.readOnly", value = "true"),
        @QueryHint(name = "org.hibernate.fetchSize", value = "100")
    })
    @Query("SELECT u.id, u.name FROM User u")
    List<Object[]> findUserIdsAndNames();
}
```

---

## Summary

Spring Data JPA is an incredibly powerful abstraction, but it requires understanding the underlying mechanics to use effectively:

1. **Method naming works magic**: But know the query derivation process for debugging
2. **Transactions are essential**: Always wrap repository operations in transactions
3. **Lazy loading is the default**: Plan for it or use fetch joins/entity graphs
4. **Custom queries are sometimes necessary**: When method names become unwieldy
5. **Auditing and soft delete**: Built-in support for common patterns

The key to using Spring Data JPA successfully is understanding when to rely on its conventions and when you need explicit control. For most CRUD operations, Spring Data JPA conventions are sufficient. For complex queries, use custom JPQL. For dynamic queries, use Specifications.

---

## References

- [Spring Data JPA Documentation](https://docs.spring.io/spring-data/jpa/docs/current/reference/html/)
- [Spring Data JPA - Query Methods](https://docs.spring.io/spring-data/jpa/docs/current/reference/html/#jpa.query-methods)
- [Hibernate ORM Documentation](https://hibernate.org/orm/documentation/)
- [Baeldung - Spring Data JPA Guide](https://www.baeldung.com/the-persistence-layer-with-spring-data-jpa)

---

Happy Coding
