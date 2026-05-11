---
title: "Vector Databases Intro"
description: "Introduction to vector databases - storing and searching embeddings at scale"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - LLM
  - Vector Database
  - ChromaDB
  - Pinecone
  - Embeddings
  - AI
coverImage: "/images/vector-databases-intro.png"
draft: false
---

# Vector Databases Intro

## Overview

Vector databases store high-dimensional embeddings and enable fast similarity search at scale. They're essential for RAG, semantic search, and recommendation systems.

**Think of it as:** A specialized database optimized for finding similar items, not exact matches.

---

## Why Vector Databases?

```
┌─────────────────────────────────────────────────────────────────┐
│              The Problem with Regular Databases                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SQL Query: "Find products similar to 'running shoes'"        │
│                                                                 │
│  Problem:                                                       │
│  - SQL can't compare meaning                                    │
│  - "running shoes" ≠ "jogging sneakers"                       │
│  - Exact match fails on synonyms                               │
│                                                                 │
│  Solution: Vector Database!                                    │
│                                                                 │
│  Query: "Find vectors similar to running_shoes_vector"         │
│  - Compares meanings                                           │
│  - Finds "jogging sneakers"                                   │
│  - Finds "track footwear"                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Popular Vector Databases

| Database | Type | Best For |
|----------|------|----------|
| **Pinecone** | Cloud | Production, managed |
| **Chroma** | Open source | Prototyping, local |
| **Weaviate** | Open source | Hybrid search |
| **Qdrant** | Open source | High performance |
| **Milvus** | Open source | Scale, enterprise |
| **pgvector** | PostgreSQL ext | Existing PG users |

---

## ChromaDB (Local/Prototyping)

### Getting Started

```python
import chromadb

# Create client
client = chromadb.Client()

# Create collection
collection = client.create_collection(
    name="my_documents",
    metadata={"description": "My document embeddings"}
)

# Add documents with embeddings
collection.add(
    documents=[
        "Machine learning is a subset of AI",
        "Deep learning uses neural networks",
        "Python is a programming language"
    ],
    ids=["doc1", "doc2", "doc3"],
    embeddings=[
        [0.1, 0.2, ...],  # 384-dim
        [0.3, 0.4, ...],
        [0.5, 0.6, ...]
    ]
)

# Query
results = collection.query(
    query_texts=["What is deep learning?"],
    n_results=2
)

print(results)
```

### With Metadata

```python
collection.add(
    documents=["Document text here"],
    ids=["doc1"],
    embeddings=[[0.1, 0.2, ...]],
    metadatas=[{
        "source": "blog",
        "author": "John",
        "date": "2024-01-01"
    }]
)

# Query with metadata filter
results = collection.query(
    query_texts=["Python tutorial"],
    n_results=5,
    where={"source": "blog"}  # Filter by metadata
)
```

---

## Pinecone (Cloud/Production)

### Setup

```python
import pinecone

# Initialize
pinecone.init(api_key="your-api-key", environment="us-east-1")

# Create index
pinecone.create_index(
    name="my-index",
    dimension=384,
    metric="cosine"  # cosine, euclidean, dotproduct
)

# Connect
index = pinecone.Index("my-index")

# Upsert vectors
index.upsert(vectors=[
    ("id1", [0.1, 0.2, ...], {"source": "blog"}),
    ("id2", [0.3, 0.4, ...], {"source": "docs"}),
])

# Query
results = index.query(
    vector=[0.1, 0.2, ...],
    top_k=5,
    include_metadata=True
)

print(results)
```

---

## Weaviate (Open Source)

```python
import weaviate

client = weaviate.Client("http://localhost:8080")

# Add data
client.data_object.create(
    class_name="Document",
    data_object={
        "content": "Machine learning is great",
        "category": "AI"
    }
)

# Query with near text
result = client.query.get(
    "Document",
    ["content", "category"]
).with_near_text({
    "concepts": ["deep learning neural networks"]
}).do()

print(result)
```

---

## Similarity Search

### Basic Operations

```python
# Index documents
def index_documents(collection, documents, embeddings):
    collection.add(
        documents=documents,
        ids=[f"doc_{i}" for i in range(len(documents))],
        embeddings=embeddings
    )

# Search
def search_similar(collection, query, top_k=5):
    results = collection.query(
        query_texts=[query],
        n_results=top_k
    )
    return results

# Example
results = search_similar(
    collection,
    query="What is machine learning?",
    top_k=3
)

for doc, score in zip(results['documents'][0], results['distances'][0]):
    print(f"{1-score:.3f}: {doc}")  # Convert distance to similarity
```

---

## Indexing Strategies

### ANN Indexes

```python
# Approximate Nearest Neighbor (ANN) indexes
# Trade small accuracy for huge speed improvements

INDEX_TYPES = {
    "IVF": "Inverted file - divides space into clusters",
    "HNSW": "Hierarchical NSW - graph-based, fast",
    "PQ": "Product quantization - compression"
}

# In Pinecone:
index = pinecone.Index("my-index")

# For HNSW (default in Pinecone):
# - ef_construction: Build quality (higher = better, slower)
# - m: Connections per node (higher = better, more memory)

pinecone.create_index(
    name="my-index",
    dimension=384,
    metric="cosine",
    pod_type="starter",
    # HNSW params (if using S1 pod)
    # spec=ServerlessSpec(cloud="aws", region="us-west-2")
)
```

---

## Filtering with Metadata

```python
# ChromaDB filtering
results = collection.query(
    query_texts=["Python programming"],
    n_results=10,
    where={
        "category": {"$eq": "tutorial"},
        "date": {"$gte": "2024-01-01"}
    },
    where_document={
        "$contains": "machine learning"
    }
)

# Pinecone filtering
index.query(
    vector=query_vector,
    top_k=10,
    filter={
        "category": {"$eq": "tutorial"},
        "year": {"$gte": 2024}
    }
)
```

---

## Best Practices

1. **Choose right dimensions**
   ```python
   # Match your embedding model
   model_dims = {
       'all-MiniLM-L6-v2': 384,
       'all-mpnet-base-v2': 768,
       'text-embedding-3-large': 3072,
   }
   ```

2. **Batch inserts**
   ```python
   # Insert in batches for efficiency
   batch_size = 100
   for i in range(0, len(docs), batch_size):
       batch = docs[i:i+batch_size]
       collection.add(documents=batch, ids=[f"doc_{i+j}" for j in range(len(batch))])
   ```

3. **Use appropriate metric**
   ```python
   # Cosine: for text embeddings (most common)
   # Euclidean: for clustering, image embeddings
   # Dot: for normalized vectors, ranking
   ```

---

## Summary

| Database | Deployment | Cost | Complexity |
|----------|-------------|------|------------|
| **Chroma** | Local | Free | Low |
| **Pinecone** | Cloud | Pay | Low |
| **Weaviate** | Both | Free/Cloud | Medium |
| **Qdrant** | Both | Free/Cloud | Medium |
| **pgvector** | Both | Free | Low (if using PG) |

**Key insight:** Vector databases enable fast similarity search over embeddings, essential for semantic search and RAG.

**Next:** Continue to `04-llm-applications/prompt-engineering.md` to learn how to interact with LLMs effectively.

---

## References

- [ChromaDB](https://docs.trychroma.com/)
- [Pinecone](https://docs.pinecone.io/)
- [Weaviate](https://weaviate.io/developers/weaviate)
- [Qdrant](https://qdrant.tech/documentation/)