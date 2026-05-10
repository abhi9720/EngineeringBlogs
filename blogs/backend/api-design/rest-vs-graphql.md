---
title: "REST vs GraphQL"
description: "Compare REST and GraphQL API paradigms: when to use each, performance trade-offs, and practical implementation patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - rest-api
  - graphql
  - api-design
coverImage: "/images/rest-vs-graphql.png"
draft: false
---

# REST vs GraphQL: Making the Right Choice

## Overview

REST and GraphQL are the two dominant API paradigms. REST uses resource-based URLs and standard HTTP methods, while GraphQL offers a flexible query language for fetching exactly what clients need. Understanding when to use each is crucial for building effective APIs.

---

## Core Differences

### REST: Resource-Based

```java
// REST API: Multiple endpoints for different resources

@RestController
@RequestMapping("/api")
public class UserController {
    
    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id);
    
    @GetMapping("/users/{id}/orders")
    public List<Order> getUserOrders(@PathVariable Long id);
    
    @GetMapping("/users/{id}/orders/{orderId}/items")
    public List<OrderItem> getOrderItems(
        @PathVariable Long id,
        @PathVariable Long orderId);
}

// Client makes multiple HTTP requests
// GET /api/users/1
// GET /api/users/1/orders
// GET /api/users/1/orders/123/items
```

### GraphQL: Client-Driven Queries

```java
// GraphQL: Single endpoint, flexible queries

// Schema
type Query {
    user(id: ID!): User
}

type User {
    id: ID!
    name: String
    orders: [Order]
}

type Order {
    id: ID!
    items: [OrderItem]
}

// Client requests exactly what they need
POST /graphql

{
    user(id: "1") {
        name
        orders {
            id
            items {
                productName
                quantity
            }
        }
    }
}

// Single request gets all data
// Response contains exactly what was requested
```

---

## Trade-offs

| Aspect | REST | GraphQL |
|--------|------|---------|
| **Data Fetching** | Fixed response per endpoint | Client specifies fields |
| **Over-fetching** | Common | Avoided |
| **Under-fetching** | Common | Avoided |
| **Caching** | HTTP caching | Requires custom caching |
| **Learning Curve** | Lower | Higher |
| **Monitoring** | Simple | Complex |
| **File Upload** | Easy | Requires workarounds |

---

## Real-World Use Cases

### REST for Simple CRUD

```java
// REST is great for resource-oriented APIs
@RestController
@RequestMapping("/api/products")
public class ProductController {
    
    @GetMapping
    public Page<Product> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size);
    
    @GetMapping("/{id}")
    public Product get(@PathVariable Long id);
    
    @PostMapping
    public Product create(@Valid @RequestBody CreateProductRequest request);
    
    @PutMapping("/{id}")
    public Product update(@PathVariable Long id, @Valid @RequestBody UpdateProductRequest request);
    
    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id);
}
```

### GraphQL for Complex Data Requirements

```java
// GraphQL is great when clients need flexible data shapes

// Schema for dashboard
type Query {
    dashboard(userId: ID!): Dashboard
}

type Dashboard {
    user: UserInfo
    recentOrders: [OrderSummary]
    notifications: [Notification]
    stats: UserStats
    recommendations: [Product]
}

// Client can fetch all dashboard data in one query
// Or fetch specific parts based on UI needs

// Web: Full dashboard
query {
    dashboard(userId: "1") {
        user { name email }
        recentOrders { id status total }
        notifications { id read }
    }
}

// Mobile: Lightweight
query {
    dashboard(userId: "1") {
        user { name }
        recentOrders { id }
    }
}
```

---

## Implementation Patterns

### Spring REST Implementation

```java
@RestController
@RequestMapping("/api/users")
public class RestUserController {
    
    @GetMapping("/{id}")
    public ResponseEntity<User> getUser(@PathVariable Long id) {
        return userService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
}
```

### Spring GraphQL Implementation

```java
// Add spring-boot-starter-graphql

// Schema: src/main/resources/graphql/schema.graphqls
type Query {
    user(id: ID!): User
}

type User {
    id: ID!
    name: String!
    email: String!
    orders: [Order]
}

// Controller
@Controller
public class GraphQLUserController {
    
    @QueryMapping
    public User user(@Argument Long id) {
        return userService.findById(id).orElse(null);
    }
}
```

---

## Common Mistakes

### Mistake 1: Using GraphQL for Simple APIs

```java
// WRONG: Using GraphQL for basic CRUD
// Added complexity without benefit

// CORRECT: Use REST for simple CRUD APIs
// GraphQL adds overhead - use when flexibility is needed
```

### Mistake 2: Over-Fetching in REST

```java
// WRONG: Many endpoints return too much data

// CORRECT: Create specific endpoints or use GraphQL
@RestController
public class OptimizedController {
    
    @GetMapping("/users/{id}/summary")
    public UserSummary getUserSummary(@PathVariable Long id) {
        // Returns only needed fields
    }
}
```

---

## Summary

- **REST**: Simple, widely understood, great for standard CRUD
- **GraphQL**: Flexible, great for complex data requirements and varying clients

Choose based on your specific needs, not trends.

---

## References

- [GraphQL](https://graphql.org/)
- [REST API Design Best Practices](https://restfulapi.net/)
- [Apollo GraphQL](https://www.apollographql.com/)