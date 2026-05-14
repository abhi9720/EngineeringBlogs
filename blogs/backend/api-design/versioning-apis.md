---
title: "API Versioning"
description: "Design API versioning strategies: URL paths, headers, and query parameters; maintaining backward compatibility"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - api-versioning
  - rest-api
  - backward-compatibility
coverImage: "/images/versioning-apis.png"
draft: false
---

# API Versioning Strategies

## Overview

APIs evolve over time. Adding fields, changing response structures, or deprecating endpoints requires careful versioning to avoid breaking existing clients. This guide covers versioning strategies and best practices.

---

## Versioning Approaches

### 1. URL Path Versioning

```java
// Include version in URL path
@RestController
@RequestMapping("/api/v1")
public class UserControllerV1 {
    
    @GetMapping("/users/{id}")
    public UserV1 getUser(@PathVariable Long id);
}

@RestController
@RequestMapping("/api/v2")
public class UserControllerV2 {
    
    @GetMapping("/users/{id}")
    public UserV2 getUser(@PathVariable Long id);  // More fields
}

// URLs:
// GET /api/v1/users/1
// GET /api/v2/users/1

// Pros: Clear, easy to route, easy to cache
// Cons: URL changes when version changes
```

### 2. Header Versioning

```java
// Version in custom header
@RestController
public class HeaderController {
    
    @GetMapping("/api/users/{id}")
    public ResponseEntity<?> getUser(
            @PathVariable Long id,
            @RequestHeader(value = "X-API-Version", defaultValue = "1") int version) {
        
        if (version >= 2) {
            return ResponseEntity.ok(userService.getUserV2(id));
        }
        return ResponseEntity.ok(userService.getUserV1(id));
    }
}

// Usage: GET /api/users/1 with header X-API-Version: 2

// Pros: Cleaner URLs
// Cons: Harder to test, less visible
```

### 3. Query Parameter Versioning

```java
// Version in query parameter
@GetMapping("/api/users")
public ResponseEntity<?> getUsers(
        @RequestParam(defaultValue = "1") int version) {
    
    if (version >= 2) {
        return ResponseEntity.ok(userService.getUsersV2());
    }
    return ResponseEntity.ok(userService.getUsersV1());
}

// GET /api/users?version=2
```

---

## Production Strategy

### Deprecation Policy

```java
// Version lifecycle management
@RestController
@RequestMapping("/api/v1")
@Deprecated  // Mark entire version as deprecated
public class DeprecatedController {
    
    @Deprecated
    @GetMapping("/users")
    public List<User> getUsers() {
        // Add deprecation header
        return userService.getUsersV1();
    }
}

// Add deprecation headers
@Bean
public Filter deprecationFilter() {
    return (request, response, chain) -> {
        chain.doFilter(request, response);
        
        // Add deprecation header for old versions
        if (request.getRequestURI().contains("/v1/")) {
            response.addHeader("Deprecation", "true");
            response.addHeader("Link", "<https://api.example.com/v2/users>; rel=\"alternate\"");
        }
    };
}
```

### Version Compatibility

```java
// Add fields without breaking old clients
public class UserV1 {
    private Long id;
    private String name;
    private String email;
}

public class UserV2 extends UserV1 {
    private String phoneNumber;  // New field
    private Address address;     // New field
    // Old clients still work - extra fields ignored
}

// Deprecate gracefully
public class UserV3 {
    private Long id;
    private String name;
    
    @Deprecated  // Mark field deprecated but still return
    private String email;  // Prefer: contact.address
    
    private Contact contact;  // New structure
}
```

---

## Common Mistakes

### Mistake 1: No Versioning Strategy

```java
// WRONG: Breaking changes without versioning

// CORRECT: Always version from the start
@RestController
@RequestMapping("/api/v1")
public class VersionedController { }
```

### Mistake 2: Too Many Versions

```java
// WRONG: Creating new versions for every change

// CORRECT: Only create new version for breaking changes
// For additions, just add to existing version
```

---

## Summary

1. **URL path**: Most common and visible, recommended
2. **Plan deprecation**: Have a clear lifecycle for versions
3. **Add, don't replace**: New versions should add, not remove
4. **Communicate**: Document deprecation clearly

---

## References

- [API Versioning Best Practices](https://restfulapi.net/versioning/)
- [RFC 5829 - Link Relation Types for Simple Version Navigation](https://tools.ietf.org/html/rfc5829)

---

Happy Coding 👨‍💻