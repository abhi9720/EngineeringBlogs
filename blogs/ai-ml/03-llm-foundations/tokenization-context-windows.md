---
title: Tokenization and Context Windows
description: >-
  Understand how LLMs process text - tokenization, subword algorithms, and
  context window limits
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Tokenization
  - Context Window
  - NLP
  - AI
coverImage: /images/tokenization-context-windows.png
draft: false
order: 40
---
# Tokenization and Context Windows

## Overview

Before LLMs can process text, it must be converted into tokens. Understanding tokenization and context windows is essential for effective LLM usage.

**Think of it as:** Breaking words into "puzzle pieces" the model can understand.

---

## What is Tokenization?

```
┌─────────────────────────────────────────────────────────────────┐
│              Tokenization Process                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input Text:                                                    │
│  "Hello, world!"                                               │
│                                                                 │
│  Tokenized:                                                    │
│  ["Hello", ",", " world", "!"]                                │
│                                                                 │
│  Token IDs:                                                    │
│  [15496, 11, 1917, 0]                                         │
│                                                                 │
│  ~4 characters ≈ 1 token                                       │
│  ~1 word ≈ 1-2 tokens                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Not Just Use Words?

```python
# Problems with word tokenization:

# 1. Huge vocabulary
# English has 1M+ words
vocab_size = 1_000_000  # Impossible to handle

# 2. Out-of-vocabulary (OOV)
# Model can't handle unseen words
# "LLM" in 2018 → unknown!

# 3. Rare words
# "pneumonoultramicroscopicsilicovolcanoconiosis"
# Should be broken into parts
```

---

## Tokenization Algorithms

### 1. Byte Pair Encoding (BPE)

Most LLMs use BPE or similar algorithms:

```python
# BPE merges most frequent pairs iteratively

# Start with character-level tokens
text = "hello"
chars = ['h', 'e', 'l', 'l', 'o']

# Step 1: Count pairs
pairs = {
    ('h', 'e'): 1,
    ('e', 'l'): 2,  # Most common!
    ('l', 'l'): 1,
    ('l', 'o'): 1
}

# Step 2: Merge most common pair ('e', 'l')
# Result: ['he', 'l', 'l', 'o']

# Repeat until desired vocab size
```

### 2. WordPiece (Used by BERT)

```python
# Builds vocabulary from frequent subwords
# Prefers longer subwords when possible

# "unhappiness" → ["un", "happ", "i", "ness"]
# Keeps known subwords together
```

### 3. SentencePiece (Used by many models)

```python
# Treats spaces as characters
# Works for any language
# Handles unknown scripts well
```

---

## Tokenization in Practice

### Using Tiktoken (OpenAI)

```python
import tiktoken

# For GPT-4 and GPT-3.5
enc = tiktoken.get_encoding("cl100k_base")

text = "The quick brown fox jumps over the lazy dog"

tokens = enc.encode(text)
print(f"Tokens: {tokens}")
print(f"Token count: {len(tokens)}")
print(f"Text length: {len(text)}")

# Decode back
decoded = enc.decode(tokens)
print(f"Decoded: {decoded}")
```

### Counting Tokens

```python
def count_tokens(text, model="gpt-4"):
    enc = tiktoken.encoding_for_model(model)
    return len(enc.encode(text))

# Rough estimates
rough_estimates = {
    "1 character": 1/4,
    "1 word English": 1.3,
    "1 word with spaces": 0.75,
}

text = "Hello world"
word_count = len(text.split())
token_estimate = word_count * 1.3

print(f"Words: {word_count}")
print(f"Estimated tokens: {token_estimate}")
```

### Token Calculator

```python
def estimate_cost(text, model="gpt-4o-mini"):
    """Estimate cost for API call"""
    
    token_count = count_tokens(text)
    
    costs_per_1M = {
        "gpt-4o": {"input": 2.5, "output": 10.0},
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-4": {"input": 30.0, "output": 60.0},
    }
    
    cost = costs_per_1M[model]
    
    return {
        "tokens": token_count,
        "input_cost": token_count / 1_000_000 * cost["input"],
        "output_cost_estimate": token_count / 1_000_000 * cost["output"]
    }

result = estimate_cost("Hello, how are you today?")
print(f"Tokens: {result['tokens']}")
print(f"Cost: ${result['input_cost']:.6f}")
```

---

## Context Windows

```
┌─────────────────────────────────────────────────────────────────┐
│              Context Window Explained                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Model: 4K context                                             │
│  ┌────────────────────────────────────────────────────┐       │
│  │  4,096 tokens maximum input!                       │       │
│  └────────────────────────────────────────────────────┘       │
│                                                                 │
│  Model: 128K context                                          │
│  ┌────────────────────────────────────────────────────┐       │
│  │  128,000 tokens = ~100,000 words = 300 pages!     │       │
│  └────────────────────────────────────────────────────┘       │
│                                                                 │
│  Context = Working memory for the conversation                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Common Context Limits

| Model | Context | Approx Pages |
|-------|---------|--------------|
| GPT-3.5-turbo | 16K | 24 pages |
| GPT-4 | 8K-32K | 12-48 pages |
| GPT-4 Turbo | 128K | 192 pages |
| Claude 3 | 200K | 300 pages |
| Gemini 1.5 | 1M-10M | 1500-15000 pages |

---

## Working with Context Limits

### Truncation Strategy

```python
def truncate_to_fit(text, max_tokens, enc):
    """Truncate text to fit within context"""
    
    tokens = enc.encode(text)
    
    if len(tokens) <= max_tokens:
        return text
    
    tokens = tokens[:max_tokens]
    return enc.decode(tokens)

# Usage
enc = tiktoken.get_encoding("cl100k_base")
max_tokens = 1000

truncated = truncate_to_fit(long_document, max_tokens, enc)
```

### Summarization Strategy

```python
def chunk_and_summarize(text, max_tokens, model):
    """Handle long documents by chunking"""
    
    # Split into chunks
    chunks = split_into_chunks(text, max_tokens * 4)  # Rough char estimate
    
    summaries = []
    for chunk in chunks:
        # Summarize each chunk
        response = openai.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": f"Summarize this:\n\n{chunk}"}
            ]
        )
        summaries.append(response.choices[0].message.content)
    
    # Combine summaries
    return "\n\n".join(summaries)
```

---

## Context Window Challenges

### Lost in the Middle

```python
# Research shows: Models struggle with information in the middle

# Good: Put important info at start or end
# Bad: Important info buried in middle

# Strategy for long documents:
important_info = """
KEY FINDINGS:
1. Results are significant at p < 0.05
2. Sample size was 1000 participants
"""

prompt = f"""
{important_info}

[Then 50 pages of detailed methodology...]

Based on the key findings above, answer:
What was the sample size and significance level?
"""
```

### Memory Optimization

```python
# Reduce token usage:

# Bad
messages = [
    {"role": "assistant", "content": very_long_response},
    {"role": "assistant", "content": another_long_response},
]

# Better: Summarize conversation periodically
messages = [
    {"role": "system", "content": "Summary: User is analyzing data..."}
]
```

---

## Best Practices

1. **Estimate before API call**
   ```python
   tokens = count_tokens(my_text)
   if tokens > max_context:
       # Handle overflow
   ```

2. **Put key info at start or end**
   ```python
   # Important: Use zero-shot at beginning
   prompt = "IMPORTANT: [task]. Context: [details]"
   ```

3. **Count tokens accurately**
   ```python
   # Use tiktoken for accurate counting
   ```

---

## Summary

| Concept | Description |
|---------|-------------|
| **Token** | Text broken into pieces (~4 chars each) |
| **Tokenization** | Converting text to token IDs |
| **BPE** | Common tokenization algorithm |
| **Context Window** | Maximum input the model can process |
| **Chunking** | Breaking long text into manageable pieces |

**Key insight:** LLMs process text as tokens, and the context window limits how much can be processed at once.

**Next:** Continue to `embeddings-explained.md` to learn about vector representations.

---

## References

- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
- [Tiktoken](https://github.com/openai/tiktoken)
- [BPE Paper](https://arxiv.org/abs/1508.07909)
