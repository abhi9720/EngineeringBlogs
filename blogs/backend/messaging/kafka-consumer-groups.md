---
title: "Kafka Consumer Groups"
description: "Master Kafka consumer groups: parallel processing, rebalancing, partition assignment, and scaling strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - kafka
  - consumer-groups
  - partitioning
coverImage: "/images/kafka-consumer-groups.png"
draft: false
---

# Kafka Consumer Groups

## Overview

Consumer groups enable parallel processing in Kafka. Each group shares the workload of consuming from a topic, with partitions distributed among group members. Understanding how consumer groups work is essential for building scalable Kafka applications.

---

## How Consumer Groups Work

### Basic Group Behavior

```
Topic: orders (3 partitions)

Group A (2 consumers):
  Consumer 1: partitions 0, 1
  Consumer 2: partition 2

Group B (3 consumers):
  Consumer 1: partition 0
  Consumer 2: partition 1
  Consumer 3: partition 2
```

### Implementation

```java
// All consumers in same group share partitions
@Service
public class OrderProcessor {
    
    @KafkaListener(
        topics = "orders",
        groupId = "order-processor-group"  // All instances share this group
    )
    public void processOrder(OrderEvent event) {
        log.info("Processed order: {}", event.getOrderId());
    }
}

// With multiple instances, partitions are split:
// Instance 1: partitions 0, 1
// Instance 2: partition 2
```

---

## Real-World Use Cases

### 1. Scaling Consumers

```java
// Scale by adding consumer instances
// Kafka automatically rebalances partitions

@Service
public class ScaledProcessor {
    
    @KafkaListener(
        topics = "orders",
        groupId = "scaled-group",
        concurrency = "3"  // Creates 3 consumer threads
    )
    public void process(OrderEvent event) {
        // Multiple threads process in parallel
    }
}
```

### 2. Different Processing Paths

```java
// Same events, different consumers with different groups
@Service
public class NotificationService {
    
    @KafkaListener(topics = "orders", groupId = "notifications")
    public void sendNotification(OrderEvent event) {
        emailService.sendOrderConfirmation(event.getUserId());
    }
}

@Service
public class AnalyticsService {
    
    @KafkaListener(topics = "orders", groupId = "analytics")
    public void trackOrder(OrderEvent event) {
        analyticsService.track(event);
    }
}

// Orders are processed by both groups independently
```

---

## Production Considerations

### Rebalancing

```java
// Rebalance occurs when:
// - Consumer joins/leaves group
// - Partition count changes
// - Consumer considered dead (session.timeout)

@Configuration
public class RebalanceConfig {
    
    @Bean
    public KafkaListenerContainerFactory<ConcurrentMessageListenerContainer<String, OrderEvent>> 
            kafkaListenerContainerFactory() {
        
        ConcurrentKafkaListenerContainerFactory<String, OrderEvent> factory = 
            new ConcurrentKafkaListenerContainerFactory<>();
        
        factory.getContainerProperties().setSessionTimeoutMs(45000);
        factory.getContainerProperties().setHeartbeatInterval(15000);
        
        return factory;
    }
}
```

### Offset Management

```java
// Manual offset management
@Service
public class ManualOffsetService {
    
    @KafkaListener(topics = "orders", groupId = "manual-group")
    public void process(
            @Payload OrderEvent event,
            @Header(KafkaHeaders.OFFSET) long offset,
            Acknowledgment ack) {
        
        try {
            processOrder(event);
            
            // Commit offset after successful processing
            ack.acknowledge();  
        } catch (Exception e) {
            log.error("Failed processing", e);
            // Don't acknowledge - will be redelivered
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Too Many Partitions

```java
// WRONG: More partitions than needed
// Each partition means a potential processing bottleneck

// CORRECT: Size based on throughput needs
// Rule: target_throughput / consumer_throughput = num_partitions
// Start with 6 partitions, adjust based on metrics
```

### Mistake 2: Not Handling Rebalances

```java
// WRONG: No handling of rebalance events

// CORRECT: Add rebalance listener
@KafkaListener(topics = "orders")
public void handle(
        @Payload OrderEvent event,
        @Header(KafkaHeaders.OFFSET) long offset,
        Acknowledgment ack,
        ConsumerSeekCallback seekCallback) {
    
    // Process normally
}
```

---

## Summary

1. **Group ID**: Defines which consumers share partitions
2. **Scaling**: Add consumers up to partition count
3. **Rebalancing**: Automatic partition reassignment
4. **Offset**: Track processed messages for at-least-once delivery

---

## References

- [Kafka Consumer Groups](https://kafka.apache.org/documentation/#intro_consumers)
- [KIP-464: Rebalance Protocol](https://cwiki.apache.org/confluence/display/KAFKA/KIP-464%3A+Design+of+Consumer+Rebalance+Protocol)

---

Happy Coding 👨‍💻