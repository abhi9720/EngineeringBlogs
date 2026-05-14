---
title: "Kafka Streams vs Consumer API"
description: "Compare Kafka Streams API with the consumer API for stream processing: when to use each, stateful vs stateless operations, exactly-once semantics, and real-world use cases"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - kafka
  - kafka-streams
  - consumer-api
  - stream-processing
coverImage: "/images/kafka-streams-vs-consumers.png"
draft: false
---

## Overview

Kafka offers two primary APIs for consuming and processing messages: the Consumer API and Kafka Streams. While the Consumer API provides low-level access to message consumption, Kafka Streams is a higher-level stream processing library that enables stateful transformations, joins, and exactly-once semantics without external dependencies.

## Consumer API

The Consumer API gives you full control over message consumption, offset management, and threading. This is the right choice when you need a simple consume-process loop, custom threading models, or integration with existing frameworks. The example below shows a manual offset commit pattern: poll records, process each one, then commit synchronously. This gives at-least-once semantics — if the consumer crashes between processing and commit, the messages are redelivered.

```java
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-processor");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "500");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("orders", "payments"));

try {
    while (true) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
        for (ConsumerRecord<String, String> record : records) {
            processRecord(record);
        }
        consumer.commitSync();
    }
} finally {
    consumer.close();
}
```

## Kafka Streams API

Kafka Streams builds on the Consumer API and adds stream processing capabilities including stateful operations, joins, and windowing. The Streams DSL abstracts away the complexity of managing threads, partitions, and state stores. In the example below, an orders stream is enriched by joining with a product catalog table, and the result is written to an enriched topic. The `application.id` serves as the consumer group ID and determines the state store directory.

```java
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "order-stream-processor");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);

StreamsBuilder builder = new StreamsBuilder();

KStream<String, String> orders = builder.stream("orders");
KTable<String, String> productCatalog = builder.table("product-catalog", Consumed.with(Serdes.String(), Serdes.String()));

KStream<String, String> enrichedOrders = orders
    .filter((key, value) -> value != null)
    .mapValues(OrderParser::parse)
    .join(
        productCatalog,
        (orderJson, catalogJson) -> enrichOrder(orderJson, catalogJson),
        Joined.with(Serdes.String(), Serdes.String(), Serdes.String())
    );

enrichedOrders.to("enriched-orders", Produced.with(Serdes.String(), Serdes.String()));

KafkaStreams streams = new KafkaStreams(builder.build(), props);
streams.start();

Runtime.getRuntime().addShutdownHook(new Thread(streams::close));
```

## Stateful Operations with Kafka Streams

Kafka Streams supports stateful operations through state stores, which are fault-tolerant RocksDB-backed key-value stores. State stores are the key differentiator from the Consumer API — they allow operations like windowed aggregations, joins, and sessionization without external databases. The example below aggregates sales by product in 5-minute windows, with the state automatically persisted to RocksDB and backed up to a Kafka changelog topic for fault tolerance.

```java
public class WindowedAggregationExample {

    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "sales-aggregator");
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
        props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());
        props.put(StreamsConfig.STATE_DIR_CONFIG, "/tmp/kafka-streams");

        StreamsBuilder builder = new StreamsBuilder();

        KStream<String, String> sales = builder.stream("sales");

        sales
            .mapValues(Sale::fromJson)
            .groupBy((key, sale) -> sale.getProductId(), Grouped.with(Serdes.String(), saleSerde))
            .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
            .aggregate(
                SaleAggregate::new,
                (key, sale, aggregate) -> aggregate.add(sale),
                Materialized.with(Serdes.String(), saleAggregateSerde)
            )
            .toStream()
            .map((windowedKey, aggregate) -> KeyValue.pair(windowedKey.key(), aggregate.toJson()))
            .to("sales-aggregates", Produced.with(Serdes.String(), Serdes.String()));

        KafkaStreams streams = new KafkaStreams(builder.build(), props);
        streams.start();
    }
}
```

## Exactly-Once Semantics Comparison

### Consumer API with Idempotent Writes

Achieving exactly-once with the Consumer API requires manual offset management and transactional coordination. You need to create the producer with a unique `transactional.id`, begin a transaction for each poll batch, process records, send results to an output topic, and atomically commit both the output messages and the consumer offsets via `sendOffsetsToTransaction`. This is error-prone and requires careful exception handling.

```java
Properties props = new Properties();
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
props.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("source-topic"));

KafkaProducer<String, String> producer = createIdempotentProducer();

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    producer.beginTransaction();
    try {
        for (ConsumerRecord<String, String> record : records) {
            String result = process(record.value());
            producer.send(new ProducerRecord<>("sink-topic", result));
        }
        producer.sendOffsetsToTransaction(
            getOffsets(records), consumer.groupMetadata().groupId());
        producer.commitTransaction();
    } catch (Exception e) {
        producer.abortTransaction();
    }
}
```

### Kafka Streams Exactly-Once

Kafka Streams provides exactly-once semantics out of the box with a single configuration. Setting `processing.guarantee=exactly_once_v2` enables end-to-end exactly-once: the library handles transactional fencing, offset management, and state store commits automatically. This is dramatically simpler than the Consumer API approach — no manual transaction management, no separate producer, no offset tracking.

```java
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);
```

## When to Use Each

### Consumer API is better for

Simple message processing with custom thread management. The `SimpleConsumer` uses a thread pool to process records concurrently, which is more flexible than Kafka Streams' fixed thread model. Use the Consumer API when you need fine-grained control over threading, want to use a different processing framework, or have simple consume-process patterns that don't need state.

```java
// Simple message processing with custom thread management
public class SimpleConsumer {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public void consume() {
        try (KafkaConsumer<String, byte[]> consumer = createConsumer()) {
            consumer.subscribe(Collections.singletonList("raw-events"));
            while (true) {
                ConsumerRecords<String, byte[]> records = consumer.poll(Duration.ofMillis(100));
                List<Future<?>> futures = new ArrayList<>();
                for (ConsumerRecord<String, byte[]> record : records) {
                    futures.add(executor.submit(() -> processRecord(record)));
                }
                for (Future<?> future : futures) {
                    future.get();
                }
                consumer.commitSync();
            }
        }
    }
}
```

### Kafka Streams is better for

Complex stream processing with joins and aggregations. The `StreamProcessor` joins three streams/tables (orders, customers, products) with just a few lines of DSL code. Doing the same with the Consumer API would require manual state management, join logic, and windowing — all of which Kafka Streams provides out of the box with fault-tolerant state stores.

```java
// Complex stream processing with joins and aggregations
public class StreamProcessor {
    public void process() {
        StreamsBuilder builder = new StreamsBuilder();

        KStream<String, Order> orders = builder.stream("orders", Consumed.with(Serdes.String(), orderSerde));
        KTable<String, Customer> customers = builder.table("customers", Consumed.with(Serdes.String(), customerSerde));
        GlobalKTable<String, Product> products = builder.globalTable("products", Consumed.with(Serdes.String(), productSerde));

        orders
            .join(customers, (order, customer) -> order.withCustomer(customer))
            .join(products, (order, product) -> order.withProduct(product))
            .filter((key, enriched) -> enriched.isValid())
            .to("validated-orders", Produced.with(Serdes.String(), enrichedOrderSerde));
    }
}
```

## Best Practices

- Use Consumer API for simple consume-process-produce patterns or when you need custom threading models.
- Use Kafka Streams for stateful processing, joins, aggregations, and when exactly-once semantics are required.
- Always configure `processing.guarantee=exactly_once_v2` in Kafka Streams for production.
- Set appropriate RocksDB memory limits when using state stores.
- Monitor consumer lag and stream thread metrics via JMX.

## Common Mistakes

### Mistake: Reimplementing stateful operations with Consumer API

Using a `ConcurrentHashMap` for in-memory aggregation is simple but not fault-tolerant — all state is lost on restart. For production stateful processing, use Kafka Streams' built-in state stores (backed by RocksDB with Kafka changelog topics). They provide exactly-once state semantics, automatic recovery, and no data loss.

```java
// Wrong - manual state management is error-prone
private final Map<String, Aggregate> inMemoryState = new ConcurrentHashMap<>();

void processRecord(ConsumerRecord<String, String> record) {
    inMemoryState.compute(record.key(), (k, v) -> {
        if (v == null) return new Aggregate(record.value());
        return v.merge(record.value());
    });
}
// State lost on restart!
```

```java
// Correct - use Kafka Streams state stores
KGroupedStream<String, String> grouped = stream.groupByKey();
grouped.aggregate(
    Aggregate::new,
    (key, value, aggregate) -> aggregate.merge(value),
    Materialized.as("persistent-aggregate-store")
);
```

### Mistake: Using Consumer API for stream-stream joins

Stream-stream joins require windowing, state management, and handling out-of-order events. Reimplementing this with the Consumer API requires managing a state store, maintaining window boundaries, and handling late-arriving data. Kafka Streams' join operators handle all of this with configurable windows and grace periods.

```java
// Wrong - manual join logic is complex and fragile
```

```java
// Correct - Kafka Streams join operator
KStream<String, Enriched> joined = leftStream.join(
    rightStream,
    (leftValue, rightValue) -> new Enriched(leftValue, rightValue),
    JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(5)),
    StreamJoined.with(Serdes.String(), leftSerde, rightSerde)
);
```

## Summary

Choose the Consumer API for simple, low-level message consumption and custom threading. Choose Kafka Streams for complex stream processing requiring stateful operations, joins, windowing, and built-in exactly-once semantics. Kafka Streams eliminates the operational complexity of managing external stream processing frameworks.

## References

- [Kafka Streams Documentation](https://kafka.apache.org/documentation/streams/)
- [Confluent Blog - Kafka Streams vs Consumer API](https://www.confluent.io/blog/kafka-streams-vs-kafka-consumer-api/)
- [KIP-618: Exactly-Once Semantics for Kafka Streams](https://cwiki.apache.org/confluence/display/KAFKA/KIP-618:+Exactly-Once+Semantics+for+Kafka+Streams)

Happy Coding
