---
title: "Jaeger vs Zipkin Setup"
description: "Compare Jaeger and Zipkin for distributed tracing: architecture, deployment, data storage, and feature comparison"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - tracing
  - jaeger
  - zipkin
coverImage: "/images/jaeger-zipkin-setup.png"
draft: false
---

# Jaeger vs Zipkin Setup

## Overview

Jaeger and Zipkin are the two most popular open-source distributed tracing systems. Both collect trace data from instrumented applications and provide visualization, analysis, and storage. This guide compares their architectures, deployment options, and features.

### Quick Comparison

| Feature | Jaeger | Zipkin |
|---------|--------|--------|
| Initial Release | 2017 | 2012 |
| CNCF Status | Graduated | Incubating |
| Storage Backends | Elasticsearch, Cassandra, Kafka | Elasticsearch, Cassandra, S3 |
| Sampling | Head-based, adaptive | Head-based, rate-limiting |
| UI | Rich, search-focused | Simple, dependency-focused |
| gRPC Support | Native | Via proxy |

---

## Jaeger Deployment

### All-in-One (Development)

```yaml
version: '3.8'
services:
  jaeger:
    image: jaegertracing/all-in-one:1.56
    environment:
      - COLLECTOR_OTLP_ENABLED=true
      - METRICS_STORAGE_TYPE=prometheus
    ports:
      - "16686:16686"  # UI
      - "4317:4317"    # OTLP gRPC
      - "4318:4318"    # OTLP HTTP
      - "14250:14250"  # Jaeger gRPC
    networks:
      - tracing
```

The all-in-one image bundles agent, collector, query service, and UI into a single process. It stores traces in memory by default, making it suitable for development but not production—data is lost on restart and there is no horizontal scaling. Enabling `COLLECTOR_OTLP_ENABLED` allows OpenTelemetry SDKs to send traces directly to Jaeger using the standard OTLP protocol.

### Production Deployment (Elasticsearch)

```yaml
version: '3.8'
services:
  jaeger-collector:
    image: jaegertracing/jaeger-collector:1.56
    environment:
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
      - ES_TAGS_AS_FIELDS_ALL=true
      - COLLECTOR_QUEUE_SIZE=2000
      - COLLECTOR_NUM_QUEUES=4
    ports:
      - "14250:14250"
      - "4317:4317"
    depends_on:
      - elasticsearch
    deploy:
      replicas: 3
    networks:
      - tracing

  jaeger-query:
    image: jaegertracing/jaeger-query:1.56
    environment:
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
      - QUERY_BASE_PATH=/
    ports:
      - "16686:16686"
    depends_on:
      - elasticsearch
    networks:
      - tracing

  jaeger-agent:
    image: jaegertracing/jaeger-agent:1.56
    command: ["--collector.host-port=jaeger-collector:14250"]
    ports:
      - "6831:6831/udp"
      - "14271:14271"
    networks:
      - tracing

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - jaeger-es-data:/usr/share/elasticsearch/data
    networks:
      - tracing

volumes:
  jaeger-es-data:

networks:
  tracing:
    driver: bridge
```

In production, Jaeger separates concerns into dedicated components: the collector ingests and processes spans, the query service serves the UI and API, and the agent runs as a sidecar on each host for UDP span forwarding. The collector is horizontally scalable—three replicas here, but can scale to dozens. The `ES_TAGS_AS_FIELDS_ALL` setting stores span tags as indexed Elasticsearch fields, enabling fast tag-based filtering in the UI at the cost of increased storage per span.

### Client Configuration

```yaml
# application.yml for OpenTelemetry with Jaeger
otel:
  service.name: order-service
  traces.exporter: otlp
  exporter.otlp.endpoint: http://jaeger-collector:4317
  exporter.otlp.protocol: grpc
```

---

## Zipkin Deployment

### Docker Compose

```yaml
version: '3.8'
services:
  zipkin:
    image: openzipkin/zipkin:3.3
    environment:
      - STORAGE_TYPE=elasticsearch
      - ES_HOSTS=http://elasticsearch:9200
      - ZIPKIN_UI_ENABLED=true
      - JAVA_OPTS=-Xms2g -Xmx2g
    ports:
      - "9411:9411"
    depends_on:
      - elasticsearch
    networks:
      - tracing

  zipkin-slim:
    image: openzipkin/zipkin-slim:3.3
    # Slim version for production - fewer dependencies
    ports:
      - "9411:9411"

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    volumes:
      - zipkin-es-data:/usr/share/elasticsearch/data
    networks:
      - tracing

volumes:
  zipkin-es-data:

networks:
  tracing:
    driver: bridge
```

Zipkin's architecture is simpler than Jaeger's—a single server binary handles ingestion, query, and the UI. The slim image removes unused dependencies (e.g., Cassandra drivers when only Elasticsearch is used), reducing the attack surface and memory footprint. The trade-off is that Zipkin has no native agent component; spans are typically sent directly from the application via HTTP or Kafka.

### Spring Cloud Sleuth Integration (Legacy)

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-sleuth</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-sleuth-zipkin</artifactId>
</dependency>
```

```yaml
# application.yml for Sleuth + Zipkin
spring:
  application:
    name: order-service
  zipkin:
    base-url: http://zipkin:9411
    sender:
      type: web
  sleuth:
    sampler:
      probability: 1.0
    web:
      client:
        enabled: true
    async:
      enabled: true
    scheduled:
      enabled: true
```

Spring Cloud Sleuth was the de facto tracing solution for Spring Boot before OpenTelemetry gained traction. It automatically instruments Spring-managed beans (controllers, RestTemplate, Kafka, etc.) and sends traces to Zipkin. The `probability: 1.0` sampler captures every request—acceptable for development but dangerously high for production.

### Modern OpenTelemetry with Zipkin

```yaml
# application.yml for OpenTelemetry + Zipkin
otel:
  service.name: order-service
  traces.exporter: zipkin
  exporter.zipkin.endpoint: http://zipkin:9411/api/v2/spans
```

Migrating from Sleuth to OpenTelemetry is straightforward: swap the Sleuth dependencies for the OpenTelemetry Spring Boot starter, change the exporter to `zipkin`, and point to the Zipkin endpoint. OpenTelemetry provides ongoing support and a standard API that works across any backend.

---

## Storage Comparison

### Jaeger Storage Configuration

```yaml
# Elasticsearch storage
SPAN_STORAGE_TYPE=elasticsearch
ES_SERVER_URLS=http://elasticsearch:9200
ES_TAGS_AS_FIELDS_ALL=true
ES_USE_ALIASES=true
ES_INDEX_PREFIX=jaeger

# Cassandra storage
SPAN_STORAGE_TYPE=cassandra
CASSANDRA_SERVERS=cassandra:9042
CASSANDRA_KEYSPACE=jaeger_v1_dc1

# Kafka for streaming
KAFKA_PRODUCER_BROKERS=kafka:9092
KAFKA_TOPIC=jaeger-spans
```

### Zipkin Storage Configuration

```yaml
# Elasticsearch storage
STORAGE_TYPE=elasticsearch
ES_HOSTS=http://elasticsearch:9200
ES_INDEX=zipkin
ES_INDEX_SHARDS=5
ES_INDEX_REPLICAS=1

# Cassandra storage
STORAGE_TYPE=cassandra3
CASSANDRA_CONTACT_POINTS=cassandra:9042
CASSANDRA_KEYSPACE=zipkin
```

Both Jaeger and Zipkin support Elasticsearch and Cassandra, but the choice has operational implications. Elasticsearch excels at tag-based search (the primary tracing workflow) but requires careful index management to handle span volume. Cassandra provides linear write scaling but sacrifices ad-hoc search flexibility. Many production deployments use Kafka as an intermediate buffer to absorb traffic spikes before writing to the storage backend.

---

## Sampling Strategies

### Jaeger Sampling

```go
// Jaeger sampling strategies (client configuration)
sampling:
  # Default: sample 1 per second
  type: probabilistic
  param: 0.1  # Sample 10%

  # Per-service strategies
  per_operation_strategies:
    - service: order-service
      operation: POST /api/orders
      type: probabilistic
      param: 1.0  # Sample all order creation

    - service: order-service
      operation: GET /api/products
      type: rate_limiting
      param: 10  # Max 10 traces per second
```

Jaeger's per-operation sampling is its killer feature. Order creation (POST /api/orders) is sampled at 100% because losing a single order trace could mean missing a critical business failure. Product listings (GET /api/products) are rate-limited to 10 traces/second regardless of traffic volume, ensuring the tracing infrastructure doesn't buckle under high read traffic.

### Zipkin Sampling

```yaml
# Zipkin sampling with Sleuth
spring:
  sleuth:
    sampler:
      probability: 0.1  # Sample 10%
      # Rate-limited sampling
      rate: 10  # Max 10 traces per second

# Brave sampling configuration
brave:
  sampler:
    probability: 0.1
```

Zipkin's sampling is simpler but less flexible. The probability is applied uniformly to all requests, so high-traffic endpoints and low-traffic health checks are sampled at the same rate. For most systems this is sufficient, but it means you may miss traces on rarely-called critical endpoints.

---

## UI and Features

### Jaeger UI Features

- **Trace Search**: Filter by service, operation, tags, duration
- **Trace Detail View**: Waterfall timeline, span details
- **Service Architecture**: DAG of service dependencies
- **Compare Traces**: Side-by-side trace comparison
- **Metrics**: Integration with Prometheus for RED metrics

### Zipkin UI Features

- **Trace Search**: Filter by service, span name, annotations
- **Trace View**: Waterfall timeline
- **Dependency Graph**: Service dependency visualization
- **Service Map**: Topology of service calls

---

## Best Practices

### 1. Use Adaptive Sampling

```java
// Jaeger adaptive sampling ensures important traces are captured
// High-traffic endpoints are sampled at lower rate
// Low-traffic, critical endpoints are sampled at higher rate

@Configuration
public class SamplingConfig {

    @Bean
    public Sampler sampler() {
        return Sampler.parentBased(
            Sampler.traceIdRatioBased(0.1)
        );
    }
}
```

### 2. Set Appropriate Retention

```yaml
# Jaeger: Elasticsearch ILM for trace retention
# Hot: 2 days, Warm: 5 days, Cold: 30 days, Delete: 90 days

# Zipkin: Configure Elasticsearch TTL
ES_MAX_DOCS=50000000
```

---

## Common Mistakes

### Mistake 1: 100% Sampling in Production

```yaml
# WRONG: 100% sampling overwhelms storage
spring.sleuth.sampler.probability: 1.0

# CORRECT: Adaptive or probabilistic sampling
spring.sleuth.sampler.probability: 0.1
```

### Mistake 2: Not Configuring Storage

```yaml
# WRONG: In-memory storage in production
# Data lost on restart

# CORRECT: Persistent storage
STORAGE_TYPE=elasticsearch
ES_SERVER_URLS=http://elasticsearch:9200
```

---

## Summary

| Aspect | Jaeger | Zipkin |
|--------|--------|--------|
| Complexity | Medium | Low |
| Performance | High | Medium |
| Storage Options | ES, Cassandra, Kafka | ES, Cassandra, S3 |
| UI Features | Rich | Simple |
| OpenTelemetry | Native OTLP | Via adapter |
| Community | Large | Large |

Choose Jaeger for richer features and better performance. Choose Zipkin for simplicity and legacy Sleuth compatibility.

---

## References

- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Zipkin Documentation](https://zipkin.io/pages/architecture.html)
- [OpenTelemetry with Jaeger](https://opentelemetry.io/docs/exporters/jaeger/)
- [OpenZipkin GitHub](https://github.com/openzipkin/zipkin)

Happy Coding
