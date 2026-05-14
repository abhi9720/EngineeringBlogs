---
title: "GraphQL Basics"
description: "Master GraphQL schema design, queries, mutations, GraphQL Java implementation, and data fetching patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - graphql
  - graphql-java
  - api-design
  - schema
coverImage: "/images/backend/api-design/graphql/graphql-basics.png"
draft: false
---

# GraphQL Basics

## Overview

GraphQL is a query language for APIs that allows clients to request exactly the data they need. Unlike REST, GraphQL provides a single endpoint, strongly typed schema, and declarative data fetching. This reduces over-fetching and under-fetching while enabling efficient client-server communication.

---

## Schema Definition Language

### Type System

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

### Schema Configuration

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

```graphql
# WRONG: Each comment fetches author separately
# This causes N+1 queries

# CORRECT: Use DataLoader for batch fetching
```

### Mistake 2: Not Paginating List Fields

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