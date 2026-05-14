---
title: "WebSocket vs Server-Sent Events"
description: "Compare WebSocket and Server-Sent Events: protocol differences, use cases, implementation patterns, and choosing the right real-time technology"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - websockets
  - server-sent-events
  - sse
  - real-time
coverImage: "/images/backend/api-design/websockets/websocket-vs-sse.png"
draft: false
---

# WebSocket vs Server-Sent Events

## Overview

WebSocket and Server-Sent Events (SSE) are two primary technologies for real-time web communication. WebSocket provides bidirectional, full-duplex communication, while SSE offers unidirectional server-to-client streaming over standard HTTP. Understanding their differences is critical for choosing the right technology.

---

## Protocol Comparison

```
Feature              | WebSocket                    | Server-Sent Events
---------------------|------------------------------|---------------------------
Direction            | Bidirectional                | Server to client only
Transport            | TCP (HTTP upgrade)           | HTTP (persistent connection)
Protocol             | ws:// / wss://               | http:// / https://
Message Format       | Binary or text               | Text only (UTF-8)
Auto-reconnection    | Manual implementation        | Built-in (EventSource API)
Browser Support      | All modern browsers          | All except IE/Edge Legacy
Firewall Friendly    | Needs upgrade header support | Works through all proxies
Complexity           | Higher                       | Simpler
Scaling              | More complex (stateful)      | Simpler (stateless)
Throughput           | Higher (full-duplex)         | Lower (half-duplex)
Headers per message  | Minimal (frame-based)        | Event-stream format overhead
```

---

## Server-Sent Events Implementation

Server-Sent Events (SSE) is a standard HTTP mechanism for pushing data from server to client over a persistent connection. Unlike WebSocket, SSE uses standard HTTP (no upgrade required) and is unidirectional — only the server can send data. The browser's `EventSource` API provides built-in reconnection and event ID tracking, simplifying client implementation significantly. SSE is the right choice when you need one-way data push and don't need client-to-server messaging.

### SSE Controller

The SSE controller returns a `Flux<ServerSentEvent<T>>` — a reactive stream of SSE messages. Spring WebFlux handles the streaming response, keeping the HTTP connection open and sending events as they become available. Each `ServerSentEvent` can include an `id` (for client-side reconnection tracking), `event` type (for client-side event dispatch), `data` (the payload), and `comment` (for debugging). The heartbeat events keep the connection alive — without them, proxies and load balancers might close idle connections. The `mergeWith` operator combines the notification stream with the heartbeat stream into a single event flow.

```java
@RestController
@RequestMapping("/api/events")
public class SSEController {

    private final NotificationService notificationService;

    public SSEController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping(value = "/stream/{userId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Notification>> streamNotifications(
            @PathVariable Long userId) {

        return notificationService.getNotificationStream(userId)
            .map(notification -> ServerSentEvent.<Notification>builder()
                .id(notification.getId().toString())
                .event("notification")
                .data(notification)
                .comment("Notification stream for user " + userId)
                .build())
            .mergeWith(heartbeatEvents());
    }

    // Heartbeat to keep connection alive
    private Flux<ServerSentEvent<Notification>> heartbeatEvents() {
        return Flux.interval(Duration.ofSeconds(30))
            .map(i -> ServerSentEvent.<Notification>builder()
                .event("heartbeat")
                .comment("keep-alive")
                .build());
    }
}
```

### SSE Client (JavaScript)

```javascript
// Client-side EventSource
const eventSource = new EventSource('/api/events/stream/123');

eventSource.addEventListener('notification', (event) => {
    const notification = JSON.parse(event.data);
    displayNotification(notification);
});

eventSource.addEventListener('heartbeat', () => {
    console.log('Connection alive');
});

eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    // EventSource auto-reconnects by default
};
```

### SSE Event Format

```
data: {"type": "order_update", "orderId": 123, "status": "shipped"}
id: 1
event: notification

data: {"type": "system", "message": "Scheduled maintenance at 2 AM"}
id: 2
event: notification

: heartbeat keep-alive
```

---

## WebSocket for Bidirectional Communication

When the client needs to send data to the server as well as receive real-time updates, WebSocket is the appropriate choice. The bidirectional Chat handler demonstrates this: clients send messages through the same connection, and the server broadcasts them to other clients in the same room. The low latency and full-duplex nature of WebSocket make it suitable for interactive applications where round-trip time matters.

### Bidirectional Chat

The bidirectional handler processes different message actions: `subscribe` to join a room (enabling broadcast reception), `unsubscribe` to leave, `message` to send a chat message, and `command` for control operations. Broadcasting uses `parallelStream` for concurrent delivery to room members, excluding the sender. This pattern is efficient for small to medium room sizes — for large rooms, consider async processing or delivery queues to avoid blocking the handler thread.

```java
@Component
public class BidirectionalChatHandler extends TextWebSocketHandler {

    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message)
            throws Exception {

        Map<String, Object> payload = parsePayload(message);

        switch ((String) payload.get("action")) {
            case "subscribe" -> joinRoom(session, payload);
            case "unsubscribe" -> leaveRoom(session, payload);
            case "message" -> broadcastMessage(session, payload);
            case "command" -> handleCommand(session, payload);
        }
    }

    private void broadcastMessage(WebSocketSession sender, Map<String, Object> payload) {
        String room = (String) payload.get("room");
        Set<WebSocketSession> roomSessions = rooms.get(room);

        if (roomSessions != null) {
            TextMessage broadcast = new TextMessage(toJson(Map.of(
                "type", "message",
                "sender", sender.getId(),
                "content", payload.get("content"),
                "timestamp", Instant.now().toString()
            )));

            roomSessions.parallelStream().forEach(session -> {
                try {
                    if (session.isOpen() && !session.getId().equals(sender.getId())) {
                        session.sendMessage(broadcast);
                    }
                } catch (IOException e) {
                    log.error("Broadcast failed", e);
                }
            });
        }
    }
}
```

---

## When to Use SSE Over WebSocket

### Use SSE When:

```java
@RestController
@RequestMapping("/api/monitoring")
public class MonitoringSSEController {

    // SSE: Perfect for unidirectional data streams
    @GetMapping(value = "/metrics", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Metric>> streamMetrics() {

        return Flux.interval(Duration.ofSeconds(5))
            .map(tick -> {
                Metric metric = new Metric(
                    "system.cpu.usage",
                    getCpuUsage(),
                    Map.of("host", hostname, "env", environment)
                );

                return ServerSentEvent.<Metric>builder()
                    .event("metric")
                    .data(metric)
                    .build();
            });
    }

    // Stock price ticker
    @GetMapping(value = "/stocks/{symbol}",
                produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<StockPrice>> streamStockPrice(
            @PathVariable String symbol) {

        return stockPriceService.streamPrice(symbol)
            .map(price -> ServerSentEvent.<StockPrice>builder()
                .event("price")
                .id(String.valueOf(price.getSequence()))
                .data(price)
                .build());
    }
}
```

**Ideal for:**
- Status updates and notifications
- Stock tickers and price feeds
- Log streaming
- Progress updates for long operations
- Social media feeds
- Operational metrics dashboards

### Use WebSocket When:

```java
@Component
public class CollaborativeEditorHandler extends TextWebSocketHandler {

    private final Map<String, DocumentState> documents = new ConcurrentHashMap<>();

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message)
            throws Exception {

        // Client sends edits, server broadcasts to other clients in same document
        EditorOperation op = objectMapper.readValue(
            message.getPayload(), EditorOperation.class);

        // Apply operation
        DocumentState doc = documents.computeIfAbsent(
            op.getDocumentId(), k -> new DocumentState());

        OperationResult result = doc.applyOperation(op);

        // Broadcast operation to other editors
        broadcastToDocument(op.getDocumentId(), result, session.getId());

        // Send acknowledgment back to sender
        session.sendMessage(new TextMessage(toJson(Map.of(
            "type", "ack",
            "version", result.getVersion()
        ))));
    }
}
```

**Ideal for:**
- Chat applications
- Collaborative editing
- Gaming
- Real-time form validation
- Live cursor tracking
- Interactive whiteboards

---

## Hybrid Approach

### Using Both Technologies

```java
@Configuration
public class HybridRealTimeConfig {

    @Bean
    public RouterFunction<ServerResponse> sseRoutes(
            NotificationSSEHandler sseHandler) {
        return RouterFunctions
            .route(GET("/api/sse/notifications/{userId}"), sseHandler::stream);
    }

    @Bean
    public WebSocketHandler webSocketHandler() {
        return new InteractiveHandler();
    }
}

// SSE for one-way notifications
@Component
public class NotificationSSEHandler {

    public Mono<ServerResponse> stream(ServerRequest request) {
        Long userId = Long.parseLong(request.pathVariable("userId"));

        Flux<ServerSentEvent<?>> eventStream = notificationService
            .getNotificationStream(userId)
            .map(this::toSSE);

        return ServerResponse.ok()
            .contentType(MediaType.TEXT_EVENT_STREAM)
            .body(eventStream, ServerSentEvent.class);
    }
}

// WebSocket for interactive features
@Component
public class InteractiveHandler extends TextWebSocketHandler {
    // Bidirectional features: chat, typing indicators, editing
}
```

### Client-Side Decision

```java
// Client-side strategy: use appropriate technology per use case
class RealTimeClient {

    private EventSource notificationSource;
    private WebSocket interactiveSocket;

    public void connect(Long userId) {
        // SSE for notifications (server to client only)
        this.notificationSource = new EventSource(
            "/api/sse/notifications/" + userId);

        // WebSocket for interactive features
        WebSocketClient client = new StandardWebSocketClient();
        this.interactiveSocket = client.doHandshake(
            new InteractiveHandler(), "/ws/interactive");
    }
}
```

---

## Best Practices

1. **SSE for server-to-client pushes**: Simple, auto-reconnecting, HTTP-native
2. **WebSocket for bidirectional**: Chat, gaming, collaborative features
3. **Use SSE for logging/monitoring**: Unidirectional streams
4. **Use WebSocket for low-latency interaction**: Sub-100ms requirements
5. **Consider infrastructure**: WebSocket needs sticky sessions or pub/sub
6. **Fallback with SSE**: SSE works through most proxies
7. **Heartbeat for both**: Keep connections alive
8. **Monitor connections**: Alert on drops
9. **Compress data**: Especially for SSE text streams
10. **Consider Long Polling**: For environments without SSE/WebSocket

```java
// Conditional fallback strategy
@Configuration
public class ConnectionStrategy {

    @Bean
    @ConditionalOnProperty(name = "realtime.transport", havingValue = "websocket")
    public WebSocketHandler webSocketHandler() {
        return new InteractiveWebSocketHandler();
    }

    @Bean
    @ConditionalOnProperty(name = "realtime.transport", havingValue = "sse")
    public RouterFunction<ServerResponse> sseHandler() {
        return RouterFunctions.route(
            GET("/realtime/connect"), new SSEHandler());
    }
}
```

---

## Common Mistakes

### Mistake 1: Using WebSocket for Simple Notifications

```java
// WRONG: WebSocket for one-way notifications
// - Overkill for server-to-client only
// - More complex to implement
// - Harder to scale

// CORRECT: SSE for one-way server pushes
@GetMapping(value = "/notifications/stream",
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<Notification>> streamNotifications() {
    return notificationService.stream();
}
```

### Mistake 2: Not Handling SSE Reconnection

```javascript
// WRONG: Not handling EventSource reconnection
const source = new EventSource('/events');

// CORRECT: EventSource auto-reconnects
// But handle application-level state
source.addEventListener('connected', (event) => {
    lastEventId = event.lastEventId;  // Track for resync
});
```

### Mistake 3: SSE for Bidirectional Needs

```java
// WRONG: SSE + additional POST requests for bidirectional
// Client sends via POST, receives via SSE
// Creates complexity, higher latency

// CORRECT: Use WebSocket for true bidirectional
```

---

## Summary

1. SSE is simpler, HTTP-native, and auto-reconnecting for server-to-client streams
2. WebSocket provides full-duplex communication for interactive applications
3. SSE works through all HTTP proxies and firewalls
4. WebSocket has better throughput for bidirectional data
5. SSE has built-in browser reconnection support
6. Use WebSocket when clients need to send data back to server frequently
7. Use SSE for monitoring, notifications, and event streams
8. Hybrid approaches use both technologies appropriately

---

## References

- [W3C Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [RFC 6455 WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [SSE vs WebSocket Comparison](https://www.baeldung.com/spring-server-sent-events)
- [MDN Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

Happy Coding