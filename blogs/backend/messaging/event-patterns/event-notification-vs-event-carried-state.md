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

Event notification sends minimal data in the event, typically just a reference (ID) and event type. Consumers must fetch additional data from the source service.

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

Events include all relevant data, making consumers self-sufficient.

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

Combine both patterns for flexibility and autonomy.

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