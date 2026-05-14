---
title: "Observer Pattern in Event Systems"
description: "Applying Observer pattern for event-driven systems: Spring events, message brokers, and reactive streams"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["observer-pattern", "event-driven", "spring-events", "design-patterns"]
coverImage: "/images/observer-pattern-event-systems.png"
draft: false
---

## Overview

The Observer pattern defines a one-to-many dependency between objects so that when one object changes state, all its dependents are notified automatically. In backend systems, this pattern is the foundation of event-driven architectures, Spring Application Events, message brokers, and reactive programming.

Modern backend implementations extend the classic Observer pattern with asynchronous delivery, message brokers, and event sourcing to build scalable, decoupled systems.

## Classic Observer Pattern

```java
// Subject
public interface EventPublisher {
    void subscribe(EventListener listener);
    void unsubscribe(EventListener listener);
    void notifyAll(String eventType, EventData data);
}

// Observer
public interface EventListener {
    void onEvent(String eventType, EventData data);
    boolean supports(String eventType);
}

public class SimpleEventBus implements EventPublisher {
    private final List<EventListener> listeners = new CopyOnWriteArrayList<>();

    @Override
    public void subscribe(EventListener listener) {
        listeners.add(listener);
    }

    @Override
    public void unsubscribe(EventListener listener) {
        listeners.remove(listener);
    }

    @Override
    public void notifyAll(String eventType, EventData data) {
        listeners.stream()
            .filter(l -> l.supports(eventType))
            .forEach(l -> l.onEvent(eventType, data));
    }
}

public class AuditListener implements EventListener {
    private final AuditLogRepository auditLogRepository;

    public AuditListener(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    @Override
    public void onEvent(String eventType, EventData data) {
        AuditLog log = new AuditLog(
            UUID.randomUUID().toString(),
            eventType,
            data.payload(),
            data.occurredAt(),
            data.userId()
        );
        auditLogRepository.save(log);
    }

    @Override
    public boolean supports(String eventType) {
        return eventType.startsWith("ORDER_") || eventType.startsWith("PAYMENT_");
    }
}
```

The classic observer pattern uses `CopyOnWriteArrayList` for thread-safe listener registration. `AuditListener` filters for order and payment events, logging every state change. This synchronous in-process approach works well within a single JVM, but the publisher blocks until all listeners complete — if one listener is slow, all others wait.

## Spring Application Events

Spring provides a built-in observer implementation through ApplicationEvent and ApplicationListener:

```java
// Event class
public class OrderCreatedEvent extends ApplicationEvent {
    private final String orderId;
    private final String customerId;
    private final BigDecimal totalAmount;
    private final List<OrderItem> items;

    public OrderCreatedEvent(Object source, String orderId, String customerId,
                             BigDecimal totalAmount, List<OrderItem> items) {
        super(source);
        this.orderId = orderId;
        this.customerId = customerId;
        this.totalAmount = totalAmount;
        this.items = items;
    }

    public String getOrderId() { return orderId; }
    public String getCustomerId() { return customerId; }
    public BigDecimal getTotalAmount() { return totalAmount; }
    public List<OrderItem> getItems() { return items; }
}

// Synchronous listener
@Component
public class InventoryReservationListener implements ApplicationListener<OrderCreatedEvent> {

    private final InventoryService inventoryService;

    public InventoryReservationListener(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Override
    @Transactional
    public void onApplicationEvent(OrderCreatedEvent event) {
        event.getItems().forEach(item ->
            inventoryService.reserve(item.getProductId(), item.getQuantity()));
    }
}

// Async listener using @EventListener
@Component
public class EmailNotificationListener {

    private final EmailService emailService;

    public EmailNotificationListener(EmailService emailService) {
        this.emailService = emailService;
    }

    @EventListener
    @Async
    public void handleOrderCreated(OrderCreatedEvent event) {
        emailService.sendOrderConfirmation(
            event.getCustomerId(),
            event.getOrderId(),
            event.getTotalAmount()
        );
    }
}

// Conditional listener
@Component
public class HighValueOrderListener {

    private final FraudDetectionService fraudDetectionService;

    public HighValueOrderListener(FraudDetectionService fraudDetectionService) {
        this.fraudDetectionService = fraudDetectionService;
    }

    @EventListener
    @Async
    public void handleHighValueOrder(OrderCreatedEvent event) {
        if (event.getTotalAmount().compareTo(new BigDecimal("10000")) > 0) {
            fraudDetectionService.flagForReview(event.getOrderId(), event.getCustomerId());
        }
    }
}
```

Spring's `@EventListener` annotation eliminates the need to implement `ApplicationListener`. Methods annotated with `@EventListener` are automatically discovered and registered. Adding `@Async` makes the listener execute on a separate thread, so the publisher doesn't block. The `HighValueOrderListener` uses conditional logic inside the handler to only process orders above $10,000 — this is cleaner than filtering in the publisher.

### Order Listener with Priority

```java
@Component
@Order(1)
public class OrderValidationListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Validate first, before other listeners
        if (event.getItems().isEmpty()) {
            throw new IllegalArgumentException("Order must have at least one item");
        }
    }
}

@Component
@Order(2)
public class OrderProcessingListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Process after validation
        orderProcessor.enqueue(event.getOrderId());
    }
}

@Component
@Order(3)
public class OrderNotificationListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Notify last, after processing
        notificationService.sendOrderConfirmation(event.getOrderId());
    }
}
```

The `@Order` annotation controls listener execution order. Validation runs first to fail fast. Processing runs second. Notification runs last — there is no point notifying the customer if validation or processing failed. With `@Async` on the later listeners, validation can remain synchronous while notification becomes asynchronous.

## Event-Driven with Message Broker

Extending the observer pattern across service boundaries:

```java
// Event publisher publishing to RabbitMQ
@Component
public class RabbitMQEventPublisher {

    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;

    public RabbitMQEventPublisher(RabbitTemplate rabbitTemplate, ObjectMapper objectMapper) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
    }

    public void publish(DomainEvent event) {
        try {
            String exchange = event.getExchange();
            String routingKey = event.getRoutingKey();
            String json = objectMapper.writeValueAsString(event);

            rabbitTemplate.convertAndSend(exchange, routingKey, json,
                message -> {
                    message.getMessageProperties().setMessageId(event.getEventId());
                    message.getMessageProperties().setTimestamp(
                        Date.from(event.getOccurredAt()));
                    message.getMessageProperties().setType(
                        event.getClass().getSimpleName());
                    return message;
                });

            log.info("Published event: {} to {}:{}",
                event.getEventId(), exchange, routingKey);
        } catch (JsonProcessingException e) {
            throw new EventPublishException("Failed to serialize event", e);
        }
    }
}

// Event consumer subscribing to RabbitMQ
@Component
public class RabbitMQEventConsumer {

    private final List<DomainEventHandler> handlers;

    public RabbitMQEventConsumer(List<DomainEventHandler> handlers) {
        this.handlers = handlers;
    }

    @RabbitListener(queues = "order.events.queue")
    public void handleOrderEvent(String message, Channel channel,
                                 @Header("amqp_messageId") String messageId,
                                 @Header("amqp_type") String eventType) {
        try {
            DomainEventHandler handler = handlers.stream()
                .filter(h -> h.canHandle(eventType))
                .findFirst()
                .orElseThrow(() -> new UnhandledEventException(eventType));

            handler.handle(message, messageId);
            channel.basicAck(message.getDeliveryTag(), false);
        } catch (Exception e) {
            log.error("Failed to handle event: {}", messageId, e);
            channel.basicNack(message.getDeliveryTag(), false, true);
        }
    }
}
```

Message brokers extend the observer pattern across service boundaries. The publisher serializes domain events to JSON and publishes them to a RabbitMQ exchange with a routing key. The consumer listens on a queue, deserializes events, and dispatches to registered handlers. Message headers carry metadata (event type, timestamp, message ID) for routing and deduplication. On failure, `basicNack` with `requeue=true` tells RabbitMQ to redeliver the message.

## Reactive Observer with Project Reactor

```java
@Component
public class ReactiveEventBus {

    private final Sinks.Many<DomainEvent> eventSink;
    private final Flux<DomainEvent> eventFlux;

    public ReactiveEventBus() {
        this.eventSink = Sinks.many().multicast().onBackpressureBuffer();
        this.eventFlux = eventSink.asFlux().share();
    }

    public void publish(DomainEvent event) {
        Sinks.EmitResult result = eventSink.tryEmitNext(event);
        if (result != Sinks.EmitResult.OK) {
            log.warn("Failed to emit event: {}", result);
        }
    }

    public Flux<DomainEvent> events() {
        return eventFlux;
    }

    public <T extends DomainEvent> Flux<T> eventsOfType(Class<T> eventType) {
        return eventFlux
            .filter(eventType::isInstance)
            .map(eventType::cast);
    }
}

@Component
public class OrderEventProcessor {

    private final ReactiveEventBus eventBus;
    private final InventoryService inventoryService;
    private final EmailService emailService;

    public OrderEventProcessor(
            ReactiveEventBus eventBus,
            InventoryService inventoryService,
            EmailService emailService) {
        this.eventBus = eventBus;
        this.inventoryService = inventoryService;
        this.emailService = emailService;
    }

    @PostConstruct
    public void startProcessing() {
        eventBus.eventsOfType(OrderCreatedEvent.class)
            .flatMap(this::processOrder)
            .onErrorContinue((error, event) ->
                log.error("Error processing order: {}", event, error))
            .subscribe();
    }

    private Mono<Void> processOrder(OrderCreatedEvent event) {
        return Mono.fromRunnable(() ->
            inventoryService.reserveItems(event.getItems()))
            .then(Mono.fromRunnable(() ->
                emailService.sendConfirmation(event.getCustomerId(), event.getOrderId())));
    }
}
```

The reactive observer uses Project Reactor's `Sinks.Many` as an event bus. `flatMap` enables concurrent processing of multiple orders with backpressure handling. The `onErrorContinue` operator ensures one failed order doesn't crash the entire stream — the error is logged and processing continues with the next event.

## Custom Event Bus with Domain Events

```java
public abstract class DomainEvent {
    private final String eventId;
    private final Instant occurredAt;

    protected DomainEvent() {
        this.eventId = UUID.randomUUID().toString();
        this.occurredAt = Instant.now();
    }

    public String getEventId() { return eventId; }
    public Instant getOccurredAt() { return occurredAt; }
    public abstract String getExchange();
    public abstract String getRoutingKey();
}

public class OrderPlacedEvent extends DomainEvent {
    private final Order order;

    public OrderPlacedEvent(Order order) {
        this.order = order;
    }

    public Order getOrder() { return order; }

    @Override
    public String getExchange() { return "order.exchange"; }

    @Override
    public String getRoutingKey() { return "order.placed"; }
}

public class PaymentCompletedEvent extends DomainEvent {
    private final String orderId;
    private final String transactionId;
    private final Money amount;

    public PaymentCompletedEvent(String orderId, String transactionId, Money amount) {
        this.orderId = orderId;
        this.transactionId = transactionId;
        this.amount = amount;
    }

    @Override
    public String getExchange() { return "payment.exchange"; }

    @Override
    public String getRoutingKey() { return "payment.completed"; }
}
```

Domain events carry only data relevant to the business event. The abstract `DomainEvent` base class handles common concerns: unique event ID (for deduplication), timestamp (for ordering), and exchange/routing key (for message broker routing). Concrete events add domain-specific data.

## Testing Observer Pattern

```java
@SpringBootTest
class OrderEventListenerTest {

    @MockBean
    private InventoryService inventoryService;
    @MockBean
    private EmailService emailService;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @Test
    void shouldNotifyAllListenersOnOrderCreated() {
        OrderCreatedEvent event = new OrderCreatedEvent(
            this, "order-1", "customer-1",
            new BigDecimal("100.00"), List.of(new OrderItem("prod-1", 2)));

        eventPublisher.publishEvent(event);

        verify(inventoryService).reserveItems(event.getItems());
        verify(emailService).sendConfirmation("customer-1", "order-1");
    }

    @Test
    void shouldRollbackTransactionOnListenerFailure() {
        OrderCreatedEvent event = new OrderCreatedEvent(
            this, "order-2", "customer-1",
            new BigDecimal("500.00"), List.of(new OrderItem("prod-1", 3)));

        doThrow(new RuntimeException("Inventory check failed"))
            .when(inventoryService).reserveItems(any());

        assertThatThrownBy(() -> eventPublisher.publishEvent(event))
            .hasRootCauseMessage("Inventory check failed");
    }
}
```

Testing verifies that publishing an event triggers all registered listeners. The second test verifies that when a synchronous listener (inventory check) throws an exception, the transaction rolls back and the email is never sent. This is important for understanding the transactional semantics of Spring events.

## Common Mistakes

### Blocking in Async Listeners

```java
// Wrong: @Async method still blocks the thread pool
@EventListener
@Async
public void handleEvent(OrderCreatedEvent event) {
    Thread.sleep(5000); // Blocks async thread
    processOrder(event);
}
```

```java
// Correct: Use non-blocking or reactive operations
@EventListener
@Async
public CompletableFuture<Void> handleEvent(OrderCreatedEvent event) {
    return CompletableFuture.runAsync(() -> processOrder(event));
}
```

### Forgetting Transaction Boundaries

```java
// Wrong: Listener operates outside transaction boundary
@Component
public class OrderListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // This runs in the same transaction as the publisher by default
        // But if @Async is used, it runs in a new transaction
    }
}
```

```java
// Correct: Explicit transaction management
@Component
public class OrderListener {
    @EventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @Async
    public void handleOrderCreated(OrderCreatedEvent event) {
        // Runs in its own transaction
        processOrder(event);
    }
}
```

## Best Practices

1. Use Spring ApplicationEvents for intra-process event-driven logic.
2. Use message brokers (RabbitMQ, Kafka) for inter-service event propagation.
3. Make event handlers idempotent for reliable message processing.
4. Use asynchronous processing for non-critical observers to avoid impacting the main flow.
5. Keep event objects serializable and backward compatible.
6. Monitor event processing latency and failure rates.
7. Use transactional event listeners to ensure consistency between event publishing and listener execution.

## Summary

The Observer pattern is the foundation of event-driven architecture in backend systems. Spring's Application Events provide a simple mechanism for in-process event handling, while message brokers extend the pattern across service boundaries. Reactive streams offer backpressure-aware event processing for high-throughput scenarios. Choose the approach that matches your coupling and scalability requirements.

## References

- Gamma, E. et al. "Design Patterns: Elements of Reusable Object-Oriented Software"
- Spring Framework Documentation: "Application Events and Listeners"
- "Enterprise Integration Patterns" by Gregor Hohpe
- "Reactive Spring" by Josh Long

Happy Coding
