---
title: "Custom Metrics with Micrometer"
description: "Create custom business metrics using Micrometer: counters, gauges, timers, and distribution summaries"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - monitoring
  - micrometer
  - custom-metrics
coverImage: "/images/custom-metrics-micrometer.png"
draft: false
---

# Custom Metrics with Micrometer

## Overview

Micrometer provides a facade for instrumenting JVM-based applications with metrics that can be exported to any monitoring system. Custom metrics measure business-specific events, performance characteristics, and system health that are unique to your application.

### Metric Types

| Type | Description | Use Case |
|------|-------------|----------|
| Counter | Incrementing count | Total orders, errors |
| Gauge | Point-in-time value | Active users, queue depth |
| Timer | Duration measurement | Request latency, DB calls |
| DistributionSummary | Distribution of values | Payload sizes, scores |

---

## Counters

### Basic Counter

```java
@Service
public class OrderMetricsService {

    private final Counter orderCreatedCounter;
    private final Counter orderFailedCounter;
    private final Counter orderRefundedCounter;

    public OrderMetricsService(MeterRegistry registry) {
        this.orderCreatedCounter = Counter.builder("orders.created")
            .description("Total number of orders created")
            .tag("type", "all")
            .register(registry);

        this.orderFailedCounter = Counter.builder("orders.failed")
            .description("Total number of failed orders")
            .tag("type", "all")
            .register(registry);

        this.orderRefundedCounter = Counter.builder("orders.refunded")
            .description("Total number of refunded orders")
            .tag("type", "all")
            .register(registry);
    }

    public void recordOrderCreated(Order order) {
        orderCreatedCounter.increment();
    }

    public void recordOrderFailed(Order order, String reason) {
        orderFailedCounter.increment();
    }

    public void recordOrderRefunded(Order order, BigDecimal amount) {
        orderRefundedCounter.increment(amount.doubleValue());
    }
}
```

Counters are the simplest metric type—they only ever increase (or reset to zero on application restart). The `increment(double)` variant on `recordOrderRefunded` supports fractional increments, useful for tracking monetary amounts or quantities where each event has a non-unit weight. Metrics should be registered once in the constructor and reused, not created per-request.

### Counter with Tags

```java
@Service
public class TaggedCounterService {

    private final MeterRegistry registry;

    public TaggedCounterService(MeterRegistry registry) {
        this.registry = registry;
    }

    public void recordPayment(Payment payment) {
        Counter.builder("payments.processed")
            .tag("method", payment.getMethod())
            .tag("currency", payment.getCurrency())
            .tag("status", payment.getStatus())
            .register(registry)
            .increment();
    }

    public void recordApiCall(String endpoint, String method, int status) {
        Counter.builder("api.calls")
            .tag("endpoint", endpoint)
            .tag("method", method)
            .tag("status", String.valueOf(status))
            .register(registry)
            .increment();
    }
}
```

Tags enable multi-dimensional slicing of metrics. A payment counter tagged by `method`, `currency`, and `status` can answer queries like "what is the success rate for credit card payments in USD?" However, every unique combination of tag values creates a new time series in the monitoring backend. If `method` has 3 values, `currency` has 10, and `status` has 2, that is 60 time series—manageable. But adding a `userId` tag with millions of values would create millions of time series, overwhelming the system.

### Rate-Limited Counter

```java
@Component
public class RateLimitedCounter {

    private final MeterRegistry registry;
    private final Map<String, AtomicLong> lastResetTimes = new ConcurrentHashMap<>();
    private static final long RESET_INTERVAL_MS = 60_000;

    public RateLimitedCounter(MeterRegistry registry) {
        this.registry = registry;
    }

    public boolean tryIncrement(String key, long maxPerMinute) {
        AtomicLong lastReset = lastResetTimes.computeIfAbsent(key,
            k -> new AtomicLong(System.currentTimeMillis()));

        long now = System.currentTimeMillis();
        if (now - lastReset.get() > RESET_INTERVAL_MS) {
            lastReset.set(now);
        }

        Counter counter = Counter.builder("rate.limited.events")
            .tag("key", key)
            .register(registry);

        if (counter.count() < maxPerMinute) {
            counter.increment();
            return true;
        }
        return false;
    }
}
```

---

## Gauges

### Basic Gauge

```java
@Service
public class QueueMetricsService {

    private final Queue<Order> pendingOrders = new ConcurrentLinkedQueue<>();

    public QueueMetricsService(MeterRegistry registry) {
        Gauge.builder("orders.queue.pending", pendingOrders, Queue::size)
            .description("Number of pending orders in queue")
            .register(registry);
    }

    public void enqueue(Order order) {
        pendingOrders.add(order);
    }

    public Order dequeue() {
        return pendingOrders.poll();
    }
}
```

Unlike counters, gauges are sampled—Micrometer calls the `Queue::size` method reference each time Prometheus scrapes `/actuator/prometheus`. This means the gauge value reflects the queue depth at the instant of scraping, not a time-weighted average. For metrics that oscillate rapidly (like queue depth), consider using a histogram or recording the value more frequently with a separate recording mechanism.

### Gauge with Custom Object

```java
@Component
public class ConnectionPoolGauge {

    private final DataSource dataSource;

    public ConnectionPoolGauge(DataSource dataSource, MeterRegistry registry) {
        this.dataSource = dataSource;

        Gauge.builder("pool.connections.active", this,
                ConnectionPoolGauge::getActiveConnections)
            .description("Active database connections")
            .register(registry);

        Gauge.builder("pool.connections.idle", this,
                ConnectionPoolGauge::getIdleConnections)
            .description("Idle database connections")
            .register(registry);

        Gauge.builder("pool.connections.pending", this,
                ConnectionPoolGauge::getPendingConnections)
            .description("Pending connection requests")
            .register(registry);
    }

    private int getActiveConnections() {
        if (dataSource instanceof HikariDataSource hikari) {
            return hikari.getHikariPoolMXBean().getActiveConnections();
        }
        return 0;
    }

    private int getIdleConnections() {
        if (dataSource instanceof HikariDataSource hikari) {
            return hikari.getHikariPoolMXBean().getIdleConnections();
        }
        return 0;
    }

    private int getPendingConnections() {
        if (dataSource instanceof HikariDataSource hikari) {
            return hikari.getHikariPoolMXBean().getPendingThreads();
        }
        return 0;
    }
}
```

### Time-Derived Gauge

```java
@Component
public class TimeDerivedGauge {

    private final Map<String, Instant> lastEventTimes = new ConcurrentHashMap<>();

    public TimeDerivedGauge(MeterRegistry registry) {
        // Record seconds since last event
        Gauge.builder("events.seconds.since.last", this,
                service -> {
                    Instant last = service.lastEventTimes.get("order_created");
                    if (last != null) {
                        return Duration.between(last, Instant.now()).getSeconds();
                    }
                    return -1;
                })
            .description("Seconds since last order was created")
            .register(registry);
    }

    public void onOrderCreated() {
        lastEventTimes.put("order_created", Instant.now());
    }
}
```

---

## Timers

### Basic Timer

```java
@Service
public class PerformanceTimingService {

    private final Timer orderProcessingTimer;
    private final Timer paymentProcessingTimer;
    private final Timer inventoryCheckTimer;

    public PerformanceTimingService(MeterRegistry registry) {
        this.orderProcessingTimer = Timer.builder("order.processing.time")
            .description("Time taken to process an order")
            .publishPercentiles(0.5, 0.95, 0.99)
            .publishPercentileHistogram()
            .sla(Duration.ofMillis(50), Duration.ofMillis(100),
                 Duration.ofMillis(200), Duration.ofMillis(500))
            .register(registry);

        this.paymentProcessingTimer = Timer.builder("payment.processing.time")
            .description("Time taken to process a payment")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);

        this.inventoryCheckTimer = Timer.builder("inventory.check.time")
            .description("Time taken to check inventory")
            .register(registry);
    }

    public Order processOrder(OrderRequest request) {
        Timer.Sample sample = Timer.start();

        try {
            checkInventory(request);
            processPayment(request);
            Order order = saveOrder(request);
            sample.stop(orderProcessingTimer);
            return order;
        } catch (Exception e) {
            sample.stop(orderProcessingTimer);
            throw e;
        }
    }

    public PaymentResult processPayment(PaymentRequest request) {
        return paymentProcessingTimer.record(() ->
            paymentGateway.charge(request));
    }

    public InventoryResult checkInventory(OrderRequest request) {
        return inventoryCheckTimer.recordCallable(() ->
            inventoryService.checkAvailability(request));
    }
}
```

The Timer records duration distributions and exposes count, total time, max, and percentile approximations. `publishPercentileHistogram()` enables Prometheus-compatible histogram buckets, allowing server-side percentile calculation across aggregated instances. The `sla` values define custom histogram buckets at 50ms, 100ms, 200ms, and 500ms—useful for tracking SLI compliance (e.g., percentage of requests under 200ms) without server-side computation.

### Long Task Timer

```java
@Service
public class LongTaskTimingService {

    private final LongTaskTimer batchProcessingTimer;

    public LongTaskTimingService(MeterRegistry registry) {
        this.batchProcessingTimer = LongTaskTimer.builder("batch.processing")
            .description("Duration of batch processing jobs")
            .register(registry);
    }

    public void processBatch(List<Order> orders) {
        LongTaskTimer.Sample sample = LongTaskTimer.start(registry);

        try {
            for (Order order : orders) {
                processOrder(order);
            }
        } finally {
            sample.stop();
        }
    }
}
```

---

## Distribution Summaries

```java
@Service
public class DistributionMetricsService {

    private final DistributionSummary orderValueSummary;
    private final DistributionSummary orderItemCountSummary;

    public DistributionMetricsService(MeterRegistry registry) {
        this.orderValueSummary = DistributionSummary.builder("order.value")
            .description("Distribution of order values")
            .baseUnit("USD")
            .publishPercentiles(0.5, 0.75, 0.9, 0.95, 0.99)
            .publishPercentileHistogram()
            .minimumExpectedValue(1.0)
            .maximumExpectedValue(10_000.0)
            .register(registry);

        this.orderItemCountSummary = DistributionSummary.builder("order.items")
            .description("Distribution of items per order")
            .publishPercentiles(0.5, 0.75, 0.9, 0.95)
            .register(registry);
    }

    public void recordOrder(Order order) {
        orderValueSummary.record(order.getTotal().doubleValue());
        orderItemCountSummary.record(order.getItemCount());
    }
}
```

Distribution summaries are like Timers but for arbitrary value distributions rather than time durations. The `minimumExpectedValue` and `maximumExpectedValue` hints tell Micrometer where to focus histogram bucket resolution. For order values between $1 and $10,000, the histogram will have finer granularity at the lower end where most orders cluster.

---

## Custom Metrics Service

```java
@Service
public class ComprehensiveMetricsService {

    private final MeterRegistry registry;

    // Business counters
    private final Counter ordersCreated;
    private final Counter ordersShipped;
    private final Counter ordersCancelled;
    private final Counter paymentsFailed;

    // Business gauges
    private final AtomicInteger activeUsers = new AtomicInteger(0);
    private final AtomicLong totalRevenue = new AtomicLong(0);

    public ComprehensiveMetricsService(MeterRegistry registry) {
        this.registry = registry;

        this.ordersCreated = Counter.builder("business.orders.created")
            .description("Total orders created").register(registry);
        this.ordersShipped = Counter.builder("business.orders.shipped")
            .description("Total orders shipped").register(registry);
        this.ordersCancelled = Counter.builder("business.orders.cancelled")
            .description("Total orders cancelled").register(registry);
        this.paymentsFailed = Counter.builder("business.payments.failed")
            .description("Total failed payments").register(registry);

        Gauge.builder("business.users.active", activeUsers, AtomicInteger::get)
            .description("Currently active users").register(registry);
        Gauge.builder("business.revenue.total", totalRevenue, AtomicLong::get)
            .description("Total revenue in cents").register(registry);
    }

    public void recordOrderCreated(Order order) {
        ordersCreated.increment();

        Timer timer = Timer.builder("business.order.fulfillment.time")
            .tag("orderType", order.getType())
            .register(registry);
        timer.record(Duration.ofMillis(order.getFulfillmentTimeMs()));
    }

    public void recordPayment(String method, String currency, boolean success, long durationMs) {
        Timer timer = Timer.builder("business.payment.time")
            .tag("method", method)
            .tag("currency", currency)
            .tag("result", success ? "success" : "failure")
            .register(registry);
        timer.record(Duration.ofMillis(durationMs));

        if (!success) {
            paymentsFailed.increment();
        }
    }

    public void setActiveUsers(int count) {
        activeUsers.set(count);
    }

    public void addRevenue(BigDecimal amount) {
        totalRevenue.addAndGet(amount.multiply(BigDecimal.valueOf(100)).longValue());
    }
}
```

---

## Best Practices

### 1. Naming Convention

```java
// Pattern: <domain>.<name>.<unit>
// Good:  orders.created.total
//        payments.processing.time
//        queue.depth.items

// Wrong: OrderCreated, processPaymentTime, QueueDepth
```

### 2. Tag Cardinality Management

```java
// WRONG: High cardinality tags
Counter.builder("api.calls")
    .tag("userId", user.getId()) // Millions of unique values
    .register(registry);

// CORRECT: Low cardinality tags
Counter.builder("api.calls")
    .tag("tier", user.getTier()) // bronze, silver, gold, platinum
    .tag("region", user.getRegion()) // Few regions
    .register(registry);
```

### 3. Use Timer.Sample for Blocking Operations

```java
// CORRECT: Timer.Sample is safe for blocking operations
Timer.Sample sample = Timer.start(registry);
try {
    // blocking call
    result = someService.call();
} finally {
    sample.stop(timer);
}
```

---

## Common Mistakes

### Mistake 1: Creating Metrics Inside Hot Path

```java
// WRONG: Metrics created per request
public void handleRequest(Request request) {
    Counter counter = Counter.builder("requests")
        .tag("path", request.getPath())
        .register(registry); // Created every time!
    counter.increment();
}

// CORRECT: Register once, use everywhere
private final Counter requestCounter;

public void handleRequest(Request request) {
    requestCounter.increment();
}
```

### Mistake 2: Using Gauge for Incrementing Values

```java
// WRONG: Gauge for total count (should be Counter)
private final AtomicLong totalOrders = new AtomicLong();
Gauge.builder("orders.total", totalOrders, AtomicLong::get).register(registry);

public void createOrder() {
    totalOrders.incrementAndGet();
}

// CORRECT: Counter for cumulative values
private final Counter ordersTotal;
ordersTotal.increment();
```

### Mistake 3: Not Handling Timer Errors

```java
// WRONG: Timer that doesn't capture exceptions
public Result process() {
    return timer.record(() -> {
        // If this throws, timer is lost
        return riskyOperation();
    });
}

// CORRECT: Timer with try-catch
Timer.Sample sample = Timer.start();
try {
    return riskyOperation();
} finally {
    sample.stop(timer);
}
```

---

## Summary

Custom metrics with Micrometer enable deep business insight:

1. Counters track cumulative events (orders, errors, payments)
2. Gauges capture point-in-time values (queue depth, active users)
3. Timers measure duration with percentile distributions
4. Distribution summaries track value distributions
5. Tags enable multi-dimensional analysis
6. Register metrics once, reuse everywhere
7. Keep tag cardinality low

---

## References

- [Micrometer Concepts](https://micrometer.io/docs/concepts)
- [Micrometer Custom Metrics](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html#actuator.metrics.custom)
- [Prometheus Metric Types](https://prometheus.io/docs/concepts/metric_types/)

Happy Coding
