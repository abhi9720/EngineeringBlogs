---
title: "Native Queries vs JPQL"
description: "Compare native SQL queries vs JPQL in JPA: when to use each, performance considerations, result mapping, and best practices for complex queries"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - jpql
  - native-queries
  - jpa
  - hibernate
coverImage: "/images/backend/data-access/orm/native-queries-vs-jpql.png"
draft: false
---

# Native Queries vs JPQL

## Overview

JPA provides JPQL (Java Persistence Query Language) for database-independent queries and native SQL for database-specific operations. JPQL queries entities using their object model, while native queries operate directly on database tables. Understanding when to use each is crucial for balancing portability, performance, and expressiveness.

---

## JPQL (Java Persistence Query Language)

### Basic JPQL Queries

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    // Simple JPQL - entity-based query
    @Query("SELECT o FROM Order o WHERE o.status = :status")
    List<Order> findByStatus(@Param("status") OrderStatus status);

    // JPQL with JOIN FETCH to avoid N+1
    @Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.id = :id")
    Optional<Order> findByIdWithItems(@Param("id") Long id);

    // JPQL with aggregate functions
    @Query("SELECT COUNT(o) FROM Order o WHERE o.createdAt BETWEEN :start AND :end")
    long countOrdersBetween(@Param("start") LocalDateTime start,
                            @Param("end") LocalDateTime end);

    // JPQL with subquery
    @Query("SELECT u FROM User u WHERE u.id IN " +
           "(SELECT o.user.id FROM Order o WHERE o.total > :minTotal)")
    List<User> findUsersWithHighValueOrders(@Param("minTotal") BigDecimal minTotal);

    // JPQL with CASE expression
    @Query("SELECT o.id, " +
           "CASE WHEN o.total > 1000 THEN 'HIGH' " +
           "     WHEN o.total > 500 THEN 'MEDIUM' " +
           "     ELSE 'LOW' END AS priority " +
           "FROM Order o WHERE o.status = 'PENDING'")
    List<Object[]> findOrderPriorities();

    // JPQL constructor expression (DTO projection)
    @Query("SELECT new com.example.dto.OrderSummary(o.id, o.orderNumber, o.status, o.total) " +
           "FROM Order o WHERE o.user.id = :userId")
    List<OrderSummary> findOrderSummariesByUser(@Param("userId") Long userId);
}
```

### JPQL Service Layer

```java
@Service
public class OrderQueryService {

    private final EntityManager entityManager;

    public OrderQueryService(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public List<Order> findOrdersWithPagination(int page, int size, String sortBy) {
        TypedQuery<Order> query = entityManager.createQuery(
            "SELECT o FROM Order o ORDER BY o." + sortBy + " DESC", Order.class);

        query.setFirstResult(page * size);
        query.setMaxResults(size);

        return query.getResultList();
    }

    @Transactional(readOnly = true)
    public Page<Order> findOrdersPageable(Pageable pageable) {
        // Count query
        TypedQuery<Long> countQuery = entityManager.createQuery(
            "SELECT COUNT(o) FROM Order o", Long.class);
        long total = countQuery.getSingleResult();

        // Data query with pagination
        TypedQuery<Order> query = entityManager.createQuery(
            "SELECT o FROM Order o ORDER BY o.createdAt DESC", Order.class);
        query.setFirstResult((int) pageable.getOffset());
        query.setMaxResults(pageable.getPageSize());

        return new PageImpl<>(query.getResultList(), pageable, total);
    }
}
```

---

## Native SQL Queries

### When to Use Native Queries

```java
@Repository
public interface ProductRepository extends JpaRepository<Product, Long> {

    // Native query for database-specific features
    @Query(value = "SELECT p.*, " +
                   "EXTRACT(YEAR FROM p.created_at) as year, " +
                   "EXTRACT(MONTH FROM p.created_at) as month, " +
                   "RANK() OVER (PARTITION BY EXTRACT(YEAR FROM p.created_at) " +
                   "            ORDER BY p.sales_count DESC) as sales_rank " +
                   "FROM products p " +
                   "WHERE p.status = 'ACTIVE' " +
                   "ORDER BY sales_rank",
           nativeQuery = true)
    List<Object[]> findTopProductsByYear();

    // Native query with result mapping
    @Query(value = "SELECT p.id, p.name, p.price, " +
                   "COALESCE(AVG(r.rating), 0) as avg_rating " +
                   "FROM products p " +
                   "LEFT JOIN reviews r ON p.id = r.product_id " +
                   "GROUP BY p.id, p.name, p.price " +
                   "HAVING COALESCE(AVG(r.rating), 0) >= :minRating " +
                   "ORDER BY avg_rating DESC",
           nativeQuery = true)
    List<Object[]> findTopRatedProducts(@Param("minRating") double minRating);

    // Full-text search (PostgreSQL specific)
    @Query(value = "SELECT p.* FROM products p " +
                   "WHERE to_tsvector('english', p.name || ' ' || COALESCE(p.description, '')) " +
                   "@@ to_tsquery('english', :searchTerm) " +
                   "ORDER BY ts_rank(to_tsvector('english', p.name || ' ' || COALESCE(p.description, '')), " +
                   "              to_tsquery('english', :searchTerm)) DESC",
           nativeQuery = true)
    List<Product> searchProductsFullText(@Param("searchTerm") String searchTerm);

    // Recursive CTE (PostgreSQL specific)
    @Query(value = "WITH RECURSIVE category_tree AS ( " +
                   "  SELECT id, name, parent_id, 0 as level " +
                   "  FROM categories WHERE id = :rootId " +
                   "  UNION ALL " +
                   "  SELECT c.id, c.name, c.parent_id, ct.level + 1 " +
                   "  FROM categories c " +
                   "  INNER JOIN category_tree ct ON c.parent_id = ct.id " +
                   ") " +
                   "SELECT * FROM category_tree ORDER BY level",
           nativeQuery = true)
    List<Object[]> findCategoryTree(@Param("rootId") Long rootId);

    // Upsert (PostgreSQL specific)
    @Modifying
    @Query(value = "INSERT INTO inventory (product_id, quantity, updated_at) " +
                   "VALUES (:productId, :quantity, NOW()) " +
                   "ON CONFLICT (product_id) DO UPDATE SET " +
                   "  quantity = inventory.quantity + :quantity, " +
                   "  updated_at = NOW()",
           nativeQuery = true)
    void upsertInventory(@Param("productId") Long productId,
                         @Param("quantity") int quantity);
}
```

### Native Query with Entity Mapping

```java
@Service
public class NativeQueryService {

    private final EntityManager entityManager;

    public NativeQueryService(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public List<Product> findProductsByCustomLogic() {
        // Native query mapping to entities
        Query query = entityManager.createNativeQuery(
            "SELECT DISTINCT p.* FROM products p " +
            "JOIN order_items oi ON p.id = oi.product_id " +
            "JOIN orders o ON oi.order_id = o.id " +
            "WHERE o.status IN ('SHIPPED', 'DELIVERED') " +
            "AND o.created_at >= NOW() - INTERVAL '30 days' " +
            "GROUP BY p.id " +
            "HAVING COUNT(o.id) > 5 " +
            "ORDER BY COUNT(o.id) DESC",
            Product.class);

        return query.getResultList();
    }

    @Transactional(readOnly = true)
    public List<ProductSummary> findProductSummaries() {
        // Native query with custom result mapping
        Query query = entityManager.createNativeQuery(
            "SELECT p.id, p.name, p.price, " +
            "COUNT(DISTINCT oi.order_id) as order_count, " +
            "COALESCE(SUM(oi.quantity * oi.unit_price), 0) as revenue " +
            "FROM products p " +
            "LEFT JOIN order_items oi ON p.id = oi.product_id " +
            "GROUP BY p.id, p.name, p.price " +
            "ORDER BY revenue DESC",
            "ProductSummaryMapping");

        return query.getResultList();
    }

    @Transactional
    public int bulkUpdateStatus(OrderStatus oldStatus, OrderStatus newStatus) {
        // Native update for bulk operations
        Query query = entityManager.createNativeQuery(
            "UPDATE orders SET status = :newStatus, " +
            "updated_at = NOW() " +
            "WHERE status = :oldStatus " +
            "AND created_at < NOW() - INTERVAL '90 days'");

        query.setParameter("newStatus", newStatus.name());
        query.setParameter("oldStatus", oldStatus.name());

        return query.executeUpdate();
    }
}
```

---

## Performance Considerations

### Native Query Performance Advantages

```java
@Service
public class PerformanceComparisonService {

    @PersistenceContext
    private EntityManager entityManager;

    // JPQL query - Hibernate generates SQL
    public long countByStatusJPQL(OrderStatus status) {
        TypedQuery<Long> query = entityManager.createQuery(
            "SELECT COUNT(o) FROM Order o WHERE o.status = :status",
            Long.class);
        query.setParameter("status", status);
        return query.getSingleResult();
        // Generated SQL: SELECT COUNT(o.id) FROM orders o WHERE o.status = ?
    }

    // Native query - direct SQL
    public long countByStatusNative(String status) {
        Query query = entityManager.createNativeQuery(
            "SELECT COUNT(*) FROM orders WHERE status = :status");
        query.setParameter("status", status);
        return ((Number) query.getSingleResult()).longValue();
        // Direct SQL, no translation overhead
    }

    // JPQL join fetch generates specific SQL
    public List<Order> findWithItemsJPQL() {
        TypedQuery<Order> query = entityManager.createQuery(
            "SELECT DISTINCT o FROM Order o LEFT JOIN FETCH o.items",
            Order.class);
        return query.getResultList();
        // May not use optimal join strategy
    }

    // Native gives full control over join strategy
    public List<Order> findWithItemsNative() {
        Query query = entityManager.createNativeQuery(
            "SELECT o.* FROM orders o " +
            "WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id) " +
            "ORDER BY o.created_at DESC",
            Order.class);
        return query.getResultList();
    }
}
```

### When JPQL is Better

```java
// JPQL advantages:
// 1. Database portability
// 2. Automatic result mapping
// 3. Lazy loading support
// 4. Cache integration
// 5. Entity state management

// Use JPQL when:
// - Query is portable across databases
// - Need entity mapping with lazy loading
// - Need persistence context integration
// - Query is simple CRUD or basic reporting

// Use Native when:
// - Need database-specific features (window functions, CTE, full-text)
// - Performance critical queries need optimization
// - Bulk operations that bypass entity management
// - Complex reporting queries
// - Need to use stored procedures
```

---

## Result Mapping

### SqlResultSetMapping

```java
// Define result mapping on an entity
@SqlResultSetMapping(
    name = "ProductSummaryMapping",
    entities = @EntityResult(entityClass = Product.class),
    columns = {
        @ColumnResult(name = "order_count", type = Long.class),
        @ColumnResult(name = "revenue", type = BigDecimal.class)
    }
)
@Entity
public class Product {
    // ...
}

// Constructor result mapping
@SqlResultSetMapping(
    name = "OrderReportMapping",
    classes = @ConstructorResult(
        targetClass = OrderReport.class,
        columns = {
            @ColumnResult(name = "order_id", type = Long.class),
            @ColumnResult(name = "order_number"),
            @ColumnResult(name = "customer_name"),
            @ColumnResult(name = "total", type = BigDecimal.class),
            @ColumnResult(name = "item_count", type = Integer.class)
        }
    )
)
public class OrderReport {
    private Long orderId;
    private String orderNumber;
    private String customerName;
    private BigDecimal total;
    private int itemCount;
}
```

---

## Best Practices

1. **Start with JPQL**: Most queries can be expressed in JPQL
2. **Use native SQL for database-specific features**: Full-text search, CTE, window functions
3. **Profile both approaches**: Measure performance with realistic data
4. **Use constructor expressions in JPQL**: DTO projections avoid full entity loading
5. **Use SqlResultSetMapping for native queries**: Avoid Object[] casting
6. **Prefer JPQL for write operations**: Entity state management benefits
7. **Use native for bulk operations**: Direct SQL bypasses cache overhead
8. **Test portability**: Native queries tie you to specific database
9. **Consider query plan caching**: JPQL benefits from Hibernate's query plan cache
10. **Use @QueryHints for optimization**: Query-specific hints

```java
// JPQL with query hints for optimization
@QueryHints({
    @QueryHint(name = "org.hibernate.fetchSize", value = "100"),
    @QueryHint(name = "org.hibernate.cacheable", value = "true"),
    @QueryHint(name = "org.hibernate.readOnly", value = "true"),
    @QueryHint(name = "org.hibernate.comment", value = "JPQL: findActiveProducts")
})
@Query("SELECT p FROM Product p WHERE p.active = true")
List<Product> findActiveProducts();
```

---

## Common Mistakes

### Mistake 1: Using Native SQL for Simple Queries

```java
// WRONG: Native query for simple JPQL query
@Query(value = "SELECT * FROM users WHERE email = :email", nativeQuery = true)
User findByEmail(@Param("email") String email);

// CORRECT: Simpler JPQL, entity mapping, portability
@Query("SELECT u FROM User u WHERE u.email = :email")
User findByEmail(@Param("email") String email);
```

### Mistake 2: Not Using DTO Projections

```java
// WRONG: Loading full entities when only few fields needed
@Query("SELECT o FROM Order o WHERE o.status = :status")
List<Order> findByStatus(@Param("status") OrderStatus status);

// CORRECT: DTO projection - reduced data transfer
@Query("SELECT new com.example.dto.OrderSummary(o.id, o.orderNumber, o.total) " +
       "FROM Order o WHERE o.status = :status")
List<OrderSummary> findSummariesByStatus(@Param("status") OrderStatus status);
```

### Mistake 3: Native Queries Without Result Mapping

```java
// WRONG: Working with Object[] - fragile
List<Object[]> results = query.getResultList();
for (Object[] row : results) {
    Long id = (Long) row[0];     // Cast by position
    String name = (String) row[1]; // What if column order changes?
}

// CORRECT: Use @SqlResultSetMapping or @ConstructorResult
```

---

## Summary

1. JPQL is database-portable, entity-aware, and integrates with caching
2. Native SQL provides database-specific features and full query control
3. Use JPQL for most queries, native SQL for specialized needs
4. DTO projections reduce data transfer in both JPQL and native queries
5. SqlResultSetMapping provides type-safe native query results
6. Native queries are necessary for window functions, CTE, full-text search
7. Profile query performance with both approaches
8. Consider database portability requirements
9. Bulk operations often perform better with native SQL
10. Test native queries during database upgrades

---

## References

- [JPQL Language Reference](https://jakarta.ee/specifications/persistence/3.1/jakarta-persistence-spec-3.1#a10992)
- [Hibernate Query Language](https://docs.jboss.org/hibernate/orm/6.2/userguide/html_single/Hibernate_User_Guide.html#hql)
- [Native SQL Queries](https://docs.jboss.org/hibernate/orm/6.2/userguide/html_single/Hibernate_User_Guide.html#sql)
- [Baeldung JPQL vs Native](https://www.baeldung.com/spring-data-jpa-query)

Happy Coding