---
title: "Feign Clients Deep Dive"
description: "Master Feign clients for microservice communication: declarative REST clients, Spring Cloud OpenFeign configuration, custom decoders, error handling, load balancing, and resilience patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - feign
  - spring-cloud
  - rest-client
  - microservices
coverImage: "/images/feign-clients-deep-dive.png"
draft: false
---

## Overview

Feign is a declarative HTTP client that simplifies REST API calls between microservices. By writing Java interfaces with annotations, you get automatically implemented HTTP clients with built-in load balancing, circuit breaking, and logging.

## Basic Configuration

### Maven Dependencies

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-circuitbreaker-resilience4j</artifactId>
</dependency>
```

### Enable Feign Clients

```java
@SpringBootApplication
@EnableFeignClients(basePackages = "com.example.clients")
@EnableDiscoveryClient
public class OrderServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderServiceApplication.class, args);
    }
}
```

## Declaring Feign Clients

### Simple Client

```java
@FeignClient(name = "payment-service", url = "${payment.service.url:}")
public interface PaymentServiceClient {

    @PostMapping("/api/payments/process")
    PaymentResponse processPayment(@RequestBody PaymentRequest request);

    @GetMapping("/api/payments/{paymentId}")
    PaymentResponse getPayment(@PathVariable("paymentId") String paymentId);

    @PostMapping("/api/payments/refund")
    RefundResponse refundPayment(@RequestBody RefundRequest request);
}
```

### Client with Fallback

```java
@FeignClient(
    name = "inventory-service",
    fallbackFactory = InventoryClientFallbackFactory.class,
    configuration = InventoryClientConfig.class
)
public interface InventoryServiceClient {

    @GetMapping("/api/inventory/{sku}/availability")
    AvailabilityResponse checkAvailability(
        @PathVariable("sku") String sku,
        @RequestParam("quantity") int quantity
    );

    @PostMapping("/api/inventory/reserve")
    ReservationResponse reserveItems(@RequestBody ReserveRequest request);

    @PostMapping("/api/inventory/release")
    void releaseReservation(@RequestBody ReleaseRequest request);
}

@Component
public class InventoryClientFallbackFactory
        implements FallbackFactory<InventoryServiceClient> {

    @Override
    public InventoryServiceClient create(Throwable cause) {
        log.error("Inventory service unavailable", cause);
        return new InventoryServiceClient() {
            @Override
            public AvailabilityResponse checkAvailability(String sku, int quantity) {
                return AvailabilityResponse.unknown();
            }

            @Override
            public ReservationResponse reserveItems(ReserveRequest request) {
                throw new ServiceUnavailableException("Inventory service unavailable", cause);
            }

            @Override
            public void releaseReservation(ReleaseRequest request) {
                log.warn("Cannot release reservation: inventory service down");
            }
        };
    }
}
```

## Custom Configuration

```java
public class InventoryClientConfig {

    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.FULL;
    }

    @Bean
    public RequestInterceptor requestInterceptor() {
        return requestTemplate -> {
            requestTemplate.header("X-Correlation-Id", UUID.randomUUID().toString());
            requestTemplate.header("X-Source-Service", "order-service");
            requestTemplate.header("Authorization", "Bearer " + getToken());
        };
    }

    @Bean
    public Retryer retryer() {
        return new Retryer.Default(100, 1000, 3);
    }

    @Bean
    public ErrorDecoder errorDecoder() {
        return new InventoryErrorDecoder();
    }

    @Bean
    public Contract feignContract() {
        return new SpringMvcContract();
    }

    private String getToken() {
        return SecurityContextHolder.getContext().getAuthentication()
            .getCredentials().toString();
    }
}
```

## Custom Error Decoder

```java
public class InventoryErrorDecoder implements ErrorDecoder {

    private final ErrorDecoder defaultDecoder = new Default();

    @Override
    public Exception decode(String methodKey, Response response) {
        try {
            if (response.body() != null) {
                String body = Util.toString(response.body().asReader(StandardCharsets.UTF_8));
                ErrorResponse error = objectMapper.readValue(body, ErrorResponse.class);

                return switch (response.status()) {
                    case 400 -> new BadRequestException(error.getMessage());
                    case 404 -> new ResourceNotFoundException(error.getMessage());
                    case 429 -> new RateLimitExceededException(error.getMessage());
                    case 503 -> new ServiceUnavailableException(error.getMessage());
                    default -> new InventoryServiceException(response.status(), error.getMessage());
                };
            }
        } catch (IOException e) {
            log.error("Failed to parse error response", e);
        }

        return defaultDecoder.decode(methodKey, response);
    }
}
```

## Request/Response Interceptors

```java
@Component
public class FeignRequestInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // Add correlation ID
        String correlationId = MDC.get("correlationId");
        if (correlationId != null) {
            template.header("X-Correlation-Id", correlationId);
        }

        // Add trace headers
        template.header("X-B3-TraceId", Span.current().getSpanContext().getTraceId());
        template.header("X-B3-SpanId", Span.current().getSpanContext().getSpanId());

        // Log request details
        log.debug("Feign request: {} {}", template.method(), template.url());
    }
}

@Component
public class FeignResponseInterceptor implements ResponseInterceptor {

    @Override
    public Object intercept(InvocationContext invocationContext) throws Exception {
        Response response = invocationContext.response();
        log.debug("Feign response: {} {}", response.status(),
            response.request().url());
        return invocationContext.proceed();
    }
}
```

## Circuit Breaker Integration

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    instances:
      InventoryServiceClient#checkAvailability:
        register-health-indicator: true
        sliding-window-size: 10
        minimum-number-of-calls: 5
        permitted-number-of-calls-in-half-open-state: 3
        wait-duration-in-open-state: 10s
        failure-rate-threshold: 50
        record-exceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
      PaymentServiceClient#processPayment:
        sliding-window-size: 20
        minimum-number-of-calls: 10
        wait-duration-in-open-state: 30s
        failure-rate-threshold: 40
```

```java
@FeignClient(name = "payment-service",
    circuitBreakerFactory = PaymentCircuitBreakerFactory.class)
public interface PaymentServiceClient {
    // ...
}
```

## Client-Side Load Balancing

```java
@FeignClient(name = "order-service")  // Uses service discovery
public interface OrderServiceClient {

    @GetMapping("/api/orders/{id}")
    OrderResponse getOrder(@PathVariable("id") String id);
}

// With custom load balancer configuration
@Configuration
public class FeignLoadBalancerConfig {

    @Bean
    public LoadBalancerClient loadBalancerClient() {
        return LoadBalancerClients.builder()
            .withDefaults()
            .build()
            .getLoadBalancerClient();
    }

    @Bean
    public FeignBlockingLoadBalancerClient feignBlockingLoadBalancerClient(
            LoadBalancerClient loadBalancerClient) {
        return new FeignBlockingLoadBalancerClient(
            new Client.Default(null, null),
            loadBalancerClient
        );
    }
}
```

## Best Practices

- Always define Feign interfaces in a shared API module or contract library.
- Configure circuit breakers for all Feign clients to handle failures gracefully.
- Use fallback factories (not simple fallbacks) to know why the fallback was triggered.
- Implement custom error decoders for domain-specific error handling.
- Enable compression and logging for debugging.
- Set reasonable timeouts and retry policies per client.

## Common Mistakes

### Mistake: No fallback for Feign clients

```java
// Wrong - no fallback, request throws exception on failure
@FeignClient(name = "payment-service")
public interface PaymentClient { ... }
```

```java
// Correct - fallback factory handles failures
@FeignClient(name = "payment-service", fallbackFactory = PaymentFallbackFactory.class)
public interface PaymentClient { ... }
```

### Mistake: Missing timeout configuration

```java
// Wrong - uses default timeouts, may wait indefinitely
```

```yaml
# Correct - explicit timeouts
feign:
  client:
    config:
      default:
        connect-timeout: 5000
        read-timeout: 10000
      payment-service:
        connect-timeout: 2000
        read-timeout: 5000
```

## Summary

Feign clients simplify inter-service communication in Spring Cloud microservices. With declarative interfaces, built-in load balancing, and integration with Resilience4j circuit breakers, Feign provides a robust foundation for service-to-service REST calls. Always configure fallbacks, timeouts, and custom error handling for production use.

## References

- [Spring Cloud OpenFeign Documentation](https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/)
- [Feign GitHub Repository](https://github.com/OpenFeign/feign)
- [Resilience4j Feign Integration](https://resilience4j.readme.io/docs/feign)

Happy Coding