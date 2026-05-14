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

Offset-based pagination is the most intuitive approach — clients specify a page number and page size. It works well for small to medium datasets, UI components with page selectors, and stable data that doesn't change frequently. The main advantage is that clients can jump directly to any page. However, as the offset grows, database performance degrades significantly because the database must scan and skip rows before returning results. This is known as "offset drift" and becomes problematic beyond a few thousand records. Always cap the page size to prevent clients from requesting excessive data in a single call.

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

Cursor-based pagination addresses the performance limitations of offset pagination by using an opaque cursor — typically an encoded identifier — to mark position in the dataset. Instead of counting skipped rows, the database uses a WHERE clause with index-based lookups (`WHERE id > :lastId`), making it consistently fast regardless of how deep into the dataset you paginate. The trade-off is that clients cannot jump to arbitrary pages; they can only navigate forward (or backward) from a known position. This makes cursor pagination ideal for infinite scroll UIs, activity feeds, and real-time data where new records are constantly appended.

```java

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

Time-based pagination is a variant of cursor pagination that uses timestamps instead of opaque cursors. It is the natural choice for time-series data — events, logs, metrics, or notifications — where queries are inherently ordered by time. Clients specify an `after` timestamp to retrieve the next batch, making the API intuitive and the queries trivially indexable. The main consideration is clock synchronization: if clients and servers have skewed clocks, results may be inconsistent. Always use server-generated timestamps (like `Instant.now()` at write time) rather than trusting client-provided timestamps for ordering.

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

In production, the choice of pagination strategy directly impacts database load and API latency. Offset pagination with large offsets causes full table scans or index scans that increase linearly with the offset value. Keyset pagination (cursor-based using indexed columns) maintains constant-time lookups regardless of dataset position. A common optimization is to combine offset pagination with a keyset filter: use `WHERE id > :lastId` for efficient batching, even if you present it to clients as offset-based. Always ensure your pagination columns are properly indexed — missing indexes turn pagination into a full table scan on every request.

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

Robust pagination handles edge cases gracefully. Negative page numbers, excessively large page sizes, and pages beyond the available data should all return sensible responses rather than errors or empty pages. Input validation prevents abuse — always validate and sanitize pagination parameters before passing them to your data layer. For offset-based pagination, returning an empty page (instead of 404) when the page exceeds the total count is the standard behavior that clients expect.

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

Allowing clients to request unlimited page sizes is a common oversight that can bring down your database. A malicious or misconfigured client requesting 1 million records in a single page forces your database to scan, sort, and transfer an enormous result set, consuming memory and network bandwidth. Always enforce a maximum page size — typically 100–1000 records depending on your data model — and document this limit in your API specification.

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

As your dataset grows, offset-based pagination becomes progressively slower. At page 10,000 with a page size of 20, the database must scan and discard 200,000 rows before returning results. This is not just a performance issue — it can cause database CPU spikes and connection timeouts. Switch to cursor-based or keyset pagination for datasets that may grow beyond a few thousand records, or impose a maximum page number as a hard boundary.

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

---

Happy Coding