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

### Safe vs Unsafe Methods

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

Happy Coding 👨‍💻