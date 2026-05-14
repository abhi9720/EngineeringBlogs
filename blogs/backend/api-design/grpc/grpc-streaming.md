---
title: "gRPC Streaming"
description: "Master gRPC streaming patterns: server streaming, client streaming, bidirectional streaming, backpressure handling, and real-time data pipelines"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - grpc
  - streaming
  - real-time
  - protobuf
coverImage: "/images/backend/api-design/grpc/grpc-streaming.png"
draft: false
---

# gRPC Streaming

## Overview

gRPC supports four types of RPC calls: unary, server-streaming, client-streaming, and bidirectional streaming. Streaming enables efficient real-time data transfer, backpressure handling, and reactive communication patterns essential for modern distributed systems.

---

## Streaming Types

gRPC supports four RPC types that map to different communication patterns: unary (single request, single response), server streaming (single request, multiple responses), client streaming (multiple requests, single response), and bidirectional streaming (multiple requests, multiple responses). Streaming is a first-class concept in gRPC, not an afterthought — the protocol, transport, and code generation are all designed to support streaming efficiently.

### Protocol Definitions

The `.proto` file uses the `stream` keyword to declare streaming RPCs. `rpc SubscribeEvents(EventSubscription) returns (stream Event)` declares server streaming — the client sends one request and receives a stream of events. `rpc UploadMetrics(stream Metric) returns (UploadSummary)` declares client streaming — the client sends multiple metrics and receives a single summary. `rpc ProcessChatMessages(stream ChatMessage) returns (stream ChatResponse)` declares bidirectional streaming — both sides send multiple messages independently. The message definitions include metadata fields (like `sequence_number`, `checksum`, `timestamp`) that are important for reliable streaming in production.

```protobuf
syntax = "proto3";

package streaming.v1;

option java_package = "com.example.grpc.streaming.v1";

service EventStreaming {
  // Server streaming: client sends one request, server sends multiple responses
  rpc SubscribeEvents(EventSubscription) returns (stream Event);

  // Client streaming: client sends multiple requests, server sends one response
  rpc UploadMetrics(stream Metric) returns (UploadSummary);

  // Bidirectional streaming: both sides send multiple messages
  rpc ProcessChatMessages(stream ChatMessage) returns (stream ChatResponse);

  // Server streaming for large datasets
  rpc ExportData(DataRequest) returns (stream DataChunk);
}

message EventSubscription {
  repeated string event_types = 1;
  string user_id = 2;
  google.protobuf.Duration timeout = 3;
}

message Event {
  string id = 1;
  string type = 2;
  bytes payload = 3;
  google.protobuf.Timestamp timestamp = 4;
  map<string, string> metadata = 5;
}

message Metric {
  string name = 1;
  double value = 2;
  map<string, string> tags = 3;
  google.protobuf.Timestamp timestamp = 4;
}

message UploadSummary {
  int32 total_metrics = 1;
  int32 failed_metrics = 2;
  int64 data_size_bytes = 3;
  double processing_time_ms = 4;
}

message ChatMessage {
  string room_id = 1;
  string user_id = 2;
  string content = 3;
  MessageType type = 4;
}

enum MessageType {
  MESSAGE_TYPE_TEXT = 0;
  MESSAGE_TYPE_IMAGE = 1;
  MESSAGE_TYPE_FILE = 2;
  MESSAGE_TYPE_SYSTEM = 3;
}

message ChatResponse {
  string message_id = 1;
  string room_id = 2;
  string user_id = 3;
  string content = 4;
  google.protobuf.Timestamp timestamp = 5;
  DeliveryStatus status = 6;
}

enum DeliveryStatus {
  DELIVERY_STATUS_SENT = 0;
  DELIVERY_STATUS_DELIVERED = 1;
  DELIVERY_STATUS_READ = 2;
}

message DataRequest {
  string entity_type = 1;
  string format = 2;
  int32 chunk_size_bytes = 3;
}

message DataChunk {
  int64 sequence_number = 1;
  bytes data = 2;
  int64 total_size = 3;
  bool is_last = 4;
  string checksum = 5;
}
```

---

## Server Streaming

Server streaming is the most commonly used streaming pattern in gRPC. The client sends a single request and receives a stream of responses. This is ideal for use cases like real-time event subscriptions, large data exports, and progress reporting. The server pushes multiple messages through the same `StreamObserver`, calling `onNext()` for each message and `onCompleted()` when done. Server streaming leverages HTTP/2's multiplexing — multiple streams can share the same connection without head-of-line blocking.

### Implementation

The `EventStreamingService` demonstrates server streaming for two use cases: real-time event subscription and data export. For event subscription, the service registers with an event bus and pushes events to the client as they arrive, handling client cancellation via `setOnCancelHandler`. For data export, the service reads data in chunks from an input stream, builds `DataChunk` messages, and sends them sequentially with progress metadata. Both patterns require careful resource management — the subscription must be disposed when the client disconnects, and the export must check for cancellation between chunks.

```java
@GrpcService
public class EventStreamingService extends EventStreamingGrpc.EventStreamingImplBase {

    private final EventBus eventBus;
    private final EventMapper eventMapper;

    @Override
    public void subscribeEvents(EventSubscription request,
                                StreamObserver<Event> responseObserver) {
        String userId = request.getUserId();
        Set<String> subscribedTypes = Set.copyOf(request.getEventTypesList());

        // Register listener with backpressure support
        Flowable<EventEntity> eventFlow = eventBus.subscribe(userId, subscribedTypes);

        Disposable subscription = eventFlow
            .map(eventMapper::toProto)
            .subscribe(
                event -> {
                    try {
                        responseObserver.onNext(event);
                    } catch (Exception e) {
                        log.error("Error sending event to client", e);
                        subscription.dispose();
                        responseObserver.onError(e);
                    }
                },
                error -> {
                    log.error("Event stream error", error);
                    responseObserver.onError(error);
                },
                () -> {
                    log.info("Event stream completed for user: {}", userId);
                    responseObserver.onCompleted();
                }
            );

        // Handle client cancellation
        responseObserver.setOnCancelHandler(subscription::dispose);
    }

    @Override
    public void exportData(DataRequest request,
                           StreamObserver<DataChunk> responseObserver) {
        try {
            InputStream dataStream = dataExportService.export(
                request.getEntityType(), request.getFormat());

            byte[] buffer = new byte[request.getChunkSizeBytes() > 0
                ? request.getChunkSizeBytes() : 8192];
            int bytesRead;
            long totalBytes = 0;
            int sequence = 0;

            while ((bytesRead = dataStream.read(buffer)) != -1) {
                DataChunk chunk = DataChunk.newBuilder()
                    .setSequenceNumber(sequence++)
                    .setData(ByteString.copyFrom(buffer, 0, bytesRead))
                    .setTotalSize(dataStream.available() + totalBytes)
                    .setIsLast(false)
                    .build();

                responseObserver.onNext(chunk);
                totalBytes += bytesRead;

                // Simulate backpressure by checking if client is still connected
                if (Thread.currentThread().isInterrupted()) {
                    responseObserver.onError(
                        Status.CANCELLED.withDescription("Export cancelled")
                            .asRuntimeException());
                    return;
                }
            }

            // Send final chunk
            responseObserver.onNext(DataChunk.newBuilder()
                .setSequenceNumber(sequence)
                .setIsLast(true)
                .setTotalSize(totalBytes)
                .build());

            responseObserver.onCompleted();

        } catch (Exception e) {
            log.error("Data export failed", e);
            responseObserver.onError(
                Status.INTERNAL.withDescription("Export failed").asRuntimeException());
        }
    }
}
```

---

## Client Streaming

Client streaming allows the client to send multiple messages and receive a single aggregated response. This pattern is ideal for batch uploads, data ingestion pipelines, and bulk operations where the client needs to send many items and receive a summary. The server returns a `StreamObserver` that the client uses to send messages, and the server aggregates them until the client signals completion by calling `onCompleted()`.

### Implementation

The `MetricIngestionService` handles client streaming for metric uploads. The `uploadMetrics` method returns a custom `StreamObserver` that accumulates received metrics, tracks failures, and measures processing time. Each incoming metric is validated and stored; invalid metrics are counted but not stored. When the client completes the stream, the service sends back an `UploadSummary` with total metrics, failures, data size, and processing time. This pattern gives clients immediate feedback on the batch's success and enables partial-failure handling — even if some metrics fail, the summary includes the failure count and successful metrics are still stored.

```java
@GrpcService
public class MetricIngestionService extends EventStreamingGrpc.EventStreamingImplBase {

    private final MetricService metricService;

    @Override
    public StreamObserver<Metric> uploadMetrics(
            StreamObserver<UploadSummary> responseObserver) {

        return new StreamObserver<>() {
            private final List<Metric> receivedMetrics = new ArrayList<>();
            private int failureCount = 0;
            private long dataSize = 0;
            private final long startTime = System.currentTimeMillis();

            @Override
            public void onNext(Metric metric) {
                try {
                    // Validate and store metric
                    if (isValidMetric(metric)) {
                        metricService.store(metric);
                        receivedMetrics.add(metric);
                        dataSize += metric.getSerializedSize();
                    } else {
                        failureCount++;
                        log.warn("Invalid metric received: {}", metric.getName());
                    }
                } catch (Exception e) {
                    failureCount++;
                    log.error("Error processing metric: {}", metric.getName(), e);
                }
            }

            @Override
            public void onError(Throwable t) {
                log.error("Metric upload stream error", t);
                // Send partial summary
                sendSummary();
            }

            @Override
            public void onCompleted() {
                sendSummary();
            }

            private void sendSummary() {
                UploadSummary summary = UploadSummary.newBuilder()
                    .setTotalMetrics(receivedMetrics.size() + failureCount)
                    .setFailedMetrics(failureCount)
                    .setDataSizeBytes(dataSize)
                    .setProcessingTimeMs(System.currentTimeMillis() - startTime)
                    .build();

                responseObserver.onNext(summary);
                responseObserver.onCompleted();
            }
        };
    }

    private boolean isValidMetric(Metric metric) {
        return metric.getName() != null && !metric.getName().isEmpty()
            && metric.hasTimestamp();
    }
}
```

---

## Bidirectional Streaming

Bidirectional streaming is the most powerful and complex gRPC streaming pattern. Both client and server send independent streams of messages, enabling true real-time interactive communication. This pattern is ideal for chat applications, collaborative editing, real-time gaming, and any scenario where both peers need to send messages asynchronously. The two streams are independent — the server can respond to messages in any order and at any time.

### Chat Service Implementation

The `ChatService` implements bidirectional streaming for a real-time chat application. It returns a `StreamObserver` for receiving client messages while using the `responseObserver` to send messages back to the client. The handler processes different message types (text, image, file, system), persists messages, broadcasts to room subscribers, and sends acknowledgments back to the sender. The `ChatRoomManager` manages room membership — clients join rooms, receive broadcasts from other members, and are cleaned up on disconnection. This implementation demonstrates the key pattern for bidirectional streaming: the server-side `StreamObserver` receives client messages, while the stored response observer handles server-to-client messages.

```java
@GrpcService
public class ChatService extends EventStreamingGrpc.EventStreamingImplBase {

    private final ChatRoomManager chatRoomManager;
    private final MessagePersistence messagePersistence;

    @Override
    public StreamObserver<ChatMessage> processChatMessages(
            StreamObserver<ChatResponse> responseObserver) {

        return new StreamObserver<>() {
            private String roomId;
            private String userId;
            private boolean joined = false;

            @Override
            public void onNext(ChatMessage message) {
                this.roomId = message.getRoomId();
                this.userId = message.getUserId();

                switch (message.getType()) {
                    case MESSAGE_TYPE_SYSTEM -> handleSystemMessage(message);
                    case MESSAGE_TYPE_TEXT -> handleTextMessage(message);
                    case MESSAGE_TYPE_IMAGE -> handleImageMessage(message);
                    case MESSAGE_TYPE_FILE -> handleFileMessage(message);
                }
            }

            private void handleTextMessage(ChatMessage message) {
                // Persist message
                MessageEntity entity = messagePersistence.save(
                    message.getRoomId(),
                    message.getUserId(),
                    message.getContent(),
                    MessageType.TEXT
                );

                // Broadcast to room subscribers
                ChatResponse response = ChatResponse.newBuilder()
                    .setMessageId(entity.getId().toString())
                    .setRoomId(roomId)
                    .setUserId(userId)
                    .setContent(message.getContent())
                    .setTimestamp(Timestamps.fromMillis(
                        entity.getCreatedAt().toInstant(ZoneOffset.UTC).toEpochMilli()))
                    .setStatus(DeliveryStatus.DELIVERY_STATUS_SENT)
                    .build();

                chatRoomManager.broadcast(roomId, response);

                // Acknowledge to sender
                responseObserver.onNext(response.toBuilder()
                    .setStatus(DeliveryStatus.DELIVERY_STATUS_DELIVERED)
                    .build());
            }

            private void handleSystemMessage(ChatMessage message) {
                if ("JOIN".equals(message.getContent())) {
                    joined = true;
                    chatRoomManager.join(roomId, userId, responseObserver);

                    ChatResponse response = ChatResponse.newBuilder()
                        .setRoomId(roomId)
                        .setUserId("SYSTEM")
                        .setContent(userId + " joined the room")
                        .setTimestamp(Timestamps.fromMillis(
                            System.currentTimeMillis()))
                        .setStatus(DeliveryStatus.DELIVERY_STATUS_SENT)
                        .build();

                    chatRoomManager.broadcast(roomId, response);
                }
            }

            @Override
            public void onError(Throwable t) {
                log.error("Chat stream error for user {} in room {}", userId, roomId, t);
                if (joined) {
                    chatRoomManager.leave(roomId, userId);
                }
            }

            @Override
            public void onCompleted() {
                log.info("Chat stream completed for user {} in room {}", userId, roomId);
                if (joined) {
                    chatRoomManager.leave(roomId, userId);
                    responseObserver.onCompleted();
                }
            }
        };
    }
}

@Component
public class ChatRoomManager {

    private final Map<String, Map<String, StreamObserver<ChatResponse>>> rooms
        = new ConcurrentHashMap<>();

    public void join(String roomId, String userId,
                     StreamObserver<ChatResponse> observer) {
        rooms.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>())
            .put(userId, observer);
    }

    public void leave(String roomId, String userId) {
        Map<String, StreamObserver<ChatResponse>> room = rooms.get(roomId);
        if (room != null) {
            room.remove(userId);
            if (room.isEmpty()) {
                rooms.remove(roomId);
            }
        }
    }

    public void broadcast(String roomId, ChatResponse message) {
        Map<String, StreamObserver<ChatResponse>> room = rooms.get(roomId);
        if (room != null) {
            room.values().forEach(observer -> {
                try {
                    observer.onNext(message);
                } catch (Exception e) {
                    log.error("Error broadcasting to room {}", roomId, e);
                }
            });
        }
    }
}
```

---

## Backpressure Handling

Backpressure is critical for streaming applications to prevent fast producers from overwhelming slow consumers. gRPC has built-in HTTP/2 flow control, but application-level backpressure is often needed for complex streaming scenarios. Without backpressure handling, a slow consumer causes memory growth on the producer as messages queue up, eventually leading to out-of-memory errors. Application-level strategies include dropping messages, buffering with limits, sampling, and flow control signaling.

### Flow Control Implementation

The `BackpressureManager` uses a semaphore to limit the number of outstanding messages. Before sending each message, the producer acquires a permit from the semaphore. If no permit is available within the timeout, the message is dropped (with a warning). The consumer releases permits as it processes messages, controlling the producer's rate. This backpressure strategy prevents unbounded memory growth while allowing the producer to continue working without blocking indefinitely. The `maxOutstandingRequests` parameter controls the trade-off between throughput and memory — higher values allow more concurrency but consume more memory.

```java
@Component
public class BackpressureManager {

    private final int maxOutstandingRequests;
    private final Semaphore backpressureSemaphore;

    public BackpressureManager(@Value("${grpc.backpressure.max-outstanding:100}") int max) {
        this.maxOutstandingRequests = max;
        this.backpressureSemaphore = new Semaphore(max);
    }

    public <T> StreamObserver<T> wrapWithBackpressure(
            StreamObserver<T> delegate) {

        return new StreamObserver<>() {
            @Override
            public void onNext(T value) {
                try {
                    if (!backpressureSemaphore.tryAcquire(1, TimeUnit.SECONDS)) {
                        log.warn("Backpressure threshold reached, dropping message");
                        return;
                    }

                    try {
                        delegate.onNext(value);
                    } finally {
                        backpressureSemaphore.release();
                    }

                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    delegate.onError(e);
                }
            }

            @Override
            public void onError(Throwable t) {
                delegate.onError(t);
            }

            @Override
            public void onCompleted() {
                delegate.onCompleted();
            }
        };
    }
}
```

---

## Best Practices

1. **Use server streaming for large datasets**: Export, batch processing
2. **Use client streaming for uploads**: Metrics, file uploads
3. **Use bidirectional streaming for real-time**: Chat, collaborative editing
4. **Always handle cancellation**: Clean up resources on client disconnect
5. **Implement backpressure**: Prevent server overload
6. **Use flow control**: Set appropriate max message sizes
7. **Consume messages in order**: Maintain sequence for ordered data
8. **Handle reconnection**: Implement retry with backoff
9. **Monitor stream metrics**: Track active streams, throughput
10. **Set timeouts on streaming**: Prevent resource leaks

```java
// Flow control configuration
@Configuration
public class GrpcFlowControlConfig {

    @Bean
    public Server grpcServer() {
        return ServerBuilder.forPort(9090)
            .maxInboundMessageSize(4 * 1024 * 1024) // 4MB
            .flowControlWindow(65535) // Default TCP window
            .keepAliveTime(30, TimeUnit.SECONDS)
            .keepAliveTimeout(10, TimeUnit.SECONDS)
            .permitKeepAliveTime(5, TimeUnit.SECONDS)
            .build();
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Handling Client Cancellation

```java
// WRONG: No cleanup on cancel
@Override
public void subscribeEvents(EventSubscription request,
                            StreamObserver<Event> response) {
    eventBus.subscribe(userId, types)
        .subscribe(response::onNext);  // Leaks when client disconnects
}

// CORRECT: Dispose on cancel
Disposable sub = eventBus.subscribe(userId, types)
    .subscribe(response::onNext);
response.setOnCancelHandler(sub::dispose);
```

### Mistake 2: Blocking in Streaming Calls

```java
// WRONG: Blocking in client stream handler
@Override
public StreamObserver<Metric> uploadMetrics(StreamObserver<UploadSummary> response) {
    return new StreamObserver<>() {
        @Override
        public void onNext(Metric metric) {
            Thread.sleep(100);  // Never block
            processMetric(metric);
        }
    };
}
```

### Mistake 3: Ignoring Order in Bidirectional Streaming

```java
// WRONG: Processing concurrent messages without ordering
// CORRECT: Use ordered processing per connection
Flux.from(stream)
    .concatMap(this::processMessage)  // Maintains order
    .subscribe(responseObserver::onNext);
```

---

## Summary

1. gRPC supports unary, server, client, and bidirectional streaming
2. Server streaming sends multiple responses from one request
3. Client streaming aggregates multiple requests into one response
4. Bidirectional streaming enables real-time interactive communication
5. Always handle backpressure, cancellation, and cleanup
6. Use reactive streams for efficient flow control
7. Monitor streaming metrics in production

---

## References

- [gRPC Streaming Tutorial](https://grpc.io/docs/languages/java/basics/#server-side-streaming)
- [gRPC Flow Control](https://grpc.io/docs/guides/flow-control/)
- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [gRPC Bidirectional Streaming Patterns](https://grpc.io/blog/grpc-streaming-patterns/)

Happy Coding