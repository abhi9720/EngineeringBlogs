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

Resilience4j's decorator chain applies patterns from outermost to innermost: Bulkhead first (limits concurrent calls), then RateLimiter (throttles request rate), then CircuitBreaker (checks if the service is healthy), and finally Retry (attempts recovery from transient failures). This ordering ensures that retries do not waste resources when the circuit is open or the bulkhead is full. The `Decorators.ofSupplier` fluent API makes the composition explicit and readable. In production, the ordering is critical: retrying a request that will be immediately blocked by the rate limiter or circuit breaker wastes time and resources.

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

The circuit breaker state machine is the core of the pattern. In CLOSED state, requests flow normally while failures are counted. When the failure threshold is reached, the state transitions to OPEN and all requests are immediately rejected with `CallNotPermittedException`. After a configurable `waitDurationInOpenState`, it transitions to HALF_OPEN, allowing a limited number of probe requests to test if the service has recovered. If the probe succeeds, the circuit resets to CLOSED; if it fails, the circuit reopens and the wait timer resets. This prevents cascading failures by failing fast when the downstream service is unhealthy, while automatically recovering when it becomes available again.

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

The YAML configuration defines a shared `default` config for each pattern and per-instance overrides. The retry configuration uses exponential backoff (500ms base, doubling each attempt) and specifies which exceptions are retryable (server errors, connection timeouts) and which should never be retried (bad request errors). The circuit breaker uses a sliding window of 10 calls with a 50% failure rate threshold, and also monitors slow calls — any call taking longer than 5 seconds counts toward the failure rate. The payment service gets stricter limits (50 requests per second, 10 concurrent calls) because payment processing is resource-intensive and must not overwhelm the provider.

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

The Java configuration approach provides more flexibility than YAML, particularly for `retryOnResult` — a predicate that checks the actual response value, not just the exception. In the example, it retries if an order is still PENDING, enabling polling-style retry for operations with asynchronous processing. The `ThreadPoolBulkheadConfig` creates an isolated thread pool for a specific service, preventing one service's thread exhaustion from affecting others. This is different from the simpler semaphore-based bulkhead (`BulkheadConfig`), which constrains concurrent calls but uses the caller's thread.

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

The annotated approach with Resilience4j's Spring Boot integration is the most concise way to add resilience. The `@CircuitBreaker`, `@Retry`, `@RateLimiter`, and `@Bulkhead` annotations wrap the method with the corresponding decorators. The fallback method `paymentFallback` receives the original parameters plus the exception, enabling context-aware fallback behavior — here, it returns a structured failure response with a meaningful error message, allowing the caller to handle the degraded state gracefully. The registries are injected to obtain named instances that match the `application.yml` configuration.

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

Feign integrates with Resilience4j through `FallbackFactory` and Spring Cloud Circuit Breaker. The `InventoryFallbackFactory` creates a proxy that handles failures per-method: read operations (`checkStock`, `bulkCheckStock`) return sensible defaults (unavailable inventory), while write operations (`reserveStock`) propagate the exception because silent failure on writes is dangerous. The `@CircuitBreaker` annotation on the Feign interface integrates with Spring Cloud Circuit Breaker, enabling the circuit breaker to open when the Feign client experiences failures and use the fallback factory until recovery.

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

RestTemplate integrates with Resilience4j programmatically since it lacks Feign's built-in annotation support. The `Decorators.ofSupplier` fluent API applies multiple patterns in the specified order, while the manual approach with `Retry.decorateSupplier` and `CircuitBreaker.decorateSupplier` shows the underlying functional composition. The manual approach gives finer control over exception handling at each layer. Both approaches wrap the RestTemplate call in a `Supplier` functional interface — this is the key pattern for adding resilience to imperative code.

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

Event monitoring is essential for understanding circuit breaker behavior in production. The listener tracks four key events: successes and errors for rate calculation, state transitions for failure detection, and call rejections for impact assessment. The metrics (`counter`, `gauge`) are emitted to the Micrometer `MeterRegistry`, which can be configured to export to Prometheus, Datadog, or any other monitoring system. The INFO-level log for state transitions is critical for dashboards and alerting — a circuit breaker opening should trigger immediate investigation of the downstream service.

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

A custom health indicator exposes circuit breaker states through Spring Boot Actuator's `/actuator/health` endpoint. When any circuit breaker is OPEN, the overall health status is DOWN, enabling load balancers and orchestration tools to route traffic away from the degraded instance. The detailed metrics in the response body — failure rate, slow call rate, buffered/failed/rejected calls — provide deep visibility into each service's health. This is particularly valuable in Kubernetes environments where readiness probes can use this endpoint to prevent routing traffic to unhealthy pods.

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

Retry metrics reveal how often transient failures occur and how many retry attempts they consume. A high retry success rate indicates that the downstream service has transient issues that are successfully mitigated. A high retry error rate (where all retries are exhausted) indicates a persistent problem that should trigger an alert. Tracking the number of attempts per retry helps tune the `maxAttempts` configuration — if most retries succeed on the second attempt, the current configuration is appropriate; if retries frequently exhaust all attempts, increase the max or investigate the root cause.

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

Exponential backoff with jitter prevents the thundering herd problem where all retrying clients hit the server simultaneously. The base delay doubles with each attempt (500ms, 1000ms, 2000ms, 4000ms, 8000ms), and the jitter randomly varies each delay by ±20%. This spread ensures that retries from different clients do not synchronize. Resilience4j's `IntervalFunction` provides built-in exponential random jitter via `IntervalFunction.ofExponentialRandomBackoff`, but the custom implementation above demonstrates the underlying math for fine-tuning in specific scenarios.

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

Result predicate retry extends the retry pattern beyond exceptions to cover successful responses that indicate incomplete processing. In this polling pattern, an HTTP 200 response with a PROCESSING status is treated as a transient condition that should be retried. The predicate returns `true` to trigger another attempt, `false` to accept the result. This is particularly useful for asynchronous operations where the initial call succeeds but the final result is not yet available — replacing manual polling loops with declarative retry configuration.

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

Fallback with cached data provides graceful degradation by serving stale-but-functional data when the downstream service is unavailable. The primary method uses `doOnSuccess` to update the cache whenever a successful response arrives, ensuring the cache stays reasonably fresh. The fallback method reads from the cache and marks the response as `cached(true)` so callers know the data may be stale. If the cache misses, the fallback throws an exception — honest failure is better than silently serving no data. This pattern is ideal for read-heavy services where slightly stale data is acceptable (product catalogs, user profiles) but not for transactional operations (payments, inventory reservations).

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

Automatic retry of non-idempotent operations can cause catastrophic side effects — charging a customer twice, creating duplicate orders, or transferring funds multiple times. The safer approach uses an idempotency key that the downstream service recognizes: if it receives the same key twice, it returns the original result rather than performing the operation again. Alternatively, use result-predicate retry that only triggers for transient conditions rather than on any exception. Never blindly retry POST, PUT, or PATCH operations without idempotency guarantees.

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

Circuit breaker and retry operate at different levels, and their configurations must be aligned. If retry takes 30 seconds total (2+4+8+16 seconds with 5 attempts and 2x multiplier) but the circuit breaker opens after 5 failures, the retry never completes before the circuit opens. The fix is to either reduce retry total duration below the circuit breaker's window, or increase the circuit breaker's window and threshold to accommodate the retry pattern. A good rule of thumb: retry should exhaust within the circuit breaker's sliding window.

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

When the circuit breaker is OPEN, every call throws `CallNotPermittedException`. Without a fallback method, this exception propagates to the caller, which likely has no mechanism to handle it gracefully. The fix provides two fallback methods — one specifically for `CallNotPermittedException` (circuit open, return cached data) and a generic one for other exceptions (actual failures, return unavailable). Method overloading on the exception parameter type allows different recovery strategies for different failure modes.

### Mistake 4: Infinite Retry Loop

```java
// WRONG: No max attempts, infinite retries
@Retry(maxAttempts = Integer.MAX_VALUE)  // Never stops retrying!
public Data fetchData() { ... }

// CORRECT: Set reasonable max attempts
@Retry(name = "dataService", maxAttempts = 3)
public Data fetchData() { ... }
```

Infinite retries are a dangerous anti-pattern that can cause resource exhaustion, amplification of load on the downstream service, and delayed failure detection. The retrying thread remains blocked, accumulated requests pile up, and the downstream service becomes even more overloaded. Always set a reasonable `maxAttempts` bound based on the total acceptable delay: with 500ms base wait, 2x multiplier, and 3 attempts, the total retry time is 500+1000+2000=3500ms max — a reasonable duration before failing.

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

When a bulkhead is full (max concurrent calls reached), new requests are immediately rejected with `BulkheadFullException`. Without a fallback, this exception propagates to the caller. The `ThreadPoolBulkhead` variant is particularly insidious because the exception is wrapped in a `CompletableFuture` — the caller might not notice it until they call `.get()` on the future. Always provide a fallback that returns a sensible default (unavailable, false, empty list) so callers can continue operating in degraded mode.

---

## Summary

Resilience patterns are essential for production HTTP clients:

1. **Retry**: Handle transient failures with exponential backoff and jitter. Use result-predicate retry for polling patterns and always include idempotency keys for mutating operations. Configure max attempts to bound total delay within your latency SLO.
2. **Circuit Breaker**: Prevent cascading failures by failing fast when services are degraded. Monitor state transitions via events and expose health indicators for orchestration tools. Align circuit breaker window size with retry configuration.
3. **Rate Limiter**: Control outbound request rate to avoid overwhelming downstream services. Set limits based on the provider's rate limits and your expected concurrency. Use timeout to handle queuing gracefully rather than blocking indefinitely.
4. **Bulkhead**: Isolate failure domains using semaphore (same-thread) or thread-pool (dedicated threads) isolation. Thread-pool bulkheads prevent one service's thread exhaustion from affecting others but add context-switching overhead.

Configure these patterns based on actual service behavior by starting with conservative values, monitoring metrics closely, and tuning iteratively. Always provide meaningful fallbacks that return degraded-but-functional responses rather than propagating errors or returning null. Instrument every resilience event with metrics and logs to enable proactive detection of downstream service degradation.

---

## References

- [Resilience4j Documentation](https://resilience4j.readme.io/docs/getting-started)
- [Spring Cloud Circuit Breaker](https://docs.spring.io/spring-cloud-circuitbreaker/docs/current/reference/html/)
- [Resilience4j Spring Boot 2 Documentation](https://resilience4j.readme.io/docs/spring-boot-2)
- [Martin Fowler's Circuit Breaker Article](https://martinfowler.com/bliki/CircuitBreaker.html)

---

Happy Coding
