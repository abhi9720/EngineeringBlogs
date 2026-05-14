---
title: "Express.js Basics"
description: "Master Express.js framework: routing, middleware, error handling, request/response objects, and building production-ready REST APIs with Node.js"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - nodejs
  - express
  - rest-api
  - javascript
coverImage: "/images/express-js-basics.png"
draft: false
---

## Overview

Express.js is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications. It has become the standard server framework for Node.js, with a vast ecosystem of middleware and extensions.

## Setup

Express creates an application instance that acts as a request handler. The `express.json()` middleware parses incoming JSON request bodies — without it, `req.body` remains `undefined`. `express.urlencoded({ extended: true })` parses form-encoded bodies. These two middleware should be applied early via `app.use()` before any route handlers.

```javascript
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Built-in middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

## Routing

Express uses `Router` instances for modular route organization. Each router is a mini-application that can define middleware and routes independently. The `Router` is then mounted on the main app via `app.use('/prefix', router)`. This pattern scales well — each resource (users, orders, admin) gets its own router file.

### Basic Routing

```javascript
const express = require('express');
const router = express.Router();

// GET request
router.get('/users', (req, res) => {
  res.json({ users: [] });
});

// GET with params
router.get('/users/:id', (req, res) => {
  const { id } = req.params;
  res.json({ id, name: 'John Doe' });
});

// POST request
router.post('/users', (req, res) => {
  const { body } = req;
  res.status(201).json({ id: Date.now(), ...body });
});

// PUT request
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  res.json({ id, ...req.body });
});

// DELETE request
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  res.status(204).send();
});

// Export router
module.exports = router;
```

Express route parameters are named segments prefixed with `:`. They are extracted via `req.params`. Path-to-regexp conversion happens internally — Express converts route patterns like `/users/:userId/posts/:postId` into regular expressions for matching. Optional parameters use a `?` suffix, and wildcard `*` captures the rest of the path. Multiple callback functions can be chained per route for inline middleware.

### Route Patterns

```javascript
// Named parameters
router.get('/users/:userId/posts/:postId', (req, res) => {
  res.json(req.params);
});

// Optional parameters
router.get('/products/:category?', (req, res) => {
  const category = req.params.category || 'all';
  res.json({ category, products: [] });
});

// Regular expressions
router.get(/^\/api\/(v1|v2)\/users$/, (req, res) => {
  res.json({ api: req.params[0], users: [] });
});

// Wildcard routes
router.get('/files/*', (req, res) => {
  res.json({ path: req.params[0] });
});

// Multiple callback functions
router.get('/profile',
  authenticate,
  loadProfile,
  (req, res) => {
    res.json(req.profile);
  }
);
```

Routers are mounted on the application at specific prefixes. When `app.use('/api/users', userRouter)` is called, the userRouter receives requests matching `/api/users` and its sub-paths. Middleware can be passed in the mount call — here the admin router requires both `authenticate` and `authorize('admin')` middleware. This pattern keeps auth logic centralized rather than scattered across route handlers.

### Application-Level Router

```javascript
const express = require('express');
const app = express();
const userRouter = require('./routes/users');
const orderRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');

// Mount routers
app.use('/api/users', userRouter);
app.use('/api/orders', orderRouter);
app.use('/api/admin', [authenticate, authorize('admin')], adminRouter);
```

## Middleware

Express middleware is the backbone of request processing. Functions receive `(req, res, next)` and can: modify `req` and `res`, end the request cycle, or call `next()` to pass control. Middleware execution order is determined by registration order via `app.use()`. This linear pipeline model is simple but powerful — every framework feature (parsing, logging, auth, compression) is middleware.

### Application-Level Middleware

```javascript
const express = require('express');
const app = express();

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Rate limiting middleware
const rateLimits = new Map();
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 100;

  if (!rateLimits.has(ip)) {
    rateLimits.set(ip, []);
  }

  const timestamps = rateLimits.get(ip);
  const recent = timestamps.filter(t => now - t < windowMs);
  recent.push(now);
  rateLimits.set(ip, recent);

  if (recent.length > maxRequests) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  next();
});
```

Application-level middleware runs on every request. The logging example hooks into the `finish` event on the response object to measure latency — a common pattern for request timing. The request ID middleware generates a unique ID per request and sets it both on `req` and as a response header, enabling request tracing across logs and downstream services.

### Router-Level Middleware

```javascript
const express = require('express');
const router = express.Router();

// Middleware specific to this router
router.use((req, res, next) => {
  console.log(`User Router: ${req.method} ${req.path}`);
  next();
});

const authenticate = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// Protected routes
router.get('/admin', authenticate, authorize('admin'), (req, res) => {
  res.json({ secret: 'admin data' });
});
```

Router-level middleware applies only to routes within that router. The `authenticate` function verifies JWT tokens from the Authorization header and attaches the decoded user to `req.user`. The `authorize` function is a higher-order function that takes roles and returns a middleware — this pattern enables reusable, parameterized middleware. Routes can accept multiple middleware functions before the final handler.

### Third-Party Middleware

```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Request logging
app.use(morgan('combined'));

// Compression
app.use(compression());

// Global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);
```

Express's ecosystem of third-party middleware handles common concerns. `helmet` sets security-related HTTP headers. `cors` manages Cross-Origin Resource Sharing. `morgan` provides HTTP request logging. `compression` gzips responses. `express-rate-limit` implements rate limiting. This plugin architecture lets you compose your middleware stack declaratively at the application level.

## Error Handling

```javascript
// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// 404 handler
app.use((req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// Global error handler
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack
    });
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message
    });
  }

  console.error('UNEXPECTED ERROR:', err);
  return res.status(500).json({
    status: 'error',
    message: 'Something went wrong'
  });
});
```

Express error handling uses a special middleware signature with four parameters: `(err, req, res, next)`. When any middleware calls `next(err)`, Express skips all remaining regular middleware and jumps to the error handler. The custom `AppError` class distinguishes operational errors (expected, like validation failures) from programmer errors (unexpected, like null reference). In development mode, full stack traces are returned; in production, only safe messages are exposed.

## Request/Response

### Request Object

```javascript
router.post('/api/data', (req, res) => {
  // Body
  console.log(req.body);

  // Parameters
  console.log(req.params);

  // Query string
  console.log(req.query);

  // Headers
  console.log(req.headers);
  console.log(req.get('Content-Type'));

  // URL info
  console.log(req.path);
  console.log(req.hostname);
  console.log(req.protocol);
  console.log(req.secure);
  console.log(req.ip);

  // Custom properties
  console.log(req.requestId);
  console.log(req.user);
});
```

The `req` object provides access to all parts of the incoming request. `req.body` contains parsed JSON/form data (requires middleware). `req.params` holds route parameters. `req.query` provides parsed query string. `req.headers` and `req.get()` access headers. Custom properties like `req.requestId` and `req.user` are set by earlier middleware — this is how Express middleware layers build up request context.

### Response Object

```javascript
router.get('/response-demo', (req, res) => {
  // JSON response
  res.json({ message: 'Hello' });

  // Status code + JSON
  res.status(201).json({ created: true });

  // Redirect
  res.redirect('/new-location');
  res.redirect(301, '/permanent-redirect');

  // Send file
  res.sendFile('/path/to/file.pdf');

  // Download
  res.download('/path/to/report.csv', 'report.csv');

  // Set headers
  res.setHeader('X-Custom', 'value');
  res.set({
    'X-First': 'first',
    'X-Second': 'second'
  });

  // Content type
  res.type('application/json');
  res.type('pdf');

  // Cookie management
  res.cookie('token', 'abc123', {
    httpOnly: true,
    secure: true,
    maxAge: 3600000
  });
  res.clearCookie('token');
});
```

The `res` object provides methods for sending responses. `res.json()` serializes objects to JSON and sets the Content-Type header. `res.status()` sets the HTTP status code and returns `res` for chaining. `res.cookie()` sets cookies with options for security (`httpOnly`, `secure`, `maxAge`). `res.redirect()` sends a 302 by default. `res.sendFile()` and `res.download()` serve files from the filesystem.

## Testing

```javascript
const request = require('supertest');
const express = require('express');

describe('User API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/users', require('./routes/users'));
  });

  test('GET /api/users should return users', async () => {
    const res = await request(app)
      .get('/api/users')
      .expect(200);

    expect(res.body).toHaveProperty('users');
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  test('POST /api/users should create user', async () => {
    const newUser = { name: 'John', email: 'john@example.com' };

    const res = await request(app)
      .post('/api/users')
      .send(newUser)
      .expect(201);

    expect(res.body).toMatchObject(newUser);
    expect(res.body).toHaveProperty('id');
  });
});
```

## Best Practices

1. **Use express.Router()** for modular route organization
2. **Implement global error handling** middleware
3. **Use helmet, cors, and rate-limiting** middleware for security
4. **Keep middleware functions pure** - separate concerns
5. **Validate request input** with express-validator or Joi
6. **Use environment variables** for configuration
7. **Implement proper logging** with morgan or winston

## Common Mistakes

### Mistake 1: Not Handling Async Errors

```javascript
// Wrong: Unhandled promise rejection
router.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user);
});
```

```javascript
// Correct: Proper async error handling
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  res.json(user);
}));
```

### Mistake 2: Missing 404 Handler

```javascript
// Wrong: No 404 handler - requests to unknown routes hang
app.use('/api', router);
```

```javascript
// Correct: Always add 404 handler after routes
app.use('/api', router);
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});
```

## Summary

Express.js provides a lightweight, flexible foundation for building web APIs and applications. Its middleware architecture enables modular, composable request processing. Use routers for route organization, implement proper error handling, and leverage the extensive ecosystem of middleware for security, logging, and validation.

## References

- [Express.js Documentation](https://expressjs.com/)
- [Express Middleware Guide](https://expressjs.com/en/guide/using-middleware.html)
- [Express Routing Guide](https://expressjs.com/en/guide/routing.html)
- [Express Error Handling](https://expressjs.com/en/guide/error-handling.html)

Happy Coding