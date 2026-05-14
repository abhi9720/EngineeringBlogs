---
title: "Dependency Injection in NestJS"
description: "Deep dive into NestJS dependency injection system: providers, custom providers, injection scopes, circular dependencies, and advanced DI patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - nodejs
  - nestjs
  - dependency-injection
  - typescript
coverImage: "/images/dependency-injection-in-nestjs.png"
draft: false
---

## Overview

NestJS has a powerful dependency injection system inspired by Angular. It supports constructor-based injection, custom providers, injection tokens, scopes, and circular dependency resolution. Understanding DI is essential for building maintainable, testable NestJS applications.

## Basic Dependency Injection

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

## Custom Providers with Tokens

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