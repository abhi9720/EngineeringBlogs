---
title: "Choreography-Based Saga Pattern"
description: "Implement choreography-based saga pattern for distributed transactions in microservices: event-driven coordination, compensation, error handling, and Spring Boot examples"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - saga
  - choreography
  - distributed-transactions
  - microservices
coverImage: "/images/saga-pattern-choreography.png"
draft: false
---

## Overview

The saga pattern manages distributed transactions across microservices through a sequence of local transactions. In the choreography-based approach, services communicate via events without a central coordinator. Each service executes its local transaction and emits events that trigger the next service.

## Saga Flow Example: Order Processing

An order saga involves Order Service, Payment Service, Inventory Service, and Shipping Service working together.

```
Order Service: Create order (PENDING) -> emit ORDER_CREATED
    |
    v
Payment Service: Reserve payment -> emit PAYMENT_RESERVED
    |
    v
Inventory Service: Reserve inventory -> emit INVENTORY_RESERVED
    |
    v
Shipping Service: Create shipment -> emit SHIPMENT_CREATED
    |
    v
Order Service: Update order to CONFIRMED
```

## Event Definitions

```java
public class OrderCreatedEvent {
    private String orderId;
    private String customerId;
    private BigDecimal amount;
    private List<OrderItem> items;
    private String timestamp;
}

public class PaymentReservedEvent {
    private String orderId;
    private String paymentId;
    private BigDecimal amount;
    private String timestamp;
}

public class InventoryReservedEvent {
    private String orderId;
    private List<ItemReservation> reservations;
    private String timestamp;
}

public class ShipmentCreatedEvent {
    private String orderId;
    private String trackingId;
    private String timestamp;
}
```

## Order Service

```java
@Component
public class OrderSagaService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @Transactional
    public Order createOrder(OrderRequest request) {
        Order order = new Order(request.getCustomerId(), request.getItems());
        order.setStatus(OrderStatus.PENDING);
        order = orderRepository.save(order);

        OrderCreatedEvent event = new OrderCreatedEvent();
        event.setOrderId(order.getId());
        event.setCustomerId(order.getCustomerId());
        event.setAmount(order.getTotalAmount());
        event.setItems(order.getItems());
        event.setTimestamp(Instant.now().toString());

        kafkaTemplate.send("order-events", order.getId(), event);
        return order;
    }

    @KafkaListener(topics = "payment-events", groupId = "order-service")
    public void onPaymentReserved(PaymentReservedEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.setPaymentId(event.getPaymentId());
        order.setStatus(OrderStatus.PAYMENT_RESERVED);
        orderRepository.save(order);
    }

    @KafkaListener(topics = "inventory-events", groupId = "order-service")
    public void onInventoryReserved(InventoryReservedEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.setStatus(OrderStatus.INVENTORY_RESERVED);
        orderRepository.save(order);
    }

    @KafkaListener(topics = "shipping-events", groupId = "order-service")
    public void onShipmentCreated(ShipmentCreatedEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.setTrackingId(event.getTrackingId());
        order.setStatus(OrderStatus.CONFIRMED);
        orderRepository.save(order);
    }

    @KafkaListener(topics = "saga-compensation-events", groupId = "order-service")
    public void onCompensation(CompensationEvent event) {
        Order order = orderRepository.findById(event.getOrderId()).orElseThrow();
        order.setStatus(OrderStatus.CANCELLED);
        order.setCancellationReason(event.getReason());
        orderRepository.save(order);
    }
}
```

## Payment Service

```java
@Component
public class PaymentSagaService {

    @Autowired
    private PaymentRepository paymentRepository;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @KafkaListener(topics = "order-events", groupId = "payment-service")
    public void onOrderCreated(OrderCreatedEvent event) {
        try {
            Payment payment = new Payment();
            payment.setOrderId(event.getOrderId());
            payment.setAmount(event.getAmount());
            payment.setStatus(PaymentStatus.RESERVED);
            payment = paymentRepository.save(payment);

            PaymentReservedEvent reservedEvent = new PaymentReservedEvent();
            reservedEvent.setOrderId(event.getOrderId());
            reservedEvent.setPaymentId(payment.getId());
            reservedEvent.setAmount(event.getAmount());
            reservedEvent.setTimestamp(Instant.now().toString());

            kafkaTemplate.send("payment-events", event.getOrderId(), reservedEvent);
        } catch (Exception e) {
            // Compensate: emit payment failed event
            CompensationEvent compensation = new CompensationEvent();
            compensation.setOrderId(event.getOrderId());
            compensation.setReason("PAYMENT_FAILED: " + e.getMessage());
            compensation.setStep("payment");
            kafkaTemplate.send("saga-compensation-events", event.getOrderId(), compensation);
        }
    }

    @KafkaListener(topics = "saga-compensation-events", groupId = "payment-service")
    public void onCompensation(CompensationEvent event) {
        if ("payment".equals(event.getStep()) || event.isGlobalRollback()) {
            Payment payment = paymentRepository.findByOrderId(event.getOrderId());
            if (payment != null && payment.getStatus() == PaymentStatus.RESERVED) {
                payment.setStatus(PaymentStatus.RELEASED);
                paymentRepository.save(payment);
            }
        }
    }
}
```

## Inventory Service

```java
@Component
public class InventorySagaService {

    @Autowired
    private InventoryRepository inventoryRepository;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @KafkaListener(topics = "payment-events", groupId = "inventory-service")
    public void onPaymentReserved(PaymentReservedEvent event) {
        try {
            List<ItemReservation> reservations = new ArrayList<>();
            for (OrderItem item : event.getItems()) {
                InventoryItem inventoryItem = inventoryRepository
                    .findByProductId(item.getProductId()).orElseThrow();
                if (inventoryItem.getAvailableQuantity() < item.getQuantity()) {
                    throw new InsufficientInventoryException(
                        "Not enough stock for product: " + item.getProductId());
                }
                inventoryItem.setReservedQuantity(
                    inventoryItem.getReservedQuantity() + item.getQuantity());
                inventoryRepository.save(inventoryItem);
                reservations.add(new ItemReservation(item.getProductId(), item.getQuantity()));
            }

            InventoryReservedEvent reservedEvent = new InventoryReservedEvent();
            reservedEvent.setOrderId(event.getOrderId());
            reservedEvent.setReservations(reservations);
            kafkaTemplate.send("inventory-events", event.getOrderId(), reservedEvent);
        } catch (Exception e) {
            CompensationEvent compensation = new CompensationEvent();
            compensation.setOrderId(event.getOrderId());
            compensation.setReason("INVENTORY_FAILED: " + e.getMessage());
            compensation.setStep("inventory");
            kafkaTemplate.send("saga-compensation-events", event.getOrderId(), compensation);
        }
    }

    @KafkaListener(topics = "saga-compensation-events", groupId = "inventory-service")
    public void onCompensation(CompensationEvent event) {
        if ("inventory".equals(event.getStep()) || event.isGlobalRollback()) {
            // Release reserved inventory
            List<ItemReservation> reservations = inventoryRepository
                .findReservationsByOrderId(event.getOrderId());
            for (ItemReservation reservation : reservations) {
                InventoryItem item = inventoryRepository
                    .findByProductId(reservation.getProductId()).orElseThrow();
                item.setReservedQuantity(
                    item.getReservedQuantity() - reservation.getQuantity());
                inventoryRepository.save(item);
            }
        }
    }
}
```

## Shipping Service

```java
@Component
public class ShippingSagaService {

    @Autowired
    private ShippingRepository shippingRepository;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @KafkaListener(topics = "inventory-events", groupId = "shipping-service")
    public void onInventoryReserved(InventoryReservedEvent event) {
        try {
            Shipment shipment = new Shipment();
            shipment.setOrderId(event.getOrderId());
            shipment.setTrackingId(generateTrackingId());
            shipment.setStatus(ShipmentStatus.PENDING);
            shipment = shippingRepository.save(shipment);

            ShipmentCreatedEvent createdEvent = new ShipmentCreatedEvent();
            createdEvent.setOrderId(event.getOrderId());
            createdEvent.setTrackingId(shipment.getTrackingId());
            kafkaTemplate.send("shipping-events", event.getOrderId(), createdEvent);
        } catch (Exception e) {
            CompensationEvent compensation = new CompensationEvent();
            compensation.setOrderId(event.getOrderId());
            compensation.setReason("SHIPPING_FAILED: " + e.getMessage());
            compensation.setStep("shipping");
            kafkaTemplate.send("saga-compensation-events", event.getOrderId(), compensation);
        }
    }

    @Transactional
    public void cancelShipment(String orderId) {
        Shipment shipment = shippingRepository.findByOrderId(orderId);
        if (shipment != null) {
            shipment.setStatus(ShipmentStatus.CANCELLED);
            shippingRepository.save(shipment);
        }
    }
}
```

## Compensation Event

```java
public class CompensationEvent {
    private String orderId;
    private String reason;
    private String step;
    private boolean globalRollback;
    private String timestamp;

    public CompensationEvent() {
        this.timestamp = Instant.now().toString();
    }

    public static CompensationEvent globalRollback(String orderId, String reason) {
        CompensationEvent event = new CompensationEvent();
        event.setOrderId(orderId);
        event.setReason(reason);
        event.setGlobalRollback(true);
        return event;
    }
}
```

## Best Practices

- Design each service to be idempotent for handling duplicate events.
- Implement compensating transactions for every transactional operation.
- Use outbox pattern to ensure atomic event publishing with database changes.
- Monitor saga execution with tracing and logging.
- Set up dead letter queues for failed events in each saga step.
- Use correlation IDs to track saga instances across services.

## Common Mistakes

### Mistake: Not handling duplicate events

```java
// Wrong - duplicate events cause double processing
@KafkaListener(topics = "payment-events")
public void onPaymentReserved(PaymentReservedEvent event) {
    reservePayment(event.getOrderId(), event.getAmount());
}
```

```java
// Correct - idempotent processing with deduplication
@KafkaListener(topics = "payment-events")
public void onPaymentReserved(PaymentReservedEvent event) {
    if (!paymentRepository.existsByOrderId(event.getOrderId())) {
        reservePayment(event.getOrderId(), event.getAmount());
    }
}
```

### Mistake: Missing compensation for all saga steps

```java
// Wrong - only compensates the failed step, not previous successful steps
```

```java
// Correct - cascading compensation rolls back all completed steps
@KafkaListener(topics = "saga-compensation-events")
public void onCompensation(CompensationEvent event) {
    if (event.getStep().equals("payment") || event.isGlobalRollback()) {
        releasePayment(event.getOrderId());
    }
    if (event.getStep().equals("inventory") || event.isGlobalRollback()) {
        releaseInventory(event.getOrderId());
    }
    // Each service handles its own compensation
}
```

## Summary

Choreography-based saga pattern enables distributed transactions without a central coordinator. Services react to events and emit new events, with compensating actions for rollback. This pattern is well-suited for event-driven microservices but requires careful design for error handling, idempotency, and monitoring.

## References

- [Saga Pattern - Microsoft Architecture](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)
- [Chris Richardson - Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [Caitie McCaffrey - Distributed Sagas](https://www.youtube.com/watch?v=0UTOLRTwOX0)

Happy Coding