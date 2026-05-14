---
title: "Service Mesh with Istio"
description: "Implement Istio service mesh for microservices: traffic management, mTLS security, observability with Kiali and Jaeger, canary deployments, and fault injection"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - istio
  - service-mesh
  - kubernetes
  - microservices
coverImage: "/images/service-mesh-istio.png"
draft: false
---

## Overview

Istio is a service mesh that provides traffic management, security, and observability for microservices without changing application code. It uses Envoy sidecar proxies to intercept all network communication between services.

## Installing Istio

```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-1.20.0
export PATH=$PWD/bin:$PATH

# Install with default profile
istioctl install --set profile=demo -y

# Enable sidecar injection
kubectl label namespace default istio-injection=enabled

# Verify installation
istioctl verify-install
```

## Enabling Sidecar Injection

Istio injects an Envoy proxy sidecar container into every pod in a labeled namespace. The sidecar intercepts all inbound and outbound traffic, applying traffic management, security (mTLS), and observability policies — all without any changes to the application code. Sidecar resource limits prevent the proxy from starving the application container.

```yaml
# Global namespace injection
apiVersion: v1
kind: Namespace
metadata:
  name: microservices
  labels:
    istio-injection: enabled

# Per-deployment injection
apiVersion: apps/v1
kind: Deployment
metadata:
  annotations:
    sidecar.istio.io/inject: "true"
    sidecar.istio.io/proxyCPULimit: "500m"
    sidecar.istio.io/proxyMemoryLimit: "512Mi"
spec:
  template:
    spec:
      containers:
        - name: order-service
          image: order-service:latest
```

## Traffic Management

### VirtualService and DestinationRule

VirtualService defines routing rules — header-based matches take priority, then weighted distribution applies to remaining traffic. DestinationRule configures how traffic is handled after routing: connection pooling limits, circuit breaker thresholds (outlier detection ejects unhealthy pods), and TLS settings. Together they provide fine-grained traffic management without application code changes.

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
            x-canary:
              exact: "true"
      route:
        - destination:
            host: order-service
            subset: v2
          weight: 100
    - route:
        - destination:
            host: order-service
            subset: v1
          weight: 90
        - destination:
            host: order-service
            subset: v2
          weight: 10
      timeout: 5s
      retries:
        attempts: 3
        perTryTimeout: 2s
        retryOn: connect-failure,gateway-error,reset
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: order-service
spec:
  host: order-service
  trafficPolicy:
    loadBalancer:
      simple: ROUND_ROBIN
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 10
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 60s
      maxEjectionPercent: 50
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

### Traffic Splitting

Traffic mirroring sends a copy of live traffic to a mirrored service without impacting the response to the client. Here, 20% of actual traffic goes to v2, while 100% of all traffic is mirrored to a v2-mirror instance. This allows testing v2 against production traffic patterns without user-facing risk.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payment-service
spec:
  hosts:
    - payment-service
  http:
    - route:
        - destination:
            host: payment-service
            subset: v1
          weight: 80
        - destination:
            host: payment-service
            subset: v2
          weight: 20
      mirror:
        host: payment-service
        subset: v2-mirror
      mirrorPercentage:
        value: 100
```

### Fault Injection

Fault injection tests resilience without modifying application code. This configuration adds a 5-second delay to 10% of requests and returns HTTP 500 for 5% of requests — simulating real-world degradation and validating that circuit breakers, retries, and timeouts behave correctly under adverse conditions.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: inventory-service
spec:
  hosts:
    - inventory-service
  http:
    - fault:
        delay:
          percentage:
            value: 10
          fixedDelay: 5s
        abort:
          percentage:
            value: 5
          httpStatus: 500
      route:
        - destination:
            host: inventory-service
            subset: v1
```

## Security with mTLS

Mutual TLS (mTLS) encrypts and authenticates all service-to-service communication. `STRICT` mode rejects unencrypted connections, while `PERMISSIVE` accepts both encrypted and plaintext — useful during migration. The AuthorizationPolicy adds fine-grained access control: only requests from the api-gateway service account in the microservices namespace can access order-service.

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: microservices
spec:
  mtls:
    mode: STRICT
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: permissive-mtls
  namespace: legacy
spec:
  mtls:
    mode: PERMISSIVE
---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: order-service-policy
spec:
  selector:
    matchLabels:
      app: order-service
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/microservices/sa/api-gateway"]
        - source:
            namespaces: ["microservices"]
    - to:
        - operation:
            methods: ["GET", "POST"]
            paths: ["/api/orders/*"]
```

## Observability

### Kiali Dashboard

Istio enables observability at the mesh level without application instrumentation. Kiali visualizes service topology and traffic flow, Prometheus stores metrics, Grafana provides dashboards, and Jaeger collects traces. The Telemetry resource configures access logging and metrics collection across the entire mesh.

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: mesh-default
spec:
  accessLogging:
    - providers:
        - name: envoy
  metrics:
    - providers:
        - name: prometheus
---
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
metadata:
  name: observability
spec:
  addonComponents:
    kiali:
      enabled: true
    prometheus:
      enabled: true
    grafana:
      enabled: true
    tracing:
      enabled: true
```

### Distributed Tracing with Jaeger

Jeager distributed tracing is configured at the mesh level — the Envoy sidecars automatically propagate trace context and report spans. The `randomSamplingPercentage: 100` samples all traces (adjust down in production). Custom tags like `service.version` add business context to every span.

```yaml
apiVersion: telemetry.istio.io/v1alpha1
kind: Telemetry
metadata:
  name: tracing
spec:
  tracing:
    - providers:
        - name: jaeger
      randomSamplingPercentage: 100
      customTags:
        service.version:
          header:
            name: x-service-version
```

### Spring Boot Configuration for Istio

While Istio handles most cross-cutting concerns at the mesh level, applications must propagate certain headers (`x-request-id`, `x-b3-*`) for distributed tracing to work. The Feign interceptor shown here ensures these headers are forwarded on every outbound HTTP call, enabling end-to-end trace correlation.

```java
@Configuration
public class IstioTracingConfig {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @Bean
    public WebClient.Builder webClientBuilder() {
        return WebClient.builder()
            .defaultHeader("x-request-id", UUID.randomUUID().toString());
    }
}

@Component
public class IstioHeadersInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // Propagate Istio headers
        template.header("x-request-id", UUID.randomUUID().toString());
        template.header("x-b3-traceid", Tracing.currentTraceContext().get().traceId());
        template.header("x-b3-spanid", Tracing.currentTraceContext().get().spanId());
        template.header("x-b3-sampled", "1");
    }
}
```

## Gateway Configuration

```yaml
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: microservices-gateway
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - "api.example.com"
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: api-tls-cert
      hosts:
        - "api.example.com"
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: microservices-ingress
spec:
  hosts:
    - "api.example.com"
  gateways:
    - microservices-gateway
  http:
    - match:
        - uri:
            prefix: /api/orders
      route:
        - destination:
            host: order-service
            port:
              number: 80
    - match:
        - uri:
            prefix: /api/payments
      route:
        - destination:
            host: payment-service
            port:
              number: 80
```

## Best Practices

- Enable mTLS STRICT mode for production namespaces.
- Use DestinationRule outlier detection for automatic failure handling.
- Configure meaningful timeouts and retries in VirtualService.
- Enable access logging for debugging and auditing.
- Use Kiali for visualizing service topology and traffic flow.
- Gradually migrate from PERMISSIVE to STRICT mTLS.

## Common Mistakes

### Mistake: Enabling mTLS without PeerAuthentication

```yaml
# Wrong - mTLS not enforced
```

```yaml
# Correct - STRICT mTLS
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
spec:
  mtls:
    mode: STRICT
```

### Mistake: No outlier detection

```yaml
# Wrong - unhealthy pods keep receiving traffic
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: order-service
spec:
  host: order-service
  subsets:
    - name: v1
      labels:
        version: v1
```

```yaml
# Correct - outlier detection ejects unhealthy pods
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: order-service
spec:
  host: order-service
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 60s
```

## Summary

Istio provides a comprehensive service mesh for traffic management, security, and observability. With Envoy sidecars, it enables mTLS, canary deployments, fault injection, and distributed tracing without application changes. Use Istio's traffic management features for resilient inter-service communication.

## References

- [Istio Documentation](https://istio.io/latest/docs/)
- [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/)
- [Istio Security](https://istio.io/latest/docs/concepts/security/)

Happy Coding