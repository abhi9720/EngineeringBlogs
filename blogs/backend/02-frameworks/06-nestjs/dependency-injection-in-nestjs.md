---
title: Dependency Injection in NestJS
description: >-
  Deep dive into NestJS dependency injection system: providers, custom
  providers, injection scopes, circular dependencies, and advanced DI patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - nodejs
  - nestjs
  - dependency-injection
  - typescript
coverImage: /images/dependency-injection-in-nestjs.png
draft: false
order: 10
---
## Overview

NestJS has a powerful dependency injection system inspired by Angular. It supports constructor-based injection, custom providers, injection tokens, scopes, and circular dependency resolution. Understanding DI is essential for building maintainable, testable NestJS applications.

## Basic Dependency Injection

NestJS's DI system is inspired by Angular's. Providers are registered in modules and made available to constructors through TypeScript's type system. The framework uses the type information at runtime — since TypeScript types are erased during compilation, NestJS uses the `@Injectable()` decorator to emit metadata that the DI container reads. This hybrid approach gives type-safety at development time with runtime DI resolution.

### Constructor Injection

```typescript
@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly emailService: EmailService,
    @Inject('CACHE_SERVICE') private readonly cache: ICacheService
  ) {}
}

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, EmailService]
})
export class UsersModule {}
```

## Provider Types

NestJS supports four provider types, each serving different use cases. Class providers create instances from constructors. Value providers supply pre-initialized objects. Factory providers defer creation to a factory function with optional dependency injection. Existing providers create aliases, enabling interface-like abstraction without TypeScript's erased interfaces.

### Class Providers

```typescript
// Standard class provider
@Module({
  providers: [UsersService] // Shorthand for { provide: UsersService, useClass: UsersService }
})
export class UsersModule {}

// Class provider with implementation swap
@Module({
  providers: [
    {
      provide: UsersService,
      useClass: process.env.NODE_ENV === 'test'
        ? MockUsersService
        : UsersService
    }
  ]
})
export class UsersModule {}
```

The class provider shorthand `providers: [UsersService]` expands to `{ provide: UsersService, useClass: UsersService }`. The `useClass` variant allows environment-specific swapping — for example, replacing a real service with a mock during testing. This is NestJS's primary mechanism for dependency substitution, eliminating the need for a separate DI configuration file.

### Value Providers

```typescript
// Configuration values
export const DATABASE_CONFIG = 'DATABASE_CONFIG';

@Module({
  providers: [
    {
      provide: DATABASE_CONFIG,
      useValue: {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10),
        database: process.env.DB_NAME
      }
    }
  ]
})
export class DatabaseModule {}

// Usage
@Injectable()
export class DatabaseService {
  constructor(@Inject(DATABASE_CONFIG) private config: DatabaseConfig) {}
}
```

Value providers are ideal for configuration objects, third-party library instances, or constants. The `useValue` syntax pairs a string token with a literal value. Since there's no class to serve as the injection key, string tokens require the `@Inject('TOKEN')` decorator on the consumer side. This is a common pattern for database config, feature flags, and external service credentials.

### Factory Providers

```typescript
// Dynamic provider creation
@Module({
  providers: [
    {
      provide: 'CACHE_SERVICE',
      useFactory: (configService: ConfigService) => {
        const cacheType = configService.get('CACHE_TYPE');
        if (cacheType === 'redis') {
          return new RedisCacheService(configService);
        }
        return new InMemoryCacheService();
      },
      inject: [ConfigService]
    }
  ]
})
export class CacheModule {}

// Async factory
@Module({
  providers: [
    {
      provide: 'DATABASE_CONNECTION',
      useFactory: async (configService: ConfigService) => {
        const connection = await createConnection(configService.get('DB_URL'));
        return connection;
      },
      inject: [ConfigService]
    }
  ]
})
export class DatabaseModule {}
```

Factory providers enable dependency creation with complex initialization logic. The `useFactory` function receives injected dependencies (specified in the `inject` array) and returns the created provider. Async factories using `async`/`await` are particularly useful for database connections, cache clients, and other resources that need asynchronous setup. The factory runs once for singleton scoped providers.

### Existing Providers

```typescript
// Alias for existing provider
@Module({
  providers: [
    UsersService,
    {
      provide: 'USER_SERVICE_ALIAS',
      useExisting: UsersService
    }
  ]
})
export class UsersModule {}

// Usage
@Injectable()
export class OrdersService {
  constructor(
    @Inject('USER_SERVICE_ALIAS') private usersService: UsersService
  ) {}
}
```

Existing providers create aliases — `useExisting: UsersService` means the token `'USER_SERVICE_ALIAS'` resolves to the same singleton instance as `UsersService`. This is useful for interface-based design where you want to expose a service under a generic token while keeping the implementation class hidden from consumers.

## Custom Providers with Tokens

Tokens are the keys that NestJS's DI container uses to identify providers. Class references are the most common and most type-safe tokens. String tokens offer flexibility but sacrifice compile-time checking. Symbol tokens provide uniqueness guarantees — two modules cannot accidentally collide on the same symbol token. Choose tokens based on the desired balance of type safety and flexibility.

### String Tokens

```typescript
export const CACHE_MANAGER = 'CACHE_MANAGER';
export const LOGGER = 'LOGGER';

@Module({
  providers: [
    {
      provide: CACHE_MANAGER,
      useFactory: () => new CacheManager({ ttl: 300 })
    },
    {
      provide: LOGGER,
      useValue: console
    }
  ],
  exports: [CACHE_MANAGER, LOGGER]
})
export class CommonModule {}
```

String tokens are the simplest custom token — just a string constant like `'CACHE_MANAGER'`. However, strings can collide between modules. The convention is to define tokens as exported constants in a shared module, ensuring both the provider and consumer reference the same string value. The `exports` array must include custom tokens for other modules to access them.

### Symbol Tokens

```typescript
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        return new Redis({ host: config.get('REDIS_HOST') });
      },
      inject: [ConfigService]
    }
  ]
})
export class RedisModule {}
```

## Injection Scopes

NestJS supports three provider scopes. `DEFAULT` (Singleton) creates one instance shared across the entire application — this is the most memory-efficient but requires thread-safety. `REQUEST` creates a new instance per incoming HTTP request, useful for request-scoped data like authentication context. `TRANSIENT` creates a new instance every time the provider is injected, even within the same request. Choose the minimum scope needed to avoid unnecessary allocations.

```typescript
import { Injectable, Scope } from '@nestjs/common';

// DEFAULT (Singleton) - single instance per module
@Injectable({ scope: Scope.DEFAULT })
export class SingletonService {
  // Created once, shared across all consumers
}

// REQUEST - new instance per incoming request
@Injectable({ scope: Scope.REQUEST })
export class RequestScopedService {
  constructor(@Inject(REQUEST) private request: Request) {}

  get userId(): string {
    return this.request['user']?.id;
  }
}

// TRANSIENT - new instance per injection
@Injectable({ scope: Scope.TRANSIENT })
export class TransientService {
  // New instance every time it's injected
}

// Using transient providers
@Module({
  providers: [
    LoggerService,
    { provide: 'TASK_QUEUE', useClass: TaskQueue, scope: Scope.TRANSIENT }
  ]
})
export class TasksModule {}
```

## Circular Dependencies

Circular dependencies occur when two modules or providers depend on each other. NestJS detects these at startup and throws an error unless `forwardRef()` is used. `forwardRef` wraps the reference in a thunk — a function that returns the type — deferring resolution until both modules are fully initialized. While `forwardRef` resolves the error, circular dependencies are a design smell; consider extracting shared logic into a third module.

### Module-Level

```typescript
// users.module.ts
@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}

// auth.module.ts
@Module({
  imports: [forwardRef(() => UsersModule)],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
```

Module-level circular deps happen when `ModuleA` imports `ModuleB` and vice versa. The `forwardRef(() => Module)` in the `imports` array resolves this. Both modules must use `forwardRef` on the import. NestJS resolves the dependency graph lazily for forward-referenced modules, so validation errors in the circular path may appear only at runtime rather than during initialization.

### Provider-Level

```typescript
@Injectable()
export class UsersService {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService
  ) {}
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService
  ) {}
}
```

## Optional Dependencies

The `@Optional()` decorator tells the DI container not to throw when a provider is missing. The dependency becomes `undefined` instead, which can be handled with null-safe operators (`?.`). This pattern is useful for optional features like analytics clients, debug loggers, or feature-flagged services where the provider might not be registered.

```typescript
@Injectable()
export class AnalyticsService {
  constructor(
    @Optional() @Inject('ANALYTICS_CLIENT')
    private analyticsClient?: AnalyticsClient
  ) {
    if (!this.analyticsClient) {
      console.log('Analytics disabled');
    }
  }

  track(event: string, data: any) {
    this.analyticsClient?.track(event, data);
  }
}
```

## Global Modules

By default, NestJS modules are singletons with isolated scope — providers must be exported and the module imported to access them. `@Global()` makes a module's exported providers available everywhere without explicit imports. Use sparingly for true cross-cutting concerns like logging, configuration, or database connections. Overuse of global modules makes dependency graphs harder to trace.

```typescript
@Global()
@Module({
  providers: [ConfigService, LoggerService],
  exports: [ConfigService, LoggerService]
})
export class GlobalModule {}

// No need to import GlobalModule in other modules
@Module({})
export class AnyModule {
  constructor(
    private config: ConfigService, // Available globally
    private logger: LoggerService  // Available globally
  ) {}
}
```

## Testing with DI

NestJS's `Test.createTestingModule` creates a lightweight DI container for testing without launching the full application. Providers can be overridden with mocks via `useClass` or `useValue`. The `compile()` method builds the module and `module.get<T>()` retrieves provider instances. This pattern enables isolated unit tests for services with all dependencies mocked.

```typescript
import { Test, TestingModule } from '@nestjs/testing';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: MockUserRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useClass: MockUserRepository
        },
        {
          provide: 'CACHE_SERVICE',
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            invalidate: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get(UsersRepository);
  });

  it('should create user', async () => {
    const dto = { email: 'test@test.com', name: 'Test' };
    const result = await service.create(dto);
    expect(userRepository.save).toHaveBeenCalledWith(dto);
    expect(result.email).toBe(dto.email);
  });
});
```

## Best Practices

1. **Use constructor injection** over @Inject when possible
2. **Prefer class providers** over string tokens for type safety
3. **Use factory providers** for complex initialization logic
4. **Limit request-scoped providers** to specific use cases
5. **Avoid circular dependencies** by refactoring shared code
6. **Export providers** that other modules need
7. **Use optional injection** for optional dependencies

## Common Mistakes

### Mistake 1: Circular Dependency Without forwardRef

```typescript
// Wrong: Direct import causes circular dependency error
@Module({
  imports: [AuthModule], // AuthModule also imports UsersModule
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
```

```typescript
// Correct: Use forwardRef for circular dependencies
@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
```

### Mistake 2: Request-Scoped Provider Leak

```typescript
// Wrong: Request-scoped provider causing issues in singleton
@Injectable()
export class SingletonService {
  constructor(
    private requestService: RequestScopedService // Injected once, not per request
  ) {}
}
```

```typescript
// Correct: Proper scope management
@Injectable()
export class SingletonService {
  constructor(
    @Inject(REQUEST) private request: Request // Direct request injection
  ) {}
}
```

## Summary

NestJS DI system provides flexible provider registration with class, value, factory, and existing providers. Use scopes appropriately (DEFAULT, REQUEST, TRANSIENT), handle circular dependencies with forwardRef, and leverage custom providers for non-class dependencies. Proper DI usage leads to testable, maintainable code.

## References

- [NestJS Providers](https://docs.nestjs.com/providers)
- [NestJS Custom Providers](https://docs.nestjs.com/fundamentals/custom-providers)
- [NestJS Injection Scopes](https://docs.nestjs.com/fundamentals/injection-scopes)
- [NestJS Circular Dependencies](https://docs.nestjs.com/fundamentals/circular-dependency)

Happy Coding
