---
title: "Safety and Guardrails"
description: "Implement safety guardrails for AI agents"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - AI Agents
  - Safety
  - Guardrails
  - AI
  - Production AI
coverImage: "/images/safety-guardrails.png"
draft: false
---

# Safety and Guardrails

## Overview

Safety guardrails prevent agents from taking harmful or unintended actions.

---

## Guardrail Layers

```
┌─────────────────────────────────────────────────────────────────┐
│              Guardrail Layers                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input Guardrails:                                             │
│  - Validate user input                                         │
│  - Detect prompt injection                                     │
│  - Rate limiting                                              │
│                                                                 │
│  Output Guardrails:                                           │
│  - Filter sensitive content                                   │
│  - Validate response format                                   │
│  - Check for harmful content                                   │
│                                                                 │
│  Action Guardrails:                                           │
│  - Validate tool parameters                                   │
│  - Check permissions                                          │
│  - Require confirmation for risky actions                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation

```python
class SafeAgent:
    def __init__(self, agent, guardrails):
        self.agent = agent
        self.guardrails = guardrails
    
    async def execute(self, task):
        # Input validation
        validated = self.guardrails.validate_input(task)
        if not validated.safe:
            return validated.error_message
        
        # Agent execution
        result = await self.agent.execute(task)
        
        # Output validation
        validated_output = self.guardrails.validate_output(result)
        if not validated_output.safe:
            return validated_output.error_message
        
        # Action validation
        if result.actions:
            for action in result.actions:
                if not self.guardrails.can_execute(action):
                    return f"Cannot execute: {action}"
        
        return result
```

---

## Summary

| Layer | Purpose |
|-------|---------|
| **Input** | Validate requests |
| **Output** | Filter responses |
| **Action** | Control behavior |

**Key insight:** Defense in depth - multiple safety layers.

---

## References

- [NeMo Guardrails](https://nvidia.github.io/nemo-guardrails/)