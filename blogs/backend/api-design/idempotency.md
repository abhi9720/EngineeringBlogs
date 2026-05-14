---
title: "Idempotency"
description: "Implement idempotent APIs: handling duplicate requests, idempotency keys, and safe vs unsafe operations"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - idempotency
  - rest-api
  - api-design
coverImage: "/images/idempotency.png"
draft: false
---

# API Idempotency

## Overview

Idempotency ensures that making the same API request multiple times produces the same result as making it once. This is critical for reliable APIs, especially when network issues cause duplicate requests.

---

## Understanding Idempotency

Idempotency in the HTTP context means that multiple identical requests should have the same effect as a single request. This property is essential for building reliable distributed systems where network failures, timeouts, and retries are inevitable. Without idempotency, retrying a failed request could lead to duplicate orders, double charges, or inconsistent state.

### Safe vs Unsafe Methods

HTTP methods have inherent idempotency guarantees defined by the specification. Safe methods (GET, HEAD, OPTIONS, TRACE) are inherently idempotent because they only retrieve data without modifying server state. However, for unsafe methods, idempotency depends on how the server implements them. PUT and DELETE are defined as idempotent in the HTTP spec because replacing a resource or deleting it has the same effect regardless of how many times the operation repeats. POST, used for creating resources, is not idempotent by default — each call typically creates a new resource. PATCH can be tricky since applying the same partial update multiple times may produce different results depending on the operation semantics.

```
Safe Methods (Idempotent):     Unsafe Methods (Usually Not Idempotent):
- GET                          - POST (create)
- HEAD                         - PUT (replace - can be idempotent)
- OPTIONS                      - DELETE (can be idempotent)
- TRACE                        - PATCH
```

### Idempotency in Practice

```java
// GET is naturally idempotent
// Same URL returns same data

// DELETE can be idempotent
@RestController
public class IdempotentDelete {
    
    @DeleteMapping("/users/{id}")
    public ResponseEntity<?> deleteUser(@PathVariable Long id) {
        // First call: 204 No Content (deleted)
        // Second call: 404 Not Found (already deleted)
        // Same outcome - idempotent in effect
        
        userService.delete(id);
        return ResponseEntity.noContent().build();
    }
}

// POST requires explicit idempotency
@PostMapping("/orders")
public ResponseEntity<Order> createOrder(
        @RequestBody CreateOrderRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    
    // Without idempotency key: creating duplicate orders
    // With idempotency key: return existing order if already processed
}
```

---

## Implementation Patterns

There are several proven patterns for implementing idempotency in APIs. The choice depends on your consistency requirements, performance constraints, and whether you control both client and server. The most common approach is the idempotency key pattern, where clients generate a unique key for each operation and the server uses it to detect and prevent duplicates.

### 1. Idempotency Keys

```java
// Client generates and sends idempotency key
@RestController
public class IdempotentController {
    
    @PostMapping("/payments")
    public ResponseEntity<Payment> createPayment(
            @RequestBody PaymentRequest request,
            @RequestHeader("Idempotency-Key") String idempotencyKey) {
        
        // Check if already processed
        Optional<Payment> existing = paymentService.findByIdempotencyKey(idempotencyKey);
        
        if (existing.isPresent()) {
            return ResponseEntity.ok(existing.get());
        }
        
        // Process new request
        Payment payment = paymentService.create(request, idempotencyKey);
        
        return ResponseEntity.status(HttpStatus.CREATED).body(payment);
    }
}

@Service
public class PaymentService {
    
    public Payment create(PaymentRequest request, String idempotencyKey) {
        Payment payment = Payment.builder()
            .amount(request.getAmount())
            .idempotencyKey(idempotencyKey)
            .build();
        
        return paymentRepository.save(payment);
    }
    
    public Optional<Payment> findByIdempotencyKey(String key) {
        return paymentRepository.findByIdempotencyKey(key);
    }
}

@Entity
public class Payment {
    
    @Id
    @GeneratedValue
    private Long id;
    
    @Column(unique = true)
    private String idempotencyKey;  // Prevent duplicates
    
    private BigDecimal amount;
}

// Client implementation
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .header("Idempotency-Key", UUID.randomUUID().toString())  // Unique per request
    .POST(HttpRequest.BodyPublishers.ofString(json))
    .uri(URI.create("https://api.example.com/payments"))
    .build();
```

### 2. Database Constraints

While idempotency keys in application code handle most cases, database-level constraints provide a safety net. A unique constraint on the idempotency key column ensures that even if two requests arrive simultaneously and bypass the application check, only one record is inserted. The trade-off is that you must handle `DataIntegrityViolationException` gracefully and return the existing resource rather than propagating the error to the client.

```java
// Use unique constraints for idempotency
@Entity
public class Order {
    
    @Id
    @GeneratedValue
    private Long id;
    
    @Column(unique = true)
    private String idempotencyKey;
    
    private String status;
}

// Handle constraint violations
@Service
public class OrderIdempotencyService {
    
    @Transactional
    public Order createOrder(CreateOrderRequest request, String idempotencyKey) {
        try {
            Order order = Order.builder()
                .idempotencyKey(idempotencyKey)
                .status("CREATED")
                .build();
            
            return orderRepository.save(order);
            
        } catch (DataIntegrityViolationException e) {
            // Idempotency key already exists - return existing
            return orderRepository.findByIdempotencyKey(idempotencyKey)
                .orElseThrow();
        }
    }
}
```

---

## Production Considerations

In production systems, idempotency keys cannot live forever — they consume storage and can become a source of technical debt. A key expiration strategy balances safety with resource management. Keep keys long enough to cover the maximum expected retry window (usually 24 hours for most APIs, but can be longer for payment systems where retries may span days). Use scheduled cleanup jobs or TTL-based storage (like Redis) to manage expired keys efficiently.

### Idempotency Key Expiration

```java
@Configuration
public class IdempotencyConfig {
    
    @Bean
    public IdempotencyService idempotencyService() {
        return IdempotencyService.builder()
            .keyExpiration(Duration.ofHours(24))  // Keys expire after 24 hours
            .build();
    }
}

// Cleanup old keys
@Scheduled(cron = "0 0 * * *")  // Run hourly
public void cleanupExpiredKeys() {
    Instant cutoff = Instant.now().minus(Duration.ofHours(24));
    idempotencyRepository.deleteByCreatedBefore(cutoff);
}
```

### Idempotent PUT and PATCH

A common point of confusion in API design is the idempotency difference between PUT and PATCH. PUT replaces the entire resource — sending the same PUT request multiple times yields the same result because the final state is identical. PATCH, on the other hand, applies partial modifications. If your PATCH operation increments a counter or appends to a list, repeated calls produce different states. Design PATCH carefully: use absolute values rather than relative operations when idempotency matters, or use conditional PATCH with version numbers to prevent conflicting updates.

```java
// PUT should be idempotent (replace entire resource)
@PutMapping("/users/{id}")
public User updateUser(@PathVariable Long id, @RequestBody User user) {
    user.setId(id);
    return userRepository.save(user);  // Same result on repeat
}

// PATCH is typically not idempotent - each call applies changes
@PatchMapping("/users/{id}")
public User patchUser(@PathVariable Long id, @RequestBody Map<String, Object> updates) {
    User user = userRepository.findById(id);
    
    // Each call applies partial update - not idempotent
    updates.forEach((key, value) -> {
        // Apply each update
    });
    
    return userRepository.save(user);
}
```

---

## Common Mistakes

### Mistake 1: No Idempotency for Critical Operations

The most costly mistake is skipping idempotency on financial or resource-creating operations. When a client times out waiting for a response, it has no way to know whether the server processed the request or not. Without idempotency, the client's retry creates a duplicate — a double charge or duplicate order. Always require idempotency keys for POST endpoints that create resources or trigger side effects.

```java
// WRONG: Payment endpoint without idempotency
@PostMapping("/payments")
public Payment createPayment(@RequestBody PaymentRequest request) {
    // Client retries on timeout - could charge twice!
    return paymentService.charge(request);
}

// CORRECT: Add idempotency key
@PostMapping("/payments")
public ResponseEntity<Payment> createPayment(
        @RequestBody PaymentRequest request,
        @RequestHeader(value = "Idempotency-Key") String key) {
    
    return ResponseEntity.ok(paymentService.charge(request, key));
}
```

### Mistake 2: Short Idempotency Key Lifespan

If idempotency keys expire too quickly — say, within minutes — a client that retries after a long timeout or during a network partition will be allowed to create a duplicate. This defeats the purpose of idempotency. The right expiration depends on your clients' retry behavior: Stripe uses 24 hours, while some payment systems keep keys for 7 days to accommodate offline processing and delayed retries.

```java
// WRONG: Keys expire too quickly for long-running operations
// CORRECT: Keep keys for reasonable duration (24+ hours)
```

---

## Summary

1. **POST operations**: Require explicit idempotency handling
2. **Idempotency keys**: Generated by client, stored server-side
3. **Database constraints**: Ensure uniqueness
4. **Expiration**: Keys should have reasonable lifetime
5. **Network retries**: Handle automatically with idempotency

---

## References

- [RFC 7231 - Idempotent Methods](https://tools.ietf.org/html/rfc7231)
- [Stripe API Idempotency](https://stripe.com/blog/idempotency)
- [REST API Design Best Practices](https://restfulapi.net/idempotency/)

---

Happy Coding