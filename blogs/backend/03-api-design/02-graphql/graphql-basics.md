---
title: GraphQL Basics
description: >-
  Master GraphQL schema design, queries, mutations, GraphQL Java implementation,
  and data fetching patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - graphql
  - graphql-java
  - api-design
  - schema
coverImage: /images/backend/api-design/graphql/graphql-basics.png
draft: false
order: 10
---
# GraphQL Basics

## Overview

GraphQL is a query language for APIs that allows clients to request exactly the data they need. Unlike REST, GraphQL provides a single endpoint, strongly typed schema, and declarative data fetching. This reduces over-fetching and under-fetching while enabling efficient client-server communication.

---

## Schema Definition Language

A GraphQL schema is written in Schema Definition Language (SDL), which defines the types, relationships, and entry points for data access. Every GraphQL API starts with a schema that serves as the contract between client and server. The schema is strongly typed, meaning clients know exactly what data shape to expect and the server validates queries against the schema before execution.

### Type System

The type system defines the shape of data in your API. Each type has fields with specific scalar types (String, Int, Float, Boolean, ID) or references to other custom types. The `!` suffix marks a field as non-nullable — GraphQL guarantees this field will always return a value. The `[Type!]!` syntax represents a non-nullable list of non-nullable items: the list itself cannot be null, and no item in the list can be null. This precise nullability modeling is one of GraphQL's key differentiators from REST.

```graphql
# Core scalar types: String, Int, Float, Boolean, ID
# Custom types define the shape of data

type User {
  id: ID!
  name: String!
  email: String!
  age: Int
  posts: [Post!]!
  createdAt: String!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  comments: [Comment!]!
  published: Boolean!
}

type Comment {
  id: ID!
  text: String!
  author: User!
  post: Post!
}
```

The `Query` and `Mutation` types are the entry points for all operations in a GraphQL API — every request must start from one of these root types. Queries are used for reading data and execute in parallel by default. Mutations are used for writing data and execute sequentially to prevent race conditions. A well-designed schema organizes queries and mutations by domain (users, posts, orders) and provides meaningful pagination and filtering arguments for list fields. Note how each field returns nullable types appropriately — for example, `user(id: ID!): User` returns null if the user doesn't exist (no 404 error), while `users: [User!]!` always returns an array.

### Query and Mutation Types

```graphql
# Entry points for reading data
type Query {
  user(id: ID!): User
  users(page: Int, size: Int): [User!]!
  post(id: ID!): Post
  posts(search: String): [Post!]!
}

# Entry points for writing data
type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
  createPost(input: CreatePostInput!): Post!
}
```

Input types are GraphQL's mechanism for passing complex objects as arguments to mutations and queries. Unlike regular types (which use `type` keyword and can have resolvers), input types use the `input` keyword and consist only of scalar fields. They are essential for mutations with multiple parameters because they keep the argument list clean and allow field-level validation. Note the difference between `CreateUserInput` (all fields required) and `UpdateUserInput` (all fields optional) — this pattern reflects that creation typically requires all fields while updates only need changed fields.

### Input Types

```graphql
input CreateUserInput {
  name: String!
  email: String!
  age: Int
}

input UpdateUserInput {
  name: String
  email: String
  age: Int
}

input CreatePostInput {
  title: String!
  content: String!
  authorId: ID!
}
```

---

## GraphQL Java Implementation

GraphQL Java is the reference implementation for building GraphQL servers in Java. It provides a schema parser, execution engine, and data fetching infrastructure. The implementation involves three main components: the schema definition (`.graphqls` files), the runtime wiring that connects schema fields to data fetchers, and the execution engine that processes incoming queries. Spring Boot with `spring-boot-starter-graphql` simplifies this setup with auto-configuration and annotation-driven resolvers.

### Schema Configuration

The `RuntimeWiring` builder maps schema fields to their corresponding data fetchers — the methods that actually fetch data. Each field in the `Query` and `Mutation` types needs a data fetcher that knows how to retrieve that data. The wiring is explicit: you connect the schema field name (e.g., `"user"`) to a method reference (e.g., `userFetcher::getUserById`). This explicit wiring gives you full control over data fetching logic and enables dependency injection of services into the data fetchers.

```java
@Component
public class GraphQLProvider {

    private final GraphQL graphQL;

    public GraphQLProvider(UserDataFetcher userFetcher, PostDataFetcher postFetcher) {
        String schema = loadSchema("graphql/schema.graphqls");

        RuntimeWiring wiring = RuntimeWiring.newRuntimeWiring()
            .type("Query", typeWiring -> typeWiring
                .dataFetcher("user", userFetcher::getUserById)
                .dataFetcher("users", userFetcher::getAllUsers)
                .dataFetcher("post", postFetcher::getPostById)
                .dataFetcher("posts", postFetcher::getAllPosts))
            .type("Mutation", typeWiring -> typeWiring
                .dataFetcher("createUser", userFetcher::createUser)
                .dataFetcher("updateUser", userFetcher::updateUser)
                .dataFetcher("deleteUser", userFetcher::deleteUser))
            .build();

        this.graphQL = GraphQL.newGraphQL(
            SchemaParser.newParser()
                .schemaString(schema)
                .build()
                .makeExecutableSchema(wiring)
        ).build();
    }

    public GraphQL getGraphQL() { return graphQL; }
}
```

Data fetchers are the resolver functions that populate each field in a GraphQL response. They receive the `DataFetchingEnvironment` which provides access to query arguments, context, and the parent object. Each data fetcher is responsible for a single field or query — this granularity enables parallel execution (fields at the same level are resolved concurrently) and selective fetching (only requested fields are resolved). A common pattern is to create dedicated data fetcher classes per domain (user, post, comment) that encapsulate the data access logic for that domain's fields.

### Data Fetchers

```java
@Component
public class UserDataFetcher {

    private final UserService userService;
    private final PostService postService;

    public UserDataFetcher(UserService userService, PostService postService) {
        this.userService = userService;
        this.postService = postService;
    }

    public User getUserById(DataFetchingEnvironment env) {
        String id = env.getArgument("id");
        return userService.findById(Long.parseLong(id));
    }

    public List<User> getAllUsers(DataFetchingEnvironment env) {
        Integer page = env.getArgument("page");
        Integer size = env.getArgument("size");
        return userService.findAll(page != null ? page : 0, size != null ? size : 20);
    }

    public User createUser(DataFetchingEnvironment env) {
        Map<String, Object> input = env.getArgument("input");
        CreateUserRequest request = new CreateUserRequest();
        request.setName((String) input.get("name"));
        request.setEmail((String) input.get("email"));
        request.setAge((Integer) input.get("age"));
        return userService.create(request);
    }

    public User updateUser(DataFetchingEnvironment env) {
        Long id = Long.parseLong(env.getArgument("id"));
        Map<String, Object> input = env.getArgument("input");
        UpdateUserRequest request = new UpdateUserRequest();
        request.setName((String) input.get("name"));
        request.setEmail((String) input.get("email"));
        return userService.update(id, request);
    }

    public boolean deleteUser(DataFetchingEnvironment env) {
        Long id = Long.parseLong(env.getArgument("id"));
        userService.delete(id);
        return true;
    }
}
```

The resolver pattern is how GraphQL handles relationships between types. Instead of eagerly loading all related data (which causes over-fetching), resolvers lazily fetch related objects only when the client requests them. A `PostResolver` might fetch the `author` (a User) and `comments` only when the client's query includes those fields. This lazy resolution is what makes GraphQL efficient — but it also introduces the N+1 problem where resolving a list of posts triggers separate database queries for each post's author, which is why DataLoader (covered later) is essential for production systems.

### Resolver Pattern for Relationships

```java
@Component
public class PostResolver implements GraphQLResolver<Post> {

    private final UserService userService;
    private final CommentService commentService;

    public PostResolver(UserService userService, CommentService commentService) {
        this.userService = userService;
        this.commentService = commentService;
    }

    public User author(Post post) {
        return userService.findById(post.getAuthorId());
    }

    public List<Comment> comments(Post post) {
        return commentService.findByPostId(post.getId());
    }
}

@Component
public class UserResolver implements GraphQLResolver<User> {

    private final PostService postService;

    public UserResolver(PostService postService) {
        this.postService = postService;
    }

    public List<Post> posts(User user) {
        return postService.findByAuthorId(user.getId());
    }
}
```

---

## GraphQL Controller

Unlike REST which exposes multiple endpoints for different resources, GraphQL uses a single endpoint (typically `/graphql`) for all queries and mutations. The controller receives a `GraphQLRequest` containing the query string, variables, and operation name, executes it through the GraphQL engine, and returns the response. Error handling in this controller returns both data and errors — GraphQL can return partial results with error information, allowing clients to display some data while handling specific failures.

### Single Endpoint

```java
@RestController
@RequestMapping("/graphql")
public class GraphQLController {

    private final GraphQL graphQL;

    public GraphQLController(GraphQLProvider provider) {
        this.graphQL = provider.getGraphQL();
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE,
                 produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> execute(
            @RequestBody GraphQLRequest request) {

        ExecutionInput executionInput = ExecutionInput.newExecutionInput()
            .query(request.getQuery())
            .variables(request.getVariables() != null
                ? request.getVariables() : Collections.emptyMap())
            .operationName(request.getOperationName())
            .build();

        ExecutionResult result = graphQL.execute(executionInput);

        Map<String, Object> response = new LinkedHashMap<>();

        if (!result.getErrors().isEmpty()) {
            response.put("errors", result.getErrors().stream()
                .map(error -> Map.of(
                    "message", error.getMessage(),
                    "locations", error.getLocations(),
                    "path", error.getPath()
                ))
                .toList());
        }

        if (result.getData() != null) {
            response.put("data", result.getData());
        }

        return ResponseEntity.ok(response);
    }
}

class GraphQLRequest {
    private String query;
    private Map<String, Object> variables;
    private String operationName;

    public String getQuery() { return query; }
    public void setQuery(String query) { this.query = query; }
    public Map<String, Object> getVariables() { return variables; }
    public void setVariables(Map<String, Object> variables) { this.variables = variables; }
    public String getOperationName() { return operationName; }
    public void setOperationName(String operationName) { this.operationName = operationName; }
}
```

---

## Query Examples

### Client Queries

```graphql
# Basic query - requesting specific fields
query GetUser {
  user(id: "1") {
    id
    name
    email
  }
}

# Nested query with relationships
query GetUserWithPosts {
  user(id: "1") {
    id
    name
    posts {
      id
      title
      comments {
        id
        text
      }
    }
  }
}

# Query with variables
query GetUser($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
    age
  }
}

# Mutation
mutation CreateNewUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    name
    email
  }
}
```

Aliases allow clients to request the same field multiple times with different arguments in a single query. This is useful for comparing data (e.g., fetching two users by different IDs). Fragments are reusable field selections that reduce query duplication — once defined, a fragment can be included in multiple queries or multiple places within the same query. Both features make GraphQL more expressive and help clients write concise, maintainable queries.

### Aliases and Fragments

```graphql
# Aliases for requesting same type with different args
query GetUsers {
  admin: user(id: "1") {
    ...UserFields
  }
  guest: user(id: "2") {
    ...UserFields
  }
}

fragment UserFields on User {
  id
  name
  email
  createdAt
}
```

---

## Best Practices

Building production-grade GraphQL APIs requires attention to schema design, performance optimization, security, and operational concerns. The following practices help ensure your GraphQL API is efficient, maintainable, and safe.

1. **Design schema around client needs**: Schema should reflect client use cases
2. **Use pagination**: Always paginate list fields
3. **Implement DataLoader**: Batch database queries to avoid N+1
4. **Limit query depth**: Prevent abusive queries
5. **Use input types**: Complex mutations should use input types
6. **Version through evolution**: Add fields rather than breaking changes
7. **Handle errors gracefully**: Return partial data with error details
8. **Authenticate at transport level**: Validate tokens once
9. **Monitor query complexity**: Track and limit query cost
10. **Use persisted queries**: For production, reduce overhead

```java
@Configuration
public class GraphQLConfig {

    @Bean
    public DataLoaderRegistry dataLoaderRegistry(UserService userService) {
        DataLoaderRegistry registry = new DataLoaderRegistry();

        DataLoader<Long, User> userLoader = DataLoader.newMappedDataLoader(ids -> {
            Map<Long, User> users = userService.findByIds(ids).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
            return CompletableFuture.completedFuture(users);
        });

        registry.register("userLoader", userLoader);
        return registry;
    }
}
```

---

## Common Mistakes

### Mistake 1: Over-fetching Due to Poor Resolver Design

The N+1 problem is the single most common performance issue in GraphQL. When a resolver fetches related data by calling the database once per parent record, a query for 100 posts with their authors results in 1 query for posts + 100 queries for authors = 101 database calls. DataLoader solves this by batching individual loads into a single batched query. Always use DataLoader for any field that resolves related data — especially for list fields where the N+1 problem multiplies quickly.

```graphql
# WRONG: Each comment fetches author separately
# This causes N+1 queries

# CORRECT: Use DataLoader for batch fetching
```

### Mistake 2: Not Paginating List Fields

Exposing unbounded list fields is dangerous — a query for `users { posts { comments } }` could trigger massive database queries and return enormous payloads. Every list field must have pagination parameters. The Relay Connection pattern (with `first`/`after` arguments, `edges` with cursors, and `pageInfo` with `hasNextPage`) is the industry standard for cursor-based pagination in GraphQL. It provides consistent, efficient pagination that works well with infinite scroll and prefetching.

```graphql
# WRONG: No pagination
type Query {
  users: [User!]!
}

# CORRECT: Pagination with connection pattern
type Query {
  users(first: Int, after: String): UserConnection!
}

type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
}
```

### Mistake 3: Exposing Internal IDs

Using auto-increment database IDs as GraphQL identifiers exposes your data model internals and allows clients to infer business intelligence (total users, growth rate, etc.). Opaque IDs (UUIDs or base64-encoded composite keys) prevent information leakage and make it harder for attackers to enumerate resources. The `ID` scalar type in GraphQL is designed for opaque identifiers — consumers should treat them as opaque strings, not interpretable values.

```graphql
# WRONG: Exposing database sequential IDs
# CORRECT: Use opaque IDs (UUID or base64 encoded)

type User {
  id: ID!  # Prefer UUID over auto-increment
}
```

---

## Summary

1. GraphQL provides strongly-typed schema for precise data fetching
2. Queries read data, mutations write data
3. Resolvers handle data fetching for each field
4. DataLoader batches database queries to prevent N+1
5. Always paginate list fields
6. Use input types for complex mutation parameters
7. Monitor query depth and complexity

---

## References

- [GraphQL Specification](https://spec.graphql.org/)
- [GraphQL Java Documentation](https://www.graphql-java.com/)
- [GraphQL Best Practices](https://graphql.org/learn/best-practices/)
- [Spring GraphQL Reference](https://docs.spring.io/spring-graphql/reference/)

Happy Coding
