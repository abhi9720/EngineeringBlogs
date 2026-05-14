---
title: LLM Application Architecture
description: >-
  Design robust LLM applications - from simple chains to complex multi-agent
  systems
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Application Architecture
  - System Design
  - AI
  - Applications
coverImage: /images/llm-application-architecture.png
draft: false
order: 30
---
# LLM Application Architecture

## Overview

Architecting LLM applications requires understanding patterns for routing, memory, tools, and handling failures.

**Think of it as:** Building software, not just writing prompts.

---

## Architecture Patterns

```
┌─────────────────────────────────────────────────────────────────┐
│              LLM Application Patterns                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Simple Chain (Prompt → LLM → Response)                    │
│     Prompt + Input → [LLM] → Output                           │
│                                                                 │
│  2. Chain (Sequential Processing)                              │
│     Input → [Step 1] → [Step 2] → [Step 3] → Output          │
│                                                                 │
│  3. Router (Conditional Routing)                                │
│     Input → [Classifier] → Route to appropriate handler       │
│                                                                 │
│  4. Parallel (Multiple Paths, Merge)                            │
│     Input → [A] ─┬─→ [Merge] → Output                         │
│                → [B] ─┘                                       │
│                                                                 │
│  5. Agent Loop (Tools + Reasoning)                            │
│     Input → [LLM] → Tool → [LLM] → Tool → Output              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Simple Chain

```python
class SimpleChain:
    def __init__(self, llm):
        self.llm = llm
    
    async def run(self, prompt: str) -> str:
        response = await self.llm.generate(prompt)
        return response

# Usage
chain = SimpleChain(llm_client)
result = await chain.run("Summarize this: " + article_text)
```

---

## Sequential Chain

```python
class SequentialChain:
    def __init__(self, steps: list):
        self.steps = steps  # List of (name, prompt_template) tuples
    
    async def run(self, input_data: dict) -> dict:
        context = input_data.copy()
        
        for name, template in self.steps:
            # Format prompt with context
            prompt = template.format(**context)
            
            # Run step
            result = await self.llm.generate(prompt)
            
            # Add to context for next steps
            context[name] = result
        
        return context

# Example: Article processing pipeline
chain = SequentialChain([
    ("summary", "Summarize this: {article}"),
    ("keywords", "Extract 5 keywords from: {summary}"),
    ("headline", "Create a catchy headline for: {summary}"),
])

result = await chain.run({"article": long_article_text})
print(f"Headline: {result['headline']}")
```

---

## Router Pattern

```python
class Router:
    def __init__(self, llm, handlers: dict):
        self.llm = llm
        self.handlers = handlers
    
    async def run(self, query: str) -> str:
        # Classify intent
        classification_prompt = f"""Classify this query into one of:
{', '.join(self.handlers.keys())}

Query: {query}

Category:"""
        
        category = await self.llm.generate(classification_prompt).strip()
        
        # Route to handler
        if category in self.handlers:
            return await self.handlers[category](query)
        else:
            return await self.handlers["default"](query)

# Usage
router = Router(llm_client, {
    "technical": handle_technical_question,
    "sales": handle_sales_inquiry,
    "support": handle_support_ticket,
    "default": handle_general_inquiry
})
```

---

## Parallel Processing

```python
import asyncio

class ParallelChain:
    async def run_steps(self, prompt: str, steps: list) -> list:
        """Run multiple steps in parallel"""
        
        tasks = [
            self.llm.generate(f"{prompt}\n\n{step}")
            for step in steps
        ]
        
        return await asyncio.gather(*tasks)

# Example: Analyze document from multiple perspectives
parallel = ParallelChain(llm_client)

perspectives = [
    "What are the main claims?",
    "What evidence supports the claims?",
    "What are potential weaknesses?",
    "How does this compare to industry standards?"
]

results = await parallel.run_steps(
    prompt=f"Analyze this article:\n\n{article}",
    steps=perspectives
)
```

---

## Agent Loop

```python
class Agent:
    def __init__(self, llm, tools: list, max_iterations: int = 10):
        self.llm = llm
        self.tools = tools
        self.max_iterations = max_iterations
    
    async def run(self, task: str) -> str:
        messages = [
            {"role": "system", "content": "You are a helpful assistant with access to tools."},
            {"role": "user", "content": task}
        ]
        
        for _ in range(self.max_iterations):
            # Get LLM response
            response = await self.llm.chat(messages, tools=self.tools)
            
            if response.tool_calls:
                messages.append(response)
                
                # Execute tools
                for tool_call in response.tool_calls:
                    result = await self.execute_tool(
                        tool_call.function.name,
                        json.loads(tool_call.function.arguments)
                    )
                    
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": str(result)
                    })
            else:
                return response.content
        
        return "Max iterations reached"
```

---

## Memory Architecture

```python
class ConversationMemory:
    def __init__(self, max_tokens: int = 4000):
        self.max_tokens = max_tokens
        self.messages = []
    
    def add(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})
        self.prune()
    
    def prune(self):
        """Remove old messages if over limit"""
        # Count tokens roughly (4 chars = 1 token)
        current_tokens = sum(len(m["content"]) for m in self.messages) // 4
        
        while current_tokens > self.max_tokens and len(self.messages) > 2:
            self.messages.pop(0)
            current_tokens = sum(len(m["content"]) for m in self.messages) // 4
    
    def get_messages(self) -> list:
        return self.messages


class AgentWithMemory:
    def __init__(self, llm, tools: list):
        self.llm = llm
        self.tools = tools
        self.memory = ConversationMemory(max_tokens=8000)
    
    async def run(self, task: str) -> str:
        self.memory.add("user", task)
        
        while True:
            # Get relevant context
            messages = self.memory.get_messages()
            
            response = await self.llm.chat(messages, tools=self.tools)
            
            if response.tool_calls:
                self.memory.add("assistant", str(response.tool_calls))
                # Execute tools...
            else:
                self.memory.add("assistant", response.content)
                return response.content
```

---

## Error Handling

```python
class ResilientAgent:
    def __init__(self, llm, tools: list):
        self.llm = llm
        self.tools = tools
    
    async def run_with_fallback(self, task: str) -> str:
        try:
            return await self.run(task)
        
        except RateLimitError:
            # Wait and retry
            await asyncio.sleep(60)
            return await self.run(task)
        
        except ToolError as e:
            # Try alternative approach
            return await self.run_alternative(task, error=str(e))
        
        except Exception as e:
            # Graceful degradation
            return f"I encountered an error: {str(e)}. Let me know if you'd like to try again."
```

---

## Production Checklist

```python
PRODUCTION_CHECKLIST = {
    "reliability": [
        "Retry logic for API failures",
        "Circuit breaker for downstream services",
        "Graceful degradation",
        "Timeout handling"
    ],
    "cost": [
        "Caching responses",
        "Token usage monitoring",
        "Model selection (small vs large)",
        "Batch processing for non-real-time"
    ],
    "security": [
        "Input validation",
        "Output filtering",
        "Rate limiting",
        "Audit logging"
    ],
    "monitoring": [
        "Request latency",
        "Token usage",
        "Error rates",
        "User satisfaction"
    ]
}
```

---

## Summary

| Pattern | Use Case | Complexity |
|---------|----------|------------|
| **Simple Chain** | One-step processing | Low |
| **Sequential** | Multi-step pipelines | Medium |
| **Router** | Conditional routing | Medium |
| **Parallel** | Multiple perspectives | Medium |
| **Agent Loop** | Complex reasoning + tools | High |

**Key insight:** Start simple, add complexity only when needed.

**Next:** Continue to `05-rag-and-retrieval-systems/rag-introduction.md` to learn about RAG.

---

## References

- [LangChain](https://python.langchain.com/)
- [LlamaIndex](https://www.llamaindex.ai/)
