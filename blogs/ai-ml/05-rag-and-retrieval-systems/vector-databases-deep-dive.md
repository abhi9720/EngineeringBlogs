---
title: "Vector Databases Deep Dive"
description: "Compare and choose vector databases - Pinecone, Weaviate, Qdrant, Chroma, and pgvector"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - RAG
  - Vector Database
  - Pinecone
  - ChromaDB
  - AI
  - AI Agents
coverImage: "/images/vector-databases-deep-dive.png"
draft: false
---

# Vector Databases Deep Dive

## Overview

Vector databases store and search high-dimensional embeddings. Choose the right one based on scale, deployment, and features needed.

---

## Comparison

| Database | Deployment | Best For | Limitations |
|---------|------------|----------|-------------|
| **Pinecone** | Cloud | Production, managed | Vendor lock-in |
| **Chroma** | Local | Prototyping | Limited scaling |
| **Weaviate** | Both | Hybrid search | Complexity |
| **Qdrant** | Both | High performance | Self-hosted |
| **pgvector** | Both | Existing Postgres | Limited vectors |
| **Milvus** | Both | Large scale | Complexity |

---

## Pinecone

```python
import pinecone

# Initialize
pinecone.init(api_key="key", environment="us-east-1")

# Create serverless index
pinecone.create_index(
    "my-index",
    dimension=384,
    metric="cosine",
    spec={"serverless": {"cloud": "aws", "region": "us-east-1"}}
)

# Connect and use
index = pinecone.Index("my-index")

# Upsert
index.upsert([
    ("id1", [0.1]*384, {"text": "Document 1"}),
    ("id2", [0.2]*384, {"text": "Document 2"})
])

# Search
results = index.query(vector=[0.1]*384, top_k=5, include_metadata=True)
```

---

## ChromaDB

```python
import chromadb

client = chromadb.Client()
collection = client.create_collection("docs")

collection.add(
    documents=["Doc text 1", "Doc text 2"],
    embeddings=[[0.1]*384, [0.2]*384],
    ids=["id1", "id2"]
)

# Query
results = collection.query(
    query_texts=["Search query"],
    n_results=5
)
```

---

## Qdrant

```python
from qdrant_client import QdrantClient

client = QdrantClient("localhost", port=6333)

# Create collection
client.recreate_collection(
    collection_name="docs",
    vectors_config={"size": 384, "distance": "Cosine"}
)

# Add points
client.upsert(
    collection_name="docs",
    points=[
        {"id": 1, "vector": [0.1]*384, "payload": {"text": "Doc 1"}}
    ]
)

# Search
results = client.search(collection_name="docs", query_vector=[0.1]*384, limit=5)
```

---

## Weaviate

```python
import weaviate

client = weaviate.Client("http://localhost:8080")

# Add data
client.data_object.create(
    class_name="Document",
    data_object={"content": "Document text"}
)

# Search
result = client.query.get(
    "Document", ["content"]
).with_near_text({"concepts": ["search query"]}).do()
```

---

## pgvector (PostgreSQL)

```python
from pgvector.sqlalchemy import Vector
from sqlalchemy import create_engine, Column, Integer, String, Vector

# Setup
engine = create_engine("postgresql://user:pass@localhost/db")

# Create table
class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True)
    content = Column(String)
    embedding = Column(Vector(384))

# Insert
db.execute(Document.__table__.insert(), [
    {"content": "Text 1", "embedding": [0.1]*384}
])

# Search
db.execute(text("""
    SELECT content, embedding <=> :query AS distance
    FROM documents
    ORDER BY embedding <=> :query
    LIMIT 5
"""))
```

---

## Choosing Guide

```python
def choose_vector_db(use_case):
    if use_case == "quick_prototype":
        return "Chroma"  # Local, simple
    
    elif use_case == "production_managed":
        return "Pinecone"  # Cloud, no ops
    
    elif use_case == "high_performance":
        return "Qdrant"  # Fast, open source
    
    elif use_case == "existing_postgres":
        return "pgvector"  # Extend existing
    
    elif use_case == "hybrid_search":
        return "Weaviate"  # Built-in BM25
    
    return "Chroma"  # Default
```

---

## Summary

| Use Case | Recommended DB |
|----------|---------------|
| **Quick start** | Chroma |
| **Production** | Pinecone |
| **Self-hosted** | Qdrant |
| **Already using PG** | pgvector |
| **Hybrid search** | Weaviate |

**Key insight:** Match database to deployment needs and scale requirements.

---

## References

- [Pinecone Docs](https://docs.pinecone.io/)
- [ChromaDB](https://docs.trychroma.com/)
- [Qdrant](https://qdrant.tech/documentation/)
- [Weaviate](https://weaviate.io/developers/weaviate)
- [pgvector](https://github.com/pgvector/pgvector)