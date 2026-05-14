---
title: "Kafka Producer Acks Deep Dive"
description: "Deep dive into Kafka producer acknowledgment settings: acks=0, acks=1, acks=all, retries, idempotent producers, and delivery guarantees"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - kafka
  - producer
  - acks
  - idempotent
  - reliability
coverImage: "/images/kafka-producer-acks-deep-dive.png"
draft: false
---

## Overview

Kafka producer acknowledgment settings determine the durability and consistency guarantees of published messages. Choosing the right acks configuration is critical for balancing throughput against data loss risk. This article explores acks=0, acks=1, and acks=all along with retries, idempotence, and exactly-once semantics.

## Producer Acks Configuration

The `acks` parameter controls how many partition replicas must acknowledge a write before the producer considers it successful.

### acks=0 (Fire-and-Forget)

The producer does not wait for any acknowledgment. Throughput is maximized but data loss is possible if the broker goes down.

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.ACKS_CONFIG, "0");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.send(new ProducerRecord<>("my-topic", "key", "value"));
producer.flush();
```

### acks=1 (Leader Acknowledgment)

The producer waits for the leader replica to acknowledge. This provides a good balance between durability and latency.

```java
props.put(ProducerConfig.ACKS_CONFIG, "1");
```

### acks=all (or -1) (All In-Sync Replicas)

The producer waits for all in-sync replicas to acknowledge. This provides the strongest durability guarantee.

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.MIN_INSYNC_REPLICAS_CONFIG, "2");
```

## Retries and Retry Backoff

Retries handle transient broker failures. The `retries` and `retry.backoff.ms` settings control retry behavior.

```java
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.RETRY_BACKOFF_MS_CONFIG, 100);
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120000);
```

With `retries=Integer.MAX_VALUE` and `delivery.timeout.ms=120000`, the producer retries indefinitely within the delivery timeout window.

## Idempotent Producer

Idempotent producers prevent duplicate messages caused by retries. Enable idempotence by setting `enable.idempotence=true`.

```java
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
```

When idempotence is enabled, Kafka automatically sets `acks=all` and `retries=Integer.MAX_VALUE`. The producer assigns a unique producer ID (PID) and sequence numbers to each message. The broker deduplicates based on these.

```java
public class IdempotentProducerExample {

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());

        KafkaProducer<String, String> producer = new KafkaProducer<>(props);

        for (int i = 0; i < 100; i++) {
            producer.send(new ProducerRecord<>("idempotent-topic", "key-" + i, "value-" + i),
                (metadata, exception) -> {
                    if (exception != null) {
                        System.err.println("Error sending record: " + exception.getMessage());
                    } else {
                        System.out.printf("Sent to partition %d offset %d%n",
                            metadata.partition(), metadata.offset());
                    }
                });
        }
        producer.flush();
        producer.close();
    }
}
```

## Best Practices

- Use `acks=all` with `min.insync.replicas=2` for production workloads requiring strong durability.
- Always enable idempotence when retries are configured to avoid duplicates.
- Set `delivery.timeout.ms` to bound retry duration rather than relying on `retries` alone.
- Monitor `kafka.producer:type=producer-metrics` for request latency and error rates.
- Configure `max.in.flight.requests.per.connection=5` (default) or `1` when idempotence is off with retries to prevent reordering.

## Common Mistakes

### Mistake: Using acks=0 with critical financial transactions

```java
// Wrong - data loss risk
Properties props = new Properties();
props.put(ProducerConfig.ACKS_CONFIG, "0");
producer.send(new ProducerRecord<>("payments", orderId, paymentJson));
```

```java
// Correct - durable delivery
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
producer.send(new ProducerRecord<>("payments", orderId, paymentJson));
```

### Mistake: Enabling retries without idempotence

```java
// Wrong - potential duplicates on retry
props.put(ProducerConfig.ACKS_CONFIG, "1");
props.put(ProducerConfig.RETRIES_CONFIG, 3);
```

```java
// Correct - idempotent retries
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
```

## Summary

The acks setting is the primary knob for balancing throughput and durability in Kafka producers. For most production systems, `acks=all` with idempotence enabled is the recommended configuration. Understanding the interaction between acks, retries, and idempotence is essential for building reliable event-driven systems.

## References

- [Kafka Documentation - Producer Configs](https://kafka.apache.org/documentation/#producerconfigs)
- [Kafka Idempotent Producer](https://cwiki.apache.org/confluence/display/KAFKA/Idempotent+Producer)
- [Confluent Documentation - Exactly-Once Semantics](https://docs.confluent.io/platform/current/security/security_tutorial.html)

Happy Coding