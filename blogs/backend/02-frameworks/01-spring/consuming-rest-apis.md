---
title: Consuming REST APIs in Spring Boot
description: >-
  Master RestTemplate, WebClient, and Feign for consuming REST APIs in Spring
  Boot applications with production patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - rest-api
  - webclient
  - feign
  - resttemplate
coverImage: /images/consuming-rest-apis.png
draft: false
order: 20
---
# Consuming REST APIs in Spring Boot: A Comprehensive Guide

## Overview

Consuming external REST APIs is a fundamental requirement for backend applications. Spring Boot offers three primary approaches: RestTemplate (blocking, traditional), WebClient (reactive, non-blocking), and Feign (declarative, HTTP interface). Each has distinct characteristics that make it suitable for different scenarios.

This guide covers all three approaches with production-ready patterns for error handling, retries, logging, and performance optimization.

---

## RestTemplate: The Traditional Approach

### Configuration and Setup

RestTemplate is the classic Spring HTTP client built on top of the Servlet API. While it is in maintenance mode, it remains widely used in existing projects.

```java
@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder) {
        return builder
            .setConnectTimeout(Duration.ofSeconds(5))
            .setReadTimeout(Duration.ofSeconds(10))
            .requestFactory(() -> new HttpComponentsClientHttpRequestFactory(
                HttpClientBuilder.create()
                    .setMaxConnTotal(100)
                    .setMaxConnPerRoute(20)
                    .setConnectionTimeToLive(30, TimeUnit.SECONDS)
                    .evictExpiredConnections()
                    .evictIdleConnections(5, TimeUnit.SECONDS)
                    .build()
            ))
            .build();
    }

    @Bean
    public RestTemplateBuilder restTemplateBuilder() {
        return new RestTemplateBuilder()
            .defaultHeader("User-Agent", "MyApp/1.0")
            .defaultHeader("Accept", "application/json");
    }
}
```

Connection pooling is critical for production RestTemplate usage. Without it, each request opens a new TCP connection, incurring the overhead of handshakes and TLS negotiation. `setMaxConnTotal(100)` and `setMaxConnPerRoute(20)` prevent resource exhaustion under load, while `setConnectionTimeToLive` ensures connections are recycled periodically to avoid server-side socket timeouts. Evicting idle connections every 5 seconds prevents stale sockets from accumulating — a common source of sporadic `SocketException` failures in long-running applications. Tune pool sizes based on your expected concurrency: too few connections cause queuing, too many waste heap memory.

### Making Requests

```java
@Service
public class PaymentGatewayService {

    private final RestTemplate restTemplate;
    private final String baseUrl = "https://api.payment-gateway.com/v1";

    public PaymentGatewayService(RestTemplateBuilder builder) {
        this.restTemplate = builder
            .rootUri(baseUrl)
            .basicAuthentication("api-key", "secret-key")
            .build();
    }

    public PaymentResponse createPayment(PaymentRequest request) {
        return restTemplate.postForEntity(
            "/payments",
            request,
            PaymentResponse.class
        ).getBody();
    }

    public PaymentResponse getPayment(String paymentId) {
        return restTemplate.getForObject(
            "/payments/{id}",
            PaymentResponse.class,
            paymentId
        );
    }

    public void cancelPayment(String paymentId) {
        restTemplate.delete("/payments/{id}", paymentId);
    }

    public PaymentResponse updatePayment(String paymentId, PaymentUpdateRequest request) {
        HttpEntity<PaymentUpdateRequest> entity = new HttpEntity<>(request);
        ResponseEntity<PaymentResponse> response = restTemplate.exchange(
            "/payments/{id}",
            HttpMethod.PUT,
            entity,
            PaymentResponse.class,
            paymentId
        );
        return response.getBody();
    }
}
```

The service above demonstrates the four main HTTP verbs via RestTemplate. `postForEntity` returns the full `ResponseEntity` including headers and status code — use this when you need access to response headers such as rate-limit counters or ETags. `getForObject` deserializes the response body directly but discards metadata, making it useful for simple lookups where only the payload matters. The `exchange` method provides the most control, accepting an `HttpEntity` for custom request headers and an `HttpMethod` parameter. In production, prefer `exchange` or `postForEntity` when response metadata is needed for observability or retry decisions based on rate-limit headers.

### Error Handling with ResponseErrorHandler

```java
@Component
public class RestTemplateErrorHandler implements ResponseErrorHandler {

    private static final Logger log = LoggerFactory.getLogger(RestTemplateErrorHandler.class);

    @Override
    public boolean hasError(ClientHttpResponse response) throws IOException {
        return response.getStatusCode().is4xxClientError()
            || response.getStatusCode().is5xxServerError();
    }

    @Override
    public void handleError(ClientHttpResponse response) throws IOException {
        String body = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
        HttpStatus statusCode = (HttpStatus) response.getStatusCode();

        log.error("API call failed with status {}: {}", statusCode, body);

        switch (statusCode) {
            case BAD_REQUEST:
                throw new BadRequestException(body);
            case NOT_FOUND:
                throw new ResourceNotFoundException(body);
            case TOO_MANY_REQUESTS:
                throw new RateLimitException(body);
            case INTERNAL_SERVER_ERROR:
                throw new ExternalServiceException("Payment gateway unavailable");
            default:
                throw new ExternalServiceException(
                    "Unexpected error: " + statusCode.getReasonPhrase()
                );
        }
    }
}

@Configuration
public class RestTemplateWithErrorConfig {

    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder,
                                      RestTemplateErrorHandler errorHandler) {
        return builder
            .errorHandler(errorHandler)
            .setConnectTimeout(Duration.ofSeconds(5))
            .setReadTimeout(Duration.ofSeconds(10))
            .build();
    }
}
```

The `ResponseErrorHandler` centralizes HTTP error handling into a single component, keeping service classes clean. The implementation reads the response body for diagnostic details before mapping HTTP status codes to domain-specific exceptions. Note the distinction: 4xx errors indicate client-side issues and are typically non-retryable, while 5xx errors suggest server-side problems that may resolve with retry. Always log the response body at error level — it contains details invaluable during incident response. The switch expression makes it easy to extend handling as new integration points are added.

### Interceptors for Logging and Auditing

```java
@Component
public class LoggingInterceptor implements ClientHttpRequestInterceptor {

    private static final Logger log = LoggerFactory.getLogger(LoggingInterceptor.class);

    @Override
    public ClientHttpResponse intercept(
            HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
            throws IOException {

        String requestId = UUID.randomUUID().toString();

        log.info("Request [{}] {} {} - Body: {}",
            requestId, request.getMethod(), request.getURI(),
            truncateBody(new String(body, StandardCharsets.UTF_8)));

        long start = System.currentTimeMillis();

        ClientHttpResponse response = execution.execute(request, body);

        long duration = System.currentTimeMillis() - start;

        log.info("Response [{}] {} - Duration: {}ms",
            requestId, response.getStatusCode(), duration);

        return response;
    }

    private String truncateBody(String body) {
        return body.length() > 1000 ? body.substring(0, 1000) + "..." : body;
    }
}

@Configuration
public class InterceptorConfig {

    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder,
                                      LoggingInterceptor loggingInterceptor,
                                      RestTemplateErrorHandler errorHandler) {
        return builder
            .interceptors(loggingInterceptor)
            .errorHandler(errorHandler)
            .setConnectTimeout(Duration.ofSeconds(5))
            .setReadTimeout(Duration.ofSeconds(10))
            .build();
    }
}
```

`ClientHttpRequestInterceptor` instances form a chain around every RestTemplate execution, making them ideal for cross-cutting concerns. The logging interceptor generates a unique request ID per call for traceability, truncates request bodies to prevent log flooding, and records response duration. This pattern is essential for debugging integration issues in production — the combination of request ID, method, URI, status, and duration gives a complete picture of each external call. For security, ensure sensitive data like passwords and tokens are never logged, extending the truncation logic to redact known patterns.

---

## WebClient: The Reactive Approach

### Configuration

WebClient is the modern, reactive HTTP client from Spring WebFlux. It supports both synchronous and asynchronous calls.

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient webClient(WebClient.Builder builder) {
        return builder
            .baseUrl("https://api.example.com")
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader("User-Agent", "MyApp/1.0")
            .codecs(config -> config
                .defaultCodecs()
                .maxInMemorySize(16 * 1024 * 1024))
            .build();
    }

    @Bean
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(
                HttpClient.create()
                    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                    .responseTimeout(Duration.ofSeconds(10))
                    .doOnConnected(conn -> conn
                        .addHandlerLast(new ReadTimeoutHandler(10))
                        .addHandlerLast(new WriteTimeoutHandler(5)))
                    .connectionProvider(ConnectionProvider.builder("custom")
                        .maxConnections(100)
                        .maxIdleTime(Duration.ofSeconds(30))
                        .maxLifeTime(Duration.ofMinutes(5))
                        .pendingAcquireTimeout(Duration.ofSeconds(10))
                        .evictInBackground(Duration.ofSeconds(30))
                        .build())
            ));
    }
}
```

WebClient configuration operates at the Reactor Netty level rather than the Servlet API. The `ConnectionProvider` replaces Apache HttpClient's pooling with Reactor's non-blocking connection pool, supporting max connections, idle timeouts, and background eviction — all essential for reactive performance. The `maxInMemorySize(16 * 1024 * 1024)` codec setting caps the response buffer to prevent OOM errors when consuming large payloads; without it, a misconfigured server sending multi-gigabyte responses could exhaust application memory. The `doOnConnected` handlers add read and write timeouts at the Netty channel level for fine-grained I/O control beyond simple connect/read timeouts.

### Synchronous Usage

```java
@Service
public class UserServiceClient {

    private final WebClient webClient;

    public UserServiceClient(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("https://jsonplaceholder.typicode.com").build();
    }

    public User getUserById(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .block(Duration.ofSeconds(10));
    }

    public List<User> getAllUsers() {
        return webClient.get()
            .uri("/users")
            .retrieve()
            .bodyToFlux(User.class)
            .collectList()
            .block(Duration.ofSeconds(15));
    }

    public User createUser(User user) {
        return webClient.post()
            .uri("/users")
            .bodyValue(user)
            .retrieve()
            .bodyToMono(User.class)
            .block(Duration.ofSeconds(10));
    }
}
```

Using `.block()` makes WebClient behave synchronously, which is acceptable in traditional Servlet containers where each request has a dedicated thread. However, `.block()` in a reactive pipeline defeats WebClient's primary scalability advantage. Use synchronous blocking sparingly — typically at the boundary between reactive and imperative code, such as in `@Service` methods called by non-reactive controllers or scheduled tasks. Always provide an explicit timeout argument to `.block()` — omitting it risks indefinite thread starvation if the downstream server hangs.

### Reactive (Non-Blocking) Usage

```java
@Service
public class ReactiveUserService {

    private final WebClient webClient;

    public ReactiveUserService(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("https://jsonplaceholder.typicode.com").build();
    }

    public Mono<User> getUserById(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .timeout(Duration.ofSeconds(5))
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                .filter(throwable -> throwable instanceof TimeoutException));
    }

    public Flux<User> getAllUsers() {
        return webClient.get()
            .uri("/users")
            .retrieve()
            .bodyToFlux(User.class)
            .timeout(Duration.ofSeconds(10));
    }

    public Mono<User> createUser(User user) {
        return webClient.post()
            .uri("/users")
            .bodyValue(user)
            .retrieve()
            .bodyToMono(User.class)
            .onErrorResume(WebClientResponseException.class, ex -> {
                log.error("Failed to create user: {}", ex.getResponseBodyAsString());
                return Mono.empty();
            });
    }

    public Mono<ApiResponse<List<User>>> getUsersWithPagination(int page, int size) {
        return webClient.get()
            .uri(uriBuilder -> uriBuilder
                .path("/users")
                .queryParam("page", page)
                .queryParam("size", size)
                .build())
            .retrieve()
            .toEntityList(User.class)
            .map(response -> {
                List<String> totalPages = response.getHeaders().get("X-Total-Pages");
                return ApiResponse.<List<User>>builder()
                    .data(response.getBody())
                    .totalPages(totalPages != null ? Integer.parseInt(totalPages.get(0)) : 0)
                    .build();
            });
    }
}
```

In the reactive pattern, methods return `Mono<T>` (single item) or `Flux<T>` (streamed items) without blocking any thread. This allows a small number of event-loop threads to handle thousands of concurrent connections while waiting for I/O. The `.timeout()` operator ensures the pipeline fails fast if the downstream service degrades. `.retryWhen()` with exponential backoff handles transient network failures without overwhelming the server. `onErrorResume` provides a fallback path — returning `Mono.empty()` or a default value rather than propagating the error. The pagination example demonstrates how to extract response headers reactively using `toEntityList()`, preserving access to metadata like total page counts.

### Error Handling with ExchangeFilterFunction

```java
@Component
public class WebClientErrorFilter implements ExchangeFilterFunction {

    private static final Logger log = LoggerFactory.getLogger(WebClientErrorFilter.class);

    @Override
    public Mono<ClientResponse> filter(ClientRequest request, ExchangeFunction next) {
        return next.exchange(request)
            .flatMap(response -> {
                if (response.statusCode().isError()) {
                    return response.bodyToMono(String.class)
                        .flatMap(body -> handleErrorResponse(response, body))
                        .thenReturn(response);
                }
                return Mono.just(response);
            })
            .onErrorResume(IOException.class, ex ->
                Mono.error(new ExternalServiceException("Network error", ex)));
    }

    private Mono<Void> handleErrorResponse(ClientResponse response, String body) {
        HttpStatus status = (HttpStatus) response.statusCode();

        log.error("API error {}: {}", status, body);

        switch (status) {
            case BAD_REQUEST:
                return Mono.error(new BadRequestException(body));
            case NOT_FOUND:
                return Mono.error(new ResourceNotFoundException(body));
            case TOO_MANY_REQUESTS:
                return Mono.error(new RateLimitException(body));
            case INTERNAL_SERVER_ERROR:
                return Mono.error(new ExternalServiceException("Service unavailable"));
            default:
                return Mono.error(new ExternalServiceException(
                    "Unexpected error: " + status));
        }
    }
}

@Configuration
public class WebClientFilterConfig {

    @Bean
    public WebClient webClient(WebClientErrorFilter errorFilter,
                                LoggingExchangeFilter loggingFilter) {
        return WebClient.builder()
            .baseUrl("https://api.example.com")
            .filter(loggingFilter)
            .filter(errorFilter)
            .build();
    }
}

@Component
public class LoggingExchangeFilter implements ExchangeFilterFunction {

    private static final Logger log = LoggerFactory.getLogger(LoggingExchangeFilter.class);

    @Override
    public Mono<ClientResponse> filter(ClientRequest request, ExchangeFunction next) {
        String requestId = UUID.randomUUID().toString();

        log.info("Request [{}] {} {}",
            requestId, request.method(), request.url());

        long start = System.currentTimeMillis();

        return next.exchange(request)
            .doOnNext(response -> {
                long duration = System.currentTimeMillis() - start;
                log.info("Response [{}] {} - Duration: {}ms",
                    requestId, response.statusCode(), duration);
            });
    }
}
```

`ExchangeFilterFunction` is WebClient's equivalent of RestTemplate's `ClientHttpRequestInterceptor`, but reactive. Filters are applied in order — the logging filter captures the outgoing request first, then the error filter transforms error responses into typed exceptions. Unlike RestTemplate's `ResponseErrorHandler`, WebClient filters can inspect and modify the request before it's sent, not just the response. The logging filter uses `doOnNext` as a side-effect operator to measure response duration without altering the response stream. This pattern composes naturally with other reactive operators like `retryWhen` and `timeout`, forming a complete resilience layer.

---

## Feign Client: The Declarative Approach

### Configuration

Feign provides a declarative HTTP client interface where you define annotations on an interface and Feign generates the implementation at runtime.

```java
@Configuration
public class FeignConfig {

    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.FULL;
    }

    @Bean
    public Request.Options requestOptions() {
        return new Request.Options(
            5000, TimeUnit.MILLISECONDS,  // connect timeout
            10000, TimeUnit.MILLISECONDS  // read timeout
        );
    }

    @Bean
    public Retryer feignRetryer() {
        return new Retryer.Default(
            100,      // period
            1000,     // max period
            3         // max attempts
        );
    }
}
```

Feign separates HTTP client configuration from the service interface definition. `Logger.Level.FULL` logs request headers, body, and metadata — useful during development but potentially verbose in production (consider `BASIC` or `HEADERS` for production deployments). `Request.Options` sets per-client connect and read timeouts, which should be tuned per downstream service based on its typical latency. `Retryer.Default` provides simple linear backoff with configurable initial period, max period, and max attempts — sufficient for lightweight retry needs, though more sophisticated strategies belong in Resilience4j.

### Declaring Feign Clients

```java
@FeignClient(
    name = "payment-service",
    url = "${payment.service.url}",
    configuration = FeignConfig.class,
    fallback = PaymentServiceFallback.class
)
public interface PaymentServiceClient {

    @PostMapping("/v1/payments")
    PaymentResponse createPayment(@RequestBody PaymentRequest request);

    @GetMapping("/v1/payments/{paymentId}")
    PaymentResponse getPayment(@PathVariable("paymentId") String paymentId);

    @PutMapping("/v1/payments/{paymentId}")
    PaymentResponse updatePayment(
        @PathVariable("paymentId") String paymentId,
        @RequestBody PaymentUpdateRequest request);

    @DeleteMapping("/v1/payments/{paymentId}")
    void cancelPayment(@PathVariable("paymentId") String paymentId);

    @GetMapping("/v1/payments")
    List<PaymentResponse> searchPayments(
        @RequestParam("status") String status,
        @RequestParam("fromDate") String fromDate);
}

@Component
public class PaymentServiceFallback implements PaymentServiceClient {

    @Override
    public PaymentResponse createPayment(PaymentRequest request) {
        log.warn("Fallback: createPayment failed");
        return null;
    }

    @Override
    public PaymentResponse getPayment(String paymentId) {
        log.warn("Fallback: getPayment {} failed", paymentId);
        return null;
    }

    @Override
    public PaymentResponse updatePayment(String paymentId, PaymentUpdateRequest request) {
        log.warn("Fallback: updatePayment {} failed", paymentId);
        return null;
    }

    @Override
    public void cancelPayment(String paymentId) {
        log.warn("Fallback: cancelPayment {} failed", paymentId);
    }

    @Override
    public List<PaymentResponse> searchPayments(String status, String fromDate) {
        log.warn("Fallback: searchPayments failed");
        return List.of();
    }
}
```

The `@FeignClient` annotation marks a Java interface for Feign's JDK dynamic proxy generation. The `fallback` attribute provides a simple class that returns safe default values when the client fails. The fallback class must implement the same interface and be a Spring bean. Note that returning `null` from fallback methods requires null-safety at call sites — callers must handle null responses gracefully. For access to the triggering exception (e.g., to log the specific failure reason or return context-aware defaults), prefer `fallbackFactory` over plain `fallback`. The search endpoint demonstrates query parameter handling via `@RequestParam` — consider the number of parameters to determine whether a separate request object is more maintainable.

### Custom Error Decoder

```java
public class FeignErrorDecoder implements ErrorDecoder {

    private static final Logger log = LoggerFactory.getLogger(FeignErrorDecoder.class);

    @Override
    public Exception decode(String methodKey, Response response) {
        String body = null;
        try {
            if (response.body() != null) {
                body = Util.toString(response.body().asReader(StandardCharsets.UTF_8));
            }
        } catch (IOException e) {
            log.error("Failed to read response body", e);
        }

        log.error("Feign client error [{}] {}: {}",
            methodKey, response.status(), body);

        switch (response.status()) {
            case 400:
                return new BadRequestException(body);
            case 404:
                return new ResourceNotFoundException(body);
            case 429:
                return new RateLimitException(body);
            case 502:
            case 503:
                return new ServiceUnavailableException(body);
            default:
                return new ExternalServiceException(
                    "Unexpected error: " + response.status());
        }
    }
}

@Configuration
public class FeignErrorConfig {

    @Bean
    public ErrorDecoder errorDecoder() {
        return new FeignErrorDecoder();
    }
}
```

Feign's `ErrorDecoder` converts HTTP error responses into typed exceptions before response deserialization. Unlike RestTemplate's `ResponseErrorHandler`, the decoder receives the HTTP status code and raw response, making it the ideal place to parse error response bodies and map status codes to domain exceptions. The `methodKey` parameter identifies which Feign interface method triggered the error, useful for targeted alerting. The switch covers the most common HTTP error scenarios: 400 (bad request), 404 (not found), 429 (rate limited), 502 (bad gateway), and 503 (service unavailable). Never retry on 400 or 404 — these are client errors that will repeat. Always retry on 429 with backoff and on 503 when the service may have recovered.

### Feign Interceptors

```java
@Component
public class FeignRequestInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        template.header("Content-Type", "application/json");
        template.header("Accept", "application/json");
        template.header("X-Request-Id", UUID.randomUUID().toString());
        template.header("X-Source-Service", "order-service");
    }
}

@Component
public class AuthFeignInterceptor implements RequestInterceptor {

    @Autowired
    private TokenProvider tokenProvider;

    @Override
    public void apply(RequestTemplate template) {
        String token = tokenProvider.getAccessToken();
        template.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
    }
}

@Configuration
public class FeignInterceptorConfig {

    @Bean
    public RequestInterceptor feignRequestInterceptor() {
        return template -> {
            template.header("X-Correlation-Id", UUID.randomUUID().toString());
            template.header("X-Source", "backend-service");
        };
    }
}
```

Feign `RequestInterceptor` instances modify outgoing requests before execution. They run after Feign builds the request template from annotations but before the HTTP client executes it. `FeignRequestInterceptor` adds standard headers including a unique request ID for distributed tracing — critical for debugging request flows across microservice boundaries. The `AuthFeignInterceptor` injects OAuth2 bearer tokens dynamically, handling token refresh transparently without impacting calling code. For correlation ID propagation, the functional bean reads from the application context and adds `X-Correlation-Id`, which can be logged by downstream services to correlate all logs belonging to a single request chain.

---

## Comparing Approaches

### Performance Characteristics

```java
// RestTemplate - Thread per request
@Service
public class BlockingOrderService {

    private final RestTemplate restTemplate;

    public OrderResponse processOrder(OrderRequest request) {
        // Each call blocks a thread
        User user = restTemplate.getForObject(
            "http://user-service/users/{id}", User.class, request.getUserId());

        Inventory inventory = restTemplate.getForObject(
            "http://inventory-service/products/{id}", Inventory.class, request.getProductId());

        Payment payment = restTemplate.postForObject(
            "http://payment-service/payments", request.getPayment(), Payment.class);

        // 3 threads blocked, total time = sum of all three calls
        return new OrderResponse(user, inventory, payment);
    }
}

// WebClient - Non-blocking
@Service
public class ReactiveOrderService {

    private final WebClient userClient;
    private final WebClient inventoryClient;
    private final WebClient paymentClient;

    public Mono<OrderResponse> processOrder(OrderRequest request) {
        Mono<User> user = userClient.get()
            .uri("/users/{id}", request.getUserId())
            .retrieve()
            .bodyToMono(User.class);

        Mono<Inventory> inventory = inventoryClient.get()
            .uri("/products/{id}", request.getProductId())
            .retrieve()
            .bodyToMono(Inventory.class);

        Mono<Payment> payment = paymentClient.post()
            .uri("/payments")
            .bodyValue(request.getPayment())
            .retrieve()
            .bodyToMono(Payment.class);

        // All three calls execute in parallel, single thread
        return Mono.zip(user, inventory, payment)
            .map(tuple -> new OrderResponse(tuple.getT1(), tuple.getT2(), tuple.getT3()))
            .timeout(Duration.ofSeconds(15));
    }
}
```

The performance difference between blocking and non-blocking approaches is most visible when composing multiple API calls. The RestTemplate version makes three sequential calls, tying up three servlet container threads for the combined duration. The WebClient version makes all three calls in parallel on a single event-loop thread, reducing total latency to the slowest individual call. For 200 concurrent requests, RestTemplate would require 600 blocked threads while WebClient handles them with roughly a dozen event-loop threads. This efficiency is why reactive approaches dominate in high-concurrency environments — they trade thread-per-request for event-driven multiplexing.

### When to Use Each

| Approach | Best For | Limitations |
|----------|----------|-------------|
| RestTemplate | Simple blocking calls, legacy projects | Maintenance mode, blocking I/O |
| WebClient | Reactive stacks, high concurrency, streaming | Requires reactor knowledge |
| Feign | Microservice-to-microservice, Spring Cloud | Tight Spring integration |

---

## Best Practices

### 1. Connection Pooling

```java
@Configuration
public class ConnectionPoolConfig {

    @Bean
    public RestTemplate pooledRestTemplate() {
        PoolingHttpClientConnectionManager connectionManager =
            new PoolingHttpClientConnectionManager();
        connectionManager.setMaxTotal(200);
        connectionManager.setDefaultMaxPerRoute(50);
        connectionManager.setValidateAfterInactivity(1000);

        CloseableHttpClient httpClient = HttpClientBuilder.create()
            .setConnectionManager(connectionManager)
            .setConnectionTimeToLive(30, TimeUnit.SECONDS)
            .evictExpiredConnections()
            .evictIdleConnections(30, TimeUnit.SECONDS)
            .build();

        HttpComponentsClientHttpRequestFactory factory =
            new HttpComponentsClientHttpRequestFactory(httpClient);
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(10000);

        return new RestTemplate(factory);
    }
}
```

Connection pooling is the single most impactful performance optimization for HTTP clients. `PoolingHttpClientConnectionManager` reuses persistent TCP connections across requests, avoiding the overhead of three-way handshakes and TLS negotiation on every call. `setValidateAfterInactivity(1000)` checks connection freshness before reuse — without this, a server-side socket timeout can cause unpredictable errors on recycled connections. The 30-second connection TTL balances freshness with reuse efficiency. In Kubernetes environments where pods scale dynamically, consider reducing the TTL to 15 seconds to avoid routing to scaled-down pods.

### 2. Timeout Configuration

```java
@Configuration
public class TimeoutConfig {

    @Bean
    public RestTemplate restTemplateWithTimeouts() {
        return new RestTemplateBuilder()
            .setConnectTimeout(Duration.ofSeconds(3))
            .setReadTimeout(Duration.ofSeconds(8))
            .build();
    }

    @Bean
    public WebClient webClientWithTimeouts() {
        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(
                HttpClient.create()
                    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000)
                    .responseTimeout(Duration.ofSeconds(8))
            ))
            .build();
    }
}
```

Timeouts are the second line of defense against slow dependencies. Connect timeouts should be aggressive (3 seconds) — a server that cannot accept a connection within 3 seconds is unlikely to serve the request promptly. Read timeouts (8 seconds) should align with your service-level objectives. Timeouts apply per operation, so three sequential 8-second read timeouts mean the user waits up to 24 seconds. Prefer shorter timeouts with retry over long single timeouts. For batch operations, consider per-call timeouts rather than a single timeout for the entire batch.

### 3. Circuit Breaker Integration

```java
@Service
public class ResilientUserClient {

    private final WebClient webClient;

    public ResilientUserClient(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("https://user-service").build();
    }

    @CircuitBreaker(name = "userService", fallbackMethod = "getDefaultUser")
    @RateLimiter(name = "userService")
    @Retry(name = "userService")
    @Bulkhead(name = "userService")
    public Mono<User> getUser(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class);
    }

    public Mono<User> getDefaultUser(Long id, Throwable t) {
        log.warn("Fallback for user {}: {}", id, t.getMessage());
        return Mono.just(User.builder()
            .id(id)
            .name("Unknown")
            .status("UNAVAILABLE")
            .build());
    }
}
```

Resilience4j annotations compose from outer to inner: `@Bulkhead` → `@RateLimiter` → `@CircuitBreaker` → `@Retry`. The circuit breaker should come before retry so that when the circuit is open, no retry attempts are wasted on a known-unhealthy service. The fallback method signature must match the original method plus a `Throwable` parameter. In production, instrument fallback invocations with metrics and proactive alerts — they are leading indicators of downstream service degradation. Return sensible defaults from fallbacks (like "Unknown" user) rather than null to keep the system functional in degraded mode.

---

## Common Mistakes

### Mistake 1: Not Using Connection Pooling

```java
// WRONG: Creating a new RestTemplate for each request
@Service
public class BrokenService {

    public User getUser(Long id) {
        RestTemplate rt = new RestTemplate();  // No pooling!
        return rt.getForObject("http://api/users/{id}", User.class, id);
    }
}

// CORRECT: Use shared RestTemplate with connection pool
@Service
public class CorrectService {

    private final RestTemplate restTemplate;

    public CorrectService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;  // Pooled
    }

    public User getUser(Long id) {
        return restTemplate.getForObject("http://api/users/{id}", User.class, id);
    }
}
```

Creating a new `RestTemplate` per request bypasses connection pooling entirely, establishing a new TCP connection every call. This adds 10-100ms of latency from handshake overhead and can exhaust ephemeral ports under load, leading to `BindException` failures. Always inject a shared, centrally configured `RestTemplate` bean.

### Mistake 2: Ignoring Timeouts

```java
// WRONG: Default timeouts are too long
@Bean
public RestTemplate brokenTemplate() {
    return new RestTemplate();  // Default: infinite timeout
}

// CORRECT: Set explicit timeouts
@Bean
public RestTemplate correctTemplate() {
    return new RestTemplateBuilder()
        .setConnectTimeout(Duration.ofSeconds(5))
        .setReadTimeout(Duration.ofSeconds(10))
        .build();
}
```

The default RestTemplate constructor implies infinite connect and read timeouts. Without explicit timeouts, a single unresponsive downstream service causes thread starvation across the application as blocked threads accumulate waiting for responses that never arrive. Always set explicit timeouts that align with your application's latency SLO.

### Mistake 3: Blocking WebClient in Reactive Stack

```java
// WRONG: Blocking a reactive pipeline
@Service
public class BrokenReactiveService {

    private final WebClient webClient;

    public User getUser(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .block();  // Blocks the reactive thread!
    }
}

// CORRECT: Return Mono/Flux
@Service
public class CorrectReactiveService {

    private final WebClient webClient;

    public Mono<User> getUser(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class);
    }
}
```

Calling `.block()` inside a reactive pipeline blocks the event-loop thread, negating WebClient's scalability advantage. When the event loop is blocked, it cannot process other requests, leading to reduced throughput and potential thread starvation. If you must use WebClient in a blocking context, subscribe on a dedicated scheduler or migrate the call site to return reactive types.

### Mistake 4: Not Handling Partial Failures

```java
// WRONG: One failure fails everything
public OrderResponse processOrder(OrderRequest request) {
    User user = userClient.getUser(request.getUserId());
    Inventory inventory = inventoryClient.checkInventory(request.getProductId());
    // If inventory fails, user call is wasted
}

// CORRECT: Use proper error boundaries
public OrderResponse processOrder(OrderRequest request) {
    User user = userClient.getUserWithFallback(request.getUserId());
    Inventory inventory = inventoryClient.getInventoryWithDefault(request.getProductId());

    if (inventory == null || !inventory.isAvailable()) {
        return OrderResponse.outOfStock(user, request.getProductId());
    }

    return OrderResponse.success(user, inventory);
}
```

In distributed systems, partial failures are the norm. The naive approach propagates the failure immediately, wasting work already done. Production systems should design for partial degradation — use fallbacks per call, isolate failures with bulkheads, and provide degraded but functional responses. This "design for failure" approach is fundamental to building resilient microservices.

### Mistake 5: Retrying Without Idempotency Check

```java
// WRONG: Retry can cause duplicate side effects
@Retry(name = "payment")
public PaymentResponse processPayment(PaymentRequest request) {
    return paymentClient.charge(request);  // Retry = double charge!
}

// CORRECT: Include idempotency key
@Retry(name = "payment")
public PaymentResponse processPayment(PaymentRequest request, String idempotencyKey) {
    return paymentClient.charge(request, idempotencyKey);
}
```

Retrying non-idempotent operations without an idempotency key can cause duplicate side effects — like charging a customer twice. Always require idempotency keys for operations that create or modify resources. The key should be unique per operation and stable across retry attempts. Most payment APIs (Stripe, PayPal) natively support idempotency keys for exactly this reason.

---

## Summary

Choosing the right HTTP client depends on your architecture:

1. **RestTemplate**: Suitable for simple blocking scenarios in traditional servlet-based applications. Easy to learn and well-documented, but limited by its thread-per-request model and maintenance-mode status.
2. **WebClient**: Preferred for reactive stacks and high-concurrency applications. Its non-blocking IO model supports streaming, parallel request composition, and efficient resource utilization, at the cost of a steeper learning curve.
3. **Feign**: Best for Spring Cloud microservices with declarative interface contracts. Its annotation-driven approach eliminates boilerplate but requires careful configuration of timeouts, error decoders, and fallbacks per client.

Key production considerations include connection pooling to avoid TCP overhead, explicit timeout configuration to prevent thread starvation, circuit breakers to isolate failures, proper error handling with domain-specific exceptions, and idempotency keys for safe retry of mutating operations. Whichever client you choose, instrument it with logging, metrics, and distributed tracing to maintain observability in production.

---

## References

- [Spring RestTemplate Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#rest-client-access)
- [Spring WebClient Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html#webflux-client)
- [Spring Cloud OpenFeign](https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/)
- [Resilience4j Documentation](https://resilience4j.readme.io/docs/getting-started)

---

Happy Coding
