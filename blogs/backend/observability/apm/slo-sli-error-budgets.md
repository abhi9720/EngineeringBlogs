---
title: "SLO, SLI, and Error Budgets"
description: "Define and manage service level objectives, indicators, and error budgets for reliable systems"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - apm
  - slo
  - sli
  - error-budgets
coverImage: "/images/slo-sli-error-budgets.png"
draft: false
---

# SLO, SLI, and Error Budgets

## Overview

Service Level Objectives (SLOs), Service Level Indicators (SLIs), and Error Budgets form the foundation of data-driven reliability management. Instead of aiming for perfect reliability (which is infinitely expensive), SLOs define acceptable risk levels and error budgets quantify how much unreliability is tolerated.

### Key Concepts

- **SLI**: A specific, measurable metric (e.g., request latency < 200ms)
- **SLO**: The target value for an SLI (e.g., 99.9% of requests < 200ms)
- **Error Budget**: The allowed amount of SLO violation (1 - SLO)

---

## Defining SLIs

### Common SLI Types

```java
@Component
public class SliCalculator {

    private final MeterRegistry registry;

    public SliCalculator(MeterRegistry registry) {
        this.registry = registry;
    }

    // Availability SLI: successful requests / total requests
    public double calculateAvailabilitySlI() {
        Counter totalRequests = registry.counter("requests.total");
        Counter successfulRequests = registry.counter("requests.successful");

        long total = (long) totalRequests.count();
        long success = (long) successfulRequests.count();

        if (total == 0) return 1.0;
        return (double) success / total;
    }

    // Latency SLI: proportion of requests under threshold
    public double calculateLatencySlI(long thresholdMs) {
        // Uses histogram bucket counting
        DoubleFunction<Double> fastRequests = bucket -> {
            // Count requests in fast bucket
            return registry.get("http.server.requests")
                .tag("le", String.valueOf(thresholdMs))
                .counter().count();
        };

        double total = registry.get("http.server.requests")
            .counter().count();

        if (total == 0) return 1.0;
        return fastRequests.apply((double) thresholdMs) / total;
    }

    // Throughput SLI: requests per second
    public double calculateThroughputSlI() {
        return registry.get("http.server.requests")
            .meter(meter -> {
                if (meter instanceof Counter counter) {
                    return counter.count() / 300.0; // 5 minute window
                }
                return 0.0;
            });
    }
}
```

### Business SLIs

```java
@Service
public class BusinessSliService {

    private final MeterRegistry registry;

    // Order completion rate
    public double orderCompletionSlI() {
        double started = registry.counter("orders.started").count();
        double completed = registry.counter("orders.completed").count();
        return started > 0 ? completed / started : 1.0;
    }

    // Payment success rate
    public double paymentSuccessSlI() {
        double attempted = registry.counter("payments.attempted").count();
        double succeeded = registry.counter("payments.succeeded").count();
        return attempted > 0 ? succeeded / attempted : 1.0;
    }

    // Search result quality
    public double searchQualitySlI() {
        double searches = registry.counter("search.total").count();
        double clicked = registry.counter("search.clicked").count();
        return searches > 0 ? clicked / searches : 0.0;
    }
}
```

---

## Setting SLO Targets

### SLO Configuration

```yaml
# slo-config.yml
services:
  - name: order-service
    slos:
      - name: availability
        sli: http_server_requests_error_rate < 0.001
        target: 99.9
        window: 30d
        description: "Service availability"

      - name: latency-p99
        sli: http_server_requests_p99 < 500ms
        target: 99.0
        window: 7d
        description: "P99 latency under 500ms"

      - name: latency-p95
        sli: http_server_requests_p95 < 200ms
        target: 99.5
        window: 30d
        description: "P95 latency under 200ms"

      - name: throughput
        sli: http_server_requests_rate > 100
        target: 99.0
        window: 1d
        description: "Minimum throughput"
```

### SLO Calculation

```java
@Service
public class SloCalculator {

    public SloStatus evaluateSlo(String sliQuery, double target, Duration window) {
        // SLI value
        double sliValue = calculateSli(sliQuery, window);

        // Error budget
        double errorBudget = 1.0 - (target / 100.0);
        double errorRate = 1.0 - sliValue;
        double remainingBudget = errorBudget - errorRate;
        double burnRate = errorRate / errorBudget;

        return new SloStatus(
            sliValue,
            target,
            remainingBudget > 0,
            remainingBudget / errorBudget,
            burnRate
        );
    }

    private double calculateSli(String query, Duration window) {
        // PromQL query execution
        // Example: rate(http_server_requests_seconds_count{status=~"5.."}[30d])
        //        / rate(http_server_requests_seconds_count[30d])
        return prometheusClient.querySli(query, window);
    }
}

public record SloStatus(
    double sliValue,
    double target,
    boolean withinBudget,
    double budgetRemaining,
    double burnRate
) {}
```

---

## Error Budgets

### Error Budget Tracking

```java
@Service
public class ErrorBudgetService {

    private final Map<String, ErrorBudgetState> budgets = new ConcurrentHashMap<>();

    public ErrorBudgetState getErrorBudget(String serviceName, String sloName) {
        return budgets.computeIfAbsent(
            serviceName + ":" + sloName,
            k -> new ErrorBudgetState(1.0, Instant.now())
        );
    }

    public void consumeErrorBudget(String serviceName, String sloName, double errorRate) {
        ErrorBudgetState budget = getErrorBudget(serviceName, sloName);
        double consumed = errorRate * Duration.between(
            budget.lastUpdated(), Instant.now()).toSeconds();

        budget.remaining().addAndGet(-consumed);
        budget.lastUpdated().set(Instant.now());

        // Alert if budget is depleted
        if (budget.remaining().get() <= 0) {
            alertBudgetDepleted(serviceName, sloName);
        }
    }

    private void alertBudgetDepleted(String service, String slo) {
        log.warn("Error budget exhausted for {}/{}", service, slo);
        notificationService.sendAlert(
            "Error Budget Exhausted",
            "SLO: " + service + "/" + slo
                + "\nAction: Stop all non-critical deployments"
        );
    }

    @Scheduled(cron = "0 0 0 1 * ?") // Monthly reset
    public void resetErrorBudgets() {
        budgets.clear();
        log.info("Error budgets reset for new month");
    }
}

record ErrorBudgetState(
    AtomicReference<Double> remaining,
    AtomicReference<Instant> lastUpdated
) {
    ErrorBudgetState(double initial, Instant now) {
        this(new AtomicReference<>(initial), new AtomicReference<>(now));
    }
}
```

### Burn Rate Alerts

```yaml
# Burn rate alerts based on error budget consumption
groups:
  - name: slo-burn-rate
    rules:
      # Fast burn: consume 5% of budget in 1 hour
      - alert: FastErrorBudgetBurn
        expr: |
          (
            1 - (
              sum(rate(http_server_requests_seconds_count{status=~"5.."}[1h]))
              / sum(rate(http_server_requests_seconds_count[1h]))
            )
          ) < 0.999  # For 99.9% SLO
        for: 1h
        labels:
          severity: critical
        annotations:
          summary: "Error budget burning fast for {{ $labels.service }}"

      # Slow burn: consume 10% of budget in 6 hours
      - alert: SlowErrorBudgetBurn
        expr: |
          (
            1 - (
              sum(rate(http_server_requests_seconds_count{status=~"5.."}[6h]))
              / sum(rate(http_server_requests_seconds_count[6h]))
            )
          ) < 0.999
        for: 6h
        labels:
          severity: warning
```

---

## SLO Monitoring Dashboard

### Prometheus Recording Rules

```yaml
# prometheus recording rules for SLO
groups:
  - name: slo-recording-rules
    rules:
      - record: slo:error_budget:ratio_30d
        expr: |
          1 - (
            sum(rate(http_server_requests_seconds_count{status=~"5.."}[30d]))
            / sum(rate(http_server_requests_seconds_count[30d]))
          )

      - record: slo:burn_rate:rate_1h
        expr: |
          (1 - slo:error_budget:ratio_30d)
          / (1 - 0.999)  # For 99.9% SLO

      - record: slo:remaining_budget:ratio
        expr: |
          (
            slo:error_budget:ratio_30d - 0.999
          ) / (1 - 0.999)
```

### Grafana SLO Panel

```json
{
  "title": "SLO Overview",
  "panels": [
    {
      "title": "Error Budget Remaining",
      "type": "gauge",
      "targets": [{
        "expr": "slo:remaining_budget:ratio",
        "legendFormat": "{{service}}"
      }],
      "thresholds": [
        {"color": "green", "value": 0.5},
        {"color": "yellow", "value": 0.2},
        {"color": "red", "value": 0}
      ]
    },
    {
      "title": "Burn Rate",
      "type": "graph",
      "targets": [{
        "expr": "slo:burn_rate:rate_1h",
        "legendFormat": "{{service}}"
      }]
    }
  ]
}
```

---

## Error Budget Policies

### Deployment Gates

```java
@Component
public class DeploymentGateService {

    private final ErrorBudgetService errorBudgetService;

    public boolean canDeploy(String serviceName, String version) {
        ErrorBudgetState budget = errorBudgetService
            .getErrorBudget(serviceName, "availability");

        if (budget.remaining().get() <= 0.5) {
            log.warn("Deployment blocked: less than 50% error budget remaining");
            return false;
        }

        if (budget.burnRate() > 2.0) {
            log.warn("Deployment blocked: burn rate too high");
            return false;
        }

        return true;
    }
}
```

### On-Call Priority

```yaml
# Error budget determines on-call priority
# > 50% remaining: Normal operations
# 20-50% remaining: Increased monitoring
# 0-20% remaining: All hands on deck
# Exhausted: Freeze all changes, full incident response
```

---

## Common Mistakes

### Mistake 1: Setting Unrealistic SLOs

```java
// WRONG: 99.999% (five nines) without infrastructure support
// Monthly budget: 26 seconds downtime
// One database failover exceeds the budget

// CORRECT: Realistic SLO based on architecture
// 99.9% (three nines): 43 minutes downtime/month
// Achievable with most architectures
```

### Mistake 2: Not Tracking Multiple SLOs

```java
// WRONG: Single availability SLO
// Ignores latency, throughput, correctness

// CORRECT: Multi-dimensional SLOs
// - Availability: 99.9%
// - Latency P99: 500ms, 99% of time
// - Correctness: 100% (no wrong results)
```

### Mistake 3: Ignoring Error Budget When It's Healthy

```yaml
# WRONG: Never using error budget for innovation
# Team is afraid of any risk

# CORRECT: Error budget allows controlled risk
# 80% budget remaining: Can deploy risky features
# 50% remaining: Standard caution
# 20% remaining: Only critical fixes
```

---

## Summary

SLOs, SLIs, and error budgets provide a data-driven approach to reliability:

1. SLIs measure what matters (latency, availability, correctness)
2. SLOs set realistic targets based on user expectations
3. Error budgets quantify acceptable risk
4. Burn rate alerts warn of fast budget consumption
5. Deployment gates use budget status for go/no-go decisions
6. SLOs should cover multiple dimensions
7. Error budgets balance reliability with innovation velocity

---

## References

- [Google SRE - SLOs and Error Budgets](https://sre.google/sre-book/service-level-objectives/)
- [Site Reliability Engineering](https://landing.google.com/sre/sre-book/chapters/service-level-objectives/)
- [Prometheus SLO Rules](https://prometheus.io/docs/practices/slos/)
- [Error Budget Policy](https://sre.google/workbook/error-budget/)

Happy Coding