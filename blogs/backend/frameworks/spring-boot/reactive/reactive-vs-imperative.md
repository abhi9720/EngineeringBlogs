---
title: "Reactive vs Imperative: When to Use Reactive Programming"
description: "Compare reactive and imperative programming in Spring: performance characteristics, use cases, trade-offs, and decision framework for choosing between WebFlux and WebMVC"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - reactive
  - webflux
  - architecture
coverImage: "/images/reactive-vs-imperative.png"
draft: false
---

## Overview

Choosing between reactive (WebFlux) and imperative (WebMVC) programming models is a critical architectural decision. This guide compares both approaches across dimensions like performance, resource utilization, complexity, and use cases to help you make an informed decision.

The decision should never be "reactive is faster" — that's a common misconception. Reactive offers better scalability under high concurrency, not lower latency for individual requests. For typical CRUD applications under moderate load, WebMVC is simpler and equally performant.

## Comparison Overview

| Aspect | Imperative (WebMVC) | Reactive (WebFlux) |
|--------|-------------------|-------------------|
| Threading Model | One thread per request | Event loop with few threads |
| Concurrency | Thread pool (default 200) | Event-driven, non-blocking |
| Backpressure | Not supported | Built-in |
| Learning Curve | Low | High |
| Debugging | Easy (stack traces) | Hard (async stack traces) |
| Database Access | JDBC/JPA (blocking) | R2DBC/MongoDB Reactive |
| Best For | Standard CRUD, CPU-bound | I/O-bound, streaming, high concurrency |

## Threading Models

### Imperative Thread Model

In the imperative model, each request occupies a thread from the Tomcat thread pool for its entire duration — including when waiting for database queries or external API calls. With a default pool of 200 threads, only 200 requests can be processed simultaneously. When all threads are blocked waiting for I/O, new requests are queued.

```java
// Imperative: One thread per request
@RestController
public class OrderController {
    private final OrderService orderService;

    @GetMapping("/api/orders")
    public List<Order> getOrders() {
        return orderService.findAll();
    }
}
```

### Reactive Thread Model

The reactive model uses a small number of event loop threads (typically one per CPU core). When a request triggers a database query, the thread returns to the event loop to handle other requests. When the database responds, the event loop continues processing the original request. This enables thousands of concurrent connections with a tiny thread pool.

```java
// Reactive: Event loop, no blocking
@RestController
@RequestMapping("/api/orders")
public class ReactiveOrderController {
    private final ReactiveOrderService orderService;

    @GetMapping
    public Flux<Order> getOrders() {
        return orderService.findAll();
    }
}
```

## Performance Characteristics

```java
@RestController
public class ThroughputTestController {

    @GetMapping("/imperative")
    public List<Product> getProductsImperative() {
        List<Product> products = productRepository.findAll();
        List<Review> reviews = reviewRepository.findByProductIds(
            products.stream().map(Product::getId).toList());
        return enrichWithReviews(products, reviews);
    }

    @GetMapping("/reactive")
    public Flux<Product> getProductsReactive() {
        return productRepository.findAll()
            .flatMap(product -> reviewRepository.findByProductId(product.getId())
                .collectList()
                .map(reviews -> enrichProduct(product, reviews)));
    }
}
```

## When to Use Reactive

### Good Use Cases

```java
// 1. High-concurrency I/O-bound services
@Service
public class ApiGatewayService {
    private final WebClient serviceA;
    private final WebClient serviceB;

    public Mono<AggregatedResponse> aggregate(String id) {
        return Mono.zip(
            serviceA.get().uri("/data/{id}", id).retrieve().bodyToMono(DataA.class),
            serviceB.get().uri("/info/{id}", id).retrieve().bodyToMono(DataB.class)
        ).map(tuple -> new AggregatedResponse(tuple.getT1(), tuple.getT2()));
    }
}
```

```java
// 2. Streaming / Server-Sent Events
@RestController
public class StreamingController {
    @GetMapping(value = "/stream/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Event>> streamEvents() {
        return Flux.interval(Duration.ofSeconds(1))
            .map(i -> ServerSentEvent.<Event>builder()
                .id(String.valueOf(i)).event("tick")
                .data(new Event("Tick #" + i, Instant.now())).build())
            .take(100);
    }
}
```

```java
// 3. Proxy / Gateway services
@Component
public class ProxyService {
    private final WebClient webClient;

    public Mono<ResponseEntity<Resource>> proxyRequest(String url) {
        return webClient.get().uri(url).exchangeToMono(response -> {
            if (response.statusCode().is2xxSuccessful()) {
                return response.body(Resource.class).map(body -> ResponseEntity.ok(body));
            }
            return Mono.just(ResponseEntity.status(response.statusCode()).build());
        });
    }
}
```

### Poor Use Cases for Reactive

```java
// 1. CPU-bound operations (hashing, encoding, image processing)
@Service
public class ImageProcessingService {
    public Mono<ProcessedImage> processImage(Image image) {
        return Mono.fromCallable(() -> applyFilters(image))
            .subscribeOn(Schedulers.boundedElastic());
    }
}

// Better: Imperative with dedicated thread pool
@Service
public class ImageProcessingServiceImperative {
    private final ExecutorService imageProcessor = Executors.newFixedThreadPool(4);

    public CompletableFuture<ProcessedImage> processImage(Image image) {
        return CompletableFuture.supplyAsync(() -> applyFilters(image), imageProcessor);
    }
}
```

```java
// 2. Simple CRUD with low traffic
@Service
public class SimpleCrudServiceImperative {
    public User getUser(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }
}
```

## Decision Framework

```java
public class FrameworkDecision {
    public static String choose(ApplicationRequirements req) {
        if (req.isLowTraffic() && req.isSimpleCrud()) {
            return "WebMVC - Simpler and sufficient";
        }
        if (req.isHighConcurrency()) {
            if (req.isIoSensitive()) {
                return "WebFlux - High concurrency I/O-bound";
            }
            if (req.isCpuBound()) {
                return "WebMVC + reactive for network calls";
            }
        }
        if (req.requiresStreaming()) {
            return "WebFlux - Built-in streaming support";
        }
        if (req.requiresBlockingJdbc()) {
            return "WebMVC - JDBC is blocking";
        }
        if (req.isExistingSpringMvcProject()) {
            return "WebMVC - Migration cost > reactive benefits";
        }
        return "WebMVC (default, can add WebFlux modules later)";
    }
}
```

## Migration Strategy

```java
// Step 1: Start with WebMVC for standard endpoints
@RestController
public class StandardController {
    @GetMapping("/api/standard")
    public String standard() { return "Standard MVC"; }
}

// Step 2: Add WebFlux for specific reactive endpoints
@RestController
public class ReactiveController {
    @GetMapping(value = "/api/reactive", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> reactive() { return Flux.just("reactive"); }
}

// Step 3: Use WebClient in WebMVC for non-blocking external calls
@Service
public class HybridService {
    private final WebClient webClient;

    @Async
    public CompletableFuture<Result> callExternal() {
        return webClient.get().uri("https://api.example.com/data")
            .retrieve().bodyToMono(Result.class).toFuture();
    }
}
```

## Best Practices

1. **Use reactive for I/O-bound, high-concurrency services** - API gateways, proxies, streaming
2. **Prefer imperative for CPU-bound workloads** - image processing, encryption, computation
3. **Never block in reactive pipelines** - use subscribeOn for CPU-heavy tasks
4. **Start with WebMVC** - add WebFlux only when performance requirements justify it
5. **Consider team expertise** - reactive has a steep learning curve
6. **Measure before optimizing** - profile your actual bottlenecks
7. **Use reactive databases** (R2DBC) if going fully reactive

## Common Mistakes

### Mistake 1: Going Reactive for the Wrong Reasons

```java
// Wrong: Using WebFlux because "it's faster"
@RestController
@RequestMapping("/api")
public class UnnecessaryReactiveController {
    @GetMapping("/simple")
    public Mono<String> simple() { return Mono.just("Hello"); }
}

// Correct: Choose based on actual requirements
@RestController
@RequestMapping("/api")
public class SimpleController {
    @GetMapping("/simple")
    public String simple() { return "Hello"; }
}
```

### Mistake 2: Mixing Blocking and Reactive Incorrectly

```java
// Wrong: Blocking JDBC call in reactive pipeline
@Service
public class BadReactiveService {
    @Transactional
    public Mono<List<User>> getUsers() {
        return Mono.fromCallable(() -> jdbcTemplate.query("SELECT * FROM users", userRowMapper));
    }
}

// Correct: Use dedicated scheduler for blocking calls
@Service
public class GoodReactiveService {
    private final JdbcTemplate jdbcTemplate;

    public Mono<List<User>> getUsers() {
        return Mono.fromCallable(() -> jdbcTemplate.query("SELECT * FROM users", userRowMapper))
            .subscribeOn(Schedulers.boundedElastic());
    }
}
```

## Summary

Choose reactive programming when you need high concurrency, I/O-bound operations, streaming, or efficient resource utilization. Choose imperative for CPU-bound tasks, simple CRUD, or when team expertise and maintainability are primary concerns. Many applications benefit from a hybrid approach - WebMVC for standard endpoints and WebFlux for specific reactive modules.

## References

- [Spring WebFlux vs WebMVC](https://docs.spring.io/spring-framework/reference/web/webflux/new-framework.html)
- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [Reactor vs RxJava](https://projectreactor.io/docs/core/release/reference/)
- [R2DBC Documentation](https://r2dbc.io/)

Happy Coding
