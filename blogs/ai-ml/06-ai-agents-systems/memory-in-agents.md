---
title: "Memory in Agents"
description: "Implement memory systems for agents - short-term, long-term, and semantic memory"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - AI Agents
  - Memory
  - Context
  - AI
coverImage: "/images/memory-in-agents.png"
draft: false
---

# Memory in Agents

## Overview

Agents need memory to maintain context, learn from past experiences, and build knowledge over time.

---

## Memory Types

```
┌─────────────────────────────────────────────────────────────────┐
│              Agent Memory Types                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Short-Term (Working Memory):                                  │
│  - Current conversation context                                 │
│  - Active task information                                     │
│  - Temporary calculations                                       │
│                                                                 │
│  Long-Term Memory:                                             │
│  - Past interactions                                           │
│  - Learned facts                                               │
│  - User preferences                                            │
│                                                                 │
│  Semantic Memory:                                              │
│  - Structured knowledge                                       │
│  - Facts and concepts                                          │
│  - Retrieved from vector store                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### Working Memory

```python
class WorkingMemory:
    def __init__(self, max_tokens=8000):
        self.max_tokens = max_tokens
        self.messages = []
    
    def add(self, role, content):
        self.messages.append({"role": role, "content": content})
        self.prune()
    
    def prune(self):
        """Remove old messages if over limit"""
        while self.token_count() > self.max_tokens and len(self.messages) > 2:
            self.messages.pop(0)
    
    def get_context(self):
        return self.messages
```

### Long-Term Memory with Vector Store

```python
class LongTermMemory:
    def __init__(self, vectorstore):
        self.vectorstore = vectorstore
    
    def add(self, experience, metadata=None):
        """Store experience"""
        self.vectorstore.add_texts(
            texts=[experience],
            metadatas=[metadata or {}]
        )
    
    def retrieve(self, query, k=5):
        """Get relevant past experiences"""
        return self.vectorstore.similarity_search(query, k=k)
```

---

## Memory Management

```python
class AgentMemory:
    def __init__(self):
        self.working = WorkingMemory()
        self.longterm = LongTermMemory()
        self.summarizer = Summarizer()
    
    def add_interaction(self, user_input, agent_response):
        # Add to working memory
        self.working.add("user", user_input)
        self.working.add("assistant", agent_response)
        
        # Periodically summarize to long-term
        if self.working.should_summarize():
            summary = self.summarizer.summarize(self.working.messages)
            self.longterm.add(summary, {"type": "conversation_summary"})
    
    def get_relevant_context(self, query):
        # Get recent from working memory
        recent = self.working.get_context()
        
        # Get relevant from long-term memory
        relevant = self.longterm.retrieve(query)
        
        return recent + relevant
```

---

## Best Practices

```python
MEMORY_BEST_PRACTICES = {
    "working_memory": "Limit to prevent token overflow",
    "summarization": "Summarize old conversations",
    "selective": "Only store important experiences",
    "retrieval": "Retrieve contextually relevant memories"
}
```

---

## Summary

| Memory Type | Purpose | Implementation |
|-------------|---------|----------------|
| **Working** | Current context | Sliding window |
| **Long-term** | Past experiences | Vector store |
| **Semantic** | Facts/knowledge | Knowledge graph |

**Key insight:** Good memory management is crucial for effective agents.

---

## References

- [MemGPT](https://arxiv.org/abs/2310.08560)