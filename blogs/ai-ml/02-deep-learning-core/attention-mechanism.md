---
title: "Attention Mechanism"
description: "Understand the attention mechanism - the core innovation behind transformers that enables modeling long-range dependencies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - Deep Learning
  - Attention
  - Transformers
  - NLP
  - AI
coverImage: "/images/attention-mechanism.png"
draft: false
---

# Attention Mechanism

## Overview

Attention allows models to focus on relevant parts of the input when making predictions. Unlike RNNs that process sequentially, attention connects all positions directly.

**Think of it as:** Looking at the whole sentence and focusing on the words that matter most for your current task.

---

## The Problem Attention Solves

```
RNN Problem: Processing Long Sequences
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  "The cat, which was sleeping on the warm mat, woke up        │
│   when the dog, that had been barking loudly for several       │
│   minutes, finally stopped because..."                         │
│                                                                 │
│  "The cat" ────────────────────────────────────▶ "woke up"     │
│  RNN has forgotten "cat" by the time it reaches "woke up"!    │
│                                                                 │
│  With Attention:                                              │
│                                                                 │
│  "woke up" can directly look at "cat" ────────────────────▶  │
│  Direct connection! No forgetting!                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Attention Mechanism

### Core Idea

```python
# Attention allows every position to attend to every other position

# Three vectors for each input:
# Query (Q): What I'm looking for
# Key (K): What I contain
# Value (V): The actual content

def attention(Q, K, V):
    """
    Q: queries (what each position is looking for)
    K: keys (what each position offers)
    V: values (the actual information)
    """
    # 1. Compute similarity scores
    scores = Q @ K.T  # How similar is each query to each key
    
    # 2. Scale (prevent large values)
    scores = scores / np.sqrt(K.shape[-1])
    
    # 3. Softmax (convert to probabilities)
    weights = softmax(scores)
    
    # 4. Weighted sum
    output = weights @ V
    
    return output, weights
```

---

## Step-by-Step Attention

```
┌─────────────────────────────────────────────────────────────────┐
│              Attention Computation                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 1: Compute Query, Key, Value                             │
│                                                                 │
│    For each word, we compute Q, K, V:                         │
│    ┌──────────────────────────────────────────────────────┐     │
│    │ Word     │    Q (query)    │    K (key)    │    V │     │
│    ├──────────────────────────────────────────────────────┤     │
│    │ The      │    q₁           │    k₁         │   v₁ │     │
│    │ cat      │    q₂           │    k₂         │   v₂ │     │
│    │ sat      │    q₃           │    k₃         │   v₃ │     │
│    └──────────────────────────────────────────────────────┘     │
│                                                                 │
│  Step 2: Attention Scores                                      │
│                                                                 │
│    "cat" looking at all words:                                 │
│    scores = q_cat · [k_The, k_cat, k_sat]                     │
│           = [0.2, 0.9, 0.3]  ← cat relates most to itself    │
│                                                                 │
│  Step 3: Softmax Weights                                       │
│                                                                 │
│    weights = softmax([0.2, 0.9, 0.3])                          │
│            = [0.18, 0.64, 0.18]                                │
│                                                                 │
│  Step 4: Weighted Sum                                          │
│                                                                 │
│    context = 0.18*v₁ + 0.64*v₂ + 0.18*v₃                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Self-Attention Implementation

```python
import numpy as np

def softmax(x):
    exp_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return exp_x / np.sum(exp_x, axis=-1, keepdims=True)

def self_attention(X, d_k):
    """
    X: input embeddings (seq_len, d_model)
    Returns: attended output and attention weights
    """
    seq_len = X.shape[0]
    
    # Learned projections
    W_Q = np.random.randn(X.shape[1], d_k) * 0.02
    W_K = np.random.randn(X.shape[1], d_k) * 0.02
    W_V = np.random.randn(X.shape[1], d_k) * 0.02
    
    # Compute Q, K, V
    Q = X @ W_Q
    K = X @ W_K
    V = X @ W_V
    
    # Attention scores
    scores = Q @ K.T / np.sqrt(d_k)
    
    # Attention weights
    weights = softmax(scores)
    
    # Output
    output = weights @ V
    
    return output, weights

# Example
X = np.random.randn(5, 64)  # 5 words, 64-dim embeddings
output, weights = self_attention(X, d_k=64)

print(f"Output shape: {output.shape}")  # (5, 64)
print(f"Attention weights shape: {weights.shape}")  # (5, 5)
```

---

## Multi-Head Attention

### Why Multiple Heads?

```
┌─────────────────────────────────────────────────────────────────┐
│              Multi-Head Attention                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Each head learns different relationships:                    │
│                                                                 │
│  Head 1: Subject-verb agreement                                │
│    "The cats are sleeping" → "cats" attends to "are"         │
│                                                                 │
│  Head 2: Coreference resolution                                │
│    "The cat sat on the mat. It was tired" → "It"→"cat"        │
│                                                                 │
│  Head 3: Word proximity                                        │
│    Words close together attend more                           │
│                                                                 │
│  Head 4: Semantic similarity                                   │
│    "run" attends to "walk", "jog"                            │
│                                                                 │
│  Combined: All relationships captured!                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Multi-Head Implementation

```python
class MultiHeadAttention:
    def __init__(self, d_model, num_heads):
        self.d_model = d_model
        self.num_heads = num_heads
        self.d_k = d_model // num_heads
        
        # One projection per head
        self.W_Q = [np.random.randn(d_model, self.d_k) * 0.02 
                     for _ in range(num_heads)]
        self.W_K = [np.random.randn(d_model, self.d_k) * 0.02 
                     for _ in range(num_heads)]
        self.W_V = [np.random.randn(d_model, self.d_k) * 0.02 
                     for _ in range(num_heads)]
        self.W_O = np.random.randn(d_model, d_model) * 0.02
    
    def forward(self, X):
        outputs = []
        weights_all = []
        
        # Compute attention for each head
        for i in range(self.num_heads):
            Q = X @ self.W_Q[i]
            K = X @ self.W_K[i]
            V = X @ self.W_V[i]
            
            # Attention
            scores = Q @ K.T / np.sqrt(self.d_k)
            weights = softmax(scores)
            head_output = weights @ V
            
            outputs.append(head_output)
            weights_all.append(weights)
        
        # Concatenate all heads
        concat = np.concatenate(outputs, axis=-1)
        
        # Final projection
        output = concat @ self.W_O
        
        return output, weights_all
```

---

## Attention Patterns

```
┌─────────────────────────────────────────────────────────────────┐
│              Attention Patterns                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Self-Attention (Transformer):                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ All positions can attend to all positions!              │    │
│  │ Fully connected!                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  RNN:                                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Can only attend to previous positions (causal)         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  CNN:                                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Can only attend within a window (receptive field)      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Advantage of Attention: No sequential computation!           │
│  Can parallelize across positions!                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Types of Attention

### 1. Self-Attention

```python
# Tokens attend to other tokens in the SAME sequence
# Q, K, V all come from the same input

# Used inside transformers
output = self_attention(X, X, X)  # Q=X, K=X, V=X
```

### 2. Cross-Attention

```python
# Tokens attend to tokens in a DIFFERENT sequence
# Q from one sequence, K, V from another

# Used in encoder-decoder for translation:
# decoder attends to encoder outputs
output = cross_attention(decoder_input, encoder_output)
```

### 3. Causal (Masked) Attention

```python
# For autoregressive models (text generation)
# Can only attend to previous positions, not future

# Mask future positions
def masked_attention(Q, K, V, mask):
    scores = Q @ K.T / np.sqrt(K.shape[-1])
    scores = scores.masked_fill(mask == 0, -1e9)
    weights = softmax(scores)
    return weights @ V
```

---

## Practical Example: Attention Weights Visualization

```python
# Example: Attention for "The cat sat on the mat"

words = ["The", "cat", "sat", "on", "the", "mat"]
n = len(words)

# Hypothetical attention from "cat"
cat_attention = {
    "The": 0.05,
    "cat": 0.85,  # Self-attention strongest
    "sat": 0.03,
    "on": 0.02,
    "the": 0.03,
    "mat": 0.02
}

print("Attention from 'cat':")
for word, weight in cat_attention.items():
    bar = "█" * int(weight * 30)
    print(f"  cat → {word:6s}: {weight:.2f} {bar}")
```

---

## Attention vs RNNs

| Aspect | RNN | Attention |
|--------|-----|-----------|
| **Connections** | Sequential | All-to-all |
| **Long dependencies** | Hard (vanishing gradients) | Easy (direct connections) |
| **Parallelization** | Sequential (slow) | Fully parallel (fast) |
| **Memory** | Compressed into hidden state | Stores all positions |
| **Complexity** | O(n) | O(n²) |

---

## Summary

| Concept | Description |
|---------|-------------|
| **Attention** | Focus on relevant parts of input |
| **Query** | What we're looking for |
| **Key** | What each position offers to match queries |
| **Value** | The actual content to attend to |
| **Self-Attention** | Attention within the same sequence |
| **Multi-Head** | Multiple attention patterns in parallel |

**Key insight:** Attention directly connects all positions, solving RNN's long-range dependency problem while enabling parallel computation.

**Next:** Continue to `transformers-architecture.md` to learn how transformers combine attention with other components.

---

## References

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Jay Alammar's Attention Guide](https://jalammar.github.io/illustrated-transformer/)
- [Attention Types](https://lilianweng.github.io/posts/2018-06-24-attention/)