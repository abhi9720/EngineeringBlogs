---
title: Introduction to LLMs
description: >-
  Understand large language models - how they work, key capabilities, and
  popular models
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Generative AI
  - GPT
  - Language Models
  - AI
  - Fundamentals
coverImage: /images/intro-to-llms.png
draft: false
order: 20
---
# Introduction to LLMs

## Overview

Large Language Models (LLMs) are AI models trained on vast amounts of text to understand and generate human language. Models like GPT, Claude, and Gemini can write, code, analyze, and reason.

**Think of it as:** A machine that learned language by reading the entire internet.

---

## What is an LLM?

```
┌─────────────────────────────────────────────────────────────────┐
│              What Makes a Model "Large"?                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Small Model:                                                   │
│  - Few million parameters                                       │
│  - Can run on your laptop                                       │
│  - Examples: DistilBERT (66M params)                           │
│                                                                 │
│  Large Language Model:                                          │
│  - Billions of parameters                                       │
│  - Requires GPU/cloud                                          │
│  - Examples: GPT-3 (175B), GPT-4 (1.7T)                       │
│                                                                 │
│  Key insight: More parameters = More capacity to learn         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### The Core: Next Token Prediction

```python
# LLMs are trained to predict the next word

# Input: "The capital of France is"
# Output: "Paris"

# How it works:
# 1. Convert text to tokens (words/subwords)
# 2. Process through neural network (transformer)
# 3. Predict probability distribution over vocabulary
# 4. Sample or pick most likely next token
```

---

## How LLMs Work

### Training Process

```python
# Training on billions of sentences:
# Input: "The sky is blue"
# Task: Predict next word

# Model sees:
# Token 1: "The" → predict "sky"
# Token 2: "sky" → predict "is"
# Token 3: "is" → predict "blue"
# Token 4: "blue" → predict [END]

# After millions of examples:
# Model learns grammar, facts, reasoning patterns!
```

### Transformer Architecture

```python
# Simplified LLM architecture

class LLM:
    def __init__(self, vocab_size, d_model, num_layers):
        self.embeddings = Embedding(vocab_size, d_model)
        self.transformer_blocks = [
            TransformerBlock(d_model) for _ in range(num_layers)
        ]
        self.lm_head = Linear(d_model, vocab_size)
    
    def forward(self, tokens):
        x = self.embeddings(tokens)  # Convert tokens to vectors
        
        for block in self.transformer_blocks:
            x = block(x)  # Process through transformers
        
        logits = self.lm_head(x)  # Project to vocabulary
        
        return logits  # Probability for each token
```

---

## Popular LLMs

### GPT Series (OpenAI)

| Model | Parameters | Context | Best For |
|-------|-----------|---------|----------|
| GPT-3.5 | 175B | 16K | Fast, cost-effective |
| GPT-4 | ~1.7T (experts) | 128K | Complex reasoning |
| GPT-4o | MoE | 128K | Multimodal, fast |
| o1/o3 | Large | 128K | Complex reasoning |

### Claude (Anthropic)

| Model | Context | Strengths |
|-------|---------|-----------|
| Claude 3.5 Sonnet | 200K | Coding, analysis |
| Claude 3.5 Haiku | 200K | Fast, efficient |
| Claude 3 Opus | 200K | Complex tasks |

### Open Source Models

| Model | Size | Training |
|-------|------|----------|
| Llama 3.1 | 8B-405B | Open |
| Mistral | 7B | Open |
| Phi-3 | 3.8B | Microsoft |
| Gemma 2 | 2B-27B | Google |

---

## Key LLM Capabilities

### Text Generation

```python
import openai

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Write a haiku about coding"}
    ],
    max_tokens=100
)

print(response.choices[0].message.content)
# Output:
# Debugging at night,
# The bug finally reveals itself,
# Sleep now, it works.
```

### Code Generation

```python
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Write a Python function to find prime numbers"}
    ]
)

print(response.choices[0].message.content)
```

### Reasoning

```python
# Chain-of-thought prompting
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": """
        If I have 3 apples and you give me 5 apples,
        then I give you 2 apples, then you give me 3 apples back.
        How many apples do I have?
        
        Let me think step by step:
        """}
    ]
)
```

---

## Key Concepts

### Tokens

```python
# Everything converted to tokens
# ~4 characters ≈ 1 token
# ~1 word ≈ 1-2 tokens

text = "Hello, world!"
tokens = tokenizer.encode(text)
print(f"Tokens: {tokens}")  # [15496, 11, 1917]

# Count tokens
token_count = len(tokens)
word_count = len(text.split())

print(f"Token count: {token_count}")
print(f"Approximate cost: ${token_count * 0.00001:.6f}")
```

### Context Window

```python
# Maximum input the model can process
limits = {
    "gpt-3.5-turbo": 16_385,
    "gpt-4": 128_256,
    "gpt-4o": 128_256,
    "claude-3.5": 200_000,
}

# 128K tokens ≈ 100K words ≈ 300 pages
```

### Temperature

```python
# Controls randomness
temperature = 0.0  # Almost deterministic (best for factual)
temperature = 0.3  # Slight variation (good for coding)
temperature = 0.7  # Balanced (default)
temperature = 1.0  # Very creative
temperature = 1.5  # Chaotic, unpredictable
```

---

## Using LLM APIs

### OpenAI

```python
from openai import OpenAI

client = OpenAI(api_key="your-api-key")

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is Python?"}
    ],
    temperature=0.7,
    max_tokens=500
)

print(response.choices[0].message.content)
```

### Anthropic

```python
from anthropic import Anthropic

client = Anthropic()

message = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "What is Python?"}
    ]
)

print(message.content[0].text)
```

### Streaming

```python
# Get responses as they're generated
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

---

## When to Use LLMs

| Task | Good Fit | Alternative |
|------|----------|-------------|
| **Creative writing** | ✅ | - |
| **Summarization** | ✅ | - |
| **Q&A with docs** | ✅ (RAG) | Search engine |
| **Classification** | ✅ | Fine-tuned model |
| **Math calculations** | ⚠️ Careful | Calculator |
| **Factual recall** | ⚠️ Verify | Database |
| **Real-time data** | ❌ | API call |

---

## Best Practices

1. **Be specific in prompts**
   ```python
   # Instead of: "Write about AI"
   # Do: "Write a 500-word introduction to AI for beginners"
   ```

2. **Use system prompts**
   ```python
   messages=[
       {"role": "system", "content": "You are a Python expert..."},
       {"role": "user", "content": "..."}
   ]
   ```

3. **Set appropriate temperature**
   ```python
   temperature=0.0  # Factual
   temperature=0.7  # Creative
   ```

4. **Validate outputs**
   ```python
   # Don't trust blindly
   # Verify facts, check format
   ```

---

## Summary

| Concept | Description |
|---------|-------------|
| **LLM** | Neural network trained on text |
| **Tokens** | Text broken into pieces |
| **Context** | Working memory for conversation |
| **Temperature** | Randomness control |
| **Fine-tuning** | Customizing for specific tasks |

**Key insight:** LLMs predict next tokens, learning language patterns from vast text data.

**Next:** Continue to `tokenization-context-windows.md` to understand how text is processed.

---

## References

- [OpenAI Documentation](https://platform.openai.com/docs)
- [Anthropic Documentation](https://docs.anthropic.com/)
- [Hugging Face](https://huggingface.co/)
