---
title: "Retry and Circuit Breaker for HTTP Clients"
description: "Implement Resilience4j retry, circuit breaker, rate limiter, and bulkhead patterns for resilient HTTP clients in Spring Boot"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - resilience4j
  - circuit-breaker
  - retry
  - fault-tolerance
coverImage: "/images/retry-and-circuit-breaker-for-clients.png"
draft: false
---

# Retry and Circuit Breaker for HTTP Clients

## Overview

External service calls are the most common point of failure in distributed systems. A downstream service might be slow, temporarily unavailable, or returning errors. Without proper resilience patterns, a single failing service can cascade through your entire system.

Resilience4j provides four complementary patterns for HTTP clients: Retry (transient failure recovery), Circuit Breaker (preventing cascading failures), Rate Limiter (controlling request rate), and Bulkhead (isolating failure domains). This guide covers all four patterns with production configurations.

---

## Understanding Resilience4j Architecture

### Core Modules and Their Interaction

```java
// Resilience4j core decorators chain
@Service
public class ResilientService {

    private final Retry retry;
    private final CircuitBreaker circuitBreaker;
    private final RateLimiter rateLimiter;
    private final Bulkhead bulkhead;
    private final WebClient webClient;

    public Mono<User> getUser(Long id) {
        // Decorators are applied from outer to inner:
        // Bulkhead -> RateLimiter -> CircuitBreaker -> Retry
        return Decorators
            .ofSupplier(() -> fetchUser(id))
            .withBulkhead(bulkhead)
            .withRateLimiter(rateLimiter)
            .withCircuitBreaker(circuitBreaker)
            .withRetry(retry)
            .get();
    }

    private User fetchUser(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .block(Duration.ofSeconds(5));
    }
}
```

### State Machine for Circuit Breaker

```java
// Circuit breaker state transitions
public enum CircuitBreakerState {
    CLOSED,      // Normal operation, requests pass through
    OPEN,        // Failures threshold exceeded, requests rejected immediately
    HALF_OPEN    // Testing if service recovered, limited requests allowed
}

// Internal state machine
public class CircuitBreakerStateMachine {

    private final AtomicReference<CircuitBreakerState> state =
        new AtomicReference<>(CircuitBreakerState.CLOSED);
    private final AtomicInteger failureCount = new AtomicInteger(0);
    private final AtomicInteger successCount = new AtomicInteger(0);
    private final int failureThreshold;
    private final int halfOpenMaxCalls;
    private final Duration waitDurationInOpenState;
    private volatile Instant lastFailureTime;

    public boolean isCallPermitted() {
        CircuitBreakerState currentState = state.get();

        switch (currentState) {
            case CLOSED:
                return true;
            case OPEN:
                if (Duration.between(lastFailureTime, Instant.now())
                        .compareTo(waitDurationInOpenState) > 0) {
                    state.compareAndSet(
                        CircuitBreakerState.OPEN,
                        CircuitBreakerState.HALF_OPEN);
                    return true;
                }
                return false;
            case HALF_OPEN:
                return successCount.get() < halfOpenMaxCalls;
            default:
                return true;
        }
    }

    public void onSuccess() {
        CircuitBreakerState currentState = state.get();
        if (currentState == CircuitBreakerState.HALF_OPEN) {
            if (successCount.incrementAndGet() >= halfOpenMaxCalls) {
                state.set(CircuitBreakerState.CLOSED);
                failureCount.set(0);
                successCount.set(0);
            }
        } else if (currentState == CircuitBreakerState.CLOSED) {
            failureCount.set(0);  // Reset on consecutive success
        }
    }

    public void onError(Throwable throwable) {
        CircuitBreakerState currentState = state.get();
        if (currentState == CircuitBreakerState.HALF_OPEN) {
            state.set(CircuitBreakerState.OPEN);
            lastFailureTime = Instant.now();
            successCount.set(0);
        } else if (currentState == CircuitBreakerState.CLOSED) {
            if (failureCount.incrementAndGet() >= failureThreshold) {
                state.set(CircuitBreakerState.OPEN);
                lastFailureTime = Instant.now();
            }
        }
    }
}
```

---

## Configuration

### application.yml

```yaml
resilience4j:
  retry:
    configs:
      default:
        maxRetryAttempts: 3
        waitDuration: 500ms
        exponentialBackoffMultiplier: 2
        retryExceptions:
          - org.springframework.web.client.HttpServerErrorException
          - java.net.ConnectException
          - java.net.SocketTimeoutException
        ignoreExceptions:
          - com.example.BadRequestException
    instances:
      userService:
        baseConfig: default
        maxRetryAttempts: 3
        waitDuration: 200ms
      paymentService:
        baseConfig: default
        maxRetryAttempts: 5
        waitDuration: 1s

  circuitbreaker:
    configs:
      default:
        slidingWindowSize: 10
        minimumNumberOfCalls: 5
        failureRateThreshold: 50
        waitDurationInOpenState: 10s
        permittedNumberOfCallsInHalfOpenState: 3
        slowCallRateThreshold: 50
        slowCallDurationThreshold: 5s
        recordExceptions:
          - org.springframework.web.client.HttpServerErrorException
          - java.net.SocketTimeoutException
        ignoreExceptions:
          - com.example.ResourceNotFoundException
    instances:
      userService:
        baseConfig: default
        slidingWindowSize: 20
        failureRateThreshold: 40
      paymentService:
        baseConfig: default
        waitDurationInOpenState: 30s

  ratelimiter:
    configs:
      default:
        limitForPeriod: 100
        limitRefreshPeriod: 1s
        timeoutDuration: 500ms
    instances:
      paymentService:
        limitForPeriod: 50
        limitRefreshPeriod: 1s

  bulkhead:
    configs:
      default:
        maxConcurrentCalls: 25
        maxWaitDuration: 500ms
    instances:
      paymentService:
        maxConcurrentCalls: 10
```

### Java Configuration

```java
@Configuration
public class Resilience4jConfig {

    @Bean
    public Customizer<RetryConfig> retryConfigCustomizer() {
        return config -> config
            .maxAttempts(3)
            .waitDuration(Duration.ofMillis(500))
            .retryOnResult(response -> {
                if (response instanceof OrderResponse) {
                    OrderResponse orderResponse = (OrderResponse) response;
                    return "PENDING".equals(orderResponse.getStatus());
                }
                return false;
            })
            .retryOnException(e ->
                e instanceof HttpServerErrorException
                    || e instanceof SocketTimeoutException
                    || e instanceof ConnectException)
            .ignoreException(e ->
                e instanceof IllegalArgumentException
                    || e instanceof ResourceNotFoundException);
    }

    @Bean
    public Customizer<CircuitBreakerConfig> circuitBreakerConfigCustomizer() {
        return config -> config
            .slidingWindowType(CircuitBreakerConfig.SlidingWindowType.COUNT_BASED)
            .slidingWindowSize(10)
            .minimumNumberOfCalls(5)
            .failureRateThreshold(50)
            .slowCallRateThreshold(50)
            .slowCallDurationThreshold(Duration.ofSeconds(5))
            .waitDurationInOpenState(Duration.ofSeconds(10))
            .permittedNumberOfCallsInHalfOpenState(3)
            .recordExceptions(HttpServerErrorException.class, SocketTimeoutException.class)
            .ignoreExceptions(ResourceNotFoundException.class);
    }

    @Bean
    public Customizer<RateLimiterConfig> rateLimiterConfigCustomizer() {
        return config -> config
            .limitForPeriod(100)
            .limitRefreshPeriod(Duration.ofSeconds(1))
            .timeoutDuration(Duration.ofMillis(500));
    }

    @Bean
    public Customizer<BulkheadConfig> bulkheadConfigCustomizer() {
        return config -> config
            .maxConcurrentCalls(25)
            .maxWaitDuration(Duration.ofMillis(500));
    }

    @Bean
    public Customizer<ThreadPoolBulkheadConfig> threadPoolBulkheadConfigCustomizer() {
        return config -> config
            .maxThreadPoolSize(10)
            .coreThreadPoolSize(5)
            .queueCapacity(20)
            .keepAliveDuration(Duration.ofMinutes(1));
    }
}
```

---

## Real-World Implementations

### WebClient with Resilience4j

```java
@Service
public class ResilientPaymentClient {

    private final WebClient webClient;
    private final CircuitBreaker circuitBreaker;
    private final Retry retry;
    private final RateLimiter rateLimiter;
    private final Bulkhead bulkhead;

    private static final Logger log = LoggerFactory.getLogger(ResilientPaymentClient.class);

    public ResilientPaymentClient(
            CircuitBreakerRegistry circuitBreakerRegistry,
            RetryRegistry retryRegistry,
            RateLimiterRegistry rateLimiterRegistry,
            BulkheadRegistry bulkheadRegistry) {

        this.webClient = WebClient.builder()
            .baseUrl("https://payment-gateway.com/api")
            .build();
        this.circuitBreaker = circuitBreakerRegistry.circuitBreaker("paymentService");
        this.retry = retryRegistry.retry("paymentService");
        this.rateLimiter = rateLimiterRegistry.rateLimiter("paymentService");
        this.bulkhead = bulkheadRegistry.bulkhead("paymentService");
    }

    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    @Retry(name = "paymentService")
    @RateLimiter(name = "paymentService")
    @Bulkhead(name = "paymentService")
    public PaymentResponse processPayment(PaymentRequest request) {
        log.debug("Processing payment: {}", request.getTransactionId());

        return webClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResponse.class)
            .block(Duration.ofSeconds(10));
    }

    public PaymentResponse paymentFallback(PaymentRequest request, Exception ex) {
        log.error("Payment processing failed for transaction {}: {}",
            request.getTransactionId(), ex.getMessage());

        return PaymentResponse.builder()
            .transactionId(request.getTransactionId())
            .status("FAILED")
            .errorCode("SERVICE_UNAVAILABLE")
            .errorMessage("Payment service is temporarily unavailable. Please retry later.")
            .build();
    }
}
```

### Feign Client with Resilience4j

```java
@FeignClient(
    name = "inventory-service",
    url = "${inventory.service.url}",
    configuration = InventoryFeignConfig.class,
    fallbackFactory = InventoryFallbackFactory.class
)
public interface InventoryClient {

    @GetMapping("/inventory/{sku}")
    InventoryResponse checkStock(@PathVariable("sku") String sku);

    @PostMapping("/inventory/reserve")
    InventoryReservationResponse reserveStock(@RequestBody ReserveStockRequest request);

    @PostMapping("/inventory/bulk")
    List<InventoryResponse> bulkCheckStock(@RequestBody List<String> skus);
}

@Configuration
public class InventoryFeignConfig {

    @Bean
    public Retryer retryer() {
        return Retryer.Default(100, 1000, 3);
    }

    @Bean
    public ErrorDecoder errorDecoder() {
        return new InventoryErrorDecoder();
    }
}

@Component
public class InventoryFallbackFactory implements FallbackFactory<InventoryClient> {

    private static final Logger log = LoggerFactory.getLogger(InventoryFallbackFactory.class);

    @Override
    public InventoryClient create(Throwable cause) {
        log.error("Inventory service fallback triggered", cause);

        return new InventoryClient() {

            @Override
            public InventoryResponse checkStock(String sku) {
                return InventoryResponse.builder()
                    .sku(sku)
                    .available(false)
                    .build();
            }

            @Override
            public InventoryReservationResponse reserveStock(ReserveStockRequest request) {
                throw new ServiceUnavailableException("Inventory service unavailable", cause);
            }

            @Override
            public List<InventoryResponse> bulkCheckStock(List<String> skus) {
                return skus.stream()
                    .map(sku -> InventoryResponse.builder()
                        .sku(sku)
                        .available(false)
                        .build())
                    .toList();
            }
        };
    }
}

// Spring Cloud Circuit Breaker integration
@FeignClient(name = "order-service")
@CircuitBreaker(name = "order-service")
public interface OrderClient {
    // ...
}
```

### RestTemplate with Resilience4j

```java
@Component
public class ResilientRestTemplateClient {

    private final RestTemplate restTemplate;
    private final Retry retry;
    private final CircuitBreaker circuitBreaker;

    public ResilientRestTemplateClient(
            RestTemplate restTemplate,
            RetryRegistry retryRegistry,
            CircuitBreakerRegistry circuitBreakerRegistry) {
        this.restTemplate = restTemplate;
        this.retry = retryRegistry.retry("userService");
        this.circuitBreaker = circuitBreakerRegistry.circuitBreaker("userService");
    }

    public User getUser(Long id) {
        Supplier<User> userSupplier = () ->
            restTemplate.getForObject("https://user-service/users/{id}", User.class, id);

        Supplier<User> decorated = Decorators.ofSupplier(userSupplier)
            .withCircuitBreaker(circuitBreaker)
            .withRetry(retry)
            .decorate();

        return decorated.get();
    }

    // Manual decoration
    public User getUserWithManualDecoration(Long id) {
        Supplier<User> supplier = () ->
            restTemplate.getForObject("https://user-service/users/{id}", User.class, id);

        Supplier<User> retryable = Retry.decorateSupplier(retry, supplier);
        Supplier<User> circuitBreakerWrapped = CircuitBreaker.decorateSupplier(
            circuitBreaker, retryable);

        try {
            return circuitBreakerWrapped.get();
        } catch (Exception e) {
            log.error("Failed to fetch user {} after retries and circuit breaker", id, e);
            return User.builder().id(id).name("Unknown").status("UNAVAILABLE").build();
        }
    }
}
```

---

## Event Monitoring and Metrics

### Circuit Breaker Events

```java
@Component
public class CircuitBreakerEventListener {

    private static final Logger log = LoggerFactory.getLogger(CircuitBreakerEventListener.class);

    private final MeterRegistry meterRegistry;

    public CircuitBreakerEventListener(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    public void registerListeners() {
        CircuitBreakerRegistry registry = CircuitBreakerRegistry.ofDefaults();

        registry.getAllCircuitBreakers().forEach(circuitBreaker -> {
            circuitBreaker.getEventPublisher()
                .onSuccess(this::onSuccess)
                .onError(this::onError)
                .onStateTransition(this::onStateTransition)
                .onCallNotPermitted(this::onCallNotPermitted);
        });
    }

    private void onSuccess(CircuitBreakerOnSuccessEvent event) {
        meterRegistry.counter("circuitbreaker.success",
            "name", event.getCircuitBreakerName()).increment();
    }

    private void onError(CircuitBreakerOnErrorEvent event) {
        meterRegistry.counter("circuitbreaker.error",
            "name", event.getCircuitBreakerName()).increment();
        log.warn("Circuit breaker '{}' recorded error: {}",
            event.getCircuitBreakerName(), event.getThrowable().getMessage());
    }

    private void onStateTransition(CircuitBreakerOnStateTransitionEvent event) {
        meterRegistry.gauge("circuitbreaker.state",
            Tags.of("name", event.getCircuitBreakerName()),
            event.getStateTransition().getToState().ordinal());

        log.info("Circuit breaker '{}' transitioned from {} to {}",
            event.getCircuitBreakerName(),
            event.getStateTransition().getFromState(),
            event.getStateTransition().getToState());
    }

    private void onCallNotPermitted(CircuitBreakerOnCallNotPermittedEvent event) {
        meterRegistry.counter("circuitbreaker.rejected",
            "name", event.getCircuitBreakerName()).increment();
        log.warn("Circuit breaker '{}' rejected call - service is OPEN",
            event.getCircuitBreakerName());
    }
}
```

### Health Indicators

```java
@Component
public class ResilienceHealthIndicator implements HealthIndicator {

    private final CircuitBreakerRegistry circuitBreakerRegistry;

    public ResilienceHealthIndicator(CircuitBreakerRegistry circuitBreakerRegistry) {
        this.circuitBreakerRegistry = circuitBreakerRegistry;
    }

    @Override
    public Health health() {
        Map<String, Object> details = new HashMap<>();

        circuitBreakerRegistry.getAllCircuitBreakers().forEach(cb -> {
            CircuitBreaker.Metrics metrics = cb.getMetrics();

            Map<String, Object> cbDetails = new HashMap<>();
            cbDetails.put("state", cb.getState());
            cbDetails.put("failureRate", metrics.getFailureRate());
            cbDetails.put("slowCallRate", metrics.getSlowCallRate());
            cbDetails.put("numberOfBufferedCalls", metrics.getNumberOfBufferedCalls());
            cbDetails.put("numberOfFailedCalls", metrics.getNumberOfFailedCalls());
            cbDetails.put("numberOfNotPermittedCalls", metrics.getNumberOfNotPermittedCalls());

            details.put(cb.getName(), cbDetails);
        });

        boolean allHealthy = circuitBreakerRegistry.getAllCircuitBreakers().stream()
            .allMatch(cb -> !cb.getState().equals(CircuitBreaker.State.OPEN));

        return allHealthy
            ? Health.up().withDetails(details).build()
            : Health.down().withDetails(details).build();
    }
}
```

### Retry Metrics

```java
@Component
public class RetryMetricsExporter {

    private final MeterRegistry meterRegistry;

    public RetryMetricsExporter(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @EventListener
    public void handleRetryEvent(RetryOnSuccessEvent event) {
        meterRegistry.counter("retry.success",
            "name", event.getRetryName()).increment();
    }

    @EventListener
    public void handleRetryError(RetryOnErrorEvent event) {
        meterRegistry.counter("retry.error",
            "name", event.getRetryName(),
            "type", event.getThrowable().getClass().getSimpleName()).increment();
    }

    @EventListener
    public void handleRetryAttempt(RetryOnRetryEvent event) {
        Counter attemptCounter = Counter.builder("retry.attempts")
            .tag("name", event.getRetryName())
            .tag("attempt", String.valueOf(event.getNumberOfRetryAttempts()))
            .register(meterRegistry);
        attemptCounter.increment();
    }
}
```

---

## Advanced Patterns

### Exponential Backoff with Jitter

```java
@Configuration
public class RetryWithJitterConfig {

    @Bean
    public Retry retryWithJitter(RetryRegistry retryRegistry) {
        RetryConfig config = RetryConfig.custom()
            .maxAttempts(5)
            .waitDuration(Duration.ofMillis(500))
            .intervalFunction(intervalFunctionWithJitter())
            .retryOnException(e -> e instanceof HttpServerErrorException)
            .build();

        return retryRegistry.retry("jitterRetry", config);
    }

    private IntervalFunction intervalFunctionWithJitter() {
        return attempt -> {
            long baseDelay = 500 * (long) Math.pow(2, attempt - 1);
            double jitter = ThreadLocalRandom.current().nextDouble(0.8, 1.2);
            return (long) (baseDelay * jitter);
        };
    }
}
```

### Retry with Result Predicate

```java
@Service
public class OrderPollingService {

    private static final int MAX_POLL_ATTEMPTS = 10;
    private static final long POLL_INTERVAL_MS = 2000;

    @Retry(name = "orderPolling",
           waitDuration = "2s",
           maxAttempts = 10,
           retryOnResult = @RetryOnResult(predicate = OrderPollingPredicate.class))
    public OrderStatusResponse getOrderStatus(String orderId) {
        return restTemplate.getForObject(
            "/orders/{id}/status", OrderStatusResponse.class, orderId);
    }
}

@Component
public class OrderPollingPredicate implements Predicate<OrderStatusResponse> {

    @Override
    public boolean test(OrderStatusResponse response) {
        // Retry if order is still processing
        return "PROCESSING".equals(response.getStatus())
            || "PENDING".equals(response.getStatus());
    }
}
```

### Fallback with Cached Data

```java
@Service
public class CachedFallbackService {

    private final CacheManager cacheManager;
    private final CircuitBreaker circuitBreaker;

    @CircuitBreaker(name = "productService", fallbackMethod = "getFromCache")
    public Product getProduct(String sku) {
        return webClient.get()
            .uri("/products/{sku}", sku)
            .retrieve()
            .bodyToMono(Product.class)
            .doOnSuccess(product -> cacheProduct(product))
            .block(Duration.ofSeconds(5));
    }

    public Product getFromCache(String sku, Exception ex) {
        log.warn("Fallback to cache for product: {}", sku);
        Cache cache = cacheManager.getCache("products");
        Cache.ValueWrapper wrapper = cache.get(sku);
        if (wrapper != null) {
            Product cached = (Product) wrapper.get();
            if (cached != null) {
                log.info("Returning cached product: {} (cached at {})",
                    sku, cached.getLastUpdated());
                return Product.builder()
                    .sku(sku)
                    .name(cached.getName())
                    .price(cached.getPrice())
                    .cached(true)
                    .build();
            }
        }
        throw new ServiceUnavailableException("Product service unavailable");
    }

    private void cacheProduct(Product product) {
        Cache cache = cacheManager.getCache("products");
        cache.put(product.getSku(), product);
    }
}
```

---

## Common Mistakes

### Mistake 1: Wrong Retry for Non-Idempotent Operations

```java
// WRONG: Auto-retry on all exceptions
@Retry(name = "paymentService")
public PaymentResponse chargeCustomer(PaymentRequest request) {
    return paymentClient.charge(request);  // Retry = double charge!
}

// CORRECT: Don't retry for non-idempotent side effects
@Service
public class PaymentService {

    @Retry(name = "paymentService",
           retryOnResult = @RetryOnResult(predicate = RetryableResponsePredicate.class))
    public PaymentResponse chargeCustomer(PaymentRequest request) {
        // Only retry if we get a transient error, not a successful charge
        return paymentClient.charge(request);
    }

    // Better: use idempotency key
    @Retry(name = "paymentService")
    public PaymentResponse chargeWithIdempotency(PaymentRequest request, String idempotencyKey) {
        return paymentClient.charge(request, idempotencyKey);
    }
}
```

### Mistake 2: Circuit Breaker Timeout Shorter Than Retry

```java
// WRONG: Circuit breaker opens before retries are exhausted
circuitBreaker:
  instances:
    userService:
      waitDurationInOpenState: 10s  // Opens after 50% failure rate

retry:
  instances:
    userService:
      maxAttempts: 5
      waitDuration: 2s  // Total retry time: 2+4+8+16=30s
// But circuit breaker opens in <5 calls!

// CORRECT: Align timeouts
retry:
  instances:
    userService:
      maxAttempts: 3
      waitDuration: 500ms  # Total: 0.5+1+2=3.5s

circuitBreaker:
  instances:
    userService:
      slidingWindowSize: 10
      failureRateThreshold: 50
      waitDurationInOpenState: 30s
```

### Mistake 3: Not Handling CallNotPermittedException

```java
// WRONG: No circuit breaker exception handling
@CircuitBreaker(name = "productService")
public Product getProduct(String sku) {
    return productClient.getProduct(sku);
}

// CORRECT: Handle circuit breaker open state
@CircuitBreaker(name = "productService", fallbackMethod = "getProductFallback")
public Product getProduct(String sku) {
    return productClient.getProduct(sku);
}

public Product getProductFallback(String sku, CallNotPermittedException ex) {
    log.warn("Circuit breaker is OPEN for product service, returning cached");
    return getFromLocalCache(sku);
}

public Product getProductFallback(String sku, Exception ex) {
    log.error("Product service failed for sku: {}", sku, ex);
    return Product.builder().sku(sku).available(false).build();
}
```

### Mistake 4: Infinite Retry Loop

```java
// WRONG: No max attempts, infinite retries
@Retry(maxAttempts = Integer.MAX_VALUE)  // Never stops retrying!
public Data fetchData() { ... }

// CORRECT: Set reasonable max attempts
@Retry(name = "dataService", maxAttempts = 3)
public Data fetchData() { ... }
```

### Mistake 5: Ignoring Bulkhead Exhaustion

```java
// WRONG: No fallback for bulkhead rejection
@Bulkhead(name = "inventoryService", type = Bulkhead.Type.THREADPOOL)
public CompletableFuture<InventoryResponse> checkStock(String sku) {
    return CompletableFuture.supplyAsync(() -> inventoryClient.checkStock(sku));
}
// When bulkhead is full, callers get BulkheadFullException

// CORRECT: Provide fallback
@Bulkhead(name = "inventoryService",
          type = Bulkhead.Type.THREADPOOL,
          fallbackMethod = "stockFallback")
public CompletableFuture<InventoryResponse> checkStock(String sku) {
    return CompletableFuture.supplyAsync(() -> inventoryClient.checkStock(sku));
}

public CompletableFuture<InventoryResponse> stockFallback(String sku, BulkheadFullException ex) {
    log.warn("Bulkhead full for inventory, returning default: {}", sku);
    return CompletableFuture.completedFuture(
        InventoryResponse.builder().sku(sku).available(false).build());
}
```

---

## Summary

Resilience patterns are essential for production HTTP clients:

1. **Retry**: Handle transient failures with exponential backoff and jitter
2. **Circuit Breaker**: Prevent cascading failures by failing fast when services are down
3. **Rate Limiter**: Control outbound request rate to avoid overwhelming downstream services
4. **Bulkhead**: Isolate failure domains so one service's failure doesn't affect others

Configure these patterns based on actual service behavior, monitor metrics closely, and always provide meaningful fallbacks for degraded scenarios.

---

## References

- [Resilience4j Documentation](https://resilience4j.readme.io/docs/getting-started)
- [Spring Cloud Circuit Breaker](https://docs.spring.io/spring-cloud-circuitbreaker/docs/current/reference/html/)
- [Resilience4j Spring Boot 2 Documentation](https://resilience4j.readme.io/docs/spring-boot-2)
- [Martin Fowler's Circuit Breaker Article](https://martinfowler.com/bliki/CircuitBreaker.html)

---

Happy Coding 👨‍💻

Happy Coding