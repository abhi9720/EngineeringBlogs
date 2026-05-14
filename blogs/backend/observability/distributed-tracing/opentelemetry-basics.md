---
title: "OpenTelemetry Basics"
description: "Implement distributed tracing with OpenTelemetry: spans, traces, context propagation, and integration with backends"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - tracing
  - opentelemetry
  - distributed-tracing
coverImage: "/images/opentelemetry-basics.png"
draft: false
---

# OpenTelemetry Basics

## Overview

OpenTelemetry is the industry standard for distributed tracing, providing APIs and SDKs for generating, collecting, and exporting telemetry data. It replaces proprietary agents with a unified instrumentation standard.

### Key Concepts

- **Trace**: End-to-end view of a request across services
- **Span**: A single unit of work within a trace
- **Span Context**: Identifying information for a span
- **Propagation**: Passing context between services

---

## Setting Up OpenTelemetry

### Maven Dependencies

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-sdk</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-spring-boot-starter</artifactId>
    <version>2.2.0</version>
</dependency>
```

### Application Configuration

```yaml
# application.yml
otel:
  service:
    name: order-service
    instance.id: ${HOSTNAME:local}
  traces:
    exporter: otlp
    sampler: parentbased_always_on
  exporter:
    otlp:
      endpoint: http://otel-collector:4317
      protocol: grpc
      timeout: 10s
      headers:
        api-key: ${OTEL_API_KEY}
  resource:
    attributes:
      environment: production
      region: us-east-1
```

### Programmatic Setup

```java
@Configuration
public class OpenTelemetryConfig {

    @Bean
    public OpenTelemetry openTelemetry() {
        Resource resource = Resource.getDefault()
            .toBuilder()
            .put(ResourceAttributes.SERVICE_NAME, "order-service")
            .put(ResourceAttributes.DEPLOYMENT_ENVIRONMENT, "production")
            .build();

        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
            .setResource(resource)
            .setSampler(Sampler.alwaysOn())
            .addSpanProcessor(BatchSpanProcessor.builder(
                OtlpGrpcSpanExporter.builder()
                    .setEndpoint("http://otel-collector:4317")
                    .setTimeout(Duration.ofSeconds(10))
                    .build()
            ).setMaxExportBatchSize(512)
             .setExporterTimeout(Duration.ofSeconds(30))
             .build())
            .build();

        SdkMeterProvider meterProvider = SdkMeterProvider.builder()
            .setResource(resource)
            .build();

        return OpenTelemetrySdk.builder()
            .setTracerProvider(tracerProvider)
            .setMeterProvider(meterProvider)
            .buildAndRegisterGlobal();
    }
}
```

---

## Creating Spans

### Manual Instrumentation

```java
@Service
public class OrderTracingService {

    private final Tracer tracer;

    public OrderTracingService(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer("order-service", "1.0.0");
    }

    public Order createOrder(OrderRequest request) {
        Span span = tracer.spanBuilder("order.create")
            .setSpanKind(SpanKind.SERVER)
            .setAttribute("request.id", request.id().toString())
            .setAttribute("customer.id", request.customerId().toString())
            .setAttribute("item.count", request.items().size())
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            validateRequest(request);
            Order order = processOrder(request);
            span.setAttribute("order.id", order.getId().toString());
            span.setAttribute("order.total", order.getTotal().doubleValue());
            span.setStatus(StatusCode.OK);
            return order;
        } catch (Exception e) {
            span.setStatus(StatusCode.ERROR, e.getMessage());
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }

    @WithSpan("order.validate")
    public void validateRequest(OrderRequest request) {
        Span span = Span.current();
        span.addEvent("Validation started");

        if (request.items().isEmpty()) {
            span.setAttribute("validation.error", "empty cart");
            throw new ValidationException("Cart is empty");
        }

        span.addEvent("Validation completed");
    }
}
```

### Automatic Instrumentation

```java
// With OpenTelemetry agent, these are automatically traced:
@RestController
public class OrderController {

    @PostMapping("/api/orders")
    public Order createOrder(@RequestBody OrderRequest request) {
        // Automatically creates a span for this HTTP request
        return orderService.createOrder(request);
    }
}

@Service
public class OrderRepository {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    public Order findById(Long id) {
        // Automatically creates a span for this database call
        return jdbcTemplate.queryForObject(
            "SELECT * FROM orders WHERE id = ?",
            new BeanPropertyRowMapper<>(Order.class), id);
    }
}
```

---

## Span Attributes and Events

### Adding Attributes

```java
Span span = Span.current();

// Primitive attributes
span.setAttribute("order.id", 12345L);
span.setAttribute("order.total", 99.99);
span.setAttribute("order.paid", true);
span.setAttribute("customer.email", "user@example.com");

// Array attributes
span.setAttribute("item.ids", new long[]{1L, 2L, 3L});
span.setAttribute("item.names", new String[]{"shirt", "pants"});
```

### Adding Events

```java
@Service
public class EventfulService {

    public void process(Long orderId) {
        Span span = Span.current();

        span.addEvent("Processing started",
            Attributes.of(
                AttributeKey.stringKey("order.id"), orderId.toString()
            ));

        try {
            Thread.sleep(100);
            span.addEvent("Inventory check passed");
            Thread.sleep(200);
            span.addEvent("Payment processed");
        } catch (Exception e) {
            span.addEvent("Processing failed",
                Attributes.of(
                    AttributeKey.stringKey("error"), e.getMessage()
                ));
            span.recordException(e);
        }

        span.addEvent("Processing completed");
    }
}
```

---

## Context Propagation

### Manual Propagation

```java
@Service
public class PropagationService {

    private final Tracer tracer;
    private final RestTemplate restTemplate;

    public void callDownstreamService() {
        Span span = tracer.spanBuilder("call.downstream")
            .setSpanKind(SpanKind.CLIENT)
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            // Inject context into HTTP headers
            HttpHeaders headers = new HttpHeaders();
            OpenTelemetryRestTemplatePublisher.inject(
                span.getSpanContext(), headers::add);

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            restTemplate.exchange(
                "http://payment-service/api/process",
                HttpMethod.POST, entity, String.class);
        } finally {
            span.end();
        }
    }
}

// Context extraction on receiving side
@Component
public class TracingInterceptor extends HandlerInterceptorAdapter {

    private final Tracer tracer;

    @Override
    public boolean preHandle(HttpServletRequest request,
            HttpServletResponse response, Object handler) {

        // Extract propagated context
        Context extracted = OpenTelemetryRestTemplatePublisher.extract(
            request::getHeader);

        Span span = tracer.spanBuilder("received.request")
            .setParent(extracted)
            .setSpanKind(SpanKind.SERVER)
            .startSpan();

        span.makeCurrent();
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
            HttpServletResponse response, Object handler, Exception ex) {
        Span.current().end();
    }
}
```

### W3C Trace Context

```java
// OpenTelemetry uses W3C Trace-Context by default
// Trace ID propagated via headers:
// traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
// tracestate: congo=t61rcWkgMzE

public class W3CPropagationExample {

    public void parseTraceParent(String traceparent) {
        // Format: version-traceId-spanId-traceFlags
        String[] parts = traceparent.split("-");
        String version = parts[0];     // 00
        String traceId = parts[1];     // 0af7651916cd43dd8448eb211c80319c
        String spanId = parts[2];      // b7ad6b7169203331
        String traceFlags = parts[3];  // 01 (sampled)
    }
}
```

---

## OpenTelemetry Collector

### Collector Configuration

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
  attributes:
    actions:
      - key: environment
        value: production
        action: upsert

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  prometheus:
    endpoint: 0.0.0.0:8889
  logging:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [jaeger, logging]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

---

## Best Practices

### 1. Set Span Status Properly

```java
// CORRECT: Set status based on outcome
Span span = tracer.spanBuilder("operation").startSpan();
try {
    Object result = doWork();
    span.setStatus(StatusCode.OK);
    return result;
} catch (Exception e) {
    span.setStatus(StatusCode.ERROR, e.getMessage());
    span.recordException(e);
    throw e;
} finally {
    span.end();
}
```

### 2. Add Relevant Attributes

```java
// Good attributes: business context, service names, error codes
span.setAttribute("order.id", orderId);
span.setAttribute("customer.tier", customer.getTier());

// Bad attributes: large objects, sensitive data
span.setAttribute("request.body", jsonBody); // Too large
span.setAttribute("user.password", password); // Sensitive
```

---

## Common Mistakes

### Mistake 1: Not Closing Spans

```java
// WRONG: Span never ends
Span span = tracer.spanBuilder("operation").startSpan();
span.makeCurrent();
// ... work done, but span.end() never called

// CORRECT: Always close in finally
Span span = tracer.spanBuilder("operation").startSpan();
try (Scope scope = span.makeCurrent()) {
    // ... work
} finally {
    span.end();
}
```

### Mistake 2: Catching But Not Recording Exceptions

```java
// WRONG: Exception swallowed
try {
    riskyOperation();
} catch (Exception e) {
    // Nothing recorded in span
}

// CORRECT: Record exception in span
try {
    riskyOperation();
} catch (Exception e) {
    Span.current().recordException(e);
    Span.current().setStatus(StatusCode.ERROR);
    throw e; // or handle appropriately
}
```

---

## Summary

OpenTelemetry provides a unified standard for distributed tracing:

1. Spans represent units of work within a trace
2. Context propagation enables end-to-end tracing
3. Attributes and events enrich span data
4. OpenTelemetry Collector processes telemetry data
5. W3C Trace-Context standardizes propagation
6. Auto-instrumentation reduces manual work
7. Always close spans and record exceptions

---

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry Java SDK](https://github.com/open-telemetry/opentelemetry-java)
- [W3C Trace-Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)

Happy Coding