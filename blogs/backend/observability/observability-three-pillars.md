---
title: "The Three Pillars of Observability"
description: "Deep dive into logs, metrics, and traces: how the three pillars work together to provide comprehensive system observability"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - logging
  - monitoring
  - tracing
coverImage: "/images/observability-three-pillars.png"
draft: false
---

# The Three Pillars of Observability

## Overview

Observability is the ability to understand the internal state of a system by examining its outputs. In distributed systems, observability is not optional—it is a requirement for operating reliable services at scale. The three pillars—logs, metrics, and traces—each provide a different lens into system behavior. Together, they enable teams to debug issues, understand performance, and ensure reliability.

### Why Three Pillars?

Each pillar addresses a different question:
- **Logs**: What happened?
- **Metrics**: What is trending?
- **Traces**: Where did the request go?

No single pillar provides complete visibility. Logs without metrics lack context. Metrics without traces lack causality. Traces without logs lack detail.

---

## Pillar 1: Logging

### Structured Logging

Modern logging uses structured formats like JSON to enable machine parsing and search:

```java
// Logback configuration with Logstash encoder
<!-- logback-spring.xml -->
<configuration>
    <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <includeContext>false</includeContext>
            <customFields>{"service":"user-service","environment":"production"}</customFields>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="JSON" />
    </root>
</configuration>
```

The Logstash encoder above automatically serializes every log event into a JSON object—each field (timestamp, level, logger, message, MDC) becomes a separate JSON key. This eliminates the need for grok patterns or regex parsing on the ingest side. Setting `includeContext` to false avoids bloating events with Logback's internal context; instead, we inject only what matters via `customFields`. The trade-off is a small CPU overhead per log call compared to plain-text formatting, but in high-throughput systems the ability to filter, aggregate, and alert on specific fields far outweighs the cost.

```java
// Logging best practices
@Service
public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public Order createOrder(CreateOrderRequest request) {
        log.info("Creating order for customer: {}", request.customerId());

        try {
            Order order = orderRepository.save(request.toEntity());
            log.info("Order created successfully: id={}, amount={}, items={}",
                order.getId(), order.getTotalAmount(), order.getItemCount());
            return order;
        } catch (DataIntegrityViolationException e) {
            log.error("Order creation failed: customerId={}, reason={}",
                request.customerId(), e.getMessage());
            throw new OrderCreationException("Failed to create order", e);
        }
    }
}
```

Using SLF4J parameterized placeholders (`{}`) instead of string concatenation is a deliberate performance choice—the message is only assembled when the log level is enabled, avoiding unnecessary object allocation on hot paths. Notice that exceptions are passed as the last argument so the framework captures the full stack trace rather than just calling `e.getMessage()`. This subtle pattern is critical in production: without the throwable reference, error analysis pipelines lose the root cause chain.

### Log Levels in Production

| Level | When to Use |
|-------|------------|
| ERROR | System is broken, immediate attention required |
| WARN | Something unexpected but not breaking |
| INFO | Important business events, state changes |
| DEBUG | Detailed diagnostic information |
| TRACE | Fine-grained execution details |

---

## Pillar 2: Metrics

### Types of Metrics

Metrics are numeric aggregations that show system behavior over time:

```java
@Configuration
public class MetricsConfig {

    @Bean
    public MeterRegistry meterRegistry() {
        CompositeMeterRegistry registry = new CompositeMeterRegistry();
        registry.add(new JmxMeterRegistry());
        return registry;
    }

    @Bean
    public MeterRegistryCustomizer<MeterRegistry> commonTags() {
        return registry -> registry.config().commonTags(
            "application", "order-service",
            "environment", "production"
        );
    }
}

@Service
public class OrderMetricsService {

    private final Counter orderCreatedCounter;
    private final Timer orderProcessingTimer;
    private final Gauge activeOrdersGauge;

    public OrderMetricsService(MeterRegistry registry) {
        this.orderCreatedCounter = Counter.builder("orders.created")
            .description("Total number of orders created")
            .register(registry);

        this.orderProcessingTimer = Timer.builder("orders.processing.time")
            .description("Time taken to process orders")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);

        this.activeOrdersGauge = Gauge.builder("orders.active")
            .description("Currently active orders")
            .register(registry);
    }

    public Sample recordOrderCreation() {
        orderCreatedCounter.increment();
        return Timer.start();
    }

    public void recordProcessingTime(Sample sample) {
        sample.stop(orderProcessingTimer);
    }
}
```

Common tags are appended to every metric automatically, enabling cross-cutting filters without per-metric boilerplate. The `Timer` publishes percentile approximations (p50, p95, p99) using HDR histogram resampling—this gives accurate latency distribution insight without storing every individual value. The trade-off is increased memory footprint proportional to the number of unique tag combinations, which is why cardinality management (covered later) is essential. Using `Timer.Sample` (returned by `Timer.start()`) rather than `System.currentTimeMillis()` ensures nanosecond precision on platforms that support it and avoids common off-by-one errors.

### The Four Golden Signals

1. **Latency**: Time to service requests
2. **Traffic**: Demand on the system
3. **Errors**: Rate of failed requests
4. **Saturation**: How "full" the system is

---

## Pillar 3: Tracing

### Distributed Tracing

Traces follow a single request across service boundaries:

```java
@Configuration
public class TracingConfig {

    @Bean
    public OpenTelemetry openTelemetry() {
        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
            .addSpanProcessor(BatchSpanProcessor.builder(
                OtlpGrpcSpanExporter.builder()
                    .setEndpoint("http://localhost:4317")
                    .build()
            ).build())
            .build();

        return OpenTelemetrySdk.builder()
            .setTracerProvider(tracerProvider)
            .build();
    }
}

@Service
public class CheckoutService {

    private final Tracer tracer;

    public CheckoutService(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer("checkout-service");
    }

    public CheckoutResult processCheckout(CheckoutRequest request) {
        Span span = tracer.spanBuilder("checkout.process")
            .setAttribute("customer.id", request.customerId())
            .setAttribute("cart.size", request.items().size())
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            validateInventory(request);
            processPayment(request);
            createShippingLabel(request);
            return new CheckoutResult(true);
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

The `BatchSpanProcessor` buffers spans in memory and exports them in batches on a background thread—this keeps request-serving overhead to a minimum (typically microseconds per span). Using `makeCurrent()` inside a `try-with-resources` ensures that any downstream instrumentation (like HTTP client or database calls) automatically picks up the correct parent context without manual propagation. The `finally` block is critical: forgetting `span.end()` creates memory leaks in the span processor and results in broken traces that never complete.

---

## Correlating the Three Pillars

The real power comes from combining all three:

```java
@Service
public class CorrelatedService {

    private static final Logger log = LoggerFactory.getLogger(CorrelatedService.class);
    private final MeterRegistry meterRegistry;
    private final Tracer tracer;

    public Order processOrder(OrderRequest request) {
        Span span = tracer.spanBuilder("order.process").startSpan();

        try (Scope scope = span.makeCurrent()) {
            log.info("Processing order: traceId={}, spanId={}",
                span.getSpanContext().getTraceId(),
                span.getSpanContext().getSpanId());

            long start = System.currentTimeMillis();
            Order order = executeOrderProcessing(request);
            long duration = System.currentTimeMillis() - start;

            meterRegistry.timer("order.processing.time")
                .record(Duration.ofMillis(duration));

            span.setAttribute("order.id", order.getId());
            span.setAttribute("order.amount", order.getTotal());

            log.info("Order processed successfully: id={}, duration={}ms",
                order.getId(), duration);

            return order;
        } catch (Exception e) {
            meterRegistry.counter("order.processing.errors").increment();
            span.setStatus(StatusCode.ERROR);
            span.recordException(e);
            log.error("Order processing failed: requestId={}", request.id(), e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

Here all three pillars converge within a single method. The trace ID is injected into logs via the span context, so correlating a log entry to its trace waterfall is a single click in any modern observability backend. The same duration is recorded both as a timing metric (for percentile dashboards) and as a span attribute (for trace-level analysis). The counter increment for errors provides the alerting signal, while the span's `recordException` preserves the full diagnostic context. This pattern—emit a log, increment a metric, and annotate a span—gives operators three independent paths to discover and diagnose a problem.

---

## Best Practices

### 1. Instrument Early

Add observability from day one. Retrofitting is expensive:

```java
@Aspect
@Component
public class ObservabilityAspect {

    private final MeterRegistry meterRegistry;
    private final Tracer tracer;

    @Around("@annotation(Observable)")
    public Object observeMethod(ProceedingJoinPoint joinPoint) throws Throwable {
        String methodName = joinPoint.getSignature().toShortString();
        Span span = tracer.spanBuilder(methodName).startSpan();

        try (Scope scope = span.makeCurrent()) {
            Timer.Sample sample = Timer.start(meterRegistry);
            Object result = joinPoint.proceed();
            sample.stop(meterRegistry.timer(methodName));
            return result;
        } catch (Exception e) {
            meterRegistry.counter(methodName + ".errors").increment();
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

Using AOP with a custom `@Observable` annotation provides a single point of control for instrumentation. Every annotated method automatically gets a span, a timer, and an error counter. The downside is that AOP operates at the method boundary, so fine-grained intra-method instrumentation still requires manual spans. A pragmatic approach is to use AOP for service-layer boundaries and manual instrumentation for hot paths where granularity matters.

### 2. Use Correlation IDs

Ensure every log line has a trace ID for correlation:

```java
@Component
public class CorrelationIdFilter extends OncePerRequestFilter {

    private static final String CORRELATION_ID_HEADER = "X-Correlation-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String correlationId = request.getHeader(CORRELATION_ID_HEADER);
        if (correlationId == null || correlationId.isEmpty()) {
            correlationId = UUID.randomUUID().toString();
        }

        MDC.put("correlationId", correlationId);
        response.setHeader(CORRELATION_ID_HEADER, correlationId);

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("correlationId");
        }
    }
}
```

Propagating the correlation ID through MDC means every log line emitted during the request automatically carries the identifier—no need to pass it manually to every logger call. The `finally` block that clears MDC is essential to prevent context leaking between requests in shared-thread environments.

### 3. Define Service Level Objectives

Use all three pillars to define SLOs:
- **Latency metrics** to measure response times
- **Error logs** to track failure rates
- **Traces** to diagnose SLO violations

---

## Common Mistakes

### Mistake 1: Only Using One Pillar

```java
// WRONG: Relying only on logs
public class OnlyLogsService {
    private static final Logger log = LoggerFactory.getLogger(OnlyLogsService.class);

    public User getUser(Long id) {
        long start = System.currentTimeMillis();
        User user = userRepository.findById(id).orElse(null);
        log.info("getUser took {}ms", System.currentTimeMillis() - start);
        return user;
        // Cannot alert on this consistently
        // Cannot correlate with upstream calls
        // Cannot see historical trends
    }
}
```

Counting on log parsing alone for performance data is fragile—logs can be dropped, sampled, or their format changed without notice, breaking any alerting that depends on text pattern matching. Metrics and traces provide lossless aggregation and structural context that text parsing cannot match.

```java
// CORRECT: Use all three pillars
@Observable
public class CorrectService {
    public User getUser(Long id) {
        return userRepository.findById(id).orElse(null);
        // Metrics track latency automatically
        // Logs capture failures
        // Traces show the full request path
    }
}
```

### Mistake 2: Logging Without Structure

```java
// WRONG: Unstructured log messages
log.info("User " + userId + " created order " + orderId + " at " + System.currentTimeMillis());

// CORRECT: Structured logging
log.info("Order created: userId={}, orderId={}, timestamp={}",
    userId, orderId, Instant.now());
```

### Mistake 3: Over-Instrumentation

```java
// WRONG: Logging at DEBUG in production with high-cardinality data
log.debug("User object: {}", user); // User has 50 fields, logged 1000x/second

// CORRECT: Selective instrumentation
log.info("User created: id={}, email={}", user.getId(), user.getEmail());
```

---

## Summary

The three pillars of observability—logs, metrics, and traces—each provide essential but incomplete visibility. Logs tell detailed stories about specific events. Metrics provide aggregated trends over time. Traces map request flow across distributed systems.

Effective observability requires:
1. Structured, machine-parseable logging
2. Business-relevant metrics with proper cardinality
3. End-to-end distributed tracing
4. Correlation IDs bridging all three pillars
5. Instrumentation as a first-class feature

---

## References

- [Google SRE Book - Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Honeycomb - Observability 101](https://www.honeycomb.io/observability)
- [Martin Fowler - Observability](https://martinfowler.com/articles/domain-oriented-observability.html)

Happy Coding
