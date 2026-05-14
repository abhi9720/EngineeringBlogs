---
title: CNN Convolutional Networks
description: >-
  Master CNNs for image recognition - convolutional layers, pooling, and
  building image classifiers
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Deep Learning
  - CNN
  - Computer Vision
  - Image Classification
  - Neural Networks
coverImage: /images/cnn-convolutional-networks.png
draft: false
order: 30
---
# CNN Convolutional Networks

## Overview

Convolutional Neural Networks (CNNs) are specialized for processing grid-like data, especially images. They use filters to detect local patterns like edges, textures, and shapes.

**Think of it as:** A magnifying glass that slides across the image, focusing on small patches at a time.

---

## Why Not Regular Neural Networks?

```python
# For a 64x64 RGB image:
# Regular NN: 64 * 64 * 3 = 12,288 inputs per neuron
# 100 neurons = 1.2 million weights!

# CNN advantage: Parameter sharing
# One filter applied across all positions
# Reuses same weights for every patch
```

### The Problem with Dense Layers for Images

```
Regular NN:                        CNN:
┌────────────────┐                ┌────────────────┐
│ ○ ○ ○ ○ ○ ○ ○ │                │ ━━━━ Filter ━━━━│
│ ○ ○ ○ ○ ○ ○ ○ │                └────────────────┘
│ ○ ○ ○ ○ ○ ○ ○ │                     ↓
│ (dense connection)              Slide across image
│ (too many weights)              (fewer weights)
└────────────────┘
```

---

## CNN Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              CNN Architecture                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input: 64×64×3 Image                                          │
│     │                                                           │
│     ▼                                                           │
│  ┌────────────┐  Feature Maps                                   │
│  │ Conv Layer │  ──▶ Detect edges, textures                     │
│  │  Filter    │  32 channels                                    │
│  └────────────┘                                                │
│     │                                                           │
│     ▼                                                           │
│  ┌────────────┐  Downsampled                                    │
│  │ Pool Layer │  ──▶ Reduce size, keep features                  │
│  │  2×2 Max   │  32×32×32                                       │
│  └────────────┘                                                │
│     │                                                           │
│     ▼                                                           │
│  ┌────────────┐  More Complex Features                          │
│  │ Conv Layer │  ──▶ Patterns, shapes                           │
│  │ 64 filters │  64 channels                                    │
│  └────────────┘                                                │
│     │                                                           │
│     ▼                                                           │
│  ┌────────────┐                                                │
│  │ Pool Layer │  16×16×64                                       │
│  └────────────┘                                                │
│     │                                                           │
│     ▼                                                           │
│  ┌────────────┐                                                │
│  │Fully Conn. │  Classification Head                           │
│  │ Dense Layer│  Softmax output                                 │
│  └────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Convolution Operation

### How Filters Work

```python
import numpy as np

def convolve2d(image, kernel):
    """Simple 2D convolution"""
    h, w = image.shape
    k_h, k_w = kernel.shape
    
    output_h = h - k_h + 1
    output_w = w - k_w + 1
    output = np.zeros((output_h, output_w))
    
    for i in range(output_h):
        for j in range(output_w):
            patch = image[i:i+k_h, j:j+k_w]
            output[i, j] = np.sum(patch * kernel)
    
    return output

# Example: Edge detection
image = np.array([
    [1, 1, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [0, 0, 0, 1, 1],
    [0, 0, 0, 1, 1]
])

# Vertical edge detector
vertical_edge = np.array([
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1]
])

result = convolve2d(image, vertical_edge)
print(result)
```

### Common Filters

```python
# Vertical edge detector
vertical_edge = np.array([
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1]
])

# Horizontal edge detector
horizontal_edge = np.array([
    [-1, -2, -1],
    [ 0,  0,  0],
    [ 1,  2,  1]
])

# Blur filter
blur = np.array([
    [1/9, 1/9, 1/9],
    [1/9, 1/9, 1/9],
    [1/9, 1/9, 1/9]
])

# Sharpen filter
sharpen = np.array([
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0]
])
```

---

## CNN with TensorFlow/Keras

### Basic CNN Architecture

```python
from tensorflow.keras import layers, models

model = models.Sequential([
    # First conv block
    layers.Conv2D(32, (3, 3), activation='relu', input_shape=(64, 64, 3)),
    layers.MaxPooling2D((2, 2)),
    
    # Second conv block
    layers.Conv2D(64, (3, 3), activation='relu'),
    layers.MaxPooling2D((2, 2)),
    
    # Third conv block
    layers.Conv2D(64, (3, 3), activation='relu'),
    
    # Classification head
    layers.Flatten(),
    layers.Dense(64, activation='relu'),
    layers.Dropout(0.5),
    layers.Dense(10, activation='softmax')
])

model.summary()
```

### Training the Model

```python
# Compile
model.compile(
    optimizer='adam',
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

# Train
history = model.fit(
    X_train, y_train,
    epochs=20,
    validation_split=0.2,
    batch_size=32
)

# Evaluate
test_loss, test_acc = model.evaluate(X_test, y_test)
print(f"Test accuracy: {test_acc:.2%}")
```

---

## Pooling Operations

### Max Pooling (Most Common)

```python
# 2x2 max pooling: Take maximum in each 2x2 region

def max_pool(image, pool_size=2):
    h, w = image.shape
    output_h = h // pool_size
    output_w = w // pool_size
    output = np.zeros((output_h, output_w))
    
    for i in range(output_h):
        for j in range(output_w):
            patch = image[i*pool_size:(i+1)*pool_size,
                         j*pool_size:(j+1)*pool_size]
            output[i, j] = np.max(patch)
    
    return output

# In Keras
layers.MaxPooling2D(pool_size=(2, 2))
```

### Pooling Effect

```
Input:                 After MaxPool 2×2:
┌──────────────┐       ┌──────────┐
│ 5  3  1  2   │       │ 5  4    │
│ 2  4  1  1   │  ──▶  │ 4  2    │
│ 1  0  2  2   │       └──────────┘
│ 3  2  1  0   │
└──────────────┘

Max in each 2×2 block
```

---

## Transfer Learning with Pre-trained Models

### Using ResNet50

```python
from tensorflow.keras.applications import ResNet50
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D
from tensorflow.keras import models

# Load pre-trained model (trained on ImageNet)
base_model = ResNet50(
    weights='imagenet',
    include_top=False,  # Remove classification head
    input_shape=(224, 224, 3)
)

# Freeze base model (don't train it)
base_model.trainable = False

# Build custom classifier
model = models.Sequential([
    base_model,
    GlobalAveragePooling2D(),
    Dense(256, activation='relu'),
    Dense(10, activation='softmax')  # Your classes
])

model.compile(
    optimizer='adam',
    loss='categorical_crossentropy',
    metrics=['accuracy']
)
```

### Fine-tuning

```python
# After training classifier head, fine-tune last few layers
base_model.trainable = True

# Unfreeze last 10 layers
for layer in base_model.layers[:-10]:
    layer.trainable = False

# Train with lower learning rate
model.compile(
    optimizer=tf.keras.optimizers.Adam(1e-5),  # Lower LR
    loss='categorical_crossentropy',
    metrics=['accuracy']
)

model.fit(train_generator, epochs=10)
```

---

## Image Data Augmentation

```python
from tensorflow.keras.preprocessing.image import ImageDataGenerator

datagen = ImageDataGenerator(
    rotation_range=20,      # Rotate images
    width_shift_range=0.2,  # Shift horizontally
    height_shift_range=0.2,  # Shift vertically
    horizontal_flip=True,    # Flip horizontally
    zoom_range=0.2,          # Zoom in/out
    fill_mode='nearest'     # Fill new pixels
)

# Create augmented training data
train_generator = datagen.flow_from_directory(
    'data/train',
    target_size=(224, 224),
    batch_size=32,
    class_mode='categorical'
)
```

---

## Complete Example: Flower Classification

```python
import tensorflow as tf
from tensorflow.keras import layers, models

# Build model
model = models.Sequential([
    layers.Conv2D(32, (3, 3), activation='relu', input_shape=(64, 64, 3)),
    layers.MaxPooling2D(2, 2),
    
    layers.Conv2D(64, (3, 3), activation='relu'),
    layers.MaxPooling2D(2, 2),
    
    layers.Conv2D(64, (3, 3), activation='relu'),
    layers.GlobalAveragePooling2D(),
    
    layers.Dense(64, activation='relu'),
    layers.Dropout(0.3),
    layers.Dense(5, activation='softmax')  # 5 flower types
])

# Compile
model.compile(
    optimizer='adam',
    loss='categorical_crossentropy',
    metrics=['accuracy']
)

# Train
history = model.fit(
    train_images, train_labels,
    epochs=30,
    validation_split=0.2,
    batch_size=32
)

# Predict
predictions = model.predict(test_images)
predicted_classes = np.argmax(predictions, axis=1)
```

---

## Best Practices

1. **Start with proven architectures**
   ```python
   # Use ResNet, VGG, EfficientNet as starting point
   base_model = ResNet50(weights='imagenet')
   ```

2. **Use global pooling instead of flatten**
   ```python
   # Better than flatten for variable input sizes
   layers.GlobalAveragePooling2D()
   ```

3. **Add batch normalization**
   ```python
   layers.Conv2D(32, (3, 3))
   layers.BatchNormalization()
   layers.Activation('relu')
   ```

4. **Use dropout for regularization**
   ```python
   # After dense layers
   layers.Dropout(0.5)
   ```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Too many filters** | Overfitting, slow | Start small, increase as needed |
| **No pooling** | Network too large | Use 2x2 max pooling |
| **Missing ReLU** | Network learns slowly | Add activation after each conv |
| **Forgetting input shape** | Error | Specify (height, width, channels) |
| **Not using transfer learning** | Wasting time | Start with pre-trained models |

---

## Summary

| Layer | Purpose | Key Points |
|-------|---------|------------|
| **Conv2D** | Detect features | Filters learn patterns |
| **MaxPooling** | Reduce size | Keep important features |
| **GlobalPooling** | Convert to vector | Works with any input size |
| **Dense** | Classify | Final prediction layer |

**Key insight:** CNNs detect local features and combine them to understand the whole image.

**Next:** Continue to `rnn-sequence-models.md` for sequence data.

---

## References

- [Keras CNN Guide](https://keras.io/api/layers/convolutional_layers/)
- [CS231n CNNs](http://cs231n.stanford.edu/)
- [Transfer Learning Guide](https://keras.io/guides/transfer_learning/)
