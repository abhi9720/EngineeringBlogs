---
title: "Auto-Scaling Strategies"
description: "Implement auto-scaling: horizontal pod autoscaler, metrics-based scaling, predictive scaling, and Kubernetes HPA"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - scalability
  - auto-scaling
  - kubernetes
  - hpa
coverImage: "/images/auto-scaling-strategies.png"
draft: false
---

# Auto-Scaling Strategies

## Overview

Auto-scaling automatically adjusts the number of application instances based on demand. Proper auto-scaling ensures consistent performance during traffic spikes and cost efficiency during low traffic.

### Scaling Dimensions

- **Horizontal**: Add/remove instances (most common)
- **Vertical**: Increase/decrease instance resources
- **Predictive**: Scale based on forecasted demand
- **Scheduled**: Scale based on time patterns

---

## Kubernetes Horizontal Pod Autoscaler

### CPU-Based HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

### Memory-Based HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-memory-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 3
  maxReplicas: 15
  metrics:
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Custom Metrics HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-custom-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 2
  maxReplicas: 30
  metrics:
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: 1000
  - type: Pods
    pods:
      metric:
        name: queue_depth
      target:
        type: AverageValue
        averageValue: 10
```

Custom metrics decouple scaling from resource utilization (CPU/memory) and tie it directly to business signals. Scaling on requests per second is more responsive than CPU — a traffic spike shows up in RPS immediately, while CPU lags because threads spend time waiting on I/O before showing utilization. Queue depth is an even earlier signal: once the backlog starts growing, you already need more capacity. The HPA computes a desired replica count per metric and uses the maximum across all metrics, so a sudden queue spike can trigger a scale-up even if CPU is still low.

---

## Spring Boot Metrics for Auto-Scaling

### Exposing Custom Metrics

```java
@Configuration
public class ScalingMetricsConfig {

    @Bean
    public MeterRegistryCustomizer<MeterRegistry> scalingMetrics() {
        return registry -> {
            // Request rate metric
            registry.gauge("http_requests_per_second", new AtomicDouble(0));

            // Queue depth metric
            registry.gauge("queue_depth", new AtomicDouble(0));

            // Active requests metric
            registry.gauge("active_requests", new AtomicDouble(0));
        };
    }
}

@Component
public class RequestMetricsCollector {

    private final MeterRegistry registry;
    private final AtomicDouble requestsPerSecond;
    private final AtomicDouble activeRequests;

    private final SlidingWindowCounter counter = new SlidingWindowCounter(60_000); // 1 minute

    public RequestMetricsCollector(MeterRegistry registry) {
        this.registry = registry;
        this.requestsPerSecond = registry.gauge(
            "http_requests_per_second", new AtomicDouble(0));
        this.activeRequests = registry.gauge(
            "active_requests", new AtomicDouble(0));
    }

    public void recordRequest() {
        counter.increment();
        activeRequests.incrementAndGet();
    }

    public void recordResponse() {
        activeRequests.decrementAndGet();
    }

    @Scheduled(fixedRate = 1000) // Every second
    public void updateMetrics() {
        double rps = counter.getCount() / 60.0; // Average over 1 minute
        requestsPerSecond.set(rps);
    }
}

class SlidingWindowCounter {
    private final long windowSizeMs;
    private final Queue<Long> timestamps = new ConcurrentLinkedQueue<>();

    SlidingWindowCounter(long windowSizeMs) {
        this.windowSizeMs = windowSizeMs;
    }

    public void increment() {
        timestamps.add(System.currentTimeMillis());
    }

    public long getCount() {
        long cutoff = System.currentTimeMillis() - windowSizeMs;
        while (!timestamps.isEmpty() && timestamps.peek() < cutoff) {
            timestamps.poll();
        }
        return timestamps.size();
    }
}
```

---

## Predictive Auto-Scaling

### Time-Based Scaling

```yaml
# Scheduled scaling for known traffic patterns
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-service-scaledobject
spec:
  scaleTargetRef:
    name: order-service
  minReplicaCount: 3
  maxReplicaCount: 20
  triggers:
  - type: cron
    metadata:
      timezone: Asia/Kolkata
      start: 30 9 * * *   # Scale up at 9:30 AM
      end: 30 18 * * *    # Scale down at 6:30 PM
      desiredReplicas: "15"
  - type: cron
    metadata:
      timezone: Asia/Kolkata
      start: 30 18 * * *  # Evening scale down
      end: 30 9 * * *     # Morning scale up
      desiredReplicas: "3"
```

### Predictive Scaling with Machine Learning

```java
@Component
public class PredictiveScaler {

    private final Map<String, TimeSeriesData> historicalData = new ConcurrentHashMap<>();

    @Scheduled(fixedRate = 3600_000) // Every hour
    public void predictAndScale() {
        // Get last 30 days of traffic data
        List<Double> traffic = getHistoricalTraffic();

        // Simple prediction: average of same hour last 7 days
        int currentHour = LocalDateTime.now().getHour();
        double predictedLoad = traffic.stream()
            .filter(t -> t.hour() == currentHour)
            .mapToDouble(TimeSeriesData::value)
            .average()
            .orElse(0);

        // Scale based on prediction
        int desiredReplicas = calculateReplicasForLoad(predictedLoad);
        scaleTo(desiredReplicas);
    }

    private int calculateReplicasForLoad(double predictedLoad) {
        // Assume each instance handles 1000 req/s
        double capacityPerInstance = 1000.0;
        int replicas = (int) Math.ceil(predictedLoad / capacityPerInstance);

        // Add safety margin
        return Math.max(3, (int) (replicas * 1.2));
    }

    private void scaleTo(int replicas) {
        // Kubernetes API call to scale deployment
        appsV1Api.patchNamespacedDeployment(
            "order-service", "production",
            new V1Patch("[{\"op\":\"replace\",\"path\":\"/spec/replicas\",\"value\":" +
                        replicas + "}]"),
            null, null, null, null);
    }

    private List<TimeSeriesData> getHistoricalTraffic() {
        // Get from Prometheus or monitoring system
        return List.of();
    }
}

record TimeSeriesData(Instant timestamp, int hour, double value) {}
```

---

## KEDA (Kubernetes Event-Driven Autoscaling)

### KEDA with Prometheus

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-service-prometheus-scaler
spec:
  scaleTargetRef:
    name: order-service
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: http_requests_per_second
      query: |
        sum(rate(http_server_requests_seconds_count{service="order-service"}[2m]))
      threshold: "1000"
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: queue_depth
      query: |
        sum(active_queue_depth{queue="order-processing"})
      threshold: "10"
```

### KEDA with Kafka

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-service-kafka-scaler
spec:
  scaleTargetRef:
    name: order-consumer
  minReplicaCount: 1
  maxReplicaCount: 20
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: kafka:9092
      consumerGroup: order-consumer-group
      topic: orders
      lagThreshold: "100"
      offsetResetPolicy: latest
```

---

## Auto-Scaling Policies

### Fast Scaling for Spikes

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 0  # No waiting
    policies:
    - type: Percent
      value: 200  # Double instances
      periodSeconds: 15
    - type: Pods
      value: 10   # Or add 10 pods
      periodSeconds: 15
    selectPolicy: Max  # Use the policy that adds more
```

### Conservative Scaling Down

```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300  # Wait 5 minutes
    policies:
    - type: Percent
      value: 25  # Only remove 25% at a time
      periodSeconds: 60
    selectPolicy: Min  # Be conservative
```

---

## Auto-Scaling Best Practices

### 1. Set Minimum and Maximum Limits

```yaml
spec:
  minReplicas: 3  # Always have at least 3 instances
  maxReplicas: 20 # Don't exceed 20
```

### 2. Use Multiple Metrics

```yaml
metrics:
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: 70
- type: Pods
  pods:
    metric:
      name: queue_depth
    target:
      type: AverageValue
      averageValue: 10
```

### 3. Prepare for Cold Starts

```java
@Component
public class WarmupConfig {

    @EventListener
    public void handleScalingEvent(ScalingEvent event) {
        int newReplicas = event.getNewReplicas();

        // Warm up caches when scaling
        if (event.isScaleUp()) {
            log.info("Scaling up to {} replicas, warming caches", newReplicas);
            warmupCaches();
        }
    }

    private void warmupCaches() {
        // Preload popular products
        // Preload configuration
        // Establish database connections
    }
}
```

---

## Monitoring Auto-Scaling

### Prometheus Rules

```yaml
groups:
  - name: autoscaling
    rules:
      - alert: HPAReplicasLow
        expr: kube_horizontalpodautoscaler_status_current_replicas ==
               kube_horizontalpodautoscaler_spec_min_replicas
        for: 1h
        labels:
          severity: warning

      - alert: HPAReplicasMax
        expr: kube_horizontalpodautoscaler_status_current_replicas ==
               kube_horizontalpodautoscaler_spec_max_replicas
        for: 5m
        labels:
          severity: critical
```

### Grafana Dashboard Metrics

```json
{
  "panels": [
    {
      "title": "Current Replicas",
      "type": "stat",
      "targets": [{
        "expr": "kube_horizontalpodautoscaler_status_current_replicas{hpa='order-service-hpa'}"
      }]
    },
    {
      "title": "CPU Utilization",
      "type": "graph",
      "targets": [{
        "expr": "sum(rate(container_cpu_usage_seconds_total{pod=~'order-service-.*'}[1m])) by (pod)"
      }]
    }
  ]
}
```

---

## Common Mistakes

### Mistake 1: Scaling Only on CPU

```yaml
# WRONG: CPU-only scaling misses memory or queue-based issues
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        averageUtilization: 80

# CORRECT: Use multiple metrics including custom ones
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        averageUtilization: 70
  - type: Pods
    pods:
      metric:
        name: queue_depth
      target:
        averageValue: 10
```

### Mistake 2: No Minimum Replicas

```yaml
# WRONG: Can scale to zero (cold start problem)
minReplicas: 0

# CORRECT: Always have minimum running
minReplicas: 3
```

### Mistake 3: Aggressive Scale Down

```yaml
# WRONG: Scale down too fast
behavior:
  scaleDown:
    stabilizationWindowSeconds: 0
    policies:
    - type: Percent
      value: 100
      periodSeconds: 15

# CORRECT: Conservative scale down
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
    - type: Percent
      value: 25
      periodSeconds: 60
```

---

## Summary

1. Use multiple metrics for HPA (CPU, memory, custom)
2. Implement stabilization windows to prevent thrashing
3. Scale up fast, scale down slow
4. Set minimum and maximum replica limits
5. Use KEDA for event-driven scaling (Kafka, queues)
6. Monitor scaling events and replica counts
7. Prepare for cold starts with cache warming
8. Combine predictive and reactive scaling for best results

---

## References

- [Kubernetes HPA](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [KEDA Documentation](https://keda.sh/docs/)
- [AWS Auto Scaling](https://aws.amazon.com/autoscaling/)
- [Google Cloud Auto Scaling](https://cloud.google.com/compute/docs/autoscaler)

Happy Coding