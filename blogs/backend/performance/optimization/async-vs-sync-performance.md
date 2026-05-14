---
title: "Async vs Sync Performance"
description: "Compare synchronous and asynchronous processing: thread models, reactive programming, and throughput measurement"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - optimization
  - async
  - reactive
  - threading
coverImage: "/images/async-vs-sync-performance.png"
draft: false
---

# Async vs Sync Performance

## Overview

Synchronous processing blocks threads while waiting for I/O. Asynchronous processing allows threads to handle other work during I/O waits. The difference becomes critical at scale—async can handle 10x more concurrent requests with the same hardware.

### The Blocking Problem

- **Synchronous**: 100 threads handle 100 concurrent requests
- **Asynchronous**: 100 threads handle 10,000 concurrent requests

---

## Synchronous Processing

### Traditional Thread-Per-Request

```java
@RestController
public class SyncController {

    @GetMapping("/api/orders/{id}")
    public Order getOrder(@PathVariable Long id) {
        // Thread blocked here while waiting for database
        Order order = orderRepository.findById(id).orElseThrow();

        // Thread blocked here while calling external service
        PaymentStatus payment = paymentService.getStatus(order.getPaymentId());

        return order;
    }
}

// Thread model:
// Request 1 → Thread 1 (blocked on DB I/O)
// Request 2 → Thread 2 (blocked on HTTP call)
// Request 3 → Thread 3 (blocked on DB I/O)
// ...
// Request 101 → WAITING (no available threads)
```

The thread-per-request model maps each HTTP connection to a dedicated OS thread from Tomcat's internal pool. When all 200 threads are blocked on database socket reads or external HTTP calls, the 201st request must wait in the TCP accept queue — or be rejected outright. A thread dump under load will show most threads in `RUNNABLE` state waiting on `java.net.SocketInputStream.read`, meaning the CPU is largely idle but no threads are free to accept new work. This is the fundamental inefficiency that async and reactive models are designed to eliminate.

### Thread Pool Configuration

```yaml
# Tomcat thread pool (default: 200)
server:
  tomcat:
    threads:
      max: 200
      min-spare: 10
    max-connections: 10000
    accept-count: 100
```

```java
@Configuration
public class TomcatThreadPoolConfig {

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> tomcatCustomizer() {
        return factory -> {
            factory.addConnectorCustomizers(connector -> {
                connector.setProperty("maxThreads", "200");
                connector.setProperty("minSpareThreads", "10");
                connector.setProperty("maxConnections", "10000");
                connector.setProperty("acceptCount", "100");
        connector.setProperty("connectionTimeout", "5000");
            });
        };
    }
}
```

The Tomcat connector properties control the request pipeline from the network layer up. `maxThreads` (200) is the hard limit on concurrent request processing. `maxConnections` (10,000) allows the OS to accept many more TCP connections than there are threads — the excess are buffered in the kernel's SYN backlog. `acceptCount` (100) is the size of that backlog. When all three fill, the kernel starts dropping SYN packets, which clients see as `Connection refused`. Tuning these values is a trade-off between burst tolerance and memory: each queued connection consumes a socket descriptor and a small kernel buffer.

### Synchronous Performance Characteristics

```java
@Service
public class SyncMetricsService {

    private final MeterRegistry registry;

    public void measurePerformance() {
        // Under load test with 500 concurrent users:

        // Synchronous:
        // - Active threads: 200 (all occupied)
        // - Response time p50: 200ms
        // - Response time p99: 5000ms (queued!)
        // - Throughput: 1000 req/s (thread-bound)
        // - CPU: 30% (waiting on I/O)
        // - Error rate: 5% (timeouts)

        // Thread dump shows:
        // 200 threads in RUNNABLE state
        // Most waiting on database connections or HTTP responses
    }
}
```

The metrics reveal the sync bottleneck clearly: CPU sits at 30 % — most threads are I/O-waiting — yet throughput is capped at 1000 req/s because no thread is free to accept new connections. The p99 latency spike to 5000 ms comes from requests queuing for a thread, not from the actual processing time. When you see CPU utilization below 50 % alongside saturated thread pools, it is a strong signal that async processing will help.

---

## Asynchronous Processing

### CompletableFuture

```java
@RestController
public class AsyncController {

    private final AsyncService asyncService;

    @GetMapping("/api/orders/{id}")
    public CompletableFuture<Order> getOrder(@PathVariable Long id) {
        return asyncService.getOrderAsync(id);
    }
}

@Service
public class AsyncService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private PaymentClient paymentClient;

    @Async("asyncExecutor")
    public CompletableFuture<Order> getOrderAsync(Long id) {
        Order order = orderRepository.findById(id).orElseThrow();
        PaymentStatus payment = paymentClient.getStatus(order.getPaymentId());
        return CompletableFuture.completedFuture(order);
    }

    // Parallel async calls
    public CompletableFuture<OrderDetail> getOrderDetail(Long id) {
        CompletableFuture<Order> orderFuture =
            CompletableFuture.supplyAsync(() -> orderRepository.findById(id));

        CompletableFuture<List<OrderItem>> itemsFuture =
            CompletableFuture.supplyAsync(() -> itemRepository.findByOrderId(id));

        CompletableFuture<PaymentStatus> paymentFuture =
            CompletableFuture.supplyAsync(() -> paymentClient.getStatus(id));

        return CompletableFuture.allOf(orderFuture, itemsFuture, paymentFuture)
            .thenApply(v -> new OrderDetail(
                orderFuture.join(),
                itemsFuture.join(),
                paymentFuture.join()
            ));
    }
}
```

### Async Thread Pool Configuration

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean("asyncExecutor")
    public Executor asyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);

        // Rejection policy: caller runs the task
        executor.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy());

        executor.initialize();
        return executor;
    }
}
```

### Performance Comparison

```java
@Service
public class PerformanceComparisonService {

    private final MeterRegistry registry;

    // Synchronous version (blocking)
    public Dashboard getDashboardSync() {
        long start = System.nanoTime();
        try {
            OrdersSummary orders = orderService.getOrdersSummary();
            PaymentSummary payments = paymentService.getPaymentSummary();
            UserStats stats = userService.getUserStats();
            return new Dashboard(orders, payments, stats);
            // Total: 300ms (sequential I/O)
        } finally {
            registry.timer("dashboard.sync")
                .record(Duration.ofNanos(System.nanoTime() - start));
        }
    }

    // Asynchronous version (non-blocking)
    public CompletableFuture<Dashboard> getDashboardAsync() {
        long start = System.nanoTime();

        CompletableFuture<OrdersSummary> orders =
            CompletableFuture.supplyAsync(orderService::getOrdersSummary);
        CompletableFuture<PaymentSummary> payments =
            CompletableFuture.supplyAsync(paymentService::getPaymentSummary);
        CompletableFuture<UserStats> stats =
            CompletableFuture.supplyAsync(userService::getUserStats);

        return CompletableFuture.allOf(orders, payments, stats)
            .thenApply(v -> new Dashboard(
                orders.join(),
                payments.join(),
                stats.join()
            ))
            .whenComplete((result, error) ->
                registry.timer("dashboard.async")
                    .record(Duration.ofNanos(System.nanoTime() - start))
            );
        // Total: ~100ms (parallel I/O)
    }
}
```

`CompletableFuture.supplyAsync` decomposes the dashboard into three independent data fetches that execute concurrently on the async thread pool. While the three futures are outstanding, the calling thread returns to the pool and can serve other requests — the JVM's `ForkJoinPool` manages continuation scheduling rather than blocking. The `allOf` + `thenApply` pattern assembles results when all three complete, giving a total latency equal to the slowest call (~100 ms) rather than their sum (~300 ms). In production, always supply a dedicated `ThreadPoolTaskExecutor` instead of relying on `ForkJoinPool.commonPool`, which is shared across parallel streams and framework components.

---

## Reactive Programming

### WebFlux

```java
@RestController
@RequestMapping("/api/reactive")
public class ReactiveController {

    @GetMapping("/orders/{id}")
    public Mono<Order> getOrder(@PathVariable Long id) {
        return orderReactiveRepository.findById(id);
    }

    @GetMapping("/orders")
    public Flux<Order> getOrders(@RequestParam(defaultValue = "0") int page) {
        return orderReactiveRepository.findAllByPage(page, 20);
    }

    @PostMapping("/orders")
    public Mono<Order> createOrder(@RequestBody Mono<OrderRequest> request) {
        return request
            .flatMap(this::validateOrder)
            .flatMap(this::processPayment)
            .flatMap(orderReactiveRepository::save);
    }

    // Parallel reactive calls
    @GetMapping("/dashboard")
    public Mono<Dashboard> getDashboard() {
        Mono<OrdersSummary> orders = orderService.getOrdersReactive();
        Mono<PaymentSummary> payments = paymentService.getPaymentsReactive();
        Mono<UserStats> stats = userService.getUserStatsReactive();

        return Mono.zip(orders, payments, stats)
            .map(tuple -> new Dashboard(
                tuple.getT1(),
                tuple.getT2(),
                tuple.getT3()
            ));
    }
}

// Reactive repository
public interface OrderReactiveRepository
        extends ReactiveCrudRepository<Order, Long> {

    Flux<Order> findAllByStatus(OrderStatus status);
    Mono<Long> countByCustomerId(Long customerId);
}
```

### Reactive Performance

```yaml
# WebFlux uses Netty (event-loop), not Tomcat (thread-pool)
# Netty: Fixed small thread pool (typically CPU cores × 2)
# All I/O is non-blocking

spring:
  webflux:
    base-path: /api

# Netty event loop configuration:
# - Fewer threads: 8-16 (vs 200 for Tomcat)
# - Higher concurrency: 10,000+ concurrent connections
# - Lower memory: ~50MB (vs 200MB+ for Tomcat)
```

The event-loop model inverts the thread-per-request approach: a small fixed set of I/O threads multiplexes thousands of channel registrations using the operating system's `select`/`epoll`/`kqueue` primitives. Because no thread is ever blocked waiting for I/O — all reads and writes are registered as callbacks — a single event loop can handle tens of thousands of concurrent connections. The memory saving comes from eliminating per-thread stack allocations (typically 1 MB per thread) and from the non-blocking I/O buffers being far smaller than per-connection thread stacks.

### Scheduler Configuration

```java
@Configuration
public class ReactiveSchedulerConfig {

    @Bean
    public Scheduler jdbcScheduler() {
        // For blocking JDBC calls in reactive pipeline
        return Schedulers.fromExecutor(
            Executors.newFixedThreadPool(
                Runtime.getRuntime().availableProcessors() * 2
            )
        );
    }
}

@Service
public class ReactiveHybridService {

    private final Scheduler jdbcScheduler;

    @Autowired
    private OrderRepository jpaRepository; // Blocking JPA

    public Mono<Order> findById(Long id) {
        return Mono.fromCallable(() -> jpaRepository.findById(id))
            .subscribeOn(jdbcScheduler) // Offload blocking call
            .flatMap(Mono::justOrEmpty);
    }
}
```

---

## Performance Benchmark

### Results Comparison

| Metric | Sync (Tomcat) | Async (CompletableFuture) | Reactive (WebFlux) |
|--------|--------------|--------------------------|-------------------|
| Threads | 200 | 10-50 | 8-16 |
| Max connections | 10,000 | 10,000 | 25,000+ |
| Throughput (100 users) | 1,000 req/s | 1,500 req/s | 2,000 req/s |
| Throughput (500 users) | 1,200 req/s | 3,500 req/s | 5,000 req/s |
| Memory (500 users) | 500MB | 200MB | 100MB |
| p99 latency (500 users) | 5,000ms | 200ms | 150ms |
| CPU utilization | 30% | 60% | 70% |

---

## When to Use Each

### Use Synchronous When

- Low concurrency (< 100 concurrent requests)
- CPU-bound workloads
- Simple CRUD applications
- Team unfamiliar with reactive patterns

### Use Async When

- High concurrency (100-1000+ concurrent requests)
- I/O-bound workloads (database, HTTP calls)
- Multiple independent service calls
- Need faster response times

### Use Reactive When

- Very high concurrency (1000+)
- Streaming data (real-time feeds)
- Event-driven architectures
- Need lowest resource usage

---

## Common Mistakes

### Mistake 1: Blocking in Async Thread

```java
// WRONG: Blocking call in async thread
@Async
public CompletableFuture<Order> getOrder(Long id) {
    Thread.sleep(1000); // Blocks async thread!
    return CompletableFuture.completedFuture(repository.findById(id));
}

// CORRECT: Use non-blocking or dedicated thread pool
public CompletableFuture<Order> getOrder(Long id) {
    return CompletableFuture.supplyAsync(() -> {
        // Blocking is OK here, it's on a dedicated thread pool
        return repository.findById(id);
    }, jdbcExecutor);
}
```

### Mistake 2: No Timeout

```java
// WRONG: Async call without timeout
CompletableFuture<Order> future = orderService.getOrderAsync(id);
Order order = future.get(); // Blocks forever if service is down

// CORRECT: Always set timeout
CompletableFuture<Order> future = orderService.getOrderAsync(id);
try {
    Order order = future.get(5, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw new ServiceTimeoutException("Order service timed out");
}
```

### Mistake 3: Thread Pool Exhaustion from Sync Calls

```yaml
# WRONG: Large sync thread pool
server:
  tomcat:
    threads:
      max: 1000
# 1000 threads = 1000× stack size (1MB) = 1GB memory

# CORRECT: Use async for I/O, keep thread pool small
server:
  tomcat:
    threads:
      max: 50
```

---

## Summary

1. Synchronous is simpler but limited by thread count
2. Async processing increases throughput 3-5x for I/O workloads
3. Reactive model handles 1000+ concurrent connections with minimal threads
4. Match processing model to workload type (CPU vs I/O bound)
5. Always set timeouts on async operations
6. Use thread pools sized for the workload
7. Monitor thread pool utilization and queue depth

---

## References

- [Spring Async Documentation](https://docs.spring.io/spring-framework/reference/integration/scheduling.html)
- [Spring WebFlux Documentation](https://docs.spring.io/spring-framework/reference/web/webflux.html)
- [Java CompletableFuture Guide](https://www.baeldung.com/java-completablefuture)
- [Reactive Programming with Spring](https://spring.io/reactive)

Happy Coding