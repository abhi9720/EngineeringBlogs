---
title: "Hibernate Lazy vs Eager Loading"
description: "Understand Hibernate fetch strategies: LazyInitializationException causes, when to use eager loading, and performance optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - hibernate
  - lazy-loading
  - jpa
  - performance
coverImage: "/images/hibernate-lazy-vs-eager-loading.png"
draft: false
---

# Hibernate Lazy vs Eager Loading

## Overview

Hibernate's loading strategy determines when related entities are fetched from the database. The wrong choice leads to performance issues (N+1 queries) or runtime exceptions (LazyInitializationException). This guide explains both strategies and when to use each.

---

## How Loading Strategies Work

### Eager Loading

Fetches related data immediately in the same query:

```java
@Entity
public class Order {
    
    @Id
    @GeneratedValue
    private Long id;
    
    private BigDecimal total;
    
    @ManyToOne(fetch = FetchType.EAGER)  // Fetch immediately
    private Customer customer;
}

// This executes: SELECT * FROM orders o LEFT JOIN customer c ON ...
// Both order and customer loaded together
```

### Lazy Loading

Delays fetching until accessed:

```java
@Entity
public class Order {
    
    @Id
    @GeneratedValue
    private Long id;
    
    @ManyToOne(fetch = FetchType.LAZY)  // Default for @ManyToOne
    private Customer customer;
}

// Only loads order initially
// Customer fetched only when customer.getName() is called
```

---

## Real-World Use Cases

### Case 1: Proper Lazy Loading with Transactions

```java
@Service
public class OrderService {
    
    @Transactional(readOnly = true)
    public Order getOrderWithCustomer(Long orderId) {
        Order order = orderRepository.findById(orderId).orElseThrow();
        
        // Access within transaction - works!
        Customer customer = order.getCustomer();
        
        return order;
    }
}

// If accessed outside transaction:
@RestController
public class BadOrderController {
    
    @GetMapping("/orders/{id}")
    public Order getOrder(@PathVariable Long id) {
        Order order = orderService.getOrderWithoutTransaction(id);
        
        // LazyInitializationException here!
        return order.getCustomer().getName();  // Fails!
    }
}

// Fix: Return DTO or use fetch join
@Service
public class GoodOrderService {
    
    @Transactional(readOnly = true)
    public OrderDTO getOrderDto(Long orderId) {
        Order order = orderRepository.findById(orderId).orElseThrow();
        
        return OrderDTO.builder()
            .id(order.getId())
            .customerName(order.getCustomer().getName())  // Loaded in transaction
            .build();
    }
}
```

### Case 2: Eager Loading for Known Needs

```java
// When you know you'll need the related data
public interface OrderRepository extends JpaRepository<Order, Long> {
    
    @EntityGraph(attributePaths = {"customer", "items"})
    Optional<Order> findByIdWithDetails(Long id);
    
    @Query("SELECT o FROM Order o JOIN FETCH o.customer WHERE o.id = :id")
    Optional<Order> findByIdWithCustomer(@Param("id") Long id);
}

@Service
public class OrderDisplayService {
    
    public OrderDTO getOrderForDisplay(Long id) {
        // Use fetch join - single query
        Order order = orderRepository.findByIdWithCustomer(id)
            .orElseThrow();
        
        return mapToDto(order);  // No extra queries
    }
}
```

### Case 3: Batch Loading for Collections

```java
@Entity
public class Author {
    
    @Id
    @GeneratedValue
    private Long id;
    
    private String name;
    
    @OneToMany(mappedBy = "author", fetch = FetchType.LAZY)
    @BatchSize(size = 20)  // Fetch 20 authors' books at a time
    private List<Book> books;
}

// Without BatchSize: 1 + N queries (1 for authors, N for books)
// With BatchSize: 1 + (N/20) queries (batched)
@Service
public class AuthorService {
    
    public List<AuthorWithBooks> getAllAuthorsWithBooks() {
        List<Author> authors = authorRepository.findAll();
        
        // Initial query: SELECT * FROM authors
        // Hibernate uses batch loading for getBooks()
        
        return authors.stream()
            .map(a -> new AuthorWithBooks(a.getName(), a.getBooks().size()))
            .collect(Collectors.toList());
    }
}
```

---

## Common Mistakes

### Mistake 1: Eager Loading Everything

```java
// WRONG: Eager load everything
@Entity
public class Order {
    
    @OneToMany(fetch = FetchType.EAGER)  // BAD!
    private List<OrderItem> items;
    
    @ManyToOne(fetch = FetchType.EAGER)  // BAD!
    private Customer customer;
    
    @ManyToOne(fetch = FetchType.EAGER)  // BAD!
    private Payment payment;
}

// Loading orders triggers 4 queries every time!

// CORRECT: Use LAZY and fetch when needed
@Entity
public class Order {
    
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    private List<OrderItem> items;
    
    @ManyToOne(fetch = FetchType.LAZY)
    private Customer customer;
}
```

### Mistake 2: Accessing Lazy Collections Outside Transaction

```java
// WRONG
@Service
public class BrokenService {
    
    @Transactional
    public Order getOrder(Long id) {
        Order order = orderRepository.findById(id).get();
        return order;  // Order returned but items not loaded
    }
    
    // Outside transaction:
    public void printItems(Order order) {
        // LazyInitializationException!
        order.getItems().forEach(System.out::println);
    }
}

// CORRECT: Fetch within transaction
@Service
public class FixedService {
    
    @Transactional
    public List<Item> getOrderItems(Long orderId) {
        Order order = orderRepository.findById(orderId).get();
        return order.getItems();  // Loaded within transaction
    }
}
```

### Mistake 3: Not Using @Transactional for Read Operations

```java
// WRONG: No transaction, lazy loading fails
@RestController
public class BadController {
    
    @GetMapping("/orders/{id}")
    public Order getOrder(@PathVariable Long id) {
        Order order = orderRepository.findById(id).get();
        
        // If any lazy field accessed -> LazyInitializationException
        return order;
    }
}

// CORRECT: Add @Transactional
@RestController
public class GoodController {
    
    @GetMapping("/orders/{id}")
    @Transactional(readOnly = true)  // Ensures session is open
    public Order getOrder(@PathVariable Long id) {
        return orderRepository.findById(id).get();
    }
}
```

---

## Summary

1. **Default to Lazy**: Use LAZY for most associations
2. **Use Fetch Join**: When you know you need related data
3. **Stay in Transaction**: Access lazy data within @Transactional boundaries
4. **Watch N+1**: Use batch fetching or entity graphs for collections
5. **Profile Queries**: Check generated SQL to ensure efficient fetching

---

## References

- [Hibernate ORM - Fetching](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/chapters/fetching/Fetching.html)
- [Baeldung - JPA Fetch Types](https://www.baeldung.com/hibernate-lazy-eager-fetching)