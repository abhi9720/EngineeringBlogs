---
title: Spring Boot Actuator
description: >-
  Master Spring Boot Actuator: production-ready endpoints, health indicators,
  metrics, custom endpoints, and securing actuator endpoints
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - actuator
  - monitoring
  - observability
coverImage: /images/spring-actuator.png
draft: false
order: 30
---
## Overview

Spring Boot Actuator provides production-ready monitoring and management capabilities for your application. It exposes operational information via HTTP endpoints and JMX MBeans, including health checks, metrics, environment properties, thread dumps, and more.

Actuator is the foundation of observability in Spring Boot. Combined with Micrometer (the metrics facade), it integrates with Prometheus, Datadog, New Relic, and dozens of other monitoring systems. Without Actuator, operations teams have no insight into application health, performance, or configuration in production.

## Enabling Actuator

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

```yaml
# Expose all endpoints over HTTP
management:
  endpoints:
    web:
      exposure:
        include: "*"
      base-path: /internal/actuator
  server:
    port: 8081
  endpoint:
    health:
      show-details: always
      show-components: always
```

## Core Endpoints

### Health Endpoint

The `/health` endpoint aggregates the health of all dependencies. Each `HealthIndicator` returns either UP, DOWN, or DEGRADED. The overall status is the most severe of all components. A database that can't be reached causes the overall status to be DOWN, which load balancers detect and stop routing traffic to this instance.

The example below shows a healthy application with PostgreSQL, Redis, and general system health all reporting UP. The `show-details: always` setting exposes component details. In production, use `show-details: when-authorized` to protect infrastructure details.

```yaml
# /internal/actuator/health
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": {
        "database": "PostgreSQL",
        "validationQuery": "SELECT 1"
      }
    },
    "diskSpace": {
      "status": "UP",
      "details": {
        "total": 499963174912,
        "free": 213428346880,
        "threshold": 10485760
      }
    },
    "ping": {
      "status": "UP"
    },
    "redis": {
      "status": "UP",
      "details": {
        "version": "7.0.12"
      }
    }
  }
}
```

### Custom Health Indicator

Custom health indicators let you report the health of application-specific dependencies like external APIs, message queues, or proprietary services. Implement `HealthIndicator` and return `Health.up()` or `Health.down()` based on the dependency's status.

The `ExternalApiHealthIndicator` below pings an external API's health endpoint. If the response is 2xx, the indicator reports UP with response time details. On failure, it reports DOWN with the status code and error message. The `responseTime` metric helps ops teams detect slow external dependencies before they cause user-facing problems.

```java
@Component
public class ExternalApiHealthIndicator implements HealthIndicator {
    private final RestTemplate restTemplate;
    private final String healthUrl;

    public ExternalApiHealthIndicator(RestTemplateBuilder builder,
                                     @Value("${app.external.api.url}") String apiUrl) {
        this.restTemplate = builder.build();
        this.healthUrl = apiUrl + "/health";
    }

    @Override
    public Health health() {
        try {
            ResponseEntity<String> response = restTemplate.getForEntity(healthUrl, String.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                return Health.up()
                    .withDetail("url", healthUrl)
                    .withDetail("responseTime", measureResponseTime())
                    .build();
            }
            return Health.down()
                .withDetail("url", healthUrl)
                .withDetail("statusCode", response.getStatusCodeValue())
                .build();
        } catch (Exception e) {
            return Health.down(e)
                .withDetail("url", healthUrl)
                .build();
        }
    }

    private long measureResponseTime() {
        long start = System.currentTimeMillis();
        restTemplate.getForEntity(healthUrl, String.class);
        return System.currentTimeMillis() - start;
    }
}
```

### Composite Health Indicator

A `HealthAggregator` determines the overall health status from multiple component healths. The default aggregator uses the least healthy status (e.g., if any component is DOWN, the overall status is DOWN). Custom aggregators can implement more nuanced logic, like a `DEGRADED` status when fewer than half of components are down.

```java
@Component
public class DatabaseHealthAggregator implements HealthAggregator {
    @Override
    public Health aggregate(Map<String, Health> healths) {
        long downCount = healths.values().stream()
            .filter(h -> !Status.UP.equals(h.getStatus()))
            .count();

        if (downCount == 0) {
            return Health.up().build();
        }
        if (downCount <= healths.size() / 2) {
            return Health.status("DEGRADED")
                .withDetail("downComponents", downCount)
                .withDetail("totalComponents", healths.size())
                .build();
        }
        return Health.down()
            .withDetail("downComponents", downCount)
            .withDetail("totalComponents", healths.size())
            .build();
    }
}
```

### Info Endpoint

The `/info` endpoint exposes arbitrary application metadata. Use `InfoContributor` beans to add build version, Git commit, Java version, and environment information. This is invaluable for verifying which version of a service is deployed across environments.

```java
@Component
public class BuildInfoContributor implements InfoContributor {
    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("build", Map.of(
            "version", "1.0.0",
            "timestamp", Instant.now().toString(),
            "java", Runtime.version().toString()
        ));
    }
}

@Component
public class GitInfoContributor implements InfoContributor {
    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("git", Map.of(
            "branch", "main",
            "commit", "a1b2c3d4e5f6",
            "tag", "v1.2.3"
        ));
    }
}
```

```yaml
# /internal/actuator/info
{
  "build": {
    "version": "1.0.0",
    "timestamp": "2026-05-11T10:00:00Z",
    "java": "17.0.9+9"
  },
  "git": {
    "branch": "main",
    "commit": "a1b2c3d4e5f6",
    "tag": "v1.2.3"
  }
}
```

### Metrics Endpoint

The `/metrics` endpoint exposes all registered Micrometer metrics. The root endpoint lists available metric names. Individual metric endpoints (e.g., `/metrics/http.server.requests`) show measurements and available tags for drill-down.

The `http.server.requests` metric is one of the most useful: it shows request count, total time, and maximum time, filtered by URI, status, and method. A sudden increase in 5xx responses or a spike in response time identifies problems immediately.

```yaml
# /internal/actuator/metrics
{
  "names": [
    "jvm.memory.used",
    "jvm.memory.max",
    "jvm.gc.pause",
    "http.server.requests",
    "jdbc.connections.active",
    "cache.gets",
    "logback.events",
    "system.cpu.usage",
    "process.start.time"
  ]
}

# /internal/actuator/metrics/http.server.requests
{
  "name": "http.server.requests",
  "measurements": [
    { "statistic": "COUNT", "value": 1042 },
    { "statistic": "TOTAL_TIME", "value": 45.823 },
    { "statistic": "MAX", "value": 2.345 }
  ],
  "availableTags": [
    { "tag": "uri", "values": ["/api/users", "/api/orders", "/actuator/health"] },
    { "tag": "status", "values": ["200", "201", "400", "500"] },
    { "tag": "method", "values": ["GET", "POST", "PUT", "DELETE"] }
  ]
}
```

### Custom Metrics

Micrometer provides four core metric types: `Counter` (incrementing count), `Timer` (duration distribution), `DistributionSummary` (value distribution), and `Gauge` (point-in-time value). The `OrderMetrics` component below uses all four to track order processing.

`Timer` records request latency with percentile distributions (`p50`, `p95`, `p99`) that reveal tail latency. `Gauge` for pending orders lets ops teams monitor queue depth. PublishPercentiles enables accurate SLO tracking without storing raw data.

```java
@Component
public class OrderMetrics {
    private final MeterRegistry meterRegistry;
    private final Counter orderCreatedCounter;
    private final Timer orderProcessingTimer;
    private final DistributionSummary orderValueSummary;
    private final Gauge pendingOrdersGauge;

    public OrderMetrics(MeterRegistry meterRegistry,
                       OrderRepository orderRepository) {
        this.meterRegistry = meterRegistry;

        this.orderCreatedCounter = Counter.builder("orders.created")
            .description("Number of orders created")
            .register(meterRegistry);

        this.orderProcessingTimer = Timer.builder("orders.processing.time")
            .description("Time taken to process orders")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(meterRegistry);

        this.orderValueSummary = DistributionSummary.builder("orders.value")
            .description("Distribution of order values")
            .baseUnit("USD")
            .publishPercentiles(0.5, 0.75, 0.95)
            .register(meterRegistry);

        this.pendingOrdersGauge = Gauge.builder("orders.pending", orderRepository,
                OrderRepository::countPendingOrders)
            .description("Number of pending orders")
            .register(meterRegistry);
    }

    public void recordOrderCreated() {
        orderCreatedCounter.increment();
    }

    public <T> T measureOrderProcessing(Supplier<T> supplier) {
        return orderProcessingTimer.record(supplier);
    }

    public void recordOrderValue(BigDecimal value) {
        orderValueSummary.record(value.doubleValue());
    }
}
```

### Environment Endpoint

The `/env` endpoint exposes all property sources and their values. This is invaluable for debugging configuration issues: you can verify which property source provided a particular value and check for typos or incorrect overrides.

Sensitive values like passwords and connection strings are automatically masked with `***` in the response. The `show-values` setting controls whether values are visible at all. In production, set `show-values: never` for `env` and `configprops` endpoints.

```yaml
# /internal/actuator/env
{
  "activeProfiles": ["prod", "us-east"],
  "propertySources": [
    { "name": "systemEnvironment", "properties": { "JAVA_HOME": { "value": "***" } } },
    { "name": "application.yml", "properties": { "server.port": { "value": "8080" } } }
  ]
}
```

### Thread Dump Endpoint

The `/threaddump` endpoint captures the current state of all application threads. Thread dumps are essential for diagnosing deadlocks, thread starvation, and long-running requests. The response shows each thread's name, ID, state, and stack trace.

Analyzing thread dumps over time can reveal patterns: an increasing number of `BLOCKED` threads suggests lock contention, while growing `WAITING` threads may indicate a connection pool or thread pool that's undersized.

```yaml
# /internal/actuator/threaddump
{
  "threads": [
    {
      "threadName": "http-nio-8080-exec-1",
      "threadId": 42,
      "blockedTime": -1,
      "blockedCount": 0,
      "waitedTime": -1,
      "waitedCount": 0,
      "lockName": null,
      "lockOwnerId": -1,
      "lockOwnerName": null,
      "lockName": null,
      "stackTrace": [
        {
          "methodName": "doFilter",
          "fileName": "ApplicationFilterChain.java",
          "lineNumber": 166
        }
      ]
    }
  ]
}
```

## Custom Endpoints

### @Endpoint Annotation

Custom endpoints use `@Endpoint` with the `id` that defines the URL path. Operations are annotated with `@ReadOperation` (GET), `@WriteOperation` (POST), or `@DeleteOperation` (DELETE). The `@Selector` annotation maps path variables.

The `FeatureFlagsEndpoint` below provides a dynamic feature flag system that can be queried and updated at runtime without redeployment. This enables canary deployments, A/B testing, and emergency feature toggles.

```java
@Endpoint(id = "feature-flags")
@Component
public class FeatureFlagsEndpoint {
    private final Map<String, Boolean> features = new ConcurrentHashMap<>();

    public FeatureFlagsEndpoint() {
        features.put("new-checkout", true);
        features.put("dark-mode", false);
        features.put("beta-reports", true);
    }

    @ReadOperation
    public Map<String, Boolean> allFeatures() {
        return Map.copyOf(features);
    }

    @ReadOperation
    public Boolean getFeature(@Selector String name) {
        return features.get(name);
    }

    @WriteOperation
    public void setFeature(@Selector String name, boolean value) {
        features.put(name, value);
    }

    @DeleteOperation
    public void deleteFeature(@Selector String name) {
        features.remove(name);
    }
}
```

### @WebEndpoint (HTTP only)

Use `@WebEndpoint` when you want an endpoint to be available only over HTTP, not JMX. This is useful for endpoints that return HTML or have web-specific logic. The `SystemInfoEndpoint` below exposes system properties that are relevant for web-based monitoring consoles.

```java
@WebEndpoint(id = "system-info")
@Component
public class SystemInfoEndpoint {
    @ReadOperation
    public Map<String, Object> systemInfo() {
        return Map.of(
            "os", System.getProperty("os.name"),
            "arch", System.getProperty("os.arch"),
            "cpus", Runtime.getRuntime().availableProcessors(),
            "memory", Runtime.getRuntime().totalMemory(),
            "freeMemory", Runtime.getRuntime().freeMemory()
        );
    }

    @ReadOperation
    public Map<String, String> javaProperties() {
        return Map.of(
            "java.version", System.getProperty("java.version"),
            "java.vm.name", System.getProperty("java.vm.name"),
            "java.vm.vendor", System.getProperty("java.vm.vendor")
        );
    }
}
```

### @JmxEndpoint (JMX only)

`@JmxEndpoint` creates endpoints visible only through JMX, not HTTP. JMX is useful for operations that shouldn't be exposed over the network, such as cache eviction or log level changes. The `CacheManagementEndpoint` below lets operators clear caches via JConsole or other JMX clients.

```java
@JmxEndpoint(id = "cache-management")
@Component
public class CacheManagementEndpoint {
    private final CacheManager cacheManager;

    public CacheManagementEndpoint(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    @ReadOperation
    public List<String> cacheNames() {
        return cacheManager.getCacheNames().stream().toList();
    }

    @WriteOperation
    public void evictCache(String cacheName) {
        Cache cache = cacheManager.getCache(cacheName);
        if (cache != null) {
            cache.clear();
        }
    }
}
```

## Securing Actuator Endpoints

### Role-Based Access

Actuator endpoints expose sensitive information and should be secured. The configuration below permits unauthenticated access to `/health` and `/info` (needed by load balancers and monitoring systems) while restricting `/metrics`, `/env`, and other endpoints to users with the `ACTUATOR_ADMIN` role.

Use a separate security filter chain for actuator paths to avoid conflicts with your main application security configuration. The `securityMatcher` method restricts this chain to `/internal/actuator/**` only.

```java
@Configuration
@ConditionalOnClass(WebSecurityConfigurerAdapter.class)
public class ActuatorSecurityConfig {

    @Bean
    public SecurityFilterChain actuatorFilterChain(HttpSecurity http) throws Exception {
        http.securityMatcher("/internal/actuator/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/internal/actuator/health").permitAll()
                .requestMatchers("/internal/actuator/info").permitAll()
                .requestMatchers("/internal/actuator/metrics").hasRole("ADMIN")
                .requestMatchers("/internal/actuator/env").hasRole("ADMIN")
                .requestMatchers("/internal/actuator/**").hasRole("ACTUATOR_ADMIN")
            )
            .httpBasic(withDefaults())
            .csrf(csrf -> csrf.disable());
        return http.build();
    }
}
```

### Separate Port

Running actuator on a separate port isolates monitoring traffic from application traffic. This prevents accidental exposure of sensitive endpoints to the public internet and makes it easier to apply network-level restrictions (e.g., only allow internal IPs to access port 8081).

```yaml
management:
  server:
    port: 8081
  endpoints:
    web:
      base-path: /actuator
```

## Actuator in Production

A production-ready Actuator configuration should expose only essential endpoints, use a separate management port or path prefix, show health details only to authorized users, hide sensitive property values, and export metrics to an external monitoring system like Prometheus.

The configuration below secures the actuator, enables Prometheus export, and tags all metrics with the application name and environment for aggregation across multiple instances.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
      base-path: /internal/actuator
  endpoint:
    health:
      show-details: when-authorized
    env:
      show-values: never
    configprops:
      show-values: never
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: ${spring.application.name}
      environment: ${spring.profiles.active:default}
```

## Best Practices

1. **Use a separate management port** to isolate actuator traffic
2. **Expose only necessary endpoints** in production
3. **Use role-based access** for sensitive endpoints
4. **Customize health indicators** for your domain-specific dependencies
5. **Tag metrics** with application name and environment for aggregation
6. **Use Micrometer** for vendor-neutral metrics export
7. **Monitor actuator health** from your monitoring system

## Common Mistakes

### Mistake 1: Exposing All Endpoints in Production

```yaml
# Wrong: Exposing everything in production
management:
  endpoints:
    web:
      exposure:
        include: "*"
```

```yaml
# Correct: Selective exposure
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus,liveness,readiness
```

### Mistake 2: Exposing Sensitive Information

```yaml
# Wrong: Showing all environment details
management:
  endpoint:
    env:
      show-values: always
    configprops:
      show-values: always
```

```yaml
# Correct: Hide sensitive values
management:
  endpoint:
    env:
      show-values: never
    configprops:
      show-values: never
```

### Mistake 3: Health Indicator Throwing Exceptions

```java
// Wrong: Health indicator that throws unexpected exceptions
@Component
public class FragileHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        // Throws NullPointerException if service is not available
        return Health.up().withDetail("data", fetchData().toString()).build();
    }
}
```

```java
// Correct: Gracefully handle exceptions
@Component
public class RobustHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        try {
            Object data = fetchData();
            return Health.up().withDetail("data", data).build();
        } catch (Exception e) {
            return Health.down(e).withDetail("error", e.getMessage()).build();
        }
    }
}
```

## Summary

Spring Boot Actuator provides production-ready monitoring with health checks, metrics, environment inspection, and custom endpoints. Use it with proper security configuration, expose only necessary endpoints, and customize health indicators for your application's specific dependencies. Integrate with Micrometer for metrics export to monitoring systems.

## References

- [Spring Boot Actuator Documentation](https://docs.spring.io/spring-boot/reference/actuator.html)
- [Actuator Endpoints](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
- [Micrometer Metrics](https://micrometer.io/docs)
- [Production-Ready Features](https://docs.spring.io/spring-boot/reference/actuator/production-ready.html)

Happy Coding
