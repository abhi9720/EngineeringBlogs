---
title: Building LLM Apps
description: >-
  Build production-ready LLM applications - from architecture to deployment and
  monitoring
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Application Development
  - Production AI
  - FastAPI
  - AI
  - Applications
coverImage: /images/building-llm-apps.png
draft: false
order: 10
---
# Building LLM Apps

## Overview

Building production LLM applications requires handling API calls, caching, error handling, rate limiting, and monitoring.

**Think of it as:** Moving from experiments to reliable software.

---

## Application Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              LLM Application Stack                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Application Layer                         │   │
│  │   FastAPI/Flask  │  Web  │  CLI  │  Batch              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Business Logic                            │   │
│  │   Prompt Management  │  Tools  │  Memory  │  Routing       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LLM Integration                            │   │
│  │   OpenAI  │  Anthropic  │  Local Models                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Infrastructure                            │   │
│  │   Cache (Redis)  │  Vector DB  │  Monitoring             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Basic LLM Client

### OpenAI Client

```python
import openai
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key="your-api-key")

async def generate_response(prompt: str, model: str = "gpt-4o") -> str:
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=1000
    )
    return response.choices[0].message.content

import asyncio
result = asyncio.run(generate_response("Hello!"))
```

### Async Client for Production

```python
import asyncio
from openai import AsyncOpenAI

class LLMClient:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)
    
    async def generate(
        self,
        messages: list,
        model: str = "gpt-4o-mini",
        temperature: float = 0.7,
        max_tokens: int = 1000
    ):
        response = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens
        )
        return response.choices[0].message.content

# Usage
async def main():
    client = LLMClient("your-api-key")
    result = await client.generate([
        {"role": "user", "content": "What's Python?"}
    ])
    print(result)

asyncio.run(main())
```

---

## FastAPI Application

### Basic API

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import openai

app = FastAPI(title="LLM API")

class PromptRequest(BaseModel):
    prompt: str
    model: str = "gpt-4o-mini"
    max_tokens: int = 1000
    temperature: float = 0.7

class PromptResponse(BaseModel):
    response: str
    model: str
    tokens_used: int

@app.post("/generate", response_model=PromptResponse)
async def generate(request: PromptRequest):
    try:
        response = await openai.chat.completions.create(
            model=request.model,
            messages=[{"role": "user", "content": request.prompt}],
            max_tokens=request.max_tokens,
            temperature=request.temperature
        )
        
        return PromptResponse(
            response=response.choices[0].message.content,
            model=response.model,
            tokens_used=response.usage.total_tokens
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Run: uvicorn main:app --reload
```

---

## Caching

### Response Caching

```python
import hashlib
import json
import redis

r = redis.Redis(host='localhost', port=6379, db=0)

def get_cache_key(prompt: str, model: str) -> str:
    content = json.dumps({"prompt": prompt, "model": model})
    return hashlib.md5(content.encode()).hexdigest()

async def generate_with_cache(prompt: str, model: str = "gpt-4o-mini") -> str:
    cache_key = get_cache_key(prompt, model)
    
    # Check cache
    cached = r.get(cache_key)
    if cached:
        return cached.decode()
    
    # Generate new
    response = await openai.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    
    result = response.choices[0].message.content
    
    # Cache for 1 hour
    r.setex(cache_key, 3600, result)
    
    return result
```

### Semantic Cache

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

class SemanticCache:
    def __init__(self, redis_client, threshold=0.95):
        self.redis = redis_client
        self.threshold = threshold
        self.embedding_model = model
    
    def get_cache_key(self, prompt: str) -> tuple:
        emb = self.embedding_model.encode(prompt)
        # Store embedding and check similarity
        return emb.tostring()
    
    async def get(self, prompt: str) -> Optional[str]:
        emb = self.embedding_model.encode(prompt)
        
        # Check similar prompts in cache
        # (Simplified - real implementation needs vector search)
        return None
    
    def set(self, prompt: str, response: str):
        # Store with embedding
        pass
```

---

## Rate Limiting

```python
from datetime import datetime, timedelta
from collections import defaultdict

class RateLimiter:
    def __init__(self, requests_per_minute: int = 60):
        self.requests_per_minute = requests_per_minute
        self.requests = defaultdict(list)
    
    def is_allowed(self, client_id: str) -> bool:
        now = datetime.now()
        cutoff = now - timedelta(minutes=1)
        
        # Clean old requests
        self.requests[client_id] = [
            ts for ts in self.requests[client_id]
            if ts > cutoff
        ]
        
        if len(self.requests[client_id]) >= self.requests_per_minute:
            return False
        
        self.requests[client_id].append(now)
        return True

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_id = request.client.host
    
    if not rate_limiter.is_allowed(client_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    return await call_next(request)
```

---

## Error Handling

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def generate_with_retry(prompt: str, model: str = "gpt-4o-mini") -> str:
    try:
        response = await openai.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content
    
    except openai.RateLimitError:
        # Retry on rate limit
        raise
    
    except openai.APIError as e:
        # Log and raise
        logger.error(f"API Error: {e}")
        raise
```

---

## Monitoring

```python
import time
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class LLMObservability:
    def __init__(self):
        self.metrics = []
    
    def log_request(
        self,
        prompt: str,
        response: str,
        latency_ms: float,
        model: str,
        tokens_used: int
    ):
        self.metrics.append({
            "timestamp": datetime.now().isoformat(),
            "prompt_length": len(prompt),
            "response_length": len(response),
            "latency_ms": latency_ms,
            "model": model,
            "tokens_used": tokens_used
        })
    
    def get_stats(self):
        if not self.metrics:
            return {}
        
        latencies = [m["latency_ms"] for m in self.metrics]
        
        return {
            "total_requests": len(self.metrics),
            "avg_latency_ms": sum(latencies) / len(latencies),
            "p99_latency": sorted(latencies)[int(len(latencies) * 0.99)],
            "total_tokens": sum(m["tokens_used"] for m in self.metrics)
        }

observability = LLMObservability()

@app.post("/generate")
async def generate(request: PromptRequest):
    start = time.time()
    
    response = await generate_with_retry(request.prompt)
    
    latency = (time.time() - start) * 1000
    
    observability.log_request(
        prompt=request.prompt,
        response=response,
        latency_ms=latency,
        model=request.model,
        tokens_used=0  # Get from API response
    )
    
    return response
```

---

## Summary

| Component | Purpose | Tools |
|-----------|---------|-------|
| **API Layer** | Handle requests | FastAPI, Flask |
| **LLM Client** | Communicate with LLM | OpenAI SDK |
| **Caching** | Reduce costs, improve speed | Redis |
| **Rate Limiting** | Protect API limits | Custom middleware |
| **Error Handling** | Reliability | Tenacity |
| **Monitoring** | Visibility | Custom observability |

**Key insight:** Production LLM apps need proper infrastructure for reliability and cost efficiency.

**Next:** Continue to `tool-calling.md` to learn about extending LLMs with tools.

---

## References

- [OpenAI API](https://platform.openai.com/docs)
- [FastAPI](https://fastapi.tiangolo.com/)
- [Tenacity](https://tenacity.readthedocs.io/)
