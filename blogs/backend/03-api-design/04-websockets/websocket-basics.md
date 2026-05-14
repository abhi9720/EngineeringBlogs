---
title: WebSocket Basics
description: >-
  Master WebSocket protocol: handshake, frame types, Java WebSocket API, Spring
  WebSocket support, and real-world implementation patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - websockets
  - real-time
  - spring-websocket
  - protocol
coverImage: /images/backend/api-design/websockets/websocket-basics.png
draft: false
order: 20
---
# WebSocket Basics

## Overview

WebSocket provides full-duplex communication over a single TCP connection after an initial HTTP handshake. Unlike traditional HTTP request-response, WebSocket enables real-time, bidirectional data transfer with minimal overhead, making it ideal for chat, live updates, gaming, and collaborative applications.

---

## WebSocket Protocol

The WebSocket protocol begins with an HTTP upgrade handshake, then transitions to a persistent, full-duplex TCP connection. The handshake uses standard HTTP headers to negotiate the protocol upgrade. Once established, data is exchanged in frames rather than HTTP request-response pairs, eliminating HTTP overhead for each message. The protocol supports both text and binary frames, has built-in framing for message boundaries, and provides extensions for compression and multiplexing.

### Handshake

The handshake starts with the client sending an HTTP GET request with the `Upgrade: websocket` and `Connection: Upgrade` headers. The `Sec-WebSocket-Key` is a random 16-byte value encoded in Base64 — the server concatenates this with a fixed GUID, computes a SHA-1 hash, and returns it as `Sec-WebSocket-Accept`. This proves that the server understands the WebSocket protocol. The client must validate this response to ensure the connection is legitimate. After the handshake (HTTP 101 Switching Protocols), both sides can send data at any time.

```java
// Client sends HTTP upgrade request
GET /ws/chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

// Server responds with upgrade
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

### Frame Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|F|R|R|R| opcode|M| Payload len   |    Extended payload length   |
|I|S|S|S|  (4)  |A|     (7)      |             (16/64)           |
|N|V|V|V|       |S|               |                               |
| |1|2|3|       |K|               |                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Extended payload length continued, if payload len == 126/127        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|               Masking-key, if MASK set to 1                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Payload Data (variable length)                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

---

## Spring WebSocket Server

Spring's WebSocket support provides a comprehensive framework for building WebSocket-based applications. The core components are the `WebSocketHandler` (processes incoming messages and connection events), the `HandshakeInterceptor` (intercepts the HTTP upgrade handshake for authentication and preprocessing), and the WebSocket configuration (registers handlers and configures endpoints). Spring also supports STOMP — a higher-level messaging protocol built on top of WebSocket that provides topic-based pub/sub messaging.

### WebSocket Handler

The `ChatWebSocketHandler` extends `TextWebSocketHandler` and overrides lifecycle methods. `afterConnectionEstablished` is called when a client connects — authenticate, join a room, and send an acknowledgment. `handleTextMessage` processes incoming messages — parse JSON, dispatch by message type (chat message, typing indicator, ping). `afterConnectionClosed` cleans up when a client disconnects — remove from session map, leave the room. `handleTransportError` handles unexpected connection errors. The handler manages session lifecycle carefully: authenticate before allowing operations, validate message format, and clean up resources on disconnect.

```java
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final ChatRoomService chatRoomService;
    private final ObjectMapper objectMapper;
    private static final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    public ChatWebSocketHandler(ChatRoomService chatRoomService,
                                ObjectMapper objectMapper) {
        this.chatRoomService = chatRoomService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String sessionId = session.getId();
        sessions.put(sessionId, session);

        // Extract query parameters for room/authentication
        String room = getParameter(session, "room");
        String token = getParameter(session, "token");

        log.info("WebSocket connected: {} to room {}", sessionId, room);

        // Authenticate
        if (!authenticate(token, session)) {
            closeWithError(session, 4001, "Authentication failed");
            return;
        }

        // Join room
        chatRoomService.join(sessionId, room);

        // Send acknowledgment
        sendMessage(session, Map.of(
            "type", "connected",
            "sessionId", sessionId,
            "room", room
        ));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        try {
            Map<String, Object> payload = objectMapper.readValue(
                message.getPayload(),
                new TypeReference<Map<String, Object>>() {}
            );

            String type = (String) payload.getOrDefault("type", "message");
            String room = (String) payload.getOrDefault("room", "general");

            switch (type) {
                case "message" -> handleChatMessage(session, payload, room);
                case "typing" -> handleTypingIndicator(session, payload, room);
                case "ping" -> handlePing(session);
                default -> sendError(session, "Unknown message type: " + type);
            }

        } catch (JsonProcessingException e) {
            sendError(session, "Invalid JSON format");
        }
    }

    private void handleChatMessage(WebSocketSession session,
                                   Map<String, Object> payload, String room) {
        String content = (String) payload.get("content");

        if (content == null || content.isBlank()) {
            sendError(session, "Message content is required");
            return;
        }

        Map<String, Object> broadcast = new LinkedHashMap<>();
        broadcast.put("type", "message");
        broadcast.put("sender", session.getId());
        broadcast.put("content", content);
        broadcast.put("timestamp", Instant.now().toString());

        chatRoomService.broadcastToRoom(room, broadcast, session.getId());
    }

    private void handleTypingIndicator(WebSocketSession session,
                                       Map<String, Object> payload, String room) {
        boolean typing = (boolean) payload.getOrDefault("typing", false);

        Map<String, Object> indicator = Map.of(
            "type", "typing",
            "sender", session.getId(),
            "typing", typing
        );

        chatRoomService.broadcastToRoom(room, indicator, session.getId());
    }

    private void handlePing(WebSocketSession session) {
        sendMessage(session, Map.of("type", "pong"));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String sessionId = session.getId();
        sessions.remove(sessionId);
        chatRoomService.leave(sessionId);

        log.info("WebSocket disconnected: {} with status {}",
            sessionId, status);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.error("Transport error for session {}: {}",
            session.getId(), exception.getMessage());
    }

    private void sendMessage(WebSocketSession session, Object data) {
        try {
            String json = objectMapper.writeValueAsString(data);
            session.sendMessage(new TextMessage(json));
        } catch (IOException e) {
            log.error("Error sending message to session {}", session.getId(), e);
        }
    }

    private void closeWithError(WebSocketSession session, int code, String reason) {
        try {
            session.close(new CloseStatus(code, reason));
        } catch (IOException e) {
            log.error("Error closing session", e);
        }
    }

    private String getParameter(WebSocketSession session, String name) {
        String query = session.getUri().getQuery();
        if (query != null) {
            for (String param : query.split("&")) {
                String[] parts = param.split("=", 2);
                if (parts.length == 2 && parts[0].equals(name)) {
                    return parts[1];
                }
            }
        }
        return null;
    }

    private boolean authenticate(String token, WebSocketSession session) {
        if (token == null) {
            return false;
        }
        try {
            // Validate JWT token
            User user = jwtTokenService.validateAndExtract(token);
            session.getAttributes().put("user", user);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
```

WebSocket configuration registers handlers at specific URL paths and configures interceptors for preprocessing. The `registerWebSocketHandlers` method maps the handler to a path and configures allowed origins for CORS protection. The `HandshakeInterceptor` runs before the WebSocket handshake completes, allowing you to validate authentication tokens, check origin headers, and reject unauthorized connections before the WebSocket connection is established. The `withSockJS()` enables SockJS fallback — a protocol that emulates WebSocket for browsers that don't support it natively.

### WebSocket Configuration

```java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler chatHandler;
    private final WebSocketInterceptor authInterceptor;

    public WebSocketConfig(ChatWebSocketHandler chatHandler,
                           WebSocketInterceptor authInterceptor) {
        this.chatHandler = chatHandler;
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatHandler, "/ws/chat")
            .addInterceptors(authInterceptor)
            .setAllowedOrigins("https://example.com", "https://app.example.com")
            .withSockJS();  // Fallback for environments without WebSocket support
    }
}

@Component
public class WebSocketInterceptor implements HandshakeInterceptor {

    @Override
    public boolean beforeHandshake(ServerHttpRequest request,
                                   ServerHttpResponse response,
                                   WebSocketHandler wsHandler,
                                   Map<String, Object> attributes) {

        // Validate origin
        String origin = request.getHeaders().getOrigin();
        if (origin != null && !isAllowedOrigin(origin)) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }

        // Extract and validate token from query params
        URI uri = request.getURI();
        String query = uri.getQuery();

        if (query != null && query.contains("token=")) {
            String token = extractToken(query);
            attributes.put("token", token);
        }

        // Set session timeout
        attributes.put("sessionTimeout", 3600000L); // 1 hour

        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request,
                               ServerHttpResponse response,
                               WebSocketHandler wsHandler,
                               Exception exception) {
        log.info("Handshake completed for {}", request.getURI());
    }

    private boolean isAllowedOrigin(String origin) {
        return origin.equals("https://example.com")
            || origin.equals("https://app.example.com");
    }

    private String extractToken(String query) {
        for (String param : query.split("&")) {
            String[] parts = param.split("=", 2);
            if (parts.length == 2 && parts[0].equals("token")) {
                return parts[1];
            }
        }
        return null;
    }
}
```

---

## STOMP over WebSocket

### STOMP Configuration

```java
@Configuration
@EnableWebSocketMessageBroker
public class StompConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // In-memory broker for topics and queues
        config.enableSimpleBroker("/topic", "/queue");

        // Application destination prefix
        config.setApplicationDestinationPrefixes("/app");

        // User destination prefix for point-to-point
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws-stomp")
            .setAllowedOrigins("https://example.com")
            .withSockJS();
    }
}

@Controller
public class StompController {

    @MessageMapping("/chat.send")
    @SendTo("/topic/chat")
    public ChatMessage sendMessage(ChatMessage message,
                                   SimpMessageHeaderAccessor headerAccessor) {
        String username = headerAccessor.getUser().getName();
        message.setSender(username);
        message.setTimestamp(Instant.now().toString());
        return message;
    }

    @MessageMapping("/chat.join")
    @SendTo("/topic/chat")
    public ChatMessage joinRoom(ChatMessage message,
                                SimpMessageHeaderAccessor headerAccessor) {
        headerAccessor.getSessionAttributes()
            .put("room", message.getRoomId());

        message.setContent(headerAccessor.getUser().getName() + " joined");
        message.setType("join");
        return message;
    }

    @MessageMapping("/chat.typing")
    @SendTo("/topic/typing")
    public TypingIndicator typing(TypingIndicator indicator,
                                  SimpMessageHeaderAccessor headerAccessor) {
        indicator.setUsername(headerAccessor.getUser().getName());
        return indicator;
    }

    // Send to specific user
    @MessageMapping("/chat.private")
    public void privateMessage(PrivateMessage message,
                               SimpMessageHeaderAccessor headerAccessor) {
        message.setFrom(headerAccessor.getUser().getName());
        messagingTemplate.convertAndSendToUser(
            message.getTo(), "/queue/private", message);
    }
}
```

---

## Best Practices

1. **Always authenticate during handshake**: Validate tokens before upgrade
2. **Use heartbeat/ping-pong**: Detect dead connections
3. **Implement reconnection**: Client should auto-reconnect on disconnect
4. **Limit message size**: Prevent memory issues
5. **Use STOMP for complex messaging**: Topic, queue, user routing
6. **Close idle connections**: Prevent resource leaks
7. **Monitor connection count**: Alert on unusual patterns
8. **Use SockJS fallback**: Support environments without WebSocket
9. **Validate message rate**: Prevent flooding
10. **Secure with WSS**: Always use wss:// in production

```java
// Heartbeat configuration
@Configuration
public class WebSocketHeartbeatConfig {

    @Bean
    public WebSocketHandler heartbeatHandler() {
        return new TextWebSocketHandler() {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) {
                scheduleHeartbeat(session);
            }

            private void scheduleHeartbeat(WebSocketSession session) {
                Executors.newSingleThreadScheduledExecutor()
                    .scheduleAtFixedRate(() -> {
                        try {
                            if (session.isOpen()) {
                                session.sendMessage(new TextMessage("{\"type\":\"ping\"}"));
                            }
                        } catch (IOException e) {
                            log.error("Heartbeat failed", e);
                        }
                    }, 30, 30, TimeUnit.SECONDS);
            }
        };
    }
}
```

---

## Common Mistakes

### Mistake 1: No Authentication During Handshake

```java
// WRONG: Accepting all connections
@Override
public boolean beforeHandshake(ServerHttpRequest request,
                               ServerHttpResponse response, ...) {
    return true;  // No authentication!
}

// CORRECT: Validate token
@Override
public boolean beforeHandshake(ServerHttpRequest request, ...) {
    String token = request.getHeaders().getFirst("Authorization");
    if (token == null || !jwtService.validate(token)) {
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }
    return true;
}
```

### Mistake 2: Not Handling Disconnection Properly

```java
// WRONG: No cleanup on disconnect
// CORRECT: Clean up sessions and resources
@Override
public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    sessions.remove(session.getId());
    roomService.leave(session.getId());
}
```

### Mistake 3: Blocking in WebSocket Handler

```java
// WRONG: Blocking database call in handler
@Override
protected void handleTextMessage(WebSocketSession session, TextMessage message) {
    Thread.sleep(500);  // Never block in WebSocket handler
    process(message);
}

// CORRECT: Use async processing
@Override
protected void handleTextMessage(WebSocketSession session, TextMessage message) {
    CompletableFuture.runAsync(() -> process(message));
}
```

---

## Summary

1. WebSocket provides full-duplex communication over a single TCP connection
2. HTTP upgrade handshake establishes the WebSocket connection
3. Spring WebSocket provides handler, interceptor, and STOMP support
4. Authenticate during handshake, not after
5. Use heartbeat/ping-pong to detect dead connections
6. Implement proper reconnection with exponential backoff
7. STOMP provides pub/sub messaging patterns on top of WebSocket
8. Always use WSS in production

---

## References

- [RFC 6455 - The WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [Spring WebSocket Reference](https://docs.spring.io/spring-framework/reference/web/websocket.html)
- [STOMP Protocol Specification](https://stomp.github.io/stomp-specification-1.2.html)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

Happy Coding
