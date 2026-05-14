---
title: "gRPC Introduction"
description: "Master gRPC concepts: Protocol Buffers, service definitions, server/client implementation in Java, streaming, and production deployment"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - grpc
  - protobuf
  - rpc
  - api-design
coverImage: "/images/backend/api-design/grpc/grpc-introduction.png"
draft: false
---

# gRPC Introduction

## Overview

gRPC is a high-performance, language-agnostic RPC framework developed by Google. It uses Protocol Buffers for serialization, HTTP/2 for transport, and supports bidirectional streaming. gRPC is ideal for microservices communication, real-time streaming, and polyglot environments.

---

## Protocol Buffers

### Defining Services and Messages

```protobuf
syntax = "proto3";

package user.v1;

option java_package = "com.example.grpc.user.v1";
option java_multiple_files = true;

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc UpdateUser(UpdateUserRequest) returns (User);
  rpc DeleteUser(DeleteUserRequest) returns (DeleteUserResponse);
}

message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
  string phone = 4;
  UserRole role = 5;
  Address address = 6;
  repeated Order recent_orders = 7;
  google.protobuf.Timestamp created_at = 8;
  google.protobuf.Timestamp updated_at = 9;
}

message Address {
  string street = 1;
  string city = 2;
  string state = 3;
  string zip = 4;
  string country = 5;
}

enum UserRole {
  USER_ROLE_UNSPECIFIED = 0;
  USER_ROLE_ADMIN = 1;
  USER_ROLE_MANAGER = 2;
  USER_ROLE_CUSTOMER = 3;
}

message GetUserRequest {
  int64 id = 1;
}

message ListUsersRequest {
  int32 page = 1;
  int32 page_size = 2;
  string role_filter = 3;
}

message ListUsersResponse {
  repeated User users = 1;
  int32 total_count = 2;
  int32 current_page = 3;
  int32 total_pages = 4;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
  string phone = 3;
  UserRole role = 4;
  Address address = 5;
}

message UpdateUserRequest {
  int64 id = 1;
  string name = 2;
  string email = 3;
  string phone = 4;
}

message DeleteUserRequest {
  int64 id = 1;
}

message DeleteUserResponse {
  bool success = 1;
}
```

---

## Server Implementation

### gRPC Service Implementation

```java
@GrpcService
public class UserGrpcService extends UserServiceGrpc.UserServiceImplBase {

    private final UserService userService;
    private static final Logger log = LoggerFactory.getLogger(UserGrpcService.class);

    public UserGrpcService(UserService userService) {
        this.userService = userService;
    }

    @Override
    public void getUser(GetUserRequest request,
                        StreamObserver<User> responseObserver) {
        try {
            log.debug("Getting user with id: {}", request.getId());

            UserEntity entity = userService.findById(request.getId());

            User response = buildUserProto(entity);
            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (ResourceNotFoundException e) {
            responseObserver.onError(
                Status.NOT_FOUND
                    .withDescription("User not found: " + request.getId())
                    .asRuntimeException());
        } catch (Exception e) {
            log.error("Error getting user", e);
            responseObserver.onError(
                Status.INTERNAL
                    .withDescription("Internal server error")
                    .asRuntimeException());
        }
    }

    @Override
    public void listUsers(ListUsersRequest request,
                          StreamObserver<ListUsersResponse> responseObserver) {
        try {
            Page<UserEntity> userPage = userService.findAll(
                request.getPage(), request.getPageSize());

            List<User> users = userPage.getContent().stream()
                .map(this::buildUserProto)
                .toList();

            ListUsersResponse response = ListUsersResponse.newBuilder()
                .addAllUsers(users)
                .setTotalCount((int) userPage.getTotalElements())
                .setCurrentPage(userPage.getNumber())
                .setTotalPages(userPage.getTotalPages())
                .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (Exception e) {
            log.error("Error listing users", e);
            responseObserver.onError(e);
        }
    }

    @Override
    public void createUser(CreateUserRequest request,
                           StreamObserver<User> responseObserver) {
        try {
            CreateUserCommand command = new CreateUserCommand();
            command.setName(request.getName());
            command.setEmail(request.getEmail());
            command.setPhone(request.getPhone());
            command.setRole(mapRole(request.getRole()));

            if (request.hasAddress()) {
                command.setAddress(mapAddress(request.getAddress()));
            }

            UserEntity entity = userService.create(command);

            User response = buildUserProto(entity);
            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (ValidationException e) {
            responseObserver.onError(
                Status.INVALID_ARGUMENT
                    .withDescription(e.getMessage())
                    .asRuntimeException());
        }
    }

    private User buildUserProto(UserEntity entity) {
        User.Builder builder = User.newBuilder()
            .setId(entity.getId())
            .setName(entity.getName())
            .setEmail(entity.getEmail())
            .setRole(mapRole(entity.getRole()));

        if (entity.getPhone() != null) {
            builder.setPhone(entity.getPhone());
        }

        if (entity.getAddress() != null) {
            builder.setAddress(Address.newBuilder()
                .setStreet(entity.getAddress().getStreet())
                .setCity(entity.getAddress().getCity())
                .setState(entity.getAddress().getState())
                .setZip(entity.getAddress().getZip())
                .setCountry(entity.getAddress().getCountry())
                .build());
        }

        if (entity.getCreatedAt() != null) {
            builder.setCreatedAt(Timestamps.fromMillis(
                entity.getCreatedAt().toInstant(ZoneOffset.UTC).toEpochMilli()));
        }

        return builder.build();
    }
}
```

### gRPC Server Configuration

```java
@Configuration
public class GrpcServerConfig {

    @Bean
    public Server grpcServer(UserGrpcService userService,
                             OrderGrpcService orderService) throws IOException {

        return ServerBuilder.forPort(9090)
            .addService(userService)
            .addService(orderService)
            .intercept(new GrpcLoggingInterceptor())
            .intercept(new GrpcAuthInterceptor())
            .executor(Executors.newFixedThreadPool(10))
            .build()
            .start();
    }

    @Bean
    public GrpcServerManager grpcServerManager(Server grpcServer) {
        return new GrpcServerManager(grpcServer);
    }
}

@Component
public class GrpcServerManager {

    private final Server server;

    public GrpcServerManager(Server server) {
        this.server = server;
    }

    @PostConstruct
    public void start() throws IOException {
        log.info("gRPC server starting on port: {}", server.getPort());
        server.start();
        log.info("gRPC server started");
    }

    @PreDestroy
    public void stop() {
        log.info("gRPC server shutting down");
        server.shutdown();
    }
}
```

---

## Client Implementation

### gRPC Client

```java
@Component
public class UserGrpcClient {

    private final UserServiceGrpc.UserServiceBlockingStub blockingStub;
    private final UserServiceGrpc.UserServiceFutureStub futureStub;

    public UserGrpcClient() {
        ManagedChannel channel = ManagedChannelBuilder.forAddress("localhost", 9090)
            .usePlaintext()
            .keepAliveTime(30, TimeUnit.SECONDS)
            .keepAliveTimeout(10, TimeUnit.SECONDS)
            .maxRetryAttempts(3)
            .build();

        this.blockingStub = UserServiceGrpc.newBlockingStub(channel);
        this.futureStub = UserServiceGrpc.newFutureStub(channel);
    }

    public User getUser(Long id) {
        GetUserRequest request = GetUserRequest.newBuilder()
            .setId(id)
            .build();

        try {
            return blockingStub.getUser(request);
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() == Status.Code.NOT_FOUND) {
                throw new ResourceNotFoundException("User not found: " + id);
            }
            throw new GrpcClientException("gRPC call failed", e);
        }
    }

    public CompletableFuture<User> getUserAsync(Long id) {
        GetUserRequest request = GetUserRequest.newBuilder()
            .setId(id)
            .build();

        SettableFuture<User> future = SettableFuture.create();

        futureStub.getUser(request, new StreamObserver<User>() {
            @Override
            public void onNext(User user) {
                future.set(user);
            }

            @Override
            public void onError(Throwable t) {
                future.setException(t);
            }

            @Override
            public void onCompleted() {
                // Already handled in onNext
            }
        });

        return future;
    }

    public List<User> listUsers(int page, int pageSize) {
        ListUsersRequest request = ListUsersRequest.newBuilder()
            .setPage(page)
            .setPageSize(pageSize)
            .build();

        ListUsersResponse response = blockingStub.listUsers(request);
        return response.getUsersList();
    }
}
```

---

## Interceptors

### Client and Server Interceptors

```java
@Component
public class GrpcLoggingInterceptor implements ServerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(GrpcLoggingInterceptor.class);

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {

        String methodName = call.getMethodDescriptor().getFullMethodName();

        log.info("gRPC call started: {}", methodName);

        ServerCall<ReqT, RespT> wrappedCall = new ForwardingServerCall.SimpleForwardingServerCall<>(call) {
            @Override
            public void close(Status status, Metadata trailers) {
                log.info("gRPC call completed: {} - status: {}", methodName, status.getCode());
                super.close(status, trailers);
            }
        };

        return next.startCall(wrappedCall, headers);
    }
}

@Component
public class GrpcAuthInterceptor implements ServerInterceptor {

    private final JwtTokenService tokenService;

    private static final String AUTH_HEADER_KEY = "authorization";
    private static final Metadata.Key<String> AUTH_METADATA_KEY =
        Metadata.Key.of(AUTH_HEADER_KEY, Metadata.ASCII_STRING_MARSHALLER);

    public GrpcAuthInterceptor(JwtTokenService tokenService) {
        this.tokenService = tokenService;
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {

        String authToken = headers.get(AUTH_METADATA_KEY);

        if (authToken == null || !authToken.startsWith("Bearer ")) {
            call.close(Status.UNAUTHENTICATED
                    .withDescription("Missing or invalid authorization header"),
                new Metadata());
            return new ServerCall.Listener<>() {};
        }

        try {
            String token = authToken.substring(7);
            tokenService.validate(token);
        } catch (Exception e) {
            call.close(Status.UNAUTHENTICATED
                    .withDescription("Invalid token"),
                new Metadata());
            return new ServerCall.Listener<>() {};
        }

        return next.startCall(call, headers);
    }
}
```

---

## Best Practices

1. **Use Protocol Buffers v3**: Clean, strongly-typed schema
2. **Design for streaming**: Use streaming RPCs for large datasets
3. **Implement deadlines**: Always set client-side deadlines
4. **Use interceptors**: Cross-cutting concerns like logging, auth, metrics
5. **Keep payloads small**: Proto binaried encoding is efficient
6. **Use HTTP/2 benefits**: Multiplexing, header compression
7. **Health checking**: Implement gRPC health protocol
8. **Load balancing**: Use client-side or proxy-based load balancing
9. **Error handling**: Use standard gRPC status codes
10. **Connection management**: Use keepalive and connection pooling

```java
// Client with deadline
User user = blockingStub
    .withDeadline(Deadline.after(5, TimeUnit.SECONDS))
    .getUser(request);

// Health check implementation
public class HealthCheckServiceImpl extends HealthGrpc.HealthImplBase {
    @Override
    public void check(HealthCheckRequest request,
                      StreamObserver<HealthCheckResponse> responseObserver) {
        responseObserver.onNext(HealthCheckResponse.newBuilder()
            .setStatus(HealthCheckResponse.ServingStatus.SERVING)
            .build());
        responseObserver.onCompleted();
    }
}
```

---

## Common Mistakes

### Mistake 1: No Deadline/Timeout

```java
// WRONG: No deadline - call hangs forever
User user = blockingStub.getUser(request);

// CORRECT: Set deadline
User user = blockingStub
    .withDeadline(Deadline.after(5, TimeUnit.SECONDS))
    .getUser(request);
```

### Mistake 2: Ignoring Error Status Codes

```java
// WRONG: Catching all errors uniformly
try {
    return blockingStub.getUser(request);
} catch (Exception e) {
    throw new RuntimeException("gRPC failed");
}

// CORRECT: Handle specific status codes
try {
    return blockingStub.getUser(request);
} catch (StatusRuntimeException e) {
    switch (e.getStatus().getCode()) {
        case NOT_FOUND -> throw new ResourceNotFoundException();
        case UNAUTHENTICATED -> throw new AuthException();
        case DEADLINE_EXCEEDED -> throw new TimeoutException();
        default -> throw new GrpcException(e);
    }
}
```

### Mistake 3: Blocking on Async Calls

```java
// WRONG: Blocking in async context
User user = futureStub.getUser(request).get();  // Blocks thread

// CORRECT: Use CompletableFuture composition
return futureStub.getUser(request)
    .thenApply(user -> mapToDto(user));
```

---

## Summary

1. gRPC uses Protocol Buffers for serialization and HTTP/2 for transport
2. Define services and messages in .proto files, generate code
3. Implement service interfaces on server, create stubs on client
4. Support unary, server-streaming, client-streaming, bidirectional RPCs
5. Use interceptors for cross-cutting concerns
6. Always set deadlines and handle error status codes
7. Use streaming for large data transfers and real-time updates

---

## References

- [gRPC Documentation](https://grpc.io/docs/)
- [Protocol Buffers Guide](https://protobuf.dev/programming-guides/proto3/)
- [gRPC Java Tutorial](https://grpc.io/docs/languages/java/basics/)
- [gRPC Best Practices](https://grpc.io/docs/guides/performance/)

Happy Coding