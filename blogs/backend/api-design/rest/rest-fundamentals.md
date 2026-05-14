---
title: "REST API Fundamentals"
description: "Master REST API fundamentals: HTTP methods, status codes, resource design, and RESTful principles for building production-grade APIs"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - rest-api
  - http
  - api-design
  - fundamentals
coverImage: "/images/backend/api-design/rest/rest-fundamentals.png"
draft: false
---

# REST API Fundamentals

## Overview

REST (Representational State Transfer) is an architectural style for designing networked applications. It relies on stateless, client-server communication using HTTP as the transport protocol. Understanding REST fundamentals is essential for building APIs that are scalable, maintainable, and intuitive for consumers.

---

## Core REST Principles

### Resources and URIs

Every resource in REST is identified by a unique URI. Resources represent entities in your system.

```java
// Resource identification patterns
// Collection:    GET /api/users
// Specific item: GET /api/users/{id}
// Sub-resource:  GET /api/users/{id}/orders

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ResponseEntity<List<User>> getAllUsers() {
        List<User> users = userService.findAll();
        return ResponseEntity.ok(users);
    }

    @GetMapping("/{id}")
    public ResponseEntity<User> getUserById(@PathVariable Long id) {
        return userService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
}
```

### HTTP Methods

Each HTTP method maps to a specific operation on resources.

```
Method   | Operation              | Idempotent | Safe
---------|------------------------|------------|-----
GET      | Retrieve resource      | Yes        | Yes
POST     | Create resource        | No         | No
PUT      | Replace resource       | Yes        | No
PATCH    | Partial update         | No         | No
DELETE   | Remove resource        | Yes        | No
HEAD     | Retrieve headers       | Yes        | Yes
OPTIONS  | Available methods      | Yes        | Yes
```

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @GetMapping
    public ResponseEntity<List<Product>> getAllProducts() {
        return ResponseEntity.ok(productService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Product> getProduct(@PathVariable Long id) {
        return productService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Product> createProduct(@RequestBody @Valid Product product) {
        Product created = productService.create(product);
        URI location = URI.create("/api/products/" + created.getId());
        return ResponseEntity.created(location).body(created);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Product> updateProduct(@PathVariable Long id, @RequestBody @Valid Product product) {
        product.setId(id);
        Product updated = productService.update(product);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProduct(@PathVariable Long id) {
        productService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
```

---

## HTTP Status Codes

### 2xx Success Codes

```java
// 200 OK - Successful GET, PUT, PATCH
@GetMapping("/{id}")
public ResponseEntity<User> getUser(@PathVariable Long id) {
    return ResponseEntity.ok(userService.findById(id));
}

// 201 Created - Successful POST
@PostMapping
public ResponseEntity<User> createUser(@RequestBody User user) {
    User created = userService.create(user);
    return ResponseEntity.created(
        URI.create("/api/users/" + created.getId())
    ).body(created);
}

// 204 No Content - Successful DELETE, no body
@DeleteMapping("/{id}")
public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
    userService.delete(id);
    return ResponseEntity.noContent().build();
}
```

### 4xx Client Error Codes

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    // 400 Bad Request - Validation failures
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex) {
        List<String> errors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .toList();
        return ResponseEntity.badRequest()
            .body(new ErrorResponse("VALIDATION_ERROR", errors));
    }

    // 401 Unauthorized - Missing or invalid credentials
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Void> handleUnauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }

    // 403 Forbidden - Insufficient permissions
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Void> handleForbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }

    // 404 Not Found - Resource doesn't exist
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Void> handleNotFound() {
        return ResponseEntity.notFound().build();
    }

    // 409 Conflict - State conflict
    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ErrorResponse> handleConflict(ConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(new ErrorResponse("CONFLICT", ex.getMessage()));
    }

    // 429 Too Many Requests - Rate limiting
    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<Void> handleRateLimit() {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).build();
    }
}
```

### 5xx Server Error Codes

```java
// 500 Internal Server Error - Unexpected server errors
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleGeneral(Exception ex) {
    log.error("Unexpected error", ex);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(new ErrorResponse("INTERNAL_ERROR", "An unexpected error occurred"));
}

// 502 Bad Gateway - Upstream failure
// 503 Service Unavailable - Server overloaded
@ExceptionHandler(ServiceUnavailableException.class)
public ResponseEntity<Void> handleServiceUnavailable() {
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
}

// 504 Gateway Timeout - Upstream timeout
```

---

## Statelessness

REST APIs must be stateless. Each request contains all information needed to process it.

```java
// Stateless: Session info in request headers/tokens
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @GetMapping
    public ResponseEntity<List<Order>> getOrders(
            @RequestHeader("Authorization") String token,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        // Token contains user identity
        // No server-side session needed
        User user = jwtTokenService.validateAndExtract(token);
        List<Order> orders = orderService.findByUser(user.getId(), page, size);
        return ResponseEntity.ok(orders);
    }
}
```

### Pagination

```java
@GetMapping
public ResponseEntity<PageResponse<Order>> getOrders(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(defaultValue = "createdAt,desc") String sort) {

    Pageable pageable = PageRequest.of(page, size, Sort.by(parseSort(sort)));
    Page<Order> orderPage = orderService.findAll(pageable);

    PageResponse<Order> response = PageResponse.<Order>builder()
        .content(orderPage.getContent())
        .page(orderPage.getNumber())
        .size(orderPage.getSize())
        .totalElements(orderPage.getTotalElements())
        .totalPages(orderPage.getTotalPages())
        .build();

    return ResponseEntity.ok(response);
}
```

---

## HATEOAS Basics

Hypermedia links guide clients through the API.

```java
@RestController
@RequestMapping("/api/orders")
public class HateoasOrderController {

    @GetMapping("/{id}")
    public ResponseEntity<OrderResource> getOrder(@PathVariable Long id) {
        Order order = orderService.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Order not found"));

        OrderResource resource = new OrderResource(order);
        resource.add(Link.of("/api/orders/" + id, "self"));
        resource.add(Link.of("/api/orders/" + id + "/items", "items"));
        resource.add(Link.of("/api/orders/" + id + "/cancel", "cancel"));

        return ResponseEntity.ok(resource);
    }
}

public class OrderResource extends RepresentationModel<OrderResource> {
    private Long id;
    private String status;
    private BigDecimal total;

    public OrderResource(Order order) {
        this.id = order.getId();
        this.status = order.getStatus();
        this.total = order.getTotal();
    }
}
```

---

## Best Practices

1. **Use nouns for resources**: `/users` not `/getUsers`
2. **Plural resource names**: `/users` instead of `/user`
3. **Consistent naming**: kebab-case for multi-word resources: `/order-items`
4. **Version your API**: `/api/v1/users` or via headers
5. **Use proper HTTP methods**: GET for read, POST for create, PUT for full update
6. **Return appropriate status codes**: Match HTTP semantics
7. **Filtering and sorting**: Use query parameters `/users?role=admin&sort=name,asc`
8. **Field selection**: Allow clients to select fields `/users?fields=id,name,email`
9. **Error responses**: Always return consistent error structures
10. **Use SSL/TLS**: Encrypt all API traffic

```java
// Filtering and sorting example
@GetMapping("/api/users")
public ResponseEntity<List<User>> getUsers(
        @RequestParam(required = false) String role,
        @RequestParam(required = false) String status,
        @RequestParam(defaultValue = "id,asc") String sort) {

    Specification<User> spec = Specification.where(null);

    if (role != null) {
        spec = spec.and((root, query, cb) ->
            cb.equal(root.get("role"), role));
    }

    if (status != null) {
        spec = spec.and((root, query, cb) ->
            cb.equal(root.get("status"), status));
    }

    Sort sorting = parseSortParameter(sort);
    List<User> users = userRepository.findAll(spec, sorting);

    return ResponseEntity.ok(users);
}
```

---

## Common Mistakes

### Mistake 1: Using POST for Everything

```java
// WRONG: POST for all operations
@PostMapping("/getUser")
public User getUser(@RequestBody Long id) { ... }

@PostMapping("/deleteUser")
public void deleteUser(@RequestBody Long id) { ... }

// CORRECT: Use proper HTTP methods
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) { ... }

@DeleteMapping("/users/{id}")
public void deleteUser(@PathVariable Long id) { ... }
```

### Mistake 2: Inconsistent Status Codes

```java
// WRONG: Returning 200 for all success cases
@PostMapping("/users")
public ResponseEntity<User> createUser(@RequestBody User user) {
    User created = userService.create(user);
    return ResponseEntity.ok(created); // Should be 201
}

// CORRECT: Use status codes semantically
@PostMapping("/users")
public ResponseEntity<User> createUser(@RequestBody User user) {
    User created = userService.create(user);
    return ResponseEntity.created(
        URI.create("/api/users/" + created.getId())
    ).body(created);
}
```

### Mistake 3: Verb-Based Endpoints

```java
// WRONG: Verbs in URLs
/api/getAllUsers
/api/createUser
/api/deleteUserById

// CORRECT: Resources + HTTP methods
GET /api/users
POST /api/users
DELETE /api/users/{id}
```

### Mistake 4: Returning 500 for Client Errors

```java
// WRONG: Catching and returning 500
@ExceptionHandler(ValidationException.class)
public ResponseEntity<Void> handleValidation() {
    return ResponseEntity.status(500).build();
}

// CORRECT: Return appropriate 4xx status
@ExceptionHandler(ValidationException.class)
public ResponseEntity<ErrorResponse> handleValidation(ValidationException ex) {
    return ResponseEntity.badRequest()
        .body(new ErrorResponse("VALIDATION_ERROR", ex.getMessage()));
}
```

---

## Summary

1. REST relies on resources identified by URIs with standard HTTP methods
2. Use status codes semantically: 2xx for success, 4xx for client errors, 5xx for server errors
3. APIs must be stateless with all state in the request
4. Use nouns for resources, verbs are implicit in HTTP methods
5. Consistent error responses and proper status codes improve developer experience
6. Always version your APIs and use SSL/TLS

---

## References

- [REST Architectural Constraints](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm)
- [RFC 7231 - HTTP Semantics](https://tools.ietf.org/html/rfc7231)
- [REST API Design - Microsoft](https://docs.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [HTTP Status Codes - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)

Happy Coding