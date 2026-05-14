---
title: "Gin Framework Basics"
description: "Master the Gin web framework for Go: routing, middleware, request binding, validation, error handling, and building high-performance REST APIs"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - go
  - gin
  - rest-api
  - web-framework
coverImage: "/images/gin-framework-basics.png"
draft: false
---

## Overview

Gin is a high-performance HTTP web framework written in Go. It features a martini-like API with up to 40x better performance, built-in middleware support, request validation, and JSON binding.

## Setup

```go
package main

import (
    "net/http"
    "github.com/gin-gonic/gin"
)

func main() {
    r := gin.Default()

    r.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "status": "healthy",
        })
    })

    r.Run(":8080")
}
```

## Routing

### Basic Routing

```go
func setupRouter() *gin.Engine {
    r := gin.Default()

    // Path parameters
    r.GET("/users/:id", func(c *gin.Context) {
        id := c.Param("id")
        c.JSON(http.StatusOK, gin.H{"id": id})
    })

    // Query parameters
    r.GET("/search", func(c *gin.Context) {
        query := c.DefaultQuery("q", "")
        page := c.Query("page")
        c.JSON(http.StatusOK, gin.H{
            "query": query,
            "page":  page,
        })
    })

    // POST with body
    r.POST("/users", func(c *gin.Context) {
        var user User
        if err := c.ShouldBindJSON(&user); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusCreated, user)
    })

    // Group routes
    api := r.Group("/api")
    {
        v1 := api.Group("/v1")
        {
            v1.GET("/users", listUsers)
            v1.POST("/users", createUser)
            v1.GET("/users/:id", getUser)
            v1.PUT("/users/:id", updateUser)
            v1.DELETE("/users/:id", deleteUser)
        }
    }

    return r
}
```

## Request Binding

```go
type CreateUserRequest struct {
    Email    string `json:"email" binding:"required,email"`
    Name     string `json:"name" binding:"required,min=2,max=100"`
    Age      int    `json:"age" binding:"gte=0,lte=150"`
    Password string `json:"password" binding:"required,min=8"`
}

type UpdateUserRequest struct {
    Name *string `json:"name" binding:"omitempty,min=2,max=100"`
    Age  *int    `json:"age" binding:"omitempty,gte=0,lte=150"`
}

type SearchParams struct {
    Query string `form:"q" binding:"required"`
    Page  int    `form:"page" binding:"gte=1"`
    Limit int    `form:"limit" binding:"gte=1,lte=100"`
}

func createUser(c *gin.Context) {
    var req CreateUserRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{
            "error":   "validation_failed",
            "details": err.Error(),
        })
        return
    }

    user := saveUser(req)
    c.JSON(http.StatusCreated, user)
}

func searchUsers(c *gin.Context) {
    var params SearchParams
    if err := c.ShouldBindQuery(&params); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    results := performSearch(params)
    c.JSON(http.StatusOK, results)
}
```

## Middleware

### Custom Middleware

```go
func LoggerMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        path := c.Request.URL.Path

        c.Next()

        latency := time.Since(start)
        status := c.Writer.Status()

        log.Printf("%s %s %d %v", c.Request.Method, path, status, latency)
    }
}

func AuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        token := c.GetHeader("Authorization")
        if token == "" {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
                "error": "authorization header required",
            })
            return
        }

        user, err := validateToken(token)
        if err != nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
                "error": "invalid token",
            })
            return
        }

        c.Set("user", user)
        c.Next()
    }
}

func RateLimitMiddleware() gin.HandlerFunc {
    limiter := NewRateLimiter(100, time.Minute)
    return func(c *gin.Context) {
        clientIP := c.ClientIP()
        if !limiter.Allow(clientIP) {
            c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
                "error": "rate limit exceeded",
            })
            return
        }
        c.Next()
    }
}
```

### Using Middleware

```go
func setupRouter() *gin.Engine {
    r := gin.New()
    r.Use(gin.Recovery())
    r.Use(LoggerMiddleware())

    // Public routes
    r.POST("/login", loginHandler)

    // Protected routes
    authorized := r.Group("/api")
    authorized.Use(AuthMiddleware())
    {
        authorized.GET("/users", listUsers)
        authorized.GET("/users/:id", getUser)
        authorized.POST("/users", createUser)
    }

    // Admin routes
    admin := authorized.Group("/admin")
    admin.Use(RoleMiddleware("admin"))
    {
        admin.GET("/dashboard", adminDashboard)
        admin.DELETE("/users/:id", adminDeleteUser)
    }

    return r
}
```

## Error Handling

```go
type APIError struct {
    Code    int    `json:"code"`
    Message string `json:"message"`
    Details string `json:"details,omitempty"`
}

func ErrorHandler() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Next()

        if len(c.Errors) > 0 {
            err := c.Errors.Last()
            var apiError APIError

            switch e := err.Err.(type) {
            case *ValidationError:
                apiError = APIError{
                    Code:    http.StatusBadRequest,
                    Message: "Validation failed",
                    Details: e.Error(),
                }
            case *NotFoundError:
                apiError = APIError{
                    Code:    http.StatusNotFound,
                    Message: "Resource not found",
                    Details: e.Error(),
                }
            default:
                apiError = APIError{
                    Code:    http.StatusInternalServerError,
                    Message: "Internal server error",
                }
            }

            c.JSON(apiError.Code, apiError)
        }
    }
}

func getUser(c *gin.Context) {
    id := c.Param("id")
    user, err := findUserByID(id)
    if err != nil {
        _ = c.Error(err)
        return
    }
    c.JSON(http.StatusOK, user)
}
```

## File Upload

```go
func uploadFile(c *gin.Context) {
    file, err := c.FormFile("file")
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
        return
    }

    // Validate file type
    if !isAllowedFileType(file.Filename) {
        c.JSON(http.StatusBadRequest, gin.H{"error": "file type not allowed"})
        return
    }

    // Validate file size (max 10MB)
    if file.Size > 10<<20 {
        c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
        return
    }

    dst := filepath.Join("./uploads", file.Filename)
    if err := c.SaveUploadedFile(file, dst); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
        return
    }

    c.JSON(http.StatusOK, gin.H{
        "filename": file.Filename,
        "size":     file.Size,
    })
}

func uploadMultipleFiles(c *gin.Context) {
    form, _ := c.MultipartForm()
    files := form.File["files"]

    var uploaded []string
    for _, file := range files {
        dst := filepath.Join("./uploads", file.Filename)
        if err := c.SaveUploadedFile(file, dst); err == nil {
            uploaded = append(uploaded, file.Filename)
        }
    }

    c.JSON(http.StatusOK, gin.H{"uploaded": uploaded})
}
```

## Testing

```go
func TestCreateUser(t *testing.T) {
    router := setupRouter()

    w := httptest.NewRecorder()
    body := `{"email":"test@test.com","name":"Test User","age":25,"password":"password123"}`
    req, _ := http.NewRequest("POST", "/api/users", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    router.ServeHTTP(w, req)

    assert.Equal(t, http.StatusCreated, w.Code)

    var response User
    err := json.Unmarshal(w.Body.Bytes(), &response)
    assert.NoError(t, err)
    assert.Equal(t, "test@test.com", response.Email)
}

func TestValidation(t *testing.T) {
    router := setupRouter()

    tests := []struct {
        name       string
        body       string
        wantStatus int
    }{
        {"valid", `{"email":"test@test.com","name":"Test","age":25,"password":"pass1234"}`, http.StatusCreated},
        {"missing email", `{"name":"Test","age":25,"password":"pass1234"}`, http.StatusBadRequest},
        {"invalid email", `{"email":"invalid","name":"Test","age":25,"password":"pass1234"}`, http.StatusBadRequest},
        {"underage", `{"email":"test@test.com","name":"Test","age":15,"password":"pass1234"}`, http.StatusBadRequest},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            w := httptest.NewRecorder()
            req, _ := http.NewRequest("POST", "/api/users", strings.NewReader(tt.body))
            req.Header.Set("Content-Type", "application/json")
            router.ServeHTTP(w, req)

            assert.Equal(t, tt.wantStatus, w.Code)
        })
    }
}
```

## Best Practices

1. **Use gin.New() instead of gin.Default()** - add only middleware you need
2. **Group related routes** with r.Group()
3. **Use ShouldBindJSON** for request validation instead of manual parsing
4. **Implement custom middleware** for cross-cutting concerns
5. **Use gin.H for simple responses**, structs for complex ones
6. **Handle errors through c.Error()** and a global error handler
7. **Validate file uploads** - type, size, and content

## Common Mistakes

### Mistake 1: Not Handling Binding Errors

```go
// Wrong: Ignoring binding errors
func createUser(c *gin.Context) {
    var user User
    c.ShouldBindJSON(&user) // Error ignored
    c.JSON(http.StatusOK, user)
}
```

```go
// Correct: Handle binding errors
func createUser(c *gin.Context) {
    var user User
    if err := c.ShouldBindJSON(&user); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    c.JSON(http.StatusCreated, user)
}
```

### Mistake 2: Not Using Recovery Middleware

```go
// Wrong: No panic recovery
r := gin.New()
// A panic will crash the server
```

```go
// Correct: Add recovery middleware
r := gin.New()
r.Use(gin.Recovery()) // Panics return 500 instead of crashing
```

## Summary

Gin provides a high-performance HTTP framework with built-in request binding, validation, middleware support, and routing. Use groups for organized routes, ShouldBindJSON for validation, and custom middleware for cross-cutting concerns. Always handle binding errors and use recovery middleware for production deployments.

## References

- [Gin Documentation](https://gin-gonic.com/docs/)
- [Gin Middleware](https://gin-gonic.com/docs/examples/custom-middleware/)
- [Gin Binding/Validation](https://gin-gonic.com/docs/examples/binding-and-validation/)
- [Gin Testing](https://gin-gonic.com/docs/testing/)

Happy Coding