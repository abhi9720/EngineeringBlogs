---
title: "RestTemplate vs WebClient"
description: "Compare RestTemplate and WebClient for microservice communication: synchronous vs reactive, performance, configuration, error handling, and migration guide from RestTemplate to WebClient"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - resttemplate
  - webclient
  - spring-webflux
  - microservices
coverImage: "/images/rest-template-vs-webclient.png"
draft: false
---

## Overview

RestTemplate and WebClient are Spring's HTTP client abstractions. RestTemplate is the traditional synchronous client, while WebClient is a reactive, non-blocking alternative introduced in Spring WebFlux. Understanding the differences helps choose the right client for your use case.

## RestTemplate (Traditional)

### Configuration

The default `RestTemplate` uses simple connection management with no pooling and default timeouts — unsuitable for production. The custom configuration shown here adds a connection pool (200 max connections, 50 per route), explicit timeouts (2s connect, 5s read), and logging interceptors. The pool prevents connection exhaustion under high concurrency.

```java
@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @Bean
    public RestTemplate customRestTemplate() {
        RequestConfig requestConfig = RequestConfig.custom()
            .setConnectTimeout(2000)
            .setSocketTimeout(5000)
            .setConnectionRequestTimeout(1000)
            .build();

        PoolingHttpClientConnectionManager connectionManager =
            new PoolingHttpClientConnectionManager();
        connectionManager.setMaxTotal(200);
        connectionManager.setDefaultMaxPerRoute(50);

        CloseableHttpClient httpClient = HttpClientBuilder.create()
            .setDefaultRequestConfig(requestConfig)
            .setConnectionManager(connectionManager)
            .build();

        HttpComponentsClientHttpRequestFactory factory =
            new HttpComponentsClientHttpRequestFactory(httpClient);

        RestTemplate restTemplate = new RestTemplate(factory);

        // Add interceptors
        restTemplate.getInterceptors().add((request, body, execution) -> {
            ClientHttpResponse response = execution.execute(request, body);
            log.debug("{} {} -> {}", request.getMethod(),
                request.getURI(), response.getStatusCode());
            return response;
        });

        // Add message converters
        restTemplate.getMessageConverters().add(0, new MappingJackson2HttpMessageConverter());

        return restTemplate;
    }
}
```

### Usage

RestTemplate calls are synchronous and block the calling thread until the response arrives. The `@Retryable` annotation from Spring Retry adds resilience — failed requests due to timeouts are retried up to 3 times with exponential backoff. Error handling relies on try-catch blocks around each call.

```java
@Service
public class OrderService {

    @Autowired
    private RestTemplate restTemplate;

    @Value("${services.payment.url}")
    private String paymentServiceUrl;

    @Retryable(
        retryFor = {TimeoutException.class, HttpClientErrorException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public PaymentResponse processPayment(PaymentRequest request) {
        ResponseEntity<PaymentResponse> response = restTemplate.postForEntity(
            paymentServiceUrl + "/api/payments/process",
            request,
            PaymentResponse.class
        );

        if (response.getStatusCode() != HttpStatus.OK) {
            throw new PaymentServiceException("Payment failed: " + response.getStatusCode());
        }

        return response.getBody();
    }

    // Error handling with try-catch
    public OrderResponse getOrder(String orderId) {
        try {
            return restTemplate.getForObject(
                "http://order-service/api/orders/{id}",
                OrderResponse.class,
                orderId
            );
        } catch (HttpClientErrorException.NotFound e) {
            throw new OrderNotFoundException(orderId);
        } catch (HttpServerErrorException e) {
            throw new ServiceUnavailableException("Order service unavailable");
        } catch (ResourceAccessException e) {
            throw new TimeoutException("Order service timeout");
        }
    }
}
```

## WebClient (Reactive)

### Configuration

WebClient is built on Reactor Netty with non-blocking I/O. Its builder-based API allows configuring base URLs, default headers, connection timeouts, and filters in a declarative style. The `wiretap` option provides low-level Netty debugging, while the response timeout ensures the reactive pipeline doesn't hang indefinitely.

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient webClient() {
        return WebClient.builder()
            .baseUrl("http://api-gateway:8080")
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader("X-Source", "order-service")
            .build();
    }

    @Bean
    public WebClient customWebClient() {
        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(
                HttpClient.create()
                    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 2000)
                    .responseTimeout(Duration.ofSeconds(5))
                    .metrics(true, Supplier::new)
                    .wiretap("reactor.netty.http.client", LogLevel.DEBUG,
                        AdvancedByteBufFormat.TEXTUAL)
            ))
            .baseUrl("http://payment-service:8080")
            .defaultHeaders(headers -> {
                headers.setBearerAuth(getToken());
                headers.set("X-Correlation-Id", UUID.randomUUID().toString());
            })
            .filter(ExchangeFilterFunction.ofRequestProcessor(request -> {
                log.debug("Request: {} {}", request.method(), request.url());
                return Mono.just(request);
            }))
            .filter(ExchangeFilterFunction.ofResponseProcessor(response -> {
                log.debug("Response: {}", response.statusCode());
                return Mono.just(response);
            }))
            .build();
    }

    private String getToken() {
        return "Bearer " + SecurityContextHolder.getContext()
            .getAuthentication().getCredentials().toString();
    }
}
```

### Usage

WebClient's reactive API chains operators to build a processing pipeline. `.timeout()` sets a maximum wait, `.retryWhen()` handles transient failures with backoff, and `.onErrorResume()` provides fallback responses. Parallel calls are composed with `Mono.zip` — all three requests execute concurrently, unlike RestTemplate's sequential blocking.

```java
@Service
public class ReactiveOrderService {

    @Autowired
    private WebClient webClient;

    public Mono<PaymentResponse> processPayment(PaymentRequest request) {
        return webClient.post()
            .uri("/api/payments/process")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResponse.class)
            .timeout(Duration.ofSeconds(5))
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                .filter(throwable -> throwable instanceof TimeoutException))
            .onErrorResume(e -> {
                log.error("Payment processing failed", e);
                return Mono.just(PaymentResponse.failed("Service unavailable"));
            });
    }

    public Mono<OrderResponse> getOrder(String orderId) {
        return webClient.get()
            .uri("/api/orders/{id}", orderId)
            .retrieve()
            .onStatus(HttpStatus::is4xxClientError, response -> {
                if (response.statusCode() == HttpStatus.NOT_FOUND) {
                    return Mono.error(new OrderNotFoundException(orderId));
                }
                return response.bodyToMono(ErrorResponse.class)
                    .flatMap(error -> Mono.error(
                        new ClientException(error.getMessage())));
            })
            .onStatus(HttpStatus::is5xxServerError, response ->
                Mono.error(new ServiceUnavailableException("Order service unavailable"))
            )
            .bodyToMono(OrderResponse.class);
    }

    // Parallel calls with WebClient
    public Mono<OrderCompositeResponse> getOrderComposite(String orderId) {
        Mono<OrderResponse> orderMono = getOrder(orderId);
        Mono<List<PaymentResponse>> paymentsMono = getPayments(orderId);
        Mono<ShippingResponse> shippingMono = getShipping(orderId);

        return Mono.zip(orderMono, paymentsMono, shippingMono)
            .map(tuple -> {
                OrderCompositeResponse composite = new OrderCompositeResponse();
                composite.setOrder(tuple.getT1());
                composite.setPayments(tuple.getT2());
                composite.setShipping(tuple.getT3());
                return composite;
            });
    }

    // Streaming with WebClient
    public Flux<Notification> streamNotifications(String userId) {
        return webClient.get()
            .uri("/api/notifications/stream/{userId}", userId)
            .accept(MediaType.TEXT_EVENT_STREAM)
            .retrieve()
            .bodyToFlux(Notification.class)
            .retryWhen(Retry.backoff(5, Duration.ofSeconds(1))
                .maxBackoff(Duration.ofSeconds(10)))
            .doOnCancel(() -> log.info("Notification stream cancelled"));
    }
}
```

## Migration from RestTemplate to WebClient

Migration can happen incrementally — existing synchronous code stays on RestTemplate while new reactive endpoints use WebClient. The `.block()` method bridges the reactive world to synchronous callers, useful during transitional periods. Long-term, the goal is end-to-end non-blocking for better resource utilization.

```java
@Service
public class MigrationExample {

    // RestTemplate approach (legacy)
    @Deprecated
    public InventoryResponse checkInventoryRest(String sku) {
        return restTemplate.getForObject(
            "http://inventory-service/api/inventory/{sku}",
            InventoryResponse.class,
            sku
        );
    }

    // WebClient approach (reactive)
    public Mono<InventoryResponse> checkInventoryReactive(String sku) {
        return webClient.get()
            .uri("/api/inventory/{sku}", sku)
            .retrieve()
            .bodyToMono(InventoryResponse.class);
    }

    // Blocking WebClient (bridge to synchronous)
    public InventoryResponse checkInventoryBlocking(String sku) {
        return webClient.get()
            .uri("/api/inventory/{sku}", sku)
            .retrieve()
            .bodyToMono(InventoryResponse.class)
            .block(Duration.ofSeconds(5));
    }
}
```

## Comparison

| Feature | RestTemplate | WebClient |
|---------|-------------|-----------|
| Programming model | Synchronous (blocking) | Reactive (non-blocking) |
| Thread model | Blocking I/O (thread per request) | Event loop (few threads) |
| Error handling | try-catch | onErrorResume, onStatus |
| Streaming | Not supported | SSE, WebFlux streaming |
| Retry | Requires Spring Retry or Resilience4j | Built-in retry operators |
| Performance | Lower under high concurrency | Higher under high concurrency |
| Learning curve | Simpler | Steeper (reactive concepts) |

## Best Practices

- Use WebClient for new projects, especially those with high concurrency requirements.
- Use RestTemplate for simple synchronous calls in non-reactive applications (Spring MVC).
- Configure connection pools and timeouts for both clients.
- Use the reactive chain operators for error handling with WebClient.
- Consider using `block()` sparingly with WebClient when you must bridge to synchronous code.
- Monitor connection pool metrics for both clients.

## Common Mistakes

### Mistake: Blocking WebClient in a reactive pipeline

```java
// Wrong - blocking in reactive pipeline defeats purpose
public Flux<Order> getOrders() {
    return Flux.fromIterable(orderIds)
        .map(id -> webClient.get()
            .uri("/orders/{id}", id)
            .retrieve()
            .bodyToMono(Order.class)
            .block() // Blocks event loop thread!
        );
}
```

```java
// Correct - flatMap for reactive composition
public Flux<Order> getOrders() {
    return Flux.fromIterable(orderIds)
        .flatMap(id -> webClient.get()
            .uri("/orders/{id}", id)
            .retrieve()
            .bodyToMono(Order.class)
        );
}
```

### Mistake: No timeout on WebClient calls

```java
// Wrong - no timeout, may hang indefinitely
Mono<Order> order = webClient.get()
    .uri("/orders/{id}", id)
    .retrieve()
    .bodyToMono(Order.class);
```

```java
// Correct - timeout configured
Mono<Order> order = webClient.get()
    .uri("/orders/{id}", id)
    .retrieve()
    .bodyToMono(Order.class)
    .timeout(Duration.ofSeconds(5));
```

## Summary

RestTemplate is simpler but blocking, suitable for traditional Spring MVC applications. WebClient is reactive and non-blocking, offering better scalability and performance under concurrency. For new projects, prefer WebClient. For existing RestTemplate code, migrate gradually by introducing WebClient for new functionality.

## References

- [Spring WebClient Documentation](https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html)
- [Spring RestTemplate Documentation](https://docs.spring.io/spring-framework/reference/integration/rest-client.html)
- [Baeldung - RestTemplate vs WebClient](https://www.baeldung.com/spring-webclient-resttemplate-comparison)

Happy Coding