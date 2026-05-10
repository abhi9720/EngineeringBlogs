---
title: "API Gateway Pattern"
description: "Deep dive into API Gateway patterns for microservices: routing, authentication, rate limiting, and implementation with Spring Cloud Gateway"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - microservices
  - api-gateway
  - spring-cloud
  - gateway
coverImage: "/images/api-gateway-pattern.png"
draft: false
---

# API Gateway Pattern: The Front Door to Your Microservices

## Overview

In a microservices architecture, clients need to interact with multiple backend services. Without an API Gateway, clients face several problems: they must know the location of every service, handle authentication with each service separately, and make multiple network calls to fetch all required data.

The API Gateway acts as a single entry point for all clients, handling cross-cutting concerns like routing, authentication, rate limiting, and response aggregation. This guide covers how to implement an API Gateway effectively and avoid common pitfalls.

---

## How API Gateway Works Internally

### The Gateway Architecture

The API Gateway sits between clients and backend services:

```
┌──────────────────────────────────────────────────────────────────┐
│                         Client Applications                       │
│  (Web App, Mobile App, External API Consumers)                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │ Single Request
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                         API Gateway                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 │
│  │  Routing    │ │  Auth       │ │  Rate       │                 │
│  │  Engine     │ │  Handler    │ │  Limiter    │                 │
│  └─────────────┘ └─────────────┘ └─────────────┘                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 │
│  │  Circuit    │ │  Response   │ │  Logging    │                 │
│  │  Breaker    │ │  Transform  │ │  & Metrics  │                 │
│  └─────────────┘ └─────────────┘ └─────────────┘                 │
└──────────────────────────┬───────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ User Service    │ │ Order Service   │ │ Product Service │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Spring Cloud Gateway Internals

Spring Cloud Gateway uses a reactive foundation built on WebFlux:

```java
// The gateway uses a chain of filters
@Configuration
public class GatewayConfig {
    
    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("user_route", r -> r
                .path("/api/users/**")
                .filters(f -> f
                    .addRequestHeader("X-Gateway-Added", "header-value")
                    .addResponseHeader("X-Gateway-Response", "processed")
                    .circuitBreaker(config -> config
                        .setName("userCircuitBreaker")
                        .setFallbackUri("forward:/fallback/users")))
                .uri("lb://user-service"))
            .route("order_route", r -> r
                .path("/api/orders/**")
                .filters(f -> f
                    .stripPrefix(1)  // Remove /api prefix
                    .requestRateLimiter(config -> config
                        .setRateLimiter(redisRateLimiter())
                        .setKeyResolver(userKeyResolver())))
                .uri("lb://order-service"))
            .build();
    }
}

// How the gateway processes requests (simplified)
public class GatewayWebHandler {
    
    private final List<GatewayFilter> globalFilters;
    private final Map<String, Route> routeMap;
    
    public Mono<Void> handle(ServerWebExchange exchange) {
        
        // 1. Get matching route
        Route route = getMatchingRoute(exchange);
        
        // 2. Build filter chain
        List<GatewayFilter> chain = buildFilterChain(route, exchange);
        
        // 3. Execute chain
        return new DefaultGatewayFilterChain(chain).filter(exchange);
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Centralized Authentication

```java
@Configuration
public class AuthenticationGatewayFilter {
    
    @Bean
    public GatewayFilter authenticationFilter(JwtService jwtService) {
        return (exchange, chain) -> {
            ServerHttpRequest request = exchange.getRequest();
            
            // Skip authentication for public endpoints
            if (isPublicEndpoint(request.getPath().value())) {
                return chain.filter(exchange);
            }
            
            String authHeader = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
            
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                return unauthorized(exchange);
            }
            
            String token = authHeader.substring(7);
            
            try {
                JwtToken tokenData = jwtService.validate(token);
                
                // Add user info to headers for downstream services
                ServerHttpRequest modifiedRequest = request.mutate()
                    .header("X-User-Id", tokenData.getUserId())
                    .header("X-User-Roles", String.join(",", tokenData.getRoles()))
                    .build();
                
                return chain.filter(exchange.mutate().request(modifiedRequest).build());
                
            } catch (JwtException e) {
                return unauthorized(exchange);
            }
        };
    }
    
    private boolean isPublicEndpoint(String path) {
        return path.startsWith("/public/") || 
               path.startsWith("/auth/") ||
               path.equals("/health");
    }
    
    private Mono<Void> unauthorized(ServerWebExchange exchange) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        return exchange.getResponse().setComplete();
    }
}

// Gateway configuration
@Configuration
public class GatewayRoutesConfig {
    
    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("auth_route", r -> r
                .path("/api/auth/**")
                .filters(f -> f.stripPrefix(0))
                .uri("http://localhost:8081"))
            .route("protected_route", r -> r
                .path("/api/**")
                .filters(f -> f.filters(authenticationFilter(null)))  // Wire via @Autowired
                .uri("lb://"))
            .build();
    }
}
```

### Case 2: Request Aggregation

```java
// Aggregating multiple service calls into single response
@Configuration
public class AggregationFilter {
    
    @Bean
    public GatewayFilter aggregatorFilter(WebClient.Builder webClientBuilder) {
        
        return (exchange, chain) -> {
            ServerHttpRequest request = exchange.getRequest();
            
            // Only aggregate specific routes
            if (request.getPath().value().equals("/api/dashboard")) {
                return aggregateDashboardData(exchange, chain, webClientBuilder.build());
            }
            
            return chain.filter(exchange);
        };
    }
    
    private Mono<Void> aggregateDashboardData(ServerWebExchange exchange, 
                                               GatewayFilterChain chain,
                                               WebClient webClient) {
        
        // Fetch from multiple services in parallel
        Mono<UserSummary> userMono = webClient.get()
            .uri("http://user-service/api/users/summary")
            .retrieve()
            .bodyToMono(UserSummary.class);
        
        Mono<OrderSummary> orderMono = webClient.get()
            .uri("http://order-service/api/orders/summary")
            .retrieve()
            .bodyToMono(OrderSummary.class);
        
        Mono<NotificationSummary> notifMono = webClient.get()
            .uri("http://notification-service/api/notifications/summary")
            .retrieve()
            .bodyToMono(NotificationSummary.class);
        
        // Combine results
        return Mono.zip(userMono, orderMono, notifMono)
            .flatMap(tuple -> {
                DashboardResponse response = DashboardResponse.builder()
                    .user(tuple.getT1())
                    .orders(tuple.getT2())
                    .notifications(tuple.getT3())
                    .build();
                
                exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
                DataBuffer buffer = exchange.getResponse().bufferFactory()
                    .wrap(new ObjectMapper().writeValueAsBytes(response));
                
                return exchange.getResponse().writeWith(Mono.just(buffer));
            })
            .onErrorResume(e -> {
                exchange.getResponse().setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
                return exchange.getResponse().setComplete();
            });
    }
}
```

### Case 3: Rate Limiting

```java
// Redis-based rate limiting
@Configuration
public class RateLimitingConfig {
    
    @Bean
    public RedisRateLimiter redisRateLimiter(RedisTemplate<String, String> redisTemplate) {
        return new RedisRateLimiter(100, 1000);  // 100 requests per second, burst of 1000
    }
    
    @Bean
    public GatewayFilter rateLimitingFilter(RedisRateLimiter rateLimiter) {
        return (exchange, chain) -> {
            String path = exchange.getRequest().getPath().value();
            
            // Only rate limit certain paths
            if (path.startsWith("/api/")) {
                String clientId = getClientId(exchange);
                
                return rateLimiter.isAllowed(path, clientId)
                    .flatMap(allowed -> {
                        if (allowed) {
                            // Add rate limit headers
                            exchange.getResponse().getHeaders()
                                .add("X-RateLimit-Remaining", "99");
                            return chain.filter(exchange);
                        }
                        
                        exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
                        exchange.getResponse().getHeaders()
                            .add("Retry-After", "60");
                        return exchange.getResponse().setComplete();
                    });
            }
            
            return chain.filter(exchange);
        };
    }
    
    private String getClientId(ServerWebExchange exchange) {
        // Get from header or use IP
        String userId = exchange.getRequest().getHeaders().getFirst("X-User-Id");
        return userId != null ? userId : exchange.getRequest().getRemoteAddress().getAddress().getHostAddress();
    }
}
```

### Case 4: Circuit Breaker Integration

```java
// Circuit breaker for backend services
@Configuration
public class CircuitBreakerConfig {
    
    @Bean
    public CircuitBreakerFactory circuitBreakerFactory() {
        return new Resilience4JCircuitBreakerFactory();
    }
    
    @Bean
    public GatewayFilter circuitBreakerFilter(CircuitBreakerFactory circuitBreakerFactory) {
        
        return (exchange, chain) -> {
            ServerHttpRequest request = exchange.getRequest();
            
            // Extract service name from path
            String serviceName = extractServiceName(request.getPath().value());
            
            CircuitBreaker circuitBreaker = circuitBreakerFactory.create(serviceName);
            
            // Wrap the downstream call
            return Mono.defer(() -> {
                ServerHttpResponse response = exchange.getResponse();
                
                if (response.getStatusCode() != null && 
                    response.getStatusCode().is5xxServerError()) {
                    return Mono.error(new ServiceUnavailableException(serviceName));
                }
                
                return chain.filter(exchange);
            })
            .transformDeferred(
                circuitBreaker.transformDeferred(
                    Mono::error,
                    error -> {
                        exchange.getResponse().setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
                        return exchange.getResponse().setComplete();
                    }
                )
            );
        };
    }
    
    private String extractServiceName(String path) {
        // /api/users/* -> users
        if (path.startsWith("/api/")) {
            String[] parts = path.substring(5).split("/");
            return parts.length > 0 ? parts[0] : "unknown";
        }
        return "unknown";
    }
}
```

### Case 5: Service Versioning

```java
// Route to different service versions based on header or query param
@Configuration
public class VersionRoutingConfig {
    
    @Bean
    public RouteLocator versionedRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("users_v1", r -> r
                .path("/api/v1/users")
                .filters(f -> f.setPath("/users"))
                .uri("http://localhost:8081"))
            .route("users_v2", r -> r
                .path("/api/v2/users")
                .filters(f -> f.setPath("/users"))
                .uri("http://localhost:8082"))
            .route("products_latest", r -> r
                .order(10)
                .path("/api/products/**")
                .filters(f -> f.setPath("/products"))
                .uri("lb://product-service"))
            .build();
    }
}

// Alternative: Header-based routing
@Configuration
public class HeaderBasedRoutingConfig {
    
    @Bean
    public RouteLocator headerBasedRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("premium_users", r -> r
                .header("X-Customer-Tier", "premium")
                .and()
                .path("/api/users/**")
                .filters(f -> f
                    .addRequestHeader("X-Request-Priority", "high"))
                .uri("lb://premium-user-service"))
            .route("standard_users", r -> r
                .path("/api/users/**")
                .uri("lb://user-service"))
            .build();
    }
}
```

---

## Trade-offs: API Gateway vs BFF Pattern

### API Gateway (Single Entry Point)

| Pros | Cons |
|------|------|
| Single entry point for all clients | Can become single point of failure |
| Centralized security | Might be over-engineered for few services |
| Reduces client complexity | Additional network hop |
| Standardized logging | Requires separate scaling |

### Backend for Frontend (BFF)

| Pros | Cons |
|------|------|
| Optimized for each client type | Code duplication |
| Different APIs per frontend | Multiple entry points |
| Can implement client-specific logic | More complex to maintain |

### Decision Matrix

| Scenario | Recommended Approach |
|----------|----------------------|
| Few clients with similar needs | API Gateway |
| Multiple client types (web, mobile, external) | BFF or API Gateway + BFF |
| External API consumers | API Gateway |
| Internal services only | Direct communication or lightweight gateway |

---

## Production Considerations

### 1. High Availability

```yaml
# Kubernetes deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: gateway
        image: my-api-gateway:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
spec:
  selector:
    app: api-gateway
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
```

### 2. Caching at Gateway Level

```java
@Configuration
public class CachingConfig {
    
    @Bean
    public GatewayFilter cachingFilter(RedisTemplate<String, Object> redisTemplate) {
        
        return (exchange, chain) -> {
            String path = exchange.getRequest().getPath().value();
            
            // Only cache GET requests
            if (!HttpMethod.GET.equals(exchange.getRequest().getMethod())) {
                return chain.filter(exchange);
            }
            
            // Check cache
            String cacheKey = "gateway:cache:" + path;
            Object cached = redisTemplate.opsForValue().get(cacheKey);
            
            if (cached != null) {
                exchange.getResponse().getHeaders().set("X-Cache", "HIT");
                exchange.getResponse().getHeaders()
                    .setContentType(MediaType.APPLICATION_JSON);
                
                DataBuffer buffer = exchange.getResponse().bufferFactory()
                    .wrap((byte[]) cached);
                
                return exchange.getResponse().writeWith(Mono.just(buffer));
            }
            
            // Not in cache, continue to service
            return chain.filter(exchange)
                .doOnSuccess(unused -> {
                    // Store in cache (for 5 minutes)
                    ServerHttpResponse response = exchange.getResponse();
                    if (response.getStatusCode().is2xxSuccessful()) {
                        // Cache response body (simplified)
                    }
                });
        };
    }
}
```

### 3. Monitoring and Metrics

```java
@Configuration
public class GatewayMetricsConfig {
    
    @Bean
    public ReactiveMeterRegistryCustomizer<MeterRegistry> metrics() {
        return registry -> {
            registry.config().commonTags("application", "api-gateway");
            
            // Custom metrics for routes
            Gauge.builder("gateway.route.requests", 
                new AtomicInteger(), AtomicInteger::get)
                .tag("route", "user-service")
                .register(registry);
        };
    }
}

// Add to application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,gateway
  metrics:
    enable:
      gateway: true
```

---

## Common Mistakes

### Mistake 1: Gateway Doing Too Much

```java
// WRONG: Putting business logic in gateway
@Component
public class BusinessLogicFilter extends GatewayFilter {
    
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        
        // Don't do business logic in gateway!
        User user = authenticate(exchange.getRequest());
        
        // Calculate prices based on user tier
        BigDecimal price = calculatePrice(user, productService.getProduct(productId));
        
        // Transform business logic response
        return chain.filter(exchange);
    }
}

// CORRECT: Gateway handles cross-cutting concerns only
// Authentication, routing, rate limiting, logging
// Business logic stays in backend services
```

### Mistake 2: No Circuit Breaker

```java
// WRONG: No fallback when backend is down
@Configuration
public class NoCircuitBreakerConfig {
    
    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("users", r -> r
                .path("/api/users/**")
                .uri("lb://user-service"))
            .build();
        // No circuit breaker configured
    }
}

// CORRECT: Add circuit breaker
@Configuration
public class CircuitBreakerConfig {
    
    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("users", r -> r
                .path("/api/users/**")
                .filters(f -> f
                    .circuitBreaker(config -> config
                        .setName("usersCircuitBreaker")
                        .setFallbackUri("forward:/fallback")))
                .uri("lb://user-service"))
            .build();
    }
    
    @RestController
    public static class FallbackController {
        
        @GetMapping("/fallback")
        public Map<String, Object> fallback() {
            return Map.of(
                "status", "SERVICE_UNAVAILABLE",
                "message", "Service is temporarily unavailable. Please try again later."
            );
        }
    }
}
```

### Mistake 3: Not Handling Timeouts

```java
// WRONG: No timeout configuration
@Configuration
public class NoTimeoutConfig {
    
    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("slow_service", r -> r
                .path("/api/reports/**")
                .uri("lb://report-service"))
            .build();
    }
}

// CORRECT: Configure timeouts
@Configuration
public class TimeoutConfig {
    
    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("slow_service", r -> r
                .path("/api/reports/**")
                .filters(f -> f
                    .requestTimeout(Duration.ofSeconds(30))
                    .setResponseTimeout(Duration.ofSeconds(30)))
                .uri("lb://report-service"))
            .route("fast_service", r -> r
                .path("/api/users/**")
                .filters(f -> f
                    .requestTimeout(Duration.ofSeconds(5))
                    .setResponseTimeout(Duration.ofSeconds(5)))
                .uri("lb://user-service"))
            .build();
    }
}
```

### Mistake 4: Not Preserving Client Information

```java
// WRONG: Removing important headers
@Configuration
public class BadHeaderConfig {
    
    @Bean
    public GatewayFilter stripHeaders() {
        return (exchange, chain) -> {
            // Strip all headers - lose important information!
            ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(h -> h.clear())
                .build();
            
            return chain.filter(exchange.mutate().request(request).build());
        };
    }
}

// CORRECT: Preserve important headers
@Configuration
public class GoodHeaderConfig {
    
    @Bean
    public GatewayFilter preserveHeaders() {
        return (exchange, chain) -> {
            ServerHttpRequest request = exchange.getRequest();
            
            // Preserve important headers
            ServerHttpRequest modified = request.mutate()
                .header("X-Original-Host", request.getHost().toString())
                .header("X-Original-Method", request.getMethod().name())
                .build();
            
            return chain.filter(exchange.mutate().request(modified).build());
        };
    }
}
```

### Mistake 5: Hardcoding Service URLs

```java
// WRONG: Hardcoded URLs in gateway
@Configuration
public class BadRoutingConfig {
    
    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("users", r -> r
                .path("/api/users/**")
                .uri("http://user-service:8080"))  // Hardcoded!
            .route("orders", r -> r
                .path("/api/orders/**")
                .uri("http://order-service:8081"))  // Hardcoded!
            .build();
    }
}

// CORRECT: Use service discovery
@Configuration
public class GoodRoutingConfig {
    
    @Bean
    public RouteLocator routes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("users", r -> r
                .path("/api/users/**")
                .uri("lb://user-service"))  // Service discovery
            .route("orders", r -> r
                .path("/api/orders/**")
                .uri("lb://order-service"))  // Service discovery
            .build();
    }
}
```

---

## Summary

The API Gateway is the front door to your microservices. Key takeaways:

1. **Single entry point**: Centralize cross-cutting concerns like auth, rate limiting.

2. **Keep it simple**: Don't put business logic in the gateway.

3. **Handle failures**: Use circuit breakers and fallbacks.

4. **Configure timeouts**: Prevent slow services from affecting others.

5. **Use service discovery**: Don't hardcode service URLs.

6. **Monitor**: Track request metrics and health.

The API Gateway is a critical component—invest in making it robust and observable.

---

## References

- [Spring Cloud Gateway Documentation](https://spring.io/projects/spring-cloud-gateway)
- [API Gateway Patterns](https://docs.microsoft.com/en-us/azure/architecture/microservices/design/gateway)
- [Baeldung - Spring Cloud Gateway](https://www.baeldung.com/spring-cloud-gateway)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)