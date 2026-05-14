---
title: 'Micronaut: Compile-Time DI Framework'
description: >-
  Master Micronaut framework: compile-time dependency injection, AOT
  optimization, reactive support, cloud-native features, and building efficient
  JVM microservices
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - java
  - micronaut
  - dependency-injection
  - microservices
coverImage: /images/micronaut-basics.png
draft: false
order: 10
---
## Overview

Micronaut is a modern, JVM-based framework for building microservices and serverless applications. Unlike Spring and Quarkus that use runtime reflection, Micronaut performs dependency injection at compile time, resulting in faster startup and smaller memory footprint.

Micronaut's compile-time dependency injection is its defining feature. Traditional frameworks like Spring use runtime reflection — scanning the classpath, analyzing annotations, and building dependency graphs at startup. This is the primary cause of slow JVM startup. Micronaut instead processes annotations during compilation, generating Java source code that wires dependencies together. The result is startup comparable to Go or Rust applications.

## Core Concept: Compile-Time DI

```java
// Traditional runtime DI (Spring/Guice):
// - Scans classpath at startup
// - Uses reflection for injection
// - Processes annotations at runtime
// - Slow startup, high memory

// Micronaut compile-time DI:
// - Processes annotations at compile time
// - Generates Java code
// - No reflection at runtime
// - Fast startup, low memory
```

## Dependencies

Micronaut's dependency structure is modular. The `micronaut-inject` artifact handles DI, `micronaut-http-server-netty` provides the Netty-based HTTP server, and `micronaut-http-client` offers declarative HTTP clients. Unlike Spring Boot's all-in-one starters, Micronaut encourages pulling only what you need — a design that keeps the runtime footprint small.

```xml
<dependency>
    <groupId>io.micronaut</groupId>
    <artifactId>micronaut-inject</artifactId>
</dependency>
<dependency>
    <groupId>io.micronaut</groupId>
    <artifactId>micronaut-http-server-netty</artifactId>
</dependency>
<dependency>
    <groupId>io.micronaut</groupId>
    <artifactId>micronaut-http-client</artifactId>
</dependency>
```

## Basic Application

The `Micronaut.run()` call starts the application. Unlike Spring Boot's `SpringApplication.run()` which triggers classpath scanning, Micronaut's startup is primarily loading generated classes — making it an order of magnitude faster. The application class itself needs no `@SpringBootApplication` equivalent; Micronaut discovers beans through the generated code.

```java
import io.micronaut.runtime.Micronaut;

public class Application {
    public static void main(String[] args) {
        Micronaut.run(Application.class, args);
    }
}
```

## Controllers

Micronaut controllers use JAX-RS-inspired annotations: `@Controller`, `@Get`, `@Post`, `@Body`, etc. The controller takes dependencies through constructor injection (no `@Autowired` needed). Micronaut's `HttpResponse` type provides a fluent API for setting status codes, headers, and body — `HttpResponse.created(user)` sets 201 with location header in one call. This contrasts with Spring Boot's `ResponseEntity` builder pattern.

```java
import io.micronaut.http.annotation.*;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.MediaType;
import javax.validation.Valid;
import java.net.URI;

@Controller("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @Get
    public List<User> getAll() {
        return userService.findAll();
    }

    @Get("/{id}")
    public User getOne(Long id) {
        return userService.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }

    @Post
    public HttpResponse<User> create(@Body @Valid CreateUserRequest request) {
        User user = userService.create(request);
        return HttpResponse.created(user)
            .headers(headers -> headers.location(
                URI.create("/api/users/" + user.getId())
            ));
    }

    @Put("/{id}")
    public User update(Long id, @Body @Valid UpdateUserRequest request) {
        return userService.update(id, request);
    }

    @Delete("/{id}")
    @Status(HttpStatus.NO_CONTENT)
    public void delete(Long id) {
        userService.delete(id);
    }
}
```

## Dependency Injection

Micronaut uses Jakarta Inject (`jakarta.inject.Singleton`, `jakarta.inject.Inject`) rather than framework-specific annotations. This means beans are portable across Jakarta EE-compatible containers. Constructor injection is the default and recommended approach — it enables immutable beans and simplifies testing since dependencies are explicit.

### Bean Registration

```java
import jakarta.inject.Singleton;
import jakarta.inject.Inject;

@Singleton
public class UserService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmailService emailService;

    public UserService(UserRepository userRepository,
                      PasswordEncoder passwordEncoder,
                      EmailService emailService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.emailService = emailService;
    }

    public User create(CreateUserRequest request) {
        User user = new User(request.getEmail(),
            passwordEncoder.encode(request.getPassword()));
        User saved = userRepository.save(user);
        emailService.sendWelcomeEmail(saved.getEmail());
        return saved;
    }
}
```

Micronaut's scopes map closely to familiar concepts but add some unique ones. `@Singleton` creates one instance per JVM. `@Prototype` creates a new instance per injection point. `@RequestScope` creates a bean per HTTP request — useful for request-scoped data like trace IDs. `@Refreshable` beans can be hot-reloaded via the `/refresh` endpoint without restarting the application, enabling runtime configuration updates.

### Bean Scopes

```java
import io.micronaut.context.annotation.*;
import jakarta.inject.Singleton;

@Singleton
public class CacheService { }

@Prototype
public class TmpIdGenerator { }

@Context
public class StartupValidator { }

@RequestScope
public class RequestContext {
    private String requestId;
    private String userId;
    // Getters and setters
}

@Refreshable
public class DynamicConfig {
    private String apiKey;
    // Refreshed via /refresh endpoint
}
```

Factory beans let you create beans that are not simple class instances — for example, beans that require configuration parameters or conditional setup. The `@Factory` annotation marks a class whose `@Bean` methods produce injectable instances. The `@Requires` annotation adds conditional bean registration based on configuration properties, classpath presence, or environment, enabling feature flags without runtime overhead.

### Factory Beans

```java
import io.micronaut.context.annotation.Factory;
import io.micronaut.context.annotation.Bean;

@Factory
public class HttpClientFactory {

    @Bean
    public HttpClient httpClient(@Value("${app.api.url}") String baseUrl) {
        return HttpClient.create(baseUrl)
            .connectTimeout(Duration.ofSeconds(5))
            .readTimeout(Duration.ofSeconds(10));
    }

    @Bean
    @Requires(property = "cache.enabled", value = "true")
    public CacheManager cacheManager() {
        return new CaffeineCacheManager();
    }
}
```

## Configuration

Micronaut's configuration system processes `application.yml` at build time, not runtime. This means configuration values are validated during compilation, catching typos and type mismatches early. Environment variable interpolation with `${DB_USER}` syntax provides secure credential injection without hardcoding secrets in configuration files.

```yaml
micronaut:
  application:
    name: user-service
  server:
    port: 8080
    netty:
      worker:
        threads: 8
      child-options:
        auto-read: true

app:
  database:
    url: jdbc:postgresql://localhost:5432/mydb
    username: ${DB_USER}
    password: ${DB_PASSWORD}
  cache:
    enabled: true
    ttl: 300
```

Type-safe configuration in Micronaut uses interfaces with getter methods rather than classes with fields. This design enables compile-time implementation generation — Micronaut creates the implementation class during compilation, avoiding reflection at runtime. The `@EachProperty` annotation enables dynamic configuration for data sources or clients where the number of instances is determined by the configuration structure.

### Type-Safe Configuration

```java
import io.micronaut.context.annotation.ConfigurationProperties;
import io.micronaut.context.annotation.EachProperty;
import io.micronaut.core.annotation.NonNull;
import javax.validation.constraints.Min;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@ConfigurationProperties("app.database")
public interface DatabaseConfig {
    @NonNull
    String getUrl();
    String getUsername();
    String getPassword();
    @Min(1)
    int getMaxPoolSize();
}

@ConfigurationProperties("app.cache")
public interface CacheConfig {
    boolean isEnabled();
    @Min(60)
    int getTtl();
    Map<String, CacheSource> getSources();
}

@EachProperty("app.datasources")
public interface DataSourceConfig {
    String getUrl();
    String getUsername();
    String getPassword();
}
```

## Reactive Support

Micronaut has first-class reactive support through RxJava. Controllers can return `Single` (single value) or `Flowable` (stream of values) directly — Micronaut handles the subscription and back-pressure automatically. This reactive support works with the Netty event loop, enabling non-blocking request processing from HTTP to database and back without thread blocking.

```java
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.reactivex.Flowable;
import io.reactivex.Single;

@Controller("/api/reactive")
public class ReactiveUserController {

    private final ReactiveUserService userService;

    public ReactiveUserController(ReactiveUserService userService) {
        this.userService = userService;
    }

    @Get
    public Flowable<User> getAll() {
        return userService.findAll();
    }

    @Get("/{id}")
    public Single<User> getOne(Long id) {
        return userService.findById(id);
    }
}
```

## HTTP Client

Micronaut's declarative HTTP client is one of its standout features. Define an interface with annotations, and Micronaut generates the implementation at compile time — no runtime proxies, no reflection. The `@Client` annotation specifies the base URL, and method annotations define endpoints. This same approach works for service-to-service communication in microservice architectures, replacing manual `RestTemplate` or `WebClient` usage.

```java
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Post;
import io.micronaut.http.client.annotation.Client;
import io.reactivex.Single;

@Client("https://api.external.com")
public interface ExternalApiClient {

    @Get("/users/{id}")
    Single<ExternalUser> getUser(String id);

    @Get("/users/{id}/orders")
    Single<List<ExternalOrder>> getUserOrders(String id);

    @Post("/orders")
    Single<ExternalOrder> createOrder(@Body CreateOrderRequest request);
}
```

## Testing

Micronaut's `@MicronautTest` annotation bootstraps the application context for integration tests. It starts the embedded server, injects beans, and supports `@Inject` directly in tests. The HTTP client injected with `@Client("/")` enables end-to-end testing without starting an external server. Tests run fast because the context starts in milliseconds — a significant improvement over Spring Boot's multi-second test bootstrap.

```java
import io.micronaut.test.extensions.junit5.annotation.MicronautTest;
import org.junit.jupiter.api.Test;
import jakarta.inject.Inject;

@MicronautTest
class UserServiceTest {

    @Inject
    UserService userService;

    @Test
    void shouldCreateUser() {
        CreateUserRequest request = new CreateUserRequest(
            "test@example.com", "Test User", "password123"
        );

        User user = userService.create(request);

        assertNotNull(user.getId());
        assertEquals("test@example.com", user.getEmail());
    }
}

@MicronautTest
class UserControllerTest {

    @Inject
    @Client("/")
    HttpClient client;

    @Test
    void shouldReturnUsers() {
        List<User> users = client.toBlocking()
            .retrieve("/api/users", Argument.listOf(User.class));

        assertNotNull(users);
        assertTrue(users.size() > 0);
    }
}
```

## Best Practices

1. **Leverage compile-time DI** - Micronaut's AOT processing enables fast startup
2. **Use @ConfigurationProperties** for type-safe configuration
3. **Prefer constructor injection** for immutability
4. **Use @Requires annotations** for conditional bean registration
5. **Use reactive types** for I/O-bound operations
6. **Leverage Micronaut's HTTP client** for service-to-service communication
7. **Use @MicronautTest** for integration testing

## Common Mistakes

### Mistake 1: Using Reflection-Heavy Libraries

```java
// Wrong: Micronaut compiles at build time
// Libraries using runtime reflection may not work
@Singleton
public class ReflectionHeavyService {
    // May fail in native image or AOT context
}
```

```java
// Correct: Use Micronaut-native libraries
@Singleton
public class MicronautCompatibleService {
    private final UserRepository repository;

    public MicronautCompatibleService(UserRepository repository) {
        this.repository = repository;
    }
}
```

### Mistake 2: Missing Annotation Processor

```xml
<!-- Wrong: Missing Micronaut annotation processor -->
<dependency>
    <groupId>io.micronaut</groupId>
    <artifactId>micronaut-inject</artifactId>
</dependency>
```

```xml
<!-- Correct: Add annotation processor -->
<dependency>
    <groupId>io.micronaut</groupId>
    <artifactId>micronaut-inject</artifactId>
    <scope>provided</scope>
</dependency>
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <annotationProcessorPaths>
            <path>
                <groupId>io.micronaut</groupId>
                <artifactId>micronaut-inject-java</artifactId>
            </path>
        </annotationProcessorPaths>
    </configuration>
</plugin>
```

## Summary

Micronaut's compile-time dependency injection provides fast startup, low memory, and excellent GraalVM native image support. Its API is familiar to Spring developers while delivering better cloud-native performance. Use @Singleton for services, @ConfigurationProperties for config, and @Client for HTTP communication.

## References

- [Micronaut Documentation](https://docs.micronaut.io/latest/guide/)
- [Micronaut DI](https://docs.micronaut.io/latest/guide/#ioc)
- [Micronaut Configuration](https://docs.micronaut.io/latest/guide/#config)
- [Micronaut Testing](https://micronaut-projects.github.io/micronaut-test/latest/guide/)

Happy Coding
