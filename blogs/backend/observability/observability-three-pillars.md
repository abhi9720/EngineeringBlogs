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