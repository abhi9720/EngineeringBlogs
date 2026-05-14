---
title: Reranking Techniques
description: >-
  Improve RAG accuracy with reranking - from simple to advanced reranking
  strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - RAG
  - Reranking
  - Cross-Encoder
  - AI
  - AI Agents
  - Production AI
coverImage: /images/reranking-techniques.png
draft: false
order: 80
---
# Reranking Techniques

## Overview

Reranking improves retrieval quality by reordering initial candidates using more sophisticated similarity measures.

**Think of it as:** First search with fast vectors, then polish with smarter scoring.

---

## Why Rerank?

```
┌─────────────────────────────────────────────────────────────────┐
│              Two-Stage Retrieval                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Stage 1: Fast Vector Search                                    │
│  - Retrieve top 100 candidates quickly                         │
│  - Uses approximate nearest neighbor                           │
│  - Fast but less precise                                       │
│                                                                 │
│  Stage 2: Reranking                                            │
│  - Re-score top candidates with better model                   │
│  - Uses cross-encoder or more sophisticated scoring           │
│  - Slower but more accurate                                    │
│                                                                 │
│  Result: Best of both - fast AND accurate                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Basic Reranking

### Score Combination

```python
def rerank_by_combination(initial_results, alpha=0.5):
    """Combine vector similarity with keyword matching"""
    
    reranked = []
    
    for result in initial_results:
        vector_score = result['score']  # From vector search
        keyword_score = keyword_match(result['text'], query)  # BM25 or similar
        
        # Combine scores
        combined_score = alpha * vector_score + (1 - alpha) * keyword_score
        
        reranked.append({
            **result,
            'reranked_score': combined_score
        })
    
    # Sort by combined score
    reranked.sort(key=lambda x: x['reranked_score'], reverse=True)
    
    return reranked
```

---

## Cross-Encoder Reranking

### What is Cross-Encoder?

```python
# Bi-encoder (two-stage):
# 1. Encode query → vector
# 2. Encode doc → vector
# 3. Compare vectors (fast but indirect)

# Cross-encoder (reranking):
# 1. Encode (query, doc) together
# 2. Direct classification/regression score (slow but accurate)
```

### Implementation

```python
from sentence_transformers import CrossEncoder

# Load cross-encoder
model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')

# Prepare pairs
pairs = [(query, doc) for doc in initial_candidates]

# Score pairs
scores = model.predict(pairs)

# Rerank
reranked = sorted(
    zip(initial_candidates, scores),
    key=lambda x: x[1],
    reverse=True
)
```

---

## Complete Reranking Pipeline

```python
class RerankingPipeline:
    def __init__(self, vector_store, cross_encoder_model):
        self.vector_store = vector_store
        self.cross_encoder = cross_encoder_model
    
    def retrieve_and_rerank(self, query, top_k=10, rerank_k=50):
        # Stage 1: Fast vector search (get more than needed)
        initial_results = self.vector_store.similarity_search(
            query, k=rerank_k
        )
        
        # Stage 2: Rerank with cross-encoder
        pairs = [(query, doc.page_content) for doc in initial_results]
        rerank_scores = self.cross_encoder.predict(pairs)
        
        # Combine and sort
        for doc, score in zip(initial_results, rerank_scores):
            doc.metadata['rerank_score'] = float(score)
        
        reranked = sorted(
            initial_results,
            key=lambda x: x.metadata['rerank_score'],
            reverse=True
        )
        
        return reranked[:top_k]

# Usage
pipeline = RerankingPipeline(vectorstore, cross_encoder)
results = pipeline.retrieve_and_rerank("What is the refund policy?", top_k=5)
```

---

## Advanced Reranking

### Diversity Reranking

```python
def rerank_with_diversity(results, diversity_weight=0.3):
    """Balance relevance with diversity"""
    
    reranked = []
    selected = []
    
    for result in sorted(results, key=lambda x: x['score'], reverse=True):
        if not reranked:
            reranked.append(result)
            selected.append(result['embedding'])
            continue
        
        # Calculate diversity penalty
        min_similarity = min(
            cosine_sim(result['embedding'], sel)
            for sel in selected
        )
        
        # Combine relevance and diversity
        adjusted_score = (
            (1 - diversity_weight) * result['score'] +
            diversity_weight * min_similarity
        )
        
        reranked.append({**result, 'adjusted_score': adjusted_score})
    
    return sorted(reranked, key=lambda x: x['adjusted_score'], reverse=True)
```

---

## Best Practices

```python
RERANKING_BEST_PRACTICES = {
    "first_stage_k": "Retrieve 50-100 candidates (more than final k)",
    "model_choice": "ms-marco-MiniLM-L-6-v2 for speed, ms-marco-MiniLM-L-12-v2 for quality",
    "batch_processing": "Process reranking in batches for efficiency",
    "hybrid": "Combine vector similarity + cross-encoder scores"
}
```

---

## Summary

| Technique | Speed | Accuracy |
|-----------|--------|----------|
| **Vector only** | Fast | Medium |
| **Score combination** | Fast | Good |
| **Cross-encoder** | Slow | Best |
| **Diversity reranking** | Medium | Best + diverse |

**Key insight:** Reranking trades speed for accuracy - use it when precision matters.

---

## References

- [Sentence Transformers Reranking](https://www.sbert.net/examples/applications/retrieve_rerank/)
- [MS MARCO Models](https://huggingface.co/cross-encoder)
