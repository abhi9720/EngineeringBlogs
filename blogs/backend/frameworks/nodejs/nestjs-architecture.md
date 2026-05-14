---
title: "NestJS Architecture"
description: "Master NestJS framework architecture: modules, decorators, providers, guards, interceptors, pipes, and building scalable server-side applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - nodejs
  - nestjs
  - typescript
  - architecture
coverImage: "/images/nestjs-architecture.png"
draft: false
---

## Overview

NestJS is a progressive Node.js framework for building efficient, reliable, and scalable server-side applications. It uses TypeScript by default and combines elements of OOP, FP, and FRP. Its architecture is heavily inspired by Angular, featuring modules, decorators, and a powerful dependency injection system.

## Core Architecture

```
Application
  |
  +-- Module (Root)
       |
       +-- Module (Feature)
       |    |
       |    +-- Controllers (Routes)
       |    +-- Providers (Services)
       |    +-- Exports
       |
       +-- Module (Shared)
            |
            +-- Guards (Authentication)
            +-- Interceptors (Transformation)
            +-- Pipes (Validation)
            +-- Filters (Error Handling)
```

## Modules

### Feature Module

```typescript
// users.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => AuthModule)
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
```

### Root Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI),
    UsersModule,
    AuthModule,
    OrdersModule
  ]
})
export class AppModule {}
```

## Controllers

```typescript
// users.controller.ts
import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards, UsePipes,
  HttpCode, HttpStatus
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ValidationPipe } from '../common/pipes/validation.pipe';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe())
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  async findAll(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.usersService.findAll({ page, limit });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
```

## Providers (Services)

```typescript
// users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly emailService: EmailService,
    private readonly cacheService: CacheService
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const created = new this.userModel(createUserDto);
    const saved = await created.save();

    await this.emailService.sendWelcomeEmail(saved.email);
    await this.cacheService.invalidate('users:list');

    return saved;
  }

  async findById(id: string): Promise<User> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findAll(query: { page: number; limit: number }): Promise<PaginatedResult<User>> {
    const [items, total] = await Promise.all([
      this.userModel.find()
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .exec(),
      this.userModel.countDocuments().exec()
    ]);

    return {
      items,
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.limit)
    };
  }
}
```

## Guards

```typescript
// jwt-auth.guard.ts
import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.user = payload;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

// roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass()
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some(role => user.roles?.includes(role));
  }
}
```

## Interceptors

```typescript
// transform.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>> {

  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<ApiResponse<T>> {
    const statusCode = context.switchToHttp().getResponse().statusCode;

    return next.handle().pipe(
      map(data => ({
        statusCode,
        message: data.message || 'Success',
        data: data.data || data,
        timestamp: new Date().toISOString()
      }))
    );
  }
}

// logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        console.log(
          `${method} ${url} ${response.statusCode} ${Date.now() - now}ms`
        );
      })
    );
  }
}
```

## Pipes

```typescript
// validation.pipe.ts
import {
  PipeTransform, Injectable, ArgumentMetadata,
  BadRequestException
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToInstance(metatype, value);
    const errors = await validate(object);

    if (errors.length > 0) {
      const messages = errors.map(error => ({
        field: error.property,
        constraints: Object.values(error.constraints || {})
      }));
      throw new BadRequestException({
        message: 'Validation failed',
        errors: messages
      });
    }

    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
```

## Exception Filters

```typescript
// http-exception.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message || message;
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url
    });
  }
}
```

## Testing

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue({ id: '1', name: 'John' }),
            create: jest.fn().mockResolvedValue({ id: '2', name: 'Jane' })
          }
        }
      ]
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  describe('findAll', () => {
    it('should return an array of users', async () => {
      const result = await controller.findAll(1, 10);
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return a user', async () => {
      const result = await controller.findOne('1');
      expect(result).toEqual({ id: '1', name: 'John' });
    });
  });
});
```

## Best Practices

1. **Use modules for feature organization** - keep related features together
2. **Leverage DTOs** with class-validator for input validation
3. **Use guards for authentication/authorization** instead of middleware
4. **Implement interceptors** for cross-cutting concerns (logging, transformation)
5. **Use pipes for input validation and transformation**
6. **Apply exception filters** for consistent error responses
7. **Write unit and e2e tests** using NestJS testing utilities

## Common Mistakes

### Mistake 1: Circular Module Dependencies

```typescript
// Wrong: Direct circular imports
@Module({
  imports: [AuthModule],  // AuthModule also imports UsersModule
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

### Mistake 2: Missing Provider Registration

```typescript
// Wrong: Service not registered in module
@Module({
  controllers: [UsersController]
  // Missing UsersService in providers
})
export class UsersModule {}
```

```typescript
// Correct: Always register providers
@Module({
  controllers: [UsersController],
  providers: [UsersService]
})
export class UsersModule {}
```

## Summary

NestJS provides a well-structured, opinionated architecture for building server-side applications. Its modular design, decorator-based system, and dependency injection make it easy to organize code and implement cross-cutting concerns. Use modules for organization, guards for security, interceptors for transformation, and pipes for validation.

## References

- [NestJS Documentation](https://docs.nestjs.com/)
- [NestJS Modules](https://docs.nestjs.com/modules)
- [NestJS Providers](https://docs.nestjs.com/providers)
- [NestJS Guards](https://docs.nestjs.com/guards)

Happy Coding