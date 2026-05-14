---
title: "ELK Stack Setup"
description: "Set up Elasticsearch, Logstash, and Kibana pipeline for centralized log management and analysis"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - logging
  - elasticsearch
  - logstash
  - kibana
coverImage: "/images/elk-stack-setup.png"
draft: false
---

# ELK Stack Setup

## Overview

The ELK stack—Elasticsearch, Logstash, Kibana—is the most popular open-source log management platform. Elasticsearch stores and indexes logs, Logstash ingests and transforms them, and Kibana provides visualization and analysis.

### Architecture

```mermaid
flowchart LR
    App["Application"] --> FB["Filebeat<br/>(ship)"]
    FB --> LS["Logstash<br/>(parse)"]
    LS --> ES["Elasticsearch<br/>(store)"]
    ES --> KI["Kibana<br/>(visualize)"]

    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff
    linkStyle default stroke:#278ea5

    class App yellow
    class FB,LS green
    class ES,KI blue
```

---

## Elasticsearch Setup

### Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
    container_name: elasticsearch
    environment:
      - node.name=es01
      - cluster.name=elk-cluster
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - "ES_JAVA_OPTS=-Xms4g -Xmx4g"
      - xpack.security.enabled=false
    ulimits:
      memlock:
        soft: -1
        hard: -1
    volumes:
      - es-data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
      - "9300:9300"
    networks:
      - elk

  logstash:
    image: docker.elastic.co/logstash/logstash:8.12.0
    container_name: logstash
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
      - ./logstash/config:/usr/share/logstash/config
    ports:
      - "5000:5000"
      - "5001:5001"
    environment:
      - LS_JAVA_OPTS=-Xms2g -Xmx2g
    depends_on:
      - elasticsearch
    networks:
      - elk

  kibana:
    image: docker.elastic.co/kibana/kibana:8.12.0
    container_name: kibana
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch
    networks:
      - elk

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.12.0
    container_name: filebeat
    volumes:
      - ./filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml
      - /var/log:/var/log:ro
    depends_on:
      - logstash
    networks:
      - elk

volumes:
  es-data:
    driver: local

networks:
  elk:
    driver: bridge
```

Memory allocation is the most critical configuration for Elasticsearch. Setting `bootstrap.memory_lock=true` prevents the JVM heap from being swapped to disk, which would cause catastrophic performance degradation. The heap size of 4 GB (`-Xms4g -Xmx4g`) is appropriate for a single-node development cluster; production clusters should allocate no more than 50% of available RAM to the heap, with the remainder reserved for the OS filesystem cache. Logstash also requires significant memory—the pipeline workers, persistent queues, and input/output plugins all operate within the JVM heap.

### Index Template Configuration

```json
// es-index-template.json
{
  "index_patterns": ["app-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.refresh_interval": "5s",
      "index.translog.durability": "async",
      "index.translog.sync_interval": "5s",
      "index.codec": "best_compression"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "severity": { "type": "keyword" },
        "message": { "type": "text" },
        "logger": { "type": "keyword" },
        "thread": { "type": "keyword" },
        "service": { "type": "keyword" },
        "environment": { "type": "keyword" },
        "correlation_id": { "type": "keyword" },
        "duration_ms": { "type": "long" },
        "error_type": { "type": "keyword" },
        "user_id": { "type": "keyword" },
        "request_path": { "type": "keyword" },
        "status_code": { "type": "integer" }
      }
    }
  }
}
```

The index template applies settings and mappings to all indices matching `app-logs-*`. The `best_compression` codec trades a small CPU overhead for significantly reduced storage compared to the default `LZ4`. Setting `translog.durability: async` and `sync_interval: 5s` reduces write overhead by not flushing the transaction log on every request—acceptable for logging where a few seconds of data loss on crash is tolerable. The `refresh_interval: 5s` means newly indexed logs appear in search results within 5 seconds instead of the default 1 second, reducing indexing pressure.

### Lifecycle Policy

```json
// ILM policy for log retention
PUT _ilm/policy/app-logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {}
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

The Index Lifecycle Management policy automates index rotation and retention. The `hot` phase rolls over the write index when it reaches 50 GB or 24 hours, preventing any single index from growing too large. After 7 days in `warm`, the index is shrunk to a single shard and force-merged to one segment—optimizing for read performance at the cost of writeability. After 90 days the data is deleted entirely, matching common compliance requirements.

---

## Logstash Pipeline Configuration

### Main Pipeline

```ruby
# logstash/pipeline/main.conf
input {
  beats {
    port => 5000
    client_inactivity_timeout => 60
  }

  tcp {
    port => 5001
    codec => json
  }
}

filter {
  # Parse timestamp
  date {
    match => ["timestamp", "ISO8601"]
    target => "@timestamp"
  }

  # Add environment information
  mutate {
    add_field => {
      "[@metadata][index_prefix]" => "app-logs"
    }
  }

  # Parse stack traces
  grok {
    match => {
      "message" => ".*%{JAVASTACKTRACEPART:stack_trace}.*"
    }
    tag_on_failure => []
  }

  # Extract common fields
  grok {
    match => {
      "message" => "duration=(?<duration_ms>\d+)"
    }
    tag_on_failure => []
  }

  # GeoIP lookup for IP addresses
  geoip {
    source => "client_ip"
    target => "geo"
  }
}

output {
  elasticsearch {
    hosts => ["${ES_HOSTS}"]
    index => "app-logs-%{+YYYY.MM.dd}"
    user => "${ES_USER}"
    password => "${ES_PASSWORD}"
    ilm_rollover_alias => "app-logs"
    ilm_pattern => "000001"
    ecs_compatibility => "disabled"
  }

  # Debug output
  stdout {
    codec => rubydebug
  }
}
```

Logstash accepts input from multiple sources in parallel. The Beats input receives logs from Filebeat (the primary path), while the TCP input allows applications to send JSON logs directly for testing. The `date` filter parses the application's timestamp and sets `@timestamp`, which Elasticsearch uses as the default time field for time-based queries. The `grok` filters extract structured fields (stack traces, duration) from unstructured message text without failing if the pattern does not match.

### Multiple Pipeline Support

```ruby
# logstash/pipeline/application.conf
input {
  beats {
    port => 5044
    tags => ["application"]
  }
}

filter {
  if "application" in [tags] {
    grok {
      match => { "message" => "%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:severity} \[%{DATA:thread}\] %{DATA:logger} - %{GREEDYDATA:log_message}" }
    }

    json {
      source => "log_message"
      skip_on_invalid_json => true
      tag_on_failure => []
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "application-logs-%{+YYYY.MM.dd}"
  }
}
```

Multiple pipelines allow different log sources to have independent processing logic. The application pipeline parses standard Java log patterns with grok and attempts JSON parsing on the extracted message—supporting both legacy plain-text logs and modern structured logs from the same input stream.

---

## Filebeat Configuration

### Log Shipping

```yaml
# filebeat/filebeat.yml
filebeat.inputs:
- type: container
  paths:
    - /var/log/containers/*.log
  processors:
    - add_kubernetes_metadata:
        host: ${NODE_NAME}
        matchers:
        - logs_path:
            logs_path: "/var/log/containers/"

- type: log
  enabled: true
  paths:
    - /var/log/applications/*.log
  fields:
    service: my-app
    environment: production
  multiline:
    pattern: '^\d{4}-\d{2}-\d{2}'
    negate: true
    match: after

output.logstash:
  hosts: ["logstash:5000"]
  bulk_max_size: 2048
  worker: 4

logging.level: info
```

The multiline configuration is essential for Java applications where stack traces span multiple lines. The pattern matches lines that start with a date (`YYYY-MM-DD`)—any line that does NOT match this pattern is considered a continuation of the previous log entry. This ensures that a 30-line stack trace is shipped as a single event rather than 30 separate log entries.

---

## Kibana Setup

### Index Pattern Configuration

```json
// Create index pattern via API
POST kibana/api/data_views/data_view
{
  "data_view": {
    "title": "app-logs-*",
    "name": "Application Logs",
    "timeFieldName": "@timestamp",
    "fields": [
      {"name": "severity", "type": "string"},
      {"name": "service", "type": "string"},
      {"name": "duration_ms", "type": "number"},
      {"name": "status_code", "type": "number"}
    ]
  }
}
```

### Dashboard Configuration

```json
// Sample dashboard panels (simplified)
{
  "panels": [
    {
      "title": "Error Rate Over Time",
      "type": "line",
      "metrics": [{"type": "count", "field": "severity"}],
      "buckets": [{"type": "date_histogram", "field": "@timestamp"}],
      "query": "severity:ERROR"
    },
    {
      "title": "Top Error Endpoints",
      "type": "pie",
      "metrics": [{"type": "count"}],
      "buckets": [{"type": "terms", "field": "request_path"}],
      "query": "severity:ERROR"
    },
    {
      "title": "Response Time Distribution",
      "type": "histogram",
      "metrics": [{"type": "percentiles", "field": "duration_ms"}],
      "buckets": [{"type": "terms", "field": "service"}]
    }
  ]
}
```

---

## Best Practices

### 1. Index Lifecycle Management

```java
@Component
public class ElasticsearchConfig {

    @EventListener(ApplicationReadyEvent.class)
    public void setupILM() {
        PutLifecyclePolicyRequest request = new PutLifecyclePolicyRequest(
            "app-logs-policy",
            50_000_000_000L,  // 50GB rollover
            86_400_000L,      // 1 day rollover
            604_800_000L,     // 7 days to warm
            2_592_000_000L,   // 30 days to cold
            7_776_000_000L    // 90 days to delete
        );
        // Apply policy
    }
}
```

### 2. Log Structuring for ELK

```java
@Service
public class ElkOptimizedLogger {

    private static final Logger log = LoggerFactory.getLogger(ElkOptimizedLogger.class);

    public void logOrderEvent(Order order) {
        // Use structured logging with proper fields for Elasticsearch
        log.info("Order event: orderId={}, customerId={}, status={}, total={}, items={}",
            order.getId(),
            order.getCustomerId(),
            order.getStatus(),
            order.getTotal(),
            order.getItemCount());
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Configuring Shards Properly

```json
// WRONG: Too many shards
{
  "settings": {
    "number_of_shards": 50,
    "number_of_replicas": 2
  }
}

// CORRECT: Match shard count to cluster size
{
  "settings": {
    "number_of_shards": 5,
    "number_of_replicas": 1
  }
}
```

### Mistake 2: No ILM Policy

```json
// No ILM results in unbounded index growth
// CORRECT: Always set up ILM
```

### Mistake 3: Missing Multiline Handling

```ruby
# WRONG: Stack traces split across multiple log entries
# Single line mode breaks multi-line exceptions

# CORRECT: Multiline handling in Filebeat
multiline:
  pattern: '^\d{4}-\d{2}-\d{2}'
  negate: true
  match: after
```

---

## Summary

The ELK stack provides a complete log management solution:

1. Elasticsearch stores and indexes logs for fast search
2. Logstash transforms and enriches log data
3. Kibana visualizes and analyzes logs
4. Filebeat ships logs from application servers
5. ILM manages index lifecycle automatically
6. Proper structuring ensures effective searching

---

## References

- [Elasticsearch Reference](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
- [Logstash Configuration](https://www.elastic.co/guide/en/logstash/current/configuration.html)
- [Kibana Guide](https://www.elastic.co/guide/en/kibana/current/index.html)
- [Filebeat Reference](https://www.elastic.co/guide/en/beats/filebeat/current/index.html)

Happy Coding
