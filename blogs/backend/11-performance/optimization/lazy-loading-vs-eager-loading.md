---
title: Lazy Loading vs Eager Loading
description: >-
  Compare lazy and eager loading strategies in JPA: fetch types, N+1 problem
  solutions, and performance trade-offs
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - performance
  - optimization
  - jpa
  - hibernate
  - lazy-loading
coverImage: /images/lazy-loading-vs-eager-loading.png
draft: false
order: 110
type: comparison
---
# Lazy Loading vs Eager Loading

## Overview

Lazy and eager loading define when JPA loads associated entities. Lazy loading defers loading until the association is accessed. Eager loading loads associations immediately with the parent entity. Choosing incorrectly causes either N+1 query problems or unnecessary data loading.

### The Core Trade-off

- **Lazy**: Load only when needed (efficient, but causes N+1)
- **Eager**: Load immediately (convenient, but may load unnecessary data)

---

## Fetch Types

### Configuration

```java
@Entity
public class Order {

    @Id
    @GeneratedValue
    private Long id;

    // Default fetch types:
    @ManyToOne(fetch = FetchType.EAGER)   // Default for @ManyToOne
    private Customer customer;

    @OneToMany(fetch = FetchType.LAZY)    // Default for @OneToMany
    private List<OrderItem> items;

    @OneToOne(fetch = FetchType.EAGER)    // Default for @OneToOne
    private ShippingInfo shippingInfo;

    @ManyToMany(fetch = FetchType.LAZY)   // Default for @ManyToMany
    private Set<Promotion> promotions;

    // Entity fields are always EAGER
    @Basic(fetch = FetchType.LAZY)        // Lazy loading for basic fields
    @Lob
    private String largeDescription;       // Load on demand
}
```

### The LazyInitializationException

```java
@Service
public class LazyLoadingService {

    @Transactional(readOnly = true)
    public Order getOrder(Long id) {
        Order order = orderRepository.findById(id).orElseThrow();
        // Transaction is still open, lazy loading works

        List<OrderItem> items = order.getItems(); // Works
        return order;
    }

    public void processOrderOutsideTransaction(Long id) {
        Order order = orderRepository.findById(id).orElseThrow();
        // Transaction is closed (no @Transactional)

        // FAILS: LazyInitializationException
        List<OrderItem> items = order.getItems();
    }
}
```

The `LazyInitializationException` occurs when a lazy association is accessed outside an active Hibernate session. Inside `@Transactional`, the session stays open and can issue the extra query on demand. Without the annotation, the session is closed when the repository method returns, and the proxy collection throws an exception. The fix is either to keep the transaction open (simple but leaks connections) or to eagerly fetch the needed data before the session closes — the recommended approach. Never rely on Open Session in View to mask this error; it only delays the problem and hides N+1 queries until production load.

---

## N+1 Query Problem

### The Problem

```java
@Entity
public class Order {
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    private List<OrderItem> items;
}

// N+1 happens here:
@Service
public class NPlusOneService {

    @Transactional(readOnly = true)
    public void listOrderItems() {
        List<Order> orders = orderRepository.findAll();
        // 1 query: SELECT * FROM orders

        for (Order order : orders) {
            int count = order.getItems().size();
            // N queries: SELECT * FROM order_items WHERE order_id = ?
            // For 100 orders: 1 + 100 = 101 queries!
        }
    }
}
```

### Solutions

#### 1. JOIN FETCH

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT DISTINCT o FROM Order o JOIN FETCH o.items")
    List<Order> findAllWithItems();

    // Single query with JOIN:
    // SELECT o.*, oi.*
    // FROM orders o
    // JOIN order_items oi ON oi.order_id = o.id
}
```

#### 2. Entity Graphs

```java
@Entity
@NamedEntityGraphs({
    @NamedEntityGraph(name = "Order.withItems",
        attributeNodes = @NamedAttributeNode("items")),
    @NamedEntityGraph(name = "Order.withCustomerAndItems",
        attributeNodes = {
            @NamedAttributeNode("customer"),
            @NamedAttributeNode("items")
        })
})
public class Order {
    // ...
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @EntityGraph("Order.withItems")
    List<Order> findAll();

    @EntityGraph("Order.withCustomerAndItems")
    Optional<Order> findById(Long id);
}
```

#### 3. Batch Fetching

```yaml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
        batch_fetch_style: padded
```

```java
// With batch fetching:
// SELECT * FROM orders (1 query)
// SELECT * FROM order_items WHERE order_id IN (?, ?, ?...100)
// For 100 orders: 2 queries instead of 101
```

Batch fetching is the least invasive N+1 fix — it requires no query changes. When Hibernate detects a lazy collection access, it groups the pending identifiers into batches of `default_batch_fetch_size`. The `padded` style rounds batch sizes up to the nearest multiple, ensuring consistent SQL plans. A reasonable default is 100; setting it too high (1000+) can generate very large `IN` lists that degrade performance on both the database and the network.

#### 4. DTO Projections

```java
public interface OrderSummary {
    Long getId();
    String getStatus();
    BigDecimal getTotal();
    int getItemCount();  // Database computes this
}

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    @Query("SELECT o.id AS id, o.status AS status, o.total AS total, " +
           "       SIZE(o.items) AS itemCount " +
           "FROM Order o")
    List<OrderSummary> findOrderSummaries();
}
```

---

## Eager Loading Pitfalls

### Over-Fetching

```java
// BAD: Eager loading everywhere
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.EAGER)
    private Customer customer;

    @OneToOne(fetch = FetchType.EAGER)
    private ShippingInfo shippingInfo;

    @OneToMany(fetch = FetchType.EAGER)  // Multiple bags!
    private List<OrderItem> items;

    @ManyToMany(fetch = FetchType.EAGER)
    private Set<Promotion> promotions;
}

// Loading one Order loads:
// - 1 Customer
// - 1 ShippingInfo
// - N OrderItems
// - M Promotions
// = Cartesion product: N * M rows!

// Worse: MultipleBagFetchException
// Hibernate can't fetch multiple lists eagerly
```

### Eager Loading in Unexpected Places

```java
@Entity
public class Customer {
    @OneToMany(mappedBy = "customer", fetch = FetchType.EAGER)
    private List<Order> orders;
}

// Loading any Customer loads ALL their orders
Customer customer = customerRepository.findById(1L).orElseThrow();
// 1 query for customer + 1 query for ALL orders
// Even if you only need the customer's name!

// Recommendation: Keep @OneToMany and @ManyToMany as LAZY
```

Eager loading is insidious because the cost is hidden: a simple `findById` that looks like a single-row lookup suddenly triggers a second query fetching potentially thousands of child rows. This is especially dangerous in list endpoints where `findAll()` on `Customer` loads every order for every customer — a textbook Cartesian product explosion. The rule of thumb: `@ManyToOne` and `@OneToOne` defaults to EAGER for a reason (the FK is in the same row), but `@OneToMany` and `@ManyToMany` should always be LAZY and fetched explicitly when needed.

---

## Choosing the Right Strategy

### Decision Matrix

| Scenario | Strategy | Reason |
|----------|----------|--------|
| Detail page with all associations | EAGER (via EntityGraph) | Need everything |
| List page with summary | LAZY + DTO Projection | Minimal data |
| Always need association | LAZY + JOIN FETCH | Control per query |
| Rarely need association | LAZY + Batch Fetching | Default safe |
| Single association | LAZY | Always use LAZY |

### Best Practice: Always Use LAZY by Default

```java
@Entity
public class Order {

    // Always LAZY
    @ManyToOne(fetch = FetchType.LAZY)
    private Customer customer;

    @OneToMany(fetch = FetchType.LAZY)
    private List<OrderItem> items;

    // Override at query time
    @Repository
    public interface OrderRepository {

        @EntityGraph(attributePaths = {"customer", "items"})
        Optional<Order> findByIdWithAll(Long id);
    }
}
```

---

## Open Session in View (OSIV)

### The Anti-Pattern

```yaml
# application.yml - Default in Spring Boot
spring:
  jpa:
    open-in-view: true  # WARNING: Keeps session open during view rendering
```

```java
// OSIV keeps the Hibernate session open for the entire HTTP request
// This means lazy loading works even in views
// But it also means:

// 1. Database connection held for entire request
// 2. Lazy loading happens at unexpected times
// 3. Performance issues from accidental N+1 in templates
// 4. Difficult to detect in development

// Recommendation: DISABLE OSIV in production
spring:
  jpa:
    open-in-view: false
```

### Without OSIV

```java
@Service
public class OrderService {

    @Transactional(readOnly = true)
    public OrderWithItems getOrderWithItems(Long id) {
        Order order = orderRepository.findByIdWithItems(id);
        // All needed data loaded before transaction closes
        return new OrderWithItems(order);
    }
}

public record OrderWithItems(Order order, List<OrderItem> items) {
    public OrderWithItems(Order order) {
        this(order, order.getItems());
        // Lazy loading happens inside the transaction
    }
}
```

---

## Performance Impact

### Query Count Comparison

| Scenario | Queries | Data Loaded |
|----------|---------|-------------|
| LAZY (no access) | 1 | Order only |
| LAZY (access items) | 1 + N | Order + requested items |
| EAGER | 1 + joins | Order + all associations |
| JOIN FETCH | 1 | Order + items (join) |
| Batch Fetching | 1 + 1 | Order + items (batched) |
| DTO Projection | 1 | Selected fields only |

### Memory Impact

```java
// LAZY: Minimal memory if items not accessed
Order order = orderRepository.findById(1L).orElseThrow();
// Memory: Order fields only

// EAGER: Full memory always
Order order = eagerRepository.findById(1L).orElseThrow();
// Memory: Order + Customer + Items + Promotions

// Large dataset difference:
// 10,000 orders × 10 items each
// LAZY (not accessed): ~2MB
// EAGER: ~200MB
```

---

## Best Practices

### 1. Default to LAZY

```java
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.LAZY)
    private Customer customer;

    @OneToMany(fetch = FetchType.LAZY)
    private List<OrderItem> items;

    @ManyToMany(fetch = FetchType.LAZY)
    private Set<Tag> tags;
}
```

### 2. Use Entity Graphs for Specific Queries

```java
@EntityGraph(attributePaths = {"customer", "items"})
List<Order> findByIdIn(List<Long> ids);
```

### 3. Disable OSIV

```yaml
spring:
  jpa:
    open-in-view: false
```

### 4. Monitor with Hibernate Statistics

```yaml
spring:
  jpa:
    properties:
      hibernate:
        generate_statistics: true
```

---

## Common Mistakes

### Mistake 1: Using EAGER as Default

```java
// WRONG: Schema-wide EAGER
// Causes cartesian products and memory issues

// CORRECT: LAZY default, overridden per query
```

### Mistake 2: Not Closing Transactions

```java
// WRONG: Lazy load outside transaction
public List<OrderItem> getItems(Long orderId) {
    Order order = orderRepository.findById(orderId).orElseThrow();
    // @Transactional not present
    return order.getItems(); // LazyInitializationException
}

// CORRECT: Load inside transaction
@Transactional(readOnly = true)
public List<OrderItem> getItems(Long orderId) {
    Order order = orderRepository.findById(orderId).orElseThrow();
    return order.getItems(); // Works
}
```

### Mistake 3: Multiple Bag Exception

```java
// WRONG: Two EAGER lists
@Entity
public class Order {
    @OneToMany(fetch = FetchType.EAGER)
    private List<OrderItem> items;

    @ManyToMany(fetch = FetchType.EAGER)
    private List<Promotion> promotions;
    // MultipleBagFetchException!
}

// CORRECT: Use Set or load separately
@OneToMany(fetch = FetchType.LAZY)
private Set<OrderItem> items;
```

---

## Summary

1. **Default to LAZY** for all associations
2. **Use JOIN FETCH** or Entity Graphs for specific queries needing associations
3. **Use batch fetching** as safety net
4. **Disable OSIV** in production
5. **Use DTO projections** for lists
6. **Monitor** with Hibernate statistics
7. **Avoid multiple EAGER list fetches**

---

## References

- [Hibernate Fetching Strategies](https://docs.jboss.org/hibernate/orm/5.6/userguide/html_single/Hibernate_User_Guide.html#fetching)
- [JPA Entity Graphs](https://www.baeldung.com/jpa-entity-graph)
- [Open Session in View](https://www.baeldung.com/spring-open-session-in-view)

Happy Coding
