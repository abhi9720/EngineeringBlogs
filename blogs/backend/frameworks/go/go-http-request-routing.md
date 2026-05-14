---
title: "HTTP Request Routing in Go"
description: "Deep dive into HTTP request routing in Go: standard library patterns, path parameters, middleware chaining, custom routers, and performance optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - go
  - http
  - routing
  - net-http
coverImage: "/images/go-http-request-routing.png"
draft: false
---

## Overview

HTTP routing is the foundation of any web application. Go's standard library provides a solid HTTP server, and the new Go 1.22 routing enhancements make it even more powerful. This guide covers everything from basic routing to advanced patterns.

## Standard Library Routing

### Basic ServeMux

```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
)

func main() {
    mux := http.NewServeMux()

    // Simple routes
    mux.HandleFunc("/api/health", healthHandler)
    mux.HandleFunc("/api/users", usersHandler)
    mux.HandleFunc("/api/users/", userByIDHandler)

    log.Fatal(http.ListenAndServe(":8080", mux))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}

func usersHandler(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        listUsers(w, r)
    case http.MethodPost:
        createUser(w, r)
    default:
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    }
}

func userByIDHandler(w http.ResponseWriter, r *http.Request) {
    // Extract ID from path: /api/users/{id}
    id := extractID(r.URL.Path, "/api/users/")
    if id == "" {
        http.Error(w, "Missing user ID", http.StatusBadRequest)
        return
    }

    switch r.Method {
    case http.MethodGet:
        getUser(w, r, id)
    case http.MethodPut:
        updateUser(w, r, id)
    case http.MethodDelete:
        deleteUser(w, r, id)
    default:
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    }
}

func extractID(path, prefix string) string {
    if len(path) <= len(prefix) {
        return ""
    }
    return path[len(prefix):]
}
```

### Go 1.22 Enhanced Routing

```go
// Go 1.22+ supports path parameters and method-based routing
func main() {
    mux := http.NewServeMux()

    // Method-specific routes with path parameters
    mux.HandleFunc("GET /api/users", listUsers)
    mux.HandleFunc("POST /api/users", createUser)
    mux.HandleFunc("GET /api/users/{id}", getUser)
    mux.HandleFunc("PUT /api/users/{id}", updateUser)
    mux.HandleFunc("DELETE /api/users/{id}", deleteUser)

    // Path value extraction
    mux.HandleFunc("GET /api/users/{id}/posts/{postId}", getUserPost)

    // Wildcard matching
    mux.HandleFunc("GET /api/static/*path", serveStatic)

    log.Fatal(http.ListenAndServe(":8080", mux))
}

func getUser(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    // Use id
}

func getUserPost(w http.ResponseWriter, r *http.Request) {
    userID := r.PathValue("id")
    postID := r.PathValue("postId")
    json.NewEncoder(w).Encode(map[string]string{
        "userId": userID,
        "postId": postID,
    })
}

func serveStatic(w http.ResponseWriter, r *http.Request) {
    filepath := r.PathValue("path")
    http.ServeFile(w, r, filepath)
}
```

## Custom Router Implementation

```go
type Route struct {
    Method  string
    Pattern string
    Handler http.HandlerFunc
    Middleware []Middleware
}

type Middleware func(http.HandlerFunc) http.HandlerFunc

type Router struct {
    routes     []Route
    middleware []Middleware
    notFound   http.HandlerFunc
}

func NewRouter() *Router {
    return &Router{
        notFound: func(w http.ResponseWriter, r *http.Request) {
            http.Error(w, "Not found", http.StatusNotFound)
        },
    }
}

func (rt *Router) Use(mw Middleware) {
    rt.middleware = append(rt.middleware, mw)
}

func (rt *Router) Handle(method, pattern string, handler http.HandlerFunc) {
    rt.routes = append(rt.routes, Route{
        Method:  method,
        Pattern: pattern,
        Handler: handler,
    })
}

func (rt *Router) GET(pattern string, handler http.HandlerFunc) {
    rt.Handle(http.MethodGet, pattern, handler)
}

func (rt *Router) POST(pattern string, handler http.HandlerFunc) {
    rt.Handle(http.MethodPost, pattern, handler)
}

func (rt *Router) PUT(pattern string, handler http.HandlerFunc) {
    rt.Handle(http.MethodPut, pattern, handler)
}

func (rt *Router) DELETE(pattern string, handler http.HandlerFunc) {
    rt.Handle(http.MethodDelete, pattern, handler)
}

func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    for _, route := range rt.routes {
        if route.Method != r.Method {
            continue
        }

        params, matched := matchPattern(route.Pattern, r.URL.Path)
        if !matched {
            continue
        }

        // Apply middleware
        handler := route.Handler
        for i := len(rt.middleware) - 1; i >= 0; i-- {
            handler = rt.middleware[i](handler)
        }
        for i := len(route.Middleware) - 1; i >= 0; i-- {
            handler = route.Middleware[i](handler)
        }

        // Store params in context
        ctx := context.WithValue(r.Context(), paramsKey, params)
        handler(w, r.WithContext(ctx))
        return
    }

    rt.notFound(w, r)
}

type contextKey string

const paramsKey contextKey = "params"

func Params(r *http.Request) map[string]string {
    params, _ := r.Context().Value(paramsKey).(map[string]string)
    return params
}
```

## Middleware Chaining

```go
type Middleware func(http.Handler) http.Handler

// Logging middleware
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

        next.ServeHTTP(wrapped, r)

        log.Printf("%s %s %d %v",
            r.Method, r.URL.Path, wrapped.statusCode, time.Since(start))
    })
}

// Recovery middleware
func RecoveryMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("Panic: %v", err)
                http.Error(w, "Internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

// CORS middleware
func CORSMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

        if r.Method == http.MethodOptions {
            w.WriteHeader(http.StatusNoContent)
            return
        }

        next.ServeHTTP(w, r)
    })
}

// Auth middleware
func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if token == "" {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }

        user, err := validateToken(token)
        if err != nil {
            http.Error(w, "Invalid token", http.StatusUnauthorized)
            return
        }

        ctx := context.WithValue(r.Context(), "user", user)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Middleware chain
func Chain(handler http.Handler, middleware ...Middleware) http.Handler {
    for i := len(middleware) - 1; i >= 0; i-- {
        handler = middleware[i](handler)
    }
    return handler
}

// Usage
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /api/users", listUsers)

    handler := Chain(mux,
        RecoveryMiddleware,
        LoggingMiddleware,
        CORSMiddleware,
    )

    log.Fatal(http.ListenAndServe(":8080", handler))
}
```

## Path Parameter Matching

```go
func matchPattern(pattern, path string) (map[string]string, bool) {
    patternParts := strings.Split(strings.Trim(pattern, "/"), "/")
    pathParts := strings.Split(strings.Trim(path, "/"), "/")

    if len(patternParts) != len(pathParts) {
        return nil, false
    }

    params := make(map[string]string)

    for i, part := range patternParts {
        if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
            name := part[1 : len(part)-1]
            params[name] = pathParts[i]
        } else if part != pathParts[i] {
            return nil, false
        }
    }

    return params, true
}

// Usage
func getUser(w http.ResponseWriter, r *http.Request) {
    params := Params(r)
    id := params["id"]

    user := findUser(id)
    if user == nil {
        http.Error(w, "User not found", http.StatusNotFound)
        return
    }

    json.NewEncoder(w).Encode(user)
}
```

## Testing Routes

```go
func TestUserHandler(t *testing.T) {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /api/users/{id}", getUser)

    server := httptest.NewServer(mux)
    defer server.Close()

    tests := []struct {
        name       string
        userID     string
        wantStatus int
    }{
        {"valid user", "123", http.StatusOK},
        {"missing user", "999", http.StatusNotFound},
        {"invalid id", "abc", http.StatusBadRequest},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            resp, err := http.Get(server.URL + "/api/users/" + tt.userID)
            assert.NoError(t, err)
            assert.Equal(t, tt.wantStatus, resp.StatusCode)
        })
    }
}
```

## Best Practices

1. **Use Go 1.22+ routing** for built-in path parameters and method matching
2. **Chain middleware appropriately** - recovery first, then logging, then auth
3. **Use httptest.NewServer** for integration testing routes
4. **Group related routes** under a common prefix
5. **Return consistent error responses** in standard format
6. **Set Content-Type headers** explicitly
7. **Use http.Handler interface** for maximum compatibility

## Common Mistakes

### Mistake 1: Path Traversal

```go
// Wrong: Vulnerable to path traversal
func serveFile(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path[len("/files/"):]
    http.ServeFile(w, r, "./files/"+path)
}
```

```go
// Correct: Sanitize paths
func serveFile(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path[len("/files/"):]
    cleanPath := filepath.Clean(path)
    if strings.Contains(cleanPath, "..") {
        http.Error(w, "Invalid path", http.StatusBadRequest)
        return
    }
    http.ServeFile(w, r, filepath.Join("./files", cleanPath))
}
```

### Mistake 2: Not Handling Trailing Slashes

```go
// Wrong: Trailing slash redirect causes issues
mux.HandleFunc("/api/users/", usersHandler)
// /api/users and /api/users/ might behave differently
```

```go
// Correct: Use consistent path patterns
// Go 1.22+
mux.HandleFunc("GET /api/users", listUsers)
mux.HandleFunc("GET /api/users/{id}", getUser)
```

## Summary

Go's HTTP routing has evolved significantly with Go 1.22+ adding path parameters and method matching. The standard library is sufficient for most applications. For complex routing, use middleware chaining, implement path parameter extraction, and always test with httptest. Consider third-party routers (Gin, Echo, Fiber) when you need more features.

## References

- [net/http Package](https://pkg.go.dev/net/http)
- [Go 1.22 Routing Enhancements](https://tip.golang.org/doc/go1.22#enhanced_routing)
- [httptest Package](https://pkg.go.dev/net/http/httptest)
- [Go HTTP Middleware](https://go.dev/blog/context)

Happy Coding