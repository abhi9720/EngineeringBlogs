---
title: Tool Use in Agents
description: Learn how agents use tools to extend their capabilities
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - AI Agents
  - Tools
  - Function Calling
  - AI
  - AI Agents
coverImage: /images/tool-use-in-agents.png
draft: false
order: 40
---
# Tool Use in Agents

## Overview

Tools extend agents' capabilities beyond text generation, enabling real-world actions.

---

## Tool Categories

```python
TOOL_CATEGORIES = {
    "search": ["web_search", "wikipedia", "vector_search"],
    "computation": ["calculator", "code_executor", "sql_query"],
    "data": ["file_read", "api_call", "database_query"],
    "actions": ["send_email", "create_event", "post_message"]
}
```

---

## Tool Definition

```python
TOOL_TEMPLATE = {
    "name": "search_web",
    "description": "Search the web for information",
    "parameters": {
        "query": {"type": "string", "description": "Search query"},
        "num_results": {"type": "int", "description": "Number of results", "default": 5}
    }
}

def search_web(query, num_results=5):
    """Implement the tool"""
    results = search_engine.search(query, num_results)
    return results
```

---

## Tool Selection

```python
class ToolUsingAgent:
    def select_tool(self, task):
        # LLM decides which tool to use
        prompt = f"""Given this task, should I use a tool? If so, which one?

Task: {task}

Tools available: {list(self.tools.keys())}"""
        
        response = self.llm.generate(prompt)
        return self.parse_tool_choice(response)
```

---

## Summary

| Category | Examples |
|----------|----------|
| **Search** | Web, Wikipedia, Vector DB |
| **Compute** | Calculator, Code |
| **Data** | APIs, Databases |
| **Actions** | Email, Calendar |

**Key insight:** Tools make agents truly useful.

---

## References

- [LangChain Tools](https://python.langchain.com/docs/modules/agents/tools/)
