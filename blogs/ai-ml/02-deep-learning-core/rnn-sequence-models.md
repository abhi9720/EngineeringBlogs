---
title: RNN Sequence Models
description: >-
  Master RNNs, LSTMs, and GRUs for processing sequential data - text, time
  series, and more
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Deep Learning
  - RNN
  - LSTM
  - GRU
  - Sequence Models
  - NLP
coverImage: /images/rnn-sequence-models.png
draft: false
order: 60
---
# RNN Sequence Models

## Overview

Recurrent Neural Networks (RNNs) process sequential data where order matters. They maintain "memory" of previous inputs to understand context.

**Think of it as:** Reading a sentence word by word while remembering what you read before.

---

## Why RNNs for Sequences?

```
Image (order doesn't matter):      Text (order matters):
[A][B][C][D]                       "The" → "cat" → "sat"
Any order → same result            Different order → different meaning

Traditional NN: treats all inputs independently
RNN: processes sequentially, remembers context
```

---

## RNN Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              RNN: Processing Sequences                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Timestep 0       Timestep 1       Timestep 2                  │
│                                                                 │
│    x₀   ──▶┐                                                   │
│           │                                                    │
│       ┌───┴───┐                                                │
│       │       │                                                │
│       │  h₀   │                                                │
│       │       │                                                │
│       └───┬───┘                                                │
│           │                                                    │
│           ▼                                                    │
│    x₁   ──▶┐                                                   │
│           │                                                    │
│       ┌───┴───┐                                                │
│       │       │                                                │
│       │  h₁   │ ← Remembers context from previous steps        │
│       │       │                                                │
│       └───┬───┘                                                │
│           │                                                    │
│           ▼                                                    │
│    x₂   ──▶┐                                                   │
│           │                                                    │
│       ┌───┴───┐                                                │
│       │       │                                                │
│       │  h₂   │                                                │
│       │       │                                                │
│       └───┬───┘                                                │
│           │                                                    │
│           ▼                                                    │
│        Output                                                 │
│                                                                 │
│  h_t = f(h_{t-1}, x_t)  ← Recurrence relation                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Simple RNN Implementation

```python
import numpy as np

class SimpleRNN:
    def __init__(self, input_size, hidden_size, output_size):
        scale = 0.1
        
        # Weights
        self.Wxh = np.random.randn(hidden_size, input_size) * scale
        self.Whh = np.random.randn(hidden_size, hidden_size) * scale
        self.Why = np.random.randn(output_size, hidden_size) * scale
        
        # Biases
        self.bh = np.zeros((hidden_size, 1))
        self.by = np.zeros((output_size, 1))
    
    def tanh(self, x):
        return np.tanh(x)
    
    def forward(self, X):
        """X: (seq_length, input_size)"""
        T = len(X)
        H = self.Whh.shape[0]
        
        # Initialize hidden state
        h = np.zeros((H, 1))
        self.hidden_states = [h.copy()]
        
        # Process sequence
        for t in range(T):
            x_t = X[t].reshape(-1, 1)
            
            # Update hidden state
            h = self.tanh(self.Wxh @ x_t + self.Whh @ h + self.bh)
            self.hidden_states.append(h.copy())
        
        # Output
        y = self.Why @ h + self.by
        return y

# Example: Predict next number in sequence
rnn = SimpleRNN(input_size=1, hidden_size=8, output_size=1)

# Sequence: [1, 2, 3, 4, 5] → predict [6]
X = np.array([[1], [2], [3], [4], [5]], dtype=float)
output = rnn.forward(X)
print(f"Predicted next: {output[0, 0]:.2f}")  # Should be close to 6
```

---

## The Problem: Vanishing Gradients

```python
# When backpropagating through time, gradients shrink exponentially
# Long sequences → gradients become zero

# "The cat that the dog that the child that the man...chased ran"
#          ↑                                        ↑
# Gradient vanishes here! Can't learn this dependency.

# Solution: LSTM or GRU
```

---

## LSTM: Long Short-Term Memory

### Gate Mechanisms

```python
class LSTMCell:
    def __init__(self, input_size, hidden_size):
        # Gates: input, forget, output
        self.Wi = np.random.randn(hidden_size, input_size) * 0.1
        self.Wf = np.random.randn(hidden_size, input_size) * 0.1
        self.Wo = np.random.randn(hidden_size, input_size) * 0.1
        self.Wc = np.random.randn(hidden_size, input_size) * 0.1
        
        self.Ui = np.random.randn(hidden_size, hidden_size) * 0.1
        self.Uf = np.random.randn(hidden_size, hidden_size) * 0.1
        self.Uo = np.random.randn(hidden_size, hidden_size) * 0.1
        self.Uc = np.random.randn(hidden_size, hidden_size) * 0.1
        
        self.bi = np.zeros((hidden_size, 1))
        self.bf = np.zeros((hidden_size, 1))
        self.bo = np.zeros((hidden_size, 1))
        self.bc = np.zeros((hidden_size, 1))
    
    def sigmoid(self, x):
        return 1 / (1 + np.exp(-x))
    
    def forward(self, x_t, h_prev, c_prev):
        # Input gate: what to remember
        i = self.sigmoid(self.Wi @ x_t + self.Ui @ h_prev + self.bi)
        
        # Forget gate: what to forget
        f = self.sigmoid(self.Wf @ x_t + self.Uf @ h_prev + self.bf)
        
        # Output gate: what to output
        o = self.sigmoid(self.Wo @ x_t + self.Uo @ h_prev + self.bo)
        
        # Cell candidate: new information
        c_tilde = self.tanh(self.Wc @ x_t + self.Uc @ h_prev + self.bc)
        
        # Cell state: long-term memory
        c = f * c_prev + i * c_tilde
        
        # Hidden state: short-term memory
        h = o * self.tanh(c)
        
        return h, c
```

### LSTM Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│              LSTM Cell                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Cell State (Long-term Memory):                                │
│  ┌────────────────────────────────────────────────────────┐     │
│  │   Previous ──×(forget)── +─×(input)──▶ Next Cell      │     │
│  │   c_prev                     c_tilde                  │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
│  Gates:                                                         │
│  • Input gate: What new info to remember                        │
│  • Forget gate: What to throw away                             │
│  • Output gate: What to output                                  │
│                                                                 │
│  This allows learning long-term dependencies!                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## GRU: Gated Recurrent Unit

### Simplified LSTM

```python
# GRU has fewer gates than LSTM:
# - Update gate: combines input + forget (merges them)
# - Reset gate: decides what to forget from past

# Pros: Faster, fewer parameters
# Cons: May not capture as long dependencies

class GRUCell:
    def forward(self, x_t, h_prev):
        # Update gate: how much past to keep
        z = sigmoid(Wz @ x_t + Uz @ h_prev + bz)
        
        # Reset gate: how much past to forget
        r = sigmoid(Wr @ x_t + Ur @ h_prev + br)
        
        # Candidate hidden state
        h_tilde = tanh(Wh @ x_t + Uh @ (r * h_prev) + bh)
        
        # New hidden state
        h = (1 - z) * h_prev + z * h_tilde
        
        return h
```

### LSTM vs GRU

| Aspect | LSTM | GRU |
|--------|------|-----|
| Gates | 3 (input, forget, output) | 2 (update, reset) |
| Parameters | More | Fewer |
| Speed | Slower | Faster |
| Memory | Better for very long sequences | Often comparable |
| When to use | Need maximum memory capacity | Want faster training |

---

## Using RNNs in Keras

### Text Classification with LSTM

```python
from tensorflow.keras import layers, models

model = models.Sequential([
    # Embedding: words → vectors
    layers.Embedding(
        input_dim=10000,  # vocab size
        output_dim=64,    # embedding dimension
        input_length=100   # max sequence length
    ),
    
    # LSTM layer
    layers.LSTM(64, dropout=0.2, recurrent_dropout=0.2),
    
    # Classification
    layers.Dense(32, activation='relu'),
    layers.Dropout(0.5),
    layers.Dense(1, activation='sigmoid')
])

model.compile(
    optimizer='adam',
    loss='binary_crossentropy',
    metrics=['accuracy']
)

# Train
model.fit(X_train, y_train, epochs=10, batch_size=64)
```

### Bidirectional LSTM

```python
from tensorflow.keras.layers import Bidirectional

model = models.Sequential([
    layers.Embedding(10000, 64),
    
    # Bidirectional: processes sequence both directions
    Bidirectional(
        layers.LSTM(32, return_sequences=True)
    ),
    
    Bidirectional(
        layers.LSTM(32)
    ),
    
    layers.Dense(1, activation='sigmoid')
])

# Better for tasks where context from both directions matters
# Example: "I felt happy [] the good news"
# Need both past and future context
```

### Stacked RNN Layers

```python
model = models.Sequential([
    layers.Embedding(10000, 64),
    
    layers.LSTM(64, return_sequences=True),  # Return full sequence
    layers.Dropout(0.2),
    
    layers.LSTM(32, return_sequences=True),
    layers.Dropout(0.2),
    
    layers.LSTM(16),
    
    layers.Dense(1, activation='sigmoid')
])
```

---

## Sequence-to-Sequence Models

### Encoder-Decoder for Translation

```python
from tensorflow.keras import layers, Model

# Encoder
encoder_inputs = layers.Input(shape=(None, 10000))
encoder = layers.LSTM(64, return_state=True)
_, state_h, state_c = encoder(encoder_inputs)
encoder_states = [state_h, state_c]

# Decoder
decoder_inputs = layers.Input(shape=(None, 10000))
decoder = layers.LSTM(64, return_sequences=True)
decoder_outputs, _, _ = decoder(decoder_inputs, initial_state=encoder_states)

# Output
decoder_dense = layers.Dense(10000, activation='softmax')
outputs = decoder_dense(decoder_outputs)

model = Model([encoder_inputs, decoder_inputs], outputs)
```

---

## Common Use Cases

| Task | Input Type | Output Type |
|------|------------|-------------|
| **Sentiment Analysis** | Text | Positive/Negative |
| **Time Series Forecasting** | Numbers | Next number |
| **Machine Translation** | Text in language A | Text in language B |
| **Speech Recognition** | Audio | Text |
| **Text Generation** | Words | Next word |
| **Video Classification** | Frame sequence | Action label |

---

## Best Practices

1. **Use Bidirectional for Text**
   ```python
   Bidirectional(LSTM(64))
   ```

2. **Add Dropout**
   ```python
   layers.LSTM(64, dropout=0.2, recurrent_dropout=0.2)
   ```

3. **Use GRU for Speed**
   ```python
   layers.GRU(64)  # Faster than LSTM
   ```

4. **Truncate Long Sequences**
   ```python
   # Limit to 200-500 timesteps
   # Longer sequences don't learn well
   ```

5. **Mask Padding**
   ```python
   layers.Masking(mask_value=0)
   ```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Too long sequences** | Vanishing gradients | Truncate or use attention |
| **No dropout** | Overfitting | Add dropout |
| **Forgetting masking** | Padding affects results | Add masking layer |
| **Wrong return_sequences** | Wrong output shape | Check for stacking |
| **Stacking too many** | Slow, not better | 2-3 layers max |

---

## Summary

| Model | Best For | Pros |
|-------|----------|------|
| **Simple RNN** | Very short sequences | Fast |
| **LSTM** | Long sequences | Best memory |
| **GRU** | Medium sequences | Fast, good performance |
| **Bidirectional** | Text, any task | Better context |

**Key insight:** LSTMs and GRUs solve the vanishing gradient problem, enabling learning of long-range dependencies.

**Next:** Continue to `attention-mechanism.md` to understand attention, the key innovation behind transformers.

---

## References

- [Keras RNN Guide](https://keras.io/api/layers/recurrent_layers/)
- [LSTM Understanding](http://colah.github.io/posts/2015-08-Understanding-LSTMs/)
- [Sequence Models Course](https://www.coursera.org/learn/nlp-sequence-models)
