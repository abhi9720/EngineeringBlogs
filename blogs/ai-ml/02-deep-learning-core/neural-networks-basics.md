---
title: Neural Networks Basics
description: >-
  Understand neural networks from scratch - neurons, layers, activation
  functions, and building your first ANN
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Deep Learning
  - Neural Networks
  - AI
  - Fundamentals
  - Perceptron
coverImage: /images/neural-networks-basics.png
draft: false
order: 50
---
# Neural Networks Basics

## Overview

Neural networks are computing systems inspired by biological brains. They consist of interconnected nodes (neurons) organized in layers that learn to solve problems by adjusting connection strengths.

**Think of it as:** Many simple processors (neurons) working together to solve complex problems.

---

## The Biological Inspiration

```
┌─────────────────────────────────────────────────────────────────┐
│              From Brain to Computer                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Biological Brain:                Artificial Neural Network:   │
│                                                                 │
│  Neuron:                        Neuron:                       │
│  ┌──────────────┐               ┌──────────────┐              │
│  │   Inputs    │               │   Inputs     │              │
│  │ (dendrites) │               │  x₁, x₂, x₃ │              │
│  └──────┬───────┘               └──────┬───────┘              │
│         │                              │                      │
│  ┌──────┴───────┐               ┌──────┴───────┐              │
│  │  Processing  │               │  Σ + Activation│              │
│  │   (soma)     │               │  w₁x₁ + w₂x₂ + b │              │
│  └──────┬───────┘               └──────┬───────┘              │
│         │                              │                      │
│  ┌──────┴───────┐               ┌──────┴───────┐              │
│  │    Output    │               │    Output    │              │
│  │   (axon)     │               │     y        │              │
│  └──────────────┘               └──────────────┘              │
│                                                                 │
│  Many neurons connected → Many weights → Complex patterns     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Artificial Neuron

### The Math

```python
# One neuron computation
import numpy as np

def neuron(inputs, weights, bias):
    """
    inputs: [x1, x2, x3, ...]
    weights: [w1, w2, w3, ...]
    bias: scalar
    
    output = activation(sum(x_i * w_i) + bias)
    """
    weighted_sum = np.dot(inputs, weights) + bias
    output = activation(weighted_sum)
    return output

# Example: Simple AND gate
inputs = np.array([1, 1])
weights = np.array([0.5, 0.5])
bias = -0.75

output = neuron(inputs, weights, bias)
print(f"AND(1,1) = {output:.1f}")  # 0.25 < 0.5 → 0
```

### Activation Functions

```python
import numpy as np

# Step function (binary)
def step(x):
    return 1 if x >= 0 else 0

# Sigmoid (smooth, 0 to 1)
def sigmoid(x):
    return 1 / (1 + np.exp(-x))

# ReLU (most popular)
def relu(x):
    return max(0, x)

# Tanh (-1 to 1)
def tanh(x):
    return np.tanh(x)

# Softmax (for multi-class output)
def softmax(x):
    exp_x = np.exp(x - np.max(x))
    return exp_x / np.sum(exp_x)
```

---

## Neural Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Neural Network Structure                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Input Layer      Hidden Layers         Output Layer           │
│   (Features)       (Learn Patterns)      (Predictions)           │
│                                                                 │
│      x₁ ────────▶ ○ ───────▶ ○ ───────▶ ○                       │
│                  ││         ││         ││                        │
│      x₂ ────────▶ ○ ───────▶ ○ ───────▶ ○                       │
│                  ││         ││         ││                        │
│      x₃ ────────▶ ○ ───────▶ ○ ───────▶ y₁                      │
│                  ││         ││                                   │
│                   ││        ││                                   │
│                   ▼         ▼                                   │
│                  ○          ○                                   │
│                   ││        ││                                   │
│                   ▼         ▼                                   │
│                  ○          ○                                   │
│                           │                                    │
│                           ▼                                    │
│                          ○ y₂                                  │
│                                                                 │
│  Each connection has a weight (learned)                        │
│  Each neuron adds bias (learned)                               │
│  Activation functions introduce non-linearity                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Building Your First Neural Network

### NumPy Implementation

```python
import numpy as np

class NeuralNetwork:
    def __init__(self, layer_sizes):
        self.weights = []
        self.biases = []
        
        # Initialize weights and biases
        for i in range(len(layer_sizes) - 1):
            w = np.random.randn(layer_sizes[i], layer_sizes[i+1]) * 0.01
            b = np.zeros((1, layer_sizes[i+1]))
            self.weights.append(w)
            self.biases.append(b)
    
    def sigmoid(self, x):
        return 1 / (1 + np.exp(-np.clip(x, -500, 500)))
    
    def forward(self, X):
        self.activations = [X]
        
        for i in range(len(self.weights)):
            z = np.dot(self.activations[-1], self.weights[i]) + self.biases[i]
            a = self.sigmoid(z)
            self.activations.append(a)
        
        return self.activations[-1]
    
    def predict(self, X):
        return (self.forward(X) > 0.5).astype(int)

# Create network: 2 inputs, 4 hidden, 1 output
nn = NeuralNetwork([2, 4, 1])

# XOR problem
X = np.array([[0, 0], [0, 1], [1, 0], [1, 1]])
y = np.array([[0], [1], [1], [0]])

# Forward pass
output = nn.forward(X)
print(f"Predictions:\n{output}")
```

### Keras Implementation

```python
from tensorflow.keras import layers, models

model = models.Sequential([
    layers.Dense(8, activation='relu', input_shape=(2,)),
    layers.Dense(4, activation='relu'),
    layers.Dense(1, activation='sigmoid')
])

model.compile(
    optimizer='adam',
    loss='binary_crossentropy',
    metrics=['accuracy']
)

model.fit(X, y, epochs=1000, verbose=0)

# Test
predictions = model.predict(X)
print(f"Predictions: {predictions.flatten()}")
```

---

## Training: Forward and Backward Pass

### Forward Pass

```python
def forward_pass(network, X):
    """Compute output from input"""
    activation = X
    
    for w, b in zip(network.weights, network.biases):
        z = np.dot(activation, w) + b
        activation = sigmoid(z)
    
    return activation
```

### Backward Pass (Backpropagation)

```python
def backprop(network, X, y, learning_rate=0.1):
    """Update weights based on error"""
    
    # 1. Forward pass
    output = forward_pass(network, X)
    
    # 2. Calculate error
    error = y - output
    
    # 3. Backward pass
    for i in reversed(range(len(network.weights))):
        layer_error = error
        
        if i > 0:
            layer_error = np.dot(error, network.weights[i].T)
        
        # Gradient
        activation = network.activations[i]
        gradient = layer_error * activation * (1 - activation)
        
        # Update weights
        network.weights[i] += learning_rate * np.dot(
            network.activations[i].T, gradient
        )
        network.biases[i] += learning_rate * np.sum(gradient, axis=0)
        
        error = layer_error
```

---

## Training Loop

```python
def train(network, X, y, epochs=10000, lr=0.1):
    """Complete training loop"""
    
    for epoch in range(epochs):
        # Forward pass
        output = forward_pass(network, X)
        
        # Calculate loss
        loss = np.mean((y - output) ** 2)
        
        # Backward pass
        backprop(network, X, y, lr)
        
        if epoch % 2000 == 0:
            predictions = (output > 0.5).astype(int)
            accuracy = np.mean(predictions == y)
            print(f"Epoch {epoch}: Loss={loss:.4f}, Accuracy={accuracy:.2%}")
    
    return network

# Train the XOR network
nn = NeuralNetwork([2, 8, 4, 1])
nn = train(nn, X, y, epochs=10000, lr=0.5)

# Final test
output = nn.forward(X)
print(f"\nFinal predictions: {np.round(output).flatten()}")
print(f"Expected:          {y.flatten()}")
```

---

## Key Concepts

### Weights Initialization

```python
# Bad: Zero initialization
w = np.zeros((2, 2))  # All neurons learn same thing

# Good: Random initialization
w = np.random.randn(2, 2) * 0.01  # Small random values

# Best: Xavier/He initialization
w = np.random.randn(n_in, n_out) * np.sqrt(2.0 / n_in)
```

### Gradient Descent

```python
# Batch gradient descent: Use all data
# Stochastic (SGD): Use one sample at a time
# Mini-batch: Use small batches (common choice)

batch_size = 32
n_batches = len(X) // batch_size

for epoch in range(epochs):
    indices = np.random.permutation(len(X))
    
    for batch in range(n_batches):
        start = batch * batch_size
        end = start + batch_size
        X_batch = X[indices[start:end]]
        y_batch = y[indices[start:end]]
        
        # Train on batch
        backprop(network, X_batch, y_batch, lr)
```

---

## Common Architectures

```python
# Feedforward (most common)
# Data flows in one direction: input → hidden → output

# CNN (Convolutional)
# Uses filters to detect spatial patterns
# Great for images

# RNN (Recurrent)
# Has loops for sequential data
# Great for text, time series

# Transformer
# Uses attention mechanism
# Great for text, sequence data
```

---

## Best Practices

1. **Start with small networks**
   ```python
   # Simple first
   model = Sequential([Dense(4), Dense(1)])
   # Complex only if needed
   ```

2. **Use ReLU for hidden layers**
   ```python
   layers.Dense(64, activation='relu')
   ```

3. **Scale your input data**
   ```python
   from sklearn.preprocessing import StandardScaler
   scaler = StandardScaler()
   X_scaled = scaler.fit_transform(X)
   ```

4. **Monitor training**
   ```python
   history = model.fit(X, y, validation_split=0.2, epochs=50)
   plt.plot(history.history['loss'])
   plt.plot(history.history['val_loss'])
   ```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Zero weights** | Neurons learn same thing | Use random initialization |
| **No activation** | Linear network can't learn non-linear | Add ReLU/sigmoid |
| **Unnormalized data** | Gradient problems | Scale data to [0,1] or mean=0 |
| **Learning rate too high** | Diverges | Try 0.01, 0.001 |
| **Too few neurons** | Underfitting | Increase until validation improves |

---

## Summary

| Concept | Description |
|---------|-------------|
| **Neuron** | Takes inputs, applies weights, adds bias, applies activation |
| **Layer** | Collection of neurons |
| **Weights** | Learned parameters controlling connections |
| **Activation** | Non-linear function (ReLU, sigmoid) |
| **Forward pass** | Compute output from input |
| **Backward pass** | Update weights based on error |

**Key insight:** Neural networks learn by adjusting weights to minimize error through backpropagation.

**Next:** Continue to `backpropagation-explained.md` to understand how networks learn.

---

## References

- [Deep Learning Book](https://www.deeplearningbook.org/)
- [3Blue1Brown Neural Networks](https://www.3blue1brown.com/)
- [TensorFlow Tutorials](https://www.tensorflow.org/tutorials)
