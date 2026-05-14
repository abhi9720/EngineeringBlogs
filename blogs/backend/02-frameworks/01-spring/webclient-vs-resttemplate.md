---
title: WebClient vs RestTemplate Comparison
description: >-
  Deep comparison of WebClient and RestTemplate for HTTP communication in Spring
  Boot: performance, API design, and migration strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - webclient
  - resttemplate
  - http-client
  - reactive
coverImage: /images/webclient-vs-resttemplate.png
draft: false
order: 100
type: comparison
---
# WebClient vs RestTemplate: Choosing the Right HTTP Client

## Overview

RestTemplate has been the standard HTTP client in Spring for over a decade. WebClient was introduced in Spring 5 as a reactive alternative within the WebFlux framework. While RestTemplate is now in maintenance mode and will be deprecated, it remains functional. WebClient represents the future of HTTP communication in Spring, supporting both reactive and synchronous programming models.

This guide provides a comprehensive comparison across API design, performance, concurrency, error handling, and migration strategies.

---

## Architectural Differences

### Threading Model

```java
// RestTemplate: 1 thread per request (blocking I/O)
@Service
public class BlockingService {

    // Each call blocks a thread from the servlet container thread pool
    public Data fetchData() {
        // Thread A is blocked waiting for I/O
        Response r1 = restTemplate.getForObject("http://service-a/data", Response.class);
        // Thread A is still blocked waiting for I/O
        Response r2 = restTemplate.getForObject("http://service-b/data", Response.class);
        // Thread A released after both responses received
        return combine(r1, r2);
    }
}

// WebClient: Event-loop model (non-blocking I/O)
@Service
public class ReactiveService {

    // Single event-loop thread handles multiple requests
    public Mono<Data> fetchData() {
        // Event-loop thread dispatches request and moves on
        Mono<Response> r1 = webClient.get().uri("http://service-a/data").retrieve().bodyToMono(Response.class);
        // Event-loop thread dispatches request and moves on
        Mono<Response> r2 = webClient.get().uri("http://service-b/data").retrieve().bodyToMono(Response.class);
        // Callback fires when both complete, without blocking any thread
        return Mono.zip(r1, r2).map(tuple -> combine(tuple.getT1(), tuple.getT2()));
    }
}
```

The threading model is the fundamental architectural difference. RestTemplate uses the Servlet API's blocking I/O — each HTTP call occupies a thread from the container's thread pool while waiting for the response. If a service handles 200 concurrent requests that each make 3 downstream calls, it needs 600 threads just for I/O waiting. WebClient uses an event-loop model where a small number of threads dispatch I/O operations and process callbacks when data arrives. A single event-loop thread can handle thousands of concurrent connections because it never blocks — it delegates I/O to the operating system's non-blocking primitives and processes results as they become available.

### Internal Architecture

```java
// RestTemplate uses the Servlet API (InputStream-based)
@Bean
public RestTemplate restTemplate() {
    return new RestTemplateBuilder()
        .requestFactory(() -> {
            // Uses HttpURLConnection by default, or Apache/OkHttp
            HttpComponentsClientHttpRequestFactory factory =
                new HttpComponentsClientHttpRequestFactory();
            factory.setConnectTimeout(5000);
            factory.setReadTimeout(10000);
            return factory;
        })
        .build();
}

// WebClient uses Reactor Netty or Jetty Reactive Streams
@Bean
public WebClient webClient() {
    return WebClient.builder()
        .clientConnector(new ReactorClientHttpConnector(
            HttpClient.create()
                .wiretap(true)
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                .responseTimeout(Duration.ofSeconds(10))
        ))
        .build();
}
```

Under the hood, RestTemplate wraps `java.net.HttpURLConnection` (or Apache HttpClient / OkHttp when configured) which uses blocking `InputStream` reads. Each `read()` call blocks the calling thread until data arrives. WebClient wraps Reactor Netty (or Jetty Reactive), which uses Java NIO channels with event-driven callbacks — the thread registers interest in data arrival and is free to handle other work while waiting. The `wiretap(true)` option enables Netty wire-level logging for debugging, which is the equivalent of RestTemplate's `ClientHttpRequestInterceptor` but at the network transport level.

---

## API Surface Comparison

### Basic GET Request

```java
// RestTemplate
@Service
public class RestTemplateExample {

    public User getUser(Long id) {
        return restTemplate.getForObject(
            "https://api.example.com/users/{id}",
            User.class,
            id
        );
    }

    public ResponseEntity<User> getUserWithHeaders(Long id) {
        return restTemplate.getForEntity(
            "https://api.example.com/users/{id}",
            User.class,
            id
        );
    }
}

// WebClient - Synchronous
@Service
public class WebClientSyncExample {

    public User getUser(Long id) {
        return webClient.get()
            .uri("https://api.example.com/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .block(Duration.ofSeconds(10));
    }

    // WebClient - Reactive
    public Mono<User> getUserReactive(Long id) {
        return webClient.get()
            .uri("https://api.example.com/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class);
    }
}
```

RestTemplate's API is simple and familiar: `getForObject` returns the deserialized body directly, while `getForEntity` gives access to response headers and status code. WebClient's fluent API chains method calls: `get()` specifies the HTTP method, `uri()` sets the target URL, `retrieve()` indicates we want to extract the response, and `bodyToMono()` deserializes to the target type. The synchronous variant calls `.block()` which bridges the reactive pipeline to the blocking world. The WebClient API is longer per-call but more explicit about each step of the request lifecycle, and the reactive variant trivially enables non-blocking execution by simply omitting the `.block()` call.

### POST with Request Body

```java
// RestTemplate
public User createUser(User user) {
    return restTemplate.postForObject(
        "https://api.example.com/users",
        user,
        User.class
    );
}

// WebClient - Synchronous
public User createUser(User user) {
    return webClient.post()
        .uri("https://api.example.com/users")
        .bodyValue(user)
        .retrieve()
        .bodyToMono(User.class)
        .block(Duration.ofSeconds(10));
}

// WebClient - Reactive
public Mono<User> createUser(User user) {
    return webClient.post()
        .uri("https://api.example.com/users")
        .bodyValue(user)
        .retrieve()
        .bodyToMono(User.class);
}
```

POST requests follow the same pattern. RestTemplate accepts the request body as a parameter alongside the URL and response type. WebClient uses `.bodyValue()` to set the request body explicitly in the chain. RestTemplate's `postForObject` is concise but less flexible — you cannot easily add custom headers or inspect the response status without switching to `exchange()`. WebClient's fluent chain makes header customization, error handling with `.onStatus()`, and response metadata inspection natural extensions rather than afterthoughts.

### URI Builder

```java
// RestTemplate: UriComponentsBuilder
public List<User> searchUsers(String name, int page, int size) {
    URI uri = UriComponentsBuilder
        .fromUriString("https://api.example.com/users")
        .queryParam("name", name)
        .queryParam("page", page)
        .queryParam("size", size)
        .build()
        .toUri();

    return restTemplate.exchange(
        RequestEntity.get(uri)
            .header("Authorization", "Bearer token")
            .build(),
        new ParameterizedTypeReference<List<User>>() {}
    ).getBody();
}

// WebClient: Built-in URI builder
public Flux<User> searchUsers(String name, int page, int size) {
    return webClient.get()
        .uri(uriBuilder -> uriBuilder
            .path("/users")
            .queryParam("name", name)
            .queryParam("page", page)
            .queryParam("size", size)
            .build())
        .retrieve()
        .bodyToFlux(User.class);
}
```

Building URIs with query parameters is a common source of errors — encoding issues, missing parameters, and malformed URLs. RestTemplate requires `UriComponentsBuilder` to construct the URI separately, then pass it to `exchange()`. WebClient integrates URI building into the fluent chain via a lambda-based `uri()` overload: the `uriBuilder` instance handles encoding correctly and produces a `java.net.URI` internally. This eliminates the extra URI-building step and ensures consistent encoding. WebClient's approach is particularly cleaner when combining path variables with query parameters.

### Exchange vs Execute

```java
// RestTemplate: exchange() for full control
public ApiResponse<User> getUserWithFullControl(Long id) {
    RequestEntity<Void> request = RequestEntity
        .get(URI.create("https://api.example.com/users/" + id))
        .header("X-Custom-Header", "value")
        .build();

    ResponseEntity<ApiResponse<User>> response = restTemplate.exchange(
        request,
        new ParameterizedTypeReference<ApiResponse<User>>() {}
    );

    return response.getBody();
}

// WebClient: exchangeToMono() for full control
public Mono<ApiResponse<User>> getUserWithFullControl(Long id) {
    return webClient.get()
        .uri("/users/{id}", id)
        .header("X-Custom-Header", "value")
        .exchangeToMono(response -> {
            if (response.statusCode().is2xxSuccessful()) {
                return response.bodyToMono(
                    new ParameterizedTypeReference<ApiResponse<User>>() {});
            } else {
                return response.createException()
                    .flatMap(Mono::error);
            }
        });
}
```

When full control over the request and response is needed, both clients offer low-level APIs. RestTemplate creates a `RequestEntity` and passes it to `exchange()`, which returns a `ResponseEntity` with the deserialized body. WebClient's `exchangeToMono()` receives the raw `ClientResponse` and requires the caller to explicitly handle both success and error cases — it does not automatically throw on error status codes like `retrieve()` does. This gives fine-grained control: you can inspect status codes, read response headers, choose different deserialization strategies per status, or even read the raw response body. The trade-off is that you must explicitly handle all cases — missing an error branch means the error response is silently dropped.

---

## Error Handling Comparison

### RestTemplate Error Handling

```java
@Component
public class CustomErrorHandler implements ResponseErrorHandler {

    @Override
    public boolean hasError(ClientHttpResponse response) throws IOException {
        return response.getStatusCode().isError();
    }

    @Override
    public void handleError(ClientHttpResponse response) throws IOException {
        String body = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
        HttpStatus status = (HttpStatus) response.getStatusCode();

        switch (status) {
            case BAD_REQUEST:
                throw new BadRequestException(body);
            case NOT_FOUND:
                throw new ResourceNotFoundException(body);
            case TOO_MANY_REQUESTS:
                throw new RateLimitException(body);
            default:
                throw new ExternalServiceException(body);
        }
    }
}

// Usage
@Service
public class OrderService {

    private final RestTemplate restTemplate;

    public OrderResponse getOrder(String orderId) {
        try {
            return restTemplate.getForObject(
                "/orders/{id}", OrderResponse.class, orderId);
        } catch (ResourceNotFoundException e) {
            log.warn("Order not found: {}", orderId);
            return null;
        } catch (RateLimitException e) {
            log.warn("Rate limited, will retry later");
            throw new RetryableException("Rate limited", e);
        } catch (ExternalServiceException e) {
            log.error("Payment service unavailable");
            throw new ServiceUnavailableException("Payment service down", e);
        }
    }
}
```

RestTemplate error handling is centralized via `ResponseErrorHandler`. The custom handler wraps every HTTP error in a typed exception, and callers catch the specific exceptions they care about. This pattern works well when the client library is consumed synchronously — try-catch blocks around each call handle the different failure modes. The drawback is that error handling is separated from the call site: the `ResponseErrorHandler` is configured on the RestTemplate bean, making it invisible to developers reading the calling code. Developers must know which exceptions the handler throws to handle them properly.

### WebClient Error Handling

```java
@Service
public class ReactiveOrderService {

    private final WebClient webClient;

    public Mono<OrderResponse> getOrder(String orderId) {
        return webClient.get()
            .uri("/orders/{id}", orderId)
            .retrieve()
            .onStatus(HttpStatus::is4xxClientError, response ->
                response.bodyToMono(String.class)
                    .flatMap(body -> {
                        if (response.statusCode().equals(HttpStatus.NOT_FOUND)) {
                            return Mono.error(new ResourceNotFoundException(body));
                        }
                        if (response.statusCode().equals(HttpStatus.TOO_MANY_REQUESTS)) {
                            return Mono.error(new RateLimitException(body));
                        }
                        return Mono.error(new BadRequestException(body));
                    })
            )
            .onStatus(HttpStatus::is5xxServerError, response ->
                response.bodyToMono(String.class)
                    .flatMap(body ->
                        Mono.error(new ExternalServiceException(body)))
            )
            .bodyToMono(OrderResponse.class)
            .timeout(Duration.ofSeconds(5))
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                .filter(throwable -> throwable instanceof ServiceUnavailableException))
            .onErrorResume(ResourceNotFoundException.class, ex -> {
                log.warn("Order not found: {}", orderId);
                return Mono.empty();
            })
            .onErrorResume(RateLimitException.class, ex -> {
                log.warn("Rate limited for order: {}", orderId);
                return Mono.error(new RetryableException("Rate limited"));
            });
    }
}
```

WebClient error handling is inline via `.onStatus()`, keeping the error mapping logic close to the request definition. The `onStatus` method takes a predicate for the HTTP status code family and a function that receives the `ClientResponse` and returns an error `Mono`. This inline approach makes it clear which errors are handled and how, without requiring a separate configuration class. The reactive pipeline then chains `.retryWhen()` for transient failures and `.onErrorResume()` for fallback handling — all in a single fluent expression. This composability is WebClient's advantage: error handling, retry, timeout, and fallback are all operators in the same reactive pipeline, applied in a readable top-to-bottom order.

---

## Performance Benchmarks

### Throughput Under Load

```
Scenario: 1000 concurrent requests to external API

RestTemplate:
  - Threads required: 1000 (or more with queuing)
  - Throughput: ~5000 req/s (limited by thread pool)
  - CPU usage: Higher due to context switching
  - Memory: ~1MB per thread stack

WebClient (Reactive):
  - Threads required: ~12 (event loop)
  - Throughput: ~15000 req/s (limited by network)
  - CPU usage: Lower, mostly I/O wait
  - Memory: Minimal per connection
```

The throughput advantage of WebClient comes from its thread efficiency. RestTemplate requires one thread per concurrent request, and when 1000 requests arrive simultaneously, the application must either have a 1000-thread pool (consuming ~1GB of stack memory) or queue requests (adding latency). WebClient's event-loop model handles all 1000 connections with roughly a dozen threads, reducing memory consumption by orders of magnitude and eliminating context-switching overhead. The throughput ceiling shifts from thread pool limits to network bandwidth, making WebClient the clear choice for high-concurrency scenarios like API gateways, microservice sidecars, and real-time data pipelines.

### Response Time Percentiles

```java
// RestTemplate blocking sequential calls
public UserData getUserData(Long id) {
    User user = restTemplate.getForObject("/users/{id}", User.class, id);
    Profile profile = restTemplate.getForObject("/users/{id}/profile", Profile.class, id);
    List<Order> orders = restTemplate.getForObject("/users/{id}/orders", List.class, id);

    // Total time: sum of all three calls
    return new UserData(user, profile, orders);
}

// WebClient non-blocking parallel calls
public Mono<UserData> getUserData(Long id) {
    Mono<User> user = webClient.get().uri("/users/{id}", id).retrieve().bodyToMono(User.class);
    Mono<Profile> profile = webClient.get().uri("/users/{id}/profile", id).retrieve().bodyToMono(Profile.class);
    Mono<List<Order>> orders = webClient.get().uri("/users/{id}/orders", id).retrieve().bodyToFlux(Order.class).collectList();

    // Total time: max of all three calls (parallel)
    return Mono.zip(user, profile, orders)
        .map(tuple -> new UserData(tuple.getT1(), tuple.getT2(), tuple.getT3()));
}
```

Response time is another area where WebClient's reactive model shines. RestTemplate makes sequential blocking calls, so the total latency is the sum of all three calls: if each takes 200ms, the user waits 600ms. WebClient fires all three requests simultaneously via `Mono.zip()`, so the total latency is the maximum of the three: 200ms. This parallel composition is trivially achieved with reactive types but requires explicit threading (e.g., `CompletableFuture.allOf()`) in the blocking world. For dashboards or aggregation services that compose data from multiple sources, WebClient can reduce response times by 3x or more.

---

## Migration Strategies

### Step 1: Gradual Replacement

```java
// Phase 1: Both clients coexist
@Configuration
public class DualHttpConfig {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplateBuilder()
            .setConnectTimeout(Duration.ofSeconds(5))
            .setReadTimeout(Duration.ofSeconds(10))
            .build();
    }

    @Bean
    public WebClient webClient() {
        return WebClient.builder()
            .baseUrl("https://api.example.com")
            .build();
    }
}

// Phase 2: New code uses WebClient
@Service
public class MigrationService {

    private final RestTemplate restTemplate;    // Legacy
    private final WebClient webClient;          // New

    public LegacyData getLegacyData() {
        return restTemplate.getForObject("/legacy/data", LegacyData.class);
    }

    public Mono<NewData> getNewData() {
        return webClient.get()
            .uri("/new/data")
            .retrieve()
            .bodyToMono(NewData.class);
    }
}
```

The safest migration strategy is coexistence: both clients live side by side. All existing RestTemplate code continues to work unchanged. New endpoints and new services use WebClient. This approach eliminates migration risk — there is no big-bang rewrite, no regression window, and no need to restructure working code. Over time, as legacy endpoints are deprecated or refactored, the RestTemplate usage naturally shrinks. This gradual approach is the most practical for large codebases.

### Step 2: Synchronous WebClient Wrapper

```java
// Adapter to make WebClient behave like RestTemplate during migration
@Component
public class SyncWebClientAdapter {

    private final WebClient webClient;

    public <T> T getForObject(String uri, Class<T> responseType, Object... uriVariables) {
        return webClient.get()
            .uri(uri, uriVariables)
            .retrieve()
            .bodyToMono(responseType)
            .block(Duration.ofSeconds(10));
    }

    public <T> T postForObject(String uri, Object request, Class<T> responseType) {
        return webClient.post()
            .uri(uri)
            .bodyValue(request)
            .retrieve()
            .bodyToMono(responseType)
            .block(Duration.ofSeconds(10));
    }

    public <T> ResponseEntity<T> exchange(
            String uri, HttpMethod method, Object request,
            Class<T> responseType, Object... uriVariables) {

        Mono<ResponseEntity<T>> response = webClient.method(method)
            .uri(uri, uriVariables)
            .bodyValue(request != null ? request : Mono.empty())
            .retrieve()
            .toEntity(responseType);

        return response.block(Duration.ofSeconds(10));
    }
}
```

For teams that want WebClient's configuration and connection management but are not ready for reactive programming, a synchronous adapter provides a bridge. The adapter wraps WebClient calls in `.block()` with explicit timeouts, exposing a RestTemplate-compatible API. This allows the team to switch the HTTP transport without changing any calling code. Once the adapter is in place, individual methods can be migrated to return reactive types one at a time, without a massive refactoring effort.

### Step 3: Reactive Service Migration

```java
// Original blocking service
@Service
public class LegacyInventoryService {

    public InventoryCheckResult checkStock(String sku) {
        InventoryResponse response = restTemplate.getForObject(
            "http://inventory/{sku}", InventoryResponse.class, sku);
        return convertToResult(response);
    }
}

// Intermediary: reactive internally, blocking at controller
@Service
public class SemiReactiveInventoryService {

    public InventoryCheckResult checkStock(String sku) {
        return webClient.get()
            .uri("http://inventory/{sku}", sku)
            .retrieve()
            .bodyToMono(InventoryResponse.class)
            .map(this::convertToResult)
            .block(Duration.ofSeconds(10));
    }
}

// Full reactive service
@Service
public class ReactiveInventoryService {

    public Mono<InventoryCheckResult> checkStock(String sku) {
        return webClient.get()
            .uri("http://inventory/{sku}", sku)
            .retrieve()
            .bodyToMono(InventoryResponse.class)
            .map(this::convertToResult);
    }
}
```

The three-phase migration path shows the progression: start with fully blocking (RestTemplate), move to WebClient internally but block at the service boundary (semi-reactive), and finally remove `.block()` to become fully reactive. Each phase is independently deployable and testable. The semi-reactive phase is a safe intermediate step — callers receive blocking semantics while the implementation gains WebClient's better connection management and configuration. The final step requires the entire call chain to support reactive types, which typically means migrating from `@Controller` to `@RestController` with reactive return types or from Spring MVC to Spring WebFlux.

---

## When to Use Each

### Choose RestTemplate When

```java
// 1. You have a simple, low-concurrency application
@SpringBootApplication
public class SimpleApp {
    // 10-50 concurrent users, REST calls are <100ms
    // RestTemplate is simpler and well-understood
}

// 2. You are maintaining legacy code
@Service
public class LegacyMigrationService {
    // Millions of lines using RestTemplate
    // Migration cost outweighs benefits
}

// 3. Your call stack is inherently blocking
public Document generateReport() {
    // CPU-intensive operation that takes 30 seconds
    // Blocking is acceptable since work is CPU-bound
    return reportGenerator.generate();
}
```

RestTemplate remains a valid choice in specific scenarios. For low-concurrency applications (admin dashboards, internal tools, batch processors), the thread-per-request model adds negligible overhead. For legacy codebases, the cost of migrating millions of lines of well-tested RestTemplate code to WebClient rarely justifies the benefits. And for CPU-bound workloads (report generation, image processing, data analysis), the I/O model is irrelevant since the bottleneck is CPU, not I/O. In these cases, RestTemplate's simplicity and familiarity outweigh WebClient's scalability advantages.

### Choose WebClient When

```java
// 1. High concurrency is required
@SpringBootApplication
public class HighTrafficApp {
    // 10000+ concurrent users
    // WebClient's non-blocking model saves threads
}

// 2. You make multiple dependent API calls
@Service
public class DashboardService {
    public Mono<Dashboard> getDashboard(String userId) {
        // 5+ API calls that can run in parallel
        // WebClient's zip/combine saves significant time
        return Mono.zip(
            getUser(userId),
            getOrders(userId),
            getRecommendations(userId),
            Dashboard::new
        );
    }
}

// 3. You use reactive stack (WebFlux)
@RestController
@RequestMapping("/api")
public class ReactiveController {

    @GetMapping("/users/{id}")
    public Mono<User> getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
    // End-to-end reactive pipeline
}
```

WebClient is the default choice for new development. High-concurrency applications benefit most from its event-loop model — the same hardware handles 10x-20x more concurrent requests. Services that compose data from multiple downstream APIs (dashboards, aggregators, API gateways) benefit from parallel request execution with `Mono.zip()`. And for applications using Spring WebFlux, WebClient is the only choice that maintains end-to-end reactivity — blocking RestTemplate calls inside a reactive pipeline would require dedicated thread pools, negating the scalability benefits.

---

## Common Mistakes

### Mistake 1: Blocking WebClient in Reactive Pipeline

```java
// WRONG: .block() in a reactive pipeline
@RestController
public class BrokenController {

    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class)
            .block();  // BLOCKS THE EVENT LOOP!
    }
}

// CORRECT: Return reactive types
@RestController
public class CorrectController {

    @GetMapping("/users/{id}")
    public Mono<User> getUser(@PathVariable Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class);
    }
}
```

Calling `.block()` in a reactive pipeline blocks the event-loop thread, which is designed to never block. When the event loop is blocked, it cannot process any other I/O events, effectively reducing your throughput to zero until the blocking call completes. This completely negates the scalability benefits of reactive programming. The fix is to let the reactive type propagate through the entire call chain: the controller returns `Mono<User>` instead of `User`, and Spring WebFlux subscribes and unsubscribes automatically. If you must block (e.g., in a test or in a `@Scheduled` method), use `.block()` with an explicit timeout and never in an event-loop thread.

### Mistake 2: Using RestTemplate for Streaming

```java
// WRONG: RestTemplate loads entire response into memory
public List<Transaction> getTransactions() {
    Transaction[] transactions = restTemplate.getForObject(
        "/transactions", Transaction[].class);  // All in memory!
    return Arrays.asList(transactions);
}

// CORRECT: WebClient can stream the response
public Flux<Transaction> getTransactions() {
    return webClient.get()
        .uri("/transactions")
        .retrieve()
        .bodyToFlux(Transaction.class);
}
```

RestTemplate deserializes the entire response body into memory before returning control to the caller. For large responses (millions of transactions, a large CSV export), this causes high memory pressure, long GC pauses, and potential OOM errors. WebClient's `bodyToFlux()` deserializes items incrementally as they arrive over the network — each transaction is processed and can be streamed to the client or written to a file before the next one arrives. This streaming capability is essential for large datasets and is a primary reason to choose WebClient over RestTemplate for data-intensive operations.

### Mistake 3: Wrong Exception Handling Approach

```java
// WRONG: Catching WebClientResponseException in non-reactive code
@Service
public class BrokenService {

    public User getUser(Long id) {
        try {
            return webClient.get()
                .uri("/users/{id}", id)
                .retrieve()
                .bodyToMono(User.class)
                .block();
        } catch (WebClientResponseException e) {
            // Won't catch it here - it's wrapped in a different exception
            log.error("Error", e);
            return null;
        }
    }
}

// CORRECT: Use .onStatus() or handle the thrown exception properly
@Service
public class CorrectService {

    public User getUser(Long id) {
        try {
            return webClient.get()
                .uri("/users/{id}", id)
                .retrieve()
                .onStatus(HttpStatus::is4xxClientError, response ->
                    Mono.error(new ResourceNotFoundException("User not found")))
                .bodyToMono(User.class)
                .block();
        } catch (ResourceNotFoundException e) {
            log.warn("User not found: {}", id);
            return null;
        }
    }
}
```

When WebClient's `retrieve()` encounters a 4xx or 5xx response, it throws `WebClientResponseException` inside the reactive pipeline. In synchronous code (after `.block()`), this exception is wrapped and may not be catchable as `WebClientResponseException` directly — it depends on the exception type of the reactive pipeline. The correct approach is to use `.onStatus()` to map HTTP errors to your own domain exceptions before `.block()`, then catch those typed exceptions. This keeps error handling predictable and independent of WebClient's internal exception types.

### Mistake 4: Not Setting Timeouts

```java
// WRONG: No timeouts configured
WebClient.create();  // Default timeouts: no timeout!

// CORRECT: Always set timeouts
WebClient.builder()
    .clientConnector(new ReactorClientHttpConnector(
        HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
            .responseTimeout(Duration.ofSeconds(10))
    ))
    .build();
```

WebClient's default configuration has no connect timeout and no read timeout at the HTTP level. A misconfigured or overloaded server can hold a connection open indefinitely, causing resource leaks in the connection pool and accumulating pending requests in the caller. Always configure explicit timeouts via `ChannelOption.CONNECT_TIMEOUT_MILLIS` (connection establishment) and `.responseTimeout()` (waiting for the first byte of the response). The `.timeout()` operator in the reactive chain provides an additional per-request timeout that covers the entire operation, including deserialization.

### Mistake 5: Mixing Blocking and Reactive Without Care

```java
// WRONG: Blocking call inside a reactive pipeline breaks backpressure
@Service
public class BrokenReactiveService {

    public Flux<User> processUsers() {
        return getAllUserIds()
            .flatMap(id -> {
                User user = restTemplate.getForObject("/users/{id}", User.class, id);  // Blocking!
                return Mono.just(user);
            });
    }
}

// CORRECT: Stay within reactive paradigm
@Service
public class CorrectReactiveService {

    public Flux<User> processUsers() {
        return getAllUserIds()
            .flatMap(id ->
                webClient.get()
                    .uri("/users/{id}", id)
                    .retrieve()
                    .bodyToMono(User.class)
            );
    }
}
```

Mixing blocking calls inside a reactive pipeline is a subtle but dangerous anti-pattern. The `flatMap` operator expects non-blocking operations — it runs the inner function on the event-loop thread. When `restTemplate.getForObject()` blocks that thread, the entire event loop stalls, and no other I/O events can be processed. The result is dramatically reduced throughput and, in extreme cases, complete system hang. If you must call a blocking API from a reactive pipeline, wrap it in `Mono.fromCallable(() -> blockingCall()).subscribeOn(Schedulers.boundedElastic())` to offload it to a dedicated thread pool. But the correct solution is to use WebClient throughout.

---

## Summary

| Feature | RestTemplate | WebClient |
|---------|-------------|-----------|
| Model | Blocking I/O | Non-blocking I/O |
| Thread usage | 1 thread per request | Event loop (few threads) |
| Learning curve | Low | Medium (requires reactive knowledge) |
| Streaming | No (loads all in memory) | Yes (Flux streaming) |
| Error handling | ResponseErrorHandler | .onStatus() / .onErrorResume() |
| Future support | Maintenance mode | Active development |

The migration from RestTemplate to WebClient is not an all-or-nothing decision. Start with new endpoints, use the adapter pattern, and gradually migrate high-concurrency paths first. The most important consideration is alignment with your application's threading model: if you are on Spring MVC with moderate concurrency, RestTemplate is still a pragmatic choice. If you are on WebFlux or anticipate significant growth in concurrent requests, WebClient is the clear path forward.

---

## References

- [Spring WebClient Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html#webflux-client)
- [Spring RestTemplate Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#rest-client-access)
- [Reactor Core Documentation](https://projectreactor.io/docs/core/release/reference/)
- [Migrating from RestTemplate to WebClient](https://spring.io/blog/2019/04/16/recommended-way-to-use-webclient)

---

Happy Coding
