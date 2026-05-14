---
title: Scaling WebSockets
description: >-
  Techniques for scaling WebSocket connections: sticky sessions, pub/sub
  backplane, Redis pub/sub, horizontal scaling, and connection management
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - websockets
  - scaling
  - redis
  - sticky-sessions
coverImage: /images/backend/api-design/websockets/scaling-websockets.png
draft: false
order: 10
---
# Scaling WebSockets

## Overview

Scaling WebSocket connections horizontally is challenging because WebSocket connections are stateful and long-lived. Unlike HTTP requests, a WebSocket connection stays open on a specific server instance, requiring careful architecture for multi-instance deployments.

---

## The Scaling Challenge

Scaling WebSocket connections horizontally is fundamentally different from scaling HTTP requests because WebSockets maintain stateful, long-lived connections. While HTTP requests are stateless and can be routed to any server instance, a WebSocket connection stays bound to the specific instance that handled its initial HTTP upgrade handshake. This stateful nature creates unique challenges for multi-instance deployments, load balancing, and fault tolerance.

### Why WebSockets Are Hard to Scale

The core problem is shown in the contrast between HTTP and WebSocket handlers. An HTTP controller can handle any request on any instance because each request is independent. A WebSocket handler stores sessions in a local `ConcurrentHashMap` — those sessions exist only on the instance where the connection was established. Broadcasting a message calls `localSessions.values().forEach(...)`, which only reaches connections on the current instance. To broadcast to all connected clients, you need a mechanism to communicate across instances.

```java
// Stateless HTTP - easy to scale
@RestController
public class HttpController {
    @GetMapping("/api/data")
    public Data getData() {
        // Any instance can handle any request
        return service.fetchData();
    }
}

// Stateful WebSocket - instance specific
@Component
public class WebSocketHandler extends TextWebSocketHandler {

    // Connection stored in local map - only on this instance
    private final Map<String, WebSocketSession> localSessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        // Session only exists on THIS server instance
        localSessions.put(session.getId(), session);
    }

    public void broadcastToInstance(String message) {
        // Only broadcasts to connections on THIS instance
        localSessions.values().forEach(s -> send(s, message));
    }
}
```

---

## Sticky Sessions (Session Affinity)

Sticky sessions, also known as session affinity, ensure that all requests from a client are routed to the same server instance. For WebSocket connections, this means the load balancer must consistently route the connection and subsequent messages to the instance that handled the initial handshake. Without sticky sessions, a WebSocket connection might be established on instance A but subsequent messages could be routed to instance B, which has no record of the connection.

### Load Balancer Configuration

Sticky sessions can be configured through load balancer strategies like `ip_hash` (routing based on client IP) or cookie-based affinity (setting a session cookie on the first request). The nginx configuration shows `ip_hash`, which ensures the same client IP always goes to the same backend server. For more dynamic load balancing, use a Redis-backed session store with Spring Session — this stores session metadata externally so any instance can recover session state if needed.

```java
@Configuration
public class StickySessionConfig {

    @Bean
    public TomcatServletWebServerFactory tomcatFactory() {
        return new TomcatServletWebServerFactory() {
            @Override
            protected void postProcessContext(Context context) {
                // Enable sticky session for WebSocket
                SessionCookieConfig sessionCookie = context.getSessionCookieConfig();
                sessionCookie.setName("WS_SESSION_ID");
                sessionCookie.setPath("/");
            }
        };
    }
}

// nginx configuration for sticky sessions
// upstream websocket_backend {
//     ip_hash;  # Or use sticky cookie
//     server ws1.example.com:8080;
//     server ws2.example.com:8080;
//     server ws3.example.com:8080;
// }
```

### Spring Session with Redis

```java
@Configuration
@EnableRedisWebSession(maxInactiveIntervalInSeconds = 3600)
public class SessionConfig {

    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        return new LettuceConnectionFactory("redis.example.com", 6379);
    }
}
```

---

## Pub/Sub Backplane Pattern

A pub/sub backplane is the standard solution for cross-instance messaging in WebSocket deployments. When a message needs to be broadcast to all connected clients (regardless of which instance they're connected to), the publishing instance sends the message to a shared pub/sub channel. All instances subscribe to this channel and forward messages to their local connections. Redis Pub/Sub is the most common backplane implementation, but Kafka, RabbitMQ, or NATS are also viable options depending on throughput requirements and existing infrastructure.

### Redis Pub/Sub for Cross-Instance Communication

The `RedisPubSubBackplane` implements the backplane pattern with Redis. When a client joins a room, the instance subscribes to the Redis channel for that room. When a message is broadcast: (1) it's sent directly to local sessions in the same room, (2) it's published to Redis for the room's channel. Other instances receive the Redis message in their subscription callback and forward it to their local sessions in that room. The `subscribeToChannels` method ensures instances only subscribe to channels for rooms that have active local subscribers, minimizing Redis channel subscription overhead.

```java
@Component
public class RedisPubSubBackplane {

    private final RedisTemplate<String, String> redisTemplate;
    private final Map<String, Set<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    private static final String CHANNEL_PREFIX = "ws:room:";

    public RedisPubSubBackplane(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
        subscribeToChannels();
    }

    public void joinRoom(String roomId, WebSocketSession session) {
        roomSessions.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet())
            .add(session);

        // Subscribe to room channel if first local subscriber
        if (roomSessions.get(roomId).size() == 1) {
            redisTemplate.getConnectionFactory().getConnection()
                .subscribe(
                    (message, pattern) -> handleIncomingMessage(roomId, message),
                    (CHANNEL_PREFIX + roomId).getBytes()
                );
        }
    }

    public void broadcastToRoom(String roomId, String message, String senderSessionId) {
        // Send to local sessions
        sendToLocalSessions(roomId, message, senderSessionId);

        // Publish to Redis for other instances
        redisTemplate.convertAndSend(CHANNEL_PREFIX + roomId, message);
    }

    private void handleIncomingMessage(String roomId, Message message) {
        String payload = new String(message.getBody());
        sendToLocalSessions(roomId, payload, null);
    }

    private void sendToLocalSessions(String roomId, String message, String excludeId) {
        Set<WebSocketSession> sessions = roomSessions.get(roomId);
        if (sessions != null) {
            TextMessage textMessage = new TextMessage(message);
            sessions.parallelStream().forEach(session -> {
                try {
                    if (session.isOpen() && !session.getId().equals(excludeId)) {
                        session.sendMessage(textMessage);
                    }
                } catch (IOException e) {
                    log.error("Failed to send to session {}", session.getId(), e);
                }
            });
        }
    }

    private void subscribeToChannels() {
        // Subscribe to all room channels dynamically
        // Each instance joins when it has local subscribers
    }
}
```

### Redis Pub/Sub Subscriber Configuration

```java
@Configuration
public class RedisPubSubConfig {

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory,
            MessageListenerAdapter listenerAdapter) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        // Listen to all WebSocket room channels
        container.addMessageListener(listenerAdapter,
            new PatternTopic("ws:room:*"));

        return container;
    }

    @Bean
    public MessageListenerAdapter listenerAdapter(RedisPubSubBackplane backplane) {
        return new MessageListenerAdapter(backplane, "handleIncomingMessage");
    }
}
```

---

## Distributed WebSocket Manager

### Session Registry

```java
@Component
public class DistributedSessionManager {

    private final RedisTemplate<String, String> redisTemplate;
    private final String instanceId;

    private static final String SESSION_KEY_PREFIX = "ws:session:";
    private static final String INSTANCE_SESSIONS_KEY = "ws:instance:%s:sessions";
    private static final String ROOM_SESSIONS_KEY = "ws:room:%s:sessions";

    public DistributedSessionManager(RedisTemplate<String, String> redisTemplate,
                                     @Value("${instance.id}") String instanceId) {
        this.redisTemplate = redisTemplate;
        this.instanceId = instanceId;
    }

    public void registerSession(String sessionId, String userId, String roomId) {
        // Store session metadata
        Map<String, String> sessionData = Map.of(
            "sessionId", sessionId,
            "userId", userId,
            "roomId", roomId,
            "instanceId", instanceId,
            "connectedAt", Instant.now().toString()
        );
        redisTemplate.opsForHash().putAll(SESSION_KEY_PREFIX + sessionId, sessionData);

        // Add to instance set
        redisTemplate.opsForSet().add(
            String.format(INSTANCE_SESSIONS_KEY, instanceId), sessionId);

        // Add to room set
        redisTemplate.opsForSet().add(
            String.format(ROOM_SESSIONS_KEY, roomId), sessionId + ":" + instanceId);

        // Set TTL for cleanup
        redisTemplate.expire(SESSION_KEY_PREFIX + sessionId, Duration.ofHours(1));
    }

    public void unregisterSession(String sessionId) {
        String instanceKey = String.format(INSTANCE_SESSIONS_KEY, instanceId);
        redisTemplate.opsForSet().remove(instanceKey, sessionId);
        redisTemplate.delete(SESSION_KEY_PREFIX + sessionId);
    }

    public long getInstanceSessionCount() {
        String key = String.format(INSTANCE_SESSIONS_KEY, instanceId);
        Long count = redisTemplate.opsForSet().size(key);
        return count != null ? count : 0;
    }

    public List<String> getInstancesForRoom(String roomId) {
        Set<String> entries = redisTemplate.opsForSet().members(
            String.format(ROOM_SESSIONS_KEY, roomId));

        if (entries == null) return Collections.emptyList();

        return entries.stream()
            .map(entry -> entry.split(":")[1])
            .distinct()
            .toList();
    }
}
```

### Load Balancer Integration

```java
@Component
public class WebSocketLoadBalancer {

    private final DistributedSessionManager sessionManager;
    private final List<String> instances;

    public WebSocketLoadBalancer(DistributedSessionManager sessionManager,
                                 @Value("${ws.instances}") List<String> instances) {
        this.sessionManager = sessionManager;
        this.instances = instances;
    }

    public String selectInstance(String userId, String roomId) {
        // Strategy 1: Route to least loaded instance
        return instances.stream()
            .min(Comparator.comparingLong(
                instance -> sessionManager.getInstanceSessionCount()))
            .orElseThrow(() -> new IllegalStateException("No instances available"));
    }

    public String selectInstanceByHash(String userId) {
        // Strategy 2: Consistent hashing for user affinity
        int hash = Math.abs(userId.hashCode());
        return instances.get(hash % instances.size());
    }
}
```

---

## Connection Limits and Resource Management

### Connection Throttling

```java
@Component
public class ConnectionThrottler {

    private final MeterRegistry meterRegistry;
    private final DistributedSessionManager sessionManager;

    private static final int MAX_CONNECTIONS_PER_INSTANCE = 10000;
    private static final int MAX_CONNECTIONS_PER_USER = 5;

    public ConnectionThrottler(MeterRegistry meterRegistry,
                               DistributedSessionManager sessionManager) {
        this.meterRegistry = meterRegistry;
        this.sessionManager = sessionManager;
    }

    public boolean allowConnection(String userId, String sessionId) {

        // Check instance capacity
        long currentConnections = sessionManager.getInstanceSessionCount();
        if (currentConnections >= MAX_CONNECTIONS_PER_INSTANCE) {
            log.warn("Instance at capacity: {} connections", currentConnections);
            meterRegistry.counter("ws.connections.rejected.instance.full").increment();
            return false;
        }

        // Check per-user limits
        long userConnections = getUserConnectionCount(userId);
        if (userConnections >= MAX_CONNECTIONS_PER_USER) {
            log.warn("User {} exceeded max connections: {}", userId, userConnections);
            meterRegistry.counter("ws.connections.rejected.user.limit").increment();
            return false;
        }

        meterRegistry.counter("ws.connections.allowed").increment();
        return true;
    }

    private long getUserConnectionCount(String userId) {
        // Query Redis for user's active sessions
        return 0; // Implement with Redis SET scan
    }
}
```

---

## Best Practices

1. **Use sticky sessions**: Route user to same instance for WebSocket connections
2. **Implement pub/sub backplane**: Use Redis or Kafka for cross-instance messaging
3. **Store session state externally**: Redis for session metadata
4. **Monitor per-instance connections**: Alert on uneven distribution
5. **Implement graceful shutdown**: Drain connections before instance removal
6. **Use connection throttling**: Prevent overload
7. **Set connection timeouts**: Close idle connections
8. **Implement reconnection with backoff**: Clients should reconnect
9. **Use health checks**: Load balancer health endpoints
10. **Consider dedicated WebSocket servers**: Separate from HTTP workload

```java
// Graceful shutdown handler
@Component
public class GracefulShutdownHandler {

    private final Map<String, WebSocketSession> sessions;

    @EventListener
    public void onShutdown(ContextClosedEvent event) {
        log.info("Starting graceful WebSocket shutdown...");

        // Notify all connected clients
        TextMessage shutdownMessage = new TextMessage("{\"type\":\"shutdown\",\"reason\":\"maintenance\"}");
        sessions.values().parallelStream().forEach(session -> {
            try {
                if (session.isOpen()) {
                    session.sendMessage(shutdownMessage);
                    session.close(CloseStatus.GOING_AWAY);
                }
            } catch (IOException e) {
                log.error("Error during shutdown notification", e);
            }
        });
    }
}
```

---

## Common Mistakes

### Mistake 1: No Sticky Session Configuration

```java
// WRONG: Load balancer distributes WebSocket connections randomly
// Client connects to instance A, then later requests go to instance B

// CORRECT: Configure sticky sessions in load balancer
// Or use consistent hashing based on user ID
```

### Mistake 2: Broadcasting Without Pub/Sub

```java
// WRONG: Only broadcasting to local sessions
public void broadcast(String message) {
    localSessions.values().forEach(s -> send(s, message));
    // Other instances don't receive the broadcast
}

// CORRECT: Publish to Redis for all instances
public void broadcast(String message) {
    localSessions.values().forEach(s -> send(s, message));
    redisTemplate.convertAndSend("ws:broadcast", message);
}
```

### Mistake 3: Not Handling Instance Failure

```java
// WRONG: No recovery mechanism when instance goes down
// All WebSocket connections on that instance are lost

// CORRECT: Implement reconnection from client side
// Use heartbeat to detect disconnection
// Store session state in Redis for recovery
```

---

## Summary

1. WebSockets are stateful connections tied to specific server instances
2. Sticky sessions route users to the same instance
3. Pub/sub backplane enables cross-instance message broadcasting
4. Redis Pub/Sub or Kafka connect distributed WebSocket servers
5. Store session metadata externally for monitoring and recovery
6. Implement connection throttling per instance and per user
7. Graceful shutdown drains connections before instance removal
8. Clients should implement reconnection with exponential backoff

---

## References

- [Scaling WebSocket Connections](https://aws.amazon.com/blogs/networking-and-content-delivery/scaling-websocket-connections-on-aws/)
- [Redis Pub/Sub Documentation](https://redis.io/docs/manual/pubsub/)
- [Spring WebSocket Scaling](https://docs.spring.io/spring-framework/reference/web/websocket/server.html)
- [NGINX WebSocket Load Balancing](https://nginx.org/en/docs/http/websocket.html)

Happy Coding
