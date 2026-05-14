---
title: "Temporal Workflow Basics"
description: "Introduction to Temporal workflow engine: workflows, activities, retries, and durable execution for distributed systems"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["temporal", "workflows", "distributed-systems", "durable-execution"]
coverImage: "/images/temporal-workflow-basics.png"
draft: false
---

## Overview

Temporal is a durable execution platform that lets developers write workflows as regular code while the platform handles reliability, retries, and state persistence. Unlike traditional message queues or schedulers, Temporal preserves the complete execution state of your workflow, allowing it to survive server restarts, network failures, and process crashes.

The core abstractions are Workflows (orchestration logic) and Activities (individual steps). Temporal automatically retries activities on failure and replays workflow code to reconstruct state.

## Core Concepts

### Workflow

A workflow defines the orchestration logic. It is deterministic code that coordinates activities.

### Activity

An activity performs a single, side-effecting operation like calling an API, querying a database, or sending an email.

### Worker

A worker hosts and executes workflow and activity implementations.

### Temporal Server

The server persists workflow state and coordinates task distribution to workers.

## Setting Up Temporal

### Dependencies

```xml
<dependency>
    <groupId>io.temporal</groupId>
    <artifactId>temporal-sdk</artifactId>
    <version>1.22.0</version>
</dependency>
```

### Worker Configuration

The worker is the bridge between your code and the Temporal server. `WorkflowClient` establishes a gRPC connection to the Temporal server. `WorkerFactory` manages one or more workers — each worker polls a specific task queue and executes any workflow type or activity implementation registered with it. The `"order-task-queue"` name must match the task queue name that workflow starters use when calling the workflow. A single worker process can host multiple workers on different task queues, but it is common to have one worker per queue for operational clarity.

```java
@Configuration
public class TemporalConfiguration {

    @Bean
    public WorkflowClient workflowClient() {
        WorkflowClientOptions options = WorkflowClientOptions.newBuilder()
            .setNamespace("default")
            .build();
        return WorkflowClient.newInstance(
            WorkflowServiceStubs.newInstance(), options);
    }

    @Bean
    public WorkerFactory workerFactory(WorkflowClient client,
                                       List<WorkflowImplementation> workflows,
                                       List<ActivitiesImplementation> activities) {
        WorkerFactory factory = WorkerFactory.newInstance(client);

        Worker worker = factory.newWorker("order-task-queue");
        workflows.forEach(w -> worker.registerWorkflowImplementationTypes(w.getClass()));
        activities.forEach(a -> worker.registerActivitiesImplementations(a));

        factory.start();
        return factory;
    }
}
```

## Defining a Workflow

### Order Processing Workflow

This workflow implements the saga pattern with Temporal's constructs. Activities are defined as a Java interface and implemented separately — Temporal uses the interface to generate proxies that handle retries, timeouts, and state persistence automatically. Two activity stubs are created with different `ActivityOptions`: standard order activities have a 10-second timeout with exponential backoff (5 retries max), while payment activities have a 30-second timeout and only 3 retries, reflecting the higher latency and lower tolerance for duplicate payment attempts. Compensation logic is explicit: if payment fails, inventory is released; if shipment fails, both payment and inventory are rolled back. Temporal ensures that activity executions and compensations survive worker crashes.

```java
// Workflow interface
public interface OrderWorkflow {
    OrderResult processOrder(OrderInput input);
}

// Workflow implementation
public class OrderWorkflowImpl implements OrderWorkflow {

    private final OrderActivities activities = Workflow.newActivityStub(
        OrderActivities.class,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(10))
            .setRetryOptions(RetryOptions.newBuilder()
                .setInitialInterval(Duration.ofSeconds(1))
                .setMaximumInterval(Duration.ofSeconds(60))
                .setBackoffCoefficient(2)
                .setMaximumAttempts(5)
                .build())
            .build());

    private final PaymentActivities paymentActivities = Workflow.newActivityStub(
        PaymentActivities.class,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(30))
            .setRetryOptions(RetryOptions.newBuilder()
                .setMaximumAttempts(3)
                .build())
            .build());

    @Override
    public OrderResult processOrder(OrderInput input) {
        log.info("Processing order: {}", input.getOrderId());

        // Step 1: Validate order
        ValidationResult validation = activities.validateOrder(input);
        if (!validation.isValid()) {
            return OrderResult.failure(input.getOrderId(), validation.getError());
        }

        // Step 2: Reserve inventory
        InventoryResult inventory = activities.reserveInventory(input);
        if (!inventory.isAvailable()) {
            return OrderResult.failure(input.getOrderId(), "Inventory unavailable");
        }

        // Step 3: Process payment
        PaymentResult payment = paymentActivities.processPayment(
            input.getCustomerId(), input.getTotalAmount());
        if (!payment.isSuccess()) {
            // Compensate: release inventory
            activities.releaseInventory(input.getOrderId());
            return OrderResult.failure(input.getOrderId(), "Payment failed");
        }

        // Step 4: Create shipment
        ShipmentResult shipment = activities.createShipment(input);
        if (!shipment.isSuccess()) {
            // Compensate: refund and release
            paymentActivities.refundPayment(payment.getTransactionId());
            activities.releaseInventory(input.getOrderId());
            return OrderResult.failure(input.getOrderId(), "Shipment creation failed");
        }

        // Step 5: Send confirmation
        activities.sendConfirmation(input.getCustomerEmail(), input.getOrderId());

        return OrderResult.success(input.getOrderId(), shipment.getTrackingNumber());
    }
}
```

## Defining Activities

```java
// Activity interface
public interface OrderActivities {
    ValidationResult validateOrder(OrderInput input);
    InventoryResult reserveInventory(OrderInput input);
    void releaseInventory(String orderId);
    ShipmentResult createShipment(OrderInput input);
    void sendConfirmation(String email, String orderId);
}

// Activity implementation
public class OrderActivitiesImpl implements OrderActivities {

    private final OrderRepository orderRepository;
    private final InventoryClient inventoryClient;
    private final ShippingClient shippingClient;
    private final EmailService emailService;

    public OrderActivitiesImpl(
            OrderRepository orderRepository,
            InventoryClient inventoryClient,
            ShippingClient shippingClient,
            EmailService emailService) {
        this.orderRepository = orderRepository;
        this.inventoryClient = inventoryClient;
        this.shippingClient = shippingClient;
        this.emailService = emailService;
    }

    @Override
    public ValidationResult validateOrder(OrderInput input) {
        log.info("Validating order: {}", input.getOrderId());

        if (input.getItems() == null || input.getItems().isEmpty()) {
            return ValidationResult.invalid("Order must have at least one item");
        }

        boolean customerExists = orderRepository.existsByCustomerId(input.getCustomerId());
        if (!customerExists) {
            return ValidationResult.invalid("Customer not found: " + input.getCustomerId());
        }

        return ValidationResult.valid();
    }

    @Override
    public InventoryResult reserveInventory(OrderInput input) {
        log.info("Reserving inventory for order: {}", input.getOrderId());
        try {
            InventoryResponse response = inventoryClient.reserve(
                input.getOrderId(), input.getItems());
            return InventoryResult.available(response.getReservationId());
        } catch (InventoryException e) {
            return InventoryResult.unavailable(e.getMessage());
        }
    }

    @Override
    public void releaseInventory(String orderId) {
        log.info("Releasing inventory for order: {}", orderId);
        inventoryClient.release(orderId);
    }

    @Override
    public ShipmentResult createShipment(OrderInput input) {
        log.info("Creating shipment for order: {}", input.getOrderId());
        ShipmentResponse response = shippingClient.createShipment(
            input.getOrderId(), input.getAddress(), input.getItems());
        return ShipmentResult.success(response.getTrackingNumber());
    }

    @Override
    public void sendConfirmation(String email, String orderId) {
        log.info("Sending confirmation for order: {} to {}", orderId, email);
        emailService.sendOrderConfirmation(email, orderId);
    }
}

// Payment activities
public interface PaymentActivities {
    PaymentResult processPayment(String customerId, Money amount);
    void refundPayment(String transactionId);
}

public class PaymentActivitiesImpl implements PaymentActivities {

    private final PaymentGateway paymentGateway;

    public PaymentActivitiesImpl(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }

    @Override
    public PaymentResult processPayment(String customerId, Money amount) {
        log.info("Processing payment for customer: {} amount: {}", customerId, amount);
        try {
            Transaction transaction = paymentGateway.charge(customerId, amount);
            return PaymentResult.success(transaction.getId());
        } catch (PaymentException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public void refundPayment(String transactionId) {
        log.info("Refunding payment: {}", transactionId);
        paymentGateway.refund(transactionId);
    }
}
```

## Workflow with Timers and Delays

Temporal's `Workflow.sleep()` is not a thread sleep — it is a durable timer. When the workflow calls `Workflow.sleep(Duration.ofDays(14))`, the Temporal server records the timer and the workflow execution pauses. If the worker crashes during those 14 days, the workflow is reconstructed from the event history when a new worker picks it up, and the timer continues counting from where it left off. This makes Temporal ideal for long-running business processes with waits: trial periods, billing cycles, reminder escalations. The monthly billing loop below shows a real-world pattern — a 12-month subscription with automatic retry and a single reminder before suspension. In a traditional cron-based approach, you would need to persist the month counter and handle failures across ticks; Temporal preserves the loop state natively.

```java
public interface SubscriptionWorkflow {
    void manageSubscription(SubscriptionInput input);
}

public class SubscriptionWorkflowImpl implements SubscriptionWorkflow {

    private final SubscriptionActivities activities = Workflow.newActivityStub(
        SubscriptionActivities.class,
        ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(5))
            .build());

    @Override
    public void manageSubscription(SubscriptionInput input) {
        // Start trial period
        activities.startTrial(input.getUserId(), input.getPlan());

        // Wait for trial period
        Workflow.sleep(Duration.ofDays(14));

        // Check if user converted
        boolean converted = activities.checkTrialConversion(input.getUserId());

        if (converted) {
            // Start paid subscription
            activities.startPaidSubscription(input.getUserId(), input.getPlan());

            // Monthly billing loop
            for (int month = 1; month <= 12; month++) {
                Workflow.sleep(Duration.ofDays(30));

                try {
                    activities.chargeMonthly(input.getUserId(), input.getPlan().getPrice());
                } catch (PaymentFailedException e) {
                    activities.sendPaymentReminder(input.getUserId());
                    Workflow.sleep(Duration.ofDays(7));

                    try {
                        activities.chargeMonthly(input.getUserId(), input.getPlan().getPrice());
                    } catch (PaymentFailedException e2) {
                        activities.suspendSubscription(input.getUserId());
                        break;
                    }
                }
            }
        } else {
            activities.sendFollowUpEmail(input.getUserId());
        }
    }
}
```

## Workflow Signals and Queries

Signals and queries are Temporal's mechanism for interacting with running workflows. A `@SignalMethod` can be called from outside the workflow (e.g., from an HTTP handler) to mutate workflow state — `cancelOrder` sets a flag that the workflow checks at safe points, and `updateShippingAddress` changes the address used for a pending shipment. Signals are durably recorded in the workflow event history, so even if the workflow is mid-execution on a different worker, the signal is replayed when the workflow recovers. `@QueryMethod` is synchronous and side-effect-free — it returns the current workflow state without advancing the workflow. The `isCancelled()` checks between steps implement cooperative cancellation: the workflow completes the current activity before honouring the cancellation at the next safe point.

```java
public interface OrderWorkflow {
    @WorkflowMethod
    OrderResult processOrder(OrderInput input);

    @SignalMethod
    void cancelOrder(String reason);

    @SignalMethod
    void updateShippingAddress(Address newAddress);

    @QueryMethod
    OrderStatus getOrderStatus();

    @QueryMethod
    List<OrderEvent> getOrderHistory();
}

public class OrderWorkflowImpl implements OrderWorkflow {

    private OrderStatus status;
    private String cancellationReason;
    private Address shippingAddress;
    private final List<OrderEvent> eventHistory = new ArrayList<>();

    @Override
    public OrderResult processOrder(OrderInput input) {
        this.shippingAddress = input.getAddress();
        this.status = OrderStatus.PENDING;

        // Step 1: Validate order
        ValidationResult validation = activities.validateOrder(input);
        if (!validation.isValid()) {
            return OrderResult.failure(input.getOrderId(), validation.getError());
        }
        eventHistory.add(new OrderEvent("VALIDATED", Instant.now()));
        this.status = OrderStatus.VALIDATED;

        // Check for cancellation signal
        if (isCancelled()) {
            return OrderResult.cancelled(input.getOrderId(), cancellationReason);
        }

        // Step 2: Reserve inventory
        InventoryResult inventory = activities.reserveInventory(input);
        if (!inventory.isAvailable()) {
            return OrderResult.failure(input.getOrderId(), "Inventory unavailable");
        }
        eventHistory.add(new OrderEvent("INVENTORY_RESERVED", Instant.now()));
        this.status = OrderStatus.INVENTORY_RESERVED;

        if (isCancelled()) {
            activities.releaseInventory(input.getOrderId());
            return OrderResult.cancelled(input.getOrderId(), cancellationReason);
        }

        // Process payment with updated address
        PaymentResult payment = paymentActivities.processPayment(
            input.getCustomerId(), input.getTotalAmount());
        if (!payment.isSuccess()) {
            activities.releaseInventory(input.getOrderId());
            return OrderResult.failure(input.getOrderId(), "Payment failed");
        }
        eventHistory.add(new OrderEvent("PAYMENT_COMPLETED", Instant.now()));
        this.status = OrderStatus.PAYMENT_COMPLETED;

        // Rest of order processing...
        return OrderResult.success(input.getOrderId(), "TRACK123");
    }

    @Override
    public void cancelOrder(String reason) {
        this.cancellationReason = reason;
        eventHistory.add(new OrderEvent("CANCEL_REQUESTED", Instant.now()));
    }

    @Override
    public void updateShippingAddress(Address newAddress) {
        this.shippingAddress = newAddress;
        eventHistory.add(new OrderEvent("ADDRESS_UPDATED", Instant.now()));
    }

    @Override
    public OrderStatus getOrderStatus() {
        return this.status;
    }

    @Override
    public List<OrderEvent> getOrderHistory() {
        return List.copyOf(eventHistory);
    }

    private boolean isCancelled() {
        return cancellationReason != null;
    }
}
```

## Workflow with Child Workflows

Child workflows enable fan-out parallelism — each item in an order gets its own workflow instance that runs independently and can be distributed across different workers. The `Async.function` call starts the child workflow asynchronously and returns a `Promise`, allowing the parent to launch many children concurrently. `Promise.allOf().get()` blocks until all children complete, collecting results. The `ParentClosePolicy.ABANDON` setting means the child continues running even if the parent completes — useful for long-running fulfilment that outlives the order validation workflow. Each child gets a unique workflow ID combining the order ID and product ID, ensuring idempotent start: if the parent crashes and replays, the child workflow is not duplicated.

```java
public interface OrderFulfillmentWorkflow {
    FulfillmentResult fulfillOrder(String orderId, List<OrderItem> items);
}

public class OrderFulfillmentWorkflowImpl implements OrderFulfillmentWorkflow {

    @Override
    public FulfillmentResult fulfillOrder(String orderId, List<OrderItem> items) {
        List<Promise<FulfillmentResult>> fulfillmentPromises = new ArrayList<>();

        // Fan-out to per-item fulfillment workflows
        for (OrderItem item : items) {
            ItemFulfillmentWorkflow child = Workflow.newChildWorkflowStub(
                ItemFulfillmentWorkflow.class,
                ChildWorkflowOptions.newBuilder()
                    .setWorkflowId("fulfill-" + orderId + "-" + item.getProductId())
                    .setParentClosePolicy(ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON)
                    .build());

            Promise<FulfillmentResult> result = Async.function(
                child::fulfillItem, orderId, item);
            fulfillmentPromises.add(result);
        }

        // Wait for all items to be fulfilled
        Promise.allOf(fulfillmentPromises).get();

        boolean allSucceeded = fulfillmentPromises.stream()
            .map(Promise::get)
            .allMatch(FulfillmentResult::isSuccess);

        return allSucceeded
            ? FulfillmentResult.success(orderId)
            : FulfillmentResult.partialSuccess(orderId,
                fulfillmentPromises.stream()
                    .map(Promise::get)
                    .filter(r -> !r.isSuccess())
                    .toList());
    }
}

public interface ItemFulfillmentWorkflow {
    FulfillmentResult fulfillItem(String orderId, OrderItem item);
}

public class ItemFulfillmentWorkflowImpl implements ItemFulfillmentWorkflow {

    private final InventoryActivities inventoryActivities = Workflow.newActivityStub(
        InventoryActivities.class);

    @Override
    public FulfillmentResult fulfillItem(String orderId, OrderItem item) {
        try {
            inventoryActivities.pickItem(item.getProductId(), item.getQuantity());
            inventoryActivities.packItem(item.getProductId());
            return FulfillmentResult.success(orderId);
        } catch (Exception e) {
            return FulfillmentResult.failure(orderId, item.getProductId(), e.getMessage());
        }
    }
}
```

## Common Mistakes

### Non-Deterministic Workflow Code

```java
// Wrong: Non-deterministic code in workflow
public class BadWorkflow implements MyWorkflow {
    @Override
    public String process(String input) {
        // Using current time directly is non-deterministic
        Instant now = Instant.now();
        // Random numbers are non-deterministic
        double random = Math.random();
        // Thread sleep is non-deterministic
        Thread.sleep(1000);
        return processWithTime(input, now, random);
    }
}
```

```java
// Correct: Use Temporal APIs for time and randomness
public class GoodWorkflow implements MyWorkflow {
    @Override
    public String process(String input) {
        Instant now = Workflow.currentTimeMillis();
        // Use Workflow.newRandom() for randomness
        // Use Workflow.sleep() for delays
        Workflow.sleep(Duration.ofSeconds(1));
        return processWithTime(input, now);
    }
}
```

### Long-Running Activities

```java
// Wrong: Activity should not run for hours
public class BadActivities {
    @ActivityMethod
    public void processLargeDataset() {
        // Could run for hours, better as a workflow
    }
}
```

```java
// Correct: Use heartbeats for long activities
public class GoodActivities {
    @ActivityMethod
    public void processLargeDataset(ActivityContext context) {
        for (Batch batch : dataset.getBatches()) {
            processBatch(batch);
            context.heartbeat(batch.getId());
        }
    }
}
```

## Best Practices

1. Keep workflows deterministic: use Temporal APIs for time, randomness, and async operations.
2. Make activities idempotent for safe retries.
3. Use heartbeats for long-running activities to detect worker crashes.
4. Design workflows to handle signal and query methods for interaction.
5. Use child workflows for fan-out patterns and independent sub-processes.
6. Set appropriate retry options based on the type of activity.
7. Version workflows when making breaking changes.
8. Monitor workflow execution history for debugging.

## Summary

Temporal provides a powerful platform for building reliable distributed applications. Workflows are written as regular code with durable execution guarantees, while activities handle side effects with automatic retries. The platform handles state persistence, timeout, retry, and recovery, freeing developers from implementing these concerns manually.

## References

- Temporal Documentation: "Workflow Development Guide"
- "Temporal: Building Durable Applications" by Maxim Fateev
- Temporal Java SDK Documentation

Happy Coding