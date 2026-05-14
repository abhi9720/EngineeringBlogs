---
title: "Load Testing Strategies"
description: "Comprehensive guide to load, stress, soak, spike, and endurance testing: strategies, metrics, and analysis"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - load-testing
  - stress-testing
  - performance
  - testing
coverImage: "/images/load-testing-strategies.png"
draft: false
---

# Load Testing Strategies

## Overview

Performance testing encompasses multiple strategies that answer different questions about system behavior under various conditions. Load testing verifies normal operation, stress testing finds breaking points, soak testing reveals memory leaks, and spike testing validates elasticity. This guide covers each strategy with implementation examples and analysis techniques.

---

## The Four Pillars of Performance Testing

```
Load Test:  "Can the system handle expected traffic?"
Stress Test: "What is the breaking point?"
Soak Test:   "Does the system degrade over time?"
Spike Test:  "How does the system handle sudden traffic surges?"
```

---

## Strategy 1: Load Testing

### Goal

Verify the system can handle the expected production load with acceptable response times.

### Approach

```java
// Gatling: Load test at expected peak traffic
class LoadTestSimulation extends Simulation {

    val httpProtocol = http
        .baseUrl("https://api.example.com")
        .header("Accept", "application/json");

    val scn = scenario("Normal Load")
        .exec(http("GET /api/orders")
            .get("/api/orders")
            .check(status.is(200)))
        .pause(3.seconds)  // Realistic think time
        .exec(http("POST /api/orders")
            .post("/api/orders")
            .body(StringBody("""{"customerId": "cust-1", "total": 100.00}"""))
            .check(status.is(201)))
        .pause(2.seconds);

    setUp(
        scn.inject(
            // Ramp up to expected peak concurrent users
            rampConcurrentUsers(0).to(100).during(60.seconds),
            // Hold at peak for 20 minutes
            constantConcurrentUsers(100).during(20.minutes)
        )
    ).protocols(httpProtocol)
     .assertions(
         global.responseTime.percentile(95).lt(1000),  // 95% under 1s
         global.responseTime.percentile(99).lt(2000),  // 99% under 2s
         global.successfulRequests.percent.gt(99.9)    // 99.9% success
     );
}
```

### Key Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| Throughput | >= expected peak | Requests per second |
| P50 response | < 200ms | Median response time |
| P95 response | < 1s | 95th percentile |
| P99 response | < 2s | 99th percentile |
| Error rate | < 0.1% | Percentage of failed requests |
| CPU usage | < 70% | Server CPU utilization |
| Memory | < 80% | Server memory utilization |

### Results Analysis

```
Load Test Results Summary:
  Peak concurrent users: 100
  Total requests: 24,000
  Throughput: 20 req/s
  P50 response: 145ms
  P95 response: 620ms
  P99 response: 1,800ms
  Error rate: 0.05%
  Verdict: PASS - System handles expected load within SLAs
```

---

## Strategy 2: Stress Testing

### Goal

Find the system's breaking point and understand failure behavior.

### Approach

```java
class StressTestSimulation extends Simulation {

    val httpProtocol = http
        .baseUrl("https://api.example.com");

    // Gradually increase load until failure
    val stressScenario = scenario("Stress Test")
        .exec(http("API Call")
            .get("/api/orders/search?q=test")
            .check(status.in(200, 429, 503)));  // Accept rate limit & service unavailable

    setUp(
        stressScenario.inject(
            rampConcurrentUsers(0).to(50).during(2.minutes),
            rampConcurrentUsers(50).to(100).during(2.minutes),
            rampConcurrentUsers(100).to(200).during(2.minutes),
            rampConcurrentUsers(200).to(500).during(2.minutes),
            rampConcurrentUsers(500).to(1000).during(2.minutes)
        )
    ).protocols(httpProtocol);
}
```

### What to Observe

```
Stress Test Progression:
  0-50 users:   P95 = 200ms, 0% errors    (Normal)
  50-100:       P95 = 500ms, 0% errors    (Elevated)
  100-200:      P95 = 1.2s,  0% errors    (Degraded)
  200-500:      P95 = 3.5s,  2% errors    (Failing)
  500-1000:     P95 = 8s,    15% errors   (Breaking Point at ~400 users)
  
Breaking Point: 400 concurrent users
Recovery: System recovered within 30 seconds after load reduced
Graceful Degradation: 429 responses returned, not 500 errors
```

### Recovery Test

```java
// Test that system recovers after load subsides
setUp(
    stressScenario.inject(
        rampConcurrentUsers(0).to(500).during(5.minutes),  // Overload
        nothingFor(1.minute),                                // Wait
        rampConcurrentUsers(500).to(10).during(1.minute),   // Cool down
        constantConcurrentUsers(10).during(2.minutes)       // Verify recovery
    )
).protocols(httpProtocol)
 .assertions(
     // Verify recovery: P95 should return to normal after cool-down
     forAll.global.responseTime.percentile(95).lt(1000)
 );
```

---

## Strategy 3: Soak (Endurance) Testing

### Goal

Detect performance degradation over extended periods—memory leaks, connection pool exhaustion, GC issues.

### Approach

```java
class SoakTestSimulation extends Simulation {

    val httpProtocol = http
        .baseUrl("https://api.example.com");

    val scn = scenario("Sustained Load")
        .exec(http("API Call")
            .get("/api/products")
            .check(status.is(200)))
        .pause(exponentialPauses(meanDuration = 5.seconds));

    setUp(
        scn.inject(
            rampConcurrentUsers(0).to(50).during(5.minutes),
            constantConcurrentUsers(50).during(8.hours),  // Extended period
            rampConcurrentUsers(50).to(0).during(5.minutes)
        )
    ).protocols(httpProtocol);
}
```

### Key Metrics Over Time

```java
// Monitor these metrics every 5 minutes during the test
record SoakMetrics(
    Instant timestamp,
    double p95ResponseTime,
    double throughput,
    long activeThreads,
    double heapUsage,
    int gcCount,
    long gcPauseTime,
    int connectionPoolActive,
    int errorCount
);

// Analyze trend
class SoakAnalysis {

    public boolean hasDegradation(List<SoakMetrics> metrics) {
        SoakMetrics first = metrics.get(0);
        SoakMetrics last = metrics.get(metrics.size() - 1);

        double responseTimeIncrease = 
            ((last.p95ResponseTime() - first.p95ResponseTime()) 
             / first.p95ResponseTime()) * 100;

        double heapIncrease =
            ((last.heapUsage() - first.heapUsage()) / first.heapUsage()) * 100;

        System.out.printf("Response time increase: %.2f%%%n", responseTimeIncrease);
        System.out.printf("Heap usage increase: %.2f%%%n", heapIncrease);

        // More than 50% degradation over time indicates a problem
        return responseTimeIncrease > 50 || heapIncrease > 30;
    }
}
```

### Common Issues Found by Soak Testing

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Gradual response time increase | Memory leak | Fix object retention, increase heap |
| Sudden latency spikes after hours | GC thrashing | Tune GC settings, reduce allocation |
| Connection pool exhaustion | Connection leaks | Debug connection release paths |
| Thread count increasing | Thread leak | Use thread dump analysis |
| Error rate increases over time | Resource exhaustion | Add resource monitoring |

---

## Strategy 4: Spike Testing

### Goal

Verify the system handles sudden traffic surges (flash sales, news events, bot attacks).

### Approach

```java
class SpikeTestSimulation extends Simulation {

    val httpProtocol = http
        .baseUrl("https://api.example.com");

    val scn = scenario("Spike Load")
        .exec(http("GET /api/products")
            .get("/api/products")
            .check(status.is(200)));

    setUp(
        scn.inject(
            // Normal load
            constantConcurrentUsers(20).during(5.minutes),
            // Sudden spike (10x in 10 seconds)
            rampConcurrentUsers(20).to(200).during(10.seconds),
            constantConcurrentUsers(200).during(2.minutes),
            // Recovery
            rampConcurrentUsers(200).to(20).during(30.seconds),
            constantConcurrentUsers(20).during(5.minutes),
            // Second spike
            rampConcurrentUsers(20).to(500).during(5.seconds),
            constantConcurrentUsers(500).during(1.minute),
            rampConcurrentUsers(500).to(20).during(30.seconds)
        )
    ).protocols(httpProtocol);
}
```

### Spike Test Analysis

```java
class SpikeAnalysis {

    public record SpikeMetrics(
        String event,
        int beforeUsers,
        int duringUsers,
        double beforeP95,
        double duringP95,
        long recoveryTimeMs,
        int errorCount,
        int rateLimitedCount
    ) {}

    public void analyze(SpikeMetrics metrics) {
        double degradation = 
            (metrics.duringP95() - metrics.beforeP95()) / metrics.beforeP95() * 100;

        System.out.printf("Spike Event: %s%n", metrics.event());
        System.out.printf("Load increase: %dx (from %d to %d)%n",
            metrics.duringUsers() / metrics.beforeUsers(),
            metrics.beforeUsers(), metrics.duringUsers());
        System.out.printf("P95 degradation: %.1f%% (from %.0fms to %.0fms)%n",
            degradation, metrics.beforeP95(), metrics.duringP95());
        System.out.printf("Recovery time: %dms%n", metrics.recoveryTimeMs());
        System.out.printf("Rate limited: %d%n", metrics.rateLimitedCount());
    }
}
```

---

## Selecting the Right Strategy

```java
class PerformanceTestPlanner {

    public record TestPlan(
        boolean loadTest,
        boolean stressTest,
        boolean soakTest,
        boolean spikeTest,
        int durationMinutes
    ) {}

    public TestPlan plan(String applicationType, int slaSeverity) {
        return switch (applicationType) {
            case "ecommerce" -> new TestPlan(true, true, true, true, 480);
            case "payment-api" -> new TestPlan(true, true, false, true, 240);
            case "batch-processor" -> new TestPlan(true, false, true, false, 1440);
            case "serverless-function" -> new TestPlan(true, true, false, true, 60);
            default -> new TestPlan(true, false, false, false, 120);
        };
    }
}
```

| Application Type | Load | Stress | Soak | Spike |
|-----------------|------|--------|------|-------|
| E-commerce | Yes | Yes | Yes | Yes (sales) |
| Payment API | Yes | Yes | No | Yes (payday) |
| Social media | Yes | Yes | Yes | Yes (viral) |
| Batch processing | Yes | No | Yes | No |
| IoT ingestion | Yes | Yes | Yes | Yes (device flood) |

---

## Common Mistakes

### Mistake 1: Testing with Too Few Users

```java
// WRONG: 5 users won't reveal performance issues
setUp(scn.inject(constantConcurrentUsers(5).during(10.minutes)));

// CORRECT: Test at expected production load
setUp(scn.inject(
    rampConcurrentUsers(0).to(expectedPeak).during(rampUp),
    constantConcurrentUsers(expectedPeak).during(duration)
));
```

### Mistake 2: Not Monitoring Server-Side Metrics

```java
// WRONG: Only measuring client-side response times
// You might miss server resource bottlenecks

// CORRECT: Monitor both client and server metrics
// Client: response times, error rates, throughput
// Server: CPU, memory, GC, DB connections, thread pools
// Network: bandwidth, latency, packet loss
```

### Mistake 3: Short Durations for Soak Tests

```java
// WRONG: 5 minutes tells you nothing about memory leaks
constantConcurrentUsers(50).during(5.minutes);

// CORRECT: Run for hours to detect degradation
constantConcurrentUsers(50).during(8.hours);
// Memory leaks typically manifest after hours of operation
```

---

## Summary

Different load testing strategies reveal different types of issues. Load tests verify normal capacity. Stress tests find breaking points. Soak tests detect memory leaks and degradation. Spike tests validate auto-scaling and rate limiting. Always combine multiple strategies, monitor server-side metrics, and test at realistic production scales.

---

## References

- [JMeter Performance Testing](https://jmeter.apache.org/usermanual/build-web-test-plan.html)
- [Gatling Performance Testing](https://gatling.io/docs/gatling/reference/current/core/injection/)
- [Google SRE - Load Testing](https://sre.google/workbook/load-testing/)
- [Microsoft Performance Testing Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/category/performance-scalability)

Happy Coding