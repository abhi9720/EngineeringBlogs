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

URL path versioning is the most widely adopted approach because it is explicit, easy to route, and clearly visible to API consumers. Each version lives under a distinct URL path (e.g., `/api/v1/users`, `/api/v2/users`), making it straightforward to maintain multiple versions simultaneously on the same server. The version is part of the URL, so HTTP caches treat different versions as different resources automatically. The downside is that URLs are no longer stable over time — clients must update their URLs when migrating to a new version. This approach also encourages code duplication if not managed carefully with shared service layers.

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

Header versioning keeps URLs clean by placing the version in a custom HTTP header. This approach treats the API as a single logical endpoint whose behavior changes based on the version header. The main advantage is URL stability — clients never need to change their base URLs. However, header versioning is less discoverable (you need documentation to know which header to send), harder to test with simple tools like curl or browser address bars, and more complex to route in load balancers or API gateways that inspect URL paths. It also complicates caching since the same URL returns different content depending on headers.

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

Query parameter versioning is the simplest to implement but the least recommended for production APIs. While it makes URLs superficially clean and allows clients to switch versions by changing a query parameter, it pollutes the query string namespace and makes caching ambiguous — the same URL path with different query parameters can return different representations. Query parameters are also easily omitted by clients, causing them to receive the default version unexpectedly. This approach is best suited for transitional phases or internal APIs where simplicity trumps architectural purity.

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

A well-defined deprecation policy is essential for managing API versions in production without breaking existing clients. The standard approach is to support each version for a minimum period (e.g., 6-12 months after announcing deprecation), communicate clearly through deprecation headers and documentation, and provide migration guides. The `Deprecation` and `Sunset` HTTP headers give clients programmatic notice that a version is being phased out, while `Link` headers with `rel="alternate"` point to the replacement endpoint.

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

The safest approach to versioning is to design new versions that are backward-compatible with older clients. Adding fields to responses never breaks existing clients (unknown fields are typically ignored by JSON parsers). Removing fields, changing data types, or restructuring responses are breaking changes that require a new version. A common pattern is to create a version-specific response DTO that extends the base version's DTO, adding only the new fields. This reduces code duplication while making the version contract explicit.

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

Deploying an API without a versioning strategy is a common mistake that becomes painful as soon as you need to make breaking changes. Without versioning, you are forced to either never change your API (stagnation) or break existing clients (unreliable). Start versioning from day one — even if you don't expect breaking changes — because retrofitting versioning onto an unversioned API is significantly harder than designing it in from the start.

```java
// WRONG: Breaking changes without versioning

// CORRECT: Always version from the start
@RestController
@RequestMapping("/api/v1")
public class VersionedController { }
```

### Mistake 2: Too Many Versions

Creating a new API version for every minor change leads to version sprawl — a support burden where you must maintain and test many parallel code paths. Reserve new versions exclusively for breaking changes (removing fields, changing data types, altering behavior). Non-breaking changes like adding fields, adding new endpoints, or extending enum values should be done within the existing version. This keeps the version matrix manageable while allowing the API to evolve.

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

Happy Coding