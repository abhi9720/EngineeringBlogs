---
title: "Kafka Introduction"
description: "Introduction to Apache Kafka: topics, partitions, producers, consumers, and how to build event streaming applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - kafka
  - messaging
  - event-streaming
coverImage: "/images/kafka-introduction.png"
draft: false
---

# Apache Kafka: Event Streaming Platform

## Overview

Apache Kafka is a distributed event streaming platform that handles trillions of events daily at companies like LinkedIn, Netflix, and Uber. It's the backbone of modern data architectures, enabling real-time pipelines, event sourcing, and microservices communication.

---

## Kafka Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Kafka Cluster                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Zookeeper (metadata)                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           │                    │                    │                  │
│           ▼                    ▼                    ▼                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │    Broker 1      │  │    Broker 2      │  │    Broker 3      │   │
│  │  topic-part-0   │  │  topic-part-1   │  │  topic-part-0   │   │
│  │  topic-part-1   │  │  topic-part-0   │  │  topic-part-1   │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  Producer    │           │  Producer    │           │  Producer    │
└──────────────┘           └──────────────┘           └──────────────┘

         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  Consumer    │           │  Consumer    │           │  Consumer    │
└──────────────┘           └──────────────┘           └──────────────┘
```

### Core Concepts

```java
// Producer: Sends messages to Kafka
@Service
public class OrderProducer {
    
    @Autowired
    private KafkaTemplate<String, OrderEvent> kafkaTemplate;
    
    public void sendOrderCreated(Order order) {
        OrderEvent event = OrderEvent.builder()
            .orderId(order.getId())
            .userId(order.getUserId())
            .total(order.getTotal())
            .timestamp(Instant.now())
            .build();
        
        // Send to "orders" topic
        kafkaTemplate.send("orders", order.getId().toString(), event);
    }
}

// Topic with partitions
// Orders can be partitioned by userId (key)
// Messages with same key go to same partition
// This ensures ordering within user scope

// Consumer: Reads messages from Kafka
@Service
public class OrderConsumer {
    
    @KafkaListener(topics = "orders", groupId = "order-processing")
    public void handleOrderCreated(
            @Payload OrderEvent event,
            @Header(KafkaHeaders.OFFSET) long offset) {
        
        log.info("Processing order: {} at offset {}", event.getOrderId(), offset);
        
        // Process the order event
    }
}
```

---

## Real-World Use Cases

### 1. Event Sourcing

```java
// Store state changes as events
@Service
public class AccountService {
    
    @Autowired
    private KafkaTemplate<String, AccountEvent> kafkaTemplate;
    
    public void deposit(Long accountId, BigDecimal amount) {
        AccountEvent event = AccountEvent.builder()
            .accountId(accountId)
            .type("DEPOSIT")
            .amount(amount)
            .timestamp(Instant.now())
            .build();
        
        kafkaTemplate.send("account-events", accountId.toString(), event);
    }
}

@Component
public class AccountEventHandler {
    
    @KafkaListener(topics = "account-events", groupId = "account-service")
    public void handleEvent(@Payload AccountEvent event) {
        // Rebuild state from events
        log.info("Event: {} for account {}", event.getType(), event.getAccountId());
    }
}
```

### 2. Real-time Analytics

```java
@Service
public class AnalyticsService {
    
    @KafkaListener(topics = "user-actions", groupId = "analytics")
    public void processAction(UserAction action) {
        // Real-time aggregation
        metrics.increment("actions." + action.getType());
        
        // Update real-time dashboard
        dashboardService.update(action);
    }
}
```

---

## Production Considerations

### 1. Configuration

```yaml
# application.yml
spring:
  kafka:
    bootstrap-servers: kafka1:9092,kafka2:9092,kafka3:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3
      properties:
        max.block.ms: 60000
    consumer:
      group-id: my-consumer-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "*"
    listener:
      ack-mode: manual
```

### 2. Error Handling

```java
@Service
public class ResilientConsumer {
    
    @KafkaListener(topics = "orders", groupId = "order-processing")
    public void handleOrder(
            @Payload OrderEvent event,
            @Header(KafkaHeaders.OFFSET) long offset,
            Acknowledgment ack) {
        
        try {
            processOrder(event);
            ack.acknowledge();  // Commit offset
        } catch (Exception e) {
            log.error("Failed to process order: {}", event.getOrderId(), e);
            // Don't acknowledge - will be redelivered
            // Or send to dead letter topic
            ack.acknowledge();  // After sending to DLQ
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Using Keys for Partitioning

```java
// WRONG: Random partitioning
kafkaTemplate.send("orders", event);  // No key - random partition

// CORRECT: Use consistent key
kafkaTemplate.send("orders", order.getId().toString(), event);
// Same order ID always goes to same partition
// Ensures ordering per partition
```

### Mistake 2: Not Handling Duplicates

```java
// WRONG: No idempotence - duplicates cause issues
@KafkaListener(topics = "orders")
public void handleOrder(OrderEvent event) {
    orderService.process(event.getOrderId());  // May process twice!
}

// CORRECT: Idempotent processing
@KafkaListener(topics = "orders")
public void handleOrder(
        @Payload OrderEvent event,
        @Header(KafkaHeaders.OFFSET) long offset) {
    
    // Check if already processed using offset or unique ID
    if (!processedEvents.contains(offset)) {
        orderService.process(event.getOrderId());
        processedEvents.add(offset);
    }
}
```

---

## Summary

1. **Topics**: Named stream of events, partitioned for parallelism
2. **Producers**: Publish events with keys for partitioning
3. **Consumers**: Read from partitions within consumer groups
4. **Ordering**: Guaranteed within partition
5. **Retention**: Configurable log retention (default 7 days)

---

## References

- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Spring Kafka Reference](https://docs.spring.io/spring-kafka/reference/)
- [Kafka: The Definitive Guide](https://www.confluent.io/resources/kafka-the-definitive-guide/)