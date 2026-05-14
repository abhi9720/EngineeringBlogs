---
title: "Transactional Outbox Pattern"
description: "Implement the transactional outbox pattern for reliable event publishing in microservices: database-based outbox, polling publisher, change data capture, and Spring Boot integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - outbox-pattern
  - transactional
  - event-driven
  - cdc
coverImage: "/images/outbox-pattern.png"
draft: false
---

## Overview

The transactional outbox pattern ensures reliable event publishing by storing events in a database table within the same transaction that performs business operations. A separate process reads and publishes these events, providing atomicity between database changes and message publishing.

## The Problem

When a service writes to its database and publishes a message to Kafka or RabbitMQ in separate steps, a failure between the two operations leads to data inconsistency.

```java
// Wrong - non-atomic operation
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = orderRepository.save(new Order(request));
    // If this fails after save, we have an order but no event
    kafkaTemplate.send("order-events", order.getId(), new OrderCreatedEvent(order));
    // If this crashes before send, we lost the event
    return order;
}
```

## Outbox Table Design

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(255) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_id UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    published_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'PENDING'
);

CREATE INDEX idx_outbox_status_created ON outbox_events (status, created_at)
    WHERE status = 'PENDING';

CREATE INDEX idx_outbox_event_id ON outbox_events (event_id);
```

## Outbox Event Entity

```java
@Entity
@Table(name = "outbox_events")
public class OutboxEvent {

    @Id
    private UUID id;

    @Column(name = "aggregate_type", nullable = false)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false)
    private String aggregateId;

    @Column(name = "event_type", nullable = false)
    private String eventType;

    @Column(name = "event_id", nullable = false, unique = true)
    private UUID eventId;

    @Column(name = "payload", columnDefinition = "JSONB", nullable = false)
    private String payload;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "retry_count")
    private Integer retryCount = 0;

    @Column(name = "status", nullable = false)
    @Enumerated(EnumType.STRING)
    private OutboxStatus status = OutboxStatus.PENDING;

    @Version
    private Long version;

    public static OutboxEvent create(String aggregateType, String aggregateId,
                                      String eventType, Object payload) {
        OutboxEvent event = new OutboxEvent();
        event.setId(UUID.randomUUID());
        event.setEventId(UUID.randomUUID());
        event.setAggregateType(aggregateType);
        event.setAggregateId(aggregateId);
        event.setEventType(eventType);
        event.setPayload(toJson(payload));
        event.setCreatedAt(Instant.now());
        return event;
    }
}

public enum OutboxStatus {
    PENDING, PUBLISHED, FAILED
}
```

## Service with Outbox

```java
@Service
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private OutboxEventRepository outboxRepository;

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = new Order(request.getCustomerId(), request.getItems());
        order.setStatus(OrderStatus.PENDING);
        order = orderRepository.save(order);

        OrderCreatedEvent event = new OrderCreatedEvent(order);
        outboxRepository.save(
            OutboxEvent.create("ORDER", order.getId(), "ORDER_CREATED", event)
        );

        return order;
    }
}
```

## Polling Publisher

```java
@Component
public class OutboxPollingPublisher {

    @Autowired
    private OutboxEventRepository outboxRepository;

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelay = 1000)
    @Transactional
    public void publishPendingEvents() {
        Pageable pageable = PageRequest.of(0, 100);
        List<OutboxEvent> events = outboxRepository
            .findByStatusOrderByCreatedAt(OutboxStatus.PENDING, pageable);

        for (OutboxEvent event : events) {
            try {
                kafkaTemplate.send(
                    getTopic(event.getEventType()),
                    event.getAggregateId(),
                    event.getPayload()
                ).get(5, TimeUnit.SECONDS);

                event.setStatus(OutboxStatus.PUBLISHED);
                event.setPublishedAt(Instant.now());
                outboxRepository.save(event);
            } catch (Exception e) {
                event.setRetryCount(event.getRetryCount() + 1);
                if (event.getRetryCount() >= 5) {
                    event.setStatus(OutboxStatus.FAILED);
                }
                outboxRepository.save(event);
                log.error("Failed to publish outbox event: {}", event.getId(), e);
            }
        }
    }

    private String getTopic(String eventType) {
        return "order-events";
    }
}
```

## CDC-Based Publisher (Debezium)

Use Debezium for change data capture to avoid polling overhead.

```json
// Debezium connector configuration
{
  "name": "outbox-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "debezium",
    "database.dbname": "orders_db",
    "database.server.name": "orders",
    "table.include.list": "public.outbox_events",
    "tombstones.on.delete": "false",
    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
    "transforms.outbox.table.field.event.id": "event_id",
    "transforms.outbox.table.field.event.key": "aggregate_id",
    "transforms.outbox.table.field.event.type": "event_type",
    "transforms.outbox.table.field.event.timestamp": "created_at",
    "transforms.outbox.table.field.event.payload": "payload",
    "transforms.outbox.route.by.field": "aggregate_type",
    "transforms.outbox.route.topic.replacement": "order-events",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false"
  }
}
```

## Outbox with Spring Modulith

Spring Modulith 1.0+ provides built-in outbox support.

```java
@Configuration
public class OutboxConfig {

    @Bean
    ApplicationEventMulticaster applicationEventMulticaster() {
        SimpleApplicationEventMulticaster multicaster = new SimpleApplicationEventMulticaster();
        multicaster.setTaskExecutor(new SimpleAsyncTaskExecutor());
        return multicaster;
    }
}

@Service
public class OrderServiceWithModulith {

    @Autowired
    private OrderRepository orderRepository;

    @ApplicationModuleId
    private EventPublicationRegistry registry;

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));

        // Event is automatically stored in outbox table
        ApplicationEventPublisher publisher = getPublisher();
        publisher.publishEvent(new OrderCreatedEvent(order));

        return order;
    }
}
```

## Best Practices

- Always write events within the same database transaction as business operations.
- Use optimistic locking on outbox records to prevent duplicate publishing.
- Implement idempotent consumers to handle duplicate message delivery.
- Monitor outbox table size and implement cleanup of published events.
- Use CDC (Debezium) for low-latency event publishing without polling overhead.
- Set appropriate retry limits and alert on failed events.

## Common Mistakes

### Mistake: Sending events before commit

```java
// Wrong - event sent before transaction commits
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = orderRepository.save(new Order(request));
    kafkaTemplate.send("order-events", order.getId(), new OrderCreatedEvent(order));
    // If rollback happens after this, event was already sent
    orderRepository.save(order); // This could fail
    return order;
}
```

```java
// Correct - outbox ensures atomicity
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = orderRepository.save(new Order(request));
    outboxRepository.save(OutboxEvent.create("ORDER", order.getId(), "ORDER_CREATED", order));
    return order;
}
```

### Mistake: Not handling duplicate outbox event publishing

```java
// Wrong - no idempotency check can publish same event twice
```

```java
// Correct - use unique event_id constraint and version field
@Entity
@Table(name = "outbox_events", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"event_id"})
})
public class OutboxEvent {
    @Version
    private Long version; // Optimistic lock prevents concurrent publishing
}
```

## Summary

The transactional outbox pattern ensures reliable event publishing by storing events atomically with business data. Use a polling publisher for simple implementations or Debezium for CDC-based low-latency publishing. This pattern is essential for achieving data consistency in event-driven microservices.

## References

- [Transaction Outbox Pattern - Microsoft](https://learn.microsoft.com/en-us/azure/architecture/patterns/transactional-outbox)
- [Debezium Outbox Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
- [Spring Modulith Outbox](https://docs.spring.io/spring-modulith/docs/current/reference/html/#events)

Happy Coding