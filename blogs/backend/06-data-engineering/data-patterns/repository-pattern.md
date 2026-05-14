---
title: Repository Pattern
description: >-
  Deep dive into the Repository pattern: abstraction layers, generic vs
  domain-specific repositories, Spring Data JPA, and implementation strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - repository-pattern
  - design-patterns
  - jpa
  - architecture
coverImage: /images/backend/data-access/data-patterns/repository-pattern.png
draft: false
order: 40
---
# Repository Pattern

## Overview

The Repository pattern mediates between the domain and data mapping layers, acting like an in-memory domain object collection. It provides a clean abstraction for data access, enables testing, centralizes query logic, and decouples business logic from persistence details.

---

## Repository Architecture

### Core Repository Interface

The repository interface defines a collection-like API over your persistent entities. The generic interface below captures the standard set of CRUD operations—`findById`, `findAll`, `save`, `delete`—parameterized by entity type and primary key type. This abstraction allows the business layer to work with domain objects without depending on any specific persistence technology.

```java
// Generic repository interface
public interface Repository<T, ID> {

    Optional<T> findById(ID id);

    List<T> findAll();

    List<T> findAll(Sort sort);

    Page<T> findAll(Pageable pageable);

    T save(T entity);

    List<T> saveAll(Iterable<T> entities);

    void delete(T entity);

    void deleteById(ID id);

    boolean existsById(ID id);

    long count();
}
```

### Domain-Specific Repository

A domain-specific repository extends the generic interface with query methods that express business concepts. Rather than exposing generic `findByColumn` methods, the domain repository exposes operations like `findPendingOrdersByUser` or `hasActiveOrders`. This makes the calling code more readable and encapsulates query logic within the repository layer.

```java
// Domain-oriented repository with business query methods
public interface OrderRepository extends Repository<Order, Long> {

    // Business-focused query methods
    List<Order> findPendingOrdersByUser(Long userId);

    Optional<Order> findByOrderNumber(String orderNumber);

    List<Order> findOrdersInDateRange(Long userId, LocalDate start, LocalDate end);

    Page<Order> findOrdersByStatus(OrderStatus status, Pageable pageable);

    // Aggregate queries
    BigDecimal getTotalOrderValueByUser(Long userId);

    long countOrdersByStatus(OrderStatus status);

    // Domain-specific operations
    void updateOrderStatus(Long orderId, OrderStatus newStatus);

    boolean hasActiveOrders(Long userId);
}
```

---

## Spring Data JPA Implementation

### Repository Implementation

Spring Data JPA provides automatic implementations of repository interfaces at runtime. Query methods are derived from method names (e.g., `findByUserIdAndStatusOrderByCreatedAtDesc` becomes a JPQL query automatically). The `@Query` annotation allows custom JPQL with join fetching, DTO projections, and modifying operations. The `@Modifying` annotation on update queries tells Spring Data to execute the query as an update rather than a select.

```java
@Repository
public interface OrderJpaRepository extends JpaRepository<Order, Long> {

    // Spring Data query derivation
    List<Order> findByUserIdAndStatusOrderByCreatedAtDesc(
        Long userId, OrderStatus status);

    @Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.id = :id")
    Optional<Order> findByIdWithItems(@Param("id") Long id);

    @Query("SELECT new com.example.dto.OrderSummary(o.id, o.orderNumber, o.total, o.status) " +
           "FROM Order o WHERE o.user.id = :userId")
    List<OrderSummary> findOrderSummariesByUser(@Param("userId") Long userId);

    @Modifying
    @Query("UPDATE Order o SET o.status = :status WHERE o.id = :id")
    int updateOrderStatus(@Param("id") Long id, @Param("status") OrderStatus status);

    @Query("SELECT COALESCE(SUM(o.total), 0) FROM Order o WHERE o.user.id = :userId")
    BigDecimal getTotalOrderValue(@Param("userId") Long userId);
}
```

### Custom Repository Implementation

For complex queries that cannot be expressed through method naming or JPQL, Spring Data JPA allows you to define a custom interface and provide an implementation using the Criteria API. The `CustomOrderRepository` below demonstrates dynamic query building with optional filters, pagination, sorting, bulk updates, and aggregation—all without writing any SQL.

```java
// Custom repository interface
public interface CustomOrderRepository {
    Page<Order> searchOrders(OrderSearchCriteria criteria, Pageable pageable);

    void bulkUpdateStatus(List<Long> orderIds, OrderStatus newStatus);

    Map<OrderStatus, Long> getOrderCountByStatus();
}

// Custom implementation
public class CustomOrderRepositoryImpl implements CustomOrderRepository {

    @PersistenceContext
    private EntityManager entityManager;

    @Override
    public Page<Order> searchOrders(OrderSearchCriteria criteria, Pageable pageable) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<Order> query = cb.createQuery(Order.class);
        Root<Order> root = query.from(Order.class);

        List<Predicate> predicates = new ArrayList<>();

        if (criteria.getUserId() != null) {
            predicates.add(cb.equal(root.get("user").get("id"), criteria.getUserId()));
        }

        if (criteria.getStatus() != null) {
            predicates.add(cb.equal(root.get("status"), criteria.getStatus()));
        }

        if (criteria.getMinTotal() != null) {
            predicates.add(cb.greaterThanOrEqualTo(root.get("total"), criteria.getMinTotal()));
        }

        if (criteria.getMaxTotal() != null) {
            predicates.add(cb.lessThanOrEqualTo(root.get("total"), criteria.getMaxTotal()));
        }

        if (criteria.getStartDate() != null) {
            predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), criteria.getStartDate()));
        }

        if (criteria.getEndDate() != null) {
            predicates.add(cb.lessThanOrEqualTo(root.get("createdAt"), criteria.getEndDate()));
        }

        query.where(predicates.toArray(new Predicate[0]));

        // Apply sorting
        if (pageable.getSort().isSorted()) {
            List<Order> orders = new ArrayList<>();
            pageable.getSort().forEach(sortOrder -> {
                Path<Object> path = root.get(sortOrder.getProperty());
                orders.add(sortOrder.isAscending()
                    ? cb.asc(path) : cb.desc(path));
            });
            query.orderBy(orders);
        }

        // Execute query with pagination
        TypedQuery<Order> typedQuery = entityManager.createQuery(query);
        typedQuery.setFirstResult((int) pageable.getOffset());
        typedQuery.setMaxResults(pageable.getPageSize());

        List<Order> content = typedQuery.getResultList();

        // Count query
        CriteriaQuery<Long> countQuery = cb.createQuery(Long.class);
        Root<Order> countRoot = countQuery.from(Order.class);
        countQuery.select(cb.count(countRoot));
        countQuery.where(predicates.toArray(new Predicate[0]));
        Long total = entityManager.createQuery(countQuery).getSingleResult();

        return new PageImpl<>(content, pageable, total);
    }

    @Override
    public void bulkUpdateStatus(List<Long> orderIds, OrderStatus newStatus) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaUpdate<Order> update = cb.createCriteriaUpdate(Order.class);
        Root<Order> root = update.from(Order.class);

        update.set(root.get("status"), newStatus);
        update.set(root.get("updatedAt"), Instant.now());
        update.where(root.get("id").in(orderIds));

        entityManager.createQuery(update).executeUpdate();
    }

    @Override
    public Map<OrderStatus, Long> getOrderCountByStatus() {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<Tuple> query = cb.createQuery(Tuple.class);
        Root<Order> root = query.from(Order.class);

        query.multiselect(
            root.get("status"),
            cb.count(root)
        );
        query.groupBy(root.get("status"));

        List<Tuple> results = entityManager.createQuery(query).getResultList();

        return results.stream()
            .collect(Collectors.toMap(
                tuple -> (OrderStatus) tuple.get(0),
                tuple -> (Long) tuple.get(1)
            ));
    }
}

// Extend the main repository with custom interface
@Repository
public interface OrderRepository extends JpaRepository<Order, Long>,
                                         CustomOrderRepository {
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long>,
                                         CustomOrderRepository {
    // Built-in methods + custom implementation
}
```

---

## Generic vs Domain-Specific Repositories

### Generic Repository

A generic repository provides base CRUD functionality for any entity type. The `AbstractGenericRepository` below uses an `EntityManager` and implements `findById`, `save`, and `deleteById` in terms of JPA's `persist`, `merge`, and `remove`. The `save` method checks whether the entity is already managed (using `contains`) to decide between `persist` and `merge`.

```java
// Generic CRUD repository
public interface GenericRepository<T, ID> {

    Optional<T> findById(ID id);

    T getById(ID id);

    List<T> findAll();

    Page<T> findAll(Pageable pageable);

    T save(T entity);

    List<T> saveAll(List<T> entities);

    void delete(T entity);

    void deleteById(ID id);

    void deleteAll();

    boolean existsById(ID id);

    long count();
}

// Abstract implementation
public abstract class AbstractGenericRepository<T, ID> implements GenericRepository<T, ID> {

    @PersistenceContext
    protected EntityManager entityManager;

    private final Class<T> entityClass;

    protected AbstractGenericRepository(Class<T> entityClass) {
        this.entityClass = entityClass;
    }

    @Override
    public Optional<T> findById(ID id) {
        return Optional.ofNullable(entityManager.find(entityClass, id));
    }

    @Override
    @Transactional
    public T save(T entity) {
        if (entityManager.contains(entity)) {
            return entityManager.merge(entity);
        }
        entityManager.persist(entity);
        return entity;
    }

    @Override
    @Transactional
    public void deleteById(ID id) {
        findById(id).ifPresent(entityManager::remove);
    }
}

// Usage
@Repository
public class UserRepository extends AbstractGenericRepository<User, Long> {

    public UserRepository() {
        super(User.class);
    }

    // Domain-specific methods
    public Optional<User> findByEmail(String email) {
        TypedQuery<User> query = entityManager.createQuery(
            "SELECT u FROM User u WHERE u.email = :email", User.class);
        query.setParameter("email", email);
        return query.getResultStream().findFirst();
    }
}
```

### Domain-Specific Repository (Preferred)

Domain-specific repositories are preferred over generic ones because they communicate intent. Rather than providing a generic `findAll`, the `ProductRepository` exposes `findByCategoryAndActiveTrue` and `findLowStockProducts`, which map directly to business concepts. This makes the repository a more meaningful part of the domain model rather than a purely technical abstraction.

```java
// Domain-specific repositories expose meaningful business methods
public interface ProductRepository extends JpaRepository<Product, Long> {

    List<Product> findByCategoryAndActiveTrue(String category);

    Page<Product> searchProducts(String query, Pageable pageable);

    @Query("SELECT p FROM Product p WHERE p.stock < :threshold")
    List<Product> findLowStockProducts(@Param("threshold") int threshold);

    @Modifying
    @Query("UPDATE Product p SET p.stock = p.stock - :quantity WHERE p.id = :id AND p.stock >= :quantity")
    int decrementStock(@Param("id") Long id, @Param("quantity") int quantity);

    List<Product> findTopSelling();

    Map<String, Long> getProductCountByCategory();
}
```

---

## Testing with Repositories

Integration testing with repositories requires a database. Spring Boot's `@AutoConfigureTestDatabase` replaces the production data source with an embedded one (like H2) for testing. The `TestEntityManager` provides convenience methods for setting up test data. The test below verifies that `findPendingOrdersByUser` returns only the orders with the correct status.

```java
@SpringBootTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.ANY)
class OrderRepositoryTest {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    void shouldFindPendingOrdersByUser() {
        User user = entityManager.persistFlushFind(new User("test@example.com"));

        Order order1 = new Order(user, new BigDecimal("100.00"), OrderStatus.PENDING);
        Order order2 = new Order(user, new BigDecimal("200.00"), OrderStatus.SHIPPED);
        Order order3 = new Order(user, new BigDecimal("300.00"), OrderStatus.PENDING);

        entityManager.persist(order1);
        entityManager.persist(order2);
        entityManager.persist(order3);

        List<Order> pendingOrders = orderRepository
            .findPendingOrdersByUser(user.getId());

        assertThat(pendingOrders).hasSize(2);
        assertThat(pendingOrders)
            .extracting(Order::getStatus)
            .containsOnly(OrderStatus.PENDING);
    }
}
```

---

## Best Practices

1. **Repository per aggregate root**: One repository per aggregate root in DDD
2. **Domain-specific queries**: Name methods after business concepts
3. **Return domain objects**: Map persistence objects to domain model
4. **Use DTO projections for read models**: Avoid loading full entities
5. **Composition over inheritance**: Extend base repos with custom interfaces
6. **Keep repositories focused**: Each repo handles one aggregate
7. **Avoid generic repositories**: Domain-specific methods tell better stories
8. **Use Specifications for complex queries**: Reusable query predicates
9. **Test repository behavior**: Integration tests with embedded database
10. **Consider read/write separation**: Different repos for CQRS

The `JpaSpecificationExecutor` interface enables reusable, composable query predicates. Each `Specification` is a single predicate that can be combined with `.and()` and `.or()` operators. This is particularly useful when the number of query combinations would otherwise explode into dozens of repository methods.

```java
// Using Specifications for reusable queries
public class OrderSpecifications {

    public static Specification<Order> byUser(Long userId) {
        return (root, query, cb) -> cb.equal(root.get("user").get("id"), userId);
    }

    public static Specification<Order> byStatus(OrderStatus status) {
        return (root, query, cb) -> cb.equal(root.get("status"), status);
    }

    public static Specification<Order> createdBetween(LocalDate start, LocalDate end) {
        return (root, query, cb) -> cb.between(root.get("createdAt"), start, end);
    }

    public static Specification<Order> totalGreaterThan(BigDecimal min) {
        return (root, query, cb) -> cb.greaterThan(root.get("total"), min);
    }
}

// Usage
@Repository
public interface OrderRepository extends JpaRepository<Order, Long>,
                                        JpaSpecificationExecutor<Order> {
}

// Combine specs
List<Order> orders = orderRepository.findAll(
    Specification
        .where(OrderSpecifications.byUser(userId))
        .and(OrderSpecifications.byStatus(OrderStatus.PENDING))
        .and(OrderSpecifications.totalGreaterThan(new BigDecimal("500")))
);
```

---

## Common Mistakes

### Mistake 1: One Generic Repository for Everything

A single generic repository used by every service is an anti-pattern. It couples all services to the same data access interface, makes it hard to add domain-specific query methods, and defeats the purpose of encapsulation.

```java
// WRONG: Single generic repository for all entities
@Repository
public class DatabaseRepository {
    public <T> T findById(Class<T> type, Long id) { ... }
    public <T> T save(T entity) { ... }
}

// CORRECT: Repository per aggregate with domain methods
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {
    List<Order> findPendingOrdersByUser(Long userId);
}
```

### Mistake 2: Exposing Persistence Details

Repository methods that expose JPQL strings, native SQL, or database-specific constructs leak persistence concerns into the business layer. If the implementation changes (e.g., from JPA to JDBC), all callers must be updated.

```java
// WRONG: Repository methods leak JPA concepts
public interface OrderRepository {
    Page<Order> findByJPQLQuery(String jpql, Pageable pageable);
    List<Order> findByNativeQuery(String sql);
}

// CORRECT: Business-focused query methods
public interface OrderRepository {
    List<Order> findPendingOrdersByUser(Long userId);
    Page<Order> searchOrders(OrderSearchCriteria criteria, Pageable pageable);
}
```

### Mistake 3: Repository Methods for Every Possible Query

Creating a separate repository method for every combination of filters leads to an explosion of method names. For dynamic queries, use the Criteria API or `Specification` pattern instead.

```java
// WRONG: Too many specific methods
findByUserAndStatusAndDateRange()
findByUserAndStatusAndDateRangeAndMinTotal()
findByUserAndStatusAndDateRangeAndMaxTotal()

// CORRECT: Use Specifications or Criteria API for dynamic queries
```

---

## Summary

1. Repository abstracts data access behind a collection-like interface
2. Domain-specific repositories expose business-relevant query methods
3. Spring Data JPA provides automatic implementations for derived queries
4. Custom implementations handle complex queries via Criteria API
5. Composition (extend multiple interfaces) is preferred over inheritance
6. Use Specifications for reusable, combinable query predicates
7. Repositories should not expose persistence technology details
8. Test repositories with integration tests using embedded databases
9. One repository per aggregate root in DDD
10. DTO projections reduce data transfer for read models

---

## References

- [Repository Pattern - Martin Fowler](https://martinfowler.com/eaaCatalog/repository.html)
- [Spring Data JPA Reference](https://docs.spring.io/spring-data/jpa/reference/)
- [DDD - Repository Pattern](https://domaindrivendesign.org/books/)
- [Baeldung - Repository Pattern](https://www.baeldung.com/repository-pattern-in-spring)

Happy Coding
