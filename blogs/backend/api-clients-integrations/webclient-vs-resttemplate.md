---
title: "WebClient vs RestTemplate Comparison"
description: "Deep comparison of WebClient and RestTemplate for HTTP communication in Spring Boot: performance, API design, and migration strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - webclient
  - resttemplate
  - http-client
  - reactive
coverImage: "/images/webclient-vs-resttemplate.png"
draft: false
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

The migration from RestTemplate to WebClient is not an all-or-nothing decision. Start with new endpoints, use the adapter pattern, and gradually migrate high-concurrency paths first.

---

## References

- [Spring WebClient Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html#webflux-client)
- [Spring RestTemplate Documentation](https://docs.spring.io/spring-framework/docs/current/reference/html/integration.html#rest-client-access)
- [Reactor Core Documentation](https://projectreactor.io/docs/core/release/reference/)
- [Migrating from RestTemplate to WebClient](https://spring.io/blog/2019/04/16/recommended-way-to-use-webclient)

---

Happy Coding 👨‍💻

Happy Coding