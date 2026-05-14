---
title: Go Interview Questions and Answers
description: >-
  Curated Go interview questions covering goroutines, channels, interfaces,
  memory model, concurrency patterns, and backend development for senior roles
date: '2026-05-14'
author: Abhishek Tiwari
tags:
  - go
  - interview
  - preparation
  - senior-engineer
coverImage: /images/go-interview.png
draft: false
order: 10
---
# Go Interview Questions and Answers

## Overview

This is not a list of trivia. Each question connects to a real production concern. When interviewers ask about goroutine stack sizes, they want to know if you understand resource management. When they ask about interface satisfaction, they want to know if you understand Go's type system well enough to design extensible systems.

---

## 1. How do goroutines differ from OS threads?

**What**: Goroutines are user-space threads managed by the Go runtime. OS threads are kernel-managed.

| | Goroutine | OS Thread |
|---|---|---|
| Stack size | ~4KB, grows dynamically | ~1MB, fixed reserve |
| Creation cost | ~500ns, no syscall | ~1-10μs, kernel transition |
| Context switch | ~50ns (userspace) | ~1μs (kernel mode) |
| Max count | Millions per process | Thousands per system |
| Preemption | Cooperative + 10ms preemption | Kernel preemptive |

**Why it matters in production**: A service handling 10K WebSocket connections needs 10K goroutines (~40MB stack total). With threads, that'd be 10GB. The math doesn't work.

---

## 2. Explain the GMP model (Goroutine, Machine, Processor).

**G (Goroutine)**: A struct with stack, PC/SP, state. Holds the execution context.
**M (Machine)**: An OS thread. Does the actual work.
**P (Processor)**: A scheduling context. Has a local run queue. `GOMAXPROCS` controls P count.

**Scheduling flow**:
1. A P picks a G from its local run queue
2. The G executes on the M attached to that P
3. If the G blocks on a syscall, the M blocks; the P finds another M
4. If the G blocks on a channel, it's parked; the P picks the next G
5. If a P's local queue is empty, it steals from other Ps (work stealing) or the global queue

**Why it matters**: Understanding work stealing explains why Go programs scale well. A P never idle when there's work — it actively steals. This minimizes latency.

---

## 3. What happens when you send to a closed channel?

**Answer**: It panics. Sending on a closed channel is a runtime error.

```go
ch := make(chan int)
close(ch)
ch <- 42 // panic: send on closed channel
```

Receiving from a closed channel is different — it returns the zero value immediately with `ok=false`.

```go
ch := make(chan int)
close(ch)
val, ok := <-ch // val=0, ok=false
```

**Production impact**: If your producer closes the channel while a consumer is still sending, your process crashes. Always close from the sender side and use `sync.Once` if multiple goroutines might close.

---

## 4. Channel vs sync.Mutex: when to use each?

**Use channels** when you're transferring ownership of data or signaling between goroutines:

```go
// Ownership transfer
jobs <- workItem
result := <-results
```

**Use mutexes** when you're protecting shared state accessed by multiple goroutines:

```go
mu.Lock()
cache[userID] = profile
mu.Unlock()
```

**Rule of thumb**: Channels orchestrate, mutexes protect. Channels are about communication patterns (pipelines, fan-out). Mutexes are about critical sections (protecting maps, counters). Channels are slower than mutexes for simple state protection (channel ops ~50ns, mutex ~10ns).

---

## 5. How does Go handle interface satisfaction?

Go uses structural typing (duck typing at compile time). A type satisfies an interface if it implements all the methods in the interface. No explicit `implements` keyword.

```go
type Writer interface {
    Write([]byte) (int, error)
}

// *os.File satisfies Writer because it has Write method
var w Writer = os.Stdout

// Any type with a Write method works
type ConsoleWriter struct{}

func (c ConsoleWriter) Write(p []byte) (int, error) {
    return fmt.Print(string(p))
}
```

The interface value is stored as a two-word struct: `(type, pointer)`. This is called the `iface` struct in the runtime:

```go
type iface struct {
    tab  *itab   // type info + method table
    data unsafe.Pointer // pointer to actual value
}
```

**Why it matters**: Interface satisfaction is compile-time checked for concrete type to interface conversion. But `interface{}` (now `any`) bypasses this — passing `any` values means you lose type safety. Prefer specific interfaces.

---

## 6. What is the zero value in Go and why does it matter?

Every type in Go has a zero value when declared without initialization:

```go
var i int        // 0
var s string     // ""
var b bool       // false
var p *int       // nil
var m map[int]string // nil
var ch chan int  // nil
var sl []int     // nil
var st struct{}  // zero-valued struct
```

**Why it matters**: Go designed zero values so types are immediately usable without constructors:

```go
var mu sync.Mutex
mu.Lock() // works immediately, no NewMutex() needed

var buf bytes.Buffer
buf.WriteString("hello") // works immediately
```

This is a key Go philosophy: make zero values useful. When designing your own types, consider making zero values usable.

---

## 7. How does defer work? What's the order of execution?

Defer pushes a function call onto a stack. When the surrounding function returns (normally or via panic), deferred calls execute in LIFO order.

```go
func example() {
    defer fmt.Println("first")    // pushed first
    defer fmt.Println("second")   // pushed second
    defer fmt.Println("third")    // pushed third
    // Output: third, second, first
}
```

Arguments to defer are evaluated immediately, not when the deferred function runs:

```go
func count() {
    i := 0
    defer fmt.Println(i) // prints 0, not 1
    i++
}
```

**Use cases**: Cleanup (close files, unlock mutexes), logging function entry/exit, recovering panics.

```go
f, _ := os.Open(path)
defer f.Close()

mu.Lock()
defer mu.Unlock()
```

---

## 8. Explain panic and recover.

`panic` is a runtime error that unwinds the stack, running deferred functions along the way. `recover` stops the unwinding.

```go
func safeCall(fn func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    fn()
    return nil
}
```

**Key rule**: `recover` only works inside a deferred function. It returns nil if called from anywhere else.

**Production impact**: A panic that reaches the top of a goroutine crashes the entire process, not just the goroutine. Use `recover` only at the top level (HTTP handlers, goroutine entrypoints).

---

## 9. How does the Go GC work?

Go uses a **non-generational concurrent tri-color mark-sweep** garbage collector.

**Phases**:
1. **Mark Setup**: STW (stop-the-world), enables write barrier (~10-30μs)
2. **Marking**: Concurrent with mutator. GC roots are traced. Write barrier tracks pointer changes.
3. **Mark Termination**: STW, finishes marking, disables write barrier (~10-30μs)
4. **Sweeping**: Concurrent, frees unused memory. Happens incrementally between allocations.

**Pacing**: The GC starts when the live heap doubles (default GOGC=100). With GOGC=100, if live heap is 10MB, GC triggers at 20MB.

**Tuning**: `GOGC=off` disables GC (not recommended). `GOGC=200` reduces GC frequency at the cost of more memory. `GOMEMLIMIT` (Go 1.19+) sets a soft memory cap.

---

## 10. What causes heap allocations (escape analysis)?

The compiler performs escape analysis to decide whether a value goes on the stack or heap.

```go
func createUser() *User {
    u := User{Name: "Alice"} // u escapes to heap
    return &u
}

func process() {
    buf := make([]byte, 1024) // small, stays on stack
    buf := make([]byte, 1024*1024) // >64KB, heap
}

func process() {
    data := []byte("hello")
    json.Unmarshal(data, &v) // v might escape
}
```

Variables escape to heap when:
- They're returned via pointer
- They're stored in an interface (interface boxing)
- They're captured by a closure
- They're larger than the stack (64KB)
- The compiler can't prove their lifetime is bounded

**Why it matters**: Heap allocations increase GC pressure. Knowing escape analysis lets you write allocation-free hot paths.

---

## 11. Pointer vs value receiver methods: decisions and tradeoffs.

| | Value Receiver | Pointer Receiver |
|---|---|---|
| Non-nil receiver | ✓ | ✓ |
| Nil receiver | ✓ | ✓ |
| Modifies receiver | No (copy) | Yes |
| Interface satisfaction | Value + pointer satisfy | Only pointer satisfies |
| Allocation | No allocation if receiver is on stack | Possible allocation if value -> pointer conversion |

```go
func (u User) Name() string { return u.name }    // value: read-only
func (u *User) SetName(n string) { u.name = n }  // pointer: mutation
```

**Decision rules**:
- Use pointer receiver if the method mutates the receiver
- Use pointer receiver if the struct contains `sync.Mutex` (to avoid copying)
- Use value receiver for small immutable structs
- Be consistent: if one method needs pointer, use pointer for all

---

## 12. How does context cancellation work?

`context.Context` is a tree of cancellation signals. When a parent is cancelled, all children are cancelled.

```go
ctx, cancel := context.WithCancel(context.Background())
go process(ctx)

// Later: cancel all children
cancel()

func process(ctx context.Context) {
    select {
    case <-time.After(10 * time.Second):
        fmt.Println("done")
    case <-ctx.Done():
        fmt.Println("cancelled:", ctx.Err())
    }
}
```

**Implementation**: `context.WithCancel` creates a child context. The returned cancel function closes a channel (`ctx.Done()`). All goroutines waiting on `<-ctx.Done()` wake up simultaneously (channel close broadcasts to all receivers).

---

## 13. What's in the sync package beyond Mutex?

| Type | Purpose |
|---|---|
| `sync.Mutex` | Mutual exclusion lock |
| `sync.RWMutex` | Reader/writer lock |
| `sync.WaitGroup` | Wait for goroutine completion |
| `sync.Once` | Execute exactly once |
| `sync.Pool` | Reusable object pool |
| `sync.Map` | Concurrent-safe map (specific use cases) |
| `sync.Cond` | Condition variable (rarely needed) |

**sync.Pool example**:

```go
var bufferPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func processRequest(r *http.Request) {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer bufferPool.Put(buf)
    buf.Reset()
    // use buf
}
```

**sync.Pool gotcha**: Items in the pool can be garbage collected between GC cycles. Don't rely on pooled items surviving.

---

## 14. How does go test work? What about -race, -bench, -cover?

```bash
go test ./...          # test all packages
go test -v             # verbose output
go test -race          # enable race detector
go test -bench=.       # run benchmarks
go test -cover         # show coverage
go test -fuzz=.        # run fuzz tests (Go 1.18+)
```

**Race detector**: Uses ThreadSanitizer (TSan). Instrumented code detects data races at runtime. Essential for CI. Performance overhead ~5-10x, but catches real bugs.

**Benchmarking**:

```go
func BenchmarkHash(b *testing.B) {
    data := []byte("hello world")
    for b.Loop() {  // Go 1.24+ new loop API
        sha256.Sum256(data)
    }
}
```

---

## 15. Explain Go's memory model regarding happens-before.

Go's memory model defines when a read of a variable must observe a write from another goroutine.

**Key guarantees**:
- A send on a channel **happens-before** the corresponding receive
- A receive from an unbuffered channel **happens-before** the send completes
- `sync.Mutex.Unlock()` **happens-before** the next `Lock()`
- `sync.WaitGroup.Wait()` returns **after** all `Done()` calls

```go
var data int
ch := make(chan struct{})

// Goroutine A
go func() {
    data = 42
    ch <- struct{}{}  // happens-before
}()

// Goroutine B
<-ch                 // happens-after the send
fmt.Println(data)   // guaranteed: 42
```

Without the channel, there's no ordering guarantee, and `data` could be zero.

---

## 16. What are build tags and when do you use them?

Build tags conditionally include files:

```go
//go:build linux

package main

func init() {
    log.SetFlags(log.Lshortfile)
}
```

```go
//go:build !linux && !darwin

package main

func init() {
    log.SetFlags(log.LstdFlags)
}
```

**Uses**: Platform-specific code, integration tests (with `//go:build integration`), feature flags.

Run with: `go test -tags=integration`

---

## 17. How does the net/http server handle concurrent requests?

Each incoming HTTP request runs in its own goroutine automatically.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // This runs in a new goroutine per request
    process(r)
}

http.HandleFunc("/api", handler)
log.Fatal(http.ListenAndServe(":8080", nil))
```

The `http.Server` uses a goroutine-per-connection model. For each accepted TCP connection, a goroutine is spawned. The connection goroutine reads HTTP requests and dispatches handler goroutines.

**Production considerations**:
- Set `ReadTimeout`, `WriteTimeout`, `IdleTimeout` to prevent resource leaks
- Use `http.TimeoutHandler` to limit handler execution time
- Connection pooling to upstream services is handled by `http.Transport`

---

## 18. What's the difference between json.Marshal and json.NewEncoder?

```go
// json.Marshal: allocates []byte containing full JSON
data, _ := json.Marshal(largeStruct)
w.Write(data)

// json.NewEncoder: streams JSON directly to writer
json.NewEncoder(w).Encode(largeStruct)
```

**json.Marshal** buffers the entire output in memory. Use for small payloads.
**json.NewEncoder** writes incrementally. Use for large payloads or HTTP responses.

Similarly, `json.Unmarshal` vs `json.NewDecoder`:
- `Unmarshal` loads the entire input into memory
- `Decoder` reads from a stream token by token

---

## 19. How does go mod solve dependency management?

`go mod` manages dependencies with versioned modules.

```bash
go mod init github.com/user/project
go get github.com/lib/pq@v1.10.9
go mod tidy  # add missing, remove unused
go mod verify # verify checksums
```

**Vendor directory**: `go mod vendor` copies dependencies to a `vendor/` folder. Commit this if you need reproducible builds without network access.

**Minimal version selection (MVS)**: Go uses MVS to resolve dependencies. If module A requires B v1.2 and module C requires B v1.5, Go uses v1.5 (the minimum version that satisfies all requirements). This avoids the "dependency hell" of semantic versioning conflict resolution.

---

## 20. How would you implement graceful shutdown?

```go
func main() {
    server := &http.Server{Addr: ":8080"}

    go func() {
        if err := server.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    // Wait for interrupt
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
    <-quit

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := server.Shutdown(ctx); err != nil {
        log.Fatal("forced to shutdown:", err)
    }
}
```

---

## Summary

These 20 questions cover the core of what senior Go engineers need to know: concurrency model, memory management, type system, standard library, and production operations. Each connects to real engineering decisions — goroutine scheduling affects request latency, escape analysis affects GC pressure, and interface design affects system extensibility.

---

## References

- [Go Memory Model](https://go.dev/ref/mem)
- [Effective Go](https://go.dev/doc/effective_go)
- [Go by Example](https://gobyexample.com/)
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22)

Happy Coding
