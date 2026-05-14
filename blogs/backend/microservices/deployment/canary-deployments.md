---
title: "Canary Deployments"
description: "Implement canary deployments for microservices: gradual traffic shifting, metrics-based rollback, Kubernetes ingress, Istio weighted routing, and feature flag integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - canary
  - deployment
  - kubernetes
  - traffic-shifting
coverImage: "/images/canary-deployments.png"
draft: false
---

## Overview

Canary deployments release new versions to a small subset of users before rolling out to all traffic. This allows testing in production with real traffic while limiting blast radius. If metrics degrade, the canary is automatically rolled back.

## Kubernetes Canary Deployment

### Canary with Service Mesh Labels

```yaml
# Stable deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-stable
  labels:
    app: order-service
    version: stable
spec:
  replicas: 9
  selector:
    matchLabels:
      app: order-service
      version: stable
  template:
    metadata:
      labels:
        app: order-service
        version: stable
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v1.0.0
          ports:
            - containerPort: 8080

---
# Canary deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-canary
  labels:
    app: order-service
    version: canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-service
      version: canary
  template:
    metadata:
      labels:
        app: order-service
        version: canary
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v2.0.0
          ports:
            - containerPort: 8080
```

### Canary with NGINX Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-service-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-header: "x-canary"
    nginx.ingress.kubernetes.io/canary-by-header-value: "canary"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api/orders
            pathType: Prefix
            backend:
              service:
                name: order-service-canary
                port:
                  number: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-service-main
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api/orders
            pathType: Prefix
            backend:
              service:
                name: order-service-stable
                port:
                  number: 80
```

## Canary with Istio

### Weighted Routing

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
    - order-service
  http:
    - match:
        - headers:
            x-canary-user-group:
              exact: "beta-testers"
      route:
        - destination:
            host: order-service
            subset: canary
          weight: 100
    - route:
        - destination:
            host: order-service
            subset: stable
          weight: 95
        - destination:
            host: order-service
            subset: canary
          weight: 5
```

### Header-Based Canary

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service-header-canary
spec:
  hosts:
    - order-service
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
        - headers:
            cookie:
              regex: ".*canary=yes.*"
      route:
        - destination:
            host: order-service
            subset: canary
    - route:
        - destination:
            host: order-service
            subset: stable
```

## Automated Canary with Flagger

Flagger automates canary deployments with metrics analysis.

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: order-service
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  service:
    port: 80
    targetPort: 8080
  analysis:
    interval: 60s
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    metrics:
      - name: request-success-rate
        threshold: 99
        interval: 1m
      - name: request-duration
        threshold: 500
        interval: 1m
      - name: "istio_requests_total"
        templateRef:
          name: "istio-request-count"
        threshold: 10
        interval: 1m
    webhooks:
      - name: load-test
        url: http://load-tester.flagger/
        timeout: 5s
        metadata:
          cmd: "hey -z 2m -q 10 http://order-service-canary:80/"
```

## Metrics-Based Rollback

```java
@Component
public class CanaryRollbackService {

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private KubernetesClient kubernetesClient;

    private static final double ERROR_RATE_THRESHOLD = 0.01;
    private static final Duration LATENCY_THRESHOLD_MS = Duration.ofMillis(500);

    @Scheduled(fixedDelay = 30000)
    public void evaluateCanary() {
        if (!isCanaryActive()) return;

        double errorRate = getCanaryErrorRate();
        double avgLatency = getCanaryAverageLatency();

        if (errorRate > ERROR_RATE_THRESHOLD || avgLatency > LATENCY_THRESHOLD_MS.toMillis()) {
            log.warn("Canary metrics degraded. Error rate: {}, Latency: {}ms. Initiating rollback.",
                errorRate, avgLatency);
            rollbackCanary();
        } else {
            log.info("Canary metrics healthy. Error rate: {}, Latency: {}ms",
                errorRate, avgLatency);
        }
    }

    private double getCanaryErrorRate() {
        return meterRegistry.get("http.server.requests")
            .tag("version", "canary")
            .tag("outcome", "SUCCESS")
            .measure().stream()
            .mapToDouble(m -> m.getValue())
            .average()
            .orElse(1.0);
    }

    private double getCanaryAverageLatency() {
        return meterRegistry.get("http.server.requests")
            .tag("version", "canary")
            .timer().totalTime(TimeUnit.MILLISECONDS);
    }

    private void rollbackCanary() {
        // Scale canary to 0
        kubernetesClient.apps().deployments()
            .inNamespace("default")
            .withName("order-service-canary")
            .scale(0);

        // Reset Istio weights
        // Notify team
        log.warn("Canary rollback completed for order-service");
    }

    private boolean isCanaryActive() {
        Deployment canary = kubernetesClient.apps().deployments()
            .inNamespace("default")
            .withName("order-service-canary")
            .get();
        return canary != null && canary.getSpec().getReplicas() > 0;
    }
}
```

## Feature Flag Integration

```java
@Component
public class CanaryFeatureFlagRouter {

    @Autowired
    private FeatureFlagClient featureFlagClient;

    public boolean isCanaryUser(String userId) {
        return featureFlagClient.isFeatureEnabled(
            "order-service-canary", userId,
            FeatureFlagConfig.builder()
                .percentage(10)
                .build()
        );
    }
}

@Service
public class OrderService {

    @Autowired
    private CanaryFeatureFlagRouter canaryRouter;

    @Autowired
    private RestTemplate restTemplate;

    @Value("${services.order.stable.url}")
    private String stableUrl;

    @Value("${services.order.canary.url}")
    private String canaryUrl;

    public OrderResponse getOrder(String orderId, String userId) {
        String baseUrl = canaryRouter.isCanaryUser(userId) ? canaryUrl : stableUrl;
        return restTemplate.getForObject(
            baseUrl + "/api/orders/{id}",
            OrderResponse.class,
            orderId
        );
    }
}
```

## Canary with Spring Cloud Gateway

```java
@Configuration
public class CanaryGatewayConfig {

    @Bean
    public RouteLocator canaryRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("order-service-canary", r -> r
                .path("/api/orders/**")
                .and()
                .header("X-Canary", "true")
                .uri("lb://order-service-canary"))
            .route("order-service-stable", r -> r
                .path("/api/orders/**")
                .uri("lb://order-service-stable"))
            .build();
    }
}
```

## Best Practices

- Start with 1-5% of traffic for initial canary evaluation.
- Monitor error rates, latency, and business metrics during canary.
- Implement automated rollback based on metric thresholds.
- Use header-based canary for targeting specific user groups.
- Combine canary with feature flags for fine-grained control.
- Set maximum canary duration to prevent stale deployments.

## Common Mistakes

### Mistake: Canary with too much traffic initially

```yaml
# Wrong - 50% traffic to canary immediately
weight: 50
```

```yaml
# Correct - gradual increase
weight: 1  # Start small
# ... then 5, 10, 25, 50 if metrics are healthy
```

### Mistake: No automated rollback

```java
// Wrong - manual monitoring only
// Requires human to notice and rollback
```

```java
// Correct - automated metrics-based rollback
@Scheduled(fixedDelay = 30000)
public void autoRollback() {
    if (errorRate > threshold) {
        rollback();
    }
}
```

## Summary

Canary deployments reduce deployment risk by gradually shifting traffic to new versions. Use Istio weighted routing or Kubernetes ingress annotations for traffic control, and implement automated metrics-based rollback for safe releases. Combine with feature flags for targeting specific user segments.

## References

- [Flagger Documentation](https://flagger.app/)
- [Istio Canary Deployments](https://istio.io/latest/docs/tasks/traffic-management/canary/)
- [NGINX Canary Deployments](https://docs.nginx.com/nginx-ingress-controller/configuration/canary/)

Happy Coding