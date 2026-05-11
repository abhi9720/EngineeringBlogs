---
title: "Chunking Strategies"
description: "Master document chunking - how to split documents for optimal retrieval"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - RAG
  - Chunking
  - Document Processing
  - AI
  - AI Agents
coverImage: "/images/chunking-strategies.png"
draft: false
---

# Chunking Strategies

## Overview

Chunking determines how documents are split for retrieval. Good chunks improve relevance; bad chunks cause missed context or noise.

**Think of it as:** Finding the right "paragraph size" for answering questions.

---

## Why Chunking Matters

```
┌─────────────────────────────────────────────────────────────────┐
│              Chunk Size Impact                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Too Small:                                                    │
│  ┌──────────────┐                                              │
│  │ Chunk 1     │  "The refund policy..."                   │
│  └──────────────┘                                              │
│  ┌──────────────┐                                              │
│  │ Chunk 2     │  "...is valid for 30 days"                 │
│  └──────────────┘                                              │
│  Problem: Question spans chunks, neither has full answer       │
│                                                                 │
│  Too Large:                                                    │
│  ┌────────────────────────────────────────────────────┐       │
│  │ Chunk: Entire document + 100 pages + appendix       │       │
│  └────────────────────────────────────────────────────┘       │
│  Problem: Too much noise, dilutes relevance                   │
│                                                                 │
│  Just Right:                                                   │
│  ┌────────────────────┐ ┌────────────────────┐              │
│  │ Complete thought   │ │ Complete thought   │              │
│  │ Self-contained     │ │ Self-contained     │              │
│  └────────────────────┘ └────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Basic Strategies

### Fixed Size Chunking

```python
from langchain.text_splitter import CharacterTextSplitter

splitter = CharacterTextSplitter(
    chunk_size=1000,  # Characters
    chunk_overlap=200,  # Overlap between chunks
    separator="\n"  # Preferred separator
)

chunks = splitter.split_text(long_text)
```

### Recursive Chunking

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Tries multiple separators in order
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""]  # Paragraph → Sentence → Word
)

chunks = splitter.split_text(text)
```

---

## Semantic Chunking

### By Meaning

```python
from langchain.text_splitter import RecursiveTextSplitter
from semantic_chunker import SemanticChunker

# Use embeddings to find natural breaks
chunker = SemanticChunker(
    embedding_model=embeddings,
    buffer_size=1,  # Sentences to compare
    breakpoint_threshold=0.95  # Similarity threshold
)

chunks = chunker.chunk_text(document)
```

### Sentence-Based

```python
from langchain.text_splitter import SentenceTextSplitter

splitter = SentenceTextSplitter(
    chunk_size=5,  # Number of sentences per chunk
    overlap=1      # Sentences to overlap
)

chunks = splitter.split_text(text)
```

---

## Document-Specific Chunking

### Code

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Split by language-specific structures
def split_code(code: str, language: str) -> list:
    
    if language == "python":
        # Split by function/class definitions
        separator = "\ndef |\nclass "
    elif language == "javascript":
        separator = "\nfunction |\nexport "
    else:
        separator = "\n\n"
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        separator=separator
    )
    
    return splitter.split_text(code)
```

### Markdown

```python
def split_markdown(markdown_text: str) -> list:
    """Split markdown by headers"""
    
    import re
    
    # Split by headers
    pattern = r'\n(?=#+)'
    sections = re.split(pattern, markdown_text)
    
    chunks = []
    current_chunk = ""
    
    for section in sections:
        if len(current_chunk) + len(section) < 1000:
            current_chunk += section + "\n\n"
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = section
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks
```

---

## Metadata Preservation

```python
def chunk_with_metadata(documents: list, splitter) -> list:
    """Chunk while preserving metadata"""
    
    chunks = []
    
    for doc in documents:
        texts = splitter.split_text(doc.page_content)
        
        for i, chunk_text in enumerate(texts):
            chunks.append({
                "content": chunk_text,
                "metadata": {
                    **doc.metadata,
                    "chunk_index": i,
                    "total_chunks": len(texts)
                }
            })
    
    return chunks
```

---

## Best Practices

```python
CHUNKING_BEST_PRACTICES = {
    "size": "1000-2000 chars is a good starting point",
    "overlap": "10-20% overlap preserves context",
    "natural_breaks": "Split at paragraph/section boundaries when possible",
    "preserve_context": "Include enough context for standalone understanding",
    "metadata": "Track source, page numbers, chunk index"
}
```

---

## Summary

| Strategy | Best For | Pros | Cons |
|----------|----------|------|------|
| **Fixed size** | Simple documents | Fast, consistent | May split mid-thought |
| **Recursive** | Mixed content | Flexible | May need tuning |
| **Semantic** | Natural text | Natural breaks | Slower |
| **By structure** | Code, markdown | Preserves structure | Document-specific |

**Key insight:** Match chunking strategy to document structure and use case.

**Next:** Continue to `embedding-pipelines.md` for creating embedding pipelines.

---

## References

- [LangChain Text Splitters](https://python.langchain.com/)
- [Semantic Chunking](https://github.com/FullStackRetrieval-com/semantic-chunker)