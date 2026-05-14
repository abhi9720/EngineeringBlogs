---
title: "Fastify vs Express: A Comprehensive Comparison"
description: "Compare Fastify and Express.js frameworks: performance, developer experience, plugin systems, serialization, and choosing the right framework for your project"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - nodejs
  - express
  - fastify
  - performance
coverImage: "/images/fastify-vs-express.png"
draft: false
---

## Overview

Express.js has been the dominant Node.js web framework for years, but Fastify has emerged as a compelling alternative offering better performance, built-in validation, and a cleaner plugin system. This comparison helps you choose the right framework for your project.

## Performance Comparison

### Request Handling Performance

```javascript
// Express
const express = require('express');
const app = express();

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

// Fastify
const fastify = require('fastify')();

fastify.get('/api/users', async (request, reply) => {
  return { users: [] };
});
```

### Serialization

```javascript
// Express: JSON serialization at runtime (JSON.stringify)
app.get('/api/data', (req, res) => {
  const data = fetchData();
  res.json(data);
  // JSON.stringify is called on every request
});

// Fastify: Schema-based serialization (pre-compiled)
const schema = {
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
        email: { type: 'string' }
      }
    }
  }
};

fastify.get('/api/data', { schema }, async (request, reply) => {
  const data = fetchData();
  return data;
  // Serialization function is compiled once, reused
});
```

## Core Differences

### Routing

```javascript
// Express Routing
const express = require('express');
const app = express();

app.get('/users/:id', (req, res) => {
  const { id } = req.params;
  // Query params: req.query
  // Headers: req.headers
  // Body: req.body (needs middleware)
  res.json({ id });
});

// Fastify Routing
const fastify = require('fastify')();

fastify.get('/users/:id', async (request, reply) => {
  const { id } = request.params;
  // Query params: request.query
  // Headers: request.headers
  // Body: request.body (built-in)
  return { id };
});
```

### Validation

```javascript
// Express: Manual validation or third-party
const { body, validationResult } = require('express-validator');

app.post('/users',
  body('email').isEmail(),
  body('age').isInt({ min: 0 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // Process request
  }
);

// Fastify: Built-in schema validation
const createUserSchema = {
  body: {
    type: 'object',
    required: ['email', 'name'],
    properties: {
      email: { type: 'string', format: 'email' },
      name: { type: 'string', minLength: 2 },
      age: { type: 'integer', minimum: 0 }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        email: { type: 'string' }
      }
    }
  }
};

fastify.post('/users', { schema: createUserSchema }, async (request, reply) => {
  // Request is already validated
  const { email, name } = request.body;
  const user = await createUser({ email, name });
  reply.code(201);
  return user;
});
```

### Plugin System

```javascript
// Express: Mountable routers/apps
const express = require('express');
const app = express();

const userRouter = express.Router();
userRouter.get('/', (req, res) => { });
userRouter.post('/', (req, res) => { });

app.use('/api/users', userRouter);

// Express plugins are just middleware
const cors = require('cors');
app.use(cors());

// Fastify: Encapsulated plugins with decorators
const fastify = require('fastify')();

// Plugin with encapsulation
fastify.register(async function (instance, opts) {
  instance.decorate('authService', new AuthService());
  instance.decorateRequest('user', null);

  instance.addHook('preHandler', async (request) => {
    request.user = await instance.authService.verify(request);
  });

  instance.get('/api/users', async (request, reply) => {
    return { user: request.user, users: [] };
  });
}, { prefix: '/api' });

// Reusable plugin with options
fastify.register(require('@fastify/cors'), {
  origin: '*',
  methods: ['GET', 'POST']
});

fastify.register(require('@fastify/jwt'), {
  secret: process.env.JWT_SECRET
});
```

### Logging

```javascript
// Express: Need external logging library
const express = require('express');
const morgan = require('morgan');
const winston = require('winston');

const app = express();
app.use(morgan('combined'));

// Fastify: Built-in logging with Pino
const fastify = require('fastify')({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty'
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        hostname: req.hostname
      })
    }
  }
});

fastify.get('/api/data', async (request, reply) => {
  request.log.info('Fetching data');
  const data = await fetchData();
  request.log.debug({ data }, 'Data fetched');
  return data;
});
```

## Code Organization

```javascript
// Express: Flexible but unstructured
const express = require('express');
const app = express();

// Routes can be anywhere
require('./routes/users')(app);
require('./routes/orders')(app);

// No built-in encapsulation

// Fastify: Encapsulated via plugins
const fastify = require('fastify')();

// Each plugin has its own context
fastify.register(require('./modules/users'));
fastify.register(require('./modules/orders'));

// modules/users/index.js
module.exports = async function (fastify, opts) {
  fastify.decorate('userService', new UserService());

  fastify.addHook('preHandler', async (request) => {
    request.userService = fastify.userService;
  });

  fastify.get('/users', async (request, reply) => {
    return fastify.userService.findAll();
  });

  fastify.post('/users', async (request, reply) => {
    return fastify.userService.create(request.body);
  });
};
```

## Error Handling

```javascript
// Express: Middleware-based error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Fastify: Built-in error handling with status codes
fastify.setErrorHandler(async (error, request, reply) => {
  request.log.error(error);

  if (error.validation) {
    reply.code(400);
    return {
      error: 'Validation Error',
      messages: error.validation.map(v => v.message)
    };
  }

  reply.code(error.statusCode || 500);
  return { error: error.message };
});

// Fastify: Not found handler
fastify.setNotFoundHandler(async (request, reply) => {
  reply.code(404);
  return { error: `Route ${request.method} ${request.url} not found` };
});
```

## Decision Guide

| Aspect | Express | Fastify |
|--------|---------|---------|
| Performance | ~30K req/s | ~50K req/s |
| Ecosystem | Largest | Growing fast |
| Serialization | Runtime JSON.stringify | Pre-compiled schemas |
| Validation | Third-party | Built-in (JSON Schema) |
| Logging | Third-party | Built-in (Pino) |
| TypeScript | Manual setup | First-class support |
| Plugin System | Middleware | Encapsulated plugins |
| Learning Curve | Low | Medium |

## When to Use Each

```javascript
// Choose Express when:
// - Building simple APIs or prototypes
// - Team is already experienced with Express
// - Need maximum ecosystem compatibility
// - Application is small to medium complexity

// Choose Fastify when:
// - Performance is critical
// - Building microservices
// - Need built-in validation and serialization
// - Building large, complex applications
// - Want TypeScript-first development
```

## Summary

Express excels in simplicity and ecosystem size, making it ideal for rapid development and smaller applications. Fastify offers superior performance, built-in validation, serialization, and logging, making it better suited for microservices and performance-critical applications. Consider your team's expertise and performance requirements when choosing.

## References

- [Fastify Documentation](https://www.fastify.io/docs/latest/)
- [Express Documentation](https://expressjs.com/)
- [Fastify vs Express Benchmarks](https://www.fastify.io/benchmarks/)
- [JSON Schema Validation](https://json-schema.org/)

Happy Coding