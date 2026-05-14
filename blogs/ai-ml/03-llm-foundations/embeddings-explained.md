---
title: Embeddings Explained
description: >-
  Understand text embeddings - converting text to vectors for similarity search
  and semantic understanding
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Embeddings
  - Vector Search
  - NLP
  - AI
coverImage: /images/embeddings-explained.png
draft: false
order: 10
---
# Embeddings Explained

## Overview

Embeddings convert text into dense numerical vectors that capture semantic meaning. Similar texts have similar vectors, enabling semantic search and similarity comparisons.

**Think of it as:** Translating words into GPS coordinates where similar concepts are nearby.

---

## What are Embeddings?

```
┌─────────────────────────────────────────────────────────────────┐
│              Text → Numbers → Vectors                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Text: "The cat is sleeping on the couch"                     │
│                                                                 │
│  Token IDs: [116, 3291, 318, 4479, 319, 264, 4245]           │
│                                                                 │
│  Embedding: [0.23, -0.45, 0.78, ...]  (1536 dimensions)      │
│                                                                 │
│  The model learned to place this text near:                   │
│  - "A cat resting on the sofa"  ← similar!                    │
│  - "A dog jumping on the bed"    ← somewhat similar            │
│  - "A car driving on the road"  ← not similar                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Embeddings?

```python
# Without embeddings:
# Compare text by exact word match
# "cat" vs "cats" → different!

# With embeddings:
# Compare by semantic meaning
# "cat" vs "cats" → very similar!

# Distance in vector space = semantic similarity
```

---

## Creating Embeddings

### OpenAI Embeddings

```python
import openai

response = openai.embeddings.create(
    model="text-embedding-3-small",
    input="The quick brown fox jumps over the lazy dog"
)

embedding = response.data[0].embedding
print(f"Dimensions: {len(embedding)}")  # 1536
print(f"Sample values: {embedding[:5]}")
```

### Sentence Transformers (Open Source)

```python
from sentence_transformers import SentenceTransformer

# Load model
model = SentenceTransformer('all-MiniLM-L6-v2')

# Create embedding
text = "The quick brown fox jumps over the lazy dog"
embedding = model.encode(text)

print(f"Shape: {embedding.shape}")  # (384,)
print(f"Sample: {embedding[:5]}")
```

---

## Embedding Models

| Model | Dimensions | Best For |
|-------|------------|----------|
| **text-embedding-3-small** | 1536 | Cost-effective |
| **text-embedding-3-large** | 3072 | Best quality |
| **all-MiniLM-L6-v2** | 384 | Fast, open source |
| **all-mpnet-base-v2** | 768 | High quality, open |

### Comparison

```python
from sentence_transformers import SentenceTransformer

models = {
    'all-MiniLM-L6-v2': 'Fast, small',
    'all-mpnet-base-v2': 'Better quality',
}

for name, desc in models.items():
    model = SentenceTransformer(name)
    dim = model.get_sentence_embedding_dimension()
    print(f"{name}: {dim} dimensions - {desc}")
```

---

## Measuring Similarity

### Cosine Similarity

```python
import numpy as np

def cosine_similarity(a, b):
    """Measure similarity between -1 and 1"""
    a = np.array(a)
    b = np.array(b)
    
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    
    return dot / (norm_a * norm_b)

# Similar texts
text1 = "The cat is sleeping on the couch"
text2 = "A cat resting on the sofa"

# Get embeddings
emb1 = model.encode(text1)
emb2 = model.encode(text2)

sim = cosine_similarity(emb1, emb2)
print(f"Similarity: {sim:.3f}")  # Should be high
```

### Practical Example

```python
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

model = SentenceTransformer('all-MiniLM-L6-v2')

documents = [
    "The weather is sunny today",
    "It's raining cats and dogs",
    "I love sunny days at the beach",
    "A dog ate my homework"
]

# Create embeddings for all documents
embeddings = model.encode(documents)

# Compare each to "I enjoy sunny weather"
query = "I enjoy sunny weather"
query_emb = model.encode(query)

# Compute similarities
similarities = cosine_similarity([query_emb], embeddings)[0]

# Rank by similarity
for i, (doc, sim) in enumerate(sorted(zip(documents, similarities), 
                                       key=lambda x: -x[1])):
    print(f"{sim:.3f}: {doc}")
```

---

## Embeddings for RAG

### Storing for Retrieval

```python
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('all-MiniLM-L6-v2')

documents = [
    "Python is a programming language",
    "JavaScript is used for web development",
    "Machine learning is a subset of AI",
    "Deep learning uses neural networks"
]

# Create embeddings
doc_embeddings = model.encode(documents)

# Store with metadata
knowledge_base = []
for i, (doc, emb) in enumerate(zip(documents, doc_embeddings)):
    knowledge_base.append({
        "id": i,
        "text": doc,
        "embedding": emb
    })
```

### Retrieval

```python
def retrieve(query, knowledge_base, top_k=2):
    """Find most similar documents"""
    
    query_emb = model.encode(query)
    
    similarities = []
    for item in knowledge_base:
        sim = cosine_similarity([query_emb], [item["embedding"]])[0][0]
        similarities.append((item, sim))
    
    # Sort by similarity
    similarities.sort(key=lambda x: -x[1])
    
    return similarities[:top_k]

# Query
results = retrieve("What is Python?", knowledge_base)
for item, sim in results:
    print(f"{sim:.3f}: {item['text']}")
```

---

## Embedding Dimensions

```python
# Higher dimensions = more expressiveness
# But also more storage and computation

# Common dimensions:
dimensions = {
    384: "Fast, efficient (MiniLM)",
    768: "Balanced (MPNet)",
    1536: "High quality (OpenAI small)",
    3072: "Best quality (OpenAI large)",
}

# You can reduce dimensions without losing much meaning
from sklearn.decomposition import PCA

def reduce_dimensions(embeddings, n_components=384):
    pca = PCA(n_components=n_components)
    return pca.fit_transform(embeddings)

# Reduce 768-dim to 384-dim
reduced = reduce_dimensions(doc_embeddings, 384)
print(f"Original: {doc_embeddings.shape}")
print(f"Reduced: {reduced.shape}")
```

---

## Best Practices

1. **Use appropriate models**
   ```python
   # Production: text-embedding-3-small (cost-effective)
   # Research: text-embedding-3-large (quality)
   # Offline: sentence-transformers (open source)
   ```

2. **Batch embeddings for efficiency**
   ```python
   # Instead of one at a time
   embeddings = model.encode(documents)  # Batch
   ```

3. **Normalize for consistent similarity**
   ```python
   # Most embedding models normalize by default
   # Check your model's documentation
   ```

---

## Summary

| Concept | Description |
|---------|-------------|
| **Embedding** | Dense vector representation |
| **Dimensions** | Size of the vector (typically 384-3072) |
| **Similarity** | Measured by cosine similarity |
| **RAG** | Use embeddings to retrieve relevant context |

**Key insight:** Embeddings convert text to numbers where similar texts have similar vectors, enabling semantic search.

**Next:** Continue to `vector-similarity.md` for more on similarity search.

---

## References

- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Sentence Transformers](https://www.sbert.net/)
- [MTEB Benchmark](https://huggingface.co/blog/mteb)
