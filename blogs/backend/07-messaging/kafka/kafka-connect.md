---
title: Kafka Connect
description: >-
  Implement Kafka Connect for streaming data between Kafka and external systems:
  source connectors, sink connectors, single message transforms, and production
  deployment
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - kafka
  - kafka-connect
  - connectors
  - data-integration
coverImage: /images/kafka-connect.png
draft: false
order: 10
---
## Overview

Kafka Connect is a framework for scalably and reliably streaming data between Apache Kafka and external systems. It provides source connectors for importing data into Kafka and sink connectors for exporting data out of Kafka, eliminating the need to write custom integration code.

## Architecture

Kafka Connect runs as a cluster of worker processes that distribute connector execution. Connectors are configured via REST API and can be scaled horizontally. The worker processes coordinate via internal Kafka topics (`connect-offsets`, `connect-configs`, `connect-status`) that store connector configurations, offset progress, and status information. The converters control serialization format — JSON is common for development, while Avro with Schema Registry is recommended for production.

```json
// connect-distributed.properties
{
  "bootstrap.servers": "localhost:9092",
  "group.id": "connect-cluster",
  "key.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "key.converter.schemas.enable": "true",
  "value.converter.schemas.enable": "true",
  "offset.storage.topic": "connect-offsets",
  "config.storage.topic": "connect-configs",
  "status.storage.topic": "connect-status",
  "offset.storage.replication.factor": 3,
  "config.storage.replication.factor": 3,
  "status.storage.replication.factor": 3
}
```

## Source Connector Example - JDBC Source

A source connector streams data from a relational database into Kafka topics. The JDBC source connector polls the database for new or changed rows. The `mode` parameter determines how changes are detected: `incrementing` uses an auto-increment column, `timestamp` uses a timestamp column, and `timestamp+incrementing` uses both for robustness. The `transforms` field applies a lightweight transformation (RegexRouter) to modify the output topic name.

```json
// POST /connectors
{
  "name": "jdbc-source-orders",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://postgres:5432/orders_db",
    "connection.user": "db_user",
    "connection.password": "${file:/etc/kafka-connect/credentials.properties:db_password}",
    "table.whitelist": "orders,order_items",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "topic.prefix": "jdbc-",
    "poll.interval.ms": "5000",
    "batch.max.rows": "1000",
    "transforms": "renamePrefix",
    "transforms.renamePrefix.type": "org.apache.kafka.connect.transforms.RegexRouter",
    "transforms.renamePrefix.regex": "jdbc-(.*)",
    "transforms.renamePrefix.replacement": "raw-$1"
  }
}
```

### JDBC Source with Timestamp + Incrementing Mode

The `timestamp+incrementing` mode provides the most reliable change capture for relational databases. It uses a timestamp column (`updated_at`) to detect changed rows and an incrementing column (`id`) to handle inserts that happen at the same timestamp. The `validate.non.null` setting ensures rows with null timestamp values are skipped, preventing data quality issues.

```json
{
  "name": "jdbc-source-orders-timestamp",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://postgres:5432/orders_db",
    "connection.user": "db_user",
    "connection.password": "${file:/etc/kafka-connect/credentials.properties:db_password}",
    "table.whitelist": "orders",
    "mode": "timestamp+incrementing",
    "timestamp.column.name": "updated_at",
    "incrementing.column.name": "id",
    "topic.prefix": "raw-",
    "poll.interval.ms": "3000",
    "validate.non.null": "true"
  }
}
```

## Sink Connector Example - Elasticsearch Sink

A sink connector streams data from Kafka topics into Elasticsearch. The connector reads from the `enriched-orders` topic and indexes documents into Elasticsearch. The `batch.size` and `linger.ms` control batching for throughput. The `transforms` field uses a `TimestampConverter` to normalize timestamp fields into a standard format before indexing. Setting `key.ignore=true` tells the connector to auto-generate document IDs rather than using Kafka message keys.

```json
{
  "name": "elasticsearch-sink-orders",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "connection.url": "http://elasticsearch:9200",
    "connection.username": "elastic",
    "connection.password": "${file:/etc/kafka-connect/credentials.properties:es_password}",
    "topics": "enriched-orders",
    "key.ignore": "true",
    "schema.ignore": "false",
    "type.name": "_doc",
    "batch.size": "500",
    "linger.ms": "1000",
    "max.retries": "5",
    "retry.backoff.ms": "5000",
    "transforms": "TimestampConverter",
    "transforms.TimestampConverter.type": "org.apache.kafka.connect.transforms.TimestampConverter$Value",
    "transforms.TimestampConverter.field": "created_at",
    "transforms.TimestampConverter.format": "yyyy-MM-dd'T'HH:mm:ss'Z'",
    "transforms.TimestampConverter.target.type": "string"
  }
}
```

## S3 Sink Connector

Stream Kafka data to Amazon S3 for archival and analytics. The S3 sink connector partitions data by time (year/month/day/hour) using a `TimeBasedPartitioner`, enabling efficient querying in analytical tools like Athena and Spark. Avro format provides compact binary encoding with schema support. The `flush.size` and `rotate.interval.ms` control how often files are closed and uploaded to S3, balancing latency against file size.

```json
{
  "name": "s3-sink-orders",
  "config": {
    "connector.class": "io.confluent.connect.s3.S3SinkConnector",
    "s3.bucket.name": "order-archive-bucket",
    "s3.region": "us-east-1",
    "s3.part.size": "5242880",
    "topics": "orders",
    "flush.size": "10000",
    "rotate.interval.ms": "600000",
    "storage.class": "io.confluent.connect.s3.storage.S3Storage",
    "format.class": "io.confluent.connect.s3.format.avro.AvroFormat",
    "partitioner.class": "io.confluent.connect.storage.partitioner.TimeBasedPartitioner",
    "path.format": "'year'=YYYY/'month'=MM/'day'=dd/'hour'=HH",
    "partition.duration.ms": "3600000",
    "timestamp.extractor": "RecordField",
    "timestamp.field": "created_at"
  }
}
```

## Single Message Transforms (SMTs)

SMTs allow lightweight message transformations without requiring Kafka Streams. The custom `FieldMask` transform masks sensitive fields (like PII) before data reaches the sink. SMTs run within the connector process and can modify keys, values, headers, or topics. They are stateless and operate on individual messages, making them ideal for simple filtering, renaming, and masking operations.

```java
// Custom SMT - Field Masking
public class FieldMask implements Transformation<R> {

    private String fieldName;
    private String maskWith;

    @Override
    public R apply(R record) {
        if (record.value() == null) return record;

        Schema schema = operatingSchema(record);
        Struct value = operatingValue(record);

        if (schema.field(fieldName) == null) return record;

        Object originalValue = value.get(fieldName);
        String maskedValue = maskWith.repeat(String.valueOf(originalValue).length());
        value.put(fieldName, maskedValue);

        return newRecord(record, schema, value);
    }

    @Override
    public ConfigDef config() {
        return new ConfigDef()
            .define("field.name", ConfigDef.Type.STRING, ConfigDef.Importance.HIGH, "Field to mask")
            .define("mask.with", ConfigDef.Type.STRING, "****", ConfigDef.Importance.MEDIUM, "Mask character");
    }

    @Override
    public void close() {}
}
```

## REST API Management

Kafka Connect provides a comprehensive REST API for managing connectors. The API allows you to create, update, pause, resume, restart, and delete connectors at runtime without restarting the Connect cluster. This is essential for operational workflows — you can reconfigure connectors, roll out new versions, and handle failures without downtime.

```bash
# List connectors
GET /connectors

# Create connector
POST /connectors

# Get connector status
GET /connectors/jdbc-source-orders/status

# Update connector config
PUT /connectors/jdbc-source-orders/config

# Pause connector
PUT /connectors/jdbc-source-orders/pause

# Resume connector
PUT /connectors/jdbc-source-orders/resume

# Restart connector
POST /connectors/jdbc-source-orders/restart

# Delete connector
DELETE /connectors/jdbc-source-orders
```

## Monitoring with JMX

Enable JMX metrics for monitoring connector performance and throughput. Metrics include records-per-second, latency, error rates, and task status. Monitoring is critical for production deployments — track connector lag, retry rates, and task failures to detect issues before they impact data pipelines.

```json
// connect-distributed.properties
{
  "metrics.jmx.enabled": "true",
  "metrics.reporters": "org.apache.kafka.connect.metrics.JmxReporter",
  "task.shutdown.graceful.timeout.ms": "30000",
  "connector.client.config.override.policy": "All"
}
```

## Dead Letter Queue (DLQ)

Configure a DLQ for handling connector errors without losing data. With `errors.tolerance=all`, the connector continues processing other messages even when individual messages fail. Failed messages are routed to the configured DLQ topic (`dlq-elasticsearch-orders`) with original headers and error details, allowing later analysis and reprocessing. Set `errors.log.include.messages=true` to log the full message content for debugging.

```json
{
  "name": "elasticsearch-sink-orders",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "errors.tolerance": "all",
    "errors.deadletterqueue.topic.name": "dlq-elasticsearch-orders",
    "errors.deadletterqueue.topic.replication.factor": "3",
    "errors.log.enable": "true",
    "errors.log.include.messages": "true",
    "errors.retry.timeout": "60000",
    "errors.retry.delay.max.ms": "5000"
  }
}
```

## Best Practices

- Use `errors.tolerance=all` with DLQ for production connectors to prevent message loss.
- Set `tasks.max` to at least `min(num_partitions, processing_capacity)` for parallelism.
- Use a dedicated Kafka Connect cluster isolated from producer/consumer applications.
- Store sensitive credentials in external files or secrets management systems.
- Configure `consumer.interceptor.classes` for monitoring connector consumer behavior.
- Use Schema Registry with Avro converters for type-safe data streaming.

## Common Mistakes

### Mistake: Not configuring error handling

Without `errors.tolerance=all`, a single bad message causes the connector task to fail and stop processing. All subsequent messages (good and bad) are blocked until the task is restarted. Always configure DLQ with error tolerance to prevent data pipeline outages.

```json
// Wrong - connector fails on any error, losing data
{
  "errors.tolerance": "none"
}
```

```json
// Correct - send errors to DLQ
{
  "errors.tolerance": "all",
  "errors.deadletterqueue.topic.name": "dlq-sink-orders"
}
```

### Mistake: Running connectors without Schema Registry for production

JSON converters with schemas disabled lose type information and make schema evolution impossible. In production, use Avro with Schema Registry to enforce data contracts, enable schema evolution, and reduce message size through compact binary encoding.

```json
// Wrong - fragile JSON schemas
{
  "key.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "key.converter.schemas.enable": "false"
}
```

```json
// Correct - Avro with Schema Registry
{
  "key.converter": "io.confluent.connect.avro.AvroConverter",
  "key.converter.schema.registry.url": "http://schema-registry:8081",
  "value.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter.schema.registry.url": "http://schema-registry:8081"
}
```

## Summary

Kafka Connect provides a reliable, scalable framework for integrating Kafka with external systems without writing custom code. By leveraging source and sink connectors with SMTs, DLQs, and Schema Registry, you can build production-grade data pipelines with minimal operational overhead.

## References

- [Kafka Connect Documentation](https://kafka.apache.org/documentation/#connect)
- [Confluent Hub - Connectors](https://www.confluent.io/hub/)
- [KIP-298: Error Handling in Kafka Connect](https://cwiki.apache.org/confluence/display/KAFKA/KIP-298:+Error+Handling+in+Kafka+Connect)

Happy Coding
