---
title: "GraphQL Federation"
description: "Implement federated GraphQL architecture: Apollo Federation, schema composition, gateway pattern, entity resolution, and cross-service queries"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - graphql
  - federation
  - microservices
  - apollo
coverImage: "/images/backend/api-design/graphql/graphql-federation.png"
draft: false
---

# Federated GraphQL Architecture

## Overview

GraphQL Federation enables distributing a single GraphQL schema across multiple services. Each service owns a portion of the schema, and a federation gateway composes them into a unified graph. This allows teams to own their domain schemas independently while providing a single API endpoint to clients.

---

## Federation Concepts

GraphQL Federation allows you to split a single GraphQL schema across multiple services, each owning the types and fields relevant to its domain. A federation gateway composes these subgraph schemas into a unified supergraph that clients query as a single endpoint. This architecture enables domain-oriented teams to develop and deploy independently while presenting a cohesive API to consumers. The key primitives are `@key` (defines an entity's primary key for cross-service resolution), `@extends` (extends a type from another service), `@external` (marks fields defined elsewhere), and `@requires`/`@provides` (declares field dependencies between services).

### Core Federation Primitives

```graphql
# Users service - owns User type
type User @key(fields: "id") {
  id: ID!
  name: String!
  email: String!
  role: String!
}

# Orders service - extends User with order info
type User @key(fields: "id") {
  id: ID!
  orders: [Order!]!
}

type Order @key(fields: "id") {
  id: ID!
  userId: ID!
  total: Float!
  status: String!
}

# Reviews service - extends User with reviews
type User @key(fields: "id") {
  id: ID!
  reviews: [Review!]!
}

type Review @key(fields: "id") {
  id: ID!
  userId: ID!
  rating: Int!
  text: String!
}
```

The federation directives form the contract between subgraph services. The `@key` directive is the most important — it declares which field(s) uniquely identify an entity and enable cross-service resolution. When service A extends a type from service B, both services must agree on the `@key` fields. The `@external` directive marks fields that exist in another service while `@requires` declares dependencies on fields from other services that must be resolved before the extending service can compute its fields.

### Federation Directive Reference

```graphql
# @key - Defines the entity's primary key for resolution across services
type Product @key(fields: "upc") {
  upc: String!
  name: String!
}

# @extends - Indicates a type extension from another service
extend type Product @key(fields: "upc") {
  upc: String! @external
  inventory: Int!
}

# @external - Marks fields defined in other services
extend type Product @key(fields: "upc") {
  upc: String! @external
  shippingEstimate: Int! @requires(fields: "price weight")
}

# @requires - Indicates fields needed from other services
# @provides - Fields provided to other services
```

---

## Service Implementation

Each subgraph service implements a portion of the overall schema. A service defines the types it owns (through schema SDL) and implements resolvers for those types. For types extended from other services, each service must provide a reference resolver that can load an entity by its `@key` field. When the gateway needs to resolve a field from service B on a type whose base fields come from service A, it first gets the entity reference from service A, then calls service B's reference resolver with the key value.

### User Service

The User service owns the base `User` type. It provides queries to fetch users and a reference resolver that loads a user by ID. The reference resolver is critical — it allows other services to ask "give me the User with this ID" without knowing how users are stored. The `@ReferenceResolver` annotation (or implementing `GraphQLResolver<User>`) tells the federation runtime that this service can resolve User entities. This pattern enables cross-service field resolution: when a client queries `order { user { name } }`, the gateway resolves the order's userId, then calls the User service's reference resolver to get the user details.

```java
@Controller
public class UserController {

    private final UserService userService;

    @QueryMapping
    public User user(@Argument Long id) {
        return userService.findById(id);
    }

    @QueryMapping
    public List<User> users() {
        return userService.findAll();
    }

    // Reference resolver for federation
    @MutationMapping
    public User createUser(@Argument CreateUserInput input) {
        return userService.create(input);
    }
}

@Component
public class UserReferenceResolver implements GraphQLResolver<User> {

    private final UserService userService;

    public UserReferenceResolver(UserService userService) {
        this.userService = userService;
    }

    // Resolves User entity from other services that reference it
    public User resolveReference(Map<String, Object> reference) {
        Long id = Long.parseLong((String) reference.get("id"));
        return userService.findById(id);
    }
}
```

The Orders service extends the `User` type with order-related fields. It does not own the User type — instead, it uses `@extends` to add fields to a type defined elsewhere. The `@SchemaMapping` annotation maps a resolver method to a specific field on an external type. When a client queries `user { orders { id } }`, the gateway resolves the user from the User service, then calls the Orders service's `getOrdersForUser` resolver with the resolved User object. This pattern allows each service to contribute fields to shared types without central coordination.

### Orders Service

```java
@Controller
public class OrderController {

    private final OrderService orderService;

    @QueryMapping
    public Order order(@Argument Long id) {
        return orderService.findById(id);
    }

    // Extends User type from User service
    @QueryMapping
    public List<Order> ordersByUser(@Argument Long userId) {
        return orderService.findByUserId(userId);
    }

    // This resolver will be called when client queries User.orders
    @SchemaMapping(typeName = "User", field = "orders")
    public List<Order> getOrdersForUser(User user) {
        return orderService.findByUserId(user.getId());
    }
}

@Component
public class OrderReferenceResolver implements GraphQLResolver<Order> {

    private final OrderService orderService;
    private final UserServiceClient userClient;

    @SchemaMapping(typeName = "Order", field = "user")
    public User getUserForOrder(Order order) {
        return User.reference(order.getUserId());  // Returns a User reference
    }

    public Order resolveReference(Map<String, Object> reference) {
        return orderService.findById(
            Long.parseLong((String) reference.get("id")));
    }
}
```

The Reviews service further extends the `User` type (adding review-related fields) and also extends the `Product` type (assuming a product service exists). Each extension is independent — the Reviews service doesn't need to know about the Orders service. This is the power of federation: services contribute fields to shared types without coupling to each other. The gateway composes all contributions into a single unified type with all fields from all services.

### Reviews Service

```java
@Controller
public class ReviewController {

    private final ReviewService reviewService;

    @SchemaMapping(typeName = "User", field = "reviews")
    public List<Review> getReviewsForUser(User user) {
        return reviewService.findByUserId(user.getId());
    }

    @SchemaMapping(typeName = "Product", field = "reviews")
    public List<Review> getReviewsForProduct(Product product) {
        return reviewService.findByProductId(product.getUpc());
    }
}

@Component
public class ReviewReferenceResolver implements GraphQLResolver<Review> {

    private final ReviewService reviewService;

    public Review resolveReference(Map<String, Object> reference) {
        return reviewService.findById(
            Long.parseLong((String) reference.get("id")));
    }
}
```

---

## Federation Gateway

The gateway is the single entry point that clients connect to. It receives incoming GraphQL queries, determines which subgraph services are needed to resolve them, splits the query into sub-queries, executes them in parallel, and composes the results into a single response. The gateway must understand the supergraph schema, maintain service health information, handle partial failures gracefully, and efficiently merge results from multiple services. Production gateways (like Apollo Router or Apollo Gateway) add caching, authentication, rate limiting, and observability at the gateway level.

### Gateway Implementation

A simple federation gateway implementation parses the incoming query, fans out sub-queries to each subgraph service in parallel using `CompletableFuture`, and merges the results. In production, this logic is significantly more complex — the gateway needs to understand which fields belong to which service, handle entity references between services, manage query plan caching, and implement circuit breakers for unhealthy services. Most organizations use Apollo Gateway or a managed federation service rather than building their own.

```java
@Component
public class FederationGateway {

    private final List<GraphQLService> services;
    private final ServiceRegistry serviceRegistry;

    public FederationGateway(ServiceRegistry serviceRegistry,
                             UserService userService,
                             OrderService orderService,
                             ReviewService reviewService) {
        this.serviceRegistry = serviceRegistry;

        // In production, these would be remote GraphQL endpoints
        this.services = List.of(
            createService("users", "http://user-service/graphql"),
            createService("orders", "http://order-service/graphql"),
            createService("reviews", "http://review-service/graphql")
        );
    }

    private GraphQLService createService(String name, String url) {
        return GraphQLService.builder()
            .name(name)
            .url(url)
            .schema(loadSchema(name))
            .build();
    }

    public ExecutionResult execute(ExecutionInput input) {
        // 1. Parse the query
        // 2. Determine which services are needed
        // 3. Split query into sub-queries per service
        // 4. Execute sub-queries in parallel
        // 5. Compose results into single response

        Map<String, Object> variables = input.getVariables();
        Map<String, Object> data = new LinkedHashMap<>();
        List<GraphQLError> errors = new ArrayList<>();

        // Execute in parallel across services
        List<CompletableFuture<ServiceResult>> futures = services.stream()
            .map(service -> executeOnService(service, input))
            .toList();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .join();

        // Merge results
        futures.forEach(future -> {
            ServiceResult result = future.join();
            if (result.errors() != null) {
                errors.addAll(result.errors());
            }
            if (result.data() != null) {
                data.putAll(result.data());
            }
        });

        return ExecutionResultImpl.newExecutionResult()
            .data(data)
            .errors(errors)
            .build();
    }
}
```

Supergraph composition is the process of merging multiple subgraph schemas into a single unified schema. When types with the same name appear in multiple subgraphs, the composer merges their fields — provided they use the same `@key` and don't conflict. The composer also validates that cross-service references are consistent (e.g., if service A requires a field from service B, that field must exist in service B's schema). Schema composition should be validated in CI/CD to catch breaking changes before deployment.

### Supergraph Schema Composition

```java
@Component
public class SchemaComposer {

    public GraphQLSchema composeSchema(List<SubgraphSchema> subgraphs) {
        SchemaComposer composer = new SchemaComposer();

        // Merge all type definitions
        Map<String, GraphQLObjectType> types = new HashMap<>();
        Map<String, List<GraphQLFieldDefinition>> extensions = new HashMap<>();

        for (SubgraphSchema subgraph : subgraphs) {
            for (GraphQLObjectType type : subgraph.getTypes()) {
                String name = type.getName();

                if (types.containsKey(name)) {
                    // Extended type - merge fields
                    extensions.computeIfAbsent(name, k -> new ArrayList<>())
                        .addAll(type.getFieldDefinitions());
                } else {
                    types.put(name, type);
                }
            }
        }

        // Build unified schema
        GraphQLSchema.Builder schemaBuilder = GraphQLSchema.newSchema();

        // Add merged types with extensions
        for (Map.Entry<String, GraphQLObjectType> entry : types.entrySet()) {
            String name = entry.getKey();
            GraphQLObjectType type = entry.getValue();

            if (extensions.containsKey(name)) {
                // Create extended type with merged fields
                type = type.transform(builder -> {
                    extensions.get(name).forEach(builder::field);
                });
            }

            schemaBuilder.additionalType(type);
        }

        // Add query and mutation types
        schemaBuilder.query(findQueryType(types));
        schemaBuilder.mutation(findMutationType(types));

        return schemaBuilder.build();
    }
}
```

---

## Entity Resolution Across Services

Entity resolution is the core mechanism that enables cross-service field access in federation. When a client queries a field from service B on an entity whose base definition is in service A, the gateway must resolve the entity reference. The process works in three steps: (1) service A provides the entity's `@key` field, (2) the gateway calls service B's entity resolver with the key, (3) service B returns the additional fields. This happens transparently to the client — the gateway handles all cross-service coordination.

### Reference Resolver Pattern

The reference resolver pattern maps entity type names to resolver functions. When the gateway encounters a field that requires resolution from another service, it looks up the entity type name (e.g., "User"), calls the appropriate resolver with the key values from the parent entity, and merges the result. For performance, reference resolvers should be batched — instead of resolving one entity at a time, collect all references for the same type and resolve them in a single batch query.

```java
@Component
public class FederationEntityResolver {

    private final Map<String, EntityResolver> resolvers = new HashMap<>();

    public FederationEntityResolver(UserService userService,
                                    OrderService orderService,
                                    ReviewService reviewService) {
        resolvers.put("User", reference -> {
            Long id = Long.parseLong((String) reference.get("id"));
            return userService.findById(id);
        });
        resolvers.put("Order", reference -> {
            Long id = Long.parseLong((String) reference.get("id"));
            return orderService.findById(id);
        });
        resolvers.put("Review", reference -> {
            Long id = Long.parseLong((String) reference.get("id"));
            return reviewService.findById(id);
        });
    }

    public Object resolveEntity(String typeName, Map<String, Object> reference) {
        EntityResolver resolver = resolvers.get(typeName);
        if (resolver == null) {
            throw new IllegalArgumentException("Unknown entity type: " + typeName);
        }
        return resolver.resolve(reference);
    }

    @FunctionalInterface
    interface EntityResolver {
        Object resolve(Map<String, Object> reference);
    }
}
```

Cross-service data fetching is where the performance challenges of federation become apparent. Resolving a deeply nested query may require sequential calls to multiple services — each hop adds latency. The example shows an `Order` resolver that fetches the `user` from the User service and the `product` from the Product service, then chains to compute `shippingInfo`. In production, these calls should be parallelized where possible, cached aggressively, and protected with timeouts. Consider using DataLoader across service boundaries to batch entity resolution requests.

### Cross-Service Data Fetching

```java
@Component
public class CrossServiceResolver implements GraphQLResolver<Order> {

    private final UserServiceClient userClient;
    private final ProductServiceClient productClient;

    // When client queries Order.user, this resolver fetches from User service
    public CompletableFuture<User> user(Order order) {
        return userClient.findById(order.getUserId());
    }

    // Nested cross-service resolution
    public CompletableFuture<ShippingInfo> shippingInfo(Order order) {
        return productClient.findById(order.getProductId())
            .thenCompose(product -> shippingClient.estimate(
                order.getAddress(), product.getWeight()));
    }
}

// Feign client for inter-service communication
@FeignClient(name = "user-service", url = "${services.user.url}")
public interface UserServiceClient {

    @GetMapping("/internal/users/{id}")
    User findById(@PathVariable("id") Long id);

    @PostMapping("/internal/users/batch")
    List<User> findByIds(@RequestBody List<Long> ids);
}
```

---

## Best Practices

Federation enables powerful distributed API architectures but introduces coordination challenges that require careful design. The following practices help maintain a healthy federated graph that is performant, evolvable, and reliable.

1. **Own your types**: Each service owns its domain types completely
2. **Use @key for entities**: Define primary keys for cross-service resolution
3. **Minimize cross-service coupling**: Avoid requiring fields from many services
4. **Batch entity resolution**: Use DataLoader for reference resolution
5. **Graceful degradation**: Handle downstream service failures
6. **Monitor gateway performance**: Track latency per service
7. **Version your subgraphs**: Evolve services independently
8. **Test composition**: Validate schema composition in CI/CD
9. **Secure inter-service communication**: Use mTLS between services
10. **Cache frequently accessed entities**: Reduce cross-service calls

```java
@Configuration
public class FederationConfig {

    @Bean
    public DataLoaderRegistry federationDataLoader(
            UserServiceClient userClient,
            OrderServiceClient orderClient) {

        DataLoaderRegistry registry = new DataLoaderRegistry();

        DataLoader<Long, User> userLoader = DataLoader.newMappedDataLoader(ids ->
            userClient.findByIds(ids)
                .thenApply(users -> users.stream()
                    .collect(Collectors.toMap(User::getId, Function.identity())))
        );

        registry.register("userLoader", userLoader);

        return registry;
    }
}
```

---

## Common Mistakes

### Mistake 1: Circular Dependencies Between Services

Circular type dependencies occur when service A extends a type from service B, and service B extends a type from service A. This creates unresolvable reference chains — resolving a user's orders requires the orders service, which requires the user's address from the user service, which requires... The solution is strict type ownership: each type has exactly one service that owns its base definition, and other services can only extend it. Never allow two services to own the same type.

```graphql
# WRONG: Service A extends type from Service B, and vice versa
# This creates circular resolution

# CORRECT: Define clear ownership boundaries
# One service "owns" the type, others extend
```

### Mistake 2: Large Entities Across Many Services

When a single type (like `User`) is extended by many services, even a simple query for the user can trigger calls to every service that extends the type. This creates a performance tax where the latency of the slowest service determines the response time. Keep entity extensions focused — a type should only be extended by services that genuinely need to add closely related fields. If a type is extended by more than 4-5 services, consider whether the architecture has become too tightly coupled.

```graphql
# WRONG: Single type extended by 10+ services
# Every query potentially calls 10+ services

# CORRECT: Keep entity extensions minimal
# Each service should extend no more than 2-3 types
```

### Mistake 3: No Fallback for Downstream Services

In a federated architecture, any subgraph service can fail or become slow. If the gateway propagates these failures as errors, the entire request fails even if the failing service was providing non-critical fields (like recommendations or social features). Implement graceful degradation: critical data failures should propagate as errors, but non-critical field failures can return null and be logged for monitoring. GraphQL's null propagation handles this naturally when resolvers return null instead of throwing.

```java
// WRONG: Fails entire query when one service is down
User user = userClient.findById(order.getUserId());

// CORRECT: Partial results with null propagation
try {
    User user = userClient.findById(order.getUserId());
} catch (Exception e) {
    log.error("User service unavailable", e);
    // Return null - parent field becomes null
    return null;
}
```

---

## Summary

1. Federation enables distributed ownership of GraphQL schema across services
2. @key, @extends, @external, and @requires directives manage cross-service types
3. Entity resolvers handle cross-service type resolution
4. Gateway composes subgraph schemas into a unified supergraph
5. Batch resolution reduces cross-service call overhead
6. Plan for partial failures when downstream services are unavailable
7. Monitor composition validity and gateway performance

---

## References

- [Apollo Federation Specification](https://www.apollographql.com/docs/federation/federation-spec/)
- [Apollo Federation Subgraph Spec](https://www.apollographql.com/docs/federation/subgraph-spec/)
- [Netflix GraphQL Federation](https://netflixtechblog.com/how-netflix-scales-its-api-with-graphql-federation-part-1-ae399715e68e)
- [Federation Gateway Comparison](https://www.apollographql.com/docs/federation/gateway/)

Happy Coding