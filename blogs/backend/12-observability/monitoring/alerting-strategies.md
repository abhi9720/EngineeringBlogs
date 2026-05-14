---
title: Alerting Strategies
description: >-
  Design effective alerting rules: thresholds, notification channels, on-call
  rotation, and incident response patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - observability
  - monitoring
  - alerting
  - incident-response
coverImage: /images/alerting-strategies.png
draft: false
order: 10
---
# Alerting Strategies

## Overview

Alerting is the practice of notifying operators when system behavior deviates from expected norms. Well-designed alerts catch problems before they impact users, while poorly designed alerts cause alert fatigue and missed incidents.

### The Alerting Goldilocks Principle

- **Too few alerts**: Incidents go unnoticed
- **Too many alerts**: Alert fatigue, ignored notifications
- **Just right**: Signal, not noise

---

## Alert Types

### 1. Page-Worthy Alerts (Critical)

Conditions requiring immediate human response:

```yaml
# Critical: System is unavailable or degrading
groups:
  - name: critical
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
          page: true
        annotations:
          summary: "{{ $labels.instance }} is unreachable"
          description: "Service {{ $labels.instance }} has been down for 1 minute"

      - alert: HighErrorRate
        expr: |
          rate(http_server_requests_seconds_count{status=~"5.."}[5m])
          / rate(http_server_requests_seconds_count[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
          page: true
        annotations:
          summary: "Error rate exceeds 5% on {{ $labels.instance }}"

      - alert: P99LatencyHigh
        expr: |
          histogram_quantile(0.99,
            rate(http_server_requests_seconds_bucket[5m])) > 5
        for: 10m
        labels:
          severity: critical
          page: true
```

Page-worthy alerts should be rare—ideally fewer than two per week per service. The `for` duration prevents alerting on transient blips. A 5-minute `for` on error rate means a brief deployment spike won't page anyone. The `page: true` label separates notification routing from severity, allowing the same alert to page during business hours while going to email at night if desired.

### 2. Warning Alerts

Conditions that need attention but not immediate page:

```yaml
groups:
  - name: warnings
    rules:
      - alert: HighCPUUsage
        expr: process_cpu_usage > 0.8
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "CPU usage above 80%"
          description: "CPU is at {{ $value | humanizePercentage }}"

      - alert: HighMemoryUsage
        expr: |
          jvm_memory_used_bytes{area="heap"}
          / jvm_memory_max_bytes{area="heap"} > 0.85
        for: 30m
        labels:
          severity: warning

      - alert: DiskSpaceLow
        expr: disk_utilization > 0.8
        for: 1h
        labels:
          severity: warning
```

Warning alerts should be investigated during business hours. The longer `for` durations (15-60 minutes) ensure the condition is sustained before creating a ticket. A JVM heap spike during a garbage collection cycle is normal; a 30-minute sustained high heap indicates a leak.

### 3. Informational Alerts

Low-priority notifications:

```yaml
groups:
  - name: info
    rules:
      - alert: DeploymentDetected
        expr: count(up) != count(up offset 10m)
        labels:
          severity: info
        annotations:
          summary: "Deployment may have occurred"
```

---

## Alert Routing

### Route Configuration

```yaml
# alertmanager.yml
route:
  receiver: 'default'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      repeat_interval: 5m
      routes:
        - match:
            service: payment-service
          receiver: 'pagerduty-payment'
        - match:
            service: order-service
          receiver: 'pagerduty-orders'

    - match:
        severity: warning
      receiver: 'slack-warnings'
      repeat_interval: 30m

    - match:
        severity: info
      receiver: 'email-info'
      repeat_interval: 24h
```

The grouping logic (`group_by: ['alertname', 'severity']`) batches identical alerts firing on multiple instances into a single notification. Without grouping, a service with 10 down instances would send 10 separate pages. The `repeat_interval` controls how often the alert re-notifies while still firing—every 5 minutes for critical, every 30 for warnings, once per day for info.

### Receiver Configuration

```yaml
receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - routing_key: '${PAGERDUTY_KEY}'
        severity: critical
        description: '{{ .CommonAnnotations.description }}'

  - name: 'slack-warnings'
    slack_configs:
      - api_url: '${SLACK_WEBHOOK}'
        channel: '#alerts-warnings'
        title: '{{ .GroupLabels.alertname }}'
        text: >-
          {{ range .Alerts }}
            *Alert:* {{ .Annotations.summary }}
            *Description:* {{ .Annotations.description }}
            *Severity:* {{ .Labels.severity }}
            *Instance:* {{ .Labels.instance }}
          {{ end }}
        send_resolved: true

  - name: 'email-info'
    email_configs:
      - to: 'team@company.com'
        from: 'alerts@company.com'
        smarthost: 'smtp.company.com:587'
```

The Slack template iterates over all alerts in the group, rendering each as a formatted message block. The `send_resolved: true` flag is important—it sends a follow-up message when the alert resolves, so the team knows the issue is clear without checking the dashboard.

---

## Alerting Patterns

### Multi-Window, Multi-Burn-Rate Alert

```yaml
# Burn rate alerts for SLO monitoring
groups:
  - name: slo-alerts
    rules:
      # Fast burn: 5% error budget consumed in 1 hour
      - alert: FastBurnRate
        expr: |
          (
            rate(errors_total[1h])
            / rate(requests_total[1h])
          ) > 0.05
        for: 1h
        labels:
          severity: critical

      # Slow burn: 5% error budget consumed in 6 hours
      - alert: SlowBurnRate
        expr: |
          (
            rate(errors_total[6h])
            / rate(requests_total[6h])
          ) > 0.05
        for: 6h
        labels:
          severity: warning
```

### Dead Man Switch

```yaml
# Alert if the alerting system itself fails
groups:
  - name: dead-man-switch
    rules:
      - alert: DeadManSwitch
        expr: vector(1)
        labels:
          severity: none
        annotations:
          summary: "Dead man switch alert"
```

The Dead Man Switch is a synthetic alert that always fires. If Alertmanager stops receiving it (because Prometheus is down or the alerting pipeline is broken), the silence on this alert expires and triggers a notification. This catches silent failures of the monitoring infrastructure itself.

### Predictive Alerting

```yaml
# Alert based on trends, not thresholds
groups:
  - name: predictive
    rules:
      - alert: DiskFilling
        expr: |
          predict_linear(
            disk_free_bytes[6h],
            86400
          ) < 0
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Disk will fill within 24 hours"
```

PromQL's `predict_linear` function applies linear regression to the last 6 hours of disk usage and projects forward 24 hours. When the projection crosses zero, the alert fires—typically 12-18 hours before the disk actually fills, giving plenty of time for cleanup or provisioning.

---

## Alert Fatigue Prevention

### Threshold Tuning

```yaml
# WRONG: Too sensitive, triggers on every spike
- alert: CPUSpike
  expr: process_cpu_usage > 0.5
  for: 1m

# CORRECT: Sustained high usage
- alert: HighCPU
  expr: process_cpu_usage > 0.8
  for: 15m
```

### Alert Aggregation

```java
@Service
public class AlertAggregationService {

    private final MeterRegistry registry;

    // Aggregate errors before alerting
    public void recordError(String service, String errorType) {
        Counter.builder("errors")
            .tag("service", service)
            .tag("type", errorType)
            .register(registry)
            .increment();
    }
}
```

### Maintenance Windows

```yaml
# Silence alerts during maintenance
# In Alertmanager UI or via API:

# API: Create silence
POST /api/v2/silences
{
  "comment": "Scheduled deployment",
  "createdBy": "deploy-bot",
  "startsAt": "2026-05-11T22:00:00Z",
  "endsAt": "2026-05-11T23:00:00Z",
  "matchers": [
    {
      "name": "severity",
      "value": "critical",
      "isRegex": false
    }
  ]
}
```

---

## On-Call Best Practices

### Rotation Management

```java
// PagerDuty integration
@Value("${pagerduty.service.key}")
private String pagerdutyKey;

public void triggerIncident(Alert alert) {
    // Create PagerDuty incident
    PagerDutyIncident incident = PagerDutyIncident.builder()
        .title(alert.getSummary())
        .description(alert.getDescription())
        .urgency("high")
        .build();

    pagerdutyClient.createIncident(pagerdutyKey, incident);
}
```

### Escalation Policy

```yaml
# example escalation policy
escalation_policies:
  - name: primary-oncall
    escalation_rules:
      - target: user:alice@company.com
        delay: 0
      - target: user:bob@company.com
        delay: 5m
      - target: schedule:secondary-oncall
        delay: 10m
      - target: user:manager@company.com
        delay: 15m
```

---

## Alert Response Automation

### Runbook Integration

```java
@Component
public class AlertRunbookService {

    private final Map<String, String> runbooks = Map.of(
        "HighErrorRate", "https://runbooks.company.com/high-error-rate",
        "ServiceDown", "https://runbooks.company.com/service-down",
        "HighLatency", "https://runbooks.company.com/high-latency"
    );

    public String getRunbookUrl(String alertName) {
        return runbooks.getOrDefault(alertName, "https://runbooks.company.com/general");
    }
}
```

### Auto-Remediation

```java
@Component
public class AutoRemediationService {

    @EventListener
    public void onAlert(AlertEvent event) {
        switch (event.getAlertName()) {
            case "HighCPUUsage":
                scaleUpInstance();
                break;
            case "DatabaseConnectionPoolExhausted":
                restartConnectionPool();
                break;
            case "DeadlockedThreads":
                dumpAndRestartThreads();
                break;
        }
    }

    private void scaleUpInstance() {
        // Kubernetes: scale deployment
        appsV1Api.patchNamespacedDeployment(
            "my-app", "production",
            new V1Patch("[{\"op\":\"replace\",\"path\":\"/spec/replicas\",\"value\":5}]"),
            null, null, null, null);
    }
}
```

---

## Common Mistakes

### Mistake 1: Alerting on Symptoms vs Causes

```yaml
# WRONG: Alert on symptom (high latency)
# Stale, there may be many causes

# CORRECT: Alert on causes (CPU, DB, network)
- alert: SlowDatabaseQueries
  expr: rate(database_query_duration_seconds_sum[5m]) > 1
```

### Mistake 2: Not Setting `for` Duration

```yaml
# WRONG: No duration, triggers on transient spikes
- alert: CPUSpike
  expr: cpu > 0.9

# CORRECT: Only alert if sustained
- alert: HighCPU
  expr: cpu > 0.9
  for: 15m
```

### Mistake 3: Too Many Critical Alerts

```yaml
# WRONG: Everything is critical
labels:
  severity: critical  # 50+ alerts daily

# CORRECT: Use severity hierarchy
# critical: page immediately (1-2 per week)
# warning: work hours investigation (few per day)
# info: no action needed
```

---

## Summary

Effective alerting strategies:

1. Define clear severity levels (critical, warning, info)
2. Use `for` duration to avoid transient alert spam
3. Route alerts to appropriate receivers
4. Implement escalation policies for critical alerts
5. Create runbooks for common alert types
6. Automate remediation where safe
7. Regularly review and tune alert thresholds
8. Monitor alert fatigue and adjust

---

## References

- [Google SRE - Alerting](https://sre.google/sre-book/alerting-on-slos/)
- [Prometheus Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Alertmanager Configuration](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [PagerDuty Event Integration](https://developer.pagerduty.com/docs/events-api-v2/overview/)

Happy Coding
