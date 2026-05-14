---
title: "GraphQL Client Best Practices"
description: "Build robust GraphQL clients in Spring Boot with WebClient, Apollo, and advanced patterns for query optimization and error handling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - graphql
  - webclient
  - api-design
coverImage: "/images/graphql-client-best-practices.png"
draft: false
---

# GraphQL Client Best Practices in Spring Boot

## Overview

GraphQL gives clients the power to request exactly the data they need. For backend services consuming GraphQL APIs, this means reduced over-fetching, fewer round trips, and more resilient integrations. However, implementing GraphQL clients requires careful attention to query construction, error handling, caching, and performance optimization.

This guide covers GraphQL client implementation using Spring's WebClient, Apollo GraphQL client, and advanced patterns for production systems.

---

## How GraphQL Client Communication Works

### Request Flow

```java
// GraphQL HTTP request structure
public class GraphQLRequest {
    private String query;
    private Map<String, Object> variables;
    private String operationName;

    public GraphQLRequest(String query, Map<String, Object> variables) {
        this.query = query;
        this.variables = variables;
    }

    // Getters
    public String getQuery() { return query; }
    public Map<String, Object> getVariables() { return variables; }
    public String getOperationName() { return operationName; }
}

// Standard GraphQL response structure
public class GraphQLResponse<T> {
    private T data;
    private List<GraphQLError> errors;
    private Map<String, Object> extensions;

    public boolean hasErrors() {
        return errors != null && !errors.isEmpty();
    }

    public boolean isPartial() {
        return data != null && hasErrors();
    }
}

public class GraphQLError {
    private String message;
    private List<ErrorLocation> locations;
    private List<String> path;
    private Map<String, Object> extensions;
}

public class ErrorLocation {
    private int line;
    private int column;
}
```

Every GraphQL HTTP request follows the same wire format: a JSON body with a `query` string, optional `variables` map, and optional `operationName`. The response always returns HTTP 200 unless there is a transport-level error — GraphQL errors are communicated within the response body itself, not through HTTP status codes. The `hasErrors()` method distinguishes between success and failure responses, while `isPartial()` detects the critical case where data was returned alongside errors. This means the caller must always inspect the response body, never just the HTTP status code.

### Transport Layer

```java
// GraphQL typically uses HTTP POST with application/json
@Configuration
public class GraphQLTransportConfig {

    @Bean
    public WebClient graphqlWebClient() {
        return WebClient.builder()
            .baseUrl("https://api.example.com/graphql")
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader("X-API-Key", "${api.key}")
            .defaultHeader("X-Source", "backend-service")
            .build();
    }

    @Bean
    public WebClient graphqlWebClientWithBatching() {
        return WebClient.builder()
            .baseUrl("https://api.example.com/graphql")
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            // Batch endpoint for multiple queries
            .defaultHeader("X-GraphQL-Batch", "true")
            .build();
    }
}
```

Unlike REST where each endpoint has its own URL, GraphQL uses a single endpoint (typically `/graphql`) for all queries and mutations. The request is always HTTP POST with `Content-Type: application/json`. Default headers like `X-API-Key` and `X-Source` are applied to every request via WebClient configuration. The separate bean with `X-GraphQL-Batch: true` configures the client for batch endpoints, where multiple queries are sent in a single HTTP request — a performance optimization that reduces round trips when independent data fetches are needed simultaneously.

---

## Basic WebClient GraphQL Client

### Simple Query Execution

```java
@Service
public class SimpleGraphQLClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    private static final Logger log = LoggerFactory.getLogger(SimpleGraphQLClient.class);

    public SimpleGraphQLClient(WebClient.Builder builder, ObjectMapper objectMapper) {
        this.webClient = builder
            .baseUrl("https://api.github.com/graphql")
            .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer ${token}")
            .build();
        this.objectMapper = objectMapper;
    }

    public <T> T executeQuery(String query, Map<String, Object> variables,
                               Class<T> dataClass) {
        GraphQLRequest request = new GraphQLRequest(query, variables);

        GraphQLResponse<JsonNode> response = webClient.post()
            .bodyValue(request)
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<JsonNode>>() {})
            .block(Duration.ofSeconds(10));

        if (response.hasErrors()) {
            log.error("GraphQL errors: {}", response.getErrors());
            handleGraphQLErrors(response.getErrors());
        }

        JsonNode data = response.getData();
        JsonNode relevantData = extractRelevantData(data, query);

        return objectMapper.convertValue(relevantData, dataClass);
    }

    private JsonNode extractRelevantData(JsonNode data, String query) {
        // Extract the top-level field from the query
        String operationName = parseOperationName(query);
        return data.get(operationName);
    }

    private String parseOperationName(String query) {
        // Simplified: extract the first field after the opening brace
        Pattern pattern = Pattern.compile("\\{(\\s*\\w+)");
        Matcher matcher = pattern.matcher(query);
        return matcher.find() ? matcher.group(1) : null;
    }

    private void handleGraphQLErrors(List<GraphQLError> errors) {
        for (GraphQLError error : errors) {
            switch (getErrorCode(error)) {
                case "UNAUTHENTICATED":
                    throw new AuthenticationException(error.getMessage());
                case "NOT_FOUND":
                    throw new ResourceNotFoundException(error.getMessage());
                case "RATE_LIMITED":
                    throw new RateLimitException(error.getMessage());
                case "VALIDATION_ERROR":
                    throw new BadRequestException(error.getMessage());
                default:
                    log.warn("Unhandled GraphQL error: {}", error);
            }
        }
    }

    private String getErrorCode(GraphQLError error) {
        if (error.getExtensions() != null) {
            Object code = error.getExtensions().get("code");
            return code != null ? code.toString() : "UNKNOWN";
        }
        return "UNKNOWN";
    }
}
```

The simple client demonstrates the core GraphQL request pattern: POST a `GraphQLRequest` containing the query string and variables, receive a `GraphQLResponse` containing `data` and `errors`. Because GraphQL error codes are custom per API (not standardized like HTTP), the `getErrorCode` method extracts the error code from the `extensions` map — a common GraphQL convention for error metadata. The `parseOperationName` helper extracts the top-level field name from the query to navigate the JSON response tree. Note that this client uses Jackson's `JsonNode` for the intermediate representation and then converts to the target type, providing flexibility at the cost of losing compile-time type safety.

### Typed Query Builder

```java
@Service
public class TypedGraphQLClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    // Pre-defined queries as constants
    private static final String GET_USER_QUERY = """
        query GetUser($id: ID!) {
            user(id: $id) {
                id
                name
                email
                profile {
                    avatar
                    bio
                }
                recentPosts(limit: 5) {
                    id
                    title
                    createdAt
                }
            }
        }
        """;

    private static final String SEARCH_PRODUCTS_QUERY = """
        query SearchProducts($query: String!, $first: Int!, $after: String) {
            search(query: $query, first: $first, after: $after) {
                totalCount
                edges {
                    node {
                        id
                        name
                        price
                        category
                        inStock
                    }
                    cursor
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
        """;

    private static final String CREATE_ORDER_MUTATION = """
        mutation CreateOrder($input: CreateOrderInput!) {
            createOrder(input: $input) {
                id
                status
                total
                items {
                    productId
                    quantity
                    price
                }
                createdAt
            }
        }
        """;

    public UserResponse getUser(String id) {
        return executeQuery(GET_USER_QUERY, Map.of("id", id), UserResponse.class);
    }

    public SearchResult<ProductResponse> searchProducts(String query, int first, String after) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("query", query);
        variables.put("first", first);
        if (after != null) {
            variables.put("after", after);
        }

        return executeQuery(SEARCH_PRODUCTS_QUERY, variables, SearchResult.class);
    }

    public OrderResponse createOrder(CreateOrderInput input) {
        return executeMutation(CREATE_ORDER_MUTATION, Map.of("input", input), OrderResponse.class);
    }

    private <T> T executeQuery(String query, Map<String, Object> variables, Class<T> responseType) {
        GraphQLRequest request = new GraphQLRequest(query, variables);

        return webClient.post()
            .uri("/graphql")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<JsonNode>>() {})
            .map(response -> {
                if (response.hasErrors()) {
                    log.warn("Query had partial errors: {}", response.getErrors());
                }
                String operationName = parseOperationName(query);
                JsonNode data = response.getData().get(operationName);
                return objectMapper.convertValue(data, responseType);
            })
            .timeout(Duration.ofSeconds(10))
            .block();
    }

    private <T> T executeMutation(String mutation, Map<String, Object> variables, Class<T> responseType) {
        GraphQLRequest request = new GraphQLRequest(mutation, variables);

        return webClient.post()
            .uri("/graphql")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<JsonNode>>() {})
            .map(response -> {
                if (response.hasErrors()) {
                    throw new GraphQLMutationException("Mutation failed", response.getErrors());
                }
                String operationName = parseOperationName(mutation);
                JsonNode data = response.getData().get(operationName);
                return objectMapper.convertValue(data, responseType);
            })
            .timeout(Duration.ofSeconds(15))
            .block();
    }

    private String parseOperationName(String query) {
        Pattern pattern = Pattern.compile("(?:query|mutation)\\s+(\\w+)");
        Matcher matcher = pattern.matcher(query);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

Defining queries as static constants separates the GraphQL schema knowledge from the Java code that uses it. Each public method maps to a single GraphQL operation: `getUser` calls the `GetUser` query, `searchProducts` calls `SearchProducts`, and `createOrder` calls the `CreateOrder` mutation. Note the important distinction between queries and mutations in error handling — queries log partial errors and continue (accepting potentially incomplete data), while mutations throw an exception because mutations should be atomic. The timeout is also differentiated: mutations get 15 seconds because they typically perform more work on the server than simple queries.

---

## Apollo GraphQL Client

### Configuration

```java
@Configuration
public class ApolloGraphQLConfig {

    @Bean
    public ApolloClient apolloClient() {
        return ApolloClient.builder()
            .serverUrl("https://api.example.com/graphql")
            .okHttpClient(new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(10, TimeUnit.SECONDS)
                .addInterceptor(new AuthInterceptor())
                .addInterceptor(new LoggingInterceptor())
                .addInterceptor(new ErrorInterceptor())
                .connectionPool(new ConnectionPool(10, 30, TimeUnit.SECONDS))
                .build())
            .normalizedCache(new LruNormalizedCacheFactory(
                EvictionPolicy.builder()
                    .maxSizeBytes(10 * 1024 * 1024)
                    .build()
            ))
            .addCustomTypeAdapters(generatedAdapters())
            .build();
    }

    private static class AuthInterceptor implements Interceptor {
        @Override
        public Response intercept(Chain chain) throws IOException {
            Request original = chain.request();
            Request request = original.newBuilder()
                .header("Authorization", "Bearer " + getToken())
                .header("X-Client-Id", "backend-service")
                .header("X-Request-Id", UUID.randomUUID().toString())
                .build();
            return chain.proceed(request);
        }

        private String getToken() {
            // Token retrieval logic
            return tokenProvider.getAccessToken();
        }
    }

    private static class LoggingInterceptor implements Interceptor {
        @Override
        public Response intercept(Chain chain) throws IOException {
            Request request = chain.request();
            long start = System.nanoTime();

            log.info("GraphQL request: {} {}", request.method(), request.url());

            Response response = chain.proceed(request);

            long duration = (System.nanoTime() - start) / 1_000_000;
            log.info("GraphQL response: {} ({}ms)", response.code(), duration);

            return response;
        }
    }

    private static class ErrorInterceptor implements Interceptor {
        @Override
        public Response intercept(Chain chain) throws IOException {
            Response response = chain.proceed(chain.request());
            if (!response.isSuccessful()) {
                log.error("GraphQL HTTP error: {}", response.code());
                // Read body for error details
                ResponseBody body = response.body();
                if (body != null) {
                    String bodyStr = body.string();
                    log.error("Error body: {}", bodyStr);
                    // Create new response with consumed body
                    response = response.newBuilder()
                        .body(ResponseBody.create(body.contentType(), bodyStr))
                        .build();
                }
            }
            return response;
        }
    }
}
```

Apollo GraphQL is a mature client that provides code generation from schema files, normalized caching, and type-safe query builders. The configuration above sets up OkHttp as the HTTP transport with authentication, logging, and error interceptors. The `normalizedCache` with LRU eviction (10MB max) stores GraphQL objects normalized by type and ID, enabling automatic cache updates when mutations modify previously fetched data. Unlike WebClient-based approaches, Apollo generates type-safe query classes from `.graphql` schema files, providing compile-time validation that requested fields exist in the schema — a significant reliability advantage.

### Query Execution with Apollo

```java
@Service
public class ApolloGraphQLService {

    private final ApolloClient apolloClient;

    public ApolloGraphQLService(ApolloClient apolloClient) {
        this.apolloClient = apolloClient;
    }

    public UserResponse getUser(String id) {
        GetUserQuery query = GetUserQuery.builder()
            .id(id)
            .build();

        ApolloResponse<GetUserQuery.Data> response = apolloClient
            .query(query)
            .enqueue();

        if (response.hasErrors()) {
            log.error("GraphQL errors: {}", response.getErrors());
            throw new GraphQLQueryException("Failed to fetch user", response.getErrors());
        }

        return mapToUserResponse(response.getData());
    }

    public ProductSearchResponse searchProducts(
            String query, int first, String after) {

        SearchProductsQuery searchQuery = SearchProductsQuery.builder()
            .query(query)
            .first(first)
            .after(after)
            .build();

        ApolloResponse<SearchProductsQuery.Data> response = apolloClient
            .query(searchQuery)
            .enqueue();

        if (response.hasErrors()) {
            log.warn("Partial errors in product search: {}", response.getErrors());
        }

        return mapToSearchResponse(response.getData());
    }

    // Reactive execution
    public Flux<UserResponse> getAllUsers(List<String> userIds) {
        return Flux.fromIterable(userIds)
            .parallel()
            .runOn(Schedulers.parallel())
            .flatMap(this::getUserReactive)
            .sequential();
    }

    private Mono<UserResponse> getUserReactive(String id) {
        return Mono.fromCallable(() -> getUser(id))
            .subscribeOn(Schedulers.boundedElastic());
    }
}
```

Apollo's query execution returns strongly-typed response objects generated from the schema. The `GetUserQuery` class is auto-generated with builder methods for variables and nested `Data` classes matching the query's selection set. The `enqueue()` method is synchronous, while Apollo also supports asynchronous execution via callbacks or reactive wrappers. The batch processing example wraps synchronous Apollo calls in `Mono.fromCallable` with `Schedulers.boundedElastic()` to avoid blocking event-loop threads when fetching data for multiple users in parallel.

---

## Advanced Patterns

### Batch Loading with DataLoader

```java
@Service
public class BatchGraphQLService {

    private final WebClient webClient;

    // Batch loader for efficient user fetching
    public <T> T executeBatchQuery(
            String query, List<Map<String, Object>> variablesList,
            Class<T> responseType) {

        List<GraphQLRequest> batchRequests = variablesList.stream()
            .map(vars -> new GraphQLRequest(query, vars))
            .toList();

        List<GraphQLResponse<JsonNode>> responses = webClient.post()
            .uri("/graphql/batch")
            .bodyValue(batchRequests)
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<List<GraphQLResponse<JsonNode>>>() {})
            .block(Duration.ofSeconds(10));

        return objectMapper.convertValue(responses, responseType);
    }

    // Dataloader pattern for N+1 prevention
    public Map<String, UserResponse> loadUsersByIds(List<String> userIds) {
        String batchQuery = """
            query GetUsers($ids: [ID!]!) {
                users(ids: $ids) {
                    id
                    name
                    email
                    profile { avatar bio }
                }
            }
            """;

        return executeQuery(batchQuery, Map.of("ids", userIds), UsersListResponse.class)
            .getUsers().stream()
            .collect(Collectors.toMap(UserResponse::getId, Function.identity()));
    }
}
```

The N+1 problem in GraphQL occurs when a list of items triggers individual queries for each item's nested data. The batch execution pattern addresses this by sending multiple queries in a single HTTP request to a dedicated batch endpoint. The DataLoader pattern takes a different approach: it defines a single query that accepts a list of IDs and returns all results at once, then maps them by ID for O(1) lookup. This replaces N separate round trips with a single request, dramatically reducing latency and server load when fetching related data for multiple parent objects.

### Automatic Persisted Queries (APQ)

```java
@Service
public class APQGraphQLClient {

    private final WebClient webClient;
    private final Map<String, String> queryHashCache = new ConcurrentHashMap<>();

    // APQ reduces request size for frequent queries
    public <T> T executeWithAPQ(String query, String queryHash,
                                 Map<String, Object> variables,
                                 Class<T> responseType) {

        // Attempt to send only the hash first
        Map<String, Object> apqRequest = new HashMap<>();
        apqRequest.put("extensions", Map.of(
            "persistedQuery", Map.of(
                "version", 1,
                "sha256Hash", queryHash
            )
        ));
        apqRequest.put("variables", variables);

        try {
            GraphQLResponse<T> response = webClient.post()
                .bodyValue(apqRequest)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<T>>() {})
                .block(Duration.ofSeconds(10));

            if (response != null && response.getData() != null) {
                return response.getData();
            }

            // Hash not found, send full query
            return sendFullQuery(query, queryHash, variables, responseType);

        } catch (WebClientResponseException e) {
            if (e.getStatusCode() == HttpStatus.NOT_FOUND
                    || e.getStatusCode() == HttpStatus.BAD_REQUEST) {
                return sendFullQuery(query, queryHash, variables, responseType);
            }
            throw e;
        }
    }

    private <T> T sendFullQuery(String query, String queryHash,
                                 Map<String, Object> variables,
                                 Class<T> responseType) {

        Map<String, Object> fullRequest = new HashMap<>();
        fullRequest.put("query", query);
        fullRequest.put("variables", variables);
        fullRequest.put("extensions", Map.of(
            "persistedQuery", Map.of(
                "version", 1,
                "sha256Hash", queryHash
            )
        ));

        return webClient.post()
            .bodyValue(fullRequest)
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<T>>() {})
            .map(GraphQLResponse::getData)
            .block(Duration.ofSeconds(10));
    }
}
```

Automatic Persisted Queries reduce bandwidth by sending a hash of the query string instead of the full query on subsequent requests. The client first sends only the hash; if the server recognizes it because it was registered on a previous request, it returns the data immediately. If the hash is unknown, the server returns a `PersistedQueryNotFound` error, and the client falls back to sending the full query alongside the hash so the server can register it for future requests. APQ is particularly valuable for bandwidth-constrained environments where every kilobyte matters.

### Subscription Support

```java
@Service
public class GraphQLSubscriptionService {

    private final WebClient webClient;

    public Flux<OrderUpdateEvent> subscribeToOrderUpdates(String orderId) {
        String subscriptionQuery = """
            subscription OnOrderUpdate($orderId: ID!) {
                orderUpdated(orderId: $orderId) {
                    id
                    status
                    timestamp
                    updates {
                        field
                        oldValue
                        newValue
                    }
                }
            }
            """;

        Map<String, Object> variables = Map.of("orderId", orderId);

        GraphQLRequest request = new GraphQLRequest(subscriptionQuery, variables);

        return webClient.post()
            .uri("/graphql")
            .bodyValue(request)
            .retrieve()
            .bodyToFlux(OrderUpdateEvent.class)
            .retryWhen(Retry.backoff(5, Duration.ofSeconds(1))
                .maxBackoff(Duration.ofSeconds(30))
                .jitter(0.5))
            .timeout(Duration.ofMinutes(30))
            .doOnCancel(() -> log.info("Subscription cancelled for order: {}", orderId))
            .doOnTerminate(() -> log.info("Subscription terminated for order: {}", orderId));
    }

    // Alternative with Server-Sent Events
    public Flux<OrderUpdateEvent> subscribeViaSSE(String orderId) {
        return webClient.get()
            .uri("/graphql/subscriptions?orderId={orderId}", orderId)
            .accept(MediaType.TEXT_EVENT_STREAM)
            .retrieve()
            .bodyToFlux(OrderUpdateEvent.class)
            .retryWhen(Retry.fixedDelay(3, Duration.ofSeconds(5)));
    }
}
```

GraphQL subscriptions enable real-time push notifications from the server. The WebClient-based approach sends a subscription query via HTTP POST and receives a stream of events as a `Flux`. The retry configuration with exponential backoff and jitter is critical for subscriptions — network interruptions are inevitable for long-lived connections, and aggressive reconnection with jitter prevents the "thundering herd" problem where all reconnecting clients hit the server simultaneously. The Server-Sent Events alternative uses HTTP GET with `text/event-stream` content type, which is simpler and more widely supported by infrastructure proxies.

---

## Error Handling and Validation

### Comprehensive Error Handler

```java
@Component
public class GraphQLResponseValidator {

    private static final Logger log = LoggerFactory.getLogger(GraphQLResponseValidator.class);

    public <T> T validateAndExtract(GraphQLResponse<JsonNode> response,
                                     String dataKey, Class<T> type) {

        if (response == null) {
            throw new GraphQLCommunicationException("Null response from GraphQL server");
        }

        if (response.getData() == null && response.hasErrors()) {
            throw new GraphQLResponseException(
                "GraphQL query returned errors without data",
                response.getErrors());
        }

        if (response.hasErrors()) {
            log.warn("Partial GraphQL response with errors: {}", response.getErrors());
        }

        JsonNode data = response.getData();
        if (data == null || !data.has(dataKey)) {
            throw new GraphQLDataNotFoundException(
                "Missing field '" + dataKey + "' in response");
        }

        JsonNode fieldData = data.get(dataKey);
        if (fieldData.isNull()) {
            return null;
        }

        return objectMapper.convertValue(fieldData, type);
    }

    public void validateMutationResponse(
            GraphQLResponse<JsonNode> response, String mutationName) {

        if (response.hasErrors()) {
            List<GraphQLError> errors = response.getErrors();
            log.error("Mutation '{}' failed with {} errors", mutationName, errors.size());

            for (GraphQLError error : errors) {
                String errorCode = extractErrorCode(error);
                switch (errorCode) {
                    case "VALIDATION_ERROR":
                        throw new ValidationException(error.getMessage());
                    case "CONFLICT":
                        throw new ConflictException(error.getMessage());
                    case "RATE_LIMITED":
                        throw new RateLimitException(error.getMessage());
                    case "FORBIDDEN":
                        throw new AuthorizationException(error.getMessage());
                    default:
                        throw new GraphQLMutationException(mutationName, errors);
                }
            }
        }
    }

    private String extractErrorCode(GraphQLError error) {
        if (error.getExtensions() != null
                && error.getExtensions().containsKey("code")) {
            return error.getExtensions().get("code").toString();
        }
        return "UNKNOWN";
    }
}
```

A dedicated response validator enforces consistent error handling across all GraphQL operations. It distinguishes three cases: complete failure (no data, only errors), partial success (data with errors — handle with caution), and success (data without errors). The `validateAndExtract` method also checks that the expected top-level field exists in the response, catching schema mismatches early. Mutation validation is stricter — any error causes an exception because mutations should be atomic. The error code extraction from `extensions` maps vendor-specific codes to typed exceptions, keeping callers insulated from the upstream API's error format.

### Retry with Exponential Backoff

```java
@Service
public class ResilientGraphQLClient {

    private final WebClient webClient;

    public <T> T executeWithRetry(
            String query, Map<String, Object> variables,
            Class<T> responseType, int maxRetries) {

        RetrySpec retrySpec = Retry.backoff(maxRetries, Duration.ofMillis(200))
            .maxBackoff(Duration.ofSeconds(10))
            .jitter(0.5)
            .filter(this::isRetryable)
            .onRetryExhaustedThrow((spec, signal) ->
                new GraphQLRetryExhaustedException(
                    "GraphQL query failed after " + maxRetries + " retries",
                    signal.failure()));

        return webClient.post()
            .uri("/graphql")
            .bodyValue(new GraphQLRequest(query, variables))
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<T>>() {})
            .flatMap(response -> {
                if (response.hasErrors() && hasRetryableErrors(response.getErrors())) {
                    return Mono.error(new GraphQLRetryableException("Retryable errors"));
                }
                return Mono.just(response.getData());
            })
            .retryWhen(retrySpec)
            .timeout(Duration.ofSeconds(30))
            .block();
    }

    private boolean isRetryable(Throwable throwable) {
        return throwable instanceof GraphQLRetryableException
            || throwable instanceof TimeoutException
            || throwable instanceof ConnectException;
    }

    private boolean hasRetryableErrors(List<GraphQLError> errors) {
        return errors.stream().anyMatch(error -> {
            String code = extractErrorCode(error);
            return "INTERNAL_ERROR".equals(code)
                || "TIMEOUT".equals(code)
                || "SERVICE_UNAVAILABLE".equals(code);
        });
    }
}
```

The retry configuration uses exponential backoff with jitter (200ms base, max 10s, ±50% jitter). The `isRetryable` check ensures only transient errors trigger retries — connection timeouts and retryable GraphQL errors (INTERNAL_ERROR, TIMEOUT, SERVICE_UNAVAILABLE) are retried, while client errors and validation failures are not. The `onRetryExhaustedThrow` callback provides a custom exception when all retries are exhausted, allowing callers to distinguish between a transient delay and a persistent failure.

---

## Query Optimization

### Field Selection

```java
@Service
public class OptimizedGraphQLClient {

    // Bad: Over-fetching
    private static final String OVER_FETCHING_QUERY = """
        query {
            user(id: "123") {
                id
                name
                email
                phone
                address { street city zip country }
                profile { avatar bio website socialLinks }
                posts { id title content createdAt comments { id text } }
                settings { theme notifications privacy }
                billing { cards invoices plan }
            }
        }
        """;

    // Good: Request only needed fields
    private static final String OPTIMIZED_QUERY = """
        query GetUserSummary($id: ID!) {
            user(id: $id) {
                id
                name
                email
                recentPosts(limit: 3) {
                    id
                    title
                }
            }
        }
        """;

    // Dynamic field selection based on use case
    public String buildUserQuery(Set<UserField> requestedFields) {
        StringBuilder query = new StringBuilder();
        query.append("query GetUser($id: ID!) { user(id: $id) { id");

        if (requestedFields.contains(UserField.NAME)) {
            query.append(" name");
        }
        if (requestedFields.contains(UserField.EMAIL)) {
            query.append(" email");
        }
        if (requestedFields.contains(UserField.PROFILE)) {
            query.append(" profile { avatar bio }");
        }
        if (requestedFields.contains(UserField.POSTS)) {
            query.append(" recentPosts(limit: 5) { id title }");
        }

        query.append(" } }");
        return query.toString();
    }
}
```

GraphQL's primary advantage is requesting only the fields you need. The over-fetching example requests the user's entire profile, posts, settings, and billing data when only name and email are needed for a summary view. This wastes bandwidth, slows response times, and increases server load. The optimized query requests exactly the fields needed and uses query variables for flexibility. The dynamic field selection pattern takes this further by building queries from a set of requested fields, allowing different callers to request different data without maintaining separate query strings for every use case.

### Caching Strategy

```java
@Configuration
public class GraphQLCacheConfig {

    @Bean
    public CacheManager graphQLCacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .recordStats());
        return cacheManager;
    }
}

@Service
public class CachedGraphQLClient {

    private final CacheManager cacheManager;
    private final WebClient webClient;

    public CachedGraphQLClient(CacheManager cacheManager, WebClient webClient) {
        this.cacheManager = cacheManager;
        this.webClient = webClient;
    }

    @Cacheable(value = "graphqlQueries", key = "#query + #variables.hashCode()")
    public <T> T executeQuery(String query, Map<String, Object> variables, Class<T> type) {
        return webClient.post()
            .uri("/graphql")
            .bodyValue(new GraphQLRequest(query, variables))
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<T>>() {})
            .map(GraphQLResponse::getData)
            .block();
    }

    @CacheEvict(value = "graphqlQueries", allEntries = true)
    public void invalidateCache() {
        log.info("GraphQL query cache invalidated");
    }
}
```

Caching GraphQL queries requires careful consideration because the caching key must include both the query string and the variables — the same query with different variable values returns different results. The `@Cacheable` annotation with `key = "#query + #variables.hashCode()"` ensures that cache entries are unique per query-variable combination. Caffeine with a 5-minute TTL and 1000-entry limit provides an in-memory cache that reduces latency for frequently executed queries without consuming excessive memory. The `@CacheEvict` method allows manual invalidation when data freshness is critical, such as after a mutation.

---

## Common Mistakes

### Mistake 1: Not Using Variables

```java
// WRONG: String concatenation in queries
@Service
public class BrokenClient {

    public User getUser(String id) {
        String query = "{ user(id: \"" + id + "\") { id name } }";  // SQL injection-like risk!
        return execute(query);
    }
}

// CORRECT: Use query variables
@Service
public class CorrectClient {

    public User getUser(String id) {
        String query = "query GetUser($id: ID!) { user(id: $id) { id name } }";
        return execute(query, Map.of("id", id), User.class);
    }
}
```

String concatenation in GraphQL queries is dangerous — it opens the door to injection attacks where malicious input could alter the query structure, and it prevents the server from caching query plans since the query text changes on every invocation. Using variables via `Map.of("id", id)` keeps the query text stable and the inputs safely separated. Stable query texts also enable persisted queries and server-side query plan caching, improving performance for frequently executed queries.

### Mistake 2: Ignoring Partial Errors

```java
// WRONG: Only checking data, ignoring errors
public OrderResponse createOrder(CreateOrderInput input) {
    OrderResponse response = executeMutation(CREATE_ORDER, input);
    return response;  // Might be incomplete!
}

// CORRECT: Check for partial errors
public OrderResponse createOrder(CreateOrderInput input) {
    GraphQLResponse<OrderResponse> response = executeFullMutation(CREATE_ORDER, input);
    if (response.hasErrors()) {
        log.warn("Order created with warnings: {}", response.getErrors());
        // Decide: accept partial or reject?
        if (hasCriticalErrors(response.getErrors())) {
            throw new OrderCreationException("Failed to create order", response.getErrors());
        }
    }
    return response.getData();
}
```

GraphQL can return partial results — data alongside errors. A mutation that partially succeeds (e.g., order creates but inventory reservation fails) returns both `data` and `errors`. Ignoring the errors field means the caller processes the incomplete result as if everything succeeded. The correct approach inspects errors and makes a decision: for critical errors, throw an exception so the caller can retry or roll back; for non-critical errors, log a warning and proceed with the partial data. Always document which errors your service considers critical versus informational.

### Mistake 3: N+1 Queries in Batch Processing

```java
// WRONG: Individual calls for each item (N+1 problem)
public List<UserResponse> getUsers(List<String> userIds) {
    return userIds.stream()
        .map(this::getUser)  // N separate GraphQL calls!
        .toList();
}

// CORRECT: Use batch query
public List<UserResponse> getUsers(List<String> userIds) {
    String query = """
        query GetUsers($ids: [ID!]!) {
            users(ids: $ids) { id name email }
        }
        """;
    return executeQuery(query, Map.of("ids", userIds), UsersList.class).getUsers();
}
```

Making N individual GraphQL calls for N items multiplies latency by N and creates N times the server load. Batch queries consolidate all requests into a single round trip, reducing total latency from N multiplied by individual latency to a single latency value. Most GraphQL APIs support list arguments for batch fetching — always check the schema for batch query support before implementing per-item loops. For APIs that do not support batching, consider using a DataLoader or batching proxy.

### Mistake 4: No Pagination for List Queries

```java
// WRONG: No pagination
public List<Product> getAllProducts() {
    String query = "{ products { id name price } }";
    return execute(query);  // Might explode!
}

// CORRECT: Always paginate
public SearchResult<Product> getProducts(int first, String after) {
    String query = """
        query GetProducts($first: Int!, $after: String) {
            products(first: $first, after: $after) {
                edges { node { id name price } cursor }
                pageInfo { hasNextPage endCursor }
            }
        }
        """;
    return execute(query, Map.of("first", first, "after", after));
}
```

Unpaginated list queries are a common production incident waiting to happen. A query that returns all products with no limit can return millions of rows, exhausting memory on both the client and server. Always use cursor-based pagination (`first`, `after`) for list fields. Cursor-based pagination is preferred over offset-based because it remains stable when items are added or removed between page fetches — a new item inserted on page 1 would shift all subsequent items by one with offset pagination, causing duplicates or misses.

### Mistake 5: Using Same Timeout for Queries and Mutations

```java
// WRONG: Same timeout for all operations
@Bean
public WebClient graphqlClient() {
    return WebClient.builder()
        .baseUrl("https://api.example.com/graphql")
        .clientConnector(new ReactorClientHttpConnector(
            HttpClient.create()
                .responseTimeout(Duration.ofSeconds(5))
        ))
        .build();
}

// CORRECT: Different timeouts per operation type
@Service
public class TimeoutAwareClient {

    public <T> T executeQuery(String query, Map<String, Object> variables, Class<T> type) {
        return execute(query, variables, type, Duration.ofSeconds(5));
    }

    public <T> T executeMutation(String mutation, Map<String, Object> variables, Class<T> type) {
        return execute(mutation, variables, type, Duration.ofSeconds(15));
    }

    private <T> T execute(String query, Map<String, Object> variables,
                           Class<T> type, Duration timeout) {
        return webClient.post()
            .uri("/graphql")
            .bodyValue(new GraphQLRequest(query, variables))
            .retrieve()
            .bodyToMono(new ParameterizedTypeReference<GraphQLResponse<T>>() {})
            .map(GraphQLResponse::getData)
            .timeout(timeout)
            .block();
    }
}
```

Mutations typically involve side effects (database writes, external API calls, event publishing) and take longer than read-only queries. Using the same aggressive timeout for both causes unnecessary mutation failures — the mutation might succeed but the client receives a timeout and retries, causing duplicate side effects. Separate timeouts allow queries to fail fast (5 seconds) while giving mutations adequate time (15 seconds) to complete. Apply this pattern consistently with a timeout-aware client that accepts a `Duration` parameter for flexible timeout configuration per operation type.

---

## Summary

GraphQL clients in Spring Boot require careful design for production use:

1. **Use WebClient or Apollo**: Both provide robust HTTP communication with proper configuration. WebClient offers finer control over the reactive pipeline, while Apollo provides type-safe code generation and normalized caching out of the box.
2. **Prefer variables over string interpolation**: Use `$variable` placeholders in queries and pass values via the `variables` map. This prevents injection attacks, enables server-side query plan caching, and keeps the query text stable for persisted query optimization.
3. **Always paginate list fields**: Use cursor-based pagination (`first`/`after`) rather than offset-based. Cursor pagination remains stable when items are inserted or deleted between pages, and it is the standard for production GraphQL APIs.
4. **Handle partial responses**: Check the `errors` field even when `data` is present. Partial responses occur when some resolvers succeed and others fail — ignoring errors means processing incomplete data. Decide per-operation whether partial data is acceptable or should trigger a rollback.
5. **Cache aggressively**: Use normalized cache (Apollo) or Caffeine-based query caching (WebClient) to reduce latency for frequently executed queries. Combine with Automatic Persisted Queries to reduce bandwidth for large query strings.
6. **Batch queries together**: Replace N+1 patterns with batch loading using list arguments or dedicated batch endpoints. A single batched query is orders of magnitude more efficient than N individual queries, both in network round trips and server processing load.

---

## References

- [GraphQL Specification](https://spec.graphql.org/)
- [Apollo Android (Java) Documentation](https://www.apollographql.com/docs/android/)
- [Spring GraphQL Documentation](https://docs.spring.io/spring-graphql/docs/current/reference/html/)
- [Netflix DGS Framework](https://netflix.github.io/dgs/)

---

Happy Coding