---
title: "Consuming REST APIs in Spring Boot"
description: "Master RestTemplate, WebClient, and Feign for consuming REST APIs in Spring Boot applications with production patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - rest-api
  - webclient
  - feign
  - resttemplate
coverImage: "/images/consuming-rest-apis.png"
draft: false
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

---

## Summary

Choosing the right HTTP client depends on your architecture:

1. **RestTemplate**: Suitable for simple blocking scenarios in traditional servlet-based applications
2. **WebClient**: Preferred for reactive stacks and high-concurrency applications
3. **Feign**: Best for Spring Cloud microservices with declarative interface contracts

Key production considerations include connection pooling, timeout configuration, circuit breakers, proper error handling, and idempotency for retry scenarios.

---

## References

- [Spring RestTemplate Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#rest-client-access)
- [Spring WebClient Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html#webflux-client)
- [Spring Cloud OpenFeign](https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/)
- [Resilience4j Documentation](https://resilience4j.readme.io/docs/getting-started)

---

Happy Coding 👨‍💻

Happy Coding