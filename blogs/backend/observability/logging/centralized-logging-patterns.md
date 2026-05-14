---
title: "Centralized Logging Patterns"
description: "Architect centralized logging solutions: log aggregation, shipping, storage strategies, and multi-service correlation"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - logging
  - centralized-logging
  - architecture
coverImage: "/images/centralized-logging-patterns.png"
draft: false
---

# Centralized Logging Patterns

## Overview

Centralized logging aggregates logs from multiple services into a single platform for search, analysis, and alerting. In microservices architectures, centralized logging is essential for debugging cross-service transactions and understanding system behavior.

### Why Centralized Logging?

- **No SSH access** required to view logs
- **Cross-service correlation** of requests
- **Historical analysis** and trend detection
- **Alerting** based on aggregated patterns
- **Compliance** and audit requirements

---

## Log Aggregation Architecture

### Basic Architecture

```
Service A ──┐
Service B ──┼──> Log Shipper ──> Message Queue ──> Log Aggregator ──> Storage ──> Search & Visualization
Service C ──┘
```

### Production Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│ Service A       │     │ Filebeat     │     │               │
│ Service A logs ─┼────>│ (sidecar)    │     │               │
└─────────────────┘     └──────┬───────┘     │               │
                               │              │   Kafka       │
┌─────────────────┐     ┌──────┴───────┐     │   (buffer)    │
│ Service B       │     │ Filebeat     │     │               │
│ Service B logs ─┼────>│ (sidecar)    │     │               │
└─────────────────┘     └──────┬───────┘     └───────┬───────┘
                               │                      │
┌─────────────────┐     ┌──────┴───────┐     ┌───────┴───────┐
│ Service C       │     │ Filebeat     │     │ Logstash      │
│ Service C logs ─┼────>│ (sidecar)    │     │ (parse, enrich)│
└─────────────────┘     └──────────────┘     └───────┬───────┘
                                                      │
                                               ┌──────┴──────┐
                                               │ Elasticsearch│
                                               │ (store, index)│
                                               └──────┬───────┘
                                                      │
                                               ┌──────┴──────┐
                                               │   Kibana    │
                                               │ (visualize) │
                                               └─────────────┘
```

---

## Log Shipping Patterns

### Sidecar Pattern (Kubernetes)

```yaml
# kubernetes sidecar deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: order-service:latest
        volumeMounts:
        - name: logs
          mountPath: /var/log/app
      
      - name: filebeat
        image: docker.elastic.co/beats/filebeat:8.12.0
        volumeMounts:
        - name: logs
          mountPath: /var/log/app
          readOnly: true
        - name: filebeat-config
          mountPath: /usr/share/filebeat/filebeat.yml
          subPath: filebeat.yml
      
      volumes:
      - name: logs
        emptyDir: {}
      - name: filebeat-config
        configMap:
          name: filebeat-config
```

### Agent Pattern (Node-Level)

```yaml
# DaemonSet running Filebeat on every node
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: filebeat
spec:
  selector:
    matchLabels:
      app: filebeat
  template:
    spec:
      containers:
      - name: filebeat
        image: docker.elastic.co/beats/filebeat:8.12.0
        volumeMounts:
        - name: varlog
          mountPath: /var/log
          readOnly: true
        - name: containers
          mountPath: /var/lib/docker/containers
          readOnly: true
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: containers
        hostPath:
          path: /var/lib/docker/containers
```

---

## Message Queue Integration

### Kafka as Log Buffer

```yaml
# docker-compose with Kafka for log buffering
version: '3.8'
services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1

  logstash:
    image: docker.elastic.co/logstash/logstash:8.12.0
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
    depends_on:
      - kafka
```

```ruby
# Logstash pipeline with Kafka input
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["application-logs"]
    consumer_threads => 4
    codec => json
    auto_offset_reset => "latest"
  }
}

filter {
  # Skip invalid JSON
  if "_jsonparsefailure" in [tags] {
    drop {}
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "app-logs-%{+YYYY.MM.dd}"
  }
}
```

---

## Multi-Tenant Log Isolation

### Index-Based Isolation

```ruby
output {
  elasticsearch {
    index => "logs-${service}-%{+YYYY.MM.dd}"
  }
}
```

### Field-Based Isolation

```ruby
filter {
  mutate {
    add_field => {
      "tenant_id" => "%{[@metadata][tenant]}"
    }
  }
}

# Elasticsearch field-level security
PUT _security/role/tenant-a-role
{
  "indices": [
    {
      "names": ["app-logs-*"],
      "privileges": ["read"],
      "field_security": {
        "grant": ["*"],
        "except": ["tenant_id:tenant-b-*"]
      }
    }
  ]
}
```

---

## Log Enrichment Patterns

### Enrichment Pipeline

```ruby
filter {
  # Add Kubernetes metadata
  kubernetes {
    source => "message"
    target => "kubernetes"
  }

  # Add service version
  mutate {
    add_field => {
      "service_version" => "%{[metadata][version]}"
    }
  }

  # Normalize log levels
  mutate {
    lowercase => ["severity"]
    replace => {
      "severity" => "error"
    }
    if [severity] in ["warn", "warning"] {
      mutate { replace => { "severity" => "warn" } }
    }
  }

  # Add environmental context
  translate {
    source => "[kubernetes][namespace]"
    target => "environment"
    dictionary => {
      "production" => "prod"
      "staging" => "stg"
      "default" => "dev"
    }
    fallback => "unknown"
  }
}
```

---

## Correlation Patterns

### Trace ID Propagation

```java
@Component
public class LogCorrelationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String traceId = request.getHeader("X-Trace-Id");
        if (traceId == null || traceId.isEmpty()) {
            traceId = UUID.randomUUID().toString();
        }

        MDC.put("trace_id", traceId);
        MDC.put("span_id", UUID.randomUUID().toString());
        response.setHeader("X-Trace-Id", traceId);

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

### Service-to-Service Correlation

```java
@Configuration
public class RestTemplateCorrelationConfig {

    @Bean
    public RestTemplate restTemplate() {
        RestTemplate restTemplate = new RestTemplate();
        restTemplate.getInterceptors().add((request, body, execution) -> {
            String traceId = MDC.get("trace_id");
            if (traceId != null) {
                request.getHeaders().add("X-Trace-Id", traceId);
            }
            return execution.execute(request, body);
        });
        return restTemplate;
    }
}
```

---

## Best Practices

### 1. Structured JSON Logging

```java
// All services must produce JSON logs
log.info(JsonOutput.toJson(Map.of(
    "event", "order.created",
    "orderId", order.getId(),
    "customerId", order.getCustomerId(),
    "amount", order.getTotal(),
    "timestamp", Instant.now().toString()
)));
```

### 2. Consistent Field Names

```java
public class LogFields {
    // Required fields for every log entry
    public static final String TIMESTAMP = "@timestamp";
    public static final String SERVICE = "service";
    public static final String ENVIRONMENT = "environment";
    public static final String TRACE_ID = "trace_id";
    public static final String SEVERITY = "severity";
    public static final String MESSAGE = "message";
}
```

### 3. Log Sampling for High-Volume Services

```java
@Service
public class SampledLoggingService {

    private static final Logger log = LoggerFactory.getLogger(SampledLoggingService.class);
    private final Random random = new Random();
    private static final double SAMPLE_RATE = 0.01; // 1%

    public void handleRequest(Request request) {
        if (random.nextDouble() < SAMPLE_RATE) {
            log.info("Sampled request: method={}, path={}, duration={}ms",
                request.getMethod(), request.getPath(), request.getDuration());
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: No Buffering Between Shipper and Aggregator

```java
// WRONG: Direct connection from shipper to Elasticsearch
// ES downtime = log loss

// CORRECT: Buffer with Kafka or Redis
// ES downtime = logs queue in Kafka
```

### Mistake 2: Inconsistent Log Format Across Services

```java
// WRONG: Each service has its own format
// Service A: "User 123 logged in"
// Service B: "login: userId=123"
// Service C: {"user_id": 123, "action": "login"}

// CORRECT: Standardized JSON format across all services
{"event": "user.login", "user_id": 123, "timestamp": "2026-05-11T10:00:00Z"}
```

### Mistake 3: Not Handling Backpressure

```ruby
# WRONG: No rate limiting
input {
  tcp { port => 5000 }
}

# CORRECT: Rate limit the input
input {
  tcp { port => 5000 }
}

filter {
  throttle {
    before_count => -1
    after_count => 1000
    period => 1
    max_age => 1
    key => "%{message}"
    add_tag => ["throttled"]
  }
}
```

---

## Summary

Centralized logging patterns for microservices:

1. Use sidecar or daemonset shippers for log collection
2. Buffer logs with Kafka for resilience
3. Enrich logs with Kubernetes metadata
4. Correlate logs across services with trace IDs
5. Maintain consistent JSON format across services
6. Implement ILM for log retention management
7. Monitor log shipping health and backpressure

---

## References

- [ELK Stack Centralized Logging](https://www.elastic.co/guide/en/elastic-stack/current/centralized-logging.html)
- [Kubernetes Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)
- [The Log: What Every Software Engineer Should Know](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)

Happy Coding