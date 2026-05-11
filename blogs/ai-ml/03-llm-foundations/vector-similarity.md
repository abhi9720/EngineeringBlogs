---
title: "Vector Similarity"
description: "Master vector similarity measures - cosine, dot product, Euclidean distance for semantic search"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - LLM
  - Vector Similarity
  - Semantic Search
  - Embeddings
  - AI
coverImage: "/images/vector-similarity.png"
draft: false
---

# Vector Similarity

## Overview

Vector similarity measures how alike two vectors are. For embeddings, similar vectors = semantically similar text. This is the foundation of semantic search.

**Think of it as:** Measuring how close two points are on a map.

---

## Similarity Measures

```
┌─────────────────────────────────────────────────────────────────┐
│              Similarity Measures Overview                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Cosine Similarity:                                            │
│  - Angle between vectors                                       │
│  - Range: -1 to 1 (1 = identical)                             │
│  - Best for: Text embeddings, when magnitude doesn't matter   │
│                                                                 │
│  Dot Product:                                                  │
│  - Raw product of magnitudes                                   │
│  - Range: -∞ to +∞                                            │
│  - Best for: When you want raw relevance score                 │
│                                                                 │
│  Euclidean Distance:                                            │
│  - Straight-line distance                                      │
│  - Range: 0 to ∞                                               │
│  - Best for: When absolute position matters                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cosine Similarity

### The Formula

```python
import numpy as np

def cosine_similarity(a, b):
    """Measure of angle between vectors"""
    
    a = np.array(a)
    b = np.array(b)
    
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    
    return dot / (norm_a * norm_b)

# Example
a = [1, 0]
b = [1, 0]
print(f"Identical vectors: {cosine_similarity(a, b):.3f}")  # 1.0

a = [1, 0]
b = [-1, 0]
print(f"Opposite vectors: {cosine_similarity(a, b):.3f}")  # -1.0

a = [1, 0]
b = [0, 1]
print(f"Right angle: {cosine_similarity(a, b):.3f}")  # 0.0
```

### Visual Interpretation

```
Cosine = 1.0                 Cosine = 0.0                Cosine = -1.0
(Identical)                  (Perpendicular)             (Opposite)

    ↑                           ↑                             ↓
    │                           │                             │
    │ b                          │ b                          b│
    │↗                           │                             │
    │ ↖                          └──→                         │
    │a                          │a                             │a
```

---

## Dot Product Similarity

### The Formula

```python
def dot_product(a, b):
    """Raw dot product"""
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b)

# Example
a = [1, 2, 3]
b = [1, 2, 3]
print(f"Same direction: {dot_product(a, b)}")  # 14

a = [1, 2, 3]
b = [2, 4, 6]
print(f"Collinear (2x): {dot_product(a, b)}")  # 28

a = [1, 2, 3]
b = [-1, -2, -3]
print(f"Opposite: {dot_product(a, b)}")  # -14
```

### Normalized Dot Product = Cosine

```python
# For normalized vectors, dot product = cosine similarity
# Most embedding models produce normalized vectors

# So you can use either:
cosine_sim = cosine_similarity(emb1, emb2)
dot_sim = np.dot(emb1, emb2)  # Same result!
```

---

## Euclidean Distance

### The Formula

```python
def euclidean_distance(a, b):
    """Straight-line distance between points"""
    a = np.array(a)
    b = np.array(b)
    return np.linalg.norm(a - b)

# Example: Points in 2D
a = [0, 0]
b = [3, 4]
print(f"Distance: {euclidean_distance(a, b):.1f}")  # 5.0
```

### Distance vs Similarity

```python
# Distance = how different
# Similarity = how alike

# They're inversely related:
# similarity = 1 / (1 + distance)  # For normalized vectors
# distance = 1 - similarity

# For cosine similarity:
similarity = cosine_similarity(a, b)
distance = 1 - similarity  # Only works when vectors are unit length
```

---

## Practical Comparison

### When to Use Each

```python
MEASURES = {
    "cosine_similarity": {
        "range": "-1 to 1",
        "best_for": [
            "Text embeddings (typically normalized)",
            "Documents of different lengths",
            "Semantic similarity",
        ],
        "ignore_magnitude": True
    },
    "dot_product": {
        "range": "-∞ to +∞",
        "best_for": [
            "Normalized vectors",
            "Ranking by raw relevance",
            "Recommender systems",
        ],
        "ignore_magnitude": False
    },
    "euclidean_distance": {
        "range": "0 to +∞",
        "best_for": [
            "Clustering algorithms",
            "K-nearest neighbors",
            "Geometric problems",
        ],
        "considers_position": True
    }
}
```

### Which to Use for Embeddings

```python
# Most embedding models produce normalized vectors
# So cosine similarity and dot product are equivalent!

# Recommendation: Use cosine_similarity
# - More intuitive (always -1 to 1)
# - Self-documenting

# In production vector databases:
# - FAISS: Use inner product (dot product)
# - Pinecone: Use cosine
# - ChromaDB: Use cosine (default)
```

---

## Implementation Examples

### Pure NumPy

```python
import numpy as np

def batch_cosine_similarity(query_emb, doc_embeddings):
    """Find most similar documents to query"""
    similarities = np.dot(doc_embeddings, query_emb)
    return similarities

# Example
query_emb = np.array([0.5, 0.5])
doc_embeddings = np.array([
    [0.6, 0.6],  # Very similar
    [0.1, 0.1],  # Somewhat similar
    [-0.5, 0.5], # Not similar
])

sims = batch_cosine_similarity(query_emb, doc_embeddings)
print(f"Similarities: {sims}")
# [0.85, 0.14, 0.0]
```

### With scikit-learn

```python
from sklearn.metrics.pairwise import cosine_similarity

# Query: 1 document, Documents: N documents
query_emb = np.array([[0.5, 0.5]])
doc_embeddings = np.array([
    [0.6, 0.6],
    [0.1, 0.1],
    [-0.5, 0.5],
])

# Returns matrix of similarities
similarities = cosine_similarity(query_emb, doc_embeddings)[0]
print(f"Similarities: {similarities}")
```

### With Faiss

```python
import faiss
import numpy as np

# Create index
dimension = 384
index = faiss.IndexFlatIP(dimension)  # Inner product = cosine for normalized

# Add vectors (should be normalized for cosine)
vectors = np.random.randn(1000, dimension).astype('float32')
faiss.normalize_L2(vectors)  # Normalize for cosine
index.add(vectors)

# Search
query = np.random.randn(1, dimension).astype('float32')
faiss.normalize_L2(query)

distances, indices = index.search(query, k=5)
print(f"Most similar indices: {indices}")
print(f"Similarities: {distances}")
```

---

## Similarity Thresholds

### Choosing Thresholds

```python
THRESHOLDS = {
    # Based on experience with text embeddings
    "very_high": 0.95,  # Nearly identical
    "high": 0.90,       # Very similar
    "good": 0.80,      # Clearly related
    "moderate": 0.70,  # Somewhat related
    "low": 0.50,       # Weakly related
    "none": 0.30,      # Unrelated
}

def classify_similarity(score):
    if score >= THRESHOLDS["very_high"]:
        return "Identical or near-duplicate"
    elif score >= THRESHOLDS["high"]:
        return "Very similar"
    elif score >= THRESHOLDS["good"]:
        return "Related"
    elif score >= THRESHOLDS["moderate"]:
        return "Weakly related"
    else:
        return "Unrelated"
```

---

## Best Practices

1. **Normalize vectors first**
   ```python
   # For cosine similarity
   norms = np.linalg.norm(vectors, axis=1, keepdims=True)
   normalized = vectors / norms
   ```

2. **Batch for efficiency**
   ```python
   # Compute all similarities at once
   similarities = np.dot(queries, documents.T)
   ```

3. **Use appropriate data types**
   ```python
   # Use float32 for embeddings (saves memory)
   vectors = vectors.astype('float32')
   ```

---

## Summary

| Measure | Formula | Range | Best For |
|---------|---------|-------|----------|
| **Cosine** | dot(a,b)/(\|a\|\|b\|) | -1 to 1 | Text, normalized vectors |
| **Dot Product** | dot(a,b) | -∞ to +∞ | Raw relevance scores |
| **Euclidean** | \|a-b\| | 0 to +∞ | Clustering, geometric |

**Key insight:** For normalized embeddings, cosine similarity and dot product give equivalent results.

**Next:** Continue to `semantic-search-basics.md` for applying similarity to search.

---

## References

- [Faiss Documentation](https://github.com/facebookresearch/faiss)
- [Cosine Similarity Guide](https://scikit-learn.org/stable/modules/metrics.html#cosine-similarity)