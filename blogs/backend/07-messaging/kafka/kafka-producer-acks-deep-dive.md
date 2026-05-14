---
title: Kafka Producer Acks Deep Dive
description: >-
  Deep dive into Kafka producer acknowledgment settings: acks=0, acks=1,
  acks=all, retries, idempotent producers, and delivery guarantees
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - kafka
  - producer
  - acks
  - idempotent
  - reliability
coverImage: /images/kafka-producer-acks-deep-dive.png
draft: false
order: 30
---
## Overview

Kafka producer acknowledgment settings determine the durability and consistency guarantees of published messages. Choosing the right acks configuration is critical for balancing throughput against data loss risk. This article explores acks=0, acks=1, and acks=all along with retries, idempotence, and exactly-once semantics.

## Producer Acks Configuration

The `acks` parameter controls how many partition replicas must acknowledge a write before the producer considers it successful. Understanding this trade-off is essential: lower acks means higher throughput but higher risk of data loss; higher acks provides stronger durability at the cost of latency.

### acks=0 (Fire-and-Forget)

The producer does not wait for any acknowledgment. Throughput is maximized but data loss is possible if the broker goes down. The producer sends the message and immediately continues — it has no idea if the broker received it. Use this only for metrics, logs, or other data where occasional loss is acceptable.

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

The producer waits for the leader replica to acknowledge. This provides a good balance between durability and latency. If the leader acknowledges but crashes before replicating to followers, the message could be lost during a leader election. This is the default setting and is suitable for most general-purpose use cases where a small window of data loss is acceptable.

```java
props.put(ProducerConfig.ACKS_CONFIG, "1");
```

### acks=all (or -1) (All In-Sync Replicas)

The producer waits for all in-sync replicas to acknowledge. This provides the strongest durability guarantee. Combined with `min.insync.replicas=2`, the producer ensures that at least 2 replicas have the message before considering the write successful. If the leader crashes, another in-sync replica has the data, so no messages are lost (assuming the minimum is met).

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.MIN_INSYNC_REPLICAS_CONFIG, "2");
```

## Retries and Retry Backoff

Retries handle transient broker failures. The `retries` and `retry.backoff.ms` settings control retry behavior. With `retries=Integer.MAX_VALUE` and `delivery.timeout.ms=120000`, the producer retries indefinitely within the delivery timeout window, giving the maximum chance of delivery. The `retry.backoff.ms` sets the time between retries to avoid overwhelming the broker. However, retries can cause duplicates unless idempotence is also enabled.

```java
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.RETRY_BACKOFF_MS_CONFIG, 100);
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120000);
```

With `retries=Integer.MAX_VALUE` and `delivery.timeout.ms=120000`, the producer retries indefinitely within the delivery timeout window.

## Idempotent Producer

Idempotent producers prevent duplicate messages caused by retries. Enable idempotence by setting `enable.idempotence=true`. When idempotence is enabled, Kafka automatically sets `acks=all` and `retries=Integer.MAX_VALUE`. The producer assigns a unique producer ID (PID) and sequence numbers to each message. The broker deduplicates based on (PID, sequence number), ensuring that even if a retry is sent, the broker recognizes it as a duplicate and discards it. This is a critical production setting.

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

Fire-and-forget has no delivery guarantee — if the broker crashes before persisting the message, the payment data is lost. Financial transactions require the strongest durability: `acks=all` with idempotence enabled.

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

Retries without idempotence can cause duplicate messages: the producer sends a message, the broker acknowledges it, but the ack is lost in transit. The producer retries (thinking it failed), and the broker accepts the duplicate. Always enable idempotence when retries are configured.

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
