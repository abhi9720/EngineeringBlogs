---
title: "gRPC in Microservices"
description: "Implement gRPC for inter-service communication in microservices: protocol buffers, streaming, gRPC vs REST, Spring Boot integration, error handling, and performance optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - grpc
  - protobuf
  - microservices
  - inter-service-communication
coverImage: "/images/grpc-in-microservices.png"
draft: false
---

## Overview

gRPC is a high-performance RPC framework using Protocol Buffers and HTTP/2. It supports bidirectional streaming, strong typing, and efficient serialization, making it ideal for inter-service communication in microservices.

## Protocol Buffer Definition

The service definition in `.proto` files describes both the RPC methods and the data structures. The `stream` keyword enables server-side streaming (returning a list of orders), client-side streaming (receiving multiple events), and bidirectional streaming (real-time order processing). Each field has a unique numbered tag for binary encoding efficiency.

```protobuf
syntax = "proto3";

package com.example.orders;

import "google/protobuf/timestamp.proto";
import "google/protobuf/empty.proto";

option java_multiple_files = true;
option java_package = "com.example.orders.grpc";

service OrderService {
    rpc CreateOrder (CreateOrderRequest) returns (CreateOrderResponse);
    rpc GetOrder (GetOrderRequest) returns (Order);
    rpc ListOrders (ListOrdersRequest) returns (stream Order);
    rpc ProcessOrderStream (stream OrderEvent) returns (stream OrderStatus);
    rpc CancelOrder (CancelOrderRequest) returns (google.protobuf.Empty);
}

message Order {
    string id = 1;
    string customer_id = 2;
    repeated OrderItem items = 3;
    double total_amount = 4;
    string currency = 5;
    OrderStatus status = 6;
    google.protobuf.Timestamp created_at = 7;
    map<string, string> metadata = 8;
}

message OrderItem {
    string product_id = 1;
    string product_name = 2;
    int32 quantity = 3;
    double unit_price = 4;
    double discount = 5;
}

enum OrderStatus {
    PENDING = 0;
    CONFIRMED = 1;
    SHIPPED = 2;
    DELIVERED = 3;
    CANCELLED = 4;
}

message CreateOrderRequest {
    string customer_id = 1;
    repeated OrderItem items = 2;
    string currency = 3;
    map<string, string> metadata = 4;
}

message CreateOrderResponse {
    string order_id = 1;
    OrderStatus status = 2;
    string message = 3;
}

message GetOrderRequest {
    string id = 1;
}

message ListOrdersRequest {
    string customer_id = 1;
    int32 page_size = 2;
    string page_token = 3;
}

message CancelOrderRequest {
    string id = 1;
    string reason = 2;
}

message OrderEvent {
    string order_id = 1;
    string event_type = 2;
    string payload = 3;
    google.protobuf.Timestamp timestamp = 4;
}

message OrderStatus {
    string order_id = 1;
    string status = 2;
    string message = 3;
}
```

## Maven Configuration

The protobuf-maven-plugin compiles `.proto` files into Java classes during the build. The `os-maven-plugin` detects the OS architecture to select the correct protoc binary. The grpc-netty-shaded dependency bundles Netty with gRPC, avoiding version conflicts with other Netty usages in the project.

```xml
<build>
    <extensions>
        <extension>
            <groupId>kr.motd.maven</groupId>
            <artifactId>os-maven-plugin</artifactId>
            <version>1.7.1</version>
        </extension>
    </extensions>
    <plugins>
        <plugin>
            <groupId>org.xolstice.maven.plugins</groupId>
            <artifactId>protobuf-maven-plugin</artifactId>
            <version>0.6.1</version>
            <configuration>
                <protocArtifact>
                    com.google.protobuf:protoc:3.24.0:exe:${os.detected.classifier}
                </protocArtifact>
                <pluginId>grpc-java</pluginId>
                <pluginArtifact>
                    io.grpc:protoc-gen-grpc-java:1.58.0:exe:${os.detected.classifier}
                </pluginArtifact>
            </configuration>
            <executions>
                <execution>
                    <goals>
                        <goal>compile</goal>
                        <goal>compile-custom</goal>
                    </goals>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>

<dependencies>
    <dependency>
        <groupId>io.grpc</groupId>
        <artifactId>grpc-netty-shaded</artifactId>
        <version>1.58.0</version>
    </dependency>
    <dependency>
        <groupId>io.grpc</groupId>
        <artifactId>grpc-protobuf</artifactId>
        <version>1.58.0</version>
    </dependency>
    <dependency>
        <groupId>io.grpc</groupId>
        <artifactId>grpc-stub</artifactId>
        <version>1.58.0</version>
    </dependency>
    <dependency>
        <groupId>net.devh</groupId>
        <artifactId>grpc-server-spring-boot-starter</artifactId>
        <version>2.15.0.RELEASE</version>
    </dependency>
    <dependency>
        <groupId>net.devh</groupId>
        <artifactId>grpc-client-spring-boot-starter</artifactId>
        <version>2.15.0.RELEASE</version>
    </dependency>
</dependencies>
```

## gRPC Server Implementation

The server extends the generated base class and implements each RPC method. Every unary method receives a request and a `StreamObserver` for sending the response — calling `onNext` followed by `onCompleted` signals successful completion. Errors are propagated through `onError` with gRPC status codes (INTERNAL, NOT_FOUND, etc.) for structured error handling.

```java
@GrpcService
public class OrderGrpcService extends OrderServiceGrpc.OrderServiceImplBase {

    @Autowired
    private OrderRepository orderRepository;

    @Override
    public void createOrder(CreateOrderRequest request,
                             StreamObserver<CreateOrderResponse> responseObserver) {
        try {
            OrderEntity order = new OrderEntity();
            order.setCustomerId(request.getCustomerId());
            order.setCurrency(request.getCurrency());
            order.setStatus(OrderEntity.Status.PENDING);
            order.setMetadata(request.getMetadataMap());
            order.setCreatedAt(Instant.now());

            List<OrderItem> items = request.getItemsList().stream()
                .map(item -> new OrderItem(item.getProductId(),
                    item.getProductName(), item.getQuantity(),
                    BigDecimal.valueOf(item.getUnitPrice()),
                    BigDecimal.valueOf(item.getDiscount())))
                .collect(Collectors.toList());

            order.setItems(items);
            order.setTotalAmount(calculateTotal(items));
            order = orderRepository.save(order);

            CreateOrderResponse response = CreateOrderResponse.newBuilder()
                .setOrderId(order.getId())
                .setStatus(OrderStatus.CONFIRMED)
                .setMessage("Order created successfully")
                .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (Exception e) {
            responseObserver.onError(
                Status.INTERNAL
                    .withDescription("Failed to create order: " + e.getMessage())
                    .asRuntimeException()
            );
        }
    }

    @Override
    public void getOrder(GetOrderRequest request,
                          StreamObserver<Order> responseObserver) {
        OrderEntity entity = orderRepository.findById(request.getId())
            .orElseThrow(() -> Status.NOT_FOUND
                .withDescription("Order not found: " + request.getId())
                .asRuntimeException());

        responseObserver.onNext(toProto(entity));
        responseObserver.onCompleted();
    }

    @Override
    public void listOrders(ListOrdersRequest request,
                            StreamObserver<Order> responseObserver) {
        Pageable pageable = PageRequest.of(
            Integer.parseInt(request.getPageToken()),
            request.getPageSize()
        );

        Page<OrderEntity> orders = orderRepository
            .findByCustomerId(request.getCustomerId(), pageable);

        orders.getContent().forEach(entity -> {
            responseObserver.onNext(toProto(entity));
        });

        responseObserver.onCompleted();
    }

    @Override
    public StreamObserver<OrderEvent> processOrderStream(
            StreamObserver<OrderStatus> responseObserver) {
        return new StreamObserver<OrderEvent>() {
            @Override
            public void onNext(OrderEvent event) {
                try {
                    OrderEntity order = orderRepository.findById(event.getOrderId())
                        .orElseThrow(() -> new RuntimeException("Order not found"));

                    switch (event.getEventType()) {
                        case "SHIP" -> order.setStatus(OrderEntity.Status.SHIPPED);
                        case "DELIVER" -> order.setStatus(OrderEntity.Status.DELIVERED);
                        case "CANCEL" -> order.setStatus(OrderEntity.Status.CANCELLED);
                    }

                    orderRepository.save(order);

                    OrderStatus status = OrderStatus.newBuilder()
                        .setOrderId(order.getId())
                        .setStatus(order.getStatus().name())
                        .setMessage("Event processed: " + event.getEventType())
                        .build();

                    responseObserver.onNext(status);
                } catch (Exception e) {
                    responseObserver.onError(e);
                }
            }

            @Override
            public void onError(Throwable t) {
                log.error("Stream error", t);
            }

            @Override
            public void onCompleted() {
                responseObserver.onCompleted();
            }
        };
    }

    private Order toProto(OrderEntity entity) {
        return Order.newBuilder()
            .setId(entity.getId())
            .setCustomerId(entity.getCustomerId())
            .addAllItems(entity.getItems().stream()
                .map(this::toProtoItem)
                .collect(Collectors.toList()))
            .setTotalAmount(entity.getTotalAmount().doubleValue())
            .setCurrency(entity.getCurrency())
            .setStatus(OrderStatus.valueOf(entity.getStatus().name()))
            .setCreatedAt(Timestamps.fromMillis(
                entity.getCreatedAt().toEpochMilli()))
            .putAllMetadata(entity.getMetadata())
            .build();
    }

    private OrderItem toProtoItem(com.example.domain.OrderItem item) {
        return OrderItem.newBuilder()
            .setProductId(item.getProductId())
            .setProductName(item.getProductName())
            .setQuantity(item.getQuantity())
            .setUnitPrice(item.getUnitPrice().doubleValue())
            .setDiscount(item.getDiscount().doubleValue())
            .build();
    }
}
```

## gRPC Client

The client uses either a blocking stub (simple synchronous calls) or an async stub (reactive/streaming). Setting deadlines (`withDeadlineAfter`) is critical — without them, a hung gRPC call can exhaust resources indefinitely. The `Flux.create` pattern bridges the streaming gRPC observer into a reactive `Flux` for seamless integration with WebFlux pipelines.

```java
@Service
public class OrderGrpcClient {

    @GrpcClient("order-service")
    private OrderServiceGrpc.OrderServiceBlockingStub blockingStub;

    @GrpcClient("order-service")
    private OrderServiceGrpc.OrderServiceStub asyncStub;

    public CreateOrderResponse createOrder(CreateOrderRequest request) {
        try {
            return blockingStub.withDeadlineAfter(5, TimeUnit.SECONDS)
                .createOrder(request);
        } catch (StatusRuntimeException e) {
            Status status = e.getStatus();
            switch (status.getCode()) {
                case DEADLINE_EXCEEDED -> throw new TimeoutException("Order service timeout");
                case UNAVAILABLE -> throw new ServiceUnavailableException("Order service unavailable");
                case NOT_FOUND -> throw new OrderNotFoundException(request.getOrderId());
                default -> throw new OrderServiceException(status.getDescription());
            }
        }
    }

    public Flux<Order> listOrdersReactive(String customerId) {
        return Flux.create(emitter -> {
            ListOrdersRequest request = ListOrdersRequest.newBuilder()
                .setCustomerId(customerId)
                .setPageSize(50)
                .setPageToken("0")
                .build();

            asyncStub.withDeadlineAfter(10, TimeUnit.SECONDS)
                .listOrders(request, new StreamObserver<Order>() {
                    @Override
                    public void onNext(Order order) {
                        emitter.next(order);
                    }

                    @Override
                    public void onError(Throwable t) {
                        emitter.error(t);
                    }

                    @Override
                    public void onCompleted() {
                        emitter.complete();
                    }
                });
        });
    }

    public Flux<OrderStatus> processOrderEvents(Flux<OrderEvent> events) {
        return Flux.create(emitter -> {
            StreamObserver<OrderStatus> responseObserver = new StreamObserver<>() {
                @Override
                public void onNext(OrderStatus status) {
                    emitter.next(status);
                }

                @Override
                public void onError(Throwable t) {
                    emitter.error(t);
                }

                @Override
                public void onCompleted() {
                    emitter.complete();
                }
            };

            StreamObserver<OrderEvent> requestObserver =
                asyncStub.processOrderStream(responseObserver);

            events.subscribe(
                requestObserver::onNext,
                requestObserver::onError,
                requestObserver::onCompleted
            );
        });
    }
}
```

## Error Handling Interceptor

Interceptors provide cross-cutting functionality for all gRPC calls. The server interceptor captures errors and attaches metadata (error details) before closing the call. This pattern is also used for authentication, logging, metrics collection, and request validation — all without modifying the service implementation.

```java
@Component
public class GrpcErrorHandlingInterceptor implements ServerInterceptor {

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {
        return new ForwardingServerCallListener.SimpleForwardingServerCallListener<>(
            next.startCall(new ForwardingServerCall.SimpleForwardingServerCall<>(call) {
                @Override
                public void close(Status status, Metadata trailers) {
                    if (status.isOk()) {
                        super.close(status, trailers);
                    } else {
                        log.error("gRPC error: {} - {}", status.getCode(),
                            status.getDescription());
                        trailers.put(
                            Metadata.Key.of("error-details",
                                Metadata.ASCII_STRING_MARSHALLER),
                            status.getDescription()
                        );
                        super.close(status, trailers);
                    }
                }
            }, headers)
        );
    }
}
```

## Best Practices

- Use gRPC for internal service-to-service communication where performance matters. Protocol Buffers' binary serialization is 3-10x faster than JSON.
- Define all protobuf schemas in a shared library module consumed by both provider and consumer teams.
- Set deadlines on all gRPC calls to prevent resource exhaustion.
- Use bidirectional streaming for real-time data processing.
- Enable gRPC health checking for Kubernetes liveness probes.
- Configure TLS for production gRPC connections.

## Common Mistakes

### Mistake: Not setting deadlines on gRPC calls

```java
// Wrong - no deadline, may hang indefinitely
Order order = blockingStub.getOrder(request);
```

```java
// Correct - deadline prevents indefinite wait
Order order = blockingStub.withDeadlineAfter(5, TimeUnit.SECONDS)
    .getOrder(request);
```

### Mistake: Large protobuf messages without streaming

```java
// Wrong - sending large payloads in unary RPC
rpc UploadLargeFile(FileRequest) returns (FileResponse);
```

```java
// Correct - streaming for large payloads
rpc UploadLargeFile(stream FileChunk) returns (FileResponse);
```

## Summary

gRPC provides high-performance inter-service communication with strong typing, streaming support, and efficient serialization. It's ideal for internal microservice communication where performance and type safety are critical. Use with proper deadline configuration, error handling, and TLS for production deployments.

## References

- [gRPC Documentation](https://grpc.io/docs/)
- [gRPC Java Documentation](https://grpc.io/docs/languages/java/)
- [Spring Boot gRPC Starter](https://github.com/yidongnan/grpc-spring-boot-starter)

Happy Coding