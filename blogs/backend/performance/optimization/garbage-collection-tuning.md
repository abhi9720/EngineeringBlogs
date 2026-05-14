---
title: "Garbage Collection Tuning"
description: "Tune JVM garbage collection: G1, ZGC, Shenandoah collectors, GC logs analysis, and latency optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - optimization
  - gc
  - g1
  - zgc
  - jvm
coverImage: "/images/garbage-collection-tuning.png"
draft: false
---

# Garbage Collection Tuning

## Overview

Garbage collection tuning is critical for Java application performance. The right GC algorithm and configuration can reduce pause times from seconds to milliseconds, directly impacting p99 latency.

### GC Evolution

| Collector | Java Version | Pause Target | Use Case |
|-----------|-------------|--------------|----------|
| Serial GC | 1.0+ | High | Single-threaded, small heaps |
| Parallel GC | 1.4+ | Medium | Throughput-oriented |
| CMS | 1.4-14 | Low (concurrent) | Low-latency (deprecated) |
| G1 GC | 7+ | Configurable (default 200ms) | Balanced throughput/latency |
| ZGC | 11+ | < 1ms | Ultra-low latency |
| Shenandoah | 12+ | < 10ms | Low-latency alternative |

---

## G1 GC Configuration

### Basic Configuration

```yaml
# G1 GC is the default since Java 9
# -XX:+UseG1GC

# Common G1 tuning options
JAVA_OPTS="-Xms16g -Xmx16g \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:G1HeapRegionSize=16m \
  -XX:G1NewSizePercent=5 \
  -XX:G1MaxNewSizePercent=60 \
  -XX:G1HeapWastePercent=5 \
  -XX:G1MixedGCCountTarget=8 \
  -XX:G1MixedGCLiveThresholdPercent=85 \
  -XX:+UnlockExperimentalVMOptions \
  -XX:G1PeriodicGCInterval=0 \
  -XX:+ParallelRefProcEnabled \
  -XX:-ResizePLAB"
```

### G1 Tuning Guide

```java
@Service
public class G1TuningGuide {

    public void configureForDifferentWorkloads() {
        // Web application (heaps < 16GB):
        // -XX:+UseG1GC
        // -XX:MaxGCPauseMillis=100
        // -XX:G1HeapRegionSize=8m
        // -XX:G1ReservePercent=15

        // Batch processing (large heaps):
        // -XX:+UseG1GC
        // -XX:MaxGCPauseMillis=300
        // -XX:G1HeapRegionSize=32m
        // -XX:G1NewSizePercent=10
        // -XX:G1MaxNewSizePercent=80

        // Low-latency web app:
        // -XX:+UseG1GC
        // -XX:MaxGCPauseMillis=50
        // -XX:G1HeapWastePercent=2
        // -XX:G1MixedGCCountTarget=4
        // -XX:G1NewSizePercent=5
        // -XX:G1MaxNewSizePercent=40

        // Key tuning parameters:
        // MaxGCPauseMillis: Target pause time (default: 200ms)
        // G1HeapRegionSize: Region size (1-32MB, auto-calculated)
        // G1NewSizePercent: Initial young gen size (default: 5%)
        // G1MaxNewSizePercent: Max young gen size (default: 60%)
    }
}
```

G1's pause-time control works by adjusting the young generation size: a lower `MaxGCPauseMillis` target forces G1 to shrink the young generation, reducing the amount of live data to copy during evacuation pauses. `G1HeapRegionSize` determines the granularity of the heap partition — smaller regions (8 MB) give finer-grained collection but more remembered-set overhead. For batch processing with larger heaps, a higher `G1MixedGCCountTarget` spreads concurrent marking over more cycles, reducing per-cycle CPU impact. The reserve percent (`G1ReservePercent`) sets aside free regions for "to-space" during evacuation, preventing a full GC when promotion fails.

### G1 Log Analysis

```java
@Component
public class G1LogAnalyzer {

    @Scheduled(fixedRate = 60_000)
    public void analyzeG1Logs() {
        // Parse G1 GC log entries:

        // Young GC:
        // [GC pause (G1 Evacuation Pause) (young)
        //  Desired survivor size 1048576 bytes, new threshold 15 (max 15)
        //  - age 1: 543208 bytes, 543208 total
        //  60.108: [G1Ergonomics (CSet Construction) ...]
        //  60.109: [G1Ergonomics (Mixed GCs) ...]
        //  [Eden: 2048.0M(2048.0M)->0.0B(1536.0M)
        //   Survivors: 128.0M->256.0M
        //   Heap: 4096.0M(16.0G)->2176.0M(16.0G)]
        //  [Times: user=0.18 sys=0.00, real=0.05 secs]

        // Key metrics:
        // 1. Pause duration (real=0.05s = 50ms) - target < MaxGCPauseMillis
        // 2. Eden region size changes - ergonomic adjustments
        // 3. Survivor usage - promotion rates
        // 4. Heap usage after GC - occupancy trends

        // Warning signs:
        // - Increasing pause times over time
        // - Full GC (to-space exhausted)
        // - Humongous allocations (regions > 50% of region size)
        // - High concurrent cycle overhead
    }

    public void detectHumongousAllocations() {
        // Humongous: Objects > 50% of G1HeapRegionSize
        // With 16MB regions: objects > 8MB
        // These are allocated directly in old gen
        // Can cause premature GC and fragmentation

        // Fix: Reduce object size or increase region size
        // -XX:G1HeapRegionSize=32m (for objects up to 16MB)
    }
}
```

---

## ZGC Configuration

### Basic Configuration

```yaml
# ZGC: Ultra-low latency (< 1ms pause time)
# Available since Java 11 (experimental), Java 15+ (production)

JAVA_OPTS="-Xms16g -Xmx16g \
  -XX:+UseZGC \
  -XX:ZAllocationSpikeTolerance=2.0 \
  -XX:SoftMaxHeapSize=14g \
  -XX:ConcGCThreads=4 \
  -XX:ParallelGCThreads=8"

# Key features:
# - Pause times < 1ms (regardless of heap size)
# - Supports very large heaps (up to 16TB)
# - Handles up to 1000+ GB/s allocation rate
```

### ZGC Tuning

```java
@Service
public class ZgcTuningService {

    public void configureZgc() {
        // -XX:+UseZGC: Enable ZGC

        // Heap sizing:
        // -Xms16g -Xmx16g: Fixed heap (no resizing)
        // -XX:SoftMaxHeapSize=14g: GC will try to stay under this

        // Allocation spike tolerance:
        // -XX:ZAllocationSpikeTolerance=2.0 (default)
        // Higher value = more memory reserved for spikes

        // Thread counts:
        // -XX:ConcGCThreads=4: Concurrent GC threads
        // -XX:ParallelGCThreads=8: Parallel GC threads

        // Java 17+ improvements:
        // - Generational ZGC (-XX:+ZGenerational)
        //   Better allocation efficiency
        //   Lower CPU overhead
    }

    public void monitorZgc() {
        // ZGC metrics via JMX:
        // jdk.ZGC.CollectionCount
        // jdk.ZGC.CollectionElapsedTime
        // jdk.ZGC.PauseTime
        // jdk.ZGC.MemoryUsage

        // Key metrics to watch:
        // - Pause time: should be < 1ms
        // - Concurrent cycle time: 1-10% CPU
        // - Allocation rate: GB/s sustained
        // - Heap fragmentation: should be low
    }
}
```

ZGC achieves sub-millisecond pause times by making nearly all GC work concurrent to the application — only the initial mark and final remap phases require a short stop-the-world pause. `SoftMaxHeapSize` is a unique ZGC capability: it tells the GC to prefer staying under that threshold but allows temporary overshoot during allocation spikes, avoiding premature GC cycles. `ZAllocationSpikeTolerance` controls how much headroom ZGC reserves; the default 2.0 means it assumes allocation rate can double at any moment. Generational ZGC (Java 17+) adds a young/old separation that reduces CPU overhead by ~30 % because most objects die young and are collected without scanning the old generation.

---

## Shenandoah GC

### Configuration

```yaml
# Shenandoah: Low-pause alternative to ZGC
# Available since Java 12 (experimental), Java 15+ (production)

JAVA_OPTS="-Xms16g -Xmx16g \
  -XX:+UseShenandoahGC \
  -XX:ShenandoahGCPauseMillis=50 \
  -XX:ShenandoahUncommitDelay=300000 \
  -XX:+ShenandoahGCHeuristics=adaptive"

# Compared to ZGC:
# - Similar pause times (< 10ms)
# - Slightly higher CPU overhead
# - Better throughput in some cases
# - More tuning options
```

---

## GC Comparison

### Pause Time Comparison

```java
@Component
public class GcComparisonService {

    public void compareCollectors() {
        // Heap: 16GB, Load: 10GB live data, 500MB/s allocation

        // Parallel GC:
        //   Pause time: 500ms - 5s
        //   CPU overhead: 5%
        //   Throughput: 99%

        // G1 GC:
        //   Pause time: 50ms - 200ms
        //   CPU overhead: 10%
        //   Throughput: 95%

        // ZGC:
        //   Pause time: < 1ms
        //   CPU overhead: 15%
        //   Throughput: 90%

        // Shenandoah:
        //   Pause time: < 10ms
        //   CPU overhead: 15%
        //   Throughput: 92%
    }

    public void selectCollector() {
        // Select based on requirements:

        // High throughput, no latency SLA
        // -> Parallel GC (-XX:+UseParallelGC)

        // Balanced throughput/latency
        // -> G1 GC (-XX:+UseG1GC) [DEFAULT]

        // Low latency (< 10ms)
        // -> ZGC (-XX:+UseZGC) or Shenandoah (-XX:+UseShenandoahGC)

        // Very large heaps (> 100GB)
        // -> ZGC (supports up to 16TB)
    }
}
```

The trade-off between collectors centers on the pause-time vs. throughput curve. Parallel GC maximizes throughput by stopping the world to collect in parallel — great for batch jobs where nobody waits for a response. G1 trades ~4 % throughput for bounded pause targets, making it the default for server applications. ZGC and Shenandoah sacrifice another ~5-10 % throughput for sub-10 ms pauses — necessary when p99 latency is a contractual SLA. The selection guide can be simplified: default to G1, switch to ZGC if your GC pause budget is under 10 ms, stay with Parallel only for pure batch processing.

---

## GC Logging Configuration

### Java 17+ Unified Logging

```yaml
# GC logging options
JAVA_OPTS="-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=10,filesize=20m \
  -Xlog:gc+region=trace \
  -Xlog:gc+heap=debug \
  -Xlog:gc+ref=debug \
  -Xlog:gc+phases=debug"
```

### Programmatic GC Monitoring

```java
@Component
public class GcMonitor {

    private final MeterRegistry registry;

    @Scheduled(fixedRate = 10_000)
    public void collectGcMetrics() {
        List<GarbageCollectorMXBean> gcBeans =
            ManagementFactory.getGarbageCollectorMXBeans();

        for (GarbageCollectorMXBean gc : gcBeans) {
            String name = gc.getName();
            long count = gc.getCollectionCount();
            long time = gc.getCollectionTime();

            Gauge.builder("jvm.gc.count", count)
                .tag("gc", name)
                .register(registry);

            Gauge.builder("jvm.gc.time.ms", time)
                .tag("gc", name)
                .register(registry);

            // Calculate pause time per collection
            if (count > 0) {
                double avgPause = (double) time / count;
                log.info("GC {}: count={}, total={}ms, avg={}ms",
                    name, count, time, avgPause);

                if (avgPause > 200) {
                    log.warn("GC {} average pause time {}ms exceeds target",
                        name, avgPause);
                }
            }
        }
    }

    public long getCurrentGcTime() {
        return ManagementFactory.getGarbageCollectorMXBeans().stream()
            .mapToLong(GarbageCollectorMXBean::getCollectionTime)
            .sum();
    }
}
```

---

## Memory Sizing Strategies

### Heap Sizing Formulas

```java
public class HeapSizingGuide {

    // General rule:
    // Heap = Live data × (1 + allocation_rate × gc_overhead)

    // Example calculation:
    // Live data: 4GB
    // Allocation rate: 500MB/s
    // GC overhead target: 5% (1s GC per 20s)
    // G1 young collection: 50ms pause

    // Heap needed: 4GB + (500MB/s × 1s) = 4.5GB
    // With safety margin: 8GB

    // Java heap sizing rules:
    // -Xms = -Xmx (fixed heap, no resize overhead)
    // Heap = 3-4× live-set size
    // Metaspace: 256MB-512MB (not part of heap)

    public static final String COMMON_SIZING =
        "-Xms8g -Xmx8g -XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m";
}
```

---

## Best Practices

### 1. Start with G1 GC

```yaml
# G1 GC is the default and works well for most applications
# Only switch if you have specific latency requirements

JAVA_OPTS="-Xms8g -Xmx8g -XX:+UseG1GC -XX:MaxGCPauseMillis=100"
```

### 2. Enable GC Logging

```yaml
# Always enable GC logging in production
JAVA_OPTS="-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=10,filesize=20m"
```

### 3. Monitor GC Metrics

```yaml
# Prometheus GC metrics
jvm_gc_pause_seconds_count
jvm_gc_pause_seconds_sum
jvm_gc_pause_seconds_max
jvm_gc_memory_allocated_bytes_total
jvm_gc_memory_promoted_bytes_total
```

---

## Common Mistakes

### Mistake 1: Setting -Xms Less Than -Xmx

```yaml
# WRONG: JVM can resize heap at runtime (expensive)
-Xms512m -Xmx8g
# Performance hit when heap grows

# CORRECT: Fixed heap
-Xms8g -Xmx8g
```

### Mistake 2: Using CMS in Modern Java

```yaml
# WRONG: CMS is deprecated since Java 9, removed in Java 14
-XX:+UseConcMarkSweepGC

# CORRECT: Use G1 or ZGC
-XX:+UseG1GC  # Java 9+
-XX:+UseZGC   # Java 11+ (experimental), 15+ (production)
```

### Mistake 3: Oversized Heap Without Appropriate GC

```yaml
# WRONG: 100GB heap with Parallel GC
# Full GC would take minutes!

# CORRECT: Use ZGC for large heaps
-XX:+UseZGC
```

---

## Summary

1. **G1 GC** is the default and works for most applications
2. **ZGC** provides < 1ms pauses for latency-sensitive apps
3. **Shenandoah** is an alternative low-pause collector
4. **Parallel GC** is best for throughput-oriented batch jobs
5. Set -Xms = -Xmx to avoid resize overhead
6. Always enable GC logging in production
7. Monitor GC pause times, frequency, and CPU overhead
8. Choose GC based on latency requirements and heap size

---

## References

- [JVM GC Tuning Guide](https://docs.oracle.com/en/java/javase/17/gctuning/)
- [G1 GC Documentation](https://docs.oracle.com/en/java/javase/17/gctuning/garbage-first-garbage-collector.html)
- [ZGC Documentation](https://docs.oracle.com/en/java/javase/17/gctuning/zgc.html)
- [Shenandoah GC](https://wiki.openjdk.org/display/shenandoah)

Happy Coding