---
title: Transformers Architecture
description: >-
  Master the transformer architecture - attention, positional encoding, and
  building transformer models
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Deep Learning
  - Transformers
  - Attention
  - BERT
  - GPT
  - NLP
coverImage: /images/transformers-architecture.png
draft: false
order: 70
---
# Transformers Architecture

## Overview

Transformers are the architecture behind modern language models like GPT, BERT, and their successors. They use self-attention to process sequences in parallel, achieving unprecedented performance on language tasks.

**Think of it as:** Reading an entire paragraph at once and instantly understanding which words relate to which.

---

## From RNN to Transformer

```
┌─────────────────────────────────────────────────────────────────┐
│              Evolution of Sequence Models                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  RNN: Sequential Processing                                     │
│  "The" → "cat" → "sat" → "on" → "the" → "mat"                │
│       Sequential - slow - forgets distant words                │
│                                                                 │
│  LSTM/GRU: Better Memory                                       │
│       Gates help remember longer                               │
│       Still sequential                                        │
│                                                                 │
│  Transformer: Parallel Processing                               │
│       All words processed simultaneously!                       │
│       Attention connects everything directly                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Transformer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Transformer Encoder                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input: "The cat sat on the mat"                               │
│     │                                                           │
│     ▼                                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Input Embeddings + Positional Encoding       │    │
│  └─────────────────────────────────────────────────────────┘    │
│     │                                                           │
│     ▼                                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │         Transformer Encoder Block × N                    │    │
│  │                                                         │    │
│  │  ┌──────────────┐    ┌──────────────────────────┐      │    │
│  │  │  Multi-Head  │───▶│  Feed Forward Network   │      │    │
│  │  │  Self-Attn   │    │  (2-layer MLP)          │      │    │
│  │  └──────┬───────┘    └──────────────────────────┘      │    │
│  │         │                                              │    │
│  │         ▼                                              │    │
│  │  ┌──────────────┐    ┌──────────────────────────┐      │    │
│  │  │  Add & Norm  │───▶│  Add & Norm             │      │    │
│  │  │  (Residual)   │    │  (Residual)             │      │    │
│  │  └──────────────┘    └──────────────────────────┘      │    │
│  └─────────────────────────────────────────────────────────┘    │
│     │                                                           │
│     ▼                                                           │
│  Output: Contextual embeddings for each position               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Positional Encoding

### Why Position Matters

```python
# Without position: "cat sat cat sat" - ambiguous
# With position: "cat(1) sat(2) cat(3) sat(4)" - clear

def positional_encoding(seq_len, d_model):
    """
    Create position embeddings using sin/cos
    """
    PE = np.zeros((seq_len, d_model))
    
    positions = np.arange(seq_len).reshape(-1, 1)
    div_term = np.exp(
        np.arange(0, d_model, 2) * (-np.log(10000) / d_model)
    )
    
    PE[:, 0::2] = np.sin(positions * div_term)
    PE[:, 1::2] = np.cos(positions * div_term)
    
    return PE

# Each position gets a unique encoding
# Sin/cos allows model to learn relative positions
```

### Adding Position to Embeddings

```python
# Input embedding + Positional encoding
input_embedding = word_embeddings(word_ids)  # e.g., shape (seq_len, 512)
position_encoding = positional_encoding(seq_len, d_model=512)

# Add them
input_with_position = input_embedding + position_encoding
```

---

## Multi-Head Attention in Transformers

```python
import numpy as np

def softmax(x):
    exp_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return exp_x / np.sum(exp_x, axis=-1, keepdims=True)

class MultiHeadAttention:
    def __init__(self, d_model, num_heads):
        self.d_model = d_model
        self.num_heads = num_heads
        self.d_k = d_model // num_heads
        
        # Projections
        self.W_Q = np.random.randn(d_model, d_model) * 0.02
        self.W_K = np.random.randn(d_model, d_model) * 0.02
        self.W_V = np.random.randn(d_model, d_model) * 0.02
        self.W_O = np.random.randn(d_model, d_model) * 0.02
    
    def split_heads(self, X):
        """Split d_model into num_heads"""
        batch, seq_len, _ = X.shape
        X = X.reshape(batch, seq_len, self.num_heads, self.d_k)
        return X.transpose(0, 2, 1, 3)  # (batch, heads, seq, d_k)
    
    def forward(self, Q, K, V, mask=None):
        batch = Q.shape[0]
        
        # Linear projections
        Q = (Q @ self.W_Q)
        K = (K @ self.W_K)
        V = (V @ self.W_V)
        
        # Split into heads
        Q = self.split_heads(Q)
        K = self.split_heads(K)
        V = self.split_heads(V)
        
        # Attention
        scores = Q @ K.transpose(0, 1, 3, 2) / np.sqrt(self.d_k)
        
        if mask is not None:
            scores = scores.masked_fill(mask == 0, -1e9)
        
        weights = softmax(scores)
        attention = weights @ V
        
        # Concatenate heads
        attention = attention.transpose(0, 2, 1, 3).reshape(
            batch, -1, self.d_model
        )
        
        # Final linear
        output = attention @ self.W_O
        
        return output, weights
```

---

## Feed Forward Network

```python
class FeedForward:
    def __init__(self, d_model, d_ff):
        self.W1 = np.random.randn(d_model, d_ff) * 0.02
        self.W2 = np.random.randn(d_ff, d_model) * 0.02
        self.b1 = np.zeros((1, d_ff))
        self.b2 = np.zeros((1, d_model))
    
    def forward(self, x):
        # Inner layer: expand dimension
        hidden = np.maximum(0, x @ self.W1 + self.b1)  # ReLU
        
        # Outer layer: compress back
        output = hidden @ self.W2 + self.b2
        
        return output
```

---

## Encoder vs Decoder

```
┌─────────────────────────────────────────────────────────────────┐
│              Encoder vs Decoder                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Encoder (BERT-style):                                         │
│  - Processes input sequence                                    │
│  - Uses bidirectional attention (can see both left and right)  │
│  - Output: contextualized representations                       │
│  - Use: Classification, extraction, tagging                  │
│                                                                 │
│  Decoder (GPT-style):                                          │
│  - Generates output autoregressively                           │
│  - Uses masked attention (can only see past)                   │
│  - Processes previously generated + encoder output             │
│  - Use: Text generation, translation                           │
│                                                                 │
│  Full Transformer:                                              │
│  - Encoder processes input                                     │
│  - Decoder attends to encoder output                           │
│  - Use: Translation, summarization                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Building Transformer in Keras

```python
from tensorflow.keras import layers, Model

class TransformerBlock(layers.Layer):
    def __init__(self, d_model, num_heads, d_ff, dropout=0.1):
        super().__init__()
        
        self.attention = layers.MultiHeadAttention(
            num_heads, d_model // num_heads
        )
        self.ffn = Model([
            layers.Input(shape=(None, d_model)),
            layers.Dense(d_ff, activation='relu'),
            layers.Dense(d_model),
        ])
        
        self.layernorm1 = layers.LayerNormalization()
        self.layernorm2 = layers.LayerNormalization()
        self.dropout1 = layers.Dropout(dropout)
        self.dropout2 = layers.Dropout(dropout)
    
    def call(self, x, training=False, mask=None):
        # Multi-head attention with residual
        attn_output, _ = self.attention(x, x, mask=mask)
        x = self.layernorm1(x + self.dropout1(attn_output, training=training))
        
        # Feed forward with residual
        ffn_output = self.ffn(x)
        x = self.layernorm2(x + self.dropout2(ffn_output, training=training))
        
        return x

# Complete encoder
model = Sequential([
    layers.Input(shape=(None, d_model)),
    PositionalEmbedding(vocab_size, d_model),
    TransformerBlock(d_model, num_heads, d_ff),
    TransformerBlock(d_model, num_heads, d_ff),
    TransformerBlock(d_model, num_heads, d_ff),
    layers.GlobalAveragePooling1D(),
    layers.Dense(1, activation='sigmoid')
])
```

---

## BERT: Encoder Model

```python
from transformers import TFBertModel, BertTokenizer

# Load pre-trained BERT
tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
bert = TFBertModel.from_pretrained('bert-base-uncased')

# Tokenize
inputs = tokenizer(
    "The cat sat on the mat",
    return_tensors='tf',
    padding=True,
    truncation=True
)

# Get embeddings
outputs = bert(inputs)
pooled_output = outputs.pooler_output  # [CLS] token representation
sequence_output = outputs.last_hidden_state  # All token representations

# Fine-tune for classification
x = layers.Dense(128, activation='relu')(pooled_output)
x = layers.Dropout(0.2)(x)
output = layers.Dense(1, activation='sigmoid')(x)

model = Model(inputs=inputs.input_ids, outputs=output)
model.compile(optimizer='adam', loss='binary_crossentropy')
```

---

## GPT: Decoder Model

```python
from transformers import TFGPT2Model, GPT2Tokenizer

# Load GPT-2
tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
gpt = TFGPT2Model.from_pretrained('gpt2')
gpt.config.pad_token_id = tokenizer.eos_token_id

# Generate text
def generate_text(prompt, max_length=50, temperature=0.7):
    inputs = tokenizer(prompt, return_tensors='tf')
    
    outputs = gpt.generate(
        inputs['input_ids'],
        max_length=max_length,
        temperature=temperature,
        num_return_sequences=1,
        pad_token_id=tokenizer.eos_token_id
    )
    
    return tokenizer.decode(outputs[0], skip_special_tokens=True)

print(generate_text("The future of AI is"))
```

---

## Model Sizes

| Model | Parameters | Architecture | Released |
|-------|-----------|--------------|----------|
| **BERT-base** | 110M | Encoder | 2018 |
| **GPT-2** | 1.5B | Decoder | 2019 |
| **GPT-3** | 175B | Decoder | 2020 |
| **T5** | 11B | Encoder-Decoder | 2020 |
| **GPT-4** | ~1.7T (expert) | Decoder | 2023 |
| **Llama 3** | 8B-70B | Decoder | 2024 |

---

## Best Practices

1. **Use Pre-trained Models**
   ```python
   model = TFBertModel.from_pretrained('bert-base-uncased')
   ```

2. **Appropriate Tokenization**
   ```python
   tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
   inputs = tokenizer(text, padding=True, truncation=True)
   ```

3. **Set Correct Sequence Length**
   ```python
   max_length = 512  # BERT's limit
   ```

4. **Learning Rate**
   ```python
   # Use warm-up for transformers
   optimizer = AdamWeightDecay(learning_rate=1e-5)
   ```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Wrong tokenizer** | Broken embeddings | Use matching tokenizer |
| **Missing masking** | Attention to padding | Add attention mask |
| **Position indexing** | Off-by-one errors | Start from 0 |
| **Context length exceeded** | Truncated input | Truncate or use longer context model |

---

## Summary

| Component | Purpose |
|-----------|---------|
| **Self-Attention** | Connect all positions directly |
| **Multi-Head** | Learn multiple relationship types |
| **Positional Encoding** | Add order information |
| **Feed Forward** | Process each position independently |
| **Residual Connections** | Enable deep networks |
| **Layer Norm** | Stabilize training |

**Key insight:** Transformers replace sequential processing with parallel attention, enabling both better performance and faster training.

**Next:** Continue to `embeddings-in-deep-learning.md` to understand how transformers represent meaning.

---

## References

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Hugging Face Transformers](https://huggingface.co/transformers/)
- [BERT Paper](https://arxiv.org/abs/1810.04805)
- [GPT Paper](https://s3-us-west-2.amazonaws.com/openai-assets/research-covers/language-unsupervised/language_understanding_paper.pdf)
