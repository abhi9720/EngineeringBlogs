---
title: Cache-Control Headers
description: >-
  Master HTTP caching headers: Cache-Control, ETag, Last-Modified, and
  conditional requests for backend APIs
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - caching
  - cdn
  - cache-control
  - etag
  - http
coverImage: /images/cache-control-headers.png
draft: false
order: 10
---
# Cache-Control Headers

## Overview

HTTP caching headers are the primary mechanism for controlling how browsers, proxies, and CDNs cache responses. Properly configured headers significantly reduce latency and server load.

### Key Headers

- **Cache-Control**: Directives for caching behavior
- **ETag**: Entity tag for conditional requests
- **Last-Modified**: Timestamp for conditional requests
- **Expires**: Deprecated, use Cache-Control max-age instead
- **Vary**: Which request headers affect the response

---

## Cache-Control Directives

### Response Directives

The three response types below demonstrate the spectrum of caching behavior: public cacheable data (product listings), private user-specific data (profiles), and sensitive data that must never be cached (account balances).

```java
@RestController
public class CacheControlController {

    // Public: Can be cached by browser and proxies
    @GetMapping("/api/public/products")
    public ResponseEntity<List<Product>> getProducts() {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES)
                .sMaxAge(2, TimeUnit.MINUTES)
                .mustRevalidate())
            .body(productService.findAll());
    }

    // Private: Can be cached by browser only (not proxies)
    @GetMapping("/api/user/profile")
    public ResponseEntity<UserProfile> getProfile() {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(10, TimeUnit.MINUTES)
                .cachePrivate())
            .body(userService.getProfile());
    }

    // No-Store: Never cache (for sensitive data)
    @GetMapping("/api/account/balance")
    public ResponseEntity<Balance> getBalance() {
        return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(accountService.getBalance());
    }

    // No-Cache: Must revalidate with origin before serving
    @GetMapping("/api/posts/{id}")
    public ResponseEntity<Post> getPost(@PathVariable Long id) {
        Post post = postService.findById(id);
        String etag = generateEtag(post);

        return ResponseEntity.ok()
            .cacheControl(CacheControl.noCache()
                .mustRevalidate())
            .eTag(etag)
            .body(post);
    }
}
```

The `s-maxage` directive is specific to shared caches (CDNs, reverse proxies) — it overrides `max-age` for intermediate caches. The `private` directive tells shared caches not to cache the response, while `no-store` prevents all caching at any level.

### Common Cache-Control Combinations

These reusable cache configuration methods encapsulate best practices for different response types.

```java
public class CacheDirectives {

    // Static assets (immutable)
    public static CacheControl staticAssets() {
        return CacheControl.maxAge(365, TimeUnit.DAYS)
            .cachePublic()
            .immutable();
    }

    // API response with revalidation
    public static CacheControl apiResponse(int maxAgeSeconds) {
        return CacheControl.maxAge(maxAgeSeconds, TimeUnit.SECONDS)
            .noCache()
            .mustRevalidate();
    }

    // CDN cache with stale-while-revalidate
    public static CacheControl cdnResponse(int edgeTtlSeconds) {
        return CacheControl.maxAge(0, TimeUnit.SECONDS)
            .sMaxAge(edgeTtlSeconds, TimeUnit.SECONDS)
            .staleWhileRevalidate(86400, TimeUnit.SECONDS);
    }

    // Never cache
    public static CacheControl noCache() {
        return CacheControl.noStore();
    }
}
```

`stale-while-revalidate` is a powerful pattern for CDN caching: after the TTL expires, the CDN can serve the stale response while fetching a fresh copy in the background. This eliminates the "thundering herd" problem when a popular cache key expires.

---

## ETag Implementation

### ETag Generation

ETags are strong validators — they uniquely identify a version of a resource. Different generation strategies offer different trade-offs between accuracy and performance.

```java
@Service
public class ETagService {

    private final ObjectMapper objectMapper;

    // ETag from content hash
    public String generateContentETag(Object content) {
        try {
            String json = objectMapper.writeValueAsString(content);
            String hash = DigestUtils.md5DigestAsHex(json.getBytes());
            return "\"" + hash + "\""; // Must be quoted
        } catch (Exception e) {
            return null;
        }
    }

    // ETag from version number
    public String generateVersionETag(long version) {
        return "\"" + version + "\"";
    }

    // ETag from last modified timestamp
    public String generateTimestampETag(Instant lastModified) {
        return "\"" + lastModified.toEpochMilli() + "\"";
    }
}
```

Content-hash ETags are the most accurate but require serializing the entire response body. Version-based ETags are more efficient — if your database row has an `@Version` column (e.g., JPA optimistic locking), you can use it directly as the ETag without computing a hash.

### Conditional Request Handling

Conditional requests use ETag and Last-Modified headers to avoid sending the full response body when the client already has the latest version. The server responds with `304 Not Modified` and an empty body.

```java
@RestController
@RequestMapping("/api/products")
public class ConditionalRequestController {

    @GetMapping("/{id}")
    public ResponseEntity<Product> getProduct(
            @PathVariable Long id,
            @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch,
            @RequestHeader(value = "If-Modified-Since", required = false) String ifModifiedSince) {

        Product product = productService.findById(id);

        String currentEtag = "\"" + product.getVersion() + "\"";

        // Check ETag first (strong validator)
        if (ifNoneMatch != null && ifNoneMatch.equals(currentEtag)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                .eTag(currentEtag)
                .build();
        }

        // Check Last-Modified (weak validator)
        if (ifModifiedSince != null) {
            try {
                Instant ifModified = Instant.parse(ifModifiedSince);
                if (!product.getUpdatedAt().isAfter(ifModified)) {
                    return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                        .eTag(currentEtag)
                        .lastModified(product.getUpdatedAt().toEpochMilli())
                        .build();
                }
            } catch (Exception e) {
                // Ignore invalid dates
            }
        }

        // Return full response
        return ResponseEntity.ok()
            .eTag(currentEtag)
            .lastModified(product.getUpdatedAt().toEpochMilli())
            .cacheControl(CacheControl.noCache()
                .mustRevalidate())
            .body(product);
    }

    // Batch ETag for list endpoints
    @GetMapping
    public ResponseEntity<List<Product>> getAllProducts(
            @RequestHeader("If-None-Match") String ifNoneMatch) {

        List<Product> products = productService.findAll();
        String collectionEtag = generateCollectionETag(products);

        if (ifNoneMatch != null && ifNoneMatch.equals(collectionEtag)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                .eTag(collectionEtag)
                .build();
        }

        return ResponseEntity.ok()
            .eTag(collectionEtag)
            .body(products);
    }

    private String generateCollectionETag(List<Product> products) {
        long maxVersion = products.stream()
            .mapToLong(Product::getVersion)
            .max()
            .orElse(0);
        return "\"" + maxVersion + "-" + products.size() + "\"";
    }
}
```

The controller checks `If-None-Match` (ETag) first because it is a strong validator — byte-exact comparison. `If-Modified-Since` (Last-Modified) is a weak validator — it uses timestamp comparison with second granularity. When both are sent, ETag takes precedence.

### Spring ETag Filter

Spring's `ShallowEtagHeaderFilter` automatically generates weak ETags by hashing the response body. This requires no code changes but computes the hash after the response is generated, so it doesn't save server processing time — only bandwidth.

```java
@Configuration
public class ETagFilterConfig {

    @Bean
    public Filter shallowEtagHeaderFilter() {
        // Spring's built-in ETag support
        // Calculates MD5 hash of response body
        ShallowEtagHeaderFilter filter = new ShallowEtagHeaderFilter();
        filter.setWriteWeakETag(false);
        return filter;
    }
}
```

---

## Last-Modified Headers

### Implementation

Last-Modified enables conditional GET requests. When a client sends `If-Modified-Since`, the server can respond with `304 Not Modified` if the resource hasn't changed, saving bandwidth and processing time.

```java
@Service
public class LastModifiedService {

    private final Map<Long, Instant> lastModifiedCache = new ConcurrentHashMap<>();

    public void recordModification(Long entityId) {
        lastModifiedCache.put(entityId, Instant.now());
    }

    public Instant getLastModified(Long entityId) {
        return lastModifiedCache.getOrDefault(entityId, Instant.EPOCH);
    }
}

@RestController
public class LastModifiedController {

    @GetMapping("/api/articles/{id}")
    public ResponseEntity<Article> getArticle(@PathVariable Long id) {
        Article article = articleService.findById(id);

        // Last-Modified enables conditional GETs
        // Browser sends: If-Modified-Since: Wed, 11 May 2026 10:00:00 GMT
        // Server responds: 304 Not Modified (no body, very fast!)

        return ResponseEntity.ok()
            .lastModified(article.getUpdatedAt().toEpochMilli())
            .cacheControl(CacheControl.maxAge(60, TimeUnit.SECONDS)
                .mustRevalidate())
            .body(article);
    }
}
```

---

## Vary Header

### Configuration

The `Vary` header tells caches which request headers affect the response. Without it, a CDN might serve a gzip-compressed response to a client that doesn't support gzip, or an English response to a French user.

```java
@Configuration
public class VaryHeaderConfig {

    @Bean
    public WebMvcConfigurer varyHeaderConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(new HandlerInterceptor() {
                    @Override
                    public boolean preHandle(HttpServletRequest request,
                            HttpServletResponse response, Object handler) {

                        // Set Vary header for all responses
                        response.addHeader("Vary", "Accept-Encoding");
                        return true;
                    }
                });
            }
        };
    }
}

// Common Vary header combinations:

// Content negotiation
// Vary: Accept, Accept-Encoding, Accept-Language

// Authentication-based
// Vary: Authorization, Cookie

// Device detection
// Vary: User-Agent
```

---

## Best Practices

### 1. Immutable for Static Assets

Content-hashed filenames (e.g., `bundle.abc123.js`) ensure that the URL changes when content changes. The `immutable` directive tells browsers to never revalidate — the cached copy is guaranteed to be correct.

```java
// Assets with content-based filenames never change
// bundle.abc123.js will always serve same content
@GetMapping("/static/{filename}")
public ResponseEntity<Resource> getStatic(@PathVariable String filename) {
    Resource resource = resourceLoader.getResource("classpath:static/" + filename);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.maxAge(365, TimeUnit.DAYS)
            .cachePublic()
            .immutable()) // Browser won't revalidate
        .body(resource);
}
```

### 2. Stale-While-Revalidate for API Responses

This pattern prevents the thundering herd problem at cache expiration. The CDN serves stale content for up to an hour while one request fetches fresh data.

```java
// Serve stale data while fetching fresh version in background
// Prevents cache stampede on expiration

@GetMapping("/api/popular")
public ResponseEntity<List<Product>> getPopular() {
    return ResponseEntity.ok()
        .header("Cache-Control",
            "public, max-age=60, s-maxage=30, stale-while-revalidate=3600")
        .body(productService.findPopular());
}

// Produces these headers:
// Cache-Control: public, max-age=60, s-maxage=30, stale-while-revalidate=3600
// CDN caches for 30s
// Browser caches for 60s
// CDN serves stale for up to 1 hour while revalidating
```

### 3. Use Strong vs Weak Validators

Strong ETags change when any byte changes — they are byte-exact. Weak ETags (prefixed with `W/`) allow semantically equivalent representations. Use strong ETags for caching and weak ETags for conditional uploads.

```java
// Strong ETag: Content changes = ETag changes (byte-exact)
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"

// Weak ETag: Content changes = ETag may change (semantic equivalence)
ETag: W/"33a64df551425fcc55e4d42a148795d9f25f89d4"

// Use strong ETag for: Caching
// Use weak ETag for: Conditional uploads, range requests
```

---

## Common Mistakes

### Mistake 1: Setting Both Expires and Cache-Control

`Expires` is a HTTP/1.0 header; `Cache-Control` overrides it in HTTP/1.1. Sending both is redundant and can confuse older proxies.

```java
// WRONG: Both Expires and Cache-Control max-age
response.setHeader("Expires", "Wed, 21 Oct 2026 07:28:00 GMT");
response.setHeader("Cache-Control", "max-age=3600");
// Expires is ignored, but still sent (confuses some proxies)

// CORRECT: Use Cache-Control only
response.setHeader("Cache-Control", "max-age=3600");
```

### Mistake 2: Missing Vary Header

Without `Vary`, a CDN may serve a response optimized for one client to another client with different capabilities, causing data corruption or unreadable content.

```java
// WRONG: No Vary header for content-negotiated responses
// CDN may serve English version to French users!
response.setHeader("Cache-Control", "public, max-age=300");

// CORRECT: Include Vary for content negotiation
response.setHeader("Vary", "Accept-Encoding, Accept-Language");
response.setHeader("Cache-Control", "public, max-age=300");
```

### Mistake 3: Over-Caching Dynamic Content

User-specific responses must never be cached at a shared cache level. Even `private` caching should be used cautiously with authenticated data.

```java
// WRONG: Caching user-specific data
@GetMapping("/api/user/dashboard")
public ResponseEntity<Dashboard> getDashboard() {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.maxAge(5, TimeUnit.MINUTES))
        .body(dashboardService.getForUser(getCurrentUser()));
    // User A sees User B's dashboard!
}

// CORRECT: No caching for user-specific data
@GetMapping("/api/user/dashboard")
public ResponseEntity<Dashboard> getDashboard() {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(dashboardService.getForUser(getCurrentUser()));
}
```

---

## Summary

| Directive | Meaning | Use Case |
|-----------|---------|----------|
| public | Cacheable by all | Public API responses |
| private | Browser-only cache | User-specific data |
| no-store | Never cache | Sensitive data |
| no-cache | Must revalidate | Dynamic content |
| max-age | Freshness duration | How long to keep |
| s-maxage | Proxy/CDN duration | Edge cache TTL |
| must-revalidate | Strict revalidation | Important updates |
| immutable | Never revalidate | Content-hashed assets |

---

## References

- [MDN HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [Google Web Fundamentals: Caching](https://developers.google.com/web/fundamentals/performance/optimizing-content-efficiency/http-caching)
- [RFC 7234 - HTTP Caching](https://tools.ietf.org/html/rfc7234)

Happy Coding
