---
title: "GraphQL Security"
description: "Implement GraphQL API security: authentication, authorization, query depth limiting, rate limiting, batching attacks, and production hardening"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - graphql
  - security
  - authentication
  - rate-limiting
coverImage: "/images/backend/api-design/graphql/graphql-security.png"
draft: false
---

# GraphQL Security

## Overview

GraphQL APIs present unique security challenges compared to REST. The flexible query language allows clients to request nested data, potentially causing performance attacks, data leaks, and authorization bypasses. Implementing layered security is essential for production GraphQL deployments.

---

## Authentication

GraphQL authentication should happen at the transport layer, before the query is executed. A `WebGraphQlInterceptor` intercepts incoming HTTP requests, extracts credentials (typically a JWT from the `Authorization` header), validates them, and populates the GraphQL context with user information. This approach ensures authentication logic is centralized and consistent across all queries and mutations, rather than scattered across individual resolvers. The authenticated user is then accessible in resolvers through the context, allowing them to enforce authorization rules.

### JWT Authentication with GraphQL

```java
@Component
public class GraphQLAuthenticationInterceptor implements WebGraphQlInterceptor {

    private final JwtTokenService tokenService;

    public GraphQLAuthenticationInterceptor(JwtTokenService tokenService) {
        this.tokenService = tokenService;
    }

    @Override
    public Mono<WebGraphQlResponse> intercept(WebGraphQlRequest request, Chain chain) {
        String authHeader = request.getHeaders().getFirst("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);

            try {
                User user = tokenService.validateAndExtract(token);
                // Store user in context for resolvers
                request.configureExecutionInput((input, builder) ->
                    builder.graphQLContext(context -> {
                        context.put("user", user);
                        context.put("userId", user.getId());
                        context.put("roles", user.getRoles());
                    }).build()
                );
            } catch (JwtException e) {
                return Mono.error(new AuthenticationException("Invalid token"));
            }
        }

        return chain.next(request);
    }
}
```

Once authentication populates the context with user information, resolvers access it via `@ContextValue` injection. The `currentUser` query returns the authenticated user, `myOrders` filters data by the current user's ID, and `createOrder` enforces that the order's owner matches the authenticated user — never trust the client-provided userId in mutation input. This pattern ensures that authentication context is consistently applied across all resolvers without repetitive header parsing code.

### Authentication Checks in Resolvers

```java
@Controller
public class SecureResolver {

    @QueryMapping
    public User currentUser(@ContextValue User user) {
        // User is injected from authenticated context
        return user;
    }

    @QueryMapping
    public List<Order> myOrders(@ContextValue Long userId) {
        // Only returns orders for authenticated user
        return orderService.findByUserId(userId);
    }

    @MutationMapping
    public Order createOrder(@Argument CreateOrderInput input,
                             @ContextValue Long userId) {
        input.setUserId(userId);  // Always use authenticated user
        return orderService.create(input);
    }
}
```

---

## Authorization

Authorization in GraphQL requires special care because the flexible query language can access any field in the schema. Field-level authorization — checking permissions per field — is essential to prevent unauthorized data access through deeply nested queries. Unlike REST where authorization is typically checked at the endpoint level, GraphQL requires checks at both the query level (can this user call this mutation?) and the field level (can this user see this user's salary?).

### Role-Based Access Control

A centralized `AuthorizationChecker` provides reusable permission and resource access checks. The `ROLE_PERMISSIONS` map defines which permissions each role has. Permission checks are granular — `READ_ALL`, `WRITE_OWN`, `MANAGE_USERS` — allowing fine-grained control. Resource access checks ensure users can only access their own data unless they have admin or manager privileges. This approach keeps authorization logic testable and consistent across all resolvers.

```java
@Component
public class AuthorizationChecker {

    private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.of(
        "ADMIN", List.of("READ_ALL", "WRITE_ALL", "DELETE_ALL", "MANAGE_USERS"),
        "MANAGER", List.of("READ_ALL", "WRITE_OWN", "MANAGE_TEAM"),
        "USER", List.of("READ_OWN", "WRITE_OWN")
    );

    public void checkPermission(User user, String requiredPermission) {
        List<String> permissions = ROLE_PERMISSIONS.getOrDefault(
            user.getRole(), Collections.emptyList());

        if (!permissions.contains(requiredPermission)) {
            throw new AuthorizationException(
                "Missing required permission: " + requiredPermission);
        }
    }

    public void checkResourceAccess(User user, Long resourceOwnerId) {
        if (user.getRole().equals("ADMIN")) {
            return;  // Admins can access all
        }

        if (!user.getId().equals(resourceOwnerId) && !user.getRole().equals("MANAGER")) {
            throw new AuthorizationException("Access denied to this resource");
        }
    }
}

@Controller
public class AuthorizedResolver {

    private final AuthorizationChecker authChecker;

    @QueryMapping
    public List<Order> allOrders(@ContextValue User user) {
        authChecker.checkPermission(user, "READ_ALL");
        return orderService.findAll();
    }

    @QueryMapping
    public Order order(@Argument Long id, @ContextValue User user) {
        Order order = orderService.findById(id);
        authChecker.checkResourceAccess(user, order.getUserId());
        return order;
    }

    @MutationMapping
    public Boolean deleteUser(@Argument Long id, @ContextValue User user) {
        authChecker.checkPermission(user, "MANAGE_USERS");
        return userService.delete(id);
    }
}
```

Field-level authorization is a GraphQL-specific security requirement. In REST, if an endpoint returns user data, you check authorization once for the whole response. In GraphQL, a single query might include fields with different authorization requirements — `email` might be visible to the user and admins, while `salary` requires a `VIEW_SALARY` permission. Field-level resolvers with authorization checks handle this by checking permissions individually and returning null for unauthorized fields. GraphQL's null propagation ensures that unauthorized fields simply appear as null rather than erroring the entire query.

### Field-Level Authorization

```java
@Component
public class FieldLevelSecurity implements GraphQLResolver<User> {

    private final AuthorizationChecker authChecker;

    @SchemaMapping(typeName = "User", field = "email")
    public String email(User user, @ContextValue User currentUser) {
        // Only admins or the user themselves can see email
        if (currentUser.getRole().equals("ADMIN")
            || currentUser.getId().equals(user.getId())) {
            return user.getEmail();
        }
        return null;  // Hide field for unauthorized
    }

    @SchemaMapping(typeName = "User", field = "salary")
    public BigDecimal salary(User user, @ContextValue User currentUser) {
        authChecker.checkPermission(currentUser, "VIEW_SALARY");
        return user.getSalary();
    }
}
```

---

## Query Depth Limiting

GraphQL's flexibility allows clients to craft deeply nested queries that can overwhelm the server. A malicious query like `user { posts { comments { author { posts { ... } } } } }` could nest 100 levels deep, causing exponential resource consumption. Query depth limiting rejects queries that exceed a configured maximum nesting depth (typically 5-7 levels). The depth calculation walks the query's abstract syntax tree and computes the maximum nesting level across all fields.

### Limit Query Depth

```java
@Component
public class QueryDepthLimiter implements DocumentParser {

    private static final int MAX_DEPTH = 5;

    @Override
    public Document parseDocument(String query) {
        Document document = new Parser().parseDocument(query);

        int depth = calculateDepth(document.getDefinitions());
        if (depth > MAX_DEPTH) {
            throw new QueryDepthLimitException(
                "Query depth " + depth + " exceeds maximum allowed depth " + MAX_DEPTH);
        }

        return document;
    }

    private int calculateDepth(List<Definition> definitions) {
        return definitions.stream()
            .filter(OperationDefinition.class::isInstance)
            .map(OperationDefinition.class::cast)
            .mapToInt(this::calculateOperationDepth)
            .max()
            .orElse(0);
    }

    private int calculateOperationDepth(OperationDefinition operation) {
        return operation.getSelectionSet().getSelections().stream()
            .mapToInt(this::calculateSelectionDepth)
            .max()
            .orElse(0);
    }

    private int calculateSelectionDepth(Selection selection) {
        if (selection instanceof Field field) {
            if (field.getSelectionSet() == null) {
                return 1;
            }
            int maxChildDepth = field.getSelectionSet().getSelections().stream()
                .mapToInt(this::calculateSelectionDepth)
                .max()
                .orElse(0);
            return 1 + maxChildDepth;
        }
        return 1;
    }
}
```

Query depth limiting alone is not sufficient — a shallow query can still be expensive if it requests many resources (e.g., `users(first: 10000) { orders { items { product { ... } } } }`). Query complexity analysis assigns a cost weight to each field and computes the total complexity of a query. Expensive fields like `allOrders` or `search` get higher costs. If the total exceeds a threshold, the query is rejected before execution. This provides fine-grained protection against resource-intensive queries regardless of depth.

### Query Complexity Analysis

```java
@Component
public class QueryComplexityAnalyzer implements Instrumentation {

    private static final int MAX_COMPLEXITY = 100;

    private static final Map<String, Integer> FIELD_COST = Map.of(
        "users", 5,
        "orders", 10,
        "allOrders", 20,
        "search", 15
    );

    @Override
    public InstrumentationState createState() {
        return new InstrumentationState() {};
    }

    @Override
    public CompletableFuture<ExecutionResult> instrumentExecution(
            ExecutionInput executionInput,
            InstrumentationExecutionParameters parameters,
            InstrumentationState state,
            CompletableFuture<ExecutionResult> result) {

        Document document = new Parser().parseDocument(executionInput.getQuery());
        int complexity = calculateComplexity(document);

        if (complexity > MAX_COMPLEXITY) {
            throw new QueryComplexityException(
                "Query complexity " + complexity + " exceeds maximum " + MAX_COMPLEXITY);
        }

        return result;
    }

    private int calculateComplexity(Document document) {
        return document.getDefinitions().stream()
            .filter(OperationDefinition.class::isInstance)
            .map(OperationDefinition.class::cast)
            .flatMap(op -> op.getSelectionSet().getSelections().stream())
            .mapToInt(this::calculateFieldComplexity)
            .sum();
    }

    private int calculateFieldComplexity(Selection selection) {
        if (selection instanceof Field field) {
            int cost = FIELD_COST.getOrDefault(field.getName(), 1);

            if (field.getSelectionSet() != null) {
                cost += field.getSelectionSet().getSelections().stream()
                    .mapToInt(this::calculateFieldComplexity)
                    .sum();
            }

            return cost;
        }
        return 1;
    }
}
```

---

## Rate Limiting

Rate limiting for GraphQL is more nuanced than REST because a single GraphQL request can be as cheap as a simple field lookup or as expensive as a deeply nested query spanning multiple services. Effective rate limiting considers not just request count but also query cost. Per-user and per-IP rate limiting prevents individual clients from monopolizing server resources, while mutation-specific limits protect write-heavy operations from abuse.

### Per-User Rate Limiting

GraphQL rate limiting should differentiate between authenticated and anonymous users (authenticated users get higher limits) and between query types (mutations get stricter limits than queries since they modify state). The `WebGraphQlInterceptor` extracts the user identity from the GraphQL context and applies separate rate limit counters for different operation types. Anonymous users are identified by IP address and given the strictest limits to prevent abuse.

```java
@Component
public class GraphQLRateLimiter implements WebGraphQlInterceptor {

    private final RateLimiterService rateLimiter;

    public GraphQLRateLimiter(RateLimiterService rateLimiter) {
        this.rateLimiter = rateLimiter;
    }

    @Override
    public Mono<WebGraphQlResponse> intercept(WebGraphQlRequest request, Chain chain) {
        String userId = request.getConfiguredExecutionInput()
            .getGraphQLContext()
            .get("userId");

        if (userId == null) {
            // Anonymous users get stricter limits
            String ip = request.getRemoteAddress();
            rateLimiter.checkLimit(ip, "anonymous", 10, Duration.ofMinutes(1));
        } else {
            rateLimiter.checkLimit(userId, "authenticated", 100, Duration.ofMinutes(1));
            rateLimiter.checkLimit(userId, "mutations", 30, Duration.ofMinutes(1));
        }

        return chain.next(request);
    }
}

@Service
public class RateLimiterService {

    private final Cache<String, Integer> requestCounts;

    public RateLimiterService() {
        this.requestCounts = Caffeine.newBuilder()
            .expireAfterWrite(1, TimeUnit.MINUTES)
            .build();
    }

    public void checkLimit(String key, String type, int maxRequests, Duration window) {
        String cacheKey = key + ":" + type;
        Integer count = requestCounts.getIfPresent(cacheKey);

        if (count == null) {
            requestCounts.put(cacheKey, 1);
        } else if (count >= maxRequests) {
            throw new RateLimitExceededException(
                "Rate limit exceeded for " + type + " requests");
        } else {
            requestCounts.put(cacheKey, count + 1);
        }
    }
}
```

---

## Batching Attack Prevention

GraphQL's support for batching multiple queries in a single request is a powerful feature but also an attack vector. An attacker could send a batch of hundreds of queries, each designed to exploit a different vulnerability or exhaust server resources. Batch limits, alias limits, and persisted queries are three defenses that prevent this class of attacks while preserving legitimate use cases.

### Limiting Batch Size

Batched requests send an array of query objects in a single HTTP request. While this can improve efficiency for clients that need multiple independent data fetches, it also allows attackers to amplify their request rate by a factor equal to the batch size. Limiting the batch size to a reasonable maximum (10-20 queries per request) balances efficiency with security. Validate the batch size before executing any of the queries to avoid partial execution.

```java
@Component
public class BatchQueryValidator implements WebGraphQlInterceptor {

    private static final int MAX_BATCH_SIZE = 10;

    @Override
    public Mono<WebGraphQlResponse> intercept(WebGraphQlRequest request, Chain chain) {
        String body = request.getBody();

        // Check if this is a batched request (array of queries)
        if (body.trim().startsWith("[")) {
            try {
                ObjectMapper mapper = new ObjectMapper();
                JsonNode node = mapper.readTree(body);

                if (node.isArray() && node.size() > MAX_BATCH_SIZE) {
                    return Mono.error(new BatchLimitException(
                        "Batch size " + node.size() + " exceeds maximum " + MAX_BATCH_SIZE));
                }
            } catch (JsonProcessingException e) {
                return Mono.error(new InvalidQueryException("Invalid request format"));
            }
        }

        return chain.next(request);
    }
}
```

Aliases allow clients to request the same field multiple times with different arguments. While useful for legitimate queries (comparing data), aliases can be used to construct expensive queries that request the same resource many times with different parameters. An attacker could alias `user` 100 times with different IDs and arguments, each potentially triggering a separate database query. Limiting the number of aliases per query prevents this amplification attack while preserving legitimate use cases.

### Aliases Attack Prevention

```java
@Component
public class AliasLimiter implements DocumentParser {

    private static final int MAX_ALIASES = 10;

    @Override
    public Document parseDocument(String query) {
        Document document = new Parser().parseDocument(query);

        int aliasCount = countAliases(document);
        if (aliasCount > MAX_ALIASES) {
            throw new AliasLimitException(
                "Too many aliases: " + aliasCount + ". Maximum allowed: " + MAX_ALIASES);
        }

        return document;
    }

    private int countAliases(Document document) {
        AtomicInteger count = new AtomicInteger(0);

        document.getDefinitions().forEach(definition -> {
            if (definition instanceof OperationDefinition op) {
                countAliasesInSelections(op.getSelectionSet().getSelections(), count);
            }
        });

        return count.get();
    }

    private void countAliasesInSelections(List<Selection> selections, AtomicInteger count) {
        selections.forEach(selection -> {
            if (selection instanceof Field field) {
                if (field.getAlias() != null) {
                    count.incrementAndGet();
                }
                if (field.getSelectionSet() != null) {
                    countAliasesInSelections(
                        field.getSelectionSet().getSelections(), count);
                }
            }
        });
    }
}
```

---

## Introspection Protection

GraphQL introspection is invaluable during development — it powers tools like GraphiQL and enables automatic documentation generation. However, in production, exposing your full schema through introspection reveals every type, field, argument, and relationship to potential attackers. This information helps attackers identify query paths, find unauthenticated fields, and craft efficient denial-of-service queries. Introspection should be disabled in production, or restricted to authenticated clients.

### Disabling Introspection in Production

The production environment should either remove introspection types from the schema or block introspection queries at runtime. Schema-level removal is cleaner — it prevents introspection queries from being parsed at all. The runtime blocking approach shown here checks if the query contains `__schema` or `__type` keywords and rejects it. For internal tooling, consider implementing a separate GraphQL endpoint with introspection enabled but protected by authentication and IP allowlisting.

```java
@Configuration
public class GraphQLSecurityConfig {

    @Bean
    public GraphQLSchema schema() {
        // Define schema without introspection in production
        if (isProduction()) {
            return SchemaParser.newParser()
                .schemaString(loadSchema())
                .build()
                .makeExecutableSchema(wiring)
                .transform(schema -> schema.clearSchemaDefinition()
                    // Remove introspection types
                );
        }
        return buildSchema();
    }

    @Bean
    public Instrumentation introspectionBlocker() {
        return new Instrumentation() {
            @Override
            public CompletableFuture<ExecutionResult> instrumentExecution(
                    ExecutionInput input,
                    InstrumentationExecutionParameters params,
                    InstrumentationState state,
                    CompletableFuture<ExecutionResult> result) {

                if (isProduction() && isIntrospectionQuery(input.getQuery())) {
                    throw new IntrospectionDisabledException(
                        "Introspection is disabled in production");
                }

                return result;
            }

            private boolean isIntrospectionQuery(String query) {
                return query.contains("__schema") || query.contains("__type");
            }
        };
    }
}
```

---

## Best Practices

GraphQL security requires a defense-in-depth approach because the flexible query language introduces unique attack surfaces not present in REST. Multiple layers of protection — transport authentication, field-level authorization, query analysis, rate limiting, and input validation — work together to create a secure API.

1. **Authenticate at transport level**: Validate JWT/tokens before GraphQL execution
2. **Authorize at field level**: Check permissions per field
3. **Limit query depth**: Cap at 5-7 levels maximum
4. **Analyze query complexity**: Assign costs to fields
5. **Rate limit per user/ip**: Prevent abuse
6. **Limit batch sizes**: Cap at reasonable maximum
7. **Limit aliases**: Prevent alias-based DoS attacks
8. **Disable introspection in production**: Hide schema details
9. **Use persisted queries**: Whitelist known queries
10. **Monitor slow queries**: Track and alert on expensive operations

```java
@Configuration
public class PersistedQueryConfig {

    private static final Set<String> PERSISTED_QUERIES = Set.of(
        "GetUserProfile",
        "ListOrders",
        "CreateOrder",
        "UpdateProfile"
    );

    @Bean
    public WebGraphQlInterceptor persistedQueryValidator() {
        return (request, chain) -> {
            String operationName = request.getOperationName();

            if (operationName != null && !PERSISTED_QUERIES.contains(operationName)) {
                return Mono.error(new InvalidQueryException(
                    "Unrecognized query: " + operationName));
            }

            return chain.next(request);
        };
    }
}
```

---

## Common Mistakes

### Mistake 1: No Depth Limiting

```java
// WRONG: No limits on deeply nested queries
query {
  user {
    posts {
      comments {
        author {
          posts { ... }  // Infinite nesting
        }
      }
    }
  }
}

// CORRECT: Limit query depth to 5
```

### Mistake 2: Authorization Only at Query Level

```java
// WRONG: Only checks at top level
public Order order(Long id) {
    return orderService.findById(id);  // No per-user check
}

// CORRECT: Field-level authorization
public Order order(Long id, @ContextValue User user) {
    Order order = orderService.findById(id);
    authChecker.checkResourceAccess(user, order.getUserId());
    return order;
}
```

### Mistake 3: Exposing Introspection in Production

```java
// WRONG: Introspection enabled in production
// Anyone can dump your entire schema

// CORRECT: Disable introspection for production
```

---

## Summary

1. Authenticate at the transport layer before GraphQL execution
2. Implement field-level authorization for granular access control
3. Limit query depth and complexity to prevent DoS attacks
4. Rate limit per user/IP/mutation type
5. Prevent batching and aliasing attacks
6. Disable introspection in production environments
7. Use persisted queries for known operations
8. Monitor and alert on expensive or suspicious queries

---

## References

- [GraphQL Security Best Practices](https://graphql.org/learn/security/)
- [OWASP GraphQL Security](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html)
- [Shopify GraphQL Security](https://shopify.dev/api/usage/rate-limits)
- [GitHub GraphQL Security](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql#authenticating-with-graphql)

Happy Coding