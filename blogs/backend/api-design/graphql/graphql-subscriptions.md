---
title: "GraphQL Subscriptions"
description: "Implement real-time GraphQL subscriptions: WebSocket transport, subscription resolvers, event-driven patterns, and production scaling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - graphql
  - subscriptions
  - websockets
  - real-time
coverImage: "/images/backend/api-design/graphql/graphql-subscriptions.png"
draft: false
---

# GraphQL Subscriptions

## Overview

GraphQL Subscriptions provide real-time communication between server and clients. Unlike queries and mutations that follow a request-response pattern, subscriptions maintain persistent connections, pushing data to clients when events occur. This enables live updates, notifications, and collaborative features.

---

## Subscription Schema Design

Subscription types define the real-time events that clients can subscribe to. Unlike queries and mutations which follow a request-response pattern, subscriptions maintain a persistent connection and push data to clients as events occur. Each subscription field accepts arguments (for filtering which events the client receives) and returns the event payload. The schema should clearly document what events each subscription delivers and what arguments are available for filtering.

### Defining Subscription Types

Each subscription field represents a different type of real-time event. Notice the argument patterns: some subscriptions filter by entity ID (`orderUpdated(orderId: ID!)`), some return a specific payload type (`orderStatusChanged: OrderStatusPayload!`), and some are general streams (`serverMetrics: MetricsPayload!`). The argument design is crucial — well-designed filter arguments reduce unnecessary data transfer by letting clients subscribe only to relevant events. For example, `orderUpdated(orderId: ID!)` ensures a client only receives updates for the order they care about, not all order updates in the system.

```graphql
type Subscription {
  # Order events
  orderUpdated(orderId: ID!): Order!
  newOrder: Order!
  orderStatusChanged: OrderStatusPayload!

  # Notification events
  notificationReceived(userId: ID!): Notification!

  # System events
  systemHealthChanged: HealthStatus!
  serverMetrics: MetricsPayload!

  # Chat events
  messageReceived(chatId: ID!): Message!
  typingIndicator(chatId: ID!): TypingStatus!
}

type OrderStatusPayload {
  orderId: ID!
  oldStatus: String!
  newStatus: String!
  updatedAt: String!
}

type Notification {
  id: ID!
  type: String!
  title: String!
  body: String!
  read: Boolean!
  createdAt: String!
}
```

Subscription resolvers in Spring GraphQL return `Flux<T>` — a reactive stream of events. Each subscription method is annotated with `@SubscriptionMapping` and returns a Flux that emits items of the declared type. The resolver's responsibility is to create a Flux from an event publisher and apply client-provided filters (like `orderId`) to reduce unnecessary data flow. Spring GraphQL's subscription support is built on WebSocket transport with the GraphQL-over-WebSocket protocol, handling connection lifecycle, serialization, and backpressure automatically.

### Spring GraphQL Subscription Implementation

```java
@Controller
public class OrderSubscriptionController {

    private final OrderEventPublisher eventPublisher;
    private final FluxSink<OrderEvent> sink;

    public OrderSubscriptionController(OrderEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
        this.sink = eventPublisher.getSink();
    }

    @SubscriptionMapping
    public Flux<Order> orderUpdated(@Argument Long orderId) {
        return eventPublisher.getOrderStream()
            .filter(event -> event.getOrderId().equals(orderId))
            .map(OrderEvent::getOrder);
    }

    @SubscriptionMapping
    public Flux<Order> newOrder() {
        return eventPublisher.getOrderStream()
            .filter(event -> event.getType() == EventType.ORDER_CREATED)
            .map(OrderEvent::getOrder);
    }

    @SubscriptionMapping
    public Flux<OrderStatusPayload> orderStatusChanged() {
        return eventPublisher.getOrderStream()
            .filter(event -> event.getType() == EventType.STATUS_CHANGED)
            .map(event -> new OrderStatusPayload(
                event.getOrderId(),
                event.getOldStatus(),
                event.getNewStatus(),
                Instant.now().toString()
            ));
    }
}
```

---

## Event Publishing Pipeline

The event publishing pipeline connects mutations (which trigger state changes) to subscriptions (which notify clients of those changes). When a mutation like `createOrder` executes, it persists the order and then publishes an event through the event publisher. The subscription's `Flux` picks up this event and streams it to all subscribed clients. This publish-subscribe decoupling ensures mutations don't need to know which clients are subscribed or how many there are.

### Publisher Implementation

The `OrderEventPublisher` uses a `FluxProcessor` and `FluxSink` to create a hot stream of order events. Hot streams are essential for subscriptions — they broadcast events to all current subscribers regardless of when they subscribed (cold streams would replay the entire event history to each new subscriber). The `share()` method on the Flux creates a shared stream where multiple subscribers receive the same events. Production systems typically use a message broker (Redis, Kafka, RabbitMQ) as the event bus instead of in-memory processors, especially in multi-instance deployments.

```java
@Component
public class OrderEventPublisher {

    private final FluxProcessor<OrderEvent, OrderEvent> processor;
    private final FluxSink<OrderEvent> sink;

    public OrderEventPublisher() {
        this.processor = DirectProcessor.<OrderEvent>create().serialize();
        this.sink = processor.sink();
    }

    public void publishOrderCreated(Order order) {
        OrderEvent event = OrderEvent.builder()
            .type(EventType.ORDER_CREATED)
            .orderId(order.getId())
            .order(order)
            .timestamp(Instant.now())
            .build();
        sink.next(event);
    }

    public void publishStatusChanged(Long orderId, String oldStatus, String newStatus, Order order) {
        OrderEvent event = OrderEvent.builder()
            .type(EventType.STATUS_CHANGED)
            .orderId(orderId)
            .oldStatus(oldStatus)
            .newStatus(newStatus)
            .order(order)
            .timestamp(Instant.now())
            .build();
        sink.next(event);
    }

    public Flux<OrderEvent> getOrderStream() {
        return processor.share();
    }

    public FluxSink<OrderEvent> getSink() {
        return sink;
    }
}

enum EventType {
    ORDER_CREATED,
    STATUS_CHANGED,
    ORDER_CANCELLED,
    PAYMENT_RECEIVED
}

@Builder
class OrderEvent {
    private EventType type;
    private Long orderId;
    private String oldStatus;
    private String newStatus;
    private Order order;
    private Instant timestamp;
}
```

Mutations are the source of events in a subscription pipeline. Each mutation method, after completing its core business logic, calls the event publisher to notify subscribers. The `createOrder` mutation publishes an `ORDER_CREATED` event after persisting the order, and `updateOrderStatus` publishes a `STATUS_CHANGED` event with both the old and new status. This publish-after-write pattern ensures event consistency — events are only published after the database transaction commits, preventing subscribers from seeing phantom data.

### Mutation Publishing Events

```java
@Controller
public class OrderMutationController {

    private final OrderService orderService;
    private final OrderEventPublisher eventPublisher;

    public OrderMutationController(OrderService orderService,
                                   OrderEventPublisher eventPublisher) {
        this.orderService = orderService;
        this.eventPublisher = eventPublisher;
    }

    @MutationMapping
    public Order createOrder(@Argument CreateOrderInput input) {
        Order order = orderService.create(input);

        // Publish event for subscribers
        eventPublisher.publishOrderCreated(order);

        return order;
    }

    @MutationMapping
    public Order updateOrderStatus(@Argument Long orderId,
                                   @Argument String newStatus) {
        Order order = orderService.findById(orderId);
        String oldStatus = order.getStatus();

        order.setStatus(newStatus);
        order = orderService.update(order);

        // Notify subscribers of status change
        eventPublisher.publishStatusChanged(orderId, oldStatus, newStatus, order);

        return order;
    }

    @MutationMapping
    public Order cancelOrder(@Argument Long orderId) {
        Order order = orderService.cancel(orderId);

        eventPublisher.publishOrderCancelled(order);

        return order;
    }
}
```

---

## WebSocket Transport Configuration

GraphQL subscriptions require a persistent transport protocol. The GraphQL-over-WebSocket protocol defines a message format (subscribe, complete, next, error) for managing subscription lifecycles over WebSocket connections. Spring Boot's WebSocket support provides the infrastructure for handling WebSocket handshakes, message serialization, and session management. The transport layer is separate from the business logic — you could swap WebSocket for SSE or another transport without changing the subscription resolvers.

### Spring Boot WebSocket Setup

The WebSocket configuration registers a handler at the `/graphql` endpoint that manages subscription connections. The handler maintains a mapping of active subscriptions per session, cleaning them up when connections close. The protocol supports four message types: `connection_init` (authenticate and initialize), `subscribe` (start a subscription), `complete` (stop a subscription), and `next` (server pushes event data). The handler uses reactive execution (`graphQL.executeReactive()`) to get a `Flux<ExecutionResult>` that emits each time a matching event occurs.

```java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final GraphQLWebSocketHandler handler;

    public WebSocketConfig(GraphQLWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/graphql")
            .setAllowedOrigins("*")
            .withSockJS();  // Fallback for older browsers
    }
}

@Component
public class GraphQLWebSocketHandler extends TextWebSocketHandler {

    private final GraphQL graphQL;
    private final ObjectMapper objectMapper;
    private final Map<String, Disposable> subscriptions = new ConcurrentHashMap<>();

    public GraphQLWebSocketHandler(GraphQLProvider provider, ObjectMapper objectMapper) {
        this.graphQL = provider.getGraphQL();
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("WebSocket connection established: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Map<String, Object> payload = objectMapper.readValue(message.getPayload(),
            new TypeReference<Map<String, Object>>() {});

        String type = (String) payload.get("type");

        switch (type) {
            case "connection_init" -> handleConnectionInit(session, payload);
            case "subscribe" -> handleSubscribe(session, payload);
            case "complete" -> handleComplete(session, payload);
            default -> sendError(session, "Unknown message type: " + type);
        }
    }

    private void handleSubscribe(WebSocketSession session, Map<String, Object> payload) {
        Map<String, Object> graphqlPayload = (Map<String, Object>) payload.get("payload");
        String id = (String) payload.get("id");

        ExecutionInput executionInput = ExecutionInput.newExecutionInput()
            .query((String) graphqlPayload.get("query"))
            .variables((Map<String, Object>) graphqlPayload.get("variables"))
            .build();

        Flux<ExecutionResult> resultFlux = graphQL.executeReactive(executionInput);

        Disposable subscription = resultFlux.subscribe(
            result -> sendResult(session, id, result),
            error -> sendError(session, error.getMessage()),
            () -> sendComplete(session, id)
        );

        subscriptions.put(session.getId() + ":" + id, subscription);
    }

    private void sendResult(WebSocketSession session, String id, ExecutionResult result) {
        try {
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("type", "next");
            message.put("id", id);

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("data", result.getData());
            if (!result.getErrors().isEmpty()) {
                payload.put("errors", result.getErrors());
            }
            message.put("payload", payload);

            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
        } catch (IOException e) {
            log.error("Error sending subscription result", e);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        // Cleanup all subscriptions for this session
        subscriptions.entrySet()
            .removeIf(entry -> entry.getKey().startsWith(session.getId() + ":"));
    }
}
```

---

## Advanced Subscription Patterns

Beyond basic event streaming, subscriptions support advanced patterns for filtering, authentication, backpressure handling, and rate limiting. These patterns become essential as the number of subscribers grows and the event volume increases.

### Filtered Subscriptions

Server-side filtering reduces the data stream to only the events each client cares about. Without filtering, every subscriber receives every event — wasting bandwidth and processing power. The `notifications` subscription filters by user ID (ensuring users only get their own notifications) and optionally by event type. The `ordersByStatus` subscription lets clients subscribe to orders with a specific status, which is useful for order tracking dashboards. Filter criteria should be aligned with the schema arguments to minimize unnecessary data flow.

```java
@Controller
public class FilteredSubscriptionController {

    private final NotificationService notificationService;

    @SubscriptionMapping
    public Flux<Notification> notifications(@Argument Long userId,
                                            @Argument List<String> types) {
        return notificationService.getNotificationStream(userId)
            .filter(notification -> types == null || types.isEmpty()
                || types.contains(notification.getType()))
            .map(notification -> {
                // Mark and return
                notificationService.markDelivered(notification.getId());
                return notification;
            });
    }

    @SubscriptionMapping
    public Flux<Order> ordersByStatus(@Argument String status) {
        return orderEventPublisher.getOrderStream()
            .filter(event -> event.getOrder().getStatus().equals(status))
            .map(OrderEvent::getOrder);
    }
}
```

WebSocket connections for subscriptions must be authenticated at connection time, not after. The `WebSocketInterceptor` validates the JWT token during the HTTP upgrade handshake and stores the authenticated user in the session attributes. This prevents unauthenticated clients from establishing WebSocket connections and ensures that subscription resolvers can access the user identity without additional authentication checks. Authenticated subscriptions also enable per-user filtering — the `myNotifications` subscription automatically scopes to the authenticated user without requiring a userId argument.

### Authenticated Subscriptions

```java
@Component
public class AuthenticatedSubscriptionInterceptor
        implements WebSocketInterceptor {

    private final JwtTokenService tokenService;

    public AuthenticatedSubscriptionInterceptor(JwtTokenService tokenService) {
        this.tokenService = tokenService;
    }

    @Override
    public Mono<Void> handleConnection(ServerWebExchange exchange,
                                       WebSocketHandler handler) {
        String token = exchange.getRequest()
            .getHeaders()
            .getFirst("Authorization");

        if (token == null || !tokenService.validate(token)) {
            return Mono.error(new AuthenticationException("Invalid token"));
        }

        // Store authenticated user in session
        User user = tokenService.extractUser(token);
        exchange.getAttributes().put("user", user);

        return Mono.empty();
    }
}

@Controller
public class AuthenticatedSubscriptionController {

    @SubscriptionMapping
    public Flux<Notification> myNotifications() {
        // User identity comes from authentication context
        return Flux.create(sink -> {
            // Only subscribe for authenticated user's notifications
            String userId = SecurityContextHolder.getContext()
                .getAuthentication().getName();
            notificationService.subscribe(userId, sink::next);
        });
    }
}
```

Backpressure management prevents slow subscribers from overwhelming the server. When a client cannot consume events as fast as the server produces them, backpressure strategies determine what happens to excess events. `onBackpressureDrop` discards excess events (logging the drop), `onBackpressureBuffer` queues them up to a limit, and `limitRate` controls how many events the server sends per request cycle. `sample` reduces the event rate by emitting only the latest event within a time window. Choose the strategy based on your data semantics — metrics can be safely dropped or sampled, but financial transactions must be buffered or the client must acknowledge receipt.

### Reactive Stream Backpressure

```java
@Component
public class BackpressureSubscription {

    private final MessageBroker messageBroker;

    public Flux<ServerMetric> serverMetrics() {
        return messageBroker.metricStream()
            .onBackpressureDrop(metric -> {
                log.warn("Dropping metric due to backpressure: {}", metric.getId());
            })
            .sample(Duration.ofSeconds(1))  // Sample at most 1 per second
            .share();
    }

    public Flux<LogEvent> errorLogs(@Argument String level) {
        return messageBroker.logStream()
            .filter(log -> log.getLevel().equalsIgnoreCase(level))
            .limitRate(100)  // Request at most 100 at a time
            .onBackpressureBuffer(1000, 
                log -> log.warn("Log buffer full, dropping: {}", log.getMessage()));
    }
}
```

---

## Best Practices

Subscriptions add real-time capabilities to your GraphQL API but introduce new operational challenges around connection management, resource usage, and data consistency. The following practices help build reliable subscription infrastructure.

1. **Use WebSocket transport**: Reliable bidirectional communication
2. **Authenticate at connection time**: Validate tokens during handshake
3. **Filter server-side**: Reduce unnecessary data transfer
4. **Handle backpressure**: Prevent server overload from slow consumers
5. **Clean up subscriptions**: Remove disconnected clients
6. **Use connection timeout**: Close idle connections
7. **Implement reconnect logic**: Clients should handle disconnections
8. **Monitor subscription count**: Track active subscriptions per user
9. **Rate limit subscriptions**: Prevent abuse
10. **Payload optimization**: Send only changed fields

```java
@Configuration
public class SubscriptionRateLimiter {

    private final RateLimiter rateLimiter = RateLimiter.create(10.0); // 10 per second

    @Bean
    public SubscriptionExceptionResolver rateLimitResolver() {
        return (ex, input) -> {
            if (ex instanceof RateLimitExceededException) {
                return Mono.just(Map.of(
                    "message", "Too many subscriptions. Please slow down."
                ));
            }
            return Mono.empty();
        };
    }
}
```

---

## Common Mistakes

### Mistake 1: No Authentication on Subscriptions

```java
// WRONG: Unauthenticated subscription access
@SubscriptionMapping
public Flux<Order> allOrders() {
    return orderEventPublisher.getOrderStream();
}

// CORRECT: Authenticate and filter by user
@SubscriptionMapping
public Flux<Order> myOrders() {
    Long userId = getCurrentUserId();
    return orderEventPublisher.getOrderStream()
        .filter(event -> event.getOrder().getCustomerId().equals(userId))
        .map(OrderEvent::getOrder);
}
```

### Mistake 2: Memory Leaks from Missing Cleanup

```java
// WRONG: Subscription never disposed when client disconnects
sink.onCancel(() -> { /* no cleanup */ });

// CORRECT: Proper cleanup
Disposable disposable = eventStream.subscribe(event -> {
    sink.next(event);
});
sink.onCancel(disposable::dispose);
```

### Mistake 3: Sending Too Much Data

```java
// WRONG: Sending full entity on every update
publishOrderCreated(order);  // Sends entire order object

// CORRECT: Send minimal payload
publishOrderCreated(order.getId());  // Client can query for details if needed
```

---

## Summary

1. Subscriptions provide real-time data push over WebSocket transport
2. Mutations publish events that subscription resolvers stream to clients
3. Filter subscriptions server-side to reduce data transfer
4. Authenticate WebSocket connections during handshake
5. Handle backpressure to prevent server overload
6. Clean up subscriptions when clients disconnect
7. Use Flux and reactive streams for efficient event processing

---

## References

- [GraphQL Subscriptions Specification](https://spec.graphql.org/draft/#sec-Subscription)
- [Spring GraphQL Subscriptions](https://docs.spring.io/spring-graphql/reference/subscriptions.html)
- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [WebSocket Protocol RFC 6455](https://tools.ietf.org/html/rfc6455)

Happy Coding