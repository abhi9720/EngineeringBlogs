---
title: "Rate Limiting"
description: "Implement rate limiting in APIs: token bucket, leaky bucket, fixed window, sliding window algorithms, and distributed rate limiting"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - rate-limiting
  - api-security
  - throttling
  - algorithms
coverImage: "/images/backend/api-design/api-security/rate-limiting.png"
draft: false
---

# Rate Limiting

## Overview

Rate limiting controls the number of requests a client can make to an API within a specific time window. It prevents abuse, ensures fair usage, protects backend resources, and maintains API stability under load. Choosing the right algorithm depends on accuracy requirements, memory constraints, and distribution needs.

---

## Rate Limiting Algorithms

### 1. Token Bucket Algorithm

```java
@Component
public class TokenBucketRateLimiter {

    private final Cache<String, TokenBucket> buckets;

    public TokenBucketRateLimiter() {
        this.buckets = Caffeine.newBuilder()
            .expireAfterAccess(10, TimeUnit.MINUTES)
            .maximumSize(100000)
            .build();
    }

    public boolean allowRequest(String clientId, int capacity, int refillRate, Duration refillDuration) {
        TokenBucket bucket = buckets.get(clientId, k -> new TokenBucket(capacity, refillRate, refillDuration));

        synchronized (bucket) {
            bucket.refill();
            return bucket.tryConsume();
        }
    }

    private static class TokenBucket {
        private final int capacity;
        private final int refillRate;
        private final Duration refillDuration;
        private int tokens;
        private Instant lastRefill;

        TokenBucket(int capacity, int refillRate, Duration refillDuration) {
            this.capacity = capacity;
            this.refillRate = refillRate;
            this.refillDuration = refillDuration;
            this.tokens = capacity;
            this.lastRefill = Instant.now();
        }

        void refill() {
            Instant now = Instant.now();
            long elapsed = Duration.between(lastRefill, now).toMillis();
            long periods = elapsed / refillDuration.toMillis();

            if (periods > 0) {
                int newTokens = (int) (periods * refillRate);
                tokens = Math.min(capacity, tokens + newTokens);
                lastRefill = lastRefill.plus(periods * refillDuration.toMillis(), ChronoUnit.MILLIS);
            }
        }

        boolean tryConsume() {
            if (tokens > 0) {
                tokens--;
                return true;
            }
            return false;
        }
    }
}
```

### 2. Sliding Window Log

```java
@Component
public class SlidingWindowRateLimiter {

    private final Cache<String, LinkedList<Instant>> requestLogs;

    public SlidingWindowRateLimiter() {
        this.requestLogs = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .maximumSize(100000)
            .build();
    }

    public boolean allowRequest(String clientId, int maxRequests, Duration windowDuration) {
        Instant now = Instant.now();
        Instant windowStart = now.minus(windowDuration);

        LinkedList<Instant> timestamps = requestLogs.get(clientId, k -> new LinkedList<>());

        synchronized (timestamps) {
            // Remove expired entries
            while (!timestamps.isEmpty() && timestamps.peekFirst().isBefore(windowStart)) {
                timestamps.pollFirst();
            }

            if (timestamps.size() >= maxRequests) {
                return false;
            }

            timestamps.addLast(now);
            return true;
        }
    }

    public long getRemainingRequests(String clientId, int maxRequests, Duration windowDuration) {
        LinkedList<Instant> timestamps = requestLogs.getIfPresent(clientId);
        if (timestamps == null) return maxRequests;

        Instant windowStart = Instant.now().minus(windowDuration);
        int activeRequests = (int) timestamps.stream()
            .filter(t -> !t.isBefore(windowStart))
            .count();

        return Math.max(0, maxRequests - activeRequests);
    }

    public Duration getResetTime(String clientId, Duration windowDuration) {
        LinkedList<Instant> timestamps = requestLogs.getIfPresent(clientId);
        if (timestamps == null || timestamps.isEmpty()) return Duration.ZERO;

        Instant oldest = timestamps.peekFirst();
        Instant resetTime = oldest.plus(windowDuration);
        return Duration.between(Instant.now(), resetTime);
    }
}
```

### 3. Sliding Window Counter

```java
@Component
public class SlidingWindowCounterRateLimiter {

    private final Cache<String, WindowCounter> counters;

    public SlidingWindowCounterRateLimiter() {
        this.counters = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .maximumSize(100000)
            .build();
    }

    public boolean allowRequest(String clientId, int maxRequests, long windowSizeSeconds) {
        String key = clientId;
        WindowCounter counter = counters.get(key, k -> new WindowCounter(windowSizeSeconds, maxRequests));

        synchronized (counter) {
            return counter.allowRequest();
        }
    }

    private static class WindowCounter {
        private final long windowSizeSeconds;
        private final int maxRequests;
        private long currentWindowStart;
        private int currentWindowCount;
        private long previousWindowStart;
        private int previousWindowCount;

        WindowCounter(long windowSizeSeconds, int maxRequests) {
            this.windowSizeSeconds = windowSizeSeconds;
            this.maxRequests = maxRequests;
            long now = System.currentTimeMillis() / 1000;
            this.currentWindowStart = now;
            this.previousWindowStart = now - windowSizeSeconds;
        }

        boolean allowRequest() {
            long now = System.currentTimeMillis() / 1000;
            long windowStart = now - (now % windowSizeSeconds);

            if (windowStart != currentWindowStart) {
                // Move to next window
                previousWindowStart = currentWindowStart;
                previousWindowCount = currentWindowCount;
                currentWindowStart = windowStart;
                currentWindowCount = 0;
            }

            // Calculate weighted count from previous window
            long elapsedInCurrent = now - currentWindowStart;
            double previousWeight = 1.0 - (elapsedInCurrent / (double) windowSizeSeconds);
            double estimatedCount = currentWindowCount + (previousWindowCount * previousWeight);

            if (estimatedCount >= maxRequests) {
                return false;
            }

            currentWindowCount++;
            return true;
        }
    }
}
```

---

## Distributed Rate Limiting with Redis

### Redis-Based Rate Limiter

```java
@Component
public class RedisRateLimiter {

    private final RedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    public RedisRateLimiter(RedisTemplate<String, String> redisTemplate,
                            ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public boolean allowRequest(String clientId, int maxRequests, long windowSeconds) {
        String key = "ratelimit:" + clientId + ":" + (System.currentTimeMillis() / (windowSeconds * 1000));

        // Atomic increment
        Long count = redisTemplate.opsForValue()
            .increment(key);

        // Set expiry on first creation
        if (count != null && count == 1) {
            redisTemplate.expire(key, windowSeconds, TimeUnit.SECONDS);
        }

        return count != null && count <= maxRequests;
    }

    public RateLimitStatus checkLimit(String clientId, int maxRequests, long windowSeconds) {
        String currentKey = "ratelimit:" + clientId + ":" + (System.currentTimeMillis() / (windowSeconds * 1000));
        String previousKey = "ratelimit:" + clientId + ":" + ((System.currentTimeMillis() / (windowSeconds * 1000)) - 1);

        String currentCount = redisTemplate.opsForValue().get(currentKey);
        String previousCount = redisTemplate.opsForValue().get(previousKey);

        int current = currentCount != null ? Integer.parseInt(currentCount) : 0;
        int previous = previousCount != null ? Integer.parseInt(previousCount) : 0;

        // Sliding window estimate
        double elapsed = (System.currentTimeMillis() % (windowSeconds * 1000)) / 1000.0;
        double weight = 1.0 - (elapsed / windowSeconds);
        double estimated = current + (previous * weight);

        return new RateLimitStatus(
            (int) estimated,
            maxRequests,
            (long) ((1.0 - elapsed / windowSeconds) * windowSeconds)
        );
    }
}

class RateLimitStatus {
    private final int currentUsage;
    private final int limit;
    private final long resetTimeSeconds;

    RateLimitStatus(int currentUsage, int limit, long resetTimeSeconds) {
        this.currentUsage = currentUsage;
        this.limit = limit;
        this.resetTimeSeconds = resetTimeSeconds;
    }

    public int getRemaining() { return Math.max(0, limit - currentUsage); }
    public int getLimit() { return limit; }
    public long getResetTimeSeconds() { return resetTimeSeconds; }
}
```

---

## Spring Boot Rate Limiting Filter

### Rate Limiting Interceptor

```java
@Component
public class RateLimitingFilter extends OncePerRequestFilter {

    private final RedisRateLimiter rateLimiter;
    private final RateLimitConfig rateLimitConfig;

    private static final Map<Integer, String> TIER_LIMITS = Map.of(
        1, "basic",
        2, "premium",
        3, "enterprise"
    );

    public RateLimitingFilter(RedisRateLimiter rateLimiter,
                              RateLimitConfig rateLimitConfig) {
        this.rateLimiter = rateLimiter;
        this.rateLimitConfig = rateLimitConfig;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String clientId = resolveClientId(request);
        int tier = resolveTier(clientId);
        TierConfig config = rateLimitConfig.getTierConfig(tier);

        RateLimitStatus status = rateLimiter.checkLimit(clientId, config.getMaxRequests(), config.getWindowSeconds());

        response.setHeader("X-RateLimit-Limit", String.valueOf(status.getLimit()));
        response.setHeader("X-RateLimit-Remaining", String.valueOf(status.getRemaining()));
        response.setHeader("X-RateLimit-Reset", String.valueOf(status.getResetTimeSeconds()));

        if (status.getRemaining() <= 0) {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);

            Map<String, Object> error = Map.of(
                "error", "rate_limit_exceeded",
                "message", "API rate limit exceeded. Try again in " + status.getResetTimeSeconds() + " seconds",
                "retry_after", status.getResetTimeSeconds()
            );

            response.getWriter().write(objectMapper.writeValueAsString(error));
            return;
        }

        filterChain.doFilter(request, response);
    }

    private String resolveClientId(HttpServletRequest request) {
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null) return apiKey;

        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }

        return request.getRemoteAddr();
    }

    private int resolveTier(String clientId) {
        // Look up client tier from database or cache
        return 1; // Default to basic tier
    }
}

@ConfigurationProperties(prefix = "ratelimit")
@Component
public class RateLimitConfig {

    private Map<Integer, TierConfig> tiers = new HashMap<>();

    public RateLimitConfig() {
        tiers.put(1, new TierConfig(10, 60));      // 10 requests/minute
        tiers.put(2, new TierConfig(100, 60));     // 100 requests/minute
        tiers.put(3, new TierConfig(1000, 60));    // 1000 requests/minute
    }

    public TierConfig getTierConfig(int tier) {
        return tiers.getOrDefault(tier, tiers.get(1));
    }

    public static class TierConfig {
        private int maxRequests;
        private long windowSeconds;

        public TierConfig() {}

        public TierConfig(int maxRequests, long windowSeconds) {
            this.maxRequests = maxRequests;
            this.windowSeconds = windowSeconds;
        }

        public int getMaxRequests() { return maxRequests; }
        public long getWindowSeconds() { return windowSeconds; }
    }
}
```

---

## Best Practices

1. **Always return rate limit headers**: X-RateLimit-Limit, Remaining, Reset
2. **Return 429 with Retry-After**: Standard rate limit response
3. **Use sliding window**: More accurate than fixed window
4. **Implement per-client limits**: Different tiers for different clients
5. **Distributed rate limiting**: Use Redis for multi-instance deployments
6. **Rate limit by endpoint**: Stricter limits for expensive operations
7. **Soft and hard limits**: Warn before blocking
8. **Monitor rate limit metrics**: Track blocked requests
9. **Provide quota management UI**: Let clients see their usage
10. **Implement gradual backoff**: Recommend retry timing

```java
// Retry-After header
@ExceptionHandler(RateLimitExceededException.class)
public ResponseEntity<ProblemDetail> handleRateLimit(RateLimitExceededException ex) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.TOO_MANY_REQUESTS);
    problem.setTitle("Rate Limit Exceeded");

    return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
        .header("Retry-After", String.valueOf(ex.getRetryAfter()))
        .header("X-RateLimit-Remaining", "0")
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(problem);
}
```

---

## Common Mistakes

### Mistake 1: Fixed Window at Boundaries

```java
// WRONG: Fixed window allows 2x burst at boundaries
// Requests at 00:59:59 and 01:00:00 both get full quota

// CORRECT: Sliding window smooths the boundary
```

### Mistake 2: Not Handling Distributed State

```java
// WRONG: In-memory rate limiting doesn't work across instances
// Instance 1: 10 requests, Instance 2: 10 requests
// Client can make 20 requests total

// CORRECT: Use Redis for distributed counting
```

### Mistake 3: Blocking Without Warning

```java
// WRONG: Client gets 429 without warning
// CORRECT: Return rate limit headers so clients can slow down
response.setHeader("X-RateLimit-Remaining", "5");
// Client can see remaining quota and back off
```

---

## Summary

1. Token bucket: Simple, allows bursts, good for general use
2. Sliding window log: Most accurate, higher memory
3. Sliding window counter: Good balance of accuracy and efficiency
4. Redis-based: Essential for distributed systems
5. Always return rate limit headers for client awareness
6. Different tiers for different client types
7. Monitor and alert on rate limit violations
8. Soft limits warn before hard limits block

---

## References

- [Stripe Rate Limiting](https://stripe.com/docs/rate-limits)
- [GitHub API Rate Limiting](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting)
- [Redis Rate Limiting Patterns](https://redis.io/docs/reference/patterns/rate-limiting/)
- [RFC 6585 - 429 Too Many Requests](https://tools.ietf.org/html/rfc6585)

Happy Coding