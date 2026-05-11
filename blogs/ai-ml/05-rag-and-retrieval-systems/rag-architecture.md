---
title: "RAG Architecture"
description: "Deep dive into RAG architecture - components, data flow, and implementation patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - RAG
  - LLM
  - Architecture
  - AI
  - Production AI
  - AI Agents
coverImage: "/images/rag-architecture.png"
draft: false
---

# RAG Architecture

## Overview

Understanding RAG architecture helps you build robust systems that reliably answer questions from your data.

---

## Complete Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Complete RAG System                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              INDEXING PIPELINE                          │   │
│  │                                                         │   │
│  │  Documents → Loader → Splitter → Embed → Store          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              QUERY PIPELINE                            │   │
│  │                                                         │   │
│  │  Query → Embed → Retrieve → Rerank → Augment → Generate │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Indexing Pipeline

### Document Loading

```python
from langchain.document_loaders import (
    TextLoader, PyPDFLoader, WebBaseLoader, 
    CSVLoader, UnstructuredHTMLLoader
)

# Text files
loader = TextLoader("policy.txt")
docs = loader.load()

# PDFs
loader = PyPDFLoader("document.pdf")
docs = loader.load()

# Web pages
loader = WebBaseLoader(["https://example.com/docs"])
docs = loader.load()

# Multiple files
from langchain.document_loaders import DirectoryLoader
loader = DirectoryLoader("./docs/", glob="**/*.pdf")
docs = loader.load()
```

### Text Splitting

```python
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    CharacterTextSplitter
)

# Recursive (recommended)
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,      # Characters per chunk
    chunk_overlap=200,    # Overlap for context
    separators=["\n\n", "\n", " ", ""]  # Split priorities
)

# By sentences
from langchain.text_splitter import SentenceTextSplitter
splitter = SentenceTextSplitter(chunk_size=500)

chunks = splitter.split_documents(docs)
```

### Embedding and Storage

```python
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import Chroma

# Create embeddings
embeddings = OpenAIEmbeddings()

# Store in Chroma (local)
vectorstore = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="./chroma_db"
)

# Or Pinecone (cloud)
from langchain.vectorstores import Pinecone
vectorstore = Pinecone.from_documents(
    documents=chunks,
    embedding=embeddings,
    index_name="my-index"
)
```

---

## Query Pipeline

### Basic Retrieval

```python
# Simple retrieval
results = vectorstore.similarity_search(
    query="What is the refund policy?",
    k=3  # Top 3 results
)

for doc in results:
    print(doc.page_content)
    print(f"Source: {doc.metadata}")
```

### Retrieval with Scores

```python
# Get results with similarity scores
results = vectorstore.similarity_search_with_score(
    query="What is the refund policy?",
    k=5
)

for doc, score in results:
    print(f"Score: {score:.3f}")
    print(f"Content: {doc.page_content[:100]}...")
    print()
```

---

## Advanced Retrieval

### MMR (Max Marginal Relevance)

```python
# Balance relevance with diversity
results = vectorstore.max_marginal_relevance_search(
    query="What is the refund policy?",
    k=5,  # Total results
    fetch_k=20,  # Initial candidates
    lambda_mult=0.5  # Balance (0=relevance, 1=diversity)
)
```

### Metadata Filtering

```python
# Filter by metadata
results = vectorstore.similarity_search(
    query="Python programming",
    k=5,
    filter={"source": "tutorial"}  # Only from tutorials
)

# Complex filters
filter = {
    "$and": [
        {"source": {"$eq": "docs"}},
        {"date": {"$gte": "2024-01-01"}}
    ]
}
```

---

## Query Augmentation

### Template

```python
from langchain.prompts import PromptTemplate

template = """Use the following context to answer the question.

Context:
{context}

Question: {question}

Answer based only on the context above."""

prompt = PromptTemplate(
    template=template,
    input_variables=["context", "question"]
)
```

### Complete QA Chain

```python
from langchain.chains import RetrievalQA
from langchain.llms import OpenAI

# Create chain
qa = RetrievalQA.from_chain_type(
    llm=OpenAI(temperature=0),
    chain_type="stuff",  # All context in one prompt
    retriever=vectorstore.as_retriever(),
    return_source_documents=True,  # Return sources
    chain_type_kwargs={"prompt": prompt}
)

# Query
result = qa({"query": "What is the refund policy?"})
print(result["result"])
print("\nSources:")
for doc in result["source_documents"]:
    print(f"- {doc.metadata.get('source', 'Unknown')}")
```

---

## Chain Types

### Stuff (Simple)

```python
# Put all retrieved docs in one prompt
qa = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",
    retriever=retriever
)
# Best for: <5K tokens of context
```

### Map-Reduce (Large Documents)

```python
# Process each doc separately, then combine
qa = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="map_reduce",
    retriever=retriever
)
# Best for: Summarizing many documents
```

### Refine (Iterative)

```python
# Build on previous answer
qa = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="refine",
    retriever=retriever
)
# Best for: Building comprehensive answers
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| **Loader** | Read documents |
| **Splitter** | Chunk documents |
| **Embedder** | Convert to vectors |
| **Vector Store** | Store and search |
| **Retriever** | Find relevant chunks |
| **Chain** | Generate answer |

**Key insight:** Modular design lets you swap components as needed.

**Next:** Continue to `rag-fundamentals.md` for detailed implementation.

---

## References

- [LangChain RAG](https://python.langchain.com/)
- [LlamaIndex](https://www.llamaindex.ai/)