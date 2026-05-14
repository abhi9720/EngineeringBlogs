---
title: "Layered vs Hexagonal vs Clean Architecture"
description: "Compare layered, hexagonal, and clean architecture styles: trade-offs, use cases, and migration strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["layered-architecture", "hexagonal", "clean-architecture", "comparison"]
coverImage: "/images/layered-vs-hexagonal-vs-clean.png"
draft: false
---

## Overview

Three dominant architectural patterns shape backend applications today: Layered Architecture, Hexagonal Architecture (Ports and Adapters), and Clean Architecture. Each represents a different approach to separating concerns and managing dependencies. Understanding their differences, strengths, and weaknesses helps architects make informed decisions.

This comparison examines each architecture through code examples, dependency management, testability, and practical trade-offs.

## Layered Architecture

The traditional layered architecture organizes code into horizontal tiers. Each layer has a specific responsibility and depends only on the layer directly below it.

```
Presentation Layer (Controllers)
       |
Business Logic Layer (Services)
       |
Data Access Layer (Repositories)
       |
Database
```

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping
    public ResponseEntity<UserResponse> createUser(@RequestBody CreateUserRequest request) {
        UserResponse response = userService.createUser(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
}

@Service
public class UserService {
    private final UserRepository userRepository;
    private final EmailService emailService;

    public UserService(UserRepository userRepository, EmailService emailService) {
        this.userRepository = userRepository;
        this.emailService = emailService;
    }

    @Transactional
    public UserResponse createUser(CreateUserRequest request) {
        if (userRepository.existsByEmail(request.email())) {
            throw new DuplicateEmailException(request.email());
        }
        User user = new User(request.name(), request.email(), request.role());
        User saved = userRepository.save(user);
        emailService.sendWelcomeEmail(saved.getEmail(), saved.getName());
        return UserResponse.from(saved);
    }
}

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    boolean existsByEmail(String email);
    Optional<User> findByEmail(String email);
}
```

### Strengths

- Simple and intuitive for small to medium applications.
- Follows the natural structure of most frameworks.
- Easy to onboard new developers.

### Weaknesses

- The business layer often becomes a "god layer" with mixed concerns.
- Database-driven design: the service layer often mirrors repository methods.
- Framework coupling: business logic depends on framework annotations and infrastructure.
- Difficult to test business logic without setting up the entire Spring context.

## Hexagonal Architecture

Hexagonal architecture, or Ports and Adapters, inverts the dependency direction. The core business logic defines ports (interfaces), and external systems implement adapters.

```
[Web Adapter] --> [Inbound Port] --> [Application Core] --> [Outbound Port] --> [DB Adapter]
[MQ Adapter] --> [Inbound Port] --> [Application Core] --> [Outbound Port] --> [API Adapter]
```

```java
// Core: Inbound port
public interface CreateUserUseCase {
    User createUser(CreateUserCommand command);
}

// Core: Outbound port
public interface UserRepositoryPort {
    User save(User user);
    boolean existsByEmail(Email email);
    Optional<User> findByEmail(Email email);
}

public interface NotificationPort {
    void sendWelcomeEmail(Email recipient, String name);
}

// Core: Application service
public class CreateUserService implements CreateUserUseCase {
    private final UserRepositoryPort userRepository;
    private final NotificationPort notificationPort;

    public CreateUserService(UserRepositoryPort userRepository, NotificationPort notificationPort) {
        this.userRepository = userRepository;
        this.notificationPort = notificationPort;
    }

    @Override
    public User createUser(CreateUserCommand command) {
        Email email = new Email(command.email());
        if (userRepository.existsByEmail(email)) {
            throw new DuplicateEmailException(email);
        }
        User user = new User(command.name(), email, Role.valueOf(command.role()));
        User saved = userRepository.save(user);
        notificationPort.sendWelcomeEmail(saved.getEmail(), saved.getName());
        return saved;
    }
}

// Adapter: Web inbound adapter
@RestController
@RequestMapping("/api/users")
public class UserWebAdapter {
    private final CreateUserUseCase createUserUseCase;

    public UserWebAdapter(CreateUserUseCase createUserUseCase) {
        this.createUserUseCase = createUserUseCase;
    }

    @PostMapping
    public ResponseEntity<UserResponse> createUser(@RequestBody CreateUserRequest request) {
        CreateUserCommand command = new CreateUserCommand(
            request.name(), request.email(), request.role());
        User user = createUserUseCase.createUser(command);
        return ResponseEntity.status(HttpStatus.CREATED).body(UserResponse.from(user));
    }
}

// Adapter: Persistence outbound adapter
@Repository
public class UserJpaAdapter implements UserRepositoryPort {
    private final SpringDataUserRepository jpaRepository;
    private final UserMapper mapper;

    public UserJpaAdapter(SpringDataUserRepository jpaRepository, UserMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    @Override
    public User save(User user) {
        return mapper.toDomain(jpaRepository.save(mapper.toEntity(user)));
    }

    @Override
    public boolean existsByEmail(Email email) {
        return jpaRepository.existsByEmail(email.value());
    }

    @Override
    public Optional<User> findByEmail(Email email) {
        return jpaRepository.findByEmail(email.value()).map(mapper::toDomain);
    }
}
```

## Clean Architecture

Clean Architecture extends hexagonal concepts with explicit layers: Entities, Use Cases, Interface Adapters, and Frameworks & Drivers.

```
Frameworks & Drivers (Web, DB, MQ)
    Interface Adapters (Controllers, Presenters, Gateways)
        Application Business Rules (Use Cases)
            Enterprise Business Rules (Entities)
```

```java
// Layer 0: Enterprise Business Rules (Entities)
public class User {
    private UserId id;
    private String name;
    private Email email;
    private Role role;
    private boolean active;

    public User(UserId id, String name, Email email, Role role) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.role = role;
        this.active = true;
    }

    public void deactivate() {
        if (role == Role.ADMIN) {
            throw new IllegalStateException("Cannot deactivate admin users");
        }
        this.active = false;
    }

    public boolean isActive() { return active; }
    public UserId getId() { return id; }
    public Email getEmail() { return email; }
}

// Layer 1: Application Business Rules (Use Cases)
public class CreateUserUseCase {
    private final UserRepository userRepository;
    private final NotificationService notificationService;

    public CreateUserUseCase(UserRepository userRepository, NotificationService notificationService) {
        this.userRepository = userRepository;
        this.notificationService = notificationService;
    }

    public User execute(CreateUserRequest request) {
        Email email = new Email(request.email());
        if (userRepository.findByEmail(email).isPresent()) {
            throw new UserAlreadyExistsException(email);
        }
        User user = new User(UserId.generate(), request.name(), email, Role.fromString(request.role()));
        User saved = userRepository.save(user);
        notificationService.sendWelcome(new WelcomeNotification(saved.getEmail(), saved.getName()));
        return saved;
    }
}

// Layer 2: Interface Adapters
@RestController
@RequestMapping("/api/users")
public class UserController {
    private final CreateUserUseCase createUserUseCase;
    private final UserPresenter presenter;

    public UserController(CreateUserUseCase createUserUseCase, UserPresenter presenter) {
        this.createUserUseCase = createUserUseCase;
        this.presenter = presenter;
    }

    @PostMapping
    public ResponseEntity<UserResponseModel> createUser(@RequestBody CreateUserRequest request) {
        try {
            User user = createUserUseCase.execute(request);
            return ResponseEntity.status(HttpStatus.CREATED)
                .body(presenter.present(user));
        } catch (UserAlreadyExistsException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new UserResponseModel(null, "User already exists"));
        }
    }
}

// Layer 3: Frameworks & Drivers
@Repository
public interface JpaUserRepository extends JpaRepository<UserEntity, String> {}

@Component
public class UserRepositoryImpl implements UserRepository {
    private final JpaUserRepository jpaRepository;
    private final UserEntityMapper mapper;

    public UserRepositoryImpl(JpaUserRepository jpaRepository, UserEntityMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    @Override
    public User save(User user) {
        return mapper.toDomain(jpaRepository.save(mapper.toEntity(user)));
    }

    @Override
    public Optional<User> findByEmail(Email email) {
        return jpaRepository.findByEmail(email.value()).map(mapper::toDomain);
    }
}
```

## Comparison Table

| Aspect | Layered | Hexagonal | Clean |
|--------|---------|-----------|-------|
| Dependency direction | Top-down | Inward | Inward |
| Business logic isolation | Low | High | Very high |
| Framework coupling | High | Low | Very low |
| Testability | Medium | High | Very high |
| Complexity | Low | Medium | High |
| Learning curve | Low | Medium | High |
| Refactoring cost | Low | Medium | Medium |
| Team scaling | Low | Medium | High |
| Use case clarity | Low | High | Very high |

## Migration Strategies

### From Layered to Hexagonal

1. Identify core business logic and extract it into a domain module.
2. Define interfaces (ports) for each external dependency.
3. Create adapters that implement ports using existing implementations.
4. Remove direct dependencies between business logic and infrastructure.

```java
// Step 1: Extract interfaces
public interface UserRepository {
    User save(User user);
    boolean existsByEmail(String email);
}

// Step 2: Create adapter wrapping existing implementation
@Component
public class UserRepositoryAdapter implements UserRepository {
    private final UserRepository existingRepo;

    public UserRepositoryAdapter(UserRepository existingRepo) {
        this.existingRepo = existingRepo;
    }

    @Override
    public User save(User user) {
        return existingRepo.save(user);
    }

    @Override
    public boolean existsByEmail(String email) {
        return existingRepo.existsByEmail(email);
    }
}
```

### From Hexagonal to Clean

1. Separate entities from use cases into distinct packages.
2. Add explicit use case classes for each business operation.
3. Introduce presenter interfaces for response formatting.
4. Organize into the four concentric layers.

## When to Choose Which

| Architecture | Best For |
|-------------|----------|
| Layered | Simple CRUD apps, prototypes, small teams |
| Hexagonal | Complex business domains, need for testability, multiple delivery mechanisms |
| Clean | Very complex domains, long-lived enterprise systems, DDD implementations |

## Common Mistakes

### Over-Engineering

```java
// Wrong: Clean Architecture overhead for a simple CRUD
public class CreateProductUseCase {
    // 5 interfaces, 7 classes for a simple product creation
}

// Correct: Layered architecture is fine for simple operations
@Service
public class ProductService {
    public Product createProduct(CreateProductRequest request) {
        return productRepository.save(request.toEntity());
    }
}
```

### Mixing Patterns

```java
// Wrong: Layered structure with hexagonal naming but no actual isolation
@Service
public class OrderService implements OrderUseCase {
    @Autowired
    private OrderRepositoryPort orderRepository; // "port" but service still has framework deps
}
```

## Best Practices

1. Start with layered architecture and refactor toward hexagonal as complexity grows.
2. Keep the domain model free of framework dependencies regardless of architecture.
3. Use dependency injection to invert control at module boundaries.
4. Measure architectural fitness functions (testability, build time, deployment time).
5. Ensure the team understands the architectural rationale before adopting complex patterns.

## Summary

Layered architecture is simple and sufficient for many applications. Hexagonal architecture adds ports and adapters for better isolation and testability. Clean Architecture extends this with clearly defined layer responsibilities. Choose the simplest architecture that meets your current needs, and evolve as complexity demands.

## References

- Martin, R. C. "Clean Architecture"
- Cockburn, A. "Hexagonal Architecture"
- Fowler, M. "Patterns of Enterprise Application Architecture"
- Evans, E. "Domain-Driven Design"

Happy Coding