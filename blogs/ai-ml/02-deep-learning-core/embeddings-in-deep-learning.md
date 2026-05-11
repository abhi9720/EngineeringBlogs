---
title: "Embeddings in Deep Learning"
description: "Understand word embeddings, vector representations, and how neural networks represent meaning"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - Deep Learning
  - Embeddings
  - NLP
  - Word Vectors
  - Representation Learning
coverImage: "/images/embeddings-in-deep-learning.png"
draft: false
---

# Embeddings in Deep Learning

## Overview

Embeddings are dense vector representations of discrete data (like words or categories) that capture semantic meaning in continuous space. Similar concepts are represented by similar vectors.

**Think of it as:** Translating words into numbers so computers can understand meaning.

---

## Why Embeddings?

```
┌─────────────────────────────────────────────────────────────────┐
│              The Embedding Problem                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Words are discrete symbols:                                    │
│  "cat" = 1, "dog" = 2, "bird" = 3                           │
│                                                                 │
│  Problem:                                                       │
│  - No relationship between "cat" and "dog"                     │
│  - Can't do math: cat + animal = ?                            │
│  - No way to measure similarity                               │
│                                                                 │
│  Solution: Embeddings                                           │
│                                                                 │
│  "cat" = [0.2, -0.1, 0.8, ...]                                │
│  "dog" = [0.3, -0.2, 0.7, ...]                                │
│                                                                 │
│  Similar words → Similar vectors!                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Word Embeddings

### The Core Idea

```python
# Words represented as dense vectors
# Typically 50-300 dimensions

# Example: 4-dimensional embeddings
embeddings = {
    "cat": [0.2, -0.1, 0.8, 0.1],
    "dog": [0.3, -0.2, 0.7, 0.2],
    "bird": [-0.5, 0.6, 0.1, -0.3],
    "fish": [-0.4, 0.7, 0.2, -0.2]
}

# "cat" and "dog" are similar (both pets/animals)
# "bird" and "fish" are similar (both not pets)
```

### Semantic Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│              Embedding Space                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                     king                                       │
│                       ●                                        │
│                     / \                                        │
│                    /   \                                       │
│                   /     \                                      │
│                man    woman                                     │
│                  \     /                                        │
│                   \   /                                         │
│                    ●●● (vector arithmetic!)                     │
│                     |                                          │
│                   queen                                        │
│                                                                 │
│  king - man + woman ≈ queen                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Vector Arithmetic

```python
import numpy as np

# Pre-trained word vectors (example)
# king, man, woman, queen

# king - man + woman ≈ queen
king = np.array([0.5, 0.2, 0.8])
man = np.array([0.3, 0.1, 0.6])
woman = np.array([0.2, -0.1, 0.7])

# Compute
result = king - man + woman

print(f"Result: {result}")
# Should be close to queen vector!
```

---

## Creating Embeddings

### Using Word2Vec

```python
from gensim.models import Word2Vec

sentences = [
    ['the', 'cat', 'sat', 'on', 'the', 'mat'],
    ['the', 'dog', 'ran', 'in', 'the', 'park'],
    ['cats', 'and', 'dogs', 'are', 'pets'],
    # ... millions of sentences
]

# Train Word2Vec
model = Word2Vec(
    sentences,
    vector_size=100,  # Embedding dimension
    window=5,         # Context window
    min_count=2,      # Ignore rare words
    workers=4,        # Parallel processing
    epochs=10         # Training epochs
)

# Get word vector
cat_vector = model.wv['cat']
print(f"Cat vector shape: {cat_vector.shape}")  # (100,)

# Find similar words
similar = model.wv.most_similar('cat', topn=5)
print(f"Similar to 'cat': {similar}")
```

### Using Neural Networks

```python
import torch
import torch.nn as nn

class WordEmbedding(nn.Module):
    def __init__(self, vocab_size, embedding_dim):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
    
    def forward(self, x):
        return self.embedding(x)

# Create embedding layer
vocab_size = 10000
embedding_dim = 64
embedding = WordEmbedding(vocab_size, embedding_dim)

# Look up word indices
word_indices = torch.tensor([1, 4, 2, 8])  # word indices

# Get embeddings
vectors = embedding(word_indices)
print(f"Shape: {vectors.shape}")  # (4, 64)
```

---

## Pre-trained Embeddings

### Using GloVe

```python
import numpy as np

# Load GloVe embeddings (6B tokens)
# Download from: https://nlp.stanford.edu/projects/glove/

def load_glove_embeddings(path):
    embeddings = {}
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            values = line.split()
            word = values[0]
            vector = np.array(values[1:], dtype='float32')
            embeddings[word] = vector
    return embeddings

glove = load_glove_embeddings('glove.6B.100d.txt')

# Get word vector
cat_vec = glove['cat']
print(f"Cat: {cat_vec[:5]}")  # First 5 dims

# Compute similarity
def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

print(f"Cat-Dog similarity: {cosine_similarity(glove['cat'], glove['dog']):.3f}")
print(f"Cat-Car similarity: {cosine_similarity(glove['cat'], glove['car']):.3f}")
```

### Using FastText

```python
from gensim.models import FastText

# FastText can handle OOV words (out-of-vocabulary)
model = FastText(
    sentences,
    vector_size=100,
    window=5,
    min_count=2
)

# Works for words never seen during training!
vector = model.wv['caattt']  # Misspelled, still gets vector!
```

---

## Contextual Embeddings

### Word2Vec vs BERT

```
┌─────────────────────────────────────────────────────────────────┐
│              Static vs Contextual Embeddings                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Word2Vec (Static):                                            │
│  "bank" always = [0.2, -0.1, ...]                            │
│  Same for "river bank" and "bank account"!                     │
│                                                                 │
│  BERT (Contextual):                                            │
│  "bank" in "river bank" = [0.5, -0.2, ...]                     │
│  "bank" in "bank account" = [0.1, -0.7, ...]                  │
│  Different! Based on context!                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Getting Contextual Embeddings from BERT

```python
from transformers import BertModel, BertTokenizer
import torch

tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
model = BertModel.from_pretrained('bert-base-uncased')

# Two different sentences with "bank"
sentences = [
    "I sat by the river bank",
    "I went to the bank to deposit money"
]

for sent in sentences:
    inputs = tokenizer(sent, return_tensors='pt')
    outputs = model(**inputs)
    
    # Last hidden state has embeddings for each token
    embeddings = outputs.last_hidden_state[0]  # First sequence
    
    print(f"\nSentence: '{sent}'")
    print(f"Embedding shape: {embeddings.shape}")  # (seq_len, 768)
```

---

## Embedding Visualization

### t-SNE for Word Clusters

```python
from sklearn.manifold import TSNE
import matplotlib.pyplot as plt

# Get vectors for common words
words = ['king', 'queen', 'man', 'woman', 'boy', 'girl', 
          'dog', 'cat', 'lion', 'tiger', 'car', 'bus', 'train']
word_vectors = np.array([model.wv[w] for w in words])

# Reduce to 2D
tsne = TSNE(n_components=2, random_state=42)
vectors_2d = tsne.fit_transform(word_vectors)

# Plot
plt.figure(figsize=(10, 8))
for i, word in enumerate(words):
    plt.scatter(vectors_2d[i, 0], vectors_2d[i, 1])
    plt.annotate(word, (vectors_2d[i, 0], vectors_2d[i, 1]))
plt.show()
```

---

## Applications of Embeddings

| Application | How Embeddings Help |
|-------------|-------------------|
| **Similarity Search** | Find similar documents, products |
| **Recommendation** | Recommend based on embedding similarity |
| **Classification** | Feed embeddings to classifier |
| **Clustering** | Group similar items |
| **Translation** | Shared embedding space across languages |
| **RAG** | Find relevant context chunks |

---

## Embedding Tables

```python
import numpy as np

# Embedding table: maps indices to vectors
vocab_size = 10000
embedding_dim = 64

# Random embeddings
embedding_table = np.random.randn(vocab_size, embedding_dim) * 0.01

# Look up word by index
word_index = 42
word_vector = embedding_table[word_index]

# Initialize with pre-trained
embedding_table[0] = glove['the']  # Use GloVe for common words
```

---

## Best Practices

1. **Use pre-trained when available**
   ```python
   model = BertModel.from_pretrained('bert-base-uncased')
   embeddings = model.get_input_embeddings()
   ```

2. **Dimension choice**
   ```python
   # Larger = more expressive, slower
   # 50-100: Fast, decent quality
   # 200-300: Better quality, slower
   # 768+: State-of-the-art (BERT)
   ```

3. **Normalize embeddings**
   ```python
   # For similarity: normalize to unit length
   normalized = embedding / np.linalg.norm(embedding, axis=1, keepdims=True)
   ```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Same vector for all contexts** | Loses meaning | Use contextual embeddings |
| **Not normalizing for similarity** | Inconsistent results | Normalize before dot product |
| **Vocabulary mismatch** | Unknown tokens | Use subword (BPE) or contextual |
| **Fixed dimension for all tasks** | Inefficient | Match to task complexity |

---

## Summary

| Type | Example | Captures |
|------|---------|----------|
| **Word2Vec** | Static | General word meaning |
| **GloVe** | Static | Global co-occurrence |
| **FastText** | Static with subword | Handles misspellings |
| **BERT** | Contextual | Context-specific meaning |

**Key insight:** Embeddings convert discrete symbols into continuous vectors where similar concepts cluster together.

**Next:** Continue to `03-llm-foundations/intro-to-llms.md` to learn about large language models.

---

## References

- [Word2Vec Paper](https://arxiv.org/abs/1301.3781)
- [GloVe Paper](https://nlp.stanford.edu/pubs/glove.pdf)
- [BERT Paper](https://arxiv.org/abs/1810.04805)
- [Hugging Face Embeddings](https://huggingface.co/transformers/)