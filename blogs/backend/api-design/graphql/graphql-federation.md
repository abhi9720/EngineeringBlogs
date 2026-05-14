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

### User Service

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

### Gateway Implementation

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

### Reference Resolver Pattern

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

```graphql
# WRONG: Service A extends type from Service B, and vice versa
# This creates circular resolution

# CORRECT: Define clear ownership boundaries
# One service "owns" the type, others extend
```

### Mistake 2: Large Entities Across Many Services

```graphql
# WRONG: Single type extended by 10+ services
# Every query potentially calls 10+ services

# CORRECT: Keep entity extensions minimal
# Each service should extend no more than 2-3 types
```

### Mistake 3: No Fallback for Downstream Services

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