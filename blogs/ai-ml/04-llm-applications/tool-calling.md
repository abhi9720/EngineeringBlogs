---
title: "Tool Calling"
description: "Enable LLMs to use external tools and APIs to extend their capabilities"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - LLM
  - Tool Calling
  - AI Agents
  - Function Calling
  - AI
  - Applications
coverImage: "/images/tool-calling.png"
draft: false
---

# Tool Calling

## Overview

Tool calling allows LLMs to use external functions and APIs, extending their capabilities beyond text generation.

**Think of it as:** Giving the LLM hands to interact with the real world.

---

## Why Tool Calling?

```
┌─────────────────────────────────────────────────────────────────┐
│              LLMs + Tools = Powerful                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LLMs Can:                                                      │
│  ✅ Generate text                                                │
│  ✅ Answer questions from training                              │
│  ✅ Reason through problems                                      │
│                                                                 │
│  LLMs Cannot:                                                   │
│  ❌ Access real-time information                                │
│  ❌ Perform actions in the world                                │
│  ❌ Calculate with precision                                     │
│                                                                 │
│  With Tools:                                                    │
│  ✅ Search the web                                              │
│  ✅ Query databases                                             │
│  ✅ Execute code                                                 │
│  ✅ Send emails, make calendar events                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## How Tool Calling Works

```
┌─────────────────────────────────────────────────────────────────┐
│              Tool Calling Flow                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User asks question                                          │
│     "What's the weather in New York?"                          │
│          │                                                      │
│          ▼                                                      │
│  2. LLM decides to use tool                                    │
│     "I need to call get_weather function"                       │
│          │                                                      │
│          ▼                                                      │
│  3. Execute tool                                                │
│     get_weather(location="New York")                            │
│          │                                                      │
│          ▼                                                      │
│  4. Return result to LLM                                        │
│     "72°F, sunny"                                               │
│          │                                                      │
│          ▼                                                      │
│  5. LLM generates final response                                │
│     "The weather in New York is 72°F and sunny today."         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## OpenAI Tool Calling

### Define Tools

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City name, e.g. 'New York'"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit"
                    }
                },
                "required": ["location"]
            }
        }
    }
]

# Also define calculator
tools.append({
    "type": "function",
    "function": {
        "name": "calculate",
        "description": "Perform mathematical calculations",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "Math expression, e.g. '2+2' or 'sqrt(16)'"
                }
            },
            "required": ["expression"]
        }
    }
})
```

### Call with Tools

```python
import openai

messages = [
    {"role": "user", "content": "What's 15% of 200?"}
]

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice="auto"
)

# Check if LLM wants to use tools
assistant_message = response.choices[0].message

if assistant_message.tool_calls:
    for tool_call in assistant_message.tool_calls:
        func_name = tool_call.function.name
        args = json.loads(tool_call.function.arguments)
        
        print(f"Calling function: {func_name}")
        print(f"Arguments: {args}")
        
        # Execute function
        if func_name == "calculate":
            result = eval(args["expression"])
            print(f"Result: {result}")
```

### Complete Tool Execution Loop

```python
import json
import openai

def execute_tool(tool_name, args):
    """Execute tool and return result"""
    
    if tool_name == "calculate":
        try:
            return {"result": eval(args["expression"])}
        except Exception as e:
            return {"error": str(e)}
    
    elif tool_name == "get_weather":
        # Mock weather API
        return {"temp": 72, "condition": "sunny", "location": args["location"]}
    
    return {"error": "Unknown tool"}

async def chat_with_tools(messages, tools):
    while True:
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=tools
        )
        
        message = response.choices[0].message
        
        if message.tool_calls:
            # Add assistant message with tool calls
            messages.append(message)
            
            # Execute each tool
            for tool_call in message.tool_calls:
                func_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)
                
                result = execute_tool(func_name, args)
                
                # Add tool result
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })
        
        elif message.content:
            # Final response
            return message.content

# Usage
messages = [{"role": "user", "content": "What's the weather in New York and what's 15% of 200?"}]
result = asyncio.run(chat_with_tools(messages, tools))
print(result)
```

---

## Anthropic Tool Use

```python
from anthropic import Anthropic

client = Anthropic()

tools = [
    {
        "name": "get_weather",
        "description": "Get weather for a location",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            },
            "required": ["location"]
        }
    }
]

response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    tools=tools,
    messages=[{"role": "user", "content": "Weather in Tokyo?"}]
)

# Handle tool use similarly
```

---

## Tool Definition Best Practices

```python
# Good tool definitions are:

TOOL_TIPS = {
    "name": "Use clear, verb-based names",
    "description": "Describe what the tool does and when to use it",
    "parameters": "Use specific types, describe each parameter",
    "examples": "Use examples in descriptions for clarity"
}

# Example: Clear vs Unclear
BAD_TOOL = {
    "name": "search",
    "description": "Search something",
    "parameters": {"query": "The search query"}
}

GOOD_TOOL = {
    "name": "search_database",
    "description": "Search the company knowledge base for relevant documents. Use this when you need to find specific information from the company's internal database. Returns top 5 relevant documents with summaries.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query in natural language (e.g., 'vacation policy for remote employees')"
            },
            "limit": {
                "type": "integer",
                "description": "Maximum documents to return (default 5, max 20)",
                "default": 5
            }
        },
        "required": ["query"]
    }
}
```

---

## Error Handling

```python
def execute_tool_safe(tool_name, args):
    """Execute tool with error handling"""
    
    try:
        result = execute_tool(tool_name, args)
        
        return {
            "success": True,
            "result": result
        }
    
    except ValidationError as e:
        return {
            "success": False,
            "error": f"Invalid arguments: {e}"
        }
    
    except TimeoutError:
        return {
            "success": False,
            "error": "Tool timed out. Try again with simpler request."
        }
    
    except Exception as e:
        return {
            "success": False,
            "error": f"Tool execution failed: {str(e)}"
        }
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| **Tool Definition** | JSON schema describing the function |
| **Tool Execution** | Run the actual function |
| **Result Handling** | Feed results back to LLM |
| **Error Handling** | Handle failures gracefully |

**Key insight:** Tool calling extends LLMs from text generators to interactive agents.

**Next:** Continue to `function-calling.md` for structured function calls.

---

## References

- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/)