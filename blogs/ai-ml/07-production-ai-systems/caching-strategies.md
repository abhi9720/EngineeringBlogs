---
title: Caching Strategies
description: Implement caching to reduce LLM costs and improve latency
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Caching
  - Cost Optimization
  - Production AI
  - AI
coverImage: /images/caching-strategies.png
draft: false
order: 10
---
# Caching Strategies

## Overview

Caching reduces costs and improves response times by storing and reusing responses.

---

## Caching Layers

```python
CACHING_LAYERS = {
    "exact_match": "Same prompt → Same response",
    "semantic": "Similar prompts → Similar responses",
    "result": "Store computed results",
    "context": "Cache conversation context"
}
```

---

## Implementation

### Exact Match Cache

```python
import hashlib

class ExactCache:
    def __init__(self, redis_client, ttl=3600):
        self.redis = redis_client
        self.ttl = ttl
    
    def get_key(self, prompt, model):
        return hashlib.sha256(f"{model}:{prompt}".encode()).hexdigest()
    
    def get(self, prompt, model):
        key = self.get_key(prompt, model)
        return self.redis.get(key)
    
    def set(self, prompt, model, response):
        key = self.get_key(prompt, model)
        self.redis.setex(key, self.ttl, response)
```

### Semantic Cache

```python
class SemanticCache:
    def __init__(self, embedding_model, redis_client, threshold=0.95):
        self.embedder = embedding_model
        self.redis = redis_client
        self.threshold = threshold
    
    async def get_or_compute(self, prompt, compute_fn):
        # Embed prompt
        emb = self.embedder.encode(prompt)
        
        # Check cache
        cached = self.redis.get(f"cache:{hash(emb)}")
        if cached:
            return json.loads(cached)
        
        # Compute
        result = await compute_fn(prompt)
        
        # Cache
        self.redis.set(f"cache:{hash(emb)}", json.dumps(result))
        
        return result
```

---

## Summary

| Type | Hit Rate | Latency | Use Case |
|------|----------|---------|----------|
| **Exact** | 10-30% | Fast | Repeated queries |
| **Semantic** | 30-60% | Medium | Similar queries |

**Key insight:** Cache aggressively to reduce costs.

---

## References

- [Redis](https://redis.io/)
- [GPTCache](https://github.com/zilliztech/GPTCache)
