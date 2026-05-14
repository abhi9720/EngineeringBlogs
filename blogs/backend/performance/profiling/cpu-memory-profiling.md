---
title: "CPU and Memory Profiling"
description: "Techniques for CPU and memory profiling: heap analysis, GC logging, leak detection, and performance bottlenecks"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - profiling
  - cpu
  - memory
  - heap-analysis
coverImage: "/images/cpu-memory-profiling.png"
draft: false
---

# CPU and Memory Profiling

## Overview

CPU and memory profiling are the two most common performance analysis activities. CPU profiling identifies where the processor spends its time, while memory profiling reveals allocation patterns, memory leaks, and garbage collection issues.

### Key Metrics

| Metric | CPU Profiling | Memory Profiling |
|--------|--------------|-----------------|
| What | Time spent in methods | Objects allocated |
| Tool | async-profiler, JFR | jmap, Eclipse MAT |
| Output | Flame graph | Heap dump |
| Targets | Hot methods, spin loops | Leaks, bloat |

---

## CPU Profiling

### Identifying CPU Bottlenecks

```java
@Service
public class CpuBottleneckAnalysis {

    // Problem: High CPU usage
    // Profile shows this method as hottest

    // Bad: Inefficient algorithm
    public List<Product> filterProductsBad(List<Product> products, String query) {
        List<Product> result = new ArrayList<>();
        for (Product p : products) {
            if (p.getName() != null && query != null &&
                p.getName().toLowerCase().contains(query.toLowerCase())) {
                result.add(p);
            }
        }
        return result;
        // O(n) but String operations are expensive
        // Creates many intermediate String objects
    }

    // Good: Optimized algorithm
    public List<Product> filterProductsGood(List<Product> products, String query) {
        Pattern pattern = Pattern.compile(Pattern.quote(query),
            Pattern.CASE_INSENSITIVE);

        return products.stream()
            .filter(p -> p.getName() != null)
            .filter(p -> pattern.matcher(p.getName()).find())
            .toList();
        // Pre-compiled regex, fewer allocations
    }

    // Profile output interpretation:
    // Self time: Time spent in method's own code
    // Total time: Self time + time in called methods
    // Sample count: How many times this method appeared in stack traces
}

// CPU profile interpretation guide
public class CpuProfileAnalysis {

    public void analyze() {
        // Top methods in CPU profile:

        // 1. String operations (StringBuilder, toString, format)
        // => Optimize string handling, use StringBuilder

        // 2. Serialization/deserialization
        // => Reuse ObjectMapper, use protobuf if possible

        // 3. Database interaction
        // => Add indexes, optimize queries, add caching

        // 4. I/O operations
        // => Use async I/O, increase buffer sizes

        // 5. Thread contention
        // => Reduce synchronization, use lock-free structures
    }
}
```

### Thread State Analysis

```java
@Component
public class ThreadStateAnalyzer {

    public void analyzeThreadStates() {
        // RUNNABLE: Thread is executing (good, means CPU is working)
        // BLOCKED: Thread waiting for monitor lock (contention!)
        // WAITING: Thread waiting for notification (Object.wait)
        // TIMED_WAITING: Thread waiting with timeout (Thread.sleep, LockSupport.parkNanos)
        // TERMINATED: Thread finished

        ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();

        long[] threadIds = threadBean.getAllThreadIds();
        ThreadInfo[] threadInfo = threadBean.getThreadInfo(threadIds, true, true);

        int runnable = 0, blocked = 0, waiting = 0, timedWaiting = 0;

        for (ThreadInfo info : threadInfo) {
            switch (info.getThreadState()) {
                case RUNNABLE -> runnable++;
                case BLOCKED -> {
                    blocked++;
                    log.warn("Blocked thread: {} waiting for lock from {}",
                        info.getThreadName(),
                        info.getLockOwnerName());
                }
                case WAITING -> waiting++;
                case TIMED_WAITING -> timedWaiting++;
            }
        }

        log.info("Thread states - Runnable: {}, Blocked: {}, Waiting: {}, TimedWaiting: {}",
            runnable, blocked, waiting, timedWaiting);

        if (blocked > runnable * 0.1) {
            log.error("High thread contention detected! {} threads blocked", blocked);
        }
    }

    public void findDeadlocks() {
        ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();
        long[] deadlockedThreads = threadBean.findDeadlockedThreads();

        if (deadlockedThreads != null) {
            log.error("DEADLOCK DETECTED! Threads: {}",
                Arrays.toString(deadlockedThreads));

            ThreadInfo[] deadlockInfo = threadBean.getThreadInfo(deadlockedThreads);
            for (ThreadInfo info : deadlockInfo) {
                log.error("Deadlocked thread: {}", info.getThreadName());
                log.error("  waiting on: {}.{}",
                    info.getLockOwnerName(), info.getLockName());
            }
        }
    }
}
```

---

## Memory Profiling

### Heap Analysis

```java
@Service
public class HeapAnalysisService {

    private final MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();

    public void analyzeHeap() {
        MemoryUsage heapMemory = memoryBean.getHeapMemoryUsage();
        MemoryUsage nonHeapMemory = memoryBean.getNonHeapMemoryUsage();

        double usedPercent = (double) heapMemory.getUsed() / heapMemory.getMax() * 100;

        log.info("Heap: {}MB used / {}MB max ({:.1f}%)",
            heapMemory.getUsed() / 1024 / 1024,
            heapMemory.getMax() / 1024 / 1024,
            usedPercent);

        log.info("Non-Heap: {}MB used",
            nonHeapMemory.getUsed() / 1024 / 1024);

        if (usedPercent > 80) {
            log.warn("Heap usage above 80%");
            dumpHeapForAnalysis();
        }
    }

    public void dumpHeapForAnalysis() {
        String dumpFile = "/tmp/heapdump-" + Instant.now().toString()
            .replace(":", "-") + ".hprof";

        try {
            ManagementFactory.getPlatformMBeanServer()
                .invoke(
                    new ObjectName("com.sun.management:type=HotSpotDiagnostic"),
                    "dumpHeap",
                    new Object[]{dumpFile, true},
                    new String[]{String.class.getName(), boolean.class.getName()}
                );
            log.info("Heap dump saved to: {}", dumpFile);
        } catch (Exception e) {
            log.error("Failed to dump heap", e);
        }
    }
}
```

### Memory Leak Detection

```java
@Component
public class MemoryLeakDetector {

    private final List<byte[]> leakCandidates = new ArrayList<>();
    private static final long LEAK_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100MB

    @Scheduled(fixedRate = 60_000)
    public void detectLeaks() {
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heapUsage = memoryBean.getHeapMemoryUsage();

        long used = heapUsage.getUsed();
        long max = heapUsage.getMax();

        // Check for continuous growth
        if (used > max * 0.8) {
            log.error("Heap usage critical: {}%", (used * 100.0 / max));

            // Collect top memory-consuming classes
            List<Class<?>> topClasses = findTopConsumingClasses();
            for (Class<?> cls : topClasses) {
                log.warn("Potential leak suspect: {}", cls.getName());
            }
        }
    }

    private List<Class<?>> findTopConsumingClasses() {
        // Use heap histogram (jmap -histo:live <pid>)
        // Look for classes with many instances or large retained sizes
        return List.of(); // Simplified
    }

    // Common leak patterns:

    // Pattern 1: Static collections growing unbounded
    private static final Map<String, SessionData> SESSION_CACHE = new HashMap<>();
    // Fix: Use bounded cache with eviction

    // Pattern 2: Forgotten listeners
    public class EventBus {
        private final List<Listener> listeners = new ArrayList<>();
        // Never removed!
    }

    // Pattern 3: ThreadLocal without cleanup
    ThreadLocal<UserContext> userContext = ThreadLocal.withInitial(UserContext::new);
    // Fix: Always remove after use
    // userContext.remove();
}
```

### Object Allocation Analysis

```java
@Service
public class AllocationAnalysisService {

    private final MeterRegistry registry;

    // Track allocation rate
    public void trackAllocationRate() {
        // High allocation rate indicates potential optimization targets
        // JFR event: jdk.ObjectAllocationInNewTLAB
        // Async-profiler: -e alloc

        // Common high-allocation patterns:
        allocateInLoops();
        createManyShortLivedObjects();
        useBoxedPrimitivesUnnecessarily();
    }

    // Pattern 1: Allocating in loops
    public void allocateInLoops() {
        // Bad: Creates new objects in each iteration
        for (int i = 0; i < 1000; i++) {
            String result = new StringBuilder()
                .append("prefix_")
                .append(i)
                .append("_suffix")
                .toString();
            process(result);
        }

        // Good: Reduce allocations
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.setLength(0);
            sb.append("prefix_").append(i).append("_suffix");
            process(sb.toString());
        }
    }

    // Pattern 2: Temporary objects in streams
    public long badStreamMemory(List<Product> products) {
        // Creates Map.Entry objects for each product
        return products.stream()
            .collect(Collectors.toMap(Product::getId, Product::getPrice))
            .values().stream()
            .mapToLong(BigDecimal::longValue)
            .sum();
    }

    public long goodStreamMemory(List<Product> products) {
        // No intermediate Map created
        return products.stream()
            .mapToLong(p -> p.getPrice().longValue())
            .sum();
    }
}
```

---

## GC Logging

### Configuration

```yaml
# JVM GC logging options
# -Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=10,filesize=20m
# -XX:+UseG1GC -XX:MaxGCPauseMillis=200
# -XX:+PrintGCDetails -XX:+PrintGCTimeStamps (Java 8)
```

### GC Log Analysis

```java
@Component
public class GcLogAnalyzer {

    @Scheduled(fixedRate = 60_000)
    public void analyzeGcLog() {
        // Read and parse GC log file
        // Key metrics to track:

        // 1. GC pause time (target: < 10ms for G1, < 1ms for ZGC)
        // 2. GC frequency (how often collections occur)
        // 3. Promotion rate (young -> old generation)
        // 4. Heap occupancy after GC

        // Warning signs:
        // - Increasing pause times over time
        // - Full GC events (should be rare with G1)
        // - Heap occupancy growing after each GC
        // - Frequent young GC (more than 1/second)
    }

    public void evaluateGcPerformance() {
        String gcLog = readGcLog();

        // Parse GC pause times
        List<Duration> pauses = extractPauseTimes(gcLog);
        Duration p50 = percentile(pauses, 50);
        Duration p99 = percentile(pauses, 99);

        log.info("GC pause times - p50: {}ms, p99: {}ms",
            p50.toMillis(), p99.toMillis());

        if (p99.toMillis() > 200) {
            log.warn("GC pause times exceed 200ms p99");
        }
    }

    private List<Duration> extractPauseTimes(String log) {
        // Parse GC log entries
        // [2026-05-11T10:00:00.000+0000] GC pause (G1 Evacuation Pause) 50.0ms
        // [2026-05-11T10:00:01.000+0000] GC pause (G1 Evacuation Pause) 45.0ms
        return List.of(); // Simplified
    }

    private Duration percentile(List<Duration> durations, int percentile) {
        // Calculate percentile
        return Duration.ZERO; // Simplified
    }

    private String readGcLog() {
        try {
            return Files.readString(Path.of("/var/log/gc.log"));
        } catch (IOException e) {
            return "";
        }
    }
}
```

---

## Best Practices

### 1. Establish Baselines

```java
// Before making changes, profile with:
// - 0% GC CPU time
// - 95% GC CPU time (simulate memory pressure)
// - Normal load (100 req/s)
// - Peak load (1000 req/s)

@Configuration
public class BaselineProfilingConfig {

    @EventListener(ApplicationReadyEvent.class)
    public void setupBaseline() {
        log.info("Starting baseline profiling...");
        // Take initial heap snapshot
        // Record GC metrics
        // Start JFR recording
    }
}
```

### 2. Use Profiling in CI/CD

```yaml
# GitHub Actions: Profile on performance test
- name: Profile application
  run: |
    asprof -e cpu -d 60 -f profile-${{ github.sha }}.html $(pgrep -f my-app)
    asprof -e alloc -d 60 -f alloc-${{ github.sha }}.html $(pgrep -f my-app)
```

---

## Common Mistakes

### Mistake 1: Not Profiling Under Load

```java
// WRONG: Profiling idle application
// Shows only startup and background tasks

// CORRECT: Profile with realistic load
// Use load testing tool to simulate traffic
```

### Mistake 2: Ignoring Young Generation GC

```yaml
# WRONG: Only looking at old gen GC
# Young GC happens more frequently and adds up

# CORRECT: Monitor both young and old GC
-Yong GC time: 50ms every 500ms = 10% CPU overhead
-Old GC: Rare but noticeable pauses
```

### Mistake 3: Over-Optimizing Hot Methods

```java
// WRONG: Micro-optimizing a method that's 2% of CPU
// 98% of potential gain elsewhere

// CORRECT: Focus on top bottlenecks
// Profile shows: methodA = 40%, methodB = 30%, methodC = 10%
// Optimize methodA first!
```

---

## Summary

CPU and memory profiling techniques for Java applications:

1. CPU profiling identifies hot methods and bottlenecks
2. Memory profiling tracks allocations and leaks
3. GC logs reveal pause times and heap behavior
4. Thread state analysis detects contention
5. Heap dumps help find memory leaks
6. Profile under realistic load conditions
7. Focus on the biggest bottlenecks first

---

## References

- [Java Performance Tuning Guide](https://docs.oracle.com/en/java/javase/17/gctuning/)
- [Eclipse MAT Documentation](https://www.eclipse.org/mat/documentation.php)
- [JVM Troubleshooting Guide](https://docs.oracle.com/en/java/javase/17/troubleshoot/)

Happy Coding