---
title: Retry and Timeout Patterns
description: >-
  Implement retry and timeout patterns in microservices: exponential backoff,
  jitter, circuit breaker integration, Resilience4j retry, Spring Retry, and
  timeout configuration strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - retry
  - timeout
  - resilience4j
  - microservices
coverImage: /images/retry-and-timeout-patterns.png
draft: false
order: 30
---
## Overview

Retry and timeout patterns are fundamental for building resilient microservices. Timeouts prevent a service from waiting indefinitely, while retries handle transient failures. This article covers implementation strategies, exponential backoff, jitter, and combining retries with circuit breakers.

## Timeout Configuration

### Connection and Read Timeouts

Connection timeout governs how long to wait for the TCP handshake to complete. Read (socket) timeout governs how long to wait between data packets after the connection is established. Setting both prevents thread starvation — a misconfigured 60s default can exhaust the connection pool under load.

```java
@Configuration
public class TimeoutConfig {

    @Bean
    public RestTemplate restTemplate() {
        RequestConfig requestConfig = RequestConfig.custom()
            .setConnectionRequestTimeout(1000)
            .setConnectTimeout(2000)
            .setSocketTimeout(5000)
            .build();

        PoolingHttpClientConnectionManager connectionManager =
            new PoolingHttpClientConnectionManager();
        connectionManager.setMaxTotal(200);
        connectionManager.setDefaultMaxPerRoute(50);

        CloseableHttpClient httpClient = HttpClientBuilder.create()
            .setDefaultRequestConfig(requestConfig)
            .setConnectionManager(connectionManager)
            .disableAutomaticRetries()
            .build();

        HttpComponentsClientHttpRequestFactory factory =
            new HttpComponentsClientHttpRequestFactory(httpClient);

        return new RestTemplate(factory);
    }

    @Bean
    public WebClient webClient() {
        return WebClient.builder()
            .baseUrl("https://api.example.com")
            .clientConnector(new ReactorClientHttpConnector(
                HttpClient.create()
                    .responseTimeout(Duration.ofSeconds(5))
                    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 2000)
            ))
            .build();
    }
}
```

### Timeout with Resilience4j

Resilience4j's TimeLimiter wraps `CompletableFuture` with a timeout. The `cancelRunningFuture: true` flag ensures the underlying thread is interrupted when the timeout fires, releasing resources rather than letting the operation run to completion in vain.

```java
@Configuration
public class TimeLimiterConfig {

    @Bean
    public TimeLimiterRegistry timeLimiterRegistry() {
        return TimeLimiterRegistry.of(
            TimeLimiterConfig.custom()
                .timeoutDuration(Duration.ofSeconds(5))
                .cancelRunningFuture(true)
                .build()
        );
    }
}

@Service
public class TimeLimitedService {

    @TimeLimiter(name = "order-service", fallbackMethod = "timeoutFallback")
    public CompletableFuture<OrderResponse> getOrder(String orderId) {
        return CompletableFuture.supplyAsync(() ->
            orderClient.getOrder(orderId)
        );
    }

    private CompletableFuture<OrderResponse> timeoutFallback(
            String orderId, Throwable t) {
        log.warn("Timeout fetching order: {}", orderId, t);
        return CompletableFuture.completedFuture(
            OrderResponse.fallback("Service timed out")
        );
    }
}
```

## Retry with Exponential Backoff

### Spring Retry

Spring Retry's `@Retryable` annotation retries on specific exceptions with exponential backoff. The first retry waits 1s, the second 2s, and subsequent waits cap at 10s. The `@Recover` method is called when all attempts are exhausted — returning a fallback response rather than propagating the exception.

```java
@Service
public class RetryablePaymentService {

    @Retryable(
        retryFor = {TimeoutException.class, HttpClientErrorException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2, maxDelay = 10000)
    )
    public PaymentResponse processPayment(PaymentRequest request) {
        return paymentClient.processPayment(request);
    }

    @Recover
    public PaymentResponse recover(PaymentException e, PaymentRequest request) {
        log.error("Payment failed after retries: {}", request.getOrderId(), e);
        return PaymentResponse.failed("Payment processing unavailable");
    }
}
```

### Resilience4j Retry

Resilience4j offers more flexible retry configuration than Spring Retry — `IntervalFunction.ofExponentialRandomBackoff` adds jitter to the exponential backoff, preventing the thundering herd problem where all retrying clients hit the recovering service simultaneously.

```java
@Configuration
public class RetryConfig {

    @Bean
    public RetryRegistry retryRegistry() {
        RetryConfig config = RetryConfig.custom()
            .maxAttempts(3)
            .waitDuration(Duration.ofMillis(500))
            .intervalFunction(IntervalFunction.ofExponentialBackoff(
                Duration.ofMillis(100), 2, Duration.ofMillis(10000)))
            .retryExceptions(TimeoutException.class, IOException.class)
            .ignoreExceptions(IllegalArgumentException.class)
            .failAfterMaxAttempts(true)
            .build();

        return RetryRegistry.of(config);
    }

    @Bean
    public Retry paymentServiceRetry() {
        return retryRegistry().retry("payment-service",
            RetryConfig.custom()
                .maxAttempts(5)
                .waitDuration(Duration.ofMillis(200))
                .intervalFunction(IntervalFunction.ofExponentialRandomBackoff(
                    Duration.ofMillis(100), 2, Duration.ofSeconds(30)))
                .retryExceptions(TimeoutException.class, HttpServerErrorException.class)
                .build()
        );
    }
}
```

## Retry with Jitter

Jitter randomizes the retry interval by adding a random offset — a retry that would wait ~1000ms might wait anywhere from 1000ms to 1500ms. This prevents all retrying clients from hitting the recovering service at the same instant, spreading the recovery load over time.

```java
@Service
public class JitterRetryService {

    private final Random random = new Random();

    @Retryable(
        backoff = @Backoff(
            delay = 1000,
            multiplier = 2,
            maxDelay = 30000,
            random = true
        )
    )
    public void callWithJitter() {
        externalApi.call();
    }

    // Manual jitter implementation
    public <T> T callWithJitter(Supplier<T> supplier, int maxRetries) {
        int baseDelay = 100;
        int maxDelay = 30000;

        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return supplier.get();
            } catch (Exception e) {
                if (attempt == maxRetries) throw e;

                int exponentialDelay = baseDelay * (int) Math.pow(2, attempt - 1);
                int jitter = random.nextInt(exponentialDelay / 2);
                int delay = Math.min(exponentialDelay + jitter, maxDelay);

                log.warn("Attempt {} failed, retrying in {}ms", attempt, delay);
                Thread.sleep(delay);
            }
        }
        throw new RuntimeException("Should not reach here");
    }
}
```

## Combining Retry, Timeout, and Circuit Breaker

The three patterns compose in a specific order: circuit breaker wraps the outer call (fail fast if open), retry handles transient failures within the circuit's closed state, and TimeLimiter ensures the entire operation doesn't exceed a maximum duration. The `Decorators` API composes them cleanly into a single decorated supplier.

```java
@Service
public class ResilientOrderProcessor {

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private RetryRegistry retryRegistry;

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    @Autowired
    private TimeLimiterRegistry timeLimiterRegistry;

    public OrderResponse processOrder(String orderId) {
        Retry retry = retryRegistry.retry("order-processor");
        CircuitBreaker circuitBreaker = circuitBreakerRegistry
            .circuitBreaker("order-processor");
        TimeLimiter timeLimiter = timeLimiterRegistry
            .timeLimiter("order-processor");

        Supplier<OrderResponse> supplier = () -> restTemplate
            .getForObject("/orders/{id}", OrderResponse.class, orderId);

        Supplier<CompletionStage<OrderResponse>> decorated = Decorators
            .ofSupplier(supplier)
            .withCircuitBreaker(circuitBreaker)
            .withRetry(retry)
            .withTimeLimiter(timeLimiter, CompletableFuture::supplyAsync)
            .decorate();

        try {
            return decorated.get().toCompletableFuture().get();
        } catch (Exception e) {
            return OrderResponse.fallback("Order processing unavailable");
        }
    }
}
```

## Configuration with YAML

```yaml
resilience4j:
  retry:
    configs:
      default:
        max-attempts: 3
        wait-duration: 500
        retry-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
        ignore-exceptions:
          - com.example.InvalidRequestException
    instances:
      order-service:
        base-config: default
        max-attempts: 5
        wait-duration: 1000
        exponential-backoff-multiplier: 2
        enable-exponential-backoff: true
      payment-service:
        base-config: default
        max-attempts: 3
  timelimiter:
    configs:
      default:
        timeout-duration: 5s
        cancel-running-future: true
    instances:
      order-service:
        timeout-duration: 10s
      payment-service:
        timeout-duration: 3s
```

## Best Practices

- Always set timeouts for network calls to prevent thread starvation.
- Use exponential backoff with jitter to avoid thundering herd.
- Combine retries with circuit breakers to prevent cascading failures.
- Set a maximum retry count to bound retry duration.
- Use different timeout values for different types of operations.
- Monitor retry rates and timeout frequency to identify systemic issues.

## Common Mistakes

### Mistake: Infinite retries without backoff

```java
// Wrong - immediate retries without delay
Thread.sleep(0);
// This will flood the downstream service
```

```java
// Correct - exponential backoff with jitter
int delay = Math.min(100 * (int) Math.pow(2, attempt), 10000);
delay += random.nextInt(delay / 2);
Thread.sleep(delay);
```

### Mistake: Retrying non-idempotent operations

```java
// Wrong - retrying a non-idempotent payment
@Retryable
public PaymentResponse chargePayment(String orderId, BigDecimal amount) {
    return paymentClient.charge(orderId, amount);
    // Retry could charge twice!
}
```

```java
// Correct - use idempotency key
@Retryable
public PaymentResponse chargePayment(String orderId, BigDecimal amount,
                                       String idempotencyKey) {
    return paymentClient.charge(orderId, amount, idempotencyKey);
}
```

## Summary

Timeouts prevent resource exhaustion while retries handle transient failures. Use exponential backoff with jitter to avoid the thundering herd problem. Always combine retries with circuit breakers and implement idempotent operations for safe retry behavior.

## References

- [Resilience4j Retry Documentation](https://resilience4j.readme.io/docs/retry)
- [AWS - Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Google - Timeouts and Retries](https://cloud.google.com/apis/design/errors#timeouts_and_retries)

Happy Coding
