---
title: "CQRS and Event Sourcing"
description: "Deep dive into CQRS pattern with event sourcing: command models, query models, event stores, and practical implementation"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["cqrs", "event-sourcing", "microservices", "axon"]
coverImage: "/images/cqrs-event-sourcing.png"
draft: false
---

## Overview

Command Query Responsibility Segregation (CQRS) separates read and write operations into different models. Event Sourcing stores state changes as a sequence of events rather than the current state. Combined, they form a powerful pattern for systems with complex business logic, audit requirements, and different read vs write workloads.

## Core Concepts

### Command Model

Commands represent intent to change state. They are named in the imperative and handled by command handlers.

```java
public record CreateOrderCommand(
    String orderId,
    String customerId,
    List<OrderItemCommand> items
) {}

public record OrderItemCommand(
    String productId,
    String productName,
    int quantity,
    BigDecimal unitPrice
) {}

public record AddItemToOrderCommand(
    String orderId,
    OrderItemCommand item
) {}

public record ConfirmOrderCommand(
    String orderId
) {}

public record CancelOrderCommand(
    String orderId,
    String reason
) {}
```

Commands are named in the imperative mood: `CreateOrderCommand`, not `OrderCreatedCommand` (that's an event). Each command represents a single user intent. Using Java records ensures commands are immutable and provide equals/hashCode/toString automatically. Commands carry the data needed to perform the operation — no more, no less.

### Query Model

Queries retrieve data without side effects. The query model is optimized for reading and can be denormalized.

```java
public record GetOrderQuery(String orderId) {}

public record GetCustomerOrdersQuery(
    String customerId,
    int page,
    int size
) {}

public record SearchOrdersQuery(
    String searchTerm,
    OrderStatus status,
    LocalDate fromDate,
    LocalDate toDate
) {}
```

Queries never modify state. They request data and return results. The query model can be structured differently from the command model — for example, a search query might return denormalized data that joins fields from multiple aggregates. This is the essence of CQRS: optimizing read and write models independently.

### Events

Events represent facts that have happened in the past. They are immutable and stored in the event store.

```java
public sealed interface OrderEvent
    permits OrderCreatedEvent, ItemAddedEvent,
           OrderConfirmedEvent, OrderCancelledEvent,
           ItemRemovedEvent {}

public record OrderCreatedEvent(
    String orderId,
    String customerId,
    List<OrderItemEvent> items,
    Instant occurredAt
) implements OrderEvent {}

public record ItemAddedEvent(
    String orderId,
    OrderItemEvent item,
    Instant occurredAt
) implements OrderEvent {}

public record OrderConfirmedEvent(
    String orderId,
    Instant occurredAt
) implements OrderEvent {}

public record OrderCancelledEvent(
    String orderId,
    String reason,
    Instant occurredAt
) implements OrderEvent {}

public record OrderItemEvent(
    String productId,
    String productName,
    BigDecimal unitPrice,
    int quantity
) {}
```

Events are named in the past tense: `OrderCreatedEvent`, `ItemAddedEvent`. They are immutable records that describe what happened. The `sealed` interface restricts which types can implement `OrderEvent`, giving the compiler full knowledge of all possible events — this enables exhaustive pattern matching in switch expressions.

## Event Sourcing: The Event Store

The event store stores events and provides replay capability:

```java
@Entity
@Table(name = "domain_events")
public class DomainEventEntity {

    @Id
    private String eventId;
    private String aggregateId;
    private String aggregateType;
    private String eventType;
    @Lob
    private String eventData;
    private Long version;
    private Instant occurredAt;

    public DomainEventEntity() {}

    public DomainEventEntity(
            String eventId, String aggregateId, String aggregateType,
            String eventType, String eventData, Long version, Instant occurredAt) {
        this.eventId = eventId;
        this.aggregateId = aggregateId;
        this.aggregateType = aggregateType;
        this.eventType = eventType;
        this.eventData = eventData;
        this.version = version;
        this.occurredAt = occurredAt;
    }

    public String getEventId() { return eventId; }
    public String getAggregateId() { return aggregateId; }
    public String getAggregateType() { return aggregateType; }
    public String getEventType() { return eventType; }
    public String getEventData() { return eventData; }
    public Long getVersion() { return version; }
    public Instant getOccurredAt() { return occurredAt; }
}

public interface DomainEventRepository extends JpaRepository<DomainEventEntity, String> {
    List<DomainEventEntity> findByAggregateIdOrderByVersionAsc(String aggregateId);
    List<DomainEventEntity> findByAggregateTypeAndVersionGreaterThan(
        String aggregateType, Long version);
}
```

The event store table stores each event as a row with an aggregate ID, event type, version, and serialized JSON payload. The `version` column enables optimistic concurrency control — when saving events, you check that the version hasn't changed since the aggregate was loaded. The query methods allow loading all events for an aggregate (for replay) and reading events after a specific version (for event catch-up).

## Event Store Service

```java
@Component
public class EventStore {

    private final DomainEventRepository eventRepository;
    private final ObjectMapper objectMapper;

    public EventStore(DomainEventRepository eventRepository, ObjectMapper objectMapper) {
        this.eventRepository = eventRepository;
        this.objectMapper = objectMapper;
    }

    public void saveEvents(String aggregateId, List<OrderEvent> events, long expectedVersion) {
        List<DomainEventEntity> existing = eventRepository
            .findByAggregateIdOrderByVersionAsc(aggregateId);

        if (!existing.isEmpty()) {
            long lastVersion = existing.get(existing.size() - 1).getVersion();
            if (lastVersion != expectedVersion) {
                throw new ConcurrencyException(
                    "Optimistic lock violation for aggregate: " + aggregateId);
            }
        }

        List<DomainEventEntity> entities = new ArrayList<>();
        for (int i = 0; i < events.size(); i++) {
            try {
                String eventData = objectMapper.writeValueAsString(events.get(i));
                OrderEvent event = events.get(i);
                String eventType = event.getClass().getSimpleName();

                DomainEventEntity entity = new DomainEventEntity(
                    UUID.randomUUID().toString(),
                    aggregateId,
                    "Order",
                    eventType,
                    eventData,
                    expectedVersion + i + 1,
                    Instant.now()
                );
                entities.add(entity);
            } catch (JsonProcessingException e) {
                throw new EventStoreException("Failed to serialize event", e);
            }
        }
        eventRepository.saveAll(entities);
    }

    public List<OrderEvent> loadEvents(String aggregateId) {
        return eventRepository.findByAggregateIdOrderByVersionAsc(aggregateId)
            .stream()
            .map(this::deserializeEvent)
            .toList();
    }

    private OrderEvent deserializeEvent(DomainEventEntity entity) {
        try {
            Class<?> eventClass = Class.forName(
                "com.example.orders.domain.event." + entity.getEventType());
            return (OrderEvent) objectMapper.readValue(entity.getEventData(), eventClass);
        } catch (Exception e) {
            throw new EventStoreException("Failed to deserialize event", e);
        }
    }
}
```

The `saveEvents` method implements optimistic concurrency. It loads existing events for the aggregate, checks that the version matches `expectedVersion`, appends new events with incremented versions, and saves them in a single batch. If another process has already appended events, the version check fails and a `ConcurrencyException` is thrown — the caller must retry by reloading the aggregate and reapplying business logic.

## Aggregate Root with Event Sourcing

The aggregate is rehydrated by replaying events:

```java
public class OrderAggregate {

    private String id;
    private String customerId;
    private List<OrderItemEvent> items;
    private OrderStatus status;
    private long version;
    private List<OrderEvent> uncommittedEvents;

    public OrderAggregate() {
        this.items = new ArrayList<>();
        this.uncommittedEvents = new ArrayList<>();
        this.status = OrderStatus.PENDING;
        this.version = 0;
    }

    public static OrderAggregate create(String orderId, String customerId, List<OrderItemEvent> items) {
        OrderAggregate aggregate = new OrderAggregate();
        aggregate.applyEvent(new OrderCreatedEvent(orderId, customerId, items, Instant.now()));
        return aggregate;
    }

    public void addItem(OrderItemEvent item) {
        if (status != OrderStatus.PENDING) {
            throw new IllegalStateException("Cannot add items to a " + status + " order");
        }
        applyEvent(new ItemAddedEvent(id, item, Instant.now()));
    }

    public void confirm() {
        if (status != OrderStatus.PENDING) {
            throw new IllegalStateException("Order is not in pending state");
        }
        if (items.isEmpty()) {
            throw new IllegalStateException("Cannot confirm an empty order");
        }
        applyEvent(new OrderConfirmedEvent(id, Instant.now()));
    }

    public void cancel(String reason) {
        if (status == OrderStatus.SHIPPED || status == OrderStatus.DELIVERED) {
            throw new IllegalStateException("Cannot cancel shipped or delivered order");
        }
        applyEvent(new OrderCancelledEvent(id, reason, Instant.now()));
    }

    public void loadFromHistory(List<OrderEvent> events) {
        events.forEach(this::apply);
        this.uncommittedEvents.clear();
    }

    private void applyEvent(OrderEvent event) {
        apply(event);
        uncommittedEvents.add(event);
        version++;
    }

    private void apply(OrderEvent event) {
        switch (event) {
            case OrderCreatedEvent e -> {
                this.id = e.orderId();
                this.customerId = e.customerId();
                this.items = new ArrayList<>(e.items());
                this.status = OrderStatus.PENDING;
            }
            case ItemAddedEvent e -> {
                this.items.add(e.item());
            }
            case OrderConfirmedEvent e -> {
                this.status = OrderStatus.CONFIRMED;
            }
            case OrderCancelledEvent e -> {
                this.status = OrderStatus.CANCELLED;
            }
            default -> throw new IllegalStateException("Unknown event: " + event);
        }
    }

    public List<OrderEvent> getUncommittedEvents() {
        return List.copyOf(uncommittedEvents);
    }

    public void markEventsAsCommitted() {
        uncommittedEvents.clear();
    }

    public String getId() { return id; }
    public long getVersion() { return version; }
    public OrderStatus getStatus() { return status; }
}
```

The aggregate uses the event-sourcing pattern. `loadFromHistory` replays all past events to rebuild the current state. `applyEvent` both mutates state (through `apply`) and collects the new event in `uncommittedEvents`. After saving to the event store, `markEventsAsCommitted` clears the pending list. Business methods like `confirm()` and `cancel()` check invariants (e.g., cannot confirm an empty order) and then apply a new event — the event is the source of truth, and the state is derived from it.

## Command Handler

```java
@Component
public class OrderCommandHandler {

    private final EventStore eventStore;
    private final EventBus eventBus;

    public OrderCommandHandler(EventStore eventStore, EventBus eventBus) {
        this.eventStore = eventStore;
        this.eventBus = eventBus;
    }

    public void handle(CreateOrderCommand command) {
        List<OrderItemEvent> items = command.items().stream()
            .map(i -> new OrderItemEvent(i.productId(), i.productName(), i.unitPrice(), i.quantity()))
            .toList();

        OrderAggregate aggregate = OrderAggregate.create(
            command.orderId(), command.customerId(), items);

        eventStore.saveEvents(aggregate.getId(), aggregate.getUncommittedEvents(), 0);
        aggregate.getUncommittedEvents().forEach(eventBus::publish);
        aggregate.markEventsAsCommitted();
    }

    public void handle(AddItemToOrderCommand command) {
        OrderAggregate aggregate = loadAggregate(command.orderId());
        OrderItemEvent item = new OrderItemEvent(
            command.item().productId(),
            command.item().productName(),
            command.item().unitPrice(),
            command.item().quantity()
        );
        aggregate.addItem(item);

        eventStore.saveEvents(aggregate.getId(), aggregate.getUncommittedEvents(), aggregate.getVersion());
        aggregate.getUncommittedEvents().forEach(eventBus::publish);
        aggregate.markEventsAsCommitted();
    }

    public void handle(ConfirmOrderCommand command) {
        OrderAggregate aggregate = loadAggregate(command.orderId());
        aggregate.confirm();

        eventStore.saveEvents(aggregate.getId(), aggregate.getUncommittedEvents(), aggregate.getVersion());
        aggregate.getUncommittedEvents().forEach(eventBus::publish);
        aggregate.markEventsAsCommitted();
    }

    public void handle(CancelOrderCommand command) {
        OrderAggregate aggregate = loadAggregate(command.orderId());
        aggregate.cancel(command.reason());

        eventStore.saveEvents(aggregate.getId(), aggregate.getUncommittedEvents(), aggregate.getVersion());
        aggregate.getUncommittedEvents().forEach(eventBus::publish);
        aggregate.markEventsAsCommitted();
    }

    private OrderAggregate loadAggregate(String orderId) {
        List<OrderEvent> events = eventStore.loadEvents(orderId);
        if (events.isEmpty()) {
            throw new OrderNotFoundException(orderId);
        }
        OrderAggregate aggregate = new OrderAggregate();
        aggregate.loadFromHistory(events);
        return aggregate;
    }
}
```

Each command handler follows the same pattern: load the aggregate from event history, execute the business method (which produces new events), save the new events to the event store (with optimistic concurrency), publish events to the event bus, and mark events as committed. This sequence ensures that events are never published unless they are safely stored.

## Query Model (Projections)

The query model is built from events and stored in a denormalized form:

```java
@Component
public class OrderProjection {

    private final OrderViewRepository orderViewRepository;
    private final OrderItemViewRepository orderItemViewRepository;

    public OrderProjection(
            OrderViewRepository orderViewRepository,
            OrderItemViewRepository orderItemViewRepository) {
        this.orderViewRepository = orderViewRepository;
        this.orderItemViewRepository = orderItemViewRepository;
    }

    @EventListener
    @Transactional
    public void on(OrderCreatedEvent event) {
        OrderView view = new OrderView(
            event.orderId(),
            event.customerId(),
            OrderStatus.PENDING,
            BigDecimal.ZERO,
            Instant.now(),
            null
        );
        orderViewRepository.save(view);

        event.items().forEach(item -> {
            OrderItemView itemView = new OrderItemView(
                UUID.randomUUID().toString(),
                event.orderId(),
                item.productId(),
                item.productName(),
                item.unitPrice(),
                item.quantity(),
                item.unitPrice().multiply(BigDecimal.valueOf(item.quantity()))
            );
            orderItemViewRepository.save(itemView);
        });
    }

    @EventListener
    @Transactional
    public void on(ItemAddedEvent event) {
        OrderItemView itemView = new OrderItemView(
            UUID.randomUUID().toString(),
            event.orderId(),
            event.item().productId(),
            event.item().productName(),
            event.item().unitPrice(),
            event.item().quantity(),
            event.item().unitPrice().multiply(BigDecimal.valueOf(event.item().quantity()))
        );
        orderItemViewRepository.save(itemView);
        updateOrderTotal(event.orderId());
    }

    @EventListener
    @Transactional
    public void on(OrderConfirmedEvent event) {
        orderViewRepository.findById(event.orderId()).ifPresent(view -> {
            view.setStatus(OrderStatus.CONFIRMED);
            orderViewRepository.save(view);
        });
    }

    @EventListener
    @Transactional
    public void on(OrderCancelledEvent event) {
        orderViewRepository.findById(event.orderId()).ifPresent(view -> {
            view.setStatus(OrderStatus.CANCELLED);
            orderViewRepository.save(view);
        });
    }

    private void updateOrderTotal(String orderId) {
        List<OrderItemView> items = orderItemViewRepository.findByOrderId(orderId);
        BigDecimal total = items.stream()
            .map(OrderItemView::getSubtotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        orderViewRepository.findById(orderId).ifPresent(view -> {
            view.setTotalAmount(total);
            orderViewRepository.save(view);
        });
    }
}

@Entity
@Table(name = "order_views")
public class OrderView {
    @Id
    private String id;
    private String customerId;
    @Enumerated(EnumType.STRING)
    private OrderStatus status;
    private BigDecimal totalAmount;
    private Instant createdAt;
    private Instant updatedAt;

    public OrderView() {}

    public OrderView(String id, String customerId, OrderStatus status,
                     BigDecimal totalAmount, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.customerId = customerId;
        this.status = status;
        this.totalAmount = totalAmount;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getCustomerId() { return customerId; }
    public OrderStatus getStatus() { return status; }
    public void setStatus(OrderStatus status) { this.status = status; }
    public BigDecimal getTotalAmount() { return totalAmount; }
    public void setTotalAmount(BigDecimal totalAmount) { this.totalAmount = totalAmount; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}

public interface OrderViewRepository extends JpaRepository<OrderView, String> {
    Page<OrderView> findByCustomerId(String customerId, Pageable pageable);
    List<OrderView> findByStatus(OrderStatus status);
}
```

Projections listen to events and update denormalized read models. The `OrderView` is an entity optimized for querying — it has no business logic, just persisted data ready for fast reads. Each event handler updates only the relevant part of the view. The `updateOrderTotal` recalculates the total whenever items change. Since the read model is derived from events, it can always be rebuilt by replaying all events from the event store.

## Query Handler

```java
@Component
public class OrderQueryHandler {

    private final OrderViewRepository orderViewRepository;
    private final OrderItemViewRepository orderItemViewRepository;

    public OrderQueryHandler(
            OrderViewRepository orderViewRepository,
            OrderItemViewRepository orderItemViewRepository) {
        this.orderViewRepository = orderViewRepository;
        this.orderItemViewRepository = orderItemViewRepository;
    }

    public OrderDetailResponse handle(GetOrderQuery query) {
        OrderView order = orderViewRepository.findById(query.orderId())
            .orElseThrow(() -> new OrderNotFoundException(query.orderId()));
        List<OrderItemView> items = orderItemViewRepository.findByOrderId(query.orderId());
        return new OrderDetailResponse(order.getId(), order.getCustomerId(),
            order.getStatus(), order.getTotalAmount(), items, order.getCreatedAt());
    }

    public Page<OrderSummaryResponse> handle(GetCustomerOrdersQuery query) {
        Page<OrderView> orders = orderViewRepository.findByCustomerId(
            query.customerId(), PageRequest.of(query.page(), query.size()));
        return orders.map(order -> new OrderSummaryResponse(
            order.getId(), order.getStatus(), order.getTotalAmount(), order.getCreatedAt()));
    }
}
```

Query handlers are simple — they read from the denormalized view tables and return DTOs. No business logic, no validation, no side effects. This keeps query latency low and makes read models trivially testable.

## Common Mistakes

### Mixing Command and Query Logic

```java
// Wrong: Same service handles both commands and queries
@Service
public class OrderService {
    public Order createOrder(CreateOrderCommand cmd) { ... }
    public Order getOrder(String id) { ... } // violates CQRS
}
```

```java
// Correct: Separate command and query handlers
@Component
public class OrderCommandHandler {
    public void handle(CreateOrderCommand cmd) { ... }
}

@Component
public class OrderQueryHandler {
    public OrderDetailResponse handle(GetOrderQuery query) { ... }
}
```

### Eventual Consistency Ignorance

```java
// Wrong: Expecting immediate consistency
@PostMapping("/orders")
public ResponseEntity<OrderResponse> createOrder(@RequestBody CreateOrderRequest request) {
    commandBus.dispatch(new CreateOrderCommand(request));
    return ResponseEntity.ok(queryBus.query(new GetOrderQuery(request.orderId())));
    // May fail or return stale data!
}
```

```java
// Correct: Accept eventual consistency
@PostMapping("/orders")
public ResponseEntity<OrderResponse> createOrder(@RequestBody CreateOrderRequest request) {
    commandBus.dispatch(new CreateOrderCommand(request));
    return ResponseEntity.accepted().build();
}
```

## Best Practices

1. Use CQRS when read and write models have significantly different shapes or performance requirements.
2. Pair CQRS with Event Sourcing when audit trails, temporal queries, or complex event replay is needed.
3. Keep commands simple and focused on a single intent.
4. Design projections to be idempotent for reliable event replay.
5. Use optimistic concurrency control in event stores.
6. Implement snapshots for aggregates with long event streams.

## Summary

CQRS and Event Sourcing provide powerful abstractions for systems with complex write logic and different read requirements. CQRS separates command and query responsibilities, while event sourcing stores state as an append-only event log. The combination enables audit trails, temporal queries, and flexible read models. However, the added complexity means these patterns should be applied selectively where the benefits justify the cost.

## References

- Fowler, M. "CQRS"
- "Implementing Domain-Driven Design" by Vaughn Vernon
- Axon Framework Documentation
- "Building Event-Driven Microservices" by Adam Bellemare

Happy Coding
