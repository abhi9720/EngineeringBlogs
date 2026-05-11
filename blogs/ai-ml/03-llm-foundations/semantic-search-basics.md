---
title: "Semantic Search Basics"
description: "Learn semantic search - finding information by meaning, not keywords"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - LLM
  - Semantic Search
  - Information Retrieval
  - Embeddings
  - AI
coverImage: "/images/semantic-search-basics.png"
draft: false
---

# Semantic Search Basics

## Overview

Semantic search finds information based on meaning, not just keyword matching. It uses embeddings to understand the intent behind queries.

**Think of it as:** Asking "where can I find X" instead of searching for the word "X".

---

## Keyword vs Semantic Search

```
┌─────────────────────────────────────────────────────────────────┐
│              Keyword vs Semantic Search                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Query: "How do birds fly south for winter?"                  │
│                                                                 │
│  Keyword Search:                                               │
│  - Finds: Documents containing "birds", "fly", "south", "winter"
│  - Misses: Articles about "migrating avian species"             │
│  - Finds: Documents with wrong context                          │
│                                                                 │
│  Semantic Search:                                              │
│  - Finds: Documents about bird migration                        │
│  - Understands: Intent and meaning                             │
│  - Handles: Synonyms, different phrasings                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## How Semantic Search Works

```
┌─────────────────────────────────────────────────────────────────┐
│              Semantic Search Pipeline                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Index Documents                                             │
│     "Bird migration" → [0.2, -0.5, 0.8, ...]                 │
│     "Winter travel" → [0.1, -0.3, 0.6, ...]                  │
│     "Fish behavior" → [-0.4, 0.2, 0.1, ...]                 │
│                                                                 │
│  2. Index Query                                                 │
│     "birds going south" → [0.3, -0.4, 0.7, ...]             │
│                                                                 │
│  3. Find Similar                                                │
│     Query vector vs Document vectors                            │
│     Similar vectors = semantically related!                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Simple Implementation

### Basic Semantic Search

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class SemanticSearch:
    def __init__(self, model_name='all-MiniLM-L6-v2'):
        self.model = SentenceTransformer(model_name)
        self.documents = []
        self.embeddings = None
    
    def index(self, documents):
        """Index documents for search"""
        self.documents = documents
        self.embeddings = self.model.encode(documents)
        return self
    
    def search(self, query, top_k=5):
        """Find most relevant documents"""
        
        # Embed query
        query_emb = self.model.encode(query)
        
        # Compute similarities
        similarities = np.dot(self.embeddings, query_emb)
        
        # Get top-k indices
        indices = np.argsort(similarities)[::-1][:top_k]
        
        return [
            {
                'document': self.documents[i],
                'score': float(similarities[i]),
                'index': int(i)
            }
            for i in indices
        ]

# Usage
search = SemanticSearch()
search.index([
    "Bird migration patterns in North America",
    "How penguins live in Antarctica",
    "Winter weather forecast for the northeast",
    "Air travel tips for winter months",
    "Animal adaptations to cold climates"
])

results = search.search("birds flying south for winter")
for r in results:
    print(f"{r['score']:.3f}: {r['document']}")
```

---

## Semantic vs Keyword

### Comparison

```python
# Keyword search
def keyword_search(query, documents):
    """Find documents with query keywords"""
    query_terms = query.lower().split()
    results = []
    
    for i, doc in enumerate(documents):
        doc_lower = doc.lower()
        matches = sum(1 for term in query_terms if term in doc_lower)
        if matches > 0:
            results.append((matches, i))
    
    results.sort(reverse=True)
    return results

# Test
documents = [
    "The quick brown fox jumps over the lazy dog",
    "A fast brown animal leaps",
    "Python is a programming language",
    "Brown bears are omnivores"
]

query = "brown fox"

print("Keyword search:")
for matches, idx in keyword_search(query, documents):
    print(f"  {matches} matches: {documents[idx]}")

print("\nSemantic search:")
searcher = SemanticSearch()
searcher.index(documents)
for r in searcher.search(query):
    print(f"  {r['score']:.3f}: {r['document']}")
```

---

## Handling Synonyms

```python
# Semantic search handles synonyms naturally

searcher = SemanticSearch()
searcher.index([
    "The car accelerated quickly on the highway",
    "The vehicle sped up rapidly on the road",
    "A bicycle has two wheels",
    "The automobile moved fast on the street"
])

# Different words, same meaning
query = "automobile speed"
results = searcher.search(query)

print(f"Query: '{query}'")
for r in results:
    print(f"  {r['score']:.3f}: {r['document']}")

# Semantic search finds: "car accelerated" and "vehicle sped up"
# Even though we used different words!
```

---

## HyDE: Hypothetical Document Embeddings

### Better Queries

```python
async def search_with_hyde(query, index, llm):
    """Use LLM to generate hypothetical document, then search"""
    
    # Step 1: Generate hypothetical answer
    prompt = f"""Write a brief paragraph answering this question:

Question: {query}

Your response should directly address the question."""
    
    response = await llm.generate(prompt)
    hypothetical_doc = response.content
    
    # Step 2: Embed the hypothetical answer
    query_emb = embedding_model.encode(query)
    hypo_emb = embedding_model.encode(hypothetical_doc)
    
    # Step 3: Combine or use hypothetical
    search_emb = (query_emb + hypo_emb) / 2
    
    # Step 4: Search
    return index.search(search_emb)
```

---

## Hybrid Search

### Combining Keyword + Semantic

```python
from rank_bm25 import BM25Okapi

class HybridSearch:
    def __init__(self):
        self.semantic = SemanticSearch()
        self.bm25 = None
        self.documents = []
    
    def index(self, documents):
        self.documents = documents
        
        # Semantic search
        self.semantic.index(documents)
        
        # BM25 for keyword search
        tokenized = [doc.lower().split() for doc in documents]
        self.bm25 = BM25Okapi(tokenized)
    
    def search(self, query, top_k=5, semantic_weight=0.7):
        # Semantic scores
        semantic_results = self.semantic.search(query, top_k * 2)
        semantic_scores = {r['index']: r['score'] for r in semantic_results}
        
        # Keyword scores (BM25)
        tokenized_query = query.lower().split()
        bm25_scores = self.bm25.get_scores(tokenized_query)
        
        # Normalize BM25 scores
        max_bm25 = max(bm25_scores) if max(bm25_scores) > 0 else 1
        bm25_scores = bm25_scores / max_bm25
        
        # Combine scores
        combined_scores = []
        for i in range(len(self.documents)):
            sem_score = semantic_scores.get(i, 0)
            bm25_score = bm25_scores[i]
            
            combined = semantic_weight * sem_score + (1 - semantic_weight) * bm25_score
            combined_scores.append((combined, i))
        
        # Sort and return top-k
        combined_scores.sort(reverse=True)
        
        return [
            {
                'document': self.documents[i],
                'score': score,
                'index': i
            }
            for score, i in combined_scores[:top_k]
        ]
```

---

## Best Practices

1. **Choose right embedding model**
   ```python
   # General purpose
   model = 'all-MiniLM-L6-v2'  # Fast, good quality
   
   # Better quality
   model = 'all-mpnet-base-v2'  # Slower, better
   ```

2. **Chunk long documents wisely**
   ```python
   # Split into meaningful chunks (500-1000 tokens)
   # Overlap slightly for context
   ```

3. **Use reranking for critical results**
   ```python
   # First: fast vector search
   # Then: rerank with cross-encoder for precision
   ```

---

## Summary

| Approach | Pros | Cons |
|----------|------|------|
| **Keyword** | Fast, exact matches | No semantic understanding |
| **Semantic** | Understands meaning | May miss exact matches |
| **Hybrid** | Best of both | More complex |

**Key insight:** Semantic search uses embeddings to find content by meaning, not just keywords.

**Next:** Continue to `vector-databases-intro.md` to learn about storing and searching vectors at scale.

---

## References

- [Sentence Transformers](https://www.sbert.net/)
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
- [HyDE Paper](https://arxiv.org/abs/2212.10496)