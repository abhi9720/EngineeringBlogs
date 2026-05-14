---
title: "Sidecar Pattern"
description: "Implement the sidecar pattern in microservices: deploying auxiliary components alongside main services, service mesh sidecars, Spring Boot examples, and Istio integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - sidecar
  - service-mesh
  - istio
  - microservices
coverImage: "/images/sidecar-pattern.png"
draft: false
---

## Overview

The sidecar pattern deploys auxiliary components (logging, monitoring, proxies) alongside the main application container. Sidecars share the same lifecycle and network namespace, enabling cross-cutting concerns without modifying application code.

## Kubernetes Sidecar Deployment

Sidecars share the same pod lifecycle and network namespace as the main application. Here, a log-sidecar (Fluentd) tails application logs from a shared volume and forwards them to a centralized logging system, while a metrics-sidecar scrapes the application's metrics endpoint and exposes them on port 9090 for Prometheus. Resource limits ensure sidecars don't starve the main container.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order-service
          image: order-service:latest
          ports:
            - containerPort: 8080
          env:
            - name: LOG_DIR
              value: /var/log/orders
          volumeMounts:
            - name: log-volume
              mountPath: /var/log/orders

        - name: log-sidecar
          image: fluentd:latest
          volumeMounts:
            - name: log-volume
              mountPath: /var/log/orders
          env:
            - name: FLUENTD_CONF
              value: /etc/fluentd/fluent.conf
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi

        - name: metrics-sidecar
          image: prometheus-exporter:latest
          ports:
            - containerPort: 9090
          env:
            - name: TARGET_SERVICE
              value: localhost:8080
          resources:
            requests:
              cpu: 50m
              memory: 64Mi

      volumes:
        - name: log-volume
          emptyDir: {}
```

## Custom Sidecar Implementation

### Configuration Sidecar

A configuration sidecar watches a source config file (e.g., from a ConfigMap or external service) and copies changes to a shared volume that the main application reads. This enables dynamic configuration updates without restarting the main application pod.

```java
@SpringBootApplication
public class ConfigSidecarApplication {

    public static void main(String[] args) {
        SpringApplication.run(ConfigSidecarApplication.class, args);
    }

    @Bean
    public CommandLineRunner configWatcher() {
        return args -> {
            // Watch for config changes and update files
            ConfigWatcher watcher = new ConfigWatcher(
                "/etc/config/app.properties",
                "/shared/config/app.properties"
            );
            watcher.startWatching(30, TimeUnit.SECONDS);
        };
    }
}

@Component
public class ConfigWatcher {

    private final String sourcePath;
    private final String targetPath;
    private long lastModified = 0;

    public ConfigWatcher(String sourcePath, String targetPath) {
        this.sourcePath = sourcePath;
        this.targetPath = targetPath;
    }

    public void startWatching(long interval, TimeUnit unit) {
        Executors.newSingleThreadScheduledExecutor()
            .scheduleAtFixedRate(() -> {
                try {
                    Path source = Paths.get(sourcePath);
                    long modified = Files.getLastModifiedTime(source).toMillis();

                    if (modified > lastModified) {
                        log.info("Config changed, updating...");
                        Files.copy(source, Paths.get(targetPath),
                            StandardCopyOption.REPLACE_EXISTING);
                        lastModified = modified;
                    }
                } catch (IOException e) {
                    log.error("Failed to watch config", e);
                }
            }, 0, interval, unit);
    }
}
```

### Log Aggregation Sidecar

The log aggregation sidecar tails application log files from a shared volume and ships them to a central logging service via HTTP. It tracks file positions to avoid resending already-shipped content. This pattern keeps the main application free of logging infrastructure dependencies.

```java
@Component
public class LogAggregationSidecar {

    @Value("${log.source.directory}")
    private String logSourceDir;

    @Value("${log.destination.url}")
    private String logDestinationUrl;

    private final RestTemplate restTemplate;
    private final Map<String, Long> filePositions = new ConcurrentHashMap<>();

    public LogAggregationSidecar() {
        this.restTemplate = new RestTemplate();
    }

    @Scheduled(fixedDelay = 5000)
    public void shipLogs() {
        try {
            Files.list(Paths.get(logSourceDir))
                .filter(path -> path.toString().endsWith(".log"))
                .forEach(this::processLogFile);
        } catch (IOException e) {
            log.error("Failed to ship logs", e);
        }
    }

    private void processLogFile(Path filePath) {
        try {
            String fileName = filePath.getFileName().toString();
            long position = filePositions.getOrDefault(fileName, 0L);

            if (Files.size(filePath) <= position) return;

            List<String> newLines = Files.readAllLines(filePath);
            List<String> unsentLines = newLines.subList((int) position, newLines.size());

            if (!unsentLines.isEmpty()) {
                LogBatch batch = new LogBatch(fileName, unsentLines);
                restTemplate.postForEntity(logDestinationUrl, batch, Void.class);
                filePositions.put(fileName, (long) newLines.size());
            }
        } catch (IOException e) {
            log.error("Failed to process log file: {}", filePath, e);
        }
    }
}
```

## Istio Sidecar

Istio's Envoy sidecar is the most widely deployed example of the sidecar pattern. With a single annotation (`sidecar.istio.io/inject: "true"`), Istio injects an Envoy proxy that handles all traffic management, mTLS, and observability. The exclude annotation prevents the sidecar from intercepting database traffic (port 3306), which doesn't benefit from mesh features.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  annotations:
    sidecar.istio.io/inject: "true"
    sidecar.istio.io/proxyCPULimit: "500m"
    sidecar.istio.io/proxyMemoryLimit: "512Mi"
    traffic.sidecar.istio.io/excludeOutboundPorts: "3306"
spec:
  template:
    spec:
      containers:
        - name: order-service
          image: order-service:latest
          ports:
            - containerPort: 8080
          env:
            - name: JAEGER_AGENT_HOST
              value: localhost
            - name: JAEGER_AGENT_PORT
              value: "6831"
```

### Istio Virtual Service for Sidecar

With the Envoy sidecar in place, Istio's routing rules apply transparently. The VirtualService and DestinationRule shown here configure traffic splitting between v1 and v2, connection pooling, outlier detection, retries, and mTLS — all enforced by the sidecar without any application code awareness.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
    - order-service
  http:
    - timeout: 5s
      retries:
        attempts: 3
        perTryTimeout: 2s
        retryOn: connect-failure,gateway-error,reset
      route:
        - destination:
            host: order-service
            subset: v1
          weight: 90
        - destination:
            host: order-service
            subset: v2
          weight: 10
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: order-service
spec:
  host: order-service
  trafficPolicy:
    tls:
      mode: ISTIO_MUTUAL
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
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

## Custom Health Check Sidecar

A health check sidecar can implement sophisticated checks that Kubernetes probes cannot express — like multi-endpoint health aggregation or external dependency verification. The sidecar writes the health status to a shared volume that the liveness probe can read via `cat`.

```java
@Component
public class HealthCheckSidecar {

    @Value("${health.check.target:http://localhost:8080/actuator/health}")
    private String healthEndpoint;

    @Value("${health.check.interval:10000}")
    private long checkInterval;

    private final RestTemplate restTemplate = new RestTemplate();

    @PostConstruct
    public void startHealthCheck() {
        Executors.newSingleThreadScheduledExecutor()
            .scheduleAtFixedRate(this::checkHealth, 0, checkInterval, TimeUnit.MILLISECONDS);
    }

    private void checkHealth() {
        try {
            ResponseEntity<String> response = restTemplate
                .getForEntity(healthEndpoint, String.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                updateHealthStatus(true);
            } else {
                updateHealthStatus(false);
            }
        } catch (Exception e) {
            log.warn("Health check failed for {}", healthEndpoint, e);
            updateHealthStatus(false);
        }
    }

    private void updateHealthStatus(boolean healthy) {
        // Write status to shared volume for Kubernetes probe
        try {
            Files.writeString(
                Paths.get("/shared/health/status"),
                healthy ? "healthy" : "unhealthy"
            );
        } catch (IOException e) {
            log.error("Failed to write health status", e);
        }
    }
}
```

## Best Practices

- Use sidecars for cross-cutting concerns: logging, monitoring, configuration, proxy.
- Keep sidecars lightweight with minimal resource requirements.
- Share volumes between main container and sidecar for file-based communication.
- Use health checks to manage sidecar lifecycle independently.
- Consider service mesh (Istio, Linkerd) as a standardized sidecar solution.

## Common Mistakes

### Mistake: Sidecar with too many responsibilities

```yaml
# Wrong - single sidecar doing everything
- name: everything-sidecar
  image: all-in-one-sidecar:latest
  # Logging, monitoring, proxy, config, all in one container
```

```yaml
# Correct - focused sidecars for each concern
- name: log-sidecar
  image: fluentd:latest
- name: proxy-sidecar
  image: envoy:latest
- name: metrics-sidecar
  image: prometheus-exporter:latest
```

### Mistake: Sidecar shares application secrets directly

```yaml
# Wrong - secrets exposed to sidecar
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-secret
        key: password
```

```yaml
# Correct - minimal secret scope per container
# Secrets mounted only to the container that needs them
```

## Summary

The sidecar pattern enables separation of cross-cutting concerns from business logic. Deploy sidecars alongside main containers in the same pod for shared lifecycle and network namespace. Service mesh implementations like Istio standardize the sidecar pattern for traffic management, security, and observability.

## References

- [Microsoft - Sidecar Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/sidecar)
- [Istio Sidecar Injection](https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/)
- [Kubernetes Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)

Happy Coding