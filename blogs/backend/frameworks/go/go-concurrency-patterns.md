---
title: "Go Concurrency Patterns"
description: "Master Go concurrency: goroutines, channels, select, sync primitives, worker pools, pipeline patterns, and building concurrent applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - go
  - concurrency
  - goroutines
  - channels
coverImage: "/images/go-concurrency-patterns.png"
draft: false
---

## Overview

Go's concurrency model is based on Communicating Sequential Processes (CSP). Goroutines are lightweight threads, and channels enable safe communication between them. This guide covers essential concurrency patterns for building concurrent Go applications.

## Goroutines

### Basic Goroutines

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func worker(id int) {
    fmt.Printf("Worker %d starting\n", id)
    time.Sleep(time.Second)
    fmt.Printf("Worker %d done\n", id)
}

func main() {
    // Launch goroutines
    go worker(1)
    go worker(2)
    go worker(3)

    // Wait for goroutines
    time.Sleep(2 * time.Second)
}
```

### WaitGroup

```go
func main() {
    var wg sync.WaitGroup

    for i := 1; i <= 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            worker(id)
        }(i)
    }

    wg.Wait()
    fmt.Println("All workers completed")
}
```

## Channels

### Basic Channel Operations

```go
func main() {
    // Unbuffered channel
    messages := make(chan string)

    go func() {
        messages <- "hello" // Blocks until receiver is ready
    }()

    msg := <-messages // Blocks until sender sends
    fmt.Println(msg)

    // Buffered channel
    tasks := make(chan string, 3)

    tasks <- "task1"
    tasks <- "task2"
    tasks <- "task3"

    close(tasks)

    for task := range tasks {
        fmt.Println("Processing:", task)
    }
}
```

### Channel Direction

```go
// Send-only channel
func produce(out chan<- int) {
    for i := 0; i < 5; i++ {
        out <- i
    }
    close(out)
}

// Receive-only channel
func consume(in <-chan int) {
    for value := range in {
        fmt.Println("Received:", value)
    }
}

func main() {
    ch := make(chan int)

    go produce(ch)
    consume(ch)
}
```

## Select Statement

```go
func main() {
    ch1 := make(chan string)
    ch2 := make(chan string)

    go func() {
        time.Sleep(1 * time.Second)
        ch1 <- "one"
    }()

    go func() {
        time.Sleep(2 * time.Second)
        ch2 <- "two"
    }()

    select {
    case msg1 := <-ch1:
        fmt.Println("Received from ch1:", msg1)
    case msg2 := <-ch2:
        fmt.Println("Received from ch2:", msg2)
    case <-time.After(500 * time.Millisecond):
        fmt.Println("Timeout!")
    }
}
```

### Non-Blocking Operations

```go
func main() {
    messages := make(chan string)
    signals := make(chan bool)

    select {
    case msg := <-messages:
        fmt.Println("Received:", msg)
    default:
        fmt.Println("No message received")
    }

    msg := "hello"
    select {
    case messages <- msg:
        fmt.Println("Sent:", msg)
    default:
        fmt.Println("No message sent")
    }

    select {
    case msg := <-messages:
        fmt.Println("Received:", msg)
    case sig := <-signals:
        fmt.Println("Received signal:", sig)
    default:
        fmt.Println("No activity")
    }
}
```

## Worker Pool Pattern

```go
type Job struct {
    ID      int
    Payload string
}

type Result struct {
    JobID    int
    Output   string
    Duration time.Duration
}

func worker(id int, jobs <-chan Job, results chan<- Result) {
    for job := range jobs {
        fmt.Printf("Worker %d processing job %d\n", id, job.ID)
        start := time.Now()

        // Simulate work
        time.Sleep(time.Second)
        output := fmt.Sprintf("processed-%s", job.Payload)

        results <- Result{
            JobID:    job.ID,
            Output:   output,
            Duration: time.Since(start),
        }
    }
}

func main() {
    const numJobs = 10
    const numWorkers = 3

    jobs := make(chan Job, numJobs)
    results := make(chan Result, numJobs)

    // Start workers
    var wg sync.WaitGroup
    for w := 1; w <= numWorkers; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            worker(id, jobs, results)
        }(w)
    }

    // Send jobs
    for j := 1; j <= numJobs; j++ {
        jobs <- Job{ID: j, Payload: fmt.Sprintf("task-%d", j)}
    }
    close(jobs)

    // Close results when all workers are done
    go func() {
        wg.Wait()
        close(results)
    }()

    // Collect results
    for result := range results {
        fmt.Printf("Job %d: %s (took %v)\n",
            result.JobID, result.Output, result.Duration)
    }
}
```

## Pipeline Pattern

```go
func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, n := range nums {
            out <- n
        }
        close(out)
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n * n
        }
        close(out)
    }()
    return out
}

func multiply(in <-chan int, factor int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n * factor
        }
        close(out)
    }()
    return out
}

func main() {
    // Pipeline: generate -> square -> multiply
    numbers := generate(1, 2, 3, 4, 5)
    squared := square(numbers)
    multiplied := multiply(squared, 10)

    for result := range multiplied {
        fmt.Println(result) // 10, 40, 90, 160, 250
    }
}
```

## Fan-Out / Fan-In

```go
func fanOut(in <-chan int, workers int) []<-chan int {
    channels := make([]<-chan int, workers)
    for i := 0; i < workers; i++ {
        ch := make(chan int)
        channels[i] = ch

        go func(out chan<- int) {
            for v := range in {
                out <- v * v
            }
            close(out)
        }(ch)
    }
    return channels
}

func fanIn(channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup

    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan int) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(ch)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}

func main() {
    numbers := make(chan int, 10)
    for i := 1; i <= 10; i++ {
        numbers <- i
    }
    close(numbers)

    // Fan-out to 3 workers, then fan-in results
    workers := fanOut(numbers, 3)
    results := fanIn(workers...)

    for r := range results {
        fmt.Println(r)
    }
}
```

## Context Propagation

```go
func operation(ctx context.Context, duration time.Duration) error {
    select {
    case <-time.After(duration):
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
    defer cancel()

    ch := make(chan error, 1)

    go func() {
        ch <- operation(ctx, 1*time.Second)
    }()

    select {
    case err := <-ch:
        if err != nil {
            fmt.Println("Operation failed:", err)
        }
    case <-ctx.Done():
        fmt.Println("Operation timed out")
    }
}
```

## Testing Concurrency

```go
func TestWorkerPool(t *testing.T) {
    jobs := make(chan Job, 5)
    results := make(chan Result, 5)

    go worker(1, jobs, results)

    // Send jobs
    for i := 1; i <= 3; i++ {
        jobs <- Job{ID: i, Payload: fmt.Sprintf("test-%d", i)}
    }
    close(jobs)

    // Collect results
    for i := 1; i <= 3; i++ {
        result := <-results
        assert.Equal(t, i, result.JobID)
        assert.Contains(t, result.Output, "processed-")
    }
}

func TestPipeline(t *testing.T) {
    numbers := generate(1, 2, 3)
    squared := square(numbers)
    result := multiply(squared, 2)

    var outputs []int
    for v := range result {
        outputs = append(outputs, v)
    }

    assert.Equal(t, []int{2, 8, 18}, outputs)
}
```

## Best Practices

1. **Use WaitGroup for goroutine synchronization** - not time.Sleep
2. **Close channels from the sender side** - never from receiver
3. **Use select for non-blocking operations** and timeouts
4. **Use context.Context for cancellation** and deadlines
5. **Limit goroutine creation** with worker pools
6. **Use buffered channels** when producers and consumers have different speeds
7. **Avoid race conditions** with mutexes or atomic operations

## Common Mistakes

### Mistake 1: Goroutine Leaks

```go
// Wrong: Goroutine never exits
func leakyFunction() chan int {
    ch := make(chan int)
    go func() {
        for {
            ch <- 1 // Blocks forever if no one reads
        }
    }()
    return ch
}
```

```go
// Correct: Close channel or use context
func safeFunction(ctx context.Context) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < 10; i++ {
            select {
            case ch <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return ch
}
```

### Mistake 2: Sending on Closed Channel

```go
// Wrong: Panics when sending on closed channel
ch := make(chan int)
close(ch)
ch <- 1 // panic: send on closed channel
```

```go
// Correct: Close from sender only after all sends
func safeSend(ch chan<- int) {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- i
    }
}
```

## Summary

Go's concurrency model using goroutines and channels enables efficient concurrent programming. Use WaitGroup for synchronization, channels for communication, select for multiplexing, and context for cancellation. Implement worker pools for controlled concurrency and pipelines for staged processing.

## References

- [Go Concurrency Documentation](https://go.dev/doc/effective_go#concurrency)
- [Go by Example: Goroutines](https://gobyexample.com/goroutines)
- [Go Memory Model](https://go.dev/ref/mem)
- [Context Package](https://pkg.go.dev/context)

Happy Coding