---
title: Deploying LLM Apps
description: Best practices for deploying LLM applications in production
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Deployment
  - Production AI
  - AI
  - MLOps
coverImage: /images/deploying-llm-apps.png
draft: false
order: 30
---
# Deploying LLM Apps

## Overview

Deploying LLM apps requires handling scale, latency, and cost optimization.

---

## Deployment Options

```python
DEPLOYMENT_OPTIONS = {
    "api_service": {
        "provider": "OpenAI, Anthropic, Cohere",
        "pros": "Managed, scalable",
        "cons": "Cost, latency, privacy"
    },
    "self_hosted": {
        "provider": "vLLM, Ollama, Text Generation Inference",
        "pros": "Control, privacy, no per-token cost",
        "cons": "Infrastructure, maintenance"
    },
    "fine_tuned": {
        "provider": "Azure, AWS, Google Cloud",
        "pros": "Custom, fast",
        "cons": "Expensive, complex"
    }
}
```

---

## API Deployment with FastAPI

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class GenerateRequest(BaseModel):
    prompt: str
    max_tokens: int = 1000
    temperature: float = 0.7

@app.post("/generate")
async def generate(req: GenerateRequest):
    try:
        response = await openai.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": req.prompt}],
            max_tokens=req.max_tokens,
            temperature=req.temperature
        )
        return {"response": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

---

## Self-Hosting with vLLM

```python
from vllm import LLM

# Initialize
llm = LLM(model="meta-llama/Llama-2-7b")

# Serve
# $ python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-2-7b
```

---

## Summary

| Option | Best For |
|--------|----------|
| **API (OpenAI)** | Quick start, small scale |
| **Self-hosted** | Privacy, high volume |
| **Fine-tuned** | Custom behavior |

**Key insight:** Match deployment to your needs.

---

## References

- [vLLM](https://github.com/vllm-project/vllm)
- [FastAPI](https://fastapi.tiangolo.com/)
