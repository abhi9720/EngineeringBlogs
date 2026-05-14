---
title: "Event Notification vs Event Carried State Transfer"
description: "Compare event notification and event-carried state transfer patterns: when to include data in events, reference-only events, trade-offs, and implementation strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - event-driven
  - patterns
  - event-notification
  - event-carried-state
coverImage: "/images/event-notification-vs-event-carried-state.png"
draft: false
---

## Overview

Event-driven architectures commonly use two patterns: event notification (reference-only events) and event-carried state transfer (data-rich events). Choosing between them affects coupling, performance, and data consistency. This article explores both patterns with implementation examples and trade-offs.

## Event Notification Pattern

Event notification sends minimal data in the event, typically just a reference (ID) and event type. Consumers must fetch additional data from the source service. This keeps the event schema stable — the source service can change its internal data model without breaking consumers — but at the cost of an additional network call per event (the N+1 problem). It also means consumers always get the latest data from the source rather than potentially stale snapshot data.

```java
// Event notification - minimal payload with just reference
public class OrderCreatedEvent {
    private String eventType = "ORDER_CREATED";
    private String orderId;
    private String timestamp;
    // No order details - consumer must fetch them

    public OrderCreatedEvent(String orderId) {
        this.orderId = orderId;
        this.timestamp = Instant.now().toString();
    }
}
```

### Producer

The producer saves the order in the database, then publishes an event containing only the order ID. The event is small, fast to serialize, and cheap to transmit. The producer doesn't need to decide what data downstream consumers need — it just announces "something happened to this entity."

```java
@Component
public class OrderService {

    @Autowired
    private KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    @Autowired
    private OrderRepository orderRepository;

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(Order.from(request));
        kafkaTemplate.send("order-events", order.getId(),
            new OrderCreatedEvent(order.getId()));
        return order;
    }
}
```

### Consumer

The consumer receives the event, extracts the order ID, and makes a synchronous call to `OrderServiceClient.getOrder()` to fetch the full data. This means the consumer always works with the latest state from the source service — no stale data. However, this tight coupling means that if `OrderService` is down, the consumer can't process the event at all.

```java
@Component
public class NotificationConsumer {

    @Autowired
    private OrderServiceClient orderServiceClient;

    @KafkaListener(topics = "order-events", groupId = "shipping-group")
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Must call OrderService to get details
        Order order = orderServiceClient.getOrder(event.getOrderId());
        shippingService.initiateShipping(order);
    }
}
```

## Event-Carried State Transfer Pattern

Events include all relevant data, making consumers self-sufficient. The consumer can process the event without calling any other service — it has all the information it needs right in the payload. This eliminates the N+1 problem and makes consumers more resilient to source service outages. The trade-off: larger event payloads, tighter schema coupling, and the risk of stale data (the consumer sees the state at event creation time, not current state).

```java
// Event-carried state transfer - full data in payload
public class OrderCreatedEvent {
    private String eventType = "ORDER_CREATED";
    private String orderId;
    private String customerId;
    private String customerName;
    private String customerEmail;
    private List<OrderItem> items;
    private BigDecimal totalAmount;
    private Address shippingAddress;
    private String timestamp;

    public OrderCreatedEvent(Order order) {
        this.orderId = order.getId();
        this.customerId = order.getCustomerId();
        this.customerName = order.getCustomerName();
        this.customerEmail = order.getCustomerEmail();
        this.items = order.getItems().stream()
            .map(item -> new OrderItem(item.getProductId(), item.getProductName(),
                 item.getQuantity(), item.getUnitPrice()))
            .collect(Collectors.toList());
        this.totalAmount = order.getTotalAmount();
        this.shippingAddress = order.getShippingAddress();
        this.timestamp = Instant.now().toString();
    }
}
```

### Producer

The producer builds a rich event from the full order object after saving. The event contains everything a consumer might need — customer details, line items, pricing, and shipping address. This requires the producer to understand what data downstream services need, creating a shared schema contract.

```java
@Component
public class OrderServiceWithState {

    @Autowired
    private KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(Order.from(request));
        OrderCreatedEvent event = new OrderCreatedEvent(order);
        // Full order data is included in the event
        kafkaTemplate.send("order-events", order.getId(), event);
        return order;
    }
}
```

### Consumer

The consumer builds its domain objects directly from the event payload without any external API calls. This makes the consumer fast and resilient — even if the source service is unavailable, the consumer can still process the event. The downside is that the consumer sees the data as it was when the event was created; if the order was updated after the event, the consumer won't see the latest state.

```java
@Component
public class StateCarriedConsumer {

    @KafkaListener(topics = "order-events", groupId = "shipping-group")
    public void handleOrderCreated(OrderCreatedEvent event) {
        // No need to call OrderService - all data is in the event
        ShippingOrder shippingOrder = ShippingOrder.builder()
            .orderId(event.getOrderId())
            .customerName(event.getCustomerName())
            .customerEmail(event.getCustomerEmail())
            .items(event.getItems())
            .address(event.getShippingAddress())
            .build();
        shippingService.initiateShipping(shippingOrder);
    }
}
```

## Comparison

| Aspect | Event Notification | Event-Carried State |
|--------|-------------------|--------------------|
| Coupling | Loose (only ID reference) | Tighter (schema dependency) |
| Consumer autonomy | Low (must call source) | High (self-sufficient) |
| Data freshness | Real-time (always fetches latest) | May be stale (data at event time) |
| Network calls | More (N+1 problem) | Fewer (single event) |
| Event size | Small | Large |
| Schema evolution | Easier (minimal schema) | Harder (versioning needed) |
| Consistency | Stronger (latest data) | Eventual (snapshot data) |

## Hybrid Approach

Combine both patterns for flexibility and autonomy. Include core fields (IDs, status, total) that most consumers need, making them self-sufficient for common use cases. But keep optional expanded fields (items, address) that can be null — consumers that need that data can fetch it from the source service, while others don't pay the cost. The `dataVersion` and `serviceSource` fields give consumers metadata about when and where the data came from.

```java
public class OrderEvent {
    private String eventType;
    private String orderId;

    // Core fields always included
    private String customerId;
    private String orderStatus;
    private BigDecimal totalAmount;

    // Optional expanded fields (may be null)
    private List<OrderItem> items;
    private Address address;

    // Metadata for fetching additional data if needed
    private String dataVersion;
    private String serviceSource;
}
```

## Best Practices

- Use event notification when data changes frequently and consumers need current state.
- Use event-carried state when consumers need to process independently and data staleness is acceptable.
- Include a version field in events to support schema evolution.
- Consider hybrid approach for flexibility in complex systems.
- Document event schemas to manage coupling in event-carried state pattern.

## Common Mistakes

### Mistake: Undersized events with too many follow-up calls

Sending only an order ID forces every consumer to make a synchronous call back to the source service. If you have 5 consumers, each order creation triggers 5 additional HTTP calls — the N+1 problem at scale. Include commonly needed fields like customer ID and status so that simple consumers can work independently.

```java
// Wrong - every consumer must call back for data
public class OrderEvent {
    private String orderId;
}
```

```java
// Correct - include commonly needed fields
public class OrderEvent {
    private String orderId;
    private String customerId;
    private String status;
    private BigDecimal total;
}
```

### Mistake: Oversized events with service-internal data

Including internal implementation details (discount rules, fraud check results, inventory reservation IDs) in events creates coupling between the producer's internals and all consumers. If the producer changes its internal data model, every consumer breaks. Only include data that consumers genuinely need.

```java
// Wrong - internal implementation detail exposed
public class OrderEvent {
    private String orderId;
    private String internalDiscountRule;
    private String inventoryReservationId;
    private List<String> fraudCheckResults;
}
```

```java
// Correct - consumer-relevant data only
public class OrderEvent {
    private String orderId;
    private String customerId;
    private List<OrderItem> items;
    private BigDecimal total;
    private Address shippingAddress;
}
```

## Summary

Event notification minimizes coupling but increases network calls. Event-carried state transfer improves consumer autonomy at the cost of larger events and potential data staleness. Choose based on consumer requirements and consistency needs.

## References

- [Martin Fowler - Event Notification](https://martinfowler.com/articles/201701-event-driven.html)
- [Event-Carried State Transfer Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-carried-state-transfer.html)

Happy Coding
