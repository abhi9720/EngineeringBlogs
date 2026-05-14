---
title: Memory Types
description: 'Implement short-term, long-term, and semantic memory in agents'
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - AI Agents
  - Memory
  - Context
  - AI
  - AI Agents
coverImage: /images/memory-types.png
draft: false
order: 10
---
# Memory Types

## Overview

Agents need different memory types for different purposes.

---

## Memory Types

```python
MEMORY_TYPES = {
    "working": {
        "purpose": "Current task context",
        "duration": "Session",
        "size": "Limited (token budget)"
    },
    "episodic": {
        "purpose": "Past experiences",
        "duration": "Permanent",
        "size": "Growing"
    },
    "semantic": {
        "purpose": "Facts and knowledge",
        "duration": "Permanent",
        "size": "Curated"
    }
}
```

---

## Implementation

```python
class AgentMemory:
    def __init__(self):
        # Short-term
        self.working = WorkingMemory(max_tokens=4000)
        
        # Long-term episodic
        self.episodes = VectorStore("episodes")
        
        # Semantic knowledge
        self.knowledge = GraphDB("knowledge")
    
    def remember(self, experience):
        # Add to episodic memory
        self.episodes.add(experience)
        
        # Extract and store facts
        facts = extract_facts(experience)
        for fact in facts:
            self.knowledge.add(fact)
    
    def recall(self, query):
        # Get relevant episodes
        episodes = self.episodes.search(query)
        
        # Get relevant knowledge
        knowledge = self.knowledge.query(query)
        
        return {"episodes": episodes, "knowledge": knowledge}
```

---

## Summary

| Type | Purpose | Implementation |
|------|---------|----------------|
| **Working** | Current context | Sliding window |
| **Episodic** | Past events | Vector store |
| **Semantic** | Facts | Knowledge graph |

**Key insight:** Multiple memory types enable rich agent experiences.

---

## References

- [MemGPT](https://arxiv.org/abs/2310.08560)
