---
title: "RAG Optimization"
description: "Optimize RAG systems for better accuracy, speed, and cost"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - RAG
  - Optimization
  - AI
  - AI Agents
  - Production AI
coverImage: "/images/rag-optimization.png"
draft: false
---

# RAG Optimization

## Overview

Optimize RAG systems for better retrieval accuracy, lower latency, and reduced costs.

---

## Retrieval Optimization

### Query Expansion

```python
async def expand_query(query, llm):
    """Generate multiple query variations"""
    
    prompt = f"""Generate 3 different versions of this query
that might appear in a search. Make them varied in wording.

Query: {query}

Variations:"""
    
    response = await llm.generate(prompt)
    
    # Parse and use all variations
    variations = parse_variations(response)
    
    # Search with all, combine results
    all_results = []
    for var in variations:
        results = vectorstore.search(var, k=10)
        all_results.extend(results)
    
    # Deduplicate and rerank
    return deduplicate_and_rerank(all_results)
```

### HyDE (Hypothetical Document Embeddings)

```python
async def hyde_search(query, llm, vectorstore):
    """Generate hypothetical answer, then search"""
    
    # Generate hypothetical answer
    prompt = f"""Write a brief paragraph answering this question.
Return ONLY the paragraph, nothing else.

Question: {query}"""
    
    hypothetical = await llm.generate(prompt)
    
    # Search with both query and hypothetical
    query_emb = embedding_model.encode(query)
    hypo_emb = embedding_model.encode(hypothetical)
    
    # Combine embeddings
    combined_emb = (query_emb + hypo_emb) / 2
    
    # Search
    return vectorstore.similarity_search_vector(combined_emb, k=10)
```

---

## Performance Optimization

### Caching

```python
import hashlib

class SemanticCache:
    def __init__(self, redis_client, embedding_model, threshold=0.95):
        self.redis = redis_client
        self.embedder = embedding_model
        self.threshold = threshold
    
    def get_or_compute(self, query, compute_fn):
        # Embed query
        query_emb = self.embedder.encode(query)
        
        # Check cache
        cached = self.redis.get(f"cache:{hash(query_emb)}")
        if cached:
            return json.loads(cached)
        
        # Compute
        result = compute_fn(query)
        
        # Cache
        self.redis.setex(f"cache:{hash(query_emb)}", 3600, json.dumps(result))
        
        return result
```

### Batch Processing

```python
def batch_retrieve(queries, vectorstore, batch_size=50):
    """Process multiple queries efficiently"""
    
    all_results = []
    
    for i in range(0, len(queries), batch_size):
        batch = queries[i:i+batch_size]
        
        # Batch encode
        embeddings = embedder.encode(batch)
        
        # Batch search
        for query, emb in zip(batch, embeddings):
            results = vectorstore.similarity_search_vector(emb, k=5)
            all_results.append(results)
    
    return all_results
```

---

## Cost Optimization

### Token Reduction

```python
def smart_context_window(query, documents, max_tokens=4000):
    """Select most relevant context within token limit"""
    
    total_tokens = 0
    selected_docs = []
    
    for doc in sorted_by_relevance(documents, query):
        doc_tokens = count_tokens(doc.page_content)
        
        if total_tokens + doc_tokens <= max_tokens:
            selected_docs.append(doc)
            total_tokens += doc_tokens
        elif total_tokens < max_tokens // 2:
            # Still add if we're under half capacity
            selected_docs.append(doc)
            total_tokens += doc_tokens
        else:
            break
    
    return selected_docs
```

---

## Quality Optimization

### Self-Query Retrieval

```python
from langchain.retrievers import SelfQueryRetriever
from langchain.chains.query_constructor.base import AttributeInfo

# Define document schema
metadata_field_info = [
    AttributeInfo(
        name="source",
        description="The source of the document",
        type="string"
    ),
    AttributeInfo(
        name="date",
        description="Publication date",
        type="date"
    )
]

# Create retriever with automatic filtering
retriever = SelfQueryRetriever.from_llm(
    llm=llm,
    vectorstore=vectorstore,
    document_contents="Medical research papers",
    metadata_field_info=metadata_field_info
)

# Natural language query with automatic filtering
results = retriever.get_relevant_documents(
    "Papers about AI from 2024"
)
```

---

## Summary

| Optimization | Impact |
|--------------|--------|
| **Query expansion** | Better recall |
| **Caching** | Lower cost, faster |
| **Batch processing** | Higher throughput |
| **Token reduction** | Lower cost |
| **Self-querying** | Better filtering |

**Key insight:** Optimize retrieval, generation, and infrastructure holistically.

---

## References

- [LangChain RAG](https://python.langchain.com/)
- [RAG Optimization Guide](https://github.com/NVIDIA/RAGWORKS)