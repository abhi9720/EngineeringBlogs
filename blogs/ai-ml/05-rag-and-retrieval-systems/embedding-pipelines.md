---
title: Embedding Pipelines
description: Build robust embedding pipelines for RAG systems
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - RAG
  - Embeddings
  - Pipeline
  - AI
  - AI Agents
  - Production AI
coverImage: /images/embedding-pipelines.png
draft: false
order: 30
---
# Embedding Pipelines

## Overview

Embedding pipelines transform documents into vector representations efficiently and reliably for RAG systems.

---

## Pipeline Components

```
┌─────────────────────────────────────────────────────────────────┐
│              Embedding Pipeline                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Documents → Clean → Chunk → Embed → Store → Index             │
│                                                                 │
│  Each step:                                                     │
│  - Clean: Remove noise, normalize text                         │
│  - Chunk: Split into appropriate sizes                         │
│  - Embed: Convert to vectors                                   │
│  - Store: Save to vector database                              │
│  - Index: Build search index                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Complete Pipeline

```python
from langchain.document_loaders import TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import Chroma
import re

class EmbeddingPipeline:
    def __init__(self, embedding_model="text-embedding-3-small"):
        self.embeddings = OpenAIEmbeddings(model=embedding_model)
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
    
    def clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        # Remove special characters (keep punctuation)
        text = text.strip()
        return text
    
    def load(self, source: str, loader_type: str = "text"):
        """Load documents from source"""
        if loader_type == "text":
            loader = TextLoader(source)
        elif loader_type == "pdf":
            loader = PyPDFLoader(source)
        
        docs = loader.load()
        
        # Clean documents
        for doc in docs:
            doc.page_content = self.clean_text(doc.page_content)
        
        return docs
    
    def chunk(self, documents: list) -> list:
        """Split documents into chunks"""
        return self.splitter.split_documents(documents)
    
    def embed_and_store(self, chunks: list, persist_dir: str = "./vectorstore"):
        """Embed chunks and store in vector database"""
        vectorstore = Chroma.from_documents(
            documents=chunks,
            embedding=self.embeddings,
            persist_directory=persist_dir
        )
        return vectorstore
    
    def run(self, source: str, persist_dir: str = "./vectorstore"):
        """Run complete pipeline"""
        docs = self.load(source)
        chunks = self.chunk(docs)
        vectorstore = self.embed_and_store(chunks, persist_dir)
        return vectorstore

# Usage
pipeline = EmbeddingPipeline()
vectorstore = pipeline.run("./policy.pdf", persist_dir="./chroma_db")
```

---

## Batch Processing

```python
def batch_embed(chunks: list, batch_size: int = 100) -> list:
    """Embed chunks in batches"""
    
    embeddings = []
    
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        texts = [chunk.page_content for chunk in batch]
        
        # Embed batch
        batch_embeddings = embedding_model.embed_documents(texts)
        embeddings.extend(batch_embeddings)
        
        print(f"Processed {i + len(batch)} / {len(chunks)} chunks")
    
    return embeddings
```

---

## Incremental Updates

```python
def update_embeddings(vectorstore, new_documents: list):
    """Add new documents to existing vectorstore"""
    
    # Chunk new documents
    new_chunks = splitter.split_documents(new_documents)
    
    # Add to existing vectorstore
    vectorstore.add_documents(new_chunks)
    
    # Persist changes
    vectorstore.persist()
    
    return vectorstore
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| **Cleaner** | Normalize text |
| **Splitter** | Create chunks |
| **Embedder** | Convert to vectors |
| **Store** | Persist vectors |

**Key insight:** Build reusable pipelines for consistent embedding quality.

**Next:** Continue to `vector-databases-deep-dive.md` for vector database details.

---

## References

- [LangChain Embeddings](https://python.langchain.com/)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
