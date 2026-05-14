---
title: "Thread Dump Analysis"
description: "Analyze Java thread dumps: deadlock detection, thread states, CPU spikes, and performance issue diagnosis"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - profiling
  - thread-dump
  - java
coverImage: "/images/thread-dump-analysis.png"
draft: false
---

# Thread Dump Analysis

## Overview

A thread dump is a snapshot of all threads in a JVM at a given moment. Analyzing thread dumps reveals deadlocks, thread contention, stuck threads, and performance bottlenecks.

### When to Take Thread Dumps

- Application becomes unresponsive
- CPU usage spikes
- Requests timeout
- Memory grows continuously
- Before and after deployments

---

## Taking Thread Dumps

### Methods

```bash
# Method 1: jstack (JDK tool)
jstack <PID> > threaddump.txt
jstack -l <PID> > threaddump-with-locks.txt  # Includes lock information

# Method 2: jcmd
jcmd <PID> Thread.print > threaddump.txt

# Method 3: Kill signal (Linux)
kill -3 <PID>  # Prints to stdout

# Method 4: Programmatic
```

### Programmatic Thread Dump

```java
@Component
public class ThreadDumpService {

    public String generateThreadDump() {
        StringBuilder dump = new StringBuilder();
        dump.append("Full thread dump at ").append(Instant.now()).append("\n\n");

        ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();
        long[] threadIds = threadBean.getAllThreadIds();

        ThreadInfo[] threadInfos = threadBean.getThreadInfo(threadIds, true, true);

        for (ThreadInfo info : threadInfos) {
            if (info == null) continue;

            dump.append("\"").append(info.getThreadName()).append("\"");
            dump.append(" #").append(info.getThreadId());
            dump.append(" ").append(info.getThreadState());

            if (info.getLockName() != null) {
                dump.append(" waiting on ").append(info.getLockName());
            }
            if (info.getLockOwnerName() != null) {
                dump.append(" blocked by ").append(info.getLockOwnerName());
            }

            dump.append("\n    java.lang.Thread.State: ").append(info.getThreadState());
            dump.append("\n");

            StackTraceElement[] stack = info.getStackTrace();
            for (StackTraceElement element : stack) {
                dump.append("\tat ").append(element).append("\n");
            }

            // Lock information
            MonitorInfo[] monitors = info.getLockedMonitors();
            if (monitors.length > 0) {
                dump.append("    Locked monitors:\n");
                for (MonitorInfo monitor : monitors) {
                    dump.append("        - ").append(monitor).append("\n");
                }
            }

            dump.append("\n");
        }

        return dump.toString();
    }

    @GetMapping("/internal/threaddump")
    public ResponseEntity<String> getThreadDump() {
        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_PLAIN)
            .body(generateThreadDump());
    }
}
```

### Taking Multiple Dumps

```java
@Service
public class ThreadDumpAnalyzer {

    public void takeMultipleDumps(int count, long intervalMs) {
        List<String> dumps = new ArrayList<>();

        for (int i = 0; i < count; i++) {
            dumps.add(generateThreadDump());
            try {
                Thread.sleep(intervalMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }

        analyzeMultipleDumps(dumps);
    }

    private void analyzeMultipleDumps(List<String> dumps) {
        // Same thread stuck in the same method across dumps
        // => Thread is stuck, likely infinite loop or deadlock

        // Thread appearing in few dumps
        // => Normal execution

        // Thread pool threads showing same stack in all dumps
        // => Thread pool starvation
    }
}
```

A single thread dump is a single data point — it may capture a transient state like a thread that happens to be mid-GC or mid-IO. Multiple dumps spaced 5 seconds apart reveal whether a thread's state is persistent. If the same thread appears `RUNNABLE` at the same method across all 5 dumps, it is likely in an infinite loop or a very long computation. If a thread pool's worker threads all show the same stack trace (e.g., all waiting on `RemoteService.call`), the pool is starved — every thread is blocked downstream and no work is progressing.

---

## Thread States

### State Interpretation

```java
public enum ThreadState {
    RUNNABLE,
    BLOCKED,
    WAITING,
    TIMED_WAITING,
    TERMINATED
}

// RUNNABLE: Thread is executing
// - Normal: Actively doing work
// - High CPU: Check if it's doing useful work or spinning

// BLOCKED: Thread waiting for a monitor lock
// - High contention: Too many threads competing for same lock
// - Deadlock potential: Check lock owner chain

// WAITING: Thread waiting indefinitely
// - Object.wait(): Waiting for notification
// - LockSupport.park(): Waiting for permit
// - Usually waiting for I/O or other thread

// TIMED_WAITING: Thread waiting with timeout
// - Thread.sleep(): Sleeping
// - Object.wait(timeout): Timed wait
// - LockSupport.parkNanos/parkUntil: Timed park
```

---

## Deadlock Detection

### Analyzing Deadlocks

```java
@Component
public class DeadlockDetector {

    private final ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();

    @Scheduled(fixedRate = 10_000)
    public void detectDeadlocks() {
        long[] deadlockedThreads = threadBean.findDeadlockedThreads();

        if (deadlockedThreads != null && deadlockedThreads.length > 0) {
            log.error("DEADLOCK DETECTED involving {} threads!", deadlockedThreads.length);

            ThreadInfo[] threadInfo = threadBean.getThreadInfo(deadlockedThreads, true, true);

            for (ThreadInfo info : threadInfo) {
                log.error("Deadlocked thread: \"{}\" #{} (State: {})",
                    info.getThreadName(),
                    info.getThreadId(),
                    info.getThreadState());

                if (info.getLockName() != null) {
                    log.error("  Waiting to lock: {}", info.getLockName());
                }
                if (info.getLockOwnerName() != null) {
                    log.error("  Which is held by: \"{}\" #{}",
                        info.getLockOwnerName(),
                        info.getLockOwnerId());
                }

                // Print stack trace
                for (StackTraceElement ste : info.getStackTrace()) {
                    log.error("  at {}", ste);
                }
            }

            // Attempt recovery
            attemptDeadlockRecovery(deadlockedThreads);
        }
    }

    private void attemptDeadlockRecovery(long[] threadIds) {
        log.warn("Attempting deadlock recovery by interrupting threads...");
        for (long threadId : threadIds) {
            ThreadInfo info = threadBean.getThreadInfo(threadId);
            log.warn("Interrupting thread: {} ({})", info.getThreadName(), threadId);
            // Thread.interrupt() is called
        }
    }
}
```

### Deadlock Example

```java
@Service
public class DeadlockExample {

    private final Object lockA = new Object();
    private final Object lockB = new Object();

    public void methodA() {
        synchronized (lockA) {
            log.info("Thread {} acquired lockA", Thread.currentThread().getName());
            sleep(100); // Allow other thread to acquire lockB

            synchronized (lockB) {
                log.info("Thread {} acquired lockB", Thread.currentThread().getName());
            }
        }
    }

    public void methodB() {
        synchronized (lockB) {
            log.info("Thread {} acquired lockB", Thread.currentThread().getName());
            sleep(100);

            synchronized (lockA) { // DEADLOCK!
                log.info("Thread {} acquired lockA", Thread.currentThread().getName());
            }
        }
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { }
    }
}

// Thread dump output (deadlock):
// Found one Java-level deadlock:
// =============================
// "pool-1-thread-1":
//   waiting to lock <0x000000076b5b4f50> (a java.lang.Object)
//   which is held by "pool-1-thread-2"
// "pool-1-thread-2":
//   waiting to lock <0x000000076b5b4f40> (a java.lang.Object)
//   which is held by "pool-1-thread-1"
```

The classic dining-philosophers deadlock: thread-1 holds lockA and waits for lockB, while thread-2 holds lockB and waits for lockA. JVM thread dumps explicitly detect this cycle and print a "Found one Java-level deadlock" section. The remedy is always consistent lock ordering: if every thread locks resources in the same global order (e.g., always lockA then lockB), a cycle is impossible. In more complex systems, use `java.util.concurrent.locks.ReentrantLock` with `tryLock(timeout)` so threads can back off instead of waiting forever.

---

## Thread Contention Analysis

### Detecting Contention

```java
@Service
public class ContentionAnalyzer {

    public void analyzeContention(List<ThreadDump> dumps) {
        Map<String, Integer> lockContention = new HashMap<>();

        for (ThreadDump dump : dumps) {
            for (ThreadInfo info : dump.threads()) {
                if (info.getThreadState() == Thread.State.BLOCKED) {
                    String lock = info.getLockName();
                    lockContention.merge(lock, 1, Integer::sum);
                }
            }
        }

        // Threads blocked on same lock across multiple dumps
        lockContention.entrySet().stream()
            .filter(e -> e.getValue() > dumps.size() * 0.5)
            .forEach(e -> {
                log.warn("High contention on lock: {} ({}% of dumps)",
                    e.getKey(),
                    e.getValue() * 100 / dumps.size());
            });
    }
}

// Contention patterns:

// Pattern 1: Synchronized method on shared object
// "http-nio-8080-exec-1" #10 BLOCKED
//   waiting to lock <0x000000076b5b4f50> (a com.example.Counter)
//   at com.example.Counter.increment(Counter.java:10)

// Pattern 2: Database connection pool contention
// "http-nio-8080-exec-5" #14 BLOCKED
//   waiting to lock <0x000000076b5b4f60> (a com.zaxxer.hikari.pool.HikariPool)
//   at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:160)
//   => Connection pool exhausted!
```

---

## Thread Pool Analysis

### Monitoring Thread Pools

```java
@Component
public class ThreadPoolAnalyzer {

    private final List<ThreadPoolExecutor> executors = new ArrayList<>();

    public void registerExecutor(ThreadPoolExecutor executor) {
        executors.add(executor);
    }

    @Scheduled(fixedRate = 30_000)
    public void analyzeThreadPools() {
        for (ThreadPoolExecutor executor : executors) {
            int active = executor.getActiveCount();
            int poolSize = executor.getPoolSize();
            int queueSize = executor.getQueue().size();
            int corePoolSize = executor.getCorePoolSize();
            int maxPoolSize = executor.getMaximumPoolSize();

            log.info("ThreadPool: active={}, pool={}/{}, queue={}, completed={}",
                active, poolSize, maxPoolSize, queueSize,
                executor.getCompletedTaskCount());

            // Pool exhaustion detection
            if (active >= maxPoolSize && queueSize > 0) {
                log.warn("Thread pool exhausted! {} tasks queued", queueSize);
                // Consider: Increasing pool size, optimizing tasks
            }

            // Underutilization detection
            if (poolSize > active * 3 && queueSize == 0) {
                log.info("Thread pool may be oversized: {} threads for {} active tasks",
                    poolSize, active);
            }
        }
    }
}
```

### Thread Dump Analysis Patterns

```java
// Pattern 1: Thread Pool Starvation
// All pool threads show same stack trace
// "pool-1-thread-1" RUNNABLE at RemoteService.call()
// "pool-1-thread-2" RUNNABLE at RemoteService.call()
// "pool-1-thread-3" RUNNABLE at RemoteService.call()
// => All threads waiting on slow external service

// Solution: Timeout, circuit breaker, async processing


// Pattern 2: Lock Contention
// Many threads BLOCKED on same lock
// "http-nio-8080-exec-1" BLOCKED waiting to lock Counter
// "http-nio-8080-exec-2" BLOCKED waiting to lock Counter
// "http-nio-8080-exec-3" RUNNABLE (owns the lock)
// => Single-threaded bottleneck

// Solution: Reduce lock scope, use concurrent structures


// Pattern 3: Infinite Loop
// Thread RUNNABLE across all dumps in same method
// "worker-1" RUNNABLE at MyService.process(MyService.java:42)
// Same stack in all 5 dumps taken 5 seconds apart
// => Infinite loop or very long computation

// Solution: Review loop logic, add timeout
```

---

## Best Practices

### 1. Take Multiple Dumps

```bash
# Take 5-10 dumps at 5 second intervals
for i in {1..5}; do
    jcmd <PID> Thread.print > dump-$i.txt
    sleep 5
done
```

### 2. Automate Thread Dump Collection

```java
@RestController
public class ThreadDumpController {

    @PostMapping("/internal/threaddump/trigger")
    public ResponseEntity<String> triggerDumps(
            @RequestParam(defaultValue = "5") int count,
            @RequestParam(defaultValue = "5000") int interval) {

        ThreadDumpService service = new ThreadDumpService();
        for (int i = 0; i < count; i++) {
            String dump = service.generateThreadDump();
            saveDump(dump, i);
            sleep(interval);
        }
        return ResponseEntity.ok("Collected " + count + " dumps");
    }
}
```

### 3. Set Up Alerting

```java
// Alert on thread pool exhaustion
// Alert on deadlock detection
// Alert on high blocked thread count
```

---

## Common Mistakes

### Mistake 1: Single Thread Dump

```java
// WRONG: Single dump may show transient state
String dump = generateThreadDump();
analyze(dump);
// May miss patterns that require multiple samples

// CORRECT: Multiple dumps for pattern detection
List<String> dumps = takeMultipleDumps(5, 5000);
analyzeByPattern(dumps);
```

### Mistake 2: Ignoring Stack Trace Depth

```java
// WRONG: Only looking at first few frames
// Deep stack traces with many frames indicate deep call chains

// CORRECT: Review full stack traces
// Deep stacks may indicate:
// - Excessive abstraction
// - Deep inheritance hierarchies
// - Proxy/reflection overhead
```

### Mistake 3: Not Comparing to Baseline

```java
// WRONG: Only looking at current thread dump
// "There are 10 blocked threads" - but is this normal?

// CORRECT: Compare with baseline
// "There are 10 blocked threads, baseline was 2"
// => Something changed!
```

---

## Summary

Thread dump analysis reveals critical runtime issues:

1. Deadlocks are identified by circular lock dependencies
2. BLOCKED threads indicate lock contention
3. RUNNABLE threads across dumps suggest infinite loops
4. Thread pool exhaustion shows in queued tasks
5. Take multiple dumps for pattern analysis
6. Automate collection for production environments
7. Compare against baselines to detect regressions

---

## References

- [Java Thread Dump Analysis](https://docs.oracle.com/en/java/javase/17/troubleshoot/thread-dump-analysis.html)
- [Thread Dump Analyzer Tools](https://fastthread.io/)
- [JVM Threads](https://docs.oracle.com/en/java/javase/17/troubleshoot/diagnostic-tools.html)

Happy Coding