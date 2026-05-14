---
title: "Redis Pub/Sub"
description: "Implement publish-subscribe patterns with Redis: channels, message distribution, and real-time event streaming"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - caching
  - redis
  - pub-sub
  - messaging
coverImage: "/images/redis-pub-sub.png"
draft: false
---

# Redis Pub/Sub

## Overview

Redis Pub/Sub provides a lightweight messaging pattern where publishers send messages to channels and subscribers receive messages from channels. Unlike message queues, Redis Pub/Sub does not persist messages—if a subscriber is offline, it misses the message.

### Use Cases

- Real-time notifications
- Live event streaming
- Cache invalidation across instances
- Chat applications
- Broadcast messages

---

## Basic Pub/Sub Pattern

### Publisher

```java
@Service
public class RedisPublisher {

    private final RedisTemplate<String, String> redisTemplate;

    public RedisPublisher(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void publish(String channel, String message) {
        redisTemplate.convertAndSend(channel, message);
        log.info("Published to '{}': {}", channel, message);
    }

    public void publishOrderEvent(OrderEvent event) {
        String channel = "orders:" + event.getStatus().toLowerCase();
        String message = JsonUtils.toJson(event);
        redisTemplate.convertAndSend(channel, message);
    }

    public void publishNotification(Long userId, String notification) {
        redisTemplate.convertAndSend(
            "notifications:user:" + userId,
            notification
        );
    }
}
```

### Subscriber

```java
@Component
public class RedisSubscriber extends MessageListenerAdapter {

    private static final Logger log = LoggerFactory.getLogger(RedisSubscriber.class);

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel());
        String body = new String(message.getBody());

        log.info("Received from channel '{}': {}", channel, body);

        switch (channel) {
            case "orders:created" -> handleOrderCreated(body);
            case "orders:shipped" -> handleOrderShipped(body);
            case "orders:cancelled" -> handleOrderCancelled(body);
            case "notifications:*" -> handleNotification(channel, body);
            default -> log.warn("Unknown channel: {}", channel);
        }
    }

    private void handleOrderCreated(String message) {
        OrderEvent event = JsonUtils.fromJson(message, OrderEvent.class);
        // Send confirmation email
        // Update inventory
        // Notify shipping service
    }

    private void handleNotification(String channel, String message) {
        String userId = channel.split(":")[2];
        log.info("Notification for user {}: {}", userId, message);
        // Send push notification
        // Store in user's notification inbox
    }
}
```

### Configuration

```java
@Configuration
public class RedisPubSubConfig {

    @Bean
    public MessageListenerAdapter messageListener(RedisSubscriber subscriber) {
        return new MessageListenerAdapter(subscriber);
    }

    @Bean
    public RedisMessageListenerContainer redisContainer(
            RedisConnectionFactory connectionFactory,
            MessageListenerAdapter listener) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        // Subscribe to specific channels
        container.addMessageListener(listener,
            new PatternTopic("orders:*"));

        // Subscribe to user-specific channels with wildcard
        container.addMessageListener(listener,
            new PatternTopic("notifications:user:*"));

        // Subscribe to a specific channel
        container.addMessageListener(listener,
            new ChannelTopic("system:alerts"));

        return container;
    }
}
```

---

## Pattern Matching Subscriptions

### Topic Patterns

```java
@Configuration
public class PatternSubscriptionConfig {

    @Bean
    public RedisMessageListenerContainer patternContainer(
            RedisConnectionFactory connectionFactory) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        // Pattern subscriptions
        // h?llo subscribes to hello, hallo, hxllo
        // h*llo subscribes to hllo, heeeello
        // h[ae]llo subscribes to hallo, hello

        container.addMessageListener(
            patternListener,
            Arrays.asList(
                new PatternTopic("orders.*"),
                new PatternTopic("inventory:*.updated"),
                new PatternTopic("user:*:activity"),
                new PatternTopic("system.#") // Multi-level wildcard
            )
        );

        return container;
    }
}
```

---

## Spring Event Integration

### Event-Driven Pub/Sub

```java
@Component
public class EventDrivenPubSub {

    private final RedisTemplate<String, Object> redisTemplate;
    private final ApplicationEventPublisher eventPublisher;

    @EventListener
    public void onDomainEvent(DomainEvent event) {
        // Publish to Redis when a domain event occurs
        String channel = "domain:" + event.getType().toLowerCase();
        redisTemplate.convertAndSend(channel, event.toJson());
    }

    // Listen to Redis messages and re-publish as Spring events
    @Component
    public static class RedisEventBridge {

        private final ApplicationEventPublisher publisher;

        public RedisEventBridge(ApplicationEventPublisher publisher) {
            this.publisher = publisher;
        }

        @KafkaListener(topics = "redis:events")
        public void onRedisMessage(String message) {
            RedisEvent event = JsonUtils.fromJson(message, RedisEvent.class);
            publisher.publishEvent(event);
        }
    }
}
```

---

## Multi-Instance Cache Invalidation

### Cache Event Publisher

```java
@Service
public class CacheInvalidationPublisher {

    private final RedisTemplate<String, String> redisTemplate;

    public void invalidateCache(String cacheName, Object key) {
        String message = JsonUtils.toJson(Map.of(
            "cache", cacheName,
            "key", key.toString(),
            "timestamp", Instant.now().toString(),
            "instance", HostUtil.getHostName()
        ));

        redisTemplate.convertAndSend("cache:invalidation", message);
    }

    public void invalidateAll(String cacheName) {
        String message = JsonUtils.toJson(Map.of(
            "cache", cacheName,
            "key", "*",
            "action", "clear"
        ));
        redisTemplate.convertAndSend("cache:invalidation", message);
    }
}

@Component
public class CacheInvalidationSubscriber {

    private final CacheManager cacheManager;

    public void onMessage(String message) {
        Map<String, String> data = JsonUtils.fromJson(message, Map.class);

        String cacheName = data.get("cache");
        String key = data.get("key");

        Cache cache = cacheManager.getCache(cacheName);
        if (cache != null) {
            if ("*".equals(key)) {
                cache.clear();
                log.info("Cleared cache: {}", cacheName);
            } else {
                cache.evict(key);
                log.info("Evicted key '{}' from cache '{}'", key, cacheName);
            }
        }
    }
}
```

---

## Realtime Notifications

### WebSocket Bridge

```java
@Component
public class RedisWebSocketBridge {

    private final RedisTemplate<String, String> redisTemplate;
    private final SimpMessagingTemplate messagingTemplate;

    @EventListener
    public void handleRedisMessage(RedisMessageEvent event) {
        String channel = event.getChannel();
        String message = event.getMessage();

        // Route to WebSocket clients
        if (channel.startsWith("notifications:user:")) {
            String userId = channel.split(":")[2];
            messagingTemplate.convertAndSendToUser(
                userId, "/queue/notifications", message
            );
        } else if (channel.equals("system:alerts")) {
            messagingTemplate.convertAndSend(
                "/topic/alerts", message
            );
        }
    }
}
```

### Client-Side Subscription

```javascript
// JavaScript WebSocket client
const socket = new SockJS('/ws');
const stompClient = Stomp.over(socket);

stompClient.connect({}, function(frame) {
    // Subscribe to user notifications
    stompClient.subscribe('/user/queue/notifications',
        function(message) {
            showNotification(JSON.parse(message.body));
        }
    );

    // Subscribe to system alerts
    stompClient.subscribe('/topic/alerts',
        function(message) {
            showAlert(JSON.parse(message.body));
        }
    );
});
```

---

## Best Practices

### 1. Handle Subscriber Failures

```java
// Pub/Sub has no message persistence
// Subscribers must handle disconnection and reconnection

@Configuration
public class ResilientSubscriptionConfig {

    @Bean
    public RedisMessageListenerContainer container(
            RedisConnectionFactory connectionFactory) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        // Auto-restart on connection loss
        container.setAutoStartup(true);
        container.setRecoveryInterval(5000L);

        // Error handler
        container.setErrorHandler(e ->
            log.error("Redis subscription error", e));

        return container;
    }
}
```

### 2. Use Redis Streams for Reliable Messaging

```java
// If message delivery guarantee is needed, use Redis Streams
// Pub/Sub is fire-and-forget
// Streams persist messages and support consumer groups

// Choose based on requirements:
// Pub/Sub: Real-time, loss-tolerant, simple
// Streams: Durable, consumer groups, replayable
```

### 3. Limit Channel Namespace

```java
public class ChannelNames {
    // Organized hierarchy
    public static final String ORDER_CREATED = "order:created";
    public static final String ORDER_SHIPPED = "order:shipped";
    public static final String INVENTORY_UPDATED = "inventory:updated";
    public static final String USER_NOTIFICATION = "notification:user:";
    public static final String CACHE_INVALIDATION = "cache:invalidation";
}
```

---

## Common Mistakes

### Mistake 1: Assuming Message Persistence

```java
// WRONG: Expecting offline subscriber to receive messages
// Publisher sends
redisTemplate.convertAndSend("orders", "message");

// Subscriber connects later
// Message is lost - Pub/Sub has no persistence

// CORRECT: Use Redis Streams or message queue for durable delivery
```

### Mistake 2: Subscribing in a Short-Lived Thread

```java
// WRONG: Subscription in request thread
@GetMapping("/subscribe")
public void subscribe() {
    RedisConnection conn = factory.getConnection();
    conn.subscribe(listener, "channel".getBytes());
    // Thread exits, connection closed, subscription lost
}

// CORRECT: Use RedisMessageListenerContainer for lifecycle management
```

### Mistake 3: Publishing Large Messages

```java
// WRONG: Publishing large JSON payloads
redisTemplate.convertAndSend("channel", hugeJsonString);
// Large messages block Redis for other operations

// CORRECT: Publish reference, store data elsewhere
String messageId = UUID.randomUUID().toString();
redisTemplate.opsForValue().set("msg:" + messageId, largeData,
    Duration.ofMinutes(5));
redisTemplate.convertAndSend("channel", messageId);
```

---

## Summary

Redis Pub/Sub enables simple, fast real-time messaging:

1. Publishers send messages to channels
2. Subscribers receive messages from channels they subscribe to
3. Pattern subscriptions enable flexible topic matching
4. Cache invalidation across instances uses Pub/Sub
5. WebSocket integration bridges Redis to browsers
6. Pub/Sub is fire-and-forget—no message persistence
7. Use Redis Streams when durability is required

---

## References

- [Redis Pub/Sub Documentation](https://redis.io/docs/manual/pubsub/)
- [Spring Data Redis Pub/Sub](https://docs.spring.io/spring-data/data-redis/docs/current/reference/html/#pubsub)
- [Redis Streams vs Pub/Sub](https://redis.io/docs/data-types/streams/)

Happy Coding