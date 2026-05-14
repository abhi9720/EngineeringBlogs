---
title: "Structured Logging with Logstash Encoder"
description: "Implement structured logging using Logstash encoder, JSON formatting, and ELK-compatible log output"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - logging
  - logstash
  - structured-logging
coverImage: "/images/structured-logging.png"
draft: false
---

# Structured Logging with Logstash Encoder

## Overview

Structured logging outputs log events in a machine-parseable format like JSON, enabling automated analysis, alerting, and correlation. The Logstash encoder transforms standard log entries into structured JSON objects that Elasticsearch can index and Kibana can visualize.

### Why Structured Logging?

- **Unstructured**: `2026-05-11 10:30:00 ERROR User 123 failed to process order 456`
- **Structured**: `{"timestamp":"2026-05-11T10:30:00Z","level":"ERROR","message":"Order processing failed","userId":123,"orderId":456,"duration":2345}`

Structured logs are searchable, filterable, and aggregatable without parsing.

---

## Logstash Encoder Setup

### Maven Dependencies

```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

### Logback Configuration

```xml
<!-- logback-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <springProperty name="appName" source="spring.application.name" defaultValue="unknown"/>
    <springProperty name="environment" source="spring.profiles.active" defaultValue="development"/>

    <appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <includeContext>false</includeContext>
            <customFields>{"service":"${appName}","env":"${environment}"}</customFields>
            <fieldNames>
                <timestamp>@timestamp</timestamp>
                <level>severity</level>
                <logger>logger</logger>
                <thread>thread</thread>
                <message>message</message>
                <mdc>context</mdc>
            </fieldNames>
        </encoder>
    </appender>

    <appender name="ASYNC_JSON" class="ch.qos.logback.classic.AsyncAppender">
        <appender-ref ref="JSON_CONSOLE"/>
        <queueSize>1024</queueSize>
        <discardingThreshold>0</discardingThreshold>
        <neverBlock>true</neverBlock>
    </appender>

    <root level="INFO">
        <appender-ref ref="ASYNC_JSON"/>
    </root>
</configuration>
```

The `customFields` element injects fixed metadata (service name, environment) into every JSON log event without the application knowing about them. The `fieldNames` block remaps Logback's default field names to Elastic Common Schema-compatible names—`@timestamp` instead of `timestamp`, `severity` instead of `level`. This mapping is essential when feeding logs into Elasticsearch with ECS-formatted index templates.

### Programmatic Configuration

```java
@Configuration
public class LoggingConfig {

    @Bean
    public LogstashEncoder logstashEncoder() {
        LogstashEncoder encoder = new LogstashEncoder();
        Map<String, String> customFields = new HashMap<>();
        customFields.put("service", "order-service");
        customFields.put("environment", "production");
        customFields.put("version", "2.1.0");

        encoder.setCustomFields(new ObjectMapper().writeValueAsString(customFields));
        encoder.setIncludeContext(false);
        encoder.setFieldNames(getFieldNames());

        return encoder;
    }

    private CustomFields getFieldNames() {
        CustomFields fields = new CustomFields();
        fields.setTimestamp("@timestamp");
        fields.setLevel("severity");
        fields.setMessage("message");
        return fields;
    }
}
```

The programmatic equivalent provides the same configuration outside XML. The `version` field in custom fields is particularly useful—it allows operators to search for logs from a specific application version when investigating a regression.

---

## Adding Structured Context

### Using MDC (Mapped Diagnostic Context)

```java
@Service
public class StructuredLoggingService {

    private static final Logger log = LoggerFactory.getLogger(StructuredLoggingService.class);

    public Order createOrder(OrderRequest request) {
        MDC.put("requestId", request.id().toString());
        MDC.put("customerId", request.customerId().toString());

        try {
            log.info("Starting order creation");

            Order order = new Order(request);
            orderRepository.save(order);

            MDC.put("orderId", order.getId().toString());
            log.info("Order created successfully, total={}", order.getTotal());

            return order;
        } catch (Exception e) {
            log.error("Order creation failed", e);
            throw e;
        } finally {
            MDC.clear();
        }
    }
}
```

MDC values are automatically included in the JSON output as a nested `context` object (as mapped in the `fieldNames` block). The `finally` block with `MDC.clear()` is critical: without it, the `requestId` from a previous request could leak into the log entries of a subsequent request on the same thread, making the log search yield incorrect results.

### Structured Arguments

```java
@Service
public class StructuredArgsService {

    private static final Logger log = LoggerFactory.getLogger(StructuredArgsService.class);

    public void processPayment(Payment payment) {
        // Structured arguments appear as separate JSON fields
        log.info("Processing payment: amount={}, currency={}, method={}",
            payment.getAmount(),
            payment.getCurrency(),
            payment.getMethod());

        // The JSON output:
        // {"message":"Processing payment",
        //  "amount":99.99,
        //  "currency":"USD",
        //  "method":"credit_card"}
    }
}
```

The Logstash encoder recognizes SLF4J parameterized arguments and promotes them to top-level JSON fields. The message string itself becomes a `message` field, and each `{}` placeholder becomes a named field derived from the message text. This gives every structured field its own Elasticsearch mapping type—numeric fields become `long` or `double`, enabling aggregation queries.

---

## Custom Structured Fields

### Adding JSON Fields

```java
@Service
public class CustomFieldsService {

    private static final Logger log = LoggerFactory.getLogger(CustomFieldsService.class);

    public void shipOrder(ShippingRequest request) {
        // Using markers to add JSON fields
        StructuredArguments fields = StructuredArguments.fields(
            StructuredArguments.keyValue("orderId", request.orderId()),
            StructuredArguments.keyValue("address", request.shippingAddress()),
            StructuredArguments.keyValue("carrier", request.carrier()),
            StructuredArguments.keyValue("estimatedDays", request.estimatedDeliveryDays())
        );

        log.info("Shipping order initiated", fields);
    }
}
```

### Object Serialization

```java
public class OrderEvent {
    private Long orderId;
    private String status;
    private BigDecimal total;
    private List<LineItem> items;

    // Jackson annotations for serialization control
    @JsonProperty("order_id")
    public Long getOrderId() { return orderId; }

    @JsonFormat(shape = JsonFormat.Shape.STRING)
    public BigDecimal getTotal() { return total; }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public List<LineItem> getItems() { return items; }
}

@Service
public class EventLoggingService {

    private static final Logger eventLog = LoggerFactory.getLogger("business-events");

    public void logOrderEvent(OrderEvent event) {
        eventLog.info("{}", StructuredArguments.value("event", event));
    }
}
```

Using a dedicated logger named `business-events` allows the logging framework to route business events differently—for example, sending them to a separate Elasticsearch index or to an audit data stream. The `StructuredArguments.value` serializes the `OrderEvent` object via Jackson into the JSON output, giving each field its own indexable column in Elasticsearch.

---

## Async Logging for Performance

### Configuration

```xml
<appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
    <appender-ref ref="JSON_CONSOLE"/>
    <!-- Never discard logs -->
    <discardingThreshold>0</discardingThreshold>
    <!-- Never block the application thread -->
    <neverBlock>true</neverBlock>
    <!-- Queue size -->
    <queueSize>2048</queueSize>
    <!-- Max flush time -->
    <maxFlushTime>1000</maxFlushTime>
</appender>
```

### Performance Comparison

```java
@Benchmark
public void syncLogging() {
    log.info("Synchronous log message: {}", someData);
    // Blocks until log is written: ~500ns per call
}

@Benchmark
public void asyncLogging() {
    asyncLog.info("Asynchronous log message: {}", someData);
    // Returns immediately: ~50ns per call
}
```

---

## Logstash Encoder Features

### Masking Sensitive Data

```xml
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <jsonGeneratorDecorator class="net.logstash.logback.decorate.CompositeJsonGeneratorDecorator">
        <decorators>
            <decorator class="net.logstash.logback.mask.MaskingJsonGeneratorDecorator">
                <defaultMask>****</defaultMask>
                <path>password</path>
                <path>creditCardNumber</path>
                <path>ssn</path>
                <path>securityCode</path>
            </decorator>
        </decorators>
    </jsonGeneratorDecorator>
</encoder>
```

Data masking is applied at the JSON serialization level—before the log event ever reaches the output stream. Fields matching the specified paths are replaced with `****`, preventing passwords and credit card numbers from appearing in log files. This is far more reliable than relying on developers to avoid logging sensitive data, and it satisfies PCI-DSS and SOC2 requirements for log data handling.

### Include Caller Information

```xml
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
    <includeCallerInfo>true</includeCallerInfo>
    <callerInfoFieldName>caller</callerInfoFieldName>
</encoder>
```

---

## Best Practices

### 1. Consistent Field Naming

```java
// Use consistent field names across all services
public class LogFields {
    public static final String REQUEST_ID = "request_id";
    public static final String CORRELATION_ID = "correlation_id";
    public static final String USER_ID = "user_id";
    public static final String DURATION_MS = "duration_ms";
    public static final String ERROR_TYPE = "error_type";
}
```

### 2. Log Business Events, Not Implementation Details

```java
// WRONG: Implementation-focused logging
for (int i = 0; i < 5; i++) {
    log.debug("Processing chunk {}", i);
}

// CORRECT: Business-focused logging
log.info("Order processed: orderId={}, items={}, total={}",
    order.getId(), order.getItemCount(), order.getTotal());
```

### 3. Set Appropriate Log Levels

```java
// ERROR: System is broken
log.error("Database connection failed: {}", error.getMessage(), error);

// WARN: Something unexpected but recoverable
log.warn("Rate limit exceeded for customer: {}, retrying", customerId);

// INFO: Important business event
log.info("Payment processed: transactionId={}, amount={}", txId, amount);

// DEBUG: Detailed diagnostics (off by default in production)
log.debug("Cache lookup: key={}, found={}", cacheKey, cached != null);
```

---

## Common Mistakes

### Mistake 1: String Concatenation in Log Messages

```java
// WRONG: String concatenation (always evaluated)
log.debug("User " + userId + " logged in from " + ipAddress);

// CORRECT: Parameterized logging (only evaluated if DEBUG is enabled)
log.debug("User login: userId={}, ip={}", userId, ipAddress);
```

### Mistake 2: Logging Sensitive Information

```java
// WRONG: Password in logs
log.info("User registration: email={}, password={}", email, password);

// CORRECT: Mask sensitive fields
log.info("User registration: email={}", email);
```

### Mistake 3: Inconsistent Field Names

```java
// WRONG: Different naming in different services
// Service A: user_id
// Service B: userId
// Service C: customerId

// CORRECT: Consistent naming convention
// All services: user_id
```

### Mistake 4: Logging Too Much in Hot Paths

```java
// WRONG: Logging on every request in a high-throughput endpoint
for (Product p : products) {
    log.debug("Processing product: {} with price {}", p.getId(), p.getPrice());
}

// CORRECT: Log at a higher level or aggregate
log.info("Processing batch: {} products, category={}", products.size(), category);
```

---

## Summary

Structured logging with Logstash encoder transforms log data from text to structured JSON:

1. Logstash encoder produces Elasticsearch-compatible JSON
2. MDC and structured arguments add context to log events
3. Async logging prevents performance degradation
4. Consistent field naming enables cross-service correlation
5. Configure masking to protect sensitive data
6. Log business events, not implementation details

---

## References

- [Logstash Logback Encoder Documentation](https://github.com/logstash/logstash-logback-encoder)
- [Logback Documentation](https://logback.qos.ch/documentation.html)
- [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html)
- [Structured Logging in Java](https://www.baeldung.com/java-structured-logging)

Happy Coding
