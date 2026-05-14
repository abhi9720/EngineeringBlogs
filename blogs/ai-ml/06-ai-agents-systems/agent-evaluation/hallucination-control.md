---
title: Hallucination Control
description: Reduce hallucinations in AI agents - grounding and verification strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - AI Agents
  - Hallucination
  - Safety
  - AI
  - Production AI
coverImage: /images/hallucination-control.png
draft: false
order: 30
---
# Hallucination Control

## Overview

Agents can generate incorrect information. Grounding and verification reduce hallucinations.

---

## Grounding Techniques

```python
HALLUCINATION_STRATEGIES = {
    "retrieval": "Ground responses in retrieved facts",
    "citation": "Require sources for claims",
    "verification": "Check claims against knowledge",
    "confidence": "Express uncertainty when unsure"
}
```

---

## Implementation

```python
class GroundedAgent:
    def __init__(self):
        self.llm = OpenAI()
        self.knowledge_base = VectorStore("facts")
    
    async def respond(self, query):
        # Retrieve relevant facts
        facts = self.knowledge_base.search(query, k=5)
        
        # Generate with grounding
        prompt = f"""Answer based ONLY on these facts.
If you don't know, say so.

Facts: {facts}

Question: {query}"""
        
        response = await self.llm.generate(prompt)
        
        # Verify claims
        if not self.verify_claims(response, facts):
            return "I'm not confident about this answer"
        
        return response
```

---

## Summary

| Technique | Description |
|-----------|-------------|
| **Retrieval grounding** | Use facts from knowledge base |
| **Citation requirement** | Cite sources |
| **Verification** | Check claims |
| **Confidence expression** | Show uncertainty |

**Key insight:** Grounding is essential for reliable agents.

---

## References

- [Self-RAG](https://arxiv.org/abs/2310.11511)
