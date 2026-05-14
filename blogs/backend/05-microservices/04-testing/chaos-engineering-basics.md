---
title: Chaos Engineering Basics for Microservices
description: >-
  Implement chaos engineering for microservices: Chaos Monkey, LitmusChaos,
  fault injection, resilience testing, steady-state hypothesis, and Spring Boot
  integration
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - chaos-engineering
  - resilience
  - testing
  - microservices
coverImage: /images/chaos-engineering-basics.png
draft: false
order: 10
---
## Overview

Chaos engineering is the practice of intentionally injecting failures into a system to test its resilience. By simulating real-world failures like service crashes, latency spikes, and network partitions, teams can identify weaknesses before they cause production outages.

## Principles of Chaos Engineering

1. Define steady state - measure normal system behavior
2. Hypothesize that steady state will continue during experiments
3. Inject real-world failures (latency, crashes, network errors)
4. Compare results against steady state
5. Fix weaknesses and repeat

## Spring Boot Chaos Monkey

### Dependencies

Chaos Monkey for Spring Boot is a testing dependency that injects latency, exceptions, and other failures into application components. The `test` scope ensures it's never packaged in production artifacts.

```xml
<dependency>
    <groupId>de.codecentric</groupId>
    <artifactId>chaos-monkey-spring-boot</artifactId>
    <version>3.5.0</version>
    <scope>test</scope>
</dependency>
```

### Configuration

```yaml
# application-chaos.yml
chaos:
  monkey:
    enabled: true
    assaults:
      level: 3
      latency-active: true
      latency-range-start: 3000
      latency-range-end: 10000
      exceptions-active: true
      exception-weight: 50
      kill-application-active: false
      memory-active: true
      memory-milliseconds-wait: 2000
      memory-milliseconds-stack-overload: 100
    watcher:
      controller: true
      rest-controller: true
      service: true
      repository: true
      component: true
```

### Chaos Profile

The chaos profile activates assault configuration programmatically. The `level: 3` enables all assault types, with latency ranging from 3-10 seconds and a 50% exception weight. The watcher configuration specifies which Spring beans (controllers, services, repositories) are targeted for failure injection.

```java
@Configuration
@Profile("chaos")
public class ChaosConfig {

    @Bean
    public ChaosMonkeyRequestScope chaosMonkeyRequestScope() {
        return new ChaosMonkeyRequestScope();
    }

    @Bean
    public ChaosMonkeyAssaults chaosMonkeyAssaults() {
        return ChaosMonkeyAssaults.builder()
            .latencyActive(true)
            .latencyRangeStart(3000)
            .latencyRangeEnd(10000)
            .exceptionsActive(true)
            .exceptionWeight(30)
            .killApplicationActive(false)
            .build();
    }
}

@RestController
@RequestMapping("/api/orders")
@Profile("chaos")
public class ChaosOrderController {

    @Autowired
    private OrderService orderService;

    @GetMapping("/chaos/status")
    public Map<String, Object> chaosStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("chaos", "active");
        status.put("latency", "3000-10000ms");
        status.put("exceptionRate", "30%");
        return status;
    }
}
```

## LitmusChaos for Kubernetes

LitmusChaos runs infrastructure-level experiments on Kubernetes — pod deletion, network latency, CPU spikes, and memory pressure. Each experiment has configurable parameters like duration, interval, and force flags. The `RAMP_TIME` ensures a gradual introduction of the fault rather than an instant shock.

```yaml
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: order-service-chaos
spec:
  engineState: "active"
  annotationCheck: "false"
  appinfo:
    appns: "microservices"
    applabel: "app=order-service"
    appkind: "deployment"
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: "60"
            - name: CHAOS_INTERVAL
              value: "10"
            - name: FORCE
              value: "true"
            - name: RAMP_TIME
              value: "10"
    - name: pod-network-latency
      spec:
        components:
          env:
            - name: NETWORK_LATENCY
              value: "5000"
            - name: TOTAL_CHAOS_DURATION
              value: "120"
            - name: CHAOS_INTERVAL
              value: "30"
    - name: pod-cpu-hog
      spec:
        components:
          env:
            - name: CPU_CORES
              value: "1"
            - name: TOTAL_CHAOS_DURATION
              value: "60"
    - name: pod-memory-hog
      spec:
        components:
          env:
            - name: MEMORY_CONSUMPTION
              value: "500"
            - name: TOTAL_CHAOS_DURATION
              value: "60"
```

## Chaos Experiment Runner

The experiment runner orchestrates a series of chaos experiments, recording baseline metrics before and comparing after. Each experiment (service crash, latency spike, database failure, network partition) is wrapped with a health check to determine pass/fail status. Experiments should run during low-traffic periods to minimize user impact.

```java
@Component
public class ChaosExperimentRunner {

    private final MeterRegistry meterRegistry;
    private final RestTemplate restTemplate;
    private final Map<String, Boolean> experimentResults = new ConcurrentHashMap<>();

    public ChaosExperimentRunner(MeterRegistry meterRegistry,
                                  RestTemplate restTemplate) {
        this.meterRegistry = meterRegistry;
        this.restTemplate = restTemplate;
    }

    @Scheduled(cron = "0 0 2 * * ?") // Run at 2 AM daily
    public void runChaosExperiments() {
        log.info("Starting chaos experiments...");

        recordSteadyStateMetrics();

        List<ChaosResult> results = List.of(
            runExperiment("service-crash", this::simulateServiceCrash),
            runExperiment("latency-spike", this::simulateLatencySpike),
            runExperiment("database-failure", this::simulateDatabaseFailure),
            runExperiment("network-partition", this::simulateNetworkPartition)
        );

        results.forEach(result -> {
            if (result.isPassed()) {
                log.info("Experiment '{}' PASSED", result.getName());
            } else {
                log.warn("Experiment '{}' FAILED: {}", result.getName(),
                    result.getErrorMessage());
            }
        });

        compareWithSteadyState();
    }

    private ChaosResult runExperiment(String name, Runnable experiment) {
        try {
            experiment.run();
            Thread.sleep(5000); // Wait for recovery

            boolean systemHealthy = checkSystemHealth();
            return new ChaosResult(name, systemHealthy, null);
        } catch (Exception e) {
            return new ChaosResult(name, false, e.getMessage());
        }
    }

    private void simulateServiceCrash() {
        restTemplate.postForEntity(
            "http://order-service/actuator/chaos/kill",
            null, Void.class
        );
    }

    private void simulateLatencySpike() {
        restTemplate.postForEntity(
            "http://order-service/actuator/chaos/latency?delay=5000",
            null, Void.class
        );
    }

    private void simulateDatabaseFailure() {
        restTemplate.postForEntity(
            "http://order-service/actuator/chaos/database?mode=disconnect",
            null, Void.class
        );
    }

    private void simulateNetworkPartition() {
        restTemplate.postForEntity(
            "http://payment-service/actuator/chaos/network?loss=100",
            null, Void.class
        );
    }

    private boolean checkSystemHealth() {
        try {
            ResponseEntity<HealthResponse> response = restTemplate.getForEntity(
                "http://api-gateway/actuator/health",
                HealthResponse.class
            );
            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            return false;
        }
    }

    private void recordSteadyStateMetrics() {
        // Record baseline metrics
        meterRegistry.gauge("chaos.steady.state.requests", 
            restTemplate.getForObject(
                "http://api-gateway/actuator/metrics/http.server.requests",
                Map.class
            )
        );
    }

    private void compareWithSteadyState() {
        // Compare current metrics with steady state
        double errorRate = meterRegistry.get("http.server.requests")
            .tag("outcome", "SERVER_ERROR")
            .measure().stream()
            .mapToDouble(m -> m.getValue())
            .average()
            .orElse(0.0);

        if (errorRate > 0.01) {
            log.warn("Error rate elevated after chaos experiments: {}%",
                errorRate * 100);
        }
    }

    @Data
    @AllArgsConstructor
    private static class ChaosResult {
        private String name;
        private boolean passed;
        private String errorMessage;
    }
}
```

## Resilience Verification

After chaos experiments, verifying that resilience mechanisms recovered is essential. The verifier checks that all circuit breakers are CLOSED (not stuck OPEN), retry counts are within expected ranges, and bulkheads have available permits. Automated verification prevents the common pitfall of leaving resilience mechanisms in a degraded state.

```java
@Component
public class ResilienceVerifier {

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    @Autowired
    private RetryRegistry retryRegistry;

    @Autowired
    private BulkheadRegistry bulkheadRegistry;

    @Scheduled(fixedRate = 60000)
    public void verifyResilienceMechanisms() {
        circuitBreakerRegistry.getAllCircuitBreakers().forEach((name, cb) -> {
            CircuitBreaker.Metrics metrics = cb.getMetrics();
            log.info("CircuitBreaker '{}': state={}, failureRate={}%",
                name, cb.getState(), metrics.getFailureRate());

            if (cb.getState() == CircuitBreaker.State.OPEN) {
                log.warn("CircuitBreaker '{}' is OPEN", name);
            }
        });

        retryRegistry.getAllRetries().forEach((name, retry) -> {
            log.info("Retry '{}': successful={}, failed={}",
                name, retry.getMetrics().getNumberOfSuccessfulCallsWithoutRetryAttempt(),
                retry.getMetrics().getNumberOfFailedCallsWithoutRetryAttempt());
        });
    }

    public boolean verifyChaosExperimentResults() {
        boolean allHealthy = true;

        for (CircuitBreaker circuitBreaker : 
                circuitBreakerRegistry.getAllCircuitBreakers().values()) {
            if (circuitBreaker.getState() == CircuitBreaker.State.OPEN) {
                allHealthy = false;
            }
        }

        for (Bulkhead bulkhead : 
                bulkheadRegistry.getAllBulkheads().values()) {
            if (bulkhead.getMetrics().getAvailableConcurrentCalls() == 0) {
                allHealthy = false;
            }
        }

        return allHealthy;
    }
}
```

## Best Practices

- Start with small, controlled experiments in non-production environments.
- Define steady-state metrics before each experiment.
- Use blast radius limits to prevent experiments from affecting real users.
- Automate experiments and run them regularly (not just during incidents).
- Document and share experiment results across teams.
- Combine chaos engineering with monitoring and alerting.

## Common Mistakes

### Mistake: Running chaos experiments without monitoring

```java
// Wrong - injecting failure without observability
simulateServiceCrash();
// No monitoring to verify system behavior
```

```java
// Correct - monitor before, during, and after
recordSteadyStateMetrics();
simulateServiceCrash();
analyzeMetricChanges();
generateReport();
```

### Mistake: Not having a rollback plan

```bash
# Wrong - no way to stop experiments
kubectl apply -f chaos-experiment.yaml
```

```bash
# Correct - with safety mechanisms
kubectl apply -f chaos-experiment.yaml
# Set timeout and watch
sleep 300 && kubectl delete -f chaos-experiment.yaml
# Or use halt button
```

## Summary

Chaos engineering helps build resilient microservices by proactively identifying weaknesses. Use Spring Boot Chaos Monkey for application-level experiments and LitmusChaos for Kubernetes infrastructure experiments. Always define steady-state metrics and have rollback plans before running experiments.

## References

- [Principles of Chaos Engineering](https://principlesofchaos.org/)
- [LitmusChaos Documentation](https://litmuschaos.io/docs/)
- [Chaos Monkey Spring Boot](https://codecentric.github.io/chaos-monkey-spring-boot/)

Happy Coding
