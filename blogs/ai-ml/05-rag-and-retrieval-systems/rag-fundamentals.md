---
title: RAG Fundamentals
description: 'Master RAG fundamentals - retrieval, augmentation, and generation'
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - RAG
  - LLM
  - AI
  - AI Agents
  - Production AI
coverImage: /images/rag-fundamentals.png
draft: false
order: 50
---
# RAG Fundamentals

## Overview

RAG has three stages: Retrieve relevant documents, Augment the prompt with context, Generate answers grounded in retrieved information.

---

## The RAG Loop

```
┌─────────────────────────────────────────────────────────────────┐
│              RAG: Retrieve → Augment → Generate                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. RETRIEVE                                                   │
│     Query → Embed → Vector Search → Relevant Documents         │
│                                                                 │
│  2. AUGMENT                                                    │
│     Prompt + Context + Query → Grounded Prompt                 │
│                                                                 │
│  3. GENERATE                                                   │
│     LLM + Grounded Prompt → Grounded Answer                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Retrieval Fundamentals

### How Vector Search Works

```python
# 1. Query embedding
query_vector = embedding_model.encode("What is the refund policy?")

# 2. Compare with document vectors
# Using cosine similarity
from sklearn.metrics.pairwise import cosine_similarity

similarities = cosine_similarity([query_vector], document_vectors)

# 3. Return top-k most similar
top_indices = np.argsort(similarities[0])[-k:][::-1]
```

### Retrieval Quality

```python
# Factors affecting retrieval:

RETRIEVAL_FACTORS = {
    "chunk_size": "Too small = missing context, too large = noise",
    "chunk_overlap": "Preserves context across chunks",
    "embedding_model": "Different models for different use cases",
    "metadata": "Use for filtering and tracing",
    "k_value": "Too few = missing context, too many = dilution"
}
```

---

## Augmentation Fundamentals

### Prompt Structure

```python
AUGMENTATION_TEMPLATE = """
You are a helpful assistant. Use the following context to answer the question.

CONTEXT:
{context}

QUESTION:
{question}

GUIDELINES:
- Answer based only on the context
- If the context doesn't contain the answer, say so
- Be specific and cite relevant details
"""

# The context is formatted from retrieved documents
context = "\n\n".join([doc.page_content for doc in retrieved_docs])

final_prompt = AUGMENTATION_TEMPLATE.format(
    context=context,
    question=question
)
```

### Context Formatting

```python
def format_context(documents: list, source_field: str = "page_content") -> str:
    """Format retrieved documents for prompt"""
    
    formatted = []
    
    for i, doc in enumerate(documents, 1):
        content = getattr(doc, source_field, str(doc))
        source = doc.metadata.get("source", "Unknown")
        
        formatted.append(
            f"[Document {i}] (Source: {source})\n{content}"
        )
    
    return "\n\n---\n\n".join(formatted)
```

---

## Generation Fundamentals

### Grounded Generation

```python
async def generate_with_rag(query: str, retriever, llm) -> str:
    """Complete RAG generation"""
    
    # 1. Retrieve
    docs = retriever.get_relevant_documents(query)
    
    # 2. Format context
    context = format_context(docs)
    
    # 3. Create prompt
    prompt = AUGMENTATION_TEMPLATE.format(
        context=context,
        question=query
    )
    
    # 4. Generate
    response = await llm.agenerate([prompt])
    
    return response.generations[0][0].text
```

### Answer Quality

```python
# Factors affecting generation:

GENERATION_FACTORS = {
    "llm_quality": "Better models = better answers",
    "prompt_clarity": "Clear instructions = better results",
    "context_relevance": "Garbage in = garbage out",
    "context_volume": "Balance between enough and too much"
}
```

---

## RAG Evaluation

### Retrieval Metrics

```python
from sklearn.metrics import precision_score, recall_score

def evaluate_retrieval(retrieved: list, relevant: list, k: int) -> dict:
    """Evaluate retrieval at k"""
    
    retrieved_k = set(retrieved[:k])
    relevant_set = set(relevant)
    
    precision = len(retrieved_k & relevant_set) / k
    recall = len(retrieved_k & relevant_set) / len(relevant_set) if relevant_set else 0
    
    return {
        "precision@k": precision,
        "recall@k": recall,
        "f1@ k": 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    }
```

### End-to-End Evaluation

```python
def evaluate_rag(question: str, ground_truth: str, rag_system) -> dict:
    """Evaluate complete RAG system"""
    
    # Generate answer
    answer = rag_system.answer(question)
    
    # Simple metrics (in practice, use more sophisticated evaluation)
    return {
        "answer_length": len(answer),
        "contains_answer": ground_truth.lower() in answer.lower(),
        "faithful_to_context": check_faithfulness(answer)  # Complex in practice
    }
```

---

## Summary

| Stage | Purpose | Key Techniques |
|-------|---------|----------------|
| **Retrieve** | Find relevant documents | Vector search, filtering |
| **Augment** | Add context to prompt | Template formatting |
| **Generate** | Produce grounded answer | LLM with clear instructions |

**Key insight:** All three stages must work well for good RAG performance.

**Next:** Continue to `chunking-strategies.md` for document chunking.

---

## References

- [RAG Survey](https://arxiv.org/abs/2312.10997)
- [LangChain RAG](https://python.langchain.com/)
