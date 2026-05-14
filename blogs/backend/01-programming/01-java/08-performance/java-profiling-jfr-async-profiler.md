---
title: Java Profiling with JFR and Async Profiler
description: >-
  Profile Java applications using JDK Flight Recorder and async-profiler for
  CPU, memory, and latency analysis
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - performance
  - profiling
  - jfr
  - async-profiler
  - java
coverImage: /images/java-profiling-jfr-async-profiler.png
draft: false
order: 30
---
# Java Profiling with JFR and Async Profiler

## Overview

JDK Flight Recorder (JFR) and async-profiler are two essential tools for Java performance analysis. JFR provides low-overhead event recording built into the JVM. Async-profiler uses Linux perf_events for CPU and allocation profiling with minimal overhead.

### When to Profile

- CPU spikes or high usage
- Memory pressure or leaks
- Latency problems
- Thread contention
- Understanding code behavior

---

## JDK Flight Recorder (JFR)

### Enabling JFR

```bash
# Start recording on startup
java -XX:StartFlightRecording=name=myrecording,filename=recording.jfr,duration=60s,settings=profile \
     -jar application.jar

# Start recording on running process
jcmd <PID> JFR.start name=myrecording settings=profile duration=60s filename=recording.jfr

# Dump recording
jcmd <PID> JFR.dump name=myrecording filename=recording.jfr

# Stop recording
jcmd <PID> JFR.stop name=myrecording

# List recordings
jcmd <PID> JFR.check
```

### Programmatic JFR

```java
@Service
public class JfrRecordingService {

    public void startCustomRecording(String name, Duration duration) {
        Recording recording = new Recording();
        recording.setName(name);
        recording.setDuration(duration);

        // Configure events to capture
        recording.enable("jdk.CPULoad").withPeriod(Duration.ofSeconds(1));
        recording.enable("jdk.GarbageCollection").withStackTrace(true);
        recording.enable("jdk.ObjectAllocationInNewTLAB");
        recording.enable("jdk.ThreadSleep");
        recording.enable("jdk.JavaMonitorEnter");
        recording.enable("jdk.ExceptionThrows");
        recording.enable("jdk.SocketRead");
        recording.enable("jdk.SocketWrite");

        // Start recording
        recording.start();
    }

    public void dumpRecording(String name, Path outputPath) throws IOException {
        Recording recording = RecordingSupport.getRecordingByName(name);
        if (recording != null) {
            recording.dump(outputPath);
        }
    }

    @EventListener
    public void onJfrEvent(RecordedEvent event) {
        // Process JFR events programmatically
        if (event.getEventType().getName().equals("jdk.CPULoad")) {
            double jvmUser = event.getDouble("jvmUser");
            double machineTotal = event.getDouble("machineTotal");
            log.info("JVM CPU: {}%, Machine CPU: {}%",
                jvmUser * 100, machineTotal * 100);
        }
    }
}
```

The JFR API (`jdk.jfr.Recording`) gives programmatic control over which events are captured and at what frequency. Enabling `jdk.GarbageCollection` with `withStackTrace(true)` lets you see not just that a GC happened, but what code path triggered it (e.g., an allocation-heavy method). `jdk.ObjectAllocationInNewTLAB` tracks allocations inside Thread-Local Allocation Buffers — high rates here indicate allocation hotspots even if individual objects are small. `jdk.JavaMonitorEnter` captures lock contention events with stack traces, directly pointing to the `synchronized` block or `Lock` that bottlenecks throughput.

### JFR Event Types

```java
// Common JFR events for performance analysis

// CPU
// jdk.CPULoad - System CPU utilization
// jdk.ThreadCPULoad - Per-thread CPU
// jdk.ExecutionSample - Stack traces at intervals

// Memory
// jdk.GarbageCollection - GC pause times
// jdk.ObjectAllocationInNewTLAB - TLAB allocations
// jdk.ObjectAllocationOutsideTLAB - Large allocations

// I/O
// jdk.SocketRead - Socket read duration
// jdk.SocketWrite - Socket write duration
// jdk.FileRead - File read duration
// jdk.FileWrite - File write duration

// Threading
// jdk.ThreadStart, jdk.ThreadEnd - Thread lifecycle
// jdk.ThreadSleep - Sleeping threads
// jdk.JavaMonitorEnter - Lock contention
// jdk.JavaMonitorWait - Object.wait()

// Exceptions
// jdk.ExceptionThrows - All exceptions thrown
// jdk.ErrorThrown - All errors thrown
```

---

## Async-Profiler

### Installation and Usage

```bash
# Download async-profiler
# https://github.com/async-profiler/async-profiler

# CPU profiling
asprof -e cpu -d 30 -f cpu-profile.html <PID>
asprof -e cpu -d 30 -o jfr -f cpu-profile.jfr <PID>

# Allocation profiling
asprof -e alloc -d 30 -f alloc-profile.html <PID>
asprof -e alloc -d 30 -o jfr -f alloc-profile.jfr <PID>

# Wall-clock profiling (includes blocking calls)
asprof -e wall -d 30 -f wall-profile.html <PID>

# Lock profiling
asprof -e lock -d 30 -f lock-profile.html <PID>

# Generate flame graph from existing JFR
asprof -f flamegraph.html <PID>
```

### Integration with Spring Boot

```java
@RestController
@RequestMapping("/internal/profiling")
public class ProfilingController {

    @PostMapping("/start")
    public ResponseEntity<String> startProfiling(
            @RequestParam(defaultValue = "cpu") String event,
            @RequestParam(defaultValue = "30") int duration,
            @RequestParam(defaultValue = "html") String format) {

        try {
            ProcessBuilder pb = new ProcessBuilder(
                "asprof",
                "-e", event,
                "-d", String.valueOf(duration),
                "-f", "/tmp/profile-" + System.currentTimeMillis() + "." + format,
                String.valueOf(ProcessHandle.current().pid())
            );

            Process process = pb.start();
            int exitCode = process.waitFor();

            if (exitCode == 0) {
                return ResponseEntity.ok("Profiling completed");
            } else {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Profiling failed with code: " + exitCode);
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("Error: " + e.getMessage());
        }
    }
}
```

Exposing profiling triggers as secured HTTP endpoints enables on-demand profiling in production without SSH access to every node. The `ProcessBuilder` approach invokes `asprof` (formerly `async-profiler`) as an external process, passing the JVM's PID via `ProcessHandle.current().pid()`. In production, this endpoint must be locked down — typically via a separate internal port, mTLS, or Spring Security IP allowlisting. The wall-clock event (`-e wall`) is especially useful for production: it samples the thread's state regardless of whether the CPU is active, revealing blocked threads that CPU profiling would miss entirely.

### Flame Graph Analysis

```java
// Flame graphs show:
// - Width of each bar = time spent in that method
// - Color = different code paths
// - Stack depth = call chain

// CPU Flame Graph:
// - Top of the graph = hottest methods
// - Wide bars at the top = direct CPU consumers
// - Wide bars at the bottom = methods with many callers

// Memory Flame Graph:
// - Shows allocation hot spots
// - Top = most allocating methods
// - Can identify allocation-heavy code paths
```

---

## Comparing JFR and Async-Profiler

| Aspect | JFR | Async-Profiler |
|--------|-----|----------------|
| Overhead | < 1% | < 1% |
| CPU profiling | Yes (sampling) | Yes (perf_events) |
| Allocation profiling | Yes (TLAB) | Yes (perf_events) |
| Wall-clock profiling | Limited | Yes |
| Lock profiling | Yes | Yes |
| Stack traces | Yes | Yes |
| Native frames | Limited | Yes |
| Java version | JDK 11+ (commercial), JDK 8u40+ | JDK 7+ |
| Output | JFR format | HTML, JFR, SVG |

---

## Profiling Workflow

### CPU Profiling Example

```java
@Service
public class ProfilingWorkflowService {

    // Problem: High CPU usage in production
    // Step 1: Take CPU profile
    // asprof -e cpu -d 30 -f cpu.html <PID>

    // Step 2: Analyze flame graph
    // - Find the widest bar at the top
    // - Look for unexpected hot methods

    // Step 3: Common CPU issues found through profiling

    // Issue 1: Inefficient serialization
    public String badSerialization(Object obj) {
        return new ObjectMapper().writeValueAsString(obj);
        // Creates new ObjectMapper every time!
    }

    // Fix: Reuse ObjectMapper
    private static final ObjectMapper mapper = new ObjectMapper();
    public String goodSerialization(Object obj) throws JsonProcessingException {
        return mapper.writeValueAsString(obj);
    }

    // Issue 2: Heavy computation in loops
    public List<Long> badPrimeGeneration(int limit) {
        List<Long> primes = new ArrayList<>();
        for (long i = 2; i < limit; i++) {
            if (isPrime(i)) { // Expensive per call
                primes.add(i);
            }
        }
        return primes;
    }

    // Fix: Optimize or cache
    public List<Long> goodPrimeGeneration(int limit) {
        return IntStream.rangeClosed(2, limit)
            .parallel() // Parallel processing
            .filter(this::isPrimeOptimized)
            .boxed()
            .toList();
    }
}
```

### Memory Profiling Example

```java
@Service
public class MemoryProfilingService {

    // Problem: High allocation rate or memory pressure
    // Step 1: Profile allocations
    // asprof -e alloc -d 30 -f alloc.html <PID>

    // Step 2: Look for allocation hot spots

    // Issue 1: Creating objects in loops
    public List<String> badStringProcessing(List<String> inputs) {
        List<String> result = new ArrayList<>();
        for (String input : inputs) {
            StringBuilder sb = new StringBuilder(); // Created per iteration
            sb.append("prefix_");
            sb.append(input);
            result.add(sb.toString());
        }
        return result;
    }

    // Fix: Reduce allocations
    public List<String> goodStringProcessing(List<String> inputs) {
        return inputs.stream()
            .map(input -> "prefix_" + input)
            .toList();
    }

    // Issue 2: Autoboxing in hot paths
    public long badSum(List<Integer> numbers) {
        long total = 0;
        for (Integer n : numbers) { // Unnecessary boxing
            total += n; // Autounboxing
        }
        return total;
    }

    // Fix: Use primitive streams
    public long goodSum(List<Integer> numbers) {
        return numbers.stream()
            .mapToLong(Integer::longValue)
            .sum();
    }
}
```

---

## Best Practices

### 1. Profile in Production-Like Conditions

```java
// Profile under realistic load
// Use JMeter, Gatling, or k6 to generate traffic

ProfilingConfig config = new ProfilingConfig();
config.setEvent("cpu");
config.setDuration(60); // 60 seconds
config.setOutput("/tmp/production-profile.html");
```

### 2. Compare Before and After

```java
// Baseline profile
asprof -e cpu -d 30 -f before-optimization.html <PID>

// Apply optimization
// ... deploy changes ...

// Post-optimization profile
asprof -e cpu -d 30 -f after-optimization.html <PID>

// Compare flame graphs side by side
```

---

## Common Mistakes

### Mistake 1: Profiling at Wrong Time

```java
// WRONG: Profiling during application startup
// Startup includes classloading and warmup

// CORRECT: Profile after warmup period
// Run 10-15 minutes before profiling
```

### Mistake 2: Too Short Profiling Duration

```bash
# WRONG: 5 seconds doesn't capture representative behavior
asprof -e cpu -d 5 -f profile.html <PID>

# CORRECT: 30-60 seconds minimum for meaningful data
asprof -e cpu -d 60 -f profile.html <PID>
```

### Mistake 3: Ignoring Native Methods

```java
// WRONG: JFR might miss native call stacks
// JFR: Native frames can be missing

// FIX: Use async-profiler for native profiling
// asprof supports native stack traces via perf_events
```

---

## Summary

JFR and async-profiler are complementary tools for Java profiling:

1. JFR provides built-in, zero-overhead event recording
2. Async-profiler provides CPU, allocation, and wall-clock profiling
3. Flame graphs visualize hot methods and allocation patterns
4. Profile under realistic production conditions
5. Profile for sufficient duration (30-60 seconds minimum)
6. Compare before and after optimizations
7. Combine both tools for comprehensive analysis

---

## References

- [JDK Flight Recorder Documentation](https://docs.oracle.com/en/java/javase/17/jfapi/)
- [Async Profiler GitHub](https://github.com/async-profiler/async-profiler)
- [Java Performance Tools](https://docs.oracle.com/en/java/javase/17/troubleshoot/diagnostic-tools.html)

Happy Coding
