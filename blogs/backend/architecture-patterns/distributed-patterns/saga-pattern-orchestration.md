---
title: "Saga Pattern: Orchestration"
description: "Implement orchestration-based saga pattern for distributed transactions with compensation and coordination"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["saga-pattern", "orchestration", "distributed-transactions", "microservices"]
coverImage: "/images/saga-pattern-orchestration.png"
draft: false
---

## Overview

The Saga pattern manages distributed transactions across microservices by breaking them into a sequence of local transactions, each with a compensating action for rollback. Unlike distributed transactions (2PC), sagas embrace eventual consistency and are suitable for long-running business processes.

There are two implementation approaches: choreography (event-driven) and orchestration (centralized coordinator). This post focuses on orchestration-based sagas, where a coordinator service directs each step and invokes compensating actions on failure.

## Orchestration-Based Saga

In orchestration, a saga orchestrator tells each service what to do. The orchestrator tracks the saga state and coordinates the flow, including compensations.

```
Order Saga Orchestrator
    |
    |--> Inventory Service: Reserve Items
    |       |--> success: continue
    |       |--> failure: compensate (none needed yet)
    |
    |--> Payment Service: Charge Customer
    |       |--> success: continue
    |       |--> failure: compensate (release inventory)
    |
    |--> Shipping Service: Create Shipment
    |       |--> success: continue
    |       |--> failure: compensate (refund payment, release inventory)
    |
    |--> Notification Service: Send Confirmation
```

## Saga Orchestrator Implementation

```java
@Component
public class OrderSagaOrchestrator {

    private final SagaStateRepository sagaStateRepository;
    private final InventoryServiceClient inventoryClient;
    private final PaymentServiceClient paymentClient;
    private final ShippingServiceClient shippingClient;
    private final NotificationServiceClient notificationClient;

    public OrderSagaOrchestrator(
            SagaStateRepository sagaStateRepository,
            InventoryServiceClient inventoryClient,
            PaymentServiceClient paymentClient,
            ShippingServiceClient shippingClient,
            NotificationServiceClient notificationClient) {
        this.sagaStateRepository = sagaStateRepository;
        this.inventoryClient = inventoryClient;
        this.paymentClient = paymentClient;
        this.shippingClient = shippingClient;
        this.notificationClient = notificationClient;
    }

    public void startOrderSaga(CreateOrderCommand command) {
        SagaState saga = new SagaState(
            command.orderId(),
            SagaStatus.STARTED,
            Instant.now()
        );
        sagaStateRepository.save(saga);

        try {
            reserveInventory(command);
            processPayment(command);
            createShipment(command);
            sendConfirmation(command);
            completeSaga(command.orderId());
        } catch (SagaStepException e) {
            compensate(command.orderId(), e.getFailedStep());
        }
    }

    private void reserveInventory(CreateOrderCommand cmd) {
        try {
            inventoryClient.reserve(cmd.productId(), cmd.quantity());
            recordStep(cmd.orderId(), SagaStep.INVENTORY_RESERVED);
        } catch (Exception e) {
            throw new SagaStepException(SagaStep.INVENTORY_RESERVED, "Inventory reservation failed", e);
        }
    }

    private void processPayment(CreateOrderCommand cmd) {
        try {
            paymentClient.charge(cmd.customerId(), cmd.totalAmount());
            recordStep(cmd.orderId(), SagaStep.PAYMENT_CHARGED);
        } catch (Exception e) {
            throw new SagaStepException(SagaStep.PAYMENT_CHARGED, "Payment processing failed", e);
        }
    }

    private void createShipment(CreateOrderCommand cmd) {
        try {
            shippingClient.createShipment(cmd.orderId(), cmd.address(), cmd.items());
            recordStep(cmd.orderId(), SagaStep.SHIPMENT_CREATED);
        } catch (Exception e) {
            throw new SagaStepException(SagaStep.SHIPMENT_CREATED, "Shipment creation failed", e);
        }
    }

    private void sendConfirmation(CreateOrderCommand cmd) {
        try {
            notificationClient.sendOrderConfirmation(cmd.orderId(), cmd.customerEmail());
            recordStep(cmd.orderId(), SagaStep.CONFIRMATION_SENT);
        } catch (Exception e) {
            throw new SagaStepException(SagaStep.CONFIRMATION_SENT, "Notification failed", e);
        }
    }

    private void compensate(String orderId, SagaStep failedStep) {
        SagaState saga = sagaStateRepository.findById(orderId)
            .orElseThrow(() -> new SagaNotFoundException(orderId));
        saga.setStatus(SagaStatus.COMPENSATING);
        sagaStateRepository.save(saga);

        switch (failedStep) {
            case CONFIRMATION_SENT -> compensateShipment(orderId);
            case SHIPMENT_CREATED -> {
                compensatePayment(orderId);
                compensateShipment(orderId);
            }
            case PAYMENT_CHARGED -> compensateInventory(orderId);
            default -> log.warn("No compensation needed for step: {}", failedStep);
        }

        saga.setStatus(SagaStatus.COMPENSATED);
        saga.setCompensatedAt(Instant.now());
        sagaStateRepository.save(saga);
    }

    private void compensateInventory(String orderId) {
        try {
            inventoryClient.release(orderId);
            log.info("Inventory released for order: {}", orderId);
        } catch (Exception e) {
            log.error("Failed to release inventory for order: {}", orderId, e);
        }
    }

    private void compensatePayment(String orderId) {
        try {
            paymentClient.refund(orderId);
            log.info("Payment refunded for order: {}", orderId);
        } catch (Exception e) {
            log.error("Failed to refund payment for order: {}", orderId, e);
        }
    }

    private void compensateShipment(String orderId) {
        try {
            shippingClient.cancelShipment(orderId);
            log.info("Shipment cancelled for order: {}", orderId);
        } catch (Exception e) {
            log.error("Failed to cancel shipment for order: {}", orderId, e);
        }
    }

    private void recordStep(String orderId, SagaStep step) {
        SagaState saga = sagaStateRepository.findById(orderId)
            .orElseThrow(() -> new SagaNotFoundException(orderId));
        saga.addCompletedStep(step);
        sagaStateRepository.save(saga);
    }

    private void completeSaga(String orderId) {
        SagaState saga = sagaStateRepository.findById(orderId)
            .orElseThrow(() -> new SagaNotFoundException(orderId));
        saga.setStatus(SagaStatus.COMPLETED);
        saga.setCompletedAt(Instant.now());
        sagaStateRepository.save(saga);
    }
}
```

## Saga State Model

Persisting saga state enables recovery from failures and provides visibility:

```java
@Entity
@Table(name = "saga_states")
public class SagaState {

    @Id
    private String orderId;

    @Enumerated(EnumType.STRING)
    private SagaStatus status;

    @ElementCollection
    @Enumerated(EnumType.STRING)
    private List<SagaStep> completedSteps;

    private Instant startedAt;
    private Instant completedAt;
    private Instant compensatedAt;
    @Version
    private Long version;

    public SagaState() {}

    public SagaState(String orderId, SagaStatus status, Instant startedAt) {
        this.orderId = orderId;
        this.status = status;
        this.startedAt = startedAt;
        this.completedSteps = new ArrayList<>();
    }

    public void addCompletedStep(SagaStep step) {
        this.completedSteps.add(step);
    }

    public boolean isStepCompleted(SagaStep step) {
        return completedSteps.contains(step);
    }

    public String getOrderId() { return orderId; }
    public SagaStatus getStatus() { return status; }
    public void setStatus(SagaStatus status) { this.status = status; }
    public List<SagaStep> getCompletedSteps() { return completedSteps; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public void setCompletedAt(Instant completedAt) { this.completedAt = completedAt; }
    public Instant getCompensatedAt() { return compensatedAt; }
    public void setCompensatedAt(Instant compensatedAt) { this.compensatedAt = compensatedAt; }
}

public enum SagaStatus {
    STARTED,
    COMPLETED,
    COMPENSATING,
    COMPENSATED,
    FAILED
}

public enum SagaStep {
    INVENTORY_RESERVED,
    PAYMENT_CHARGED,
    SHIPMENT_CREATED,
    CONFIRMATION_SENT
}

public interface SagaStateRepository extends JpaRepository<SagaState, String> {}
```

## Asynchronous Orchestration

For production systems, use asynchronous communication with message queues:

```java
@Component
public class AsyncOrderSagaOrchestrator {

    private final RabbitTemplate rabbitTemplate;
    private final SagaStateRepository sagaStateRepository;

    public AsyncOrderSagaOrchestrator(
            RabbitTemplate rabbitTemplate,
            SagaStateRepository sagaStateRepository) {
        this.rabbitTemplate = rabbitTemplate;
        this.sagaStateRepository = sagaStateRepository;
    }

    public void startOrderSaga(CreateOrderCommand command) {
        SagaState saga = new SagaState(
            command.orderId(),
            SagaStatus.STARTED,
            Instant.now()
        );
        sagaStateRepository.save(saga);
        rabbitTemplate.convertAndSend("saga.exchange", "inventory.reserve", command);
    }

    @RabbitListener(queues = "saga.inventory.response")
    public void onInventoryResponse(InventoryResponse response) {
        if (response.isSuccess()) {
            SagaState saga = sagaStateRepository.findById(response.orderId()).orElseThrow();
            saga.addCompletedStep(SagaStep.INVENTORY_RESERVED);
            sagaStateRepository.save(saga);
            rabbitTemplate.convertAndSend("saga.exchange", "payment.charge",
                new PaymentCommand(response.orderId(), response.customerId(), response.amount()));
        } else {
            failSaga(response.orderId(), "Inventory reservation failed: " + response.reason());
        }
    }

    @RabbitListener(queues = "saga.payment.response")
    public void onPaymentResponse(PaymentResponse response) {
        if (response.isSuccess()) {
            SagaState saga = sagaStateRepository.findById(response.orderId()).orElseThrow();
            saga.addCompletedStep(SagaStep.PAYMENT_CHARGED);
            sagaStateRepository.save(saga);
            rabbitTemplate.convertAndSend("saga.exchange", "shipping.create",
                new ShippingCommand(response.orderId(), response.address()));
        } else {
            compensateSaga(response.orderId(), SagaStep.PAYMENT_CHARGED);
        }
    }

    private void failSaga(String orderId, String reason) {
        SagaState saga = sagaStateRepository.findById(orderId).orElseThrow();
        saga.setStatus(SagaStatus.FAILED);
        sagaStateRepository.save(saga);
        log.error("Saga failed for order {}: {}", orderId, reason);
    }

    private void compensateSaga(String orderId, SagaStep failedStep) {
        SagaState saga = sagaStateRepository.findById(orderId).orElseThrow();
        saga.setStatus(SagaStatus.COMPENSATING);
        sagaStateRepository.save(saga);
        rabbitTemplate.convertAndSend("saga.exchange", "saga.compensate",
            new CompensateCommand(orderId, failedStep));
    }
}
```

## Idempotency in Saga Steps

Each step must be idempotent to handle retries safely:

```java
@Component
public class InventoryServiceSagaParticipant {

    private final InventoryRepository inventoryRepository;

    @RabbitListener(queues = "saga.inventory.reserve")
    @Transactional
    public void handleReserve(ReserveInventoryCommand command) {
        if (inventoryRepository.existsByOrderId(command.orderId())) {
            log.info("Inventory already reserved for order: {}", command.orderId());
            rabbitTemplate.convertAndSend("saga.exchange", "inventory.response",
                InventoryResponse.success(command.orderId()));
            return;
        }

        Inventory inventory = inventoryRepository.findByProductId(command.productId())
            .orElseThrow(() -> new ProductNotFoundException(command.productId()));

        if (inventory.getAvailableQuantity() < command.quantity()) {
            rabbitTemplate.convertAndSend("saga.exchange", "inventory.response",
                InventoryResponse.failure(command.orderId(), "Insufficient stock"));
            return;
        }

        inventory.reserve(command.orderId(), command.quantity());
        inventoryRepository.save(inventory);

        rabbitTemplate.convertAndSend("saga.exchange", "inventory.response",
            InventoryResponse.success(command.orderId()));
    }

    @RabbitListener(queues = "saga.inventory.release")
    @Transactional
    public void handleRelease(ReleaseInventoryCommand command) {
        if (!inventoryRepository.existsByOrderId(command.orderId())) {
            log.info("No reservation found for order: {}", command.orderId());
            return;
        }

        List<Inventory> inventories = inventoryRepository
            .findByReservedOrderId(command.orderId());
        for (Inventory inv : inventories) {
            inv.release(command.orderId());
            inventoryRepository.save(inv);
        }
    }
}
```

## Testing Sagas

```java
@SpringBootTest
class OrderSagaOrchestratorTest {

    @MockBean
    private InventoryServiceClient inventoryClient;
    @MockBean
    private PaymentServiceClient paymentClient;
    @MockBean
    private ShippingServiceClient shippingClient;
    @Autowired
    private OrderSagaOrchestrator orchestrator;

    @Test
    void shouldCompleteSagaSuccessfully() {
        CreateOrderCommand cmd = new CreateOrderCommand(
            "order-1", "customer-1", "prod-1", 2,
            new BigDecimal("100.00"), "customer@test.com",
            "123 Main St");

        when(inventoryClient.reserve(any(), anyInt())).thenReturn(InventoryResponse.success());
        when(paymentClient.charge(any(), any())).thenReturn(PaymentResponse.success());
        when(shippingClient.createShipment(any(), any(), any())).thenReturn(ShipmentResponse.success());

        orchestrator.startOrderSaga(cmd);

        SagaState state = sagaStateRepository.findById("order-1").orElseThrow();
        assertThat(state.getStatus()).isEqualTo(SagaStatus.COMPLETED);
        assertThat(state.getCompletedSteps()).contains(
            SagaStep.INVENTORY_RESERVED,
            SagaStep.PAYMENT_CHARGED,
            SagaStep.SHIPMENT_CREATED,
            SagaStep.CONFIRMATION_SENT
        );
    }

    @Test
    void shouldCompensateWhenPaymentFails() {
        CreateOrderCommand cmd = new CreateOrderCommand(
            "order-2", "customer-1", "prod-1", 2,
            new BigDecimal("100.00"), "customer@test.com",
            "123 Main St");

        when(inventoryClient.reserve(any(), anyInt())).thenReturn(InventoryResponse.success());
        when(paymentClient.charge(any(), any()))
            .thenThrow(new PaymentException("Insufficient funds"));

        orchestrator.startOrderSaga(cmd);

        SagaState state = sagaStateRepository.findById("order-2").orElseThrow();
        assertThat(state.getStatus()).isEqualTo(SagaStatus.COMPENSATED);
        verify(inventoryClient).release("order-2");
        verify(paymentClient, never()).refund(any());
    }
}
```

## Common Mistakes

### Missing Idempotency

```java
// Wrong: No idempotency check, retry causes duplicate operations
@RabbitListener(queues = "payment.charge")
public void charge(PaymentCommand cmd) {
    paymentGateway.charge(cmd.amount(), cmd.currency());
}
```

```java
// Correct: Idempotency key prevents duplicate processing
@RabbitListener(queues = "payment.charge")
public void charge(PaymentCommand cmd) {
    if (paymentRepository.existsByTransactionId(cmd.transactionId())) {
        log.info("Payment already processed: {}", cmd.transactionId());
        return;
    }
    PaymentResult result = paymentGateway.charge(cmd.amount(), cmd.currency());
    paymentRepository.save(new Payment(cmd.transactionId(), result.status()));
}
```

### Ignoring Partial Failures

```java
// Wrong: Single catch block loses step context
try {
    reserveInventory();
    processPayment();
    createShipment();
} catch (Exception e) {
    // Unknown which step failed, cannot compensate correctly
    compensateAll();
}
```

## Best Practices

1. Use a dedicated saga orchestrator service for complex workflows.
2. Persist saga state for recovery and observability.
3. Make every step idempotent to handle retries safely.
4. Use asynchronous communication for long-running sagas.
5. Implement timeouts and heartbeat monitoring for stalled sagas.
6. Log all saga state transitions for debugging and auditing.
7. Keep compensating actions idempotent as well.

## Summary

Orchestration-based sagas provide a reliable pattern for distributed transactions across microservices. The orchestrator coordinates each step, tracks state, and invokes compensations on failure. Idempotency, persistence, and asynchronous communication are critical for production-grade saga implementations.

## References

- Garcia-Molina, H. & Salem, K. "SAGAS"
- "Building Microservices" by Sam Newman
- "Microservices Patterns" by Chris Richardson

Happy Coding