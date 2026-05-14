---
title: What are AI Agents
description: >-
  Understand AI agents - autonomous systems that can plan, reason, and take
  actions
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - AI Agents
  - Autonomous AI
  - AI
  - LLM
  - AI Agents
coverImage: /images/what-are-ai-agents.png
draft: false
order: 40
---
# What are AI Agents

## Overview

AI agents are autonomous systems that use LLMs to plan, reason, and take actions to achieve goals. They can use tools, learn from feedback, and adapt.

**Think of it as:** A capable assistant that doesn't just answer questions, but can actually do things for you.

---

## Agent vs Chatbot vs LLM

```
┌─────────────────────────────────────────────────────────────────┐
│              Evolution of AI Systems                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LLM:                                                           │
│  Input → Generate Response → Done                              │
│  (Stateless, no memory, no actions)                            │
│                                                                 │
│  Chatbot:                                                       │
│  Input + History → Generate Response → Done                    │
│  (Has memory, still no actions)                               │
│                                                                 │
│  AI Agent:                                                     │
│  Input + History → Plan → Use Tools → Observe → Repeat → Done │
│  (Plans, acts, learns, adapts)                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## What Makes an Agent?

```python
AGENT_COMPONENTS = {
    "perception": "Understand input (text, images, etc.)",
    "reasoning": "Think through problems step by step",
    "planning": "Create action plans to achieve goals",
    "memory": "Remember past interactions and learnings",
    "tools": "Use external tools to take actions",
    "learning": "Improve from feedback and results"
}
```

---

## The Agent Loop

```
┌─────────────────────────────────────────────────────────────────┐
│              Agent Loop                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐                                                  │
│  │ Perceive│  Get input/task                                    │
│  └────┬────┘                                                   │
│       ▼                                                         │
│  ┌─────────┐                                                  │
│  │ Reason  │  Think about what to do                            │
│  └────┬────┘                                                   │
│       ▼                                                         │
│  ┌─────────┐                                                  │
│  │  Plan   │  Create action sequence                           │
│  └────┬────┘                                                   │
│       ▼                                                         │
│  ┌─────────┐                                                  │
│  │  Act    │  Execute action (use tool)                        │
│  └────┬────┘                                                   │
│       ▼                                                         │
│  ┌─────────┐                                                  │
│  │Observe  │  Get result of action                             │
│  └────┬────┘                                                   │
│       │                                                         │
│       └──→ Repeat until goal achieved                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Simple Agent Implementation

```python
import openai
import json

class SimpleAgent:
    def __init__(self, tools: list):
        self.tools = tools
        self.messages = []
    
    def run(self, task: str, max_steps: int = 10) -> str:
        """Run agent loop"""
        
        self.messages = [
            {"role": "system", "content": "You are a helpful assistant with access to tools."},
            {"role": "user", "content": task}
        ]
        
        for step in range(max_steps):
            # Get LLM response
            response = openai.chat.completions.create(
                model="gpt-4o",
                messages=self.messages,
                tools=self.tools
            )
            
            message = response.choices[0].message
            
            # If tool call, execute
            if message.tool_calls:
                self.messages.append(message)
                
                for tool_call in message.tool_calls:
                    result = self.execute_tool(
                        tool_call.function.name,
                        json.loads(tool_call.function.arguments)
                    )
                    
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": str(result)
                    })
            
            # If text response, we're done
            else:
                return message.content
        
        return "Max steps reached"
    
    def execute_tool(self, name: str, args: dict):
        """Execute tool and return result"""
        for tool in self.tools:
            if tool["function"]["name"] == name:
                return tool["function"]["name"](**args)
        return "Tool not found"
```

---

## Agent Types

```python
AGENT_TYPES = {
    "reactive": "Responds to input, no planning",
    "deliberative": "Plans before acting",
    "goal-oriented": "Works toward specific goals",
    "learning": "Improves from feedback",
    "multi-agent": "Multiple agents collaborate"
}
```

---

## Summary

| Aspect | LLM | Chatbot | Agent |
|--------|-----|---------|-------|
| **Memory** | None | Session | Full |
| **Actions** | None | None | Tools |
| **Planning** | None | None | Yes |
| **Adaptation** | None | None | Learning |

**Key insight:** Agents add action capability to LLMs through tools and planning.

---

## References

- [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT)
- [LangChain Agents](https://python.langchain.com/)
