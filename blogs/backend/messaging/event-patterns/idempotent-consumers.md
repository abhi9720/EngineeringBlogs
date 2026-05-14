---
title: "Idempotent Consumer Pattern"
description: "Implement idempotent consumers in message-driven systems: deduplication strategies, idempotency keys, database-driven dedup, Redis-based dedup, and message idempotency in Kafka and RabbitMQ"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - idempotent
  - consumer
  - deduplication
  - messaging
coverImage: "/images/idempotent-consumers.png"
draft: false
---

## Overview

Idempotent consumers ensure that processing the same message multiple times produces the same result. This is critical in distributed systems where message delivery guarantees are at-least-once, and network failures or retries can cause duplicate message delivery.

## Idempotency with Database Dedup

Store processed message IDs in the database and check before processing.

```java
@Service
public class IdempotentOrderProcessor {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private OrderRepository orderRepository;

    @Transactional
    public void processOrder(OrderEvent event) {
        String messageId = event.getEventId();

        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM processed_messages WHERE message_id = ?",
            Integer.class, messageId
        );

        if (count != null && count > 0) {
            log.info("Duplicate message ignored: {}", messageId);
            return;
        }

        jdbcTemplate.update(
            "INSERT INTO processed_messages (message_id, processed_at) VALUES (?, NOW())",
            messageId
        );

        orderRepository.save(Order.from(event));
    }
}
```

### Optimistic Locking for High Throughput

```java
@Entity
@Table(name = "processed_messages")
public class ProcessedMessage {

    @Id
    private String messageId;

    @Column(nullable = false)
    private Instant processedAt;

    @Version
    private Long version;

    public ProcessedMessage(String messageId) {
        this.messageId = messageId;
        this.processedAt = Instant.now();
    }
}

@Component
public class OptimisticIdempotentProcessor {

    @Autowired
    private ProcessedMessageRepository processedMessageRepository;

    @Autowired
    private OrderRepository orderRepository;

    @Transactional
    public void processOrder(OrderEvent event) {
        try {
            processedMessageRepository.save(
                new ProcessedMessage(event.getEventId())
            );
            orderRepository.save(Order.from(event));
        } catch (DataIntegrityViolationException e) {
            if (e.getMessage().contains("duplicate key") ||
                e.getMessage().contains("Unique index")) {
                log.info("Duplicate message ignored: {}", event.getEventId());
            } else {
                throw e;
            }
        }
    }
}
```

## Redis-Based Idempotency

Use Redis for low-latency deduplication with TTL-based expiration.

```java
@Component
public class RedisIdempotencyService {

    private static final String IDEMPOTENCY_PREFIX = "idempotent:";

    @Autowired
    private StringRedisTemplate redisTemplate;

    public boolean isProcessed(String messageId) {
        return Boolean.TRUE.equals(
            redisTemplate.opsForValue().setIfAbsent(
                IDEMPOTENCY_PREFIX + messageId,
                "1",
                Duration.ofHours(24)
            )
        );
    }

    @Transactional
    public boolean tryProcess(String messageId, Runnable processor) {
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(
            IDEMPOTENCY_PREFIX + messageId,
            "processing",
            Duration.ofMinutes(5)
        );

        if (Boolean.FALSE.equals(acquired)) {
            String status = redisTemplate.opsForValue()
                .get(IDEMPOTENCY_PREFIX + messageId);
            if ("done".equals(status)) {
                return true; // Already processed
            }
            throw new ConcurrentProcessingException(
                "Message is being processed by another consumer");
        }

        try {
            processor.run();
            redisTemplate.opsForValue().set(
                IDEMPOTENCY_PREFIX + messageId,
                "done",
                Duration.ofHours(24)
            );
            return true;
        } catch (Exception e) {
            redisTemplate.delete(IDEMPOTENCY_PREFIX + messageId);
            throw e;
        }
    }
}
```

## Kafka-Specific Idempotent Consumer

Kafka provides `enable.idempotence=true` for producers but consumers need manual idempotency.

```java
@Component
public class KafkaIdempotentConsumer {

    @Autowired
    private IdempotencyService idempotencyService;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @KafkaListener(topics = "orders", groupId = "order-processor")
    public void consume(ConsumerRecord<String, String> record) {
        String messageId = extractMessageId(record);

        if (idempotencyService.wasProcessed(messageId)) {
            log.info("Skipping already processed message: {}", messageId);
            return;
        }

        OrderEvent event = parseEvent(record.value());
        processOrder(event);

        idempotencyService.markProcessed(messageId);
    }

    @Transactional
    public void processExactlyOnce(ConsumerRecord<String, String> record) {
        String messageId = extractMessageId(record);
        OrderEvent event = parseEvent(record.value());

        jdbcTemplate.update(
            "INSERT INTO processed_messages (message_id, order_id, processed_at) " +
            "VALUES (?, ?, NOW()) ON CONFLICT (message_id) DO NOTHING",
            messageId, event.getOrderId()
        );

        if (jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM processed_messages WHERE message_id = ?",
            Integer.class, messageId) == 0) {
            processOrder(event);
            jdbcTemplate.update(
                "UPDATE processed_messages SET status = 'COMPLETED' WHERE message_id = ?",
                messageId
            );
        }
    }

    private String extractMessageId(ConsumerRecord<String, String> record) {
        // Use record headers or compute from key + offset
        String headerId = null;
        if (record.headers().lastHeader("message-id") != null) {
            headerId = new String(
                record.headers().lastHeader("message-id").value()
            );
        }
        return headerId != null ? headerId :
            record.topic() + "-" + record.partition() + "-" + record.offset();
    }
}
```

## RabbitMQ-Specific Idempotent Consumer

```java
@Component
public class RabbitIdempotentConsumer {

    @Autowired
    private IdempotencyService idempotencyService;

    @RabbitListener(queues = "orders.queue")
    public void handleOrder(OrderEvent event, Message message, Channel channel) {
        String messageId = message.getMessageProperties().getMessageId();
        if (messageId == null) {
            messageId = message.getMessageProperties().getCorrelationId();
        }

        try {
            if (idempotencyService.tryAcquire(messageId)) {
                try {
                    processOrder(event);
                    idempotencyService.markCompleted(messageId);
                } catch (Exception e) {
                    idempotencyService.release(messageId);
                    throw e;
                }
            }
            channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
        } catch (Exception e) {
            channel.basicNack(message.getMessageProperties().getDeliveryTag(), false, false);
        }
    }
}
```

## Business-Level Idempotency

Sometimes idempotency is built into the business operation itself.

```java
@Entity
@Table(name = "orders", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"order_number"})
})
public class Order {
    @Id
    private String id;
    @Column(unique = true)
    private String orderNumber;
    private String customerId;
    private BigDecimal amount;
    private String status;
}

@Service
public class BusinessIdempotentService {

    @Autowired
    private OrderRepository orderRepository;

    @Transactional
    public Order createOrder(OrderRequest request) {
        return orderRepository.findByOrderNumber(request.getOrderNumber())
            .orElseGet(() -> {
                Order order = new Order();
                order.setOrderNumber(request.getOrderNumber());
                order.setCustomerId(request.getCustomerId());
                order.setAmount(request.getAmount());
                order.setStatus("PENDING");
                return orderRepository.save(order);
            });
    }

    @Transactional
    public Order updateOrderStatus(String orderNumber, String newStatus) {
        Order order = orderRepository.findByOrderNumber(orderNumber)
            .orElseThrow(() -> new OrderNotFoundException(orderNumber));

        if ("SHIPPED".equals(order.getStatus()) && "PENDING".equals(newStatus)) {
            throw new IllegalStateException(
                "Cannot move from SHIPPED to PENDING");
        }

        order.setStatus(newStatus);
        return orderRepository.save(order);
    }
}
```

## Idempotency with Outbox Pattern

Combine outbox pattern with idempotent consumers for end-to-end reliability.

```java
@Component
public class OutboxIdempotentProcessor {

    @Autowired
    private OutboxEventRepository outboxRepository;

    @Transactional
    public void processOutboxEvent(OutboxEvent outboxEvent) {
        int updated = outboxRepository.markProcessing(outboxEvent.getId(),
            outboxEvent.getVersion());

        if (updated == 0) {
            log.info("Event already being processed: {}", outboxEvent.getId());
            return;
        }

        try {
            processEvent(outboxEvent);
            outboxRepository.markCompleted(outboxEvent.getId());
        } catch (Exception e) {
            outboxRepository.markFailed(outboxEvent.getId(), e.getMessage());
            throw e;
        }
    }

    @Modifying
    @Query("UPDATE OutboxEvent o SET o.status = 'PROCESSING' " +
           "WHERE o.id = :id AND o.version = :version")
    int markProcessing(@Param("id") UUID id, @Param("version") Long version);
}
```

## Best Practices

- Always include a unique message ID in message headers for deduplication.
- Use database unique constraints as the primary deduplication mechanism.
- Set TTL on Redis-based idempotency keys to prevent memory leaks.
- Use optimistic locking to handle concurrent duplicate processing.
- Implement business-level idempotency using natural keys (order number, transaction ID).
- Monitor duplicate message rates to detect upstream issues.

## Common Mistakes

### Mistake: Using in-memory set for deduplication

```java
// Wrong - dedup state lost on restart
public class InMemoryDedup {
    private final Set<String> processedIds = ConcurrentHashMap.newKeySet();

    public boolean isDuplicate(String id) {
        return !processedIds.add(id);
    }
}
```

```java
// Correct - persistent dedup storage
@Component
public class PersistentDedup {
    @Autowired
    private ProcessedMessageRepository repository;

    public boolean isDuplicate(String id) {
        return repository.existsByMessageId(id);
    }

    @Transactional
    public void markProcessed(String id) {
        repository.save(new ProcessedMessage(id));
    }
}
```

### Mistake: Not handling concurrent duplicate delivery

```java
// Wrong - race condition between check and insert
if (!dedupService.exists(messageId)) {
    processMessage(event); // Another thread might process same event here
    dedupService.save(messageId);
}
```

```java
// Correct - atomic check-and-insert with unique constraint
try {
    dedupService.save(new ProcessedMessage(messageId));
    processMessage(event); // Only one thread succeeds
} catch (DataIntegrityViolationException e) {
    log.info("Duplicate message: {}", messageId);
}
```

## Summary

Idempotent consumers are essential for building reliable message-driven systems. Use database unique constraints or Redis with TTL for deduplication, and always handle concurrent delivery scenarios. Combine idempotent consumers with the transactional outbox pattern for end-to-end exactly-once processing guarantees.

## References

- [Enterprise Integration Patterns - Idempotent Receiver](https://www.enterpriseintegrationpatterns.com/IdempotentReceiver.html)
- [Microsoft - Idempotent Message Processing](https://learn.microsoft.com/en-us/azure/architecture/patterns/idempotent-message-processing)
- [Kafka Idempotent Producer](https://kafka.apache.org/documentation/#producerconfigs_enable.idempotence)

Happy Coding