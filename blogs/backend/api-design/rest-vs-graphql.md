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

REST organizes APIs around resources (nouns) and uses HTTP methods (verbs) to perform operations. Each resource has its own URL endpoint, and relationships between resources are expressed through nested URL paths. The advantage is a clear, predictable structure that maps well to CRUD operations. However, REST can suffer from over-fetching (getting more data than needed) and under-fetching (needing multiple requests to assemble all required data). For example, to display a user with their orders and order items, a client must make three sequential HTTP requests, each adding latency.

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

GraphQL addresses REST's limitations by providing a single endpoint where clients declaratively specify exactly what data they need. A strongly-typed schema defines the available types and relationships, and the server resolves only the requested fields. This eliminates both over-fetching and under-fetching in a single round trip. The trade-off is increased server complexity: the server must resolve a potentially unbounded combination of field requests, and caching becomes more challenging since queries are dynamic rather than URL-addressable.

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

REST shines when your API is fundamentally resource-oriented — creating, reading, updating, and deleting entities. The mapping is straightforward: each resource type becomes a collection endpoint, and HTTP methods map directly to operations. This simplicity means lower cognitive load for API consumers, richer tooling (OpenAPI, Postman collections), and built-in HTTP caching through ETags and Cache-Control headers. For public APIs where third-party developers need to integrate quickly, REST's familiarity and predictable structure are significant advantages.

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

GraphQL excels in scenarios where different clients have different data requirements — a web dashboard might need 20 fields while a mobile app needs only 5. Without GraphQL, you'd either over-fetch on mobile or create multiple REST endpoints for each client variant. GraphQL's field selection lets each client request exactly what it needs from a shared schema. This is particularly valuable for dashboards that aggregate data from multiple domains (users, orders, notifications, recommendations) into a single view.

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

Spring Boot makes REST implementation straightforward with annotations that map HTTP methods and paths directly to controller methods. The `ResponseEntity` API gives fine-grained control over HTTP status codes and headers. REST endpoints in Spring benefit from built-in validation, content negotiation, error handling, and HATEOAS support through the broader Spring ecosystem.

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

Spring GraphQL (spring-boot-starter-graphql) provides first-class GraphQL support with annotation-driven controllers, seamless integration with Spring Security, and reactive execution. The schema is defined in `.graphqls` files, and `@Controller` classes with `@QueryMapping` annotations act as resolvers. Spring GraphQL automatically wires resolvers to schema fields, supports DataLoader for batching, and provides WebSocket-based subscriptions out of the box.

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

GraphQL introduces significant operational complexity compared to REST — you need a schema, resolvers, DataLoader configuration, query complexity analysis, and specialized caching strategies. For APIs with straightforward CRUD operations and simple client requirements, this overhead is not justified. REST's simplicity, mature tooling, and HTTP caching make it the better choice for most public-facing CRUD APIs. Reserve GraphQL for scenarios where its flexibility provides clear value.

```java
// WRONG: Using GraphQL for basic CRUD
// Added complexity without benefit

// CORRECT: Use REST for simple CRUD APIs
// GraphQL adds overhead - use when flexibility is needed
```

### Mistake 2: Over-Fetching in REST

Returning the full entity from every REST endpoint forces clients to download data they don't need, increasing bandwidth consumption and latency — especially problematic for mobile clients on slow connections. Common solutions include creating specialized lightweight endpoints (like `/users/{id}/summary`), supporting field selection via query parameters (`?fields=id,name,email`), or migrating to GraphQL for clients with varying data requirements.

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

---

Happy Coding