---
title: "Backpropagation Explained"
description: "Understand backpropagation - the core algorithm that trains neural networks by computing gradients"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - Deep Learning
  - Backpropagation
  - Gradient Descent
  - Neural Networks
  - AI
coverImage: "/images/backpropagation-explained.png"
draft: false
---

# Backpropagation Explained

## Overview

Backpropagation is the algorithm that trains neural networks by computing how much each weight contributed to the error. It uses the chain rule of calculus to efficiently calculate gradients.

**Think of it as:** Working backwards from the output error to figure out how to adjust each weight.

---

## The Problem Backpropagation Solves

```python
# Imagine a network with 1 million weights
# Naive approach: Change each weight slightly, test, repeat
# Would take forever!

# Backpropagation: Efficiently compute the gradient for ALL weights
# Using calculus chain rule
```

---

## The Chain Rule

### Simple Example

```python
# If y = f(g(x))
# Then dy/dx = dy/du * du/dx

# Example: y = (2x + 1)²
# Let u = 2x + 1
# y = u²

# dy/du = 2u
# du/dx = 2

# dy/dx = (2u) * 2 = 4u = 4(2x + 1)
```

### Applied to Neural Networks

```python
# For network: input → layer1 → layer2 → output
# Error depends on weights through multiple layers

# Chain rule lets us compute:
# d(Error)/d(weight_in_layer_1)

# Without computing this explicitly for each weight!
```

---

## The Forward and Backward Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Forward vs Backward Pass                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Forward Pass (Prediction):                                    │
│                                                                 │
│    Input ──▶ Layer1 ──▶ Layer2 ──▶ Output                       │
│              w₁         w₂                                      │
│              a₁         a₂                                      │
│                                                                 │
│  Backward Pass (Learning):                                      │
│                                                                 │
│    Output ──▶ Layer2 ──▶ Layer1 ──▶ Input                      │
│              δ₂         δ₁ (gradients)                        │
│                                                                 │
│  Goal: Update weights to reduce error                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Backpropagation

### Setup: Simple Network

```python
import numpy as np

# 2-2-1 network for XOR
# Input(2) → Hidden(2) → Output(1)

# Initialize weights
np.random.seed(42)

# Weights: input to hidden
W1 = np.random.randn(2, 2) * 0.5
b1 = np.zeros((1, 2))

# Weights: hidden to output
W2 = np.random.randn(2, 1) * 0.5
b2 = np.zeros((1, 1))

def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def sigmoid_derivative(x):
    return x * (1 - x)
```

### Forward Pass

```python
def forward(X, W1, b1, W2, b2):
    # Input to hidden
    z1 = X @ W1 + b1
    a1 = sigmoid(z1)
    
    # Hidden to output
    z2 = a1 @ W2 + b2
    a2 = sigmoid(z2)
    
    return a1, a2  # activations

# Test
X = np.array([[1, 0]])  # XOR input
a1, a2 = forward(X, W1, b1, W2, b2)
print(f"Output: {a2[0, 0]:.4f}")  # Initial prediction
```

### Compute Loss

```python
def compute_loss(y_true, y_pred):
    return np.mean((y_true - y_pred) ** 2)

y = np.array([[1]])  # Target
loss = compute_loss(y, a2)
print(f"Loss: {loss:.4f}")
```

### Backward Pass (The Core Algorithm)

```python
def backward(X, y, a1, a2, W1, W2):
    # 1. Output layer error
    # error = (y - y_pred) * derivative
    output_error = (y - a2)  # For MSE
    output_delta = output_error * sigmoid_derivative(a2)
    
    # 2. Hidden layer error
    # Error backpropagated through output weights
    hidden_error = output_delta @ W2.T
    hidden_delta = hidden_error * sigmoid_derivative(a1)
    
    # 3. Compute gradients
    grad_W2 = a1.T @ output_delta
    grad_b2 = np.sum(output_delta, axis=0, keepdims=True)
    
    grad_W1 = X.T @ hidden_delta
    grad_b1 = np.sum(hidden_delta, axis=0, keepdims=True)
    
    return grad_W1, grad_b1, grad_W2, grad_b2

# Get gradients
grad_W1, grad_b1, grad_W2, grad_b2 = backward(X, y, a1, a2, W1, W2)
print(f"Gradient W2 shape: {grad_W2.shape}")
print(f"Gradient W2 values: {grad_W2}")
```

### Update Weights

```python
def update_weights(W1, b1, W2, b2, 
                    grad_W1, grad_b1, grad_W2, grad_b2, 
                    learning_rate):
    
    W2 += learning_rate * grad_W2
    b2 += learning_rate * grad_b2
    W1 += learning_rate * grad_W1
    b1 += learning_rate * grad_b1
    
    return W1, b1, W2, b2

# Update
W1, b1, W2, b2 = update_weights(
    W1, b1, W2, b2, 
    grad_W1, grad_b1, grad_W2, grad_b2, 
    learning_rate=1.0
)

# Check improved prediction
a1, a2 = forward(X, W1, b1, W2, b2)
print(f"Output after update: {a2[0, 0]:.4f}")
print(f"Loss after update: {compute_loss(y, a2):.4f}")
```

---

## Complete Training Loop

```python
def train(X, y, epochs=10000, lr=1.0):
    # Initialize network
    W1 = np.random.randn(2, 2) * 0.5
    b1 = np.zeros((1, 2))
    W2 = np.random.randn(2, 1) * 0.5
    b2 = np.zeros((1, 1))
    
    for epoch in range(epochs):
        # Forward pass
        a1, a2 = forward(X, W1, b1, W2, b2)
        
        # Compute loss
        loss = compute_loss(y, a2)
        
        # Backward pass
        grad_W1, grad_b1, grad_W2, grad_b2 = backward(
            X, y, a1, a2, W1, W2
        )
        
        # Update weights
        W1, b1, W2, b2 = update_weights(
            W1, b1, W2, b2,
            grad_W1, grad_b1, grad_W2, grad_b2,
            lr
        )
        
        if epoch % 2000 == 0:
            print(f"Epoch {epoch}: Loss = {loss:.4f}")
    
    return W1, b1, W2, b2

# XOR training data
X = np.array([
    [0, 0], [0, 1], [1, 0], [1, 1]
])
y = np.array([[0], [1], [1], [0]])

# Train
W1, b1, W2, b2 = train(X, y, epochs=10000, lr=1.0)

# Test
predictions = forward(X, W1, b1, W2, b2)[1]
print(f"\nFinal predictions:")
for i in range(len(X)):
    print(f"XOR({X[i][0]}, {X[i][1]}) = {predictions[i][0]:.2f} (expected {y[i][0]})")
```

---

## The Mathematics Behind

### Loss Function Gradient

```python
# For output layer with MSE loss:
# L = (1/2) * (y - y_pred)²

# Gradient: dL/dW
# = dL/dy_pred * dy_pred/dW

# dL/dy_pred = -(y - y_pred)
# dy_pred/dW = output_of_previous_layer

# So: dL/dW = -(y - y_pred) * previous_output
```

### Layer-by-Layer Backprop

```python
# Layer l's error depends on layer l+1's error

def compute_layer_error(delta_next, W_next, activation):
    """
    Backpropagate error from next layer to this layer
    """
    # Error from next layer, weighted by connection strength
    error = delta_next @ W_next.T
    
    # Apply derivative of activation
    delta = error * sigmoid_derivative(activation)
    
    return delta
```

---

## Gradient Descent Variants

### 1. Batch Gradient Descent

```python
# Use ALL training data per update
# Slower but stable

for epoch in range(epochs):
    # Compute gradient over entire dataset
    gradient = compute_gradient_over_all_data(X, y)
    weights -= learning_rate * gradient
```

### 2. Stochastic Gradient Descent (SGD)

```python
# Use ONE sample at a time
# Fast but noisy

for epoch in range(epochs):
    for sample in shuffle(data):
        gradient = compute_gradient(sample)
        weights -= learning_rate * gradient
```

### 3. Mini-Batch SGD (Most Common)

```python
# Use small batches (32, 64, 128 samples)
# Balances speed and stability

batch_size = 32
for epoch in range(epochs):
    for batch in batches(data, batch_size):
        gradient = compute_gradient(batch)
        weights -= learning_rate * gradient
```

---

## Common Issues

### Vanishing Gradients

```python
# Problem: Gradients get very small in deep networks
# sigmoid'(x) ≤ 0.25, so gradients shrink each layer

# Solution:
# - Use ReLU (derivative is 0 or 1)
# - Use residual connections
# - Use batch normalization
# - Use LSTM/GRU for RNNs
```

### Exploding Gradients

```python
# Problem: Gradients get very large
# Common in RNNs with long sequences

# Solution:
# - Gradient clipping (cap gradients)
# - Proper initialization (Xavier/He)
# - Lower learning rate
# - Use LSTM/GRU

# Gradient clipping example
def clip_gradient(gradient, max_norm):
    norm = np.linalg.norm(gradient)
    if norm > max_norm:
        gradient = gradient * max_norm / norm
    return gradient
```

---

## Optimization Algorithms

```python
# Basic SGD
weights -= lr * gradient

# Momentum - adds inertia
velocity = momentum * velocity - lr * gradient
weights += velocity

# Adam - adaptive learning rates
# Combines momentum and RMSprop
# Most popular optimizer for deep learning
```

---

## Summary

| Step | What Happens |
|------|--------------|
| **1. Forward Pass** | Compute predictions through network |
| **2. Compute Loss** | Compare predictions to actual values |
| **3. Backward Pass** | Compute gradients layer by layer |
| **4. Update Weights** | Adjust weights using gradients |
| **5. Repeat** | Iterate until loss is low enough |

**Key insight:** Backpropagation uses the chain rule to efficiently compute how each weight should change to reduce error.

**Next:** Continue to `cnn-convolutional-networks.md` to learn about CNNs.

---

## References

- [CS231n Backpropagation](http://cs231n.stanford.edu/)
- [Chain Rule Explained](https://colah.github.io/posts/2015-08-Backprop/)
- [Deep Learning Book - Optimization](https://www.deeplearningbook.org/)