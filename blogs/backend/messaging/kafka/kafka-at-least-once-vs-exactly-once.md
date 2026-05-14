---
title: "Kafka Delivery Semantics: At-Least-Once vs Exactly-Once"
description: "Deep dive into Kafka delivery semantics: at-most-once, at-least-once, exactly-once for producers and consumers, transaction API, and idempotent consumers"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - kafka
  - delivery-semantics
  - exactly-once
  - transactions
coverImage: "/images/kafka-at-least-once-vs-exactly-once.png"
draft: false
---

## Overview

Delivery semantics define how Kafka guarantees message delivery between producers and consumers. Understanding at-most-once, at-least-once, and exactly-once semantics is critical for designing reliable data pipelines. This article covers each semantic in depth along with implementation patterns.

## At-Most-Once Semantics

Messages are delivered zero or one time. If the producer fails or times out, the message may be lost. Use when throughput is priority over data completeness.

```java
Properties props = new Properties();
props.put(ProducerConfig.ACKS_CONFIG, "0");
props.put(ProducerConfig.RETRIES_CONFIG, "0");
```

At-most-once is typically used for metrics or logging where occasional data loss is acceptable.

## At-Least-Once Semantics

Messages are delivered one or more times. The producer retries on failure, but retries may cause duplicates.

```java
Properties props = new Properties();
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.RETRIES_CONFIG, 5);
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, false);
```

On the consumer side, at-least-once is achieved by committing offsets after processing.

```java
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        processRecord(record); // Process before commit
    }
    consumer.commitSync(); // Commit after successful processing
}
```

## Exactly-Once Semantics

Exactly-once ensures messages are processed exactly one time, even in the presence of failures. Achieving exactly-once requires coordination across producers, brokers, and consumers.

### Idempotent Producer

Enable idempotence to prevent duplicate messages caused by producer retries.

```java
Properties props = new Properties();
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);
```

### Transactional Producer

Kafka transactions enable atomic writes across multiple partitions and topics.

```java
Properties props = new Properties();
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-processor-1");
props.put(ProducerConfig.ACKS_CONFIG, "all");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("orders", "order-1", "{\"id\": 1}"));
    producer.send(new ProducerRecord<>("audit", "order-1", "{\"action\": \"created\"}"));
    producer.commitTransaction();
} catch (ProducerFencedException e) {
    producer.abortTransaction();
}
```

### Exactly-Once Consumer

Combine transactional producers with consumer offset management for end-to-end exactly-once.

```java
Properties consumerProps = new Properties();
consumerProps.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
consumerProps.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");

Properties producerProps = new Properties();
producerProps.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "exactly-once-processor");
producerProps.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps);
KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);

producer.initTransactions();

consumer.subscribe(Collections.singletonList("input-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    producer.beginTransaction();
    try {
        Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();

        for (ConsumerRecord<String, String> record : records) {
            String transformed = transform(record.value());
            producer.send(new ProducerRecord<>("output-topic", transformed));

            offsets.put(
                new TopicPartition(record.topic(), record.partition()),
                new OffsetAndMetadata(record.offset() + 1)
            );
        }

        producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata().groupId());
        producer.commitTransaction();
    } catch (Exception e) {
        producer.abortTransaction();
        // Seek back to last committed offsets and retry
    }
}
```

## Idempotent Consumer Pattern

When exactly-once EOS is not feasible, implement idempotent consumers that deduplicate messages.

```java
@Component
public class IdempotentOrderConsumer {

    private final JdbcTemplate jdbcTemplate;

    public void consumeOrder(OrderEvent event) {
        jdbcTemplate.update(
            "INSERT INTO processed_orders (order_id, processed_at) VALUES (?, NOW()) ON CONFLICT (order_id) DO NOTHING",
            event.getOrderId()
        );

        Integer duplicate = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM processed_orders WHERE order_id = ?",
            Integer.class, event.getOrderId()
        );

        if (duplicate == null || duplicate == 0) {
            processOrder(event);
        }
    }
}
```

### Using Redis for Idempotency

```java
@Component
public class RedisIdempotencyChecker {

    private final StringRedisTemplate redisTemplate;

    public boolean isDuplicate(String messageId) {
        return Boolean.TRUE.equals(
            redisTemplate.opsForValue().setIfAbsent("processed:" + messageId, "1", Duration.ofHours(24))
        );
    }

    public void consume(String messageId, Runnable processor) {
        if (!isDuplicate(messageId)) {
            processor.run();
        }
    }
}
```

## EOS with Kafka Streams

Kafka Streams provides exactly-once semantics with minimal configuration.

```java
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "stream-processor");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 100);
```

## Comparison Table

| Semantic | Producer Config | Consumer Config | Use Case |
|----------|---------------|-----------------|----------|
| At-Most-Once | acks=0, retries=0 | auto commit before processing | Metrics, logs |
| At-Least-Once | acks=all, retries>0 | commit after processing | General purpose |
| Exactly-Once | idempotent + transactional | read_committed + transaction | Financial, critical data |

## Best Practices

- Use exactly-once semantics for financial transactions and critical business events.
- Use at-least-once for most general-purpose event processing.
- Implement idempotent consumers as a safety net when EOS is not configured.
- Set `isolation.level=read_committed` for consumers reading transactional topics.
- Use unique message IDs for application-level deduplication.
- Monitor `kafka.producer:type=producer-metrics` for transaction success rate.

## Common Mistakes

### Mistake: Confusing idempotent producer with exactly-once delivery

```java
// Wrong - idempotent producer prevents duplicates on broker, not end-to-end
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
```

```java
// Correct - end-to-end exactly-once requires transactions
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "processor-1");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
// Consumer must use read_committed
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
```

### Mistake: Forgetting to set isolation level on consumer

```java
// Wrong - consumer sees uncommitted and aborted messages
KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
```

```java
// Correct - only read committed messages
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
```

## Summary

Choose delivery semantics based on business requirements. At-least-once with idempotent consumers is suitable for most systems. Exactly-once using Kafka transactions is necessary for systems where duplicates are unacceptable. Always configure consumer isolation level appropriately when using transactional producers.

## References

- [Kafka Documentation - Exactly-Once Semantics](https://kafka.apache.org/documentation/#semantics)
- [Confluent Blog - Exactly-Once Semantics](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- [KIP-129: Exactly-Once Kafka Producer](https://cwiki.apache.org/confluence/display/KAFKA/KIP-129:+Exactly+Once+Kafka+Producer)

Happy Coding