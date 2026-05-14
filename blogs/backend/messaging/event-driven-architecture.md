---
title: "Event-Driven Architecture"
description: "Design event-driven microservices: event sourcing, CQRS, saga patterns, and message-driven communication"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - event-driven
  - architecture
  - microservices
  - cqrs
coverImage: "/images/event-driven-architecture.png"
draft: false
---

# Event-Driven Architecture

## Overview

Event-driven architecture (EDA) is a software architecture paradigm promoting the production, detection, consumption of, and reaction to events. It's the foundation for modern microservices communication, enabling loose coupling, scalability, and real-time processing.

---

## Core Patterns

### 1. Event Notification

The event notification pattern is the simplest form of EDA. A service emits an event after completing an action, and other services react to it without knowing about each other. The `OrderService` publishes an `OrderCreatedEvent` via Spring's `ApplicationEventPublisher`, while the `NotificationService` listens asynchronously using `@EventListener` and `@Async`. This keeps services decoupled — the order service doesn't need to know about email notifications or push alerts.

```java
// Simple: Service emits event, others react
@Service
public class OrderService {
    
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    public Order createOrder(CreateOrderRequest request) {
        Order order = Order.from(request);
        order = orderRepository.save(order);
        
        // Emit event
        eventPublisher.publishEvent(
            new OrderCreatedEvent(order.getId(), order.getUserId(), order.getTotal())
        );
        
        return order;
    }
}

// Listener
@Service
public class NotificationService {
    
    @EventListener
    @Async
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Send email, push notification, etc.
        emailService.sendOrderConfirmation(event.getUserId(), event.getOrderId());
    }
}
```

### 2. Event Sourcing

Instead of storing only the current state, event sourcing persists every state change as an individual event. The `BankAccount` entity never stores a `balance` column directly — it derives the balance by replaying all `AccountEvent` records in chronological order. This approach provides a complete audit trail and enables temporal queries (what was the balance at any point in time?). The trade-off is increased storage and replay complexity for long-lived aggregates.

```java
// Store all state changes as events
@Entity
public class BankAccount {
    
    @Id
    private String accountId;
    
    @Transient
    private BigDecimal balance;  // Derived from events
    
    @ElementCollection
    @OrderBy("timestamp ASC")
    private List<AccountEvent> events = new ArrayList<>();
    
    public void apply(AccountEvent event) {
        switch (event.getType()) {
            case DEPOSIT -> balance = balance.add(event.getAmount());
            case WITHDRAWAL -> balance = balance.subtract(event.getAmount());
        }
        events.add(event);
    }
}

@Service
public class AccountService {
    
    public void deposit(String accountId, BigDecimal amount) {
        AccountEvent event = AccountEvent.builder()
            .type(AccountEvent.Type.DEPOSIT)
            .amount(amount)
            .timestamp(Instant.now())
            .build();
        
        BankAccount account = accountRepository.findById(accountId);
        account.apply(event);
        accountRepository.save(account);
        
        // Publish to Kafka for other services
        kafkaTemplate.send("account-events", accountId, event);
    }
}
```

### 3. CQRS (Command Query Responsibility Segregation)

CQRS separates write operations (commands) from read operations (queries) into different models. The write model uses a normalized database (PostgreSQL) optimized for integrity, while the read model uses a denormalized store (Elasticsearch) optimized for queries. The `OrderCommandService` handles mutations and publishes events; `OrderViewUpdater` consumes those events to refresh the read model. The `OrderQueryService` then queries the read model without touching the write database. This separation allows independent scaling and optimization of each path.

```mermaid
flowchart TB

    Commands[Commands<br/>Write] --> CmdHandler[Command<br/>Handler]
    Queries[Queries<br/>Read] --> QueryHandler[Query<br/>Handler]

    CmdHandler --> WriteModel[(Write Model<br/>Postgres)]
    QueryHandler --> ReadModel[(Read Model<br/>Elastic)]

    WriteModel -.->|Sync events| ReadModel

    linkStyle default stroke:#278ea5

    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff

    class WriteModel,ReadModel green
    class CmdHandler,QueryHandler blue
    class Commands,Queries pink
```

```java
// Command side
@Service
public class OrderCommandService {
    
    @Autowired
    private OrderRepository orderRepository;
    
    @Autowired
    private EventPublisher eventPublisher;
    
    public Order createOrder(CreateOrderCommand command) {
        Order order = Order.from(command);
        order = orderRepository.save(order);
        
        // Publish event to update read model
        eventPublisher.publishEvent(new OrderCreatedEvent(order));
        
        return order;
    }
}

// Query side
@Service
public class OrderQueryService {
    
    @Autowired
    private ElasticsearchTemplate elasticsearchTemplate;
    
    public List<OrderView> findOrders(String userId) {
        Query query = new NativeSearchQueryBuilder()
            .withQuery(matchQuery("userId", userId))
            .build();
        
        SearchHits<OrderView> hits = elasticsearchTemplate.search(query, OrderView.class);
        return hits.stream().map(SearchHit::getContent).collect(Collectors.toList());
    }
}

// Event handler updates read model
@Component
public class OrderViewUpdater {
    
    @KafkaListener(topics = "orders", groupId = "query-service")
    public void handle(OrderCreatedEvent event) {
        OrderView view = OrderView.from(event);
        elasticsearchTemplate.save(view);
    }
}
```

### 4. Saga Pattern

The saga pattern manages distributed transactions without a two-phase commit. In the orchestrated variant, a central `OrderSagaOrchestrator` coordinates steps across services, calling each in sequence and invoking compensating actions if a step fails. In the choreographed variant, each service listens for events and emits its own — the `OrderSagaChoreography` class listens for order creation and publishes `inventory-reserved` or `inventory-failed`. The trade-off: orchestration centralizes coordination logic but creates a single point of failure; choreography distributes responsibility but makes the flow harder to trace.

```java
// Orchestrated saga for distributed transactions
@Service
public class OrderSagaOrchestrator {
    
    @Autowired
    private OrderService orderService;
    @Autowired
    private PaymentService paymentService;
    @Autowired
    private InventoryService inventoryService;
    @Autowired
    private KafkaTemplate kafkaTemplate;
    
    public void executeOrderSaga(CreateOrderCommand command) {
        try {
            // Step 1: Create order (pending)
            Order order = orderService.createPending(command);
            
            // Step 2: Reserve inventory
            if (!inventoryService.reserve(command.getItems())) {
                throw new SagaStepException("Inventory reservation failed");
            }
            
            // Step 3: Process payment
            if (!paymentService.charge(command.getUserId(), command.getTotal())) {
                inventoryService.release(command.getItems());  // Compensate
                orderService.cancel(order.getId());           // Compensate
                throw new SagaStepException("Payment failed");
            }
            
            // Step 4: Confirm order
            orderService.confirm(order.getId());
            
        } catch (SagaStepException e) {
            // Already handled compensation above
            kafkaTemplate.send("order-errors", command, e.getMessage());
        }
    }
}

// Event-based saga (choreography)
@Service
public class OrderSagaChoreography {
    
    @KafkaListener(topics = "orders", groupId = "inventory-service")
    public void onOrderCreated(OrderCreatedEvent event) {
        boolean reserved = inventoryService.reserve(event.getItems());
        
        if (reserved) {
            kafkaTemplate.send("inventory-reserved", event.getOrderId());
        } else {
            kafkaTemplate.send("inventory-failed", event.getOrderId());
        }
    }
}
```

---

## Production Considerations

### Event Schema Evolution

As events evolve over time, downstream consumers may break. The solution is schema versioning: each event carries an explicit `@Schema(version)` annotation. New fields like `currency` include a `defaultValue` so consumers on older versions can still deserialize. An `EventRouter` can dispatch events to different handlers based on version, ensuring a rolling upgrade path without downtime.

```java
// Version events for backward compatibility
@Event
class OrderCreatedEvent {
    
    @Schema(version = 1)
    private Long orderId;
    
    @Schema(version = 2)
    private Long userId;
    
    @Schema(version = 2, defaultValue = "USD")
    private String currency;
}

// Use EventRouter to handle different versions
@Component
public class EventRouter {
    
    @EventListener
    public void route(Object event) {
        if (event instanceof OrderCreatedEvent v1) {
            handleV1(v1);
        }
    }
}
```

### Idempotency

In at-least-once delivery systems, the same event may arrive multiple times. The `IdempotentProcessor` uses a `ConcurrentHashMap` (backed by the event's unique ID) to detect and skip duplicates. In production, this set should be backed by a database or Redis so the deduplication state survives restarts. Always process events idempotently to avoid double-charging, duplicate notifications, or inconsistent state.

```java
// Process events idempotently to handle duplicates
@Service
public class IdempotentProcessor {
    
    private Set<String> processedIds = ConcurrentHashMap.newKeySet();
    
    @KafkaListener(topics = "orders")
    public void process(OrderEvent event) {
        // Check if already processed
        if (!processedIds.add(event.getEventId())) {
            log.info("Skipping duplicate event: {}", event.getEventId());
            return;
        }
        
        // Process event
    }
}
```

---

## Common Mistakes

### Mistake 1: Synchronous Event Handling

By default, Spring's `ApplicationEventPublisher` invokes listeners synchronously in the publishing thread. This means the `create()` method will block until all listeners finish, making the event pattern behave like a direct method call. The fix is to annotate listeners with `@Async` (and enable async support with `@EnableAsync`) so the publisher returns immediately and listeners run on a separate thread pool.

```java
// WRONG: Block waiting for event processing
@Service
public class BadService {
    
    @Autowired
    private ApplicationEventPublisher publisher;
    
    public void create(Order order) {
        orderRepository.save(order);
        
        // Waits for all listeners - same as synchronous call!
        publisher.publishEvent(new OrderCreatedEvent(order));
        
        // Response returned only after notifications sent
    }
}

// CORRECT: Make event handling async
@Service
public class GoodService {
    
    @Async
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Runs asynchronously
    }
}
```

### Mistake 2: No Transactional Outbox

Publishing a Kafka message after a database save in the same `@Transactional` method looks safe, but the message send happens before the transaction commits. If the commit fails, the message was already sent — leading to phantom events. The solution is the transactional outbox pattern: write the event to an `outbox` table in the same database transaction, then a separate `OutboxProcessor` polls and publishes reliably. This guarantees that either both the business data and the event are persisted, or neither is.

```java
// WRONG: Database and message not in sync
@Service
public class BadService {
    
    @Transactional
    public void create(Order order) {
        orderRepository.save(order);
        
        // If Kafka fails, database has order but no event!
        kafkaTemplate.send("orders", order);
    }
}

// CORRECT: Use transactional outbox
@Service
public class GoodService {
    
    @Transactional
    public void create(Order order) {
        orderRepository.save(order);
        
        // Save to outbox in same transaction
        outboxRepository.save(OutboxEvent.builder()
            .aggregateType("Order")
            .aggregateId(order.getId())
            .eventType("OrderCreated")
            .payload(toJson(order))
            .build()
        );
    }
}

// Separate process polls outbox and publishes
@Service
public class OutboxProcessor {
    
    @Scheduled(fixedRate = 1000)
    @Transactional
    public void processOutbox() {
        List<OutboxEvent> events = outboxRepository.findAllUnprocessed();
        
        for (OutboxEvent event : events) {
            kafkaTemplate.send(event.getAggregateType(), event.getPayload());
            event.setProcessed(true);
            outboxRepository.save(event);
        }
    }
}
```

---

## Summary

1. **Event Notification**: Simple, loosely coupled
2. **Event Sourcing**: Store state as sequence of events
3. **CQRS**: Separate read and write models
4. **Saga**: Handle distributed transactions
5. **Outbox Pattern**: Ensure reliable event publishing

---

## References

- [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
- [Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)

---

Happy Coding
