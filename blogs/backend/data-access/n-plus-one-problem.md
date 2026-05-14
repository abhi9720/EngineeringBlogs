---
title: "N+1 Problem"
description: "Understand and solve the N+1 query problem in Hibernate: fetch joins, entity graphs, and batch fetching solutions"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - hibernate
  - n-plus-1
  - jpa
  - performance
coverImage: "/images/n-plus-one-problem.png"
draft: false
---

# The N+1 Query Problem

## Overview

The N+1 problem is the most common performance issue in Hibernate applications. When fetching a list of entities and accessing their lazy collections, Hibernate executes one query for the list plus N queries for each entity's collection—destroying performance.

---

## Understanding the Problem

The N+1 problem occurs because Hibernate uses lazy loading by default for collections. When you iterate over a `List<Order>` and call `order.getCustomer()` or `order.getItems()` on each element, Hibernate executes a separate SQL query for every single element in the list. If you have 100 orders, that is 1 query to fetch the orders plus 100 queries to fetch each order's related data—101 database round trips instead of 1. This pattern is easy to miss in development with small datasets but becomes a critical performance bottleneck at production scale.

```java
// Query 1: Get all orders (10 orders)
List<Order> orders = orderRepository.findAll();

// For each order, Hibernate lazy loads the customer:
// Query 2-11: SELECT * FROM customers WHERE id = ?
// Total: 11 queries for 10 orders!

for (Order order : orders) {
    System.out.println(order.getCustomer().getName());  // Triggers lazy load
}
```

---

## Solutions

### 1. Fetch Join

The `JOIN FETCH` directive in JPQL tells Hibernate to include the specified association in the main query via a SQL `JOIN`, loading everything in a single round trip. When using pagination, however, you must provide a separate `countQuery` because the join can affect the row count used for total calculation.

```java
// Single query with JOIN
@Query("SELECT o FROM Order o JOIN FETCH o.customer")
List<Order> findAllWithCustomer();

// Also works with pagination
@Query(value = "SELECT o FROM Order o JOIN FETCH o.customer",
       countQuery = "SELECT COUNT(o) FROM Order o")
Page<Order> findAllWithCustomer(Pageable pageable);
```

### 2. Entity Graph

`@EntityGraph` is a JPA 2.1 feature that allows you to define fetch plans declaratively. It is cleaner than adding `JOIN FETCH` to every query method and supports dynamic attribute paths. Under the hood, Hibernate still generates the appropriate joins, but the specification remains at the repository level rather than in the JPQL string.

```java
// Declare which associations to fetch
@EntityGraph(attributePaths = {"customer", "items"})
Optional<Order> findById(Long id);

// Dynamic entity graph
@EntityGraph(attributePaths = {"customer", "items"})
List<Order> findByStatus(String status);
```

### 3. Batch Fetching

When fetch joins are not practical (e.g., when accessing associations on already-loaded entities or when the associations are not known at query time), `@BatchSize` provides a pragmatic solution. Instead of executing individual queries for each lazy load, Hibernate groups them into batches of the specified size, reducing the total number of database round trips from N to N/size.

```java
// Configure on entity
@Entity
public class Order {
    
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    @BatchSize(size = 100)  // Fetch 100 orders' items at a time
    private List<OrderItem> items;
}

// Without @BatchSize: 1 + 10 queries
// With @BatchSize: 1 + 1 queries (batched)
```

---

## Common Mistakes

### Mistake: Not Using Fetch Join

The simplest mistake is being unaware that lazy loading is happening at all. Always enable Hibernate SQL logging (`spring.jpa.show-sql=true`) during development to see the actual queries being executed. If you see repeated identical queries in a loop, you have an N+1 situation.

```java
// WRONG: Causes N+1
for (Order order : orders) {
    order.getCustomer().getName();
}

// CORRECT: Use fetch join
@Query("SELECT o FROM Order o JOIN FETCH o.customer")
List<Order> findAllWithCustomer();
```

---

## Summary

1. **Always use fetch join** when you need related data
2. **Use entity graphs** for dynamic fetching
3. **Batch fetch** large collections with @BatchSize
4. **Check generated SQL** in development to catch N+1

---

## References

- [Hibernate ORM - Fetching Strategies](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/chapters/fetching/Fetching.html)
- [Baeldung - N+1 Problem](https://www.baeldung.com/hibernate-n-plus-1)

---

Happy Coding
