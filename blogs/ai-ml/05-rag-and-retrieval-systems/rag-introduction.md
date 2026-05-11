---
title: "RAG Introduction"
description: "Learn what RAG is and why it matters - connecting LLMs to your data"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - RAG
  - LLM
  - Retrieval
  - AI
  - AI Agents
  - Production AI
coverImage: "/images/rag-introduction.png"
draft: false
---

# RAG Introduction

## Overview

Retrieval-Augmented Generation (RAG) connects LLMs to your data, enabling accurate, up-to-date responses grounded in your documents.

**Think of it as:** Giving the LLM a textbook to look up answers from.

---

## Why RAG?

```
┌─────────────────────────────────────────────────────────────────┐
│              The Problem Without RAG                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User: "What's our refund policy?"                            │
│                                                                 │
│  ❌ LLM: "I'm an AI, I don't know your specific policies"   │
│  ❌ LLM: Generates generic/hallucinated response             │
│  ❌ LLM: Outdated information from training                  │
│                                                                 │
│  With RAG:                                                      │
│                                                                 │
│  ✅ System retrieves your refund policy document               │
│  ✅ LLM generates answer from your actual policy              │
│  ✅ Accurate, current, specific to your business              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## How RAG Works

```
┌─────────────────────────────────────────────────────────────────┐
│              RAG Flow                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Indexing (One-time):                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Documents → Chunks → Embeddings → Vector DB          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Querying (Real-time):                                         │
│                                                                 │
│  Query: "What's the refund policy?"                           │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Embed Query → Search Vector DB → Get Relevant Chunks  │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Prompt: Context + Query → LLM → Answer                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Simple RAG Implementation

### With LangChain

```python
from langchain.document_loaders import TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import Chroma
from langchain.chains import RetrievalQA
from langchain.llms import OpenAI

# 1. Load documents
loader = TextLoader("policy.txt")
documents = loader.load()

# 2. Split into chunks
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
chunks = splitter.split_documents(documents)

# 3. Create embeddings and store
vectorstore = Chroma.from_documents(chunks, OpenAIEmbeddings())

# 4. Create retriever
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

# 5. Create QA chain
qa = RetrievalQA.from_chain_type(
    llm=OpenAI(),
    chain_type="stuff",
    retriever=retriever
)

# 6. Query
result = qa({"query": "What's the refund policy?"})
print(result["result"])
```

---

## When to Use RAG

### Good Fits

```python
RAG_GOOD = {
    "qa_from_documents": "Answer questions from your docs",
    "chat_with_context": "Conversations grounded in data",
    "research_assistant": "Synthesize info from many sources",
    "domain_specific": "Specialized knowledge (legal, medical, etc.)",
    "up_to_date": "Information changes frequently"
}
```

### Bad Fits

```python
RAG_BAD = {
    "creative_writing": "No external data needed",
    "general_knowledge": "Wikipedia-style facts",
    "math_calculations": "Not retrieval-based",
    "very_short_queries": "Overkill for simple questions"
}
```

---

## RAG vs Fine-tuning

```python
COMPARISON = {
    "RAG": {
        "data_needed": "Documents (no labeling needed)",
        "setup_time": "Hours",
        "cost": "Embedding + storage costs",
        "best_for": "Specific documents, frequently changing data",
        "updates": "Easy - just update documents"
    },
    "Fine-tuning": {
        "data_needed": "Labeled examples (1000s needed)",
        "setup_time": "Days to weeks",
        "cost": "Training + inference costs",
        "best_for": "Specific behavior, format, terminology",
        "updates": "Expensive - retraining required"
    }
}
```

---

## RAG Components

```
┌─────────────────────────────────────────────────────────────────┐
│              RAG Components                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Document Loader: Reads PDFs, docs, websites, databases        │
│          │                                                      │
│          ▼                                                      │
│  Text Splitter: Breaks into chunks                            │
│          │                                                      │
│          ▼                                                      │
│  Embedding Model: Converts text to vectors                     │
│          │                                                      │
│          ▼                                                      │
│  Vector Store: Stores and searches embeddings                  │
│          │                                                      │
│          ▼                                                      │
│  Retriever: Finds relevant chunks for query                   │
│          │                                                      │
│          ▼                                                      │
│  LLM: Generates answer from context                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Decisions

### Chunk Size

```python
CHUNK_SIZES = {
    "512": "Good for precise extraction",
    "1000": "Balanced (recommended starting point)",
    "2000": "More context, may dilute relevance",
    "4000+": "Long context needed, less precise"
}

# Rule of thumb:
# Smaller chunks = more precise, less context
# Larger chunks = more context, less precise
```

### Retrieval Parameters

```python
RETRIEVAL_CONFIG = {
    "k": 3,  # Number of chunks to retrieve
    "fetch_k": 10,  # Initial candidates before reranking
    "lambda_mult": 0.5,  # Balance relevance vs diversity
}
```

---

## Summary

| Aspect | Description |
|--------|-------------|
| **RAG** | Retrieval-Augmented Generation |
| **Purpose** | Ground LLM responses in your data |
| **Key benefit** | Accurate, current, specific answers |
| **Components** | Loader → Splitter → Embedder → Vector DB → LLM |

**Key insight:** RAG connects LLMs to your data without expensive fine-tuning.

**Next:** Continue to `rag-architecture.md` for detailed RAG architecture.

---

## References

- [LangChain RAG](https://python.langchain.com/)
- [LlamaIndex](https://www.llamaindex.ai/)