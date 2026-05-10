---
title: "Pagination Strategies"
description: "Implement effective pagination in REST APIs: offset vs cursor-based, handling large datasets, and performance optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - pagination
  - rest-api
  - performance
coverImage: "/images/pagination-strategies.png"
draft: false
---

# Pagination Strategies for REST APIs

## Overview

Pagination is essential for APIs returning potentially large result sets. The right strategy improves performance and user experience. Let's explore the main approaches and when to use each.

---

## Pagination Types

### 1. Offset-Based Pagination

```java
// Simple offset/limit approach
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping
    public Page<User> getUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        size = Math.min(size, 100);  // Cap max size
        return userService.findAll(PageRequest.of(page, size));
    }
}

// Response with pagination metadata
{
    "content": [...],
    "page": 0,
    "size": 20,
    "totalElements": 150,
    "totalPages": 8,
    "first": true,
    "last": false
}

// Works well for known, stable data
// Good for jumping to specific pages
```

### 2. Cursor-Based Pagination

```java
// Uses opaque cursor instead of page number
@RestController
public class CursorController {
    
    @GetMapping("/api/orders")
    public CursorResult<Order> getOrders(
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        
        List<Order> orders = orderService.findByCursor(cursor, size + 1);
        
        boolean hasMore = orders.size() > size;
        if (hasMore) {
            orders = orders.subList(0, size);
        }
        
        String nextCursor = hasMore ? 
            encodeCursor(orders.get(size-1).getId()) : null;
        
        return CursorResult.<Order>builder()
            .data(orders)
            .nextCursor(nextCursor)
            .hasMore(hasMore)
            .build();
    }
}

// Response
{
    "data": [...],
    "nextCursor": "bXktY3Vyc29yLTEyMw==",
    "hasMore": true
}

// Best for large datasets that change
// Works well for infinite scroll
```

### 3. Time-Based Pagination

```java
// Use timestamps for time-series data
@RestController
public class EventsController {
    
    @GetMapping("/api/events")
    public List<Event> getEvents(
            @RequestParam(required = false) Instant after,
            @RequestParam(defaultValue = "100") int limit) {
        
        return eventService.findEventsAfter(after, limit);
    }
}

// Request: GET /api/events?after=2024-01-15T10:00:00Z&limit=50
```

---

## Production Considerations

### Performance

```java
// Offset pagination with keyset optimization
public interface UserRepository extends JpaRepository<User, Long> {
    
    // Fast for offset but limited ordering
    @Query(value = "SELECT * FROM users WHERE id > :lastId ORDER BY id LIMIT :limit",
           nativeQuery = true)
    List<User> findNextBatch(@Param("lastId") Long lastId, @Param("limit") int limit);
}

// Index required for performance
// CREATE INDEX idx_user_id ON users(id);
```

### Handling Edge Cases

```java
@RestController
public class EdgeCaseController {
    
    @GetMapping("/api/users")
    public ResponseEntity<?> getUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        // Validate parameters
        if (page < 0) {
            return ResponseEntity.badRequest()
                .body("Page must be non-negative");
        }
        
        if (size < 1 || size > 100) {
            return ResponseEntity.badRequest()
                .body("Size must be between 1 and 100");
        }
        
        // If page > total, return empty
        Page<User> result = userService.findAll(PageRequest.of(page, size));
        
        return ResponseEntity.ok(result);
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Capping Page Size

```java
// WRONG: Client can request all records
@GetMapping("/api/users")
public List<User> getUsers(@RequestParam(defaultValue = "1000") int size) {
    return userService.findAll(PageRequest.of(0, size));
}

// CORRECT: Always cap page size
size = Math.min(size, 100);
```

### Mistake 2: Deep Pagination Performance

```java
// WRONG: Offset pagination gets slow at high page numbers
// SELECT ... OFFSET 100000 LIMIT 20 - very slow!

// CORRECT: Use cursor or time-based pagination
// Or disallow deep pagination
@GetMapping("/api/users")
public ResponseEntity<?> getUsers(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size) {
    
    if (page > 1000) {
        return ResponseEntity.badRequest()
            .body("Cannot paginate beyond page 1000");
    }
    
    return ResponseEntity.ok(userService.findAll(PageRequest.of(page, size)));
}
```

---

## Summary

1. **Offset pagination**: Simple, good for known pages, slow at high offsets
2. **Cursor pagination**: Efficient for large datasets, good for infinite scroll
3. **Time-based**: Best for time-series data
4. **Always cap page size**: Prevent abuse
5. **Consider use case**: Match strategy to client needs

---

## References

- [Paging in REST APIs](https://docs.microsoft.com/en-us/azure/architecture/best-practices/api-design#pagination)
- [Twitter API Pagination](https://developer.twitter.com/en/docs/tweets/timelines/guides/pagination)