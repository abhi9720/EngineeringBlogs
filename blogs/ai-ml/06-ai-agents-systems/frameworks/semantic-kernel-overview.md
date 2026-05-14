---
title: Semantic Kernel Overview
description: Introduction to Microsoft's Semantic Kernel for AI orchestration
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Semantic Kernel
  - AI Agents
  - Microsoft
  - AI
  - Production AI
coverImage: /images/semantic-kernel-overview.png
draft: false
order: 50
---
# Semantic Kernel Overview

## Overview

Semantic Kernel is Microsoft's SDK for AI orchestration, combining LLMs with traditional code.

---

## Core Concepts

```python
SEMANTIC_KERNEL = {
    "Kernel": "Container for AI services",
    "Plugins": "Collections of functions",
    "Prompts": "Template prompts with variables",
    "Memories": "Persistent context"
}
```

---

## Basic Usage

```python
from semantic_kernel import Kernel
from semantic_kernel.planning import ActionPlanner

kernel = Kernel()

# Add AI service
kernel.add_text_service("gpt4", AzureOpenAI(...))

# Create plugin
class MathPlugin:
    @kernel_function(description="Add two numbers")
    def add(self, a: int, b: int) -> int:
        return a + b

kernel.import_plugin(MathPlugin(), "math")

# Execute
result = kernel.run("What is 5 + 3?", functions=["math.add"])
```

---

## Summary

| Feature | Purpose |
|---------|---------|
| **Kernel** | Central orchestrator |
| **Plugins** | Reusable function collections |
| **Planners** | Auto-generate plans |

**Key insight:** Semantic Kernel excels for enterprise C#/.NET projects.

---

## References

- [Semantic Kernel](https://learn.microsoft.com/en-us/semantic-kernel/)
