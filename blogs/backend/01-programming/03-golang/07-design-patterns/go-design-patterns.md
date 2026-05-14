---
title: Go Design Patterns and Idioms
description: >-
  Essential design patterns in Go: creational, structural, behavioral patterns
  adapted to Go's idioms and concurrency model
date: '2026-05-14'
author: Abhishek Tiwari
tags:
  - go
  - design-patterns
  - architecture
  - idioms
  - concurrency
coverImage: /images/go-design-patterns.png
draft: false
order: 10
---
# Go Design Patterns and Idioms

## Overview

Design patterns from the Gang of Four were written for C++ and Smalltalk. They rely on inheritance, virtual methods, and object hierarchies. Go has none of these. Does that mean design patterns are useless in Go? No — but the implementations look radically different.

In Go, patterns are expressed through composition, interfaces, first-class functions, and concurrency primitives. Many classic patterns become language features, not library code.

---

## Problem Statement

Without inheritance and generics (before Go 1.18), Go developers needed new ways to express:
- Reusable abstractions (interfaces + composition)
- Flexible object creation (functions over constructors)
- Behavioral customization (higher-order functions)
- Concurrent coordination (channels over observers)

The patterns that emerged are idiomatic Go — not translated Java.

---

## Mental Model

Go's design philosophy: prefer composition over inheritance, explicit over implicit, small interfaces, and functions over objects.

| Go Feature | Pattern It Replaces |
|---|---|
| `interface{ Method() }` | Strategy, Visitor |
| First-class functions | Command, Template Method |
| Goroutines + channels | Observer, Pub/Sub |
| `sync.Once` | Singleton |
| `defer` | Template Method cleanup |
| Composition (embedding) | Decorator, Adapter |
| Functional options | Builder (flexible construction) |

---

## Creational Patterns

### Singleton with sync.Once

In Go, singletons are trivial with `sync.Once`. No double-checked locking needed.

```go
type Config struct {
    Port int
}

var (
    configInstance *Config
    configOnce     sync.Once
)

func GetConfig() *Config {
    configOnce.Do(func() {
        configInstance = &Config{
            Port: mustLoadEnvInt("PORT", 8080),
        }
    })
    return configInstance
}
```

**Why this works**: `sync.Once` guarantees the function runs exactly once, even under concurrent calls. The runtime manages the memory barrier internally.

### Builder with Functional Options

Functional options are the de-facto builder pattern in Go. Instead of a builder struct with chainable methods, you use variadic option functions.

```go
type ServerOption func(*Server)

func WithPort(port int) ServerOption {
    return func(s *Server) {
        s.Port = port
    }
}

func WithTimeout(timeout time.Duration) ServerOption {
    return func(s *Server) {
        s.Timeout = timeout
    }
}

func WithTLS(certFile, keyFile string) ServerOption {
    return func(s *Server) {
        s.TLSConfig = loadTLS(certFile, keyFile)
    }
}

func NewServer(opts ...ServerOption) *Server {
    s := &Server{
        Port:    8080,        // defaults
        Timeout: 30 * time.Second,
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage
server := NewServer(
    WithPort(9000),
    WithTimeout(60*time.Second),
)
```

**Why this works**: The pattern is:
1. A struct with sensible defaults
2. Variadic option functions that mutate the struct
3. The constructor applies all options

It's self-documenting, extensible (add options without breaking API), and idiomatic. This is the pattern used by gRPC, HTTP servers, database connections, and most Go libraries.

### Factory with Constructor Functions

```go
type Storage interface {
    Save(key string, data []byte) error
    Load(key string) ([]byte, error)
}

func NewStorage(driver string, dsn string) (Storage, error) {
    switch driver {
    case "postgres":
        return newPostgresStorage(dsn)
    case "s3":
        return newS3Storage(dsn)
    case "memory":
        return newMemoryStorage()
    default:
        return nil, fmt.Errorf("unknown storage driver: %s", driver)
    }
}
```

---

## Structural Patterns

### Composition over Inheritance

Go's embedding is not inheritance. You compose types:

```go
type Logger struct{}

func (l Logger) Log(msg string) {
    fmt.Println(msg)
}

type Server struct {
    Logger              // embedded
    Addr     string
    Timeout  time.Duration
}

// Server now has a .Log() method via embedding
s := Server{Addr: ":8080"}
s.Log("starting server") // calls Logger.Log
```

The difference from inheritance: you can override by defining your own `Log`, and embedded methods cannot access the outer struct's fields. It's delegation, not polymorphism.

### Strategy with Interfaces

```go
type Compressor interface {
    Compress(data []byte) ([]byte, error)
    Decompress(data []byte) ([]byte, error)
}

type GzipCompressor struct{ Level int }
type SnappyCompressor struct{}

type Archiver struct {
    Compressor
}

func NewArchiver(c Compressor) *Archiver {
    return &Archiver{Compressor: c}
}
```

### Decorator with Middleware

The middleware pattern is Go's decorator. It wraps an `http.Handler` with another `http.Handler`.

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}

// Usage
handler := Chain(
    myHandler,
    RateLimit(100),
    Logger,
    Auth("jwt-secret"),
)
```

### Adapter

```go
// External library's interface
type PaymentProcessor interface {
    Process(amount float64, currency string) error
}

// Legacy system
type LegacyPayment struct{}

func (l LegacyPayment) Pay(amount int) error {
    // works with cents, not dollars
    return nil
}

// Adapter
type LegacyAdapter struct {
    LegacyPayment
}

func (a LegacyAdapter) Process(amount float64, currency string) error {
    cents := int(amount * 100)
    return a.LegacyPayment.Pay(cents)
}
```

---

## Behavioral Patterns

### Observer with Channels

```go
type Event struct {
    Type string
    Data interface{}
}

type EventBus struct {
    subscribers map[string][]chan Event
    mu          sync.RWMutex
}

func NewEventBus() *EventBus {
    return &EventBus{
        subscribers: make(map[string][]chan Event),
    }
}

func (eb *EventBus) Subscribe(eventType string, buffer int) <-chan Event {
    eb.mu.Lock()
    defer eb.mu.Unlock()
    ch := make(chan Event, buffer)
    eb.subscribers[eventType] = append(eb.subscribers[eventType], ch)
    return ch
}

func (eb *EventBus) Publish(event Event) {
    eb.mu.RLock()
    channels := eb.subscribers[event.Type]
    eb.mu.RUnlock()
    for _, ch := range channels {
        select {
        case ch <- event:
        default:
            // drop if subscriber is slow (non-blocking)
        }
    }
}
```

### State with Interfaces

```go
type TCPState interface {
    Open(conn *TCPConnection) error
    Close(conn *TCPConnection) error
    Read(conn *TCPConnection) ([]byte, error)
}

type TCPConnection struct {
    state TCPState
}

type ClosedState struct{}
type ListenState struct{}
type EstablishedState struct{}

func (c *TCPConnection) Open() error {
    return c.state.Open(c)
}

func (c *TCPConnection) Close() error {
    return c.state.Close(c)
}
```

### Strategy with Functions

When a strategy is a single function, use a function type:

```go
type SortFunc func([]int) []int

func Sort(data []int, strategy SortFunc) []int {
    return strategy(data)
}

func BubbleSort(data []int) []int { /* ... */ }
func QuickSort(data []int) []int { /* ... */ }
```

---

## Concurrency Patterns

### Pipeline

```go
func pipeline(ctx context.Context, input <-chan int) <-chan string {
    multiply := func(in <-chan int) <-chan int {
        out := make(chan int)
        go func() {
            defer close(out)
            for v := range in {
                out <- v * 2
            }
        }()
        return out
    }

    toString := func(in <-chan int) <-chan string {
        out := make(chan string)
        go func() {
            defer close(out)
            for v := range in {
                out <- fmt.Sprintf("result: %d", v)
            }
        }()
        return out
    }

    return toString(multiply(input))
}
```

### Fan-Out / Fan-In

```go
func processBatch(ctx context.Context, items []Item, workers int) []Result {
    jobs := make(chan Item, len(items))
    results := make(chan Result, len(items))

    // Fan-out: start workers
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range jobs {
                select {
                case results <- processItem(item):
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    // Send jobs
    for _, item := range items {
        jobs <- item
    }
    close(jobs)
    wg.Wait()
    close(results)

    // Collect results (fan-in)
    var out []Result
    for r := range results {
        out = append(out, r)
    }
    return out
}
```

### Pub/Sub

```go
type PubSub[T any] struct {
    subscribers []chan T
    mu          sync.RWMutex
}

func NewPubSub[T any]() *PubSub[T] {
    return &PubSub[T]{}
}

func (ps *PubSub[T]) Subscribe(buffer int) <-chan T {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    ch := make(chan T, buffer)
    ps.subscribers = append(ps.subscribers, ch)
    return ch
}

func (ps *PubSub[T]) Publish(msg T) {
    ps.mu.RLock()
    defer ps.mu.RUnlock()
    for _, ch := range ps.subscribers {
        select {
        case ch <- msg:
        default:
        }
    }
}
```

### Circuit Breaker

```go
type CircuitBreaker struct {
    failures     int
    maxFailures  int
    resetTimeout time.Duration
    lastFailure  time.Time
    state        int
    mu           sync.Mutex
}

const (
    StateClosed = iota
    StateOpen
    StateHalfOpen
)

func (cb *CircuitBreaker) Call(fn func() error) error {
    cb.mu.Lock()
    if cb.state == StateOpen {
        if time.Since(cb.lastFailure) > cb.resetTimeout {
            cb.state = StateHalfOpen
        } else {
            cb.mu.Unlock()
            return fmt.Errorf("circuit breaker open")
        }
    }
    cb.mu.Unlock()

    err := fn()

    cb.mu.Lock()
    defer cb.mu.Unlock()

    if err != nil {
        cb.failures++
        cb.lastFailure = time.Now()
        if cb.failures >= cb.maxFailures {
            cb.state = StateOpen
        }
        return err
    }

    cb.failures = 0
    cb.state = StateClosed
    return nil
}
```

---

## Best Practices

1. **Prefer functional options over builder chains** — they're more Go-idiomatic.
2. **Define interfaces where they're consumed**, not where they're produced.
3. **Keep interfaces small** — one or two methods. The standard library's `io.Reader` (one method) is the ideal.
4. **Use embedding for delegation**, not for inheritance.
5. **Accept interfaces, return structs** — return concrete types so consumers can define their own interfaces.
6. **Don't export channels** from package APIs. Return receive-only (`<-chan`) or expose methods.

---

## Common Mistakes

1. **Copying patterns from Java/C++ verbatim**. Go is not those languages. If your Go code looks like Java, you're fighting the language.
2. **Over-engineering with interfaces**. Don't define interfaces before you have two concrete implementations.
3. **Exporting everything**. Unexported types and functions are part of Go's encapsulation model.
4. **Creating unnecessary abstractions**. Go values clarity over cleverness.
5. **Using reflection when a simple interface would do**.

---

## Interview Perspective

1. **Why does Go not have generics (originally)?** The designers prioritized simplicity. Generics were added in 1.18 after a decade of experience.
2. **How does composition differ from inheritance?** Composition is delegation. Embedded methods don't have access to outer struct fields. No virtual dispatch.
3. **What's the functional options pattern?** Variadic option functions applied to a struct with defaults.
4. **How do you implement singleton in Go?** `sync.Once` — it's safe, simple, and handles concurrency.
5. **What patterns become simpler with goroutines?** Observer, Pub/Sub, Pipeline — channels replace callback registries.

---

## Summary

Design patterns in Go are simpler than in classical OOP languages because Go's features (interfaces, composition, first-class functions, concurrency primitives) make many patterns language-level operations. The functional options pattern, middleware chains, and channel-based pipelines are more idiomatic and more powerful than their Java equivalents.

Write Go patterns, not translated Java.

Happy Coding
