---
title: CQRS and Event Sourcing
description: >-
  Implement CQRS and Event Sourcing patterns: command/query separation, event
  stores, aggregate replay, Axon Framework, and production patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - cqrs
  - event-sourcing
  - axon-framework
  - architecture
coverImage: /images/backend/data-access/data-patterns/cqrs-and-event-sourcing.png
draft: false
order: 10
---
# CQRS and Event Sourcing

## Overview

CQRS (Command Query Responsibility Segregation) separates read and write operations into different models. Event Sourcing stores all changes as a sequence of events rather than current state. Combined, they provide powerful audit trails, temporal queries, and scalable read/write separation for complex domains.

---

## CQRS Pattern

### Command Model (Write Side)

In CQRS, the command model is responsible for validating business rules and mutating state. Commands are intent-based objects named after the user's goal (e.g., `CreateOrderCommand`) rather than CRUD operations. They are immutable and carry only the data needed to execute the operation. The command handler processes the command—it loads the aggregate, applies business logic, persists changes, and publishes events that other components can react to. This separation ensures that the write side is optimized for consistency and validation, not for data retrieval.

```java
// Command - represents an intent to change state
public class CreateOrderCommand {
    private final String orderId;
    private final String userId;
    private final List<OrderItemCommand> items;
    private final Address shippingAddress;

    public CreateOrderCommand(String orderId, String userId,
                              List<OrderItemCommand> items,
                              Address shippingAddress) {
        this.orderId = orderId;
        this.userId = userId;
        this.items = Collections.unmodifiableList(items);
        this.shippingAddress = shippingAddress;
    }

    public String getOrderId() { return orderId; }
    public String getUserId() { return userId; }
    public List<OrderItemCommand> getItems() { return items; }
    public Address getShippingAddress() { return shippingAddress; }
}

public class OrderItemCommand {
    private final String productId;
    private final int quantity;
    private final BigDecimal unitPrice;
}

// Command handler - processes commands
@Component
public class CreateOrderCommandHandler implements CommandHandler<CreateOrderCommand> {

    private final OrderRepository orderRepository;
    private final EventPublisher eventPublisher;

    public CreateOrderCommandHandler(OrderRepository orderRepository,
                                     EventPublisher eventPublisher) {
        this.orderRepository = orderRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public void handle(CreateOrderCommand command) {
        // Validate
        if (command.getItems().isEmpty()) {
            throw new IllegalArgumentException("Order must have at least one item");
        }

        // Create aggregate
        Order order = new Order(
            command.getOrderId(),
            command.getUserId(),
            command.getShippingAddress()
        );

        // Add items
        command.getItems().forEach(item ->
            order.addItem(item.getProductId(), item.getQuantity(), item.getUnitPrice())
        );

        // Save
        orderRepository.save(order);

        // Publish event
        eventPublisher.publish(new OrderCreatedEvent(
            command.getOrderId(),
            command.getUserId(),
            command.getItems().stream()
                .map(i -> new OrderItemEvent(i.getProductId(), i.getQuantity(), i.getUnitPrice()))
                .toList(),
            command.getShippingAddress(),
            Instant.now()
        ));
    }
}
```

### Query Model (Read Side)

The read model is completely separate from the command model—it is denormalized, often stored in a different database, and optimized specifically for the queries the UI needs to perform. Unlike the write side, the read side does not enforce business rules; it simply provides data in the shape the frontend requires. This freedom allows complex joins, aggregations, and computed fields to be pre-materialized, making queries extremely fast. The read model gets updated asynchronously by consuming events published by the command side.

```java
// Read model - optimized for queries, denormalized
@Document(collection = "order_read_model")
public class OrderReadModel {

    @Id
    private String id;

    private String orderId;
    private String userId;
    private String userName;
    private String userEmail;
    private List<OrderItemReadModel> items;
    private BigDecimal totalAmount;
    private String status;
    private Address shippingAddress;
    private String trackingNumber;
    private Instant createdAt;
    private Instant updatedAt;
    private Map<String, Object> metadata;
}

// Query service
@Service
public class OrderQueryService {

    private final OrderReadModelRepository readRepository;
    private final ProductReadModelRepository productReadRepository;

    public OrderQueryService(OrderReadModelRepository readRepository,
                             ProductReadModelRepository productReadRepository) {
        this.readRepository = readRepository;
        this.productReadRepository = productReadRepository;
    }

    public OrderSummary getOrderSummary(String orderId) {
        OrderReadModel order = readRepository.findByOrderId(orderId);
        List<ProductSummary> products = order.getItems().stream()
            .map(item -> productReadRepository.findByProductId(item.getProductId()))
            .map(product -> new ProductSummary(product.getName(), product.getImageUrl()))
            .toList();

        return new OrderSummary(order, products);
    }

    public Page<OrderListDto> getUserOrders(String userId, Pageable pageable) {
        // Optimized query against read model
        return readRepository.findByUserId(userId, pageable)
            .map(this::toListDto);
    }

    public List<OrderAggregate> getOrderAnalytics(LocalDate start, LocalDate end) {
        return readRepository.getOrderAggregation(start, end);
    }

    private OrderListDto toListDto(OrderReadModel order) {
        return new OrderListDto(
            order.getOrderId(),
            order.getTotalAmount(),
            order.getStatus(),
            order.getCreatedAt()
        );
    }
}
```

---

## Event Sourcing

### Event Store

In Event Sourcing, the current state of an aggregate is derived by replaying a sequence of events. Each `DomainEvent` captures a specific fact that occurred in the system—an order was created, an order was shipped, etc. Events are immutable and stored in append-only fashion, providing a complete audit trail. The `version` field enables optimistic concurrency control: before saving a new event, the event store checks that the aggregate has not been modified concurrently, throwing a `ConcurrencyException` if a version conflict is detected.

```java
// Base event
public abstract class DomainEvent {
    private final String eventId;
    private final String aggregateId;
    private final Instant occurredAt;
    private final int version;

    protected DomainEvent(String aggregateId, int version) {
        this.eventId = UUID.randomUUID().toString();
        this.aggregateId = aggregateId;
        this.occurredAt = Instant.now();
        this.version = version;
    }

    public String getEventId() { return eventId; }
    public String getAggregateId() { return aggregateId; }
    public Instant getOccurredAt() { return occurredAt; }
    public int getVersion() { return version; }
}

// Specific events
public class OrderCreatedEvent extends DomainEvent {
    private final String userId;
    private final List<OrderItemEvent> items;
    private final Address shippingAddress;

    public OrderCreatedEvent(String orderId, String userId,
                             List<OrderItemEvent> items,
                             Address shippingAddress, int version) {
        super(orderId, version);
        this.userId = userId;
        this.items = items;
        this.shippingAddress = shippingAddress;
    }
}

public class OrderShippedEvent extends DomainEvent {
    private final String trackingNumber;
    private final String carrier;

    public OrderShippedEvent(String orderId, String trackingNumber,
                             String carrier, int version) {
        super(orderId, version);
        this.trackingNumber = trackingNumber;
        this.carrier = carrier;
    }
}

public class OrderCancelledEvent extends DomainEvent {
    private final String reason;

    public OrderCancelledEvent(String orderId, String reason, int version) {
        super(orderId, version);
        this.reason = reason;
    }
}
```

### Event Sourced Aggregate

The aggregate is the core building block of Event Sourcing on the write side. It encapsulates business logic and emits events for every state change. The `when()` methods on the aggregate handle each event type to reconstruct the current state. The `replay()` static method allows reconstructing an aggregate from its full event stream—useful for rebuilds, debugging, and temporal queries. Note that aggregate methods like `ship()` and `cancel()` enforce business rules (e.g., "can only ship confirmed orders") before calling `applyChange()` to emit a new event.

```java
public class OrderAggregate {

    private String orderId;
    private String userId;
    private List<OrderItem> items;
    private OrderStatus status;
    private Address shippingAddress;
    private String trackingNumber;
    private int version;

    // Empty constructor for reconstruction
    public OrderAggregate() {}

    // Factory method
    public static OrderAggregate create(CreateOrderCommand command) {
        OrderAggregate aggregate = new OrderAggregate();
        aggregate.applyChange(new OrderCreatedEvent(
            command.getOrderId(),
            command.getUserId(),
            command.getItems().stream()
                .map(i -> new OrderItemEvent(i.getProductId(), i.getQuantity(), i.getUnitPrice()))
                .toList(),
            command.getShippingAddress(),
            1
        ));
        return aggregate;
    }

    public void ship(String trackingNumber, String carrier) {
        if (status != OrderStatus.CONFIRMED) {
            throw new IllegalStateException("Can only ship confirmed orders");
        }
        applyChange(new OrderShippedEvent(orderId, trackingNumber, carrier, version + 1));
    }

    public void cancel(String reason) {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Cannot cancel shipped orders");
        }
        applyChange(new OrderCancelledEvent(orderId, reason, version + 1));
    }

    // Apply event to mutate state
    private void applyChange(DomainEvent event) {
        when(event);
        version = event.getVersion();
    }

    // Event handlers
    private void when(OrderCreatedEvent event) {
        this.orderId = event.getAggregateId();
        this.userId = event.getUserId();
        this.items = event.getItems().stream()
            .map(i -> new OrderItem(i.getProductId(), i.getQuantity(), i.getUnitPrice()))
            .toList();
        this.shippingAddress = event.getShippingAddress();
        this.status = OrderStatus.CREATED;
    }

    private void when(OrderShippedEvent event) {
        this.trackingNumber = event.getTrackingNumber();
        this.status = OrderStatus.SHIPPED;
    }

    private void when(OrderCancelledEvent event) {
        this.status = OrderStatus.CANCELLED;
    }

    // Reconstruct aggregate from event stream
    public static OrderAggregate replay(List<DomainEvent> events) {
        OrderAggregate aggregate = new OrderAggregate();
        for (DomainEvent event : events) {
            aggregate.when(event);
            aggregate.version = event.getVersion();
        }
        return aggregate;
    }
}
```

### Event Store Implementation

The event store is the persistence layer for events. It stores events as serialized JSON blobs in a relational table, keyed by aggregate ID and ordered by version. The implementation below uses JDBC for direct control over the SQL, with Jackson for serialization. The version check at the beginning of `saveEvents()` implements optimistic concurrency: if the current version in the database does not match the expected version, another thread has already committed an event for this aggregate and the operation is rejected with a `ConcurrencyException`. The `loadEvents()` method retrieves all events for a given aggregate in order, which can then be passed to `OrderAggregate.replay()` to reconstruct the current state.

```java
@Repository
public class EventStoreRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public EventStoreRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public void saveEvents(String aggregateId, List<DomainEvent> events, int expectedVersion) {
        // Check for concurrency
        Integer currentVersion = jdbcTemplate.queryForObject(
            "SELECT MAX(version) FROM events WHERE aggregate_id = ?",
            Integer.class, aggregateId);

        if (currentVersion != null && currentVersion >= expectedVersion) {
            throw new ConcurrencyException("Aggregate " + aggregateId
                + " has been modified. Expected version: " + expectedVersion
                + ", current version: " + currentVersion);
        }

        // Save events
        for (DomainEvent event : events) {
            try {
                jdbcTemplate.update(
                    "INSERT INTO events (event_id, aggregate_id, event_type, event_data, version, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
                    event.getEventId(),
                    event.getAggregateId(),
                    event.getClass().getName(),
                    objectMapper.writeValueAsString(event),
                    event.getVersion(),
                    Timestamp.from(event.getOccurredAt())
                );
            } catch (JsonProcessingException e) {
                throw new RuntimeException("Failed to serialize event", e);
            }
        }
    }

    public List<DomainEvent> loadEvents(String aggregateId) {
        return jdbcTemplate.query(
            "SELECT event_data, event_type FROM events WHERE aggregate_id = ? ORDER BY version",
            new Object[]{aggregateId},
            (rs, rowNum) -> {
                try {
                    String eventData = rs.getString("event_data");
                    String eventType = rs.getString("event_type");
                    return (DomainEvent) objectMapper.readValue(eventData,
                        Class.forName(eventType));
                } catch (Exception e) {
                    throw new RuntimeException("Failed to deserialize event", e);
                }
            }
        );
    }
}
```

---

## Projections (Read Model Updates)

### Event Handlers for Projections

Projections are the mechanism that keeps read models in sync with the event stream. Each projection is a `@EventListener` method that responds to a specific event type and updates the corresponding read model. For example, when an `OrderCreatedEvent` is published, the projection creates a new denormalized document in MongoDB (or any other read-optimized store). Because projections are event-driven and typically asynchronous, the read models are eventually consistent with the write side—there is a small lag between the command being processed and the read model being updated.

```java
@Component
public class OrderProjectionUpdater {

    private final OrderReadModelRepository readModelRepository;
    private final UserReadModelRepository userReadRepository;

    @EventListener
    @Transactional
    public void onOrderCreated(OrderCreatedEvent event) {
        OrderReadModel readModel = new OrderReadModel();
        readModel.setOrderId(event.getAggregateId());
        readModel.setUserId(event.getUserId());
        readModel.setItems(event.getItems().stream()
            .map(i -> new OrderItemReadModel(i.getProductId(), i.getQuantity(), i.getUnitPrice()))
            .toList());
        readModel.setTotalAmount(calculateTotal(event.getItems()));
        readModel.setStatus("CREATED");
        readModel.setShippingAddress(event.getShippingAddress());
        readModel.setCreatedAt(event.getOccurredAt());
        readModel.setUpdatedAt(event.getOccurredAt());

        readModelRepository.save(readModel);
    }

    @EventListener
    @Transactional
    public void onOrderShipped(OrderShippedEvent event) {
        OrderReadModel order = readModelRepository.findByOrderId(event.getAggregateId());
        order.setStatus("SHIPPED");
        order.setTrackingNumber(event.getTrackingNumber());
        order.setUpdatedAt(event.getOccurredAt());
        readModelRepository.save(order);
    }

    @EventListener
    @Transactional
    public void onOrderCancelled(OrderCancelledEvent event) {
        OrderReadModel order = readModelRepository.findByOrderId(event.getAggregateId());
        order.setStatus("CANCELLED");
        order.setUpdatedAt(event.getOccurredAt());
        readModelRepository.save(order);
    }

    private BigDecimal calculateTotal(List<OrderItemEvent> items) {
        return items.stream()
            .map(i -> i.getUnitPrice().multiply(BigDecimal.valueOf(i.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

---

## Best Practices

1. **Separate command and query models**: Different databases if needed
2. **Event store is source of truth**: Read models are derived and rebuildable
3. **Use eventual consistency**: Read models may lag behind commands
4. **Version events for schema evolution**: Backward compatible event formats
5. **Snapshot aggregates periodically**: Prevent replaying all events
6. **Idempotent event handlers**: Handle duplicate events safely
7. **Monitor projection lag**: Alert on delayed read model updates
8. **Use event versioning**: Events are immutable schema
9. **Test event replay**: Verify projections rebuild correctly
10. **Consider Axon Framework**: Mature CQRS/ES framework for Java

As aggregates accumulate thousands of events, replaying from the beginning becomes expensive. Snapshotting solves this by periodically persisting a full aggregate state checkpoint. When loading the aggregate, the system reads the latest snapshot and replays only events that occurred after it, dramatically reducing replay time for long-lived aggregates.

```java
// Snapshot configuration
@Service
public class SnapshotService {

    private static final int SNAPSHOT_FREQUENCY = 100;

    private final EventStoreRepository eventStore;
    private final SnapshotRepository snapshotRepository;

    @Transactional
    public void takeSnapshot(String aggregateId) {
        List<DomainEvent> events = eventStore.loadEvents(aggregateId);
        int lastSnapshotVersion = getLastSnapshotVersion(aggregateId);

        if (events.size() - lastSnapshotVersion >= SNAPSHOT_FREQUENCY) {
            OrderAggregate aggregate = OrderAggregate.replay(events);
            snapshotRepository.save(new Snapshot(aggregateId, aggregate, events.size()));
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Same Model for Read and Write

Using the same entity model for both commands and queries forces you to compromise on both. The write model needs aggregates with encapsulated business logic, while the read model needs flat, denormalized structures optimized for fast retrieval. Force-fitting both into a single model leads to complex, hard-to-maintain code.

```java
// WRONG: Single model for both operations
@Entity
public class Order {
    // Used for both commands and queries
    // Optimizing for writes hurts reads and vice versa
}

// CORRECT: Separate command and query models
```

### Mistake 2: Strong Consistency for Read Models

Expecting read models to be immediately consistent after a command executes is a common misconception. In practice, there is always some propagation delay—the event must be persisted, the projection must process it, and the new data must become queryable. Architect your application to handle this eventual consistency gracefully, for example by showing a "processing" state or polling for updates.

```java
// WRONG: Expecting read model to be immediately consistent
orderService.createOrder(command);
OrderReadModel order = orderQueryService.getOrder(orderId);
// Read model may not reflect the creation yet!

// CORRECT: Design for eventual consistency
```

### Mistake 3: Not Versioning Events

Events are permanent and immutable once stored. If you change an event class (e.g., rename a field), all existing serialized events become unreadable. Always version your event schemas and use upcasting or migration strategies to handle schema evolution over time.

```java
// WRONG: Event schema changes without versioning
// Old events can't be deserialized

// CORRECT: Use event versioning
class OrderCreatedEventV1 { ... }
class OrderCreatedEventV2 { ... }
```

---

## Summary

1. CQRS separates read and write models for independent optimization
2. Commands change state, queries read state
3. Event Sourcing stores state changes as immutable events
4. Events are the source of truth, current state is derived
5. Projections build read models from event streams
6. Event store supports audit, temporal queries, and replay
7. Aggregates encapsulate business logic and emit events
8. Use snapshots to optimize aggregate reconstruction
9. Version events for schema evolution
10. Design for eventual consistency between command and query models

---

## References

- [CQRS - Martin Fowler](https://martinfowler.com/bliki/CQRS.html)
- [Event Sourcing - Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Axon Framework Documentation](https://docs.axoniq.io/reference-guide/)
- [Microsoft CQRS/ES Guide](https://docs.microsoft.com/en-us/azure/architecture/patterns/cqrs)

Happy Coding
