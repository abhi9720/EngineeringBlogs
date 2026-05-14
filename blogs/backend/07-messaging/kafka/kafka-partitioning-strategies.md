---
title: Kafka Partitioning Strategies
description: >-
  Comprehensive guide to Kafka partitioning strategies: default partitioning,
  custom partitioners, sticky partitioning, and performance optimization
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - kafka
  - partitioning
  - custom-partitioner
  - performance
coverImage: /images/kafka-partitioning-strategies.png
draft: false
order: 20
---
## Overview

Partitioning is the core mechanism that enables Kafka's scalability and parallelism. Choosing the right partitioning strategy directly impacts throughput, ordering guarantees, and consumer load balancing. This article covers default partitioning, custom partitioners, sticky partitioning, and best practices for partition count decisions.

## Default Partitioning Behavior

When a producer sends a record with a key, Kafka uses the default partitioner which computes `hash(key) % numPartitions`. Records with the same key always go to the same partition, preserving order per key. This is critical for event-sourced systems where all events for a given entity (identified by key) must be processed in order. The key to use should be the entity's natural identifier (user ID, order ID, etc.), not a random or timestamp value.

```java
// Key-based partitioning preserves order for same key
ProducerRecord<String, String> record = new ProducerRecord<>("orders", "user-1234", orderJson);
```

When no key is provided (null key), the default partitioner uses a round-robin strategy in older versions or sticky partitioning in Kafka 2.4+.

## Sticky Partitioner (Kafka 2.4+)

The sticky partitioner batches records to the same partition before switching, improving throughput by reducing the number of batches. In the round-robin approach, each record was sent to a different partition, resulting in many small, inefficient batches. The sticky partitioner sends multiple records to the same partition (while it's available), achieving larger batch sizes and better compression. The `linger.ms` and `batch.size` settings control how long the producer waits to fill a batch before sending.

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.PARTITIONER_CLASS_CONFIG, "org.apache.kafka.clients.producer.internals.DefaultPartitioner");
// Sticky partitioning is used by default when key is null
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, "33554432");
props.put(ProducerConfig.LINGER_MS_CONFIG, "100");
props.put(ProducerConfig.BATCH_SIZE_CONFIG, "65536");
```

## Custom Partitioner

Implement the `Partitioner` interface to define custom partitioning logic based on business rules. This is useful when the default hash-based partitioning doesn't match your requirements — for example, routing all VIP orders to a dedicated partition for priority processing, or partitioning by geographic region to optimize latency. The `UserRegionPartitioner` below maps US and EU regions to specific partitions, ensuring that all messages for a region land in the same partition for regional processing.

```java
public class UserRegionPartitioner implements Partitioner {

    private Map<String, Integer> regionToPartition;

    @Override
    public void configure(Map<String, ?> configs) {
        regionToPartition = new HashMap<>();
        regionToPartition.put("US-EAST", 0);
        regionToPartition.put("US-WEST", 1);
        regionToPartition.put("EU-WEST", 2);
        regionToPartition.put("EU-CENTRAL", 3);
    }

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        if (keyBytes == null || keyBytes.length == 0) {
            return 0;
        }
        String keyStr = (String) key;
        String region = extractRegion(keyStr);
        return regionToPartition.getOrDefault(region, 0);
    }

    private String extractRegion(String key) {
        return key.split(":")[0];
    }

    @Override
    public void close() {}

    @Override
    public void onNewBatch(String topic, Cluster cluster, int prevPartition) {}
}
```

Register the custom partitioner in producer properties:

```java
Properties props = new Properties();
props.put(ProducerConfig.PARTITIONER_CLASS_CONFIG, UserRegionPartitioner.class.getName());
```

### Custom Partitioner with Spring Boot

The `OrderPartitioner` demonstrates a more complex business rule: VIP orders (key starting with "VIP-") go to partition 0 for priority processing, 20% of non-VIP traffic is distributed across a dedicated range, and the remaining 80% goes to the rest. This ensures critical customers always get dedicated resources while balancing load across the cluster.

```java
@Component
public class OrderPartitioner implements Partitioner {

    @Value("${order.partitions.special}")
    private int specialPartitionCount;

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        String orderId = (String) key;
        if (orderId.startsWith("VIP-")) {
            return 0; // VIP orders to partition 0 for priority processing
        }
        int totalPartitions = cluster.partitionCountForTopic(topic);
        int hash = Math.abs(orderId.hashCode());
        if (hash % 10 < 2) {
            return hash % specialPartitionCount;
        }
        return (hash % (totalPartitions - specialPartitionCount)) + specialPartitionCount;
    }

    @Override
    public void configure(Map<String, ?> configs) {}

    @Override
    public void close() {}
}
```

## Choosing Partition Count

Partition count affects parallelism, throughput, and rebalance time. Follow these guidelines: each partition can handle roughly 10 MB/s with default configurations. The partition count should be at least as large as the maximum number of concurrent consumers you plan to run, and leave headroom for future growth. Keep in mind that more partitions increase the overhead of leader elections, file handles, and rebalance time — there's a sweet spot between parallelism and overhead.

```java
public class PartitionCountCalculator {

    public static int calculateOptimalPartitionCount(
            int expectedThroughputMBps,
            int maxConsumerThreads,
            int replicationFactor) {
        // Rule of thumb: partitions >= max consumers
        // Each partition can handle ~10 MB/s with default configs
        int throughputBased = (int) Math.ceil(expectedThroughputMBps / 10.0);
        int consumerBased = maxConsumerThreads;
        int replicationBased = consumerBased * (replicationFactor + 1);

        return Math.max(throughputBased, Math.max(consumerBased, replicationBased));
    }
}
```

## Best Practices

- Use meaningful keys for order-sensitive data to ensure all related events land in the same partition.
- Avoid monotonically increasing keys (timestamps, auto-increment IDs) which cause hot spotting on the last partition.
- Set partition count at topic creation time; changing later requires `kafka-reassign-partitions`.
- Monitor partition distribution with `kafka.tools.ConsumerGroupCommand` and `kafka.admin.ReassignPartitionsCommand`.
- For uniform distribution, use a well-distributed key such as a UUID or user ID hash.

## Common Mistakes

### Mistake: Hot spotting due to poor key design

Using `System.currentTimeMillis()` as a key causes all records to hash to the same partition — specifically the last partition — because monotonically increasing values produce a narrow range of hash values. This creates a hot spot where one partition handles all traffic while others sit idle, defeating the purpose of partitioning.

```java
// Wrong - all records go to last partition
String key = String.valueOf(System.currentTimeMillis());
producer.send(new ProducerRecord<>("logs", key, logLine));
```

```java
// Correct - uniformly distributed key
String key = UUID.randomUUID().toString();
producer.send(new ProducerRecord<>("logs", key, logLine));
```

### Mistake: Too few partitions limiting consumer parallelism

If a topic has only 3 partitions, you can have at most 3 consumers processing it in parallel — adding a 4th consumer would leave it idle. Plan for future growth by starting with more partitions than you currently need. Kafka allows adding partitions later, but reducing them is not supported.

```java
// Wrong - cannot scale consumers beyond 3
--partitions 3
```

```java
// Correct - allows scaling consumers up to 12
--partitions 12
```

## Summary

Effective partitioning strategies ensure balanced load, maintain ordering guarantees, and maximize Kafka throughput. Use key-based partitioning for ordered delivery, custom partitioners for business-specific routing, and always plan partition count with future scalability in mind.

## References

- [Kafka Documentation - Partitions](https://kafka.apache.org/documentation/#intro_topics)
- [Confluent Blog - How to Choose the Number of Partitions](https://www.confluent.io/blog/how-choose-number-partitions-kafka-topic/)
- [KIP-480: Sticky Partitioner](https://cwiki.apache.org/confluence/display/KAFKA/KIP-480:+Sticky+Partitioner)

Happy Coding
