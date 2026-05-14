---
title: "Spring WebFlux Basics"
description: "Learn Spring WebFlux: reactive controllers, functional endpoints, WebClient, reactive security, and building non-blocking REST APIs with Project Reactor"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - webflux
  - reactive
  - spring-web
coverImage: "/images/spring-webflux-basics.png"
draft: false
---

## Overview

Spring WebFlux is the reactive web framework in Spring, providing fully non-blocking, backpressure-ready APIs. It supports both annotation-based controllers (similar to Spring MVC) and functional routing. This guide covers building reactive REST APIs with WebFlux and Project Reactor.

WebFlux runs on Netty (by default), which uses an event loop model rather than the thread-per-request model of Tomcat. This makes WebFlux ideal for applications with high concurrency requirements, streaming endpoints, or long-lived connections like Server-Sent Events.

## Dependencies

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>
<dependency>
    <groupId>io.projectreactor</groupId>
    <artifactId>reactor-test</artifactId>
    <scope>test</scope>
</dependency>
```

## Reactive Controllers

### Basic Controller

The controller below defines a standard CRUD API with reactive return types. `Flux<User>` is used for multiple items (list, search), and `Mono<User>` for single items (get, create, update). The `Mono<Void>` return for delete indicates no response body.

Note that controller method parameters for the request body can also be reactive (`Mono<CreateUserRequest>`). This gives the framework full control over when to subscribe and deserialize, enabling backpressure on the request body itself.

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public Flux<User> getAllUsers() {
        return userService.findAllUsers();
    }

    @GetMapping("/{id}")
    public Mono<User> getUserById(@PathVariable Long id) {
        return userService.findById(id)
            .switchIfEmpty(Mono.error(new UserNotFoundException(id)));
    }

    @PostMapping
    public Mono<User> createUser(@Valid @RequestBody Mono<CreateUserRequest> request) {
        return request.flatMap(userService::createUser);
    }

    @PutMapping("/{id}")
    public Mono<User> updateUser(@PathVariable Long id,
                                  @Valid @RequestBody Mono<UpdateUserRequest> request) {
        return request.flatMap(req -> userService.updateUser(id, req));
    }

    @DeleteMapping("/{id}")
    public Mono<Void> deleteUser(@PathVariable Long id) {
        return userService.deleteUser(id);
    }

    @GetMapping("/search")
    public Flux<User> searchUsers(@RequestParam String query) {
        return userService.search(query);
    }
}
```

### Reactive Service Layer

The service layer composes reactive operations. The `createUser` method saves the user and then sends a welcome email, both non-blocking operations. The `flatMap` ensures the email is only sent after the user is saved. `thenReturn` preserves the saved user as the result after the email operation completes.

```java
@Service
public class UserService {
    private final UserRepository userRepository;
    private final NotificationService notificationService;

    public UserService(UserRepository userRepository,
                      NotificationService notificationService) {
        this.userRepository = userRepository;
        this.notificationService = notificationService;
    }

    public Flux<User> findAllUsers() {
        return userRepository.findAll();
    }

    public Mono<User> findById(Long id) {
        return userRepository.findById(id);
    }

    public Mono<User> createUser(CreateUserRequest request) {
        User user = new User(request.getEmail(), request.getName());
        return userRepository.save(user)
            .flatMap(savedUser ->
                notificationService.sendWelcomeEmail(savedUser)
                    .thenReturn(savedUser)
            );
    }

    public Mono<User> updateUser(Long id, UpdateUserRequest request) {
        return userRepository.findById(id)
            .switchIfEmpty(Mono.error(new UserNotFoundException(id)))
            .flatMap(existing -> {
                existing.setName(request.getName());
                existing.setEmail(request.getEmail());
                return userRepository.save(existing);
            });
    }

    public Mono<Void> deleteUser(Long id) {
        return userRepository.deleteById(id);
    }

    public Flux<User> search(String query) {
        return userRepository.findByNameContainingIgnoreCase(query);
    }
}
```

### Reactive Repository

```java
public interface UserRepository extends ReactiveCrudRepository<User, Long> {
    Mono<User> findByEmail(String email);
    Flux<User> findByNameContainingIgnoreCase(String name);
    Flux<User> findByActiveTrue();
    Mono<Long> countByRole(UserRole role);
}
```

## Functional Endpoints

Functional endpoints provide an alternative to annotation-based controllers. Instead of annotations, you define routes using `RouterFunction` and handler functions using `HandlerFunction`. This approach is more explicit and composable, making it easier to test and debug.

### Router Configuration

The router builder organizes routes by path prefix. Each HTTP method and path maps to a handler method. The builder supports nesting (`path()`) for cleaner route grouping, and you can add additional paths for admin endpoints or other concerns.

```java
@Configuration
public class UserRouterConfig {

    @Bean
    public RouterFunction<ServerResponse> userRoutes(UserHandler handler) {
        return RouterFunctions
            .route()
            .path("/api/users", builder -> builder
                .GET("/", handler::getAllUsers)
                .GET("/{id}", handler::getUserById)
                .POST("/", handler::createUser)
                .PUT("/{id}", handler::updateUser)
                .DELETE("/{id}", handler::deleteUser)
                .GET("/search", handler::searchUsers)
            )
            .path("/api/admin", builder -> builder
                .GET("/stats", handler::getStats)
            )
            .build();
    }
}
```

### Handler Functions

Handlers receive a `ServerRequest` and return `Mono<ServerResponse>`. The `ServerResponse` class provides static methods for building responses with status codes, headers, and bodies. The `bodyValue()` method sets the response body directly, while `body()` streams a reactive type.

```java
@Component
public class UserHandler {
    private final UserService userService;
    private final UserValidator validator;

    public UserHandler(UserService userService, UserValidator validator) {
        this.userService = userService;
        this.validator = validator;
    }

    public Mono<ServerResponse> getAllUsers(ServerRequest request) {
        return ServerResponse.ok().body(userService.findAllUsers(), User.class);
    }

    public Mono<ServerResponse> getUserById(ServerRequest request) {
        Long id = Long.valueOf(request.pathVariable("id"));
        return userService.findById(id)
            .flatMap(user -> ServerResponse.ok().bodyValue(user))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    public Mono<ServerResponse> createUser(ServerRequest request) {
        return request.bodyToMono(CreateUserRequest.class)
            .doOnNext(validator::validate)
            .flatMap(userService::createUser)
            .flatMap(user -> ServerResponse
                .created(URI.create("/api/users/" + user.getId()))
                .bodyValue(user));
    }

    public Mono<ServerResponse> updateUser(ServerRequest request) {
        Long id = Long.valueOf(request.pathVariable("id"));
        return request.bodyToMono(UpdateUserRequest.class)
            .flatMap(req -> userService.updateUser(id, req))
            .flatMap(user -> ServerResponse.ok().bodyValue(user))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    public Mono<ServerResponse> deleteUser(ServerRequest request) {
        Long id = Long.valueOf(request.pathVariable("id"));
        return userService.deleteUser(id)
            .then(ServerResponse.noContent().build());
    }

    public Mono<ServerResponse> searchUsers(ServerRequest request) {
        String query = request.queryParam("q")
            .orElseThrow(() -> new IllegalArgumentException("Query parameter 'q' is required"));
        return ServerResponse.ok().body(userService.search(query), User.class);
    }

    public Mono<ServerResponse> getStats(ServerRequest request) {
        return ServerResponse.ok().body(userService.getStats(), UserStats.class);
    }
}
```

## WebClient

### Reactive HTTP Client

`WebClient` is the reactive equivalent of `RestTemplate`. It supports non-blocking request/response with backpressure. The `retrieve()` method is the simplest way to get a response; `exchangeToMono()` gives more control over response handling.

The client below demonstrates error handling with `onStatus` to convert 4xx responses into business exceptions, timeouts, and retries with exponential backoff.

```java
@Component
public class ExternalApiClient {
    private final WebClient webClient;

    public ExternalApiClient(WebClient.Builder builder) {
        this.webClient = builder
            .baseUrl("https://api.external.com")
            .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .build();
    }

    public Mono<ExternalUser> getUser(String id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(ExternalUser.class)
            .timeout(Duration.ofSeconds(5))
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                .filter(throwable -> throwable instanceof IOException));
    }

    public Flux<ExternalOrder> getUserOrders(String userId) {
        return webClient.get()
            .uri("/users/{id}/orders", userId)
            .retrieve()
            .bodyToFlux(ExternalOrder.class)
            .timeout(Duration.ofSeconds(10));
    }

    public Mono<ExternalOrder> createOrder(CreateOrderRequest request) {
        return webClient.post()
            .uri("/orders")
            .bodyValue(request)
            .retrieve()
            .onStatus(HttpStatusCode::is4xxClientError, response ->
                response.bodyToMono(ErrorResponse.class)
                    .flatMap(error -> Mono.error(new ApiClientException(error.getMessage())))
            )
            .bodyToMono(ExternalOrder.class);
    }
}
```

### WebClient Configuration

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient webClient(WebClient.Builder builder) {
        return builder.build();
    }

    @Bean
    public WebClient timedWebClient() {
        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(
                HttpClient.create()
                    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                    .responseTimeout(Duration.ofSeconds(5))
                    .doOnConnected(conn -> conn
                        .addHandlerLast(new ReadTimeoutHandler(5))
                        .addHandlerLast(new WriteTimeoutHandler(5)))
            ))
            .filter(ExchangeFilterFunction.ofRequestProcessor(request ->
                Mono.just(ClientRequest.from(request)
                    .header("X-Request-Id", UUID.randomUUID().toString()).build())))
            .filter(logRequest()).filter(logResponse()).build();
    }

    private ExchangeFilterFunction logRequest() {
        return ExchangeFilterFunction.ofRequestProcessor(request -> {
            System.out.println("Request: " + request.method() + " " + request.url());
            return Mono.just(request);
        });
    }

    private ExchangeFilterFunction logResponse() {
        return ExchangeFilterFunction.ofResponseProcessor(response -> {
            System.out.println("Response: " + response.statusCode());
            return Mono.just(response);
        });
    }
}
```

## Reactive Security

Security in WebFlux uses `SecurityWebFilterChain` instead of `SecurityFilterChain`. The DSL is similar but operates on `ServerHttpSecurity`. JWT validation works the same way, with `oauth2ResourceServer` expecting reactive token validators.

```java
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
        return http
            .authorizeExchange(exchanges -> exchanges
                .pathMatchers(HttpMethod.GET, "/api/public/**").permitAll()
                .pathMatchers("/api/admin/**").hasRole("ADMIN")
                .pathMatchers("/api/users/**").hasAuthority("SCOPE_read:users")
                .anyExchange().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(withDefaults()))
            .csrf(csrf -> csrf.disable())
            .build();
    }
}
```

## Error Handling

```java
@ControllerAdvice
public class ReactiveExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public Mono<ServerResponse> handleUserNotFound(UserNotFoundException ex) {
        return ServerResponse.status(HttpStatus.NOT_FOUND)
            .bodyValue(new ErrorResponse("USER_NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(ValidationException.class)
    public Mono<ServerResponse> handleValidation(ValidationException ex) {
        return ServerResponse.status(HttpStatus.BAD_REQUEST)
            .bodyValue(new ErrorResponse("VALIDATION_ERROR", ex.getMessage()));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public Mono<ServerResponse> handleConstraintViolation(ConstraintViolationException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getConstraintViolations().forEach(violation ->
            errors.put(violation.getPropertyPath().toString(), violation.getMessage()));
        return ServerResponse.status(HttpStatus.BAD_REQUEST)
            .bodyValue(Map.of("error", "VALIDATION_ERROR", "details", errors));
    }
}
```

## Testing WebFlux

`@WebFluxTest` is the reactive equivalent of `@WebMvcTest`. It auto-configures `WebTestClient` and loads only the controller layer. Use `@MockBean` for mocked dependencies.

```java
@WebFluxTest(UserController.class)
class UserControllerTest {
    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private UserService userService;

    @Test
    void shouldReturnAllUsers() {
        when(userService.findAllUsers()).thenReturn(Flux.just(
            new User(1L, "john@example.com", "John"),
            new User(2L, "jane@example.com", "Jane")));

        webTestClient.get().uri("/api/users").exchange()
            .expectStatus().isOk()
            .expectBody().jsonPath("$.length()").isEqualTo(2)
            .jsonPath("$[0].email").isEqualTo("john@example.com");
    }

    @Test
    void shouldReturnUserById() {
        when(userService.findById(1L)).thenReturn(Mono.just(
            new User(1L, "john@example.com", "John")));

        webTestClient.get().uri("/api/users/{id}", 1L).exchange()
            .expectStatus().isOk()
            .expectBody(User.class)
            .consumeWith(response -> assertThat(response.getResponseBody().getEmail()).isEqualTo("john@example.com"));
    }

    @Test
    void shouldReturn404ForMissingUser() {
        when(userService.findById(99L)).thenReturn(Mono.empty());
        webTestClient.get().uri("/api/users/{id}", 99L).exchange()
            .expectStatus().isNotFound();
    }

    @Test
    void shouldCreateUser() {
        CreateUserRequest request = new CreateUserRequest("new@example.com", "New User");
        when(userService.createUser(any())).thenReturn(Mono.just(new User(3L, "new@example.com", "New User")));

        webTestClient.post().uri("/api/users").bodyValue(request).exchange()
            .expectStatus().isCreated().expectHeader().exists("Location");
    }
}
```

## Best Practices

1. **Use Flux for multiple values, Mono for single/empty** - never mix them incorrectly
2. **Avoid blocking calls** in reactive pipelines - no Thread.sleep() or blocking I/O
3. **Use flatMap for async operations** - map for sync transformations
4. **Always set timeouts** for external service calls
5. **Handle backpressure** appropriately - don't consume infinite streams without limits
6. **Use Reactor's error operators** (onErrorReturn, onErrorResume) for graceful degradation
7. **Test with StepVerifier** for reactive streams

## Common Mistakes

### Mistake 1: Blocking in Reactive Pipeline

```java
// Wrong: Blocking call inside reactive pipeline
public Flux<User> findAllUsers() {
    List<User> users = userRepository.findAll().collectList().block();
    return Flux.fromIterable(users);
}

// Correct: Keep everything reactive
public Flux<User> findAllUsers() {
    return userRepository.findAll();
}
```

### Mistake 2: Forgetting to Subscribe

```java
// Wrong: Nothing happens without subscribe
public void sendWelcomeEmail(User user) {
    emailService.sendEmail(user.getEmail(), "Welcome!").subscribe();
}

// Correct: Subscribe to trigger execution
public Mono<Void> sendWelcomeEmail(User user) {
    return emailService.sendEmail(user.getEmail(), "Welcome!");
}
```

## Summary

Spring WebFlux enables building non-blocking, reactive web applications with Project Reactor. Use annotation-based controllers for familiar MVC-style development, functional endpoints for more control, and WebClient for reactive HTTP clients. Always keep the pipeline reactive, handle errors properly, and test with WebTestClient.

## References

- [Spring WebFlux Documentation](https://docs.spring.io/spring-framework/reference/web/webflux.html)
- [Project Reactor Reference](https://projectreactor.io/docs/core/release/reference/)
- [WebClient Documentation](https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html)
- [Reactive Security](https://docs.spring.io/spring-security/reference/reactive/configuration/webflux.html)

Happy Coding
