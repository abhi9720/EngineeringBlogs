---
title: Strangler Fig Pattern for Legacy Migration
description: >-
  Implement the Strangler Fig pattern for incremental migration from monolithic
  to microservices architecture: routing strategies, feature flags, gradual
  decomposition, and Spring Boot examples
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - strangler-fig
  - migration
  - microservices
  - legacy
coverImage: /images/strangler-fig-pattern.png
draft: false
order: 50
---
## Overview

The Strangler Fig pattern enables incremental migration from a monolithic application to microservices by gradually replacing specific functionality with new services. The pattern is named after strangler fig trees that gradually wrap around and replace their host tree.

## Architecture

A proxy or gateway intercepts requests and routes them either to the monolith or the new microservice based on the functionality being migrated. The filter maintains a set of migrated paths — any request matching a migrated path is forwarded to the new microservice, while all other traffic continues hitting the monolith.

```java
@Component
public class StranglerFigGatewayFilter implements GatewayFilter {

    private static final Set<String> MIGRATED_PATHS = Set.of(
        "/api/orders", "/api/payments", "/api/inventory"
    );

    private static final Map<String, String> ROUTE_MAP = Map.of(
        "/api/orders", "lb://order-service",
        "/api/payments", "lb://payment-service",
        "/api/inventory", "lb://inventory-service"
    );

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        // Check if this path has been migrated
        for (String migratedPath : MIGRATED_PATHS) {
            if (path.startsWith(migratedPath)) {
                String targetService = ROUTE_MAP.get(migratedPath);
                exchange.getAttributes().put("service", targetService);
                exchange.getAttributes().put("migrated", true);
                break;
            }
        }

        return chain.filter(exchange);
    }
}

@Bean
public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
    return builder.routes()
        .route("migrated-routes", r -> r
            .path("/api/orders/**", "/api/payments/**", "/api/inventory/**")
            .filters(f -> f.filter(stranglerFigFilter))
            .uri("lb://order-service"))
        .route("monolith-routes", r -> r
            .path("/api/**")
            .filters(f -> f.filter(stranglerFigFilter))
            .uri("http://monolith:8080"))
        .build();
}
```

## Feature Flag Integration

Feature flags allow per-user or per-request routing decisions. You could route 1% of users to the new microservice, internal testers always, or specific tenant IDs. This granular control enables safe testing in production and instant rollback by toggling the flag off.

```java
@Component
public class FeatureFlagRouter {

    @Autowired
    private FeatureFlagClient featureFlagClient;

    public boolean shouldRouteToMicroservice(String userId, String feature) {
        // Use feature flags for gradual rollout
        return featureFlagClient.isFeatureEnabled("migrate-" + feature, userId);
    }
}

@Component
public class MigrationAwareService {

    @Autowired
    private FeatureFlagRouter featureFlagRouter;

    @Autowired
    private MonolithClient monolithClient;

    @Autowired
    private OrderServiceClient orderServiceClient;

    public OrderResponse getOrder(String orderId, String userId) {
        if (featureFlagRouter.shouldRouteToMicroservice(userId, "orders")) {
            return orderServiceClient.getOrder(orderId);
        }
        return monolithClient.getOrder(orderId);
    }
}
```

## Data Migration Strategy

Data migration is the riskiest part of strangler fig migration. The batch migration approach copies orders in chunks of 1000, using `ON CONFLICT DO NOTHING` for idempotent re-runs. A scheduled job incrementally migrates recent data (last 24 hours) to keep the microservice's database reasonably current.

```java
@Component
public class DataMigrationService {

    @Autowired
    private JdbcTemplate monolithJdbc;

    @Autowired
    private JdbcTemplate serviceJdbc;

    private static final int BATCH_SIZE = 1000;

    @Transactional
    public void migrateOrders(Instant fromDate, Instant toDate) {
        long lastId = 0;
        boolean hasMore = true;

        while (hasMore) {
            List<Map<String, Object>> orders = monolithJdbc.queryForList(
                "SELECT * FROM orders WHERE id > ? AND created_at BETWEEN ? AND ? " +
                "ORDER BY id LIMIT ?",
                lastId, fromDate, toDate, BATCH_SIZE
            );

            if (orders.isEmpty()) {
                hasMore = false;
            } else {
                for (Map<String, Object> order : orders) {
                    serviceJdbc.update(
                        "INSERT INTO orders (id, customer_id, total, status, created_at) " +
                        "VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
                        order.get("id"), order.get("customer_id"),
                        order.get("total"), order.get("status"),
                        order.get("created_at")
                    );
                    lastId = ((Number) order.get("id")).longValue();
                }
            }
        }
    }

    @Scheduled(cron = "0 0 2 * * ?")
    public void incrementalMigration() {
        Instant now = Instant.now();
        migrateOrders(now.minus(1, ChronoUnit.DAYS), now);
    }
}
```

## Dual Writes During Migration

Dual writes keep both systems in sync during the migration window. Every write operation goes to both the monolith and the microservice database. This adds write latency but ensures that when the cutover happens, the microservice has all the data it needs.

```java
@Component
public class DualWriteService {

    @Autowired
    private MonolithRepository monolithRepository;

    @Autowired
    private MicroserviceRepository microserviceRepository;

    @Transactional
    public void createOrder(Order order) {
        // Write to both monolith and microservice
        monolithRepository.save(order);
        microserviceRepository.save(order);
    }

    @Transactional
    public void updateOrder(String orderId, OrderUpdate update) {
        monolithRepository.update(orderId, update);
        microserviceRepository.update(orderId, update);
    }
}
```

## Verification and Reconciliation

Reconciliation is the safety net for dual writes. A scheduled job compares IDs between the monolith and microservice, detects discrepancies, and replays missing records. Without reconciliation, silent data loss can accumulate during the migration window.

```java
@Component
public class ReconciliationService {

    @Scheduled(fixedRate = 3600000)
    public void reconcileOrders() {
        List<String> monolithIds = monolithRepository.findAllIds();
        List<String> serviceIds = microserviceRepository.findAllIds();

        Set<String> monolithSet = new HashSet<>(monolithIds);
        Set<String> serviceSet = new HashSet<>(serviceIds);

        Set<String> missingInService = new HashSet<>(monolithSet);
        missingInService.removeAll(serviceSet);

        if (!missingInService.isEmpty()) {
            log.warn("Missing orders in microservice: {}", missingInService);
            for (String id : missingInService) {
                Order order = monolithRepository.findById(id);
                microserviceRepository.save(order);
            }
        }

        Set<String> extraInService = new HashSet<>(serviceSet);
        extraInService.removeAll(monolithSet);

        if (!extraInService.isEmpty()) {
            log.warn("Extra orders in microservice: {}", extraInService);
        }
    }
}
```

## Best Practices

- Migrate functionality incrementally, one bounded context at a time.
- Use feature flags to toggle between monolith and microservice for specific users.
- Implement dual writes during data migration with reconciliation jobs.
- Use a gateway or proxy to route requests without changing client code.
- Keep the monolith and microservice running in parallel until migration is complete.
- Monitor error rates and latency for both systems during migration.

## Common Mistakes

### Mistake: Big bang migration

```java
// Wrong - migrate everything at once
// High risk, long downtime, difficult to rollback
```

```java
// Correct - incremental migration
// Step 1: Migrate read-only order queries
// Step 2: Migrate order creation (dual write)
// Step 3: Migrate order updates (dual write)
// Step 4: Cut over completely
// Step 5: Decommission monolith order code
```

### Mistake: No reconciliation after dual writes

```java
// Wrong - no validation that systems are in sync
```

```java
// Correct - periodic reconciliation
@Scheduled(fixedRate = 3600000)
public void reconcile() {
    List<Discrepancy> discrepancies = findDiscrepancies();
    for (Discrepancy d : discrepancies) {
        resolveDiscrepancy(d);
    }
}
```

## Summary

The Strangler Fig pattern enables safe, incremental migration from monolith to microservices. By routing traffic through a gateway, using feature flags, and implementing dual writes with reconciliation, you can gradually replace monolithic components without disrupting users.

## References

- [Martin Fowler - Strangler Fig Pattern](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [Microsoft - Strangler Fig Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [Sam Newman - Monolith to Microservices](https://samnewman.io/books/monolith-to-microservices/)

Happy Coding
