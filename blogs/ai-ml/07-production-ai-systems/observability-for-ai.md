---
title: Observability for AI
description: 'Monitor AI systems - metrics, logging, and tracing'
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Observability
  - Monitoring
  - Production AI
  - AI
  - MLOps
coverImage: /images/observability-for-ai.png
draft: false
order: 70
---
# Observability for AI

## Overview

Observability helps understand, debug, and optimize AI systems in production.

---

## Three Pillars

```python
OBSERVABILITY_PILLARS = {
    "metrics": "Numerical measurements (latency, throughput)",
    "logs": "Event records (errors, actions)",
    "traces": "Request flow across services"
}
```

---

## Implementation

### Custom Metrics

```python
from prometheus_client import Counter, Histogram, Gauge

# Define metrics
request_count = Counter('llm_requests_total', 'Total requests')
request_latency = Histogram('llm_request_latency_seconds', 'Request latency')
tokens_used = Counter('llm_tokens_total', 'Tokens used')
active_requests = Gauge('llm_active_requests', 'Active requests')

@app.middleware("http")
async def observe_requests(request, call_next):
    active_requests.inc()
    with request_latency.time():
        response = await call_next(request)
    request_count.inc()
    tokens_used.inc(response.usage.total_tokens if hasattr(response, 'usage') else 0)
    active_requests.dec()
    return response
```

### Tracing

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

@tracer.start_as_current_span("llm_call")
async def call_llm(prompt):
    with span.attributes({"prompt.length": len(prompt)}):
        response = await openai.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        span.set_attribute("tokens.used", response.usage.total_tokens)
        return response
```

---

## Summary

| Pillar | Tool | Metrics |
|--------|------|---------|
| **Metrics** | Prometheus | Latency, throughput |
| **Logs** | ELK, Loki | Errors, events |
| **Traces** | Jaeger, Tempo | Request flow |

**Key insight:** Full observability enables debugging and optimization.

---

## References

- [Prometheus](https://prometheus.io/)
- [OpenTelemetry](https://opentelemetry.io/)
