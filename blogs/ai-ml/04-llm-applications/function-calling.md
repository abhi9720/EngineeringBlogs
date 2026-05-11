---
title: "Function Calling"
description: "Master structured function calling for reliable LLM interactions with typed outputs"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - LLM
  - Function Calling
  - Structured Output
  - AI
  - Applications
coverImage: "/images/function-calling.png"
draft: false
---

# Function Calling

## Overview

Function calling lets LLMs output structured JSON matching a schema, enabling reliable integration with code and APIs.

**Think of it as:** Getting the LLM to return typed data, not just text.

---

## Why Function Calling?

```
┌─────────────────────────────────────────────────────────────────┐
│              Text vs Structured Output                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Without Function Calling:                                      │
│                                                                 │
│  Prompt: "What's the weather in NYC?"                         │
│  Response: "The weather in New York City is 72°F and sunny."   │
│                                                                 │
│  Problem: Need to parse text → extract data                    │
│                                                                 │
│  With Function Calling:                                          │
│                                                                 │
│  Prompt: "What's the weather in NYC?"                          │
│  Output: {"function": "get_weather", "arguments": {            │
│            "location": "New York City",                        │
│            "unit": "fahrenheit"                                 │
│          }}                                                     │
│                                                                 │
│  Benefit: Direct code integration!                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Function Calling in OpenAI

### Basic Example

```python
import openai
import json

# Define functions
functions = [
    {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, e.g. 'New York' or 'London'"
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "default": "fahrenheit"
                }
            },
            "required": ["location"]
        }
    },
    {
        "name": "send_email",
        "description": "Send an email to a recipient",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Email address"},
                "subject": {"type": "string", "description": "Email subject"},
                "body": {"type": "string", "description": "Email body"}
            },
            "required": ["to", "subject", "body"]
        }
    }
]

# Make the call
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    functions=functions,
    function_call="auto"  # Let model decide
)

# Parse the response
message = response.choices[0].message

if message.function_call:
    func_name = message.function_call.name
    args = json.loads(message.function_call.arguments)
    
    print(f"Function: {func_name}")
    print(f"Args: {args}")
    
    # Execute the function
    if func_name == "get_weather":
        result = execute_get_weather(args["location"], args.get("unit"))
```

---

## Forcing a Function

```python
# Force using a specific function
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Extract the order details"}],
    functions=functions,
    function_call={"name": "create_order"}  # Force this function
)

# Use "none" to prevent function calling
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Just chat with me"}],
    functions=functions,
    function_call="none"  # Don't use any function
)
```

---

## Structured Data Extraction

### Extract to JSON Schema

```python
# Define extraction schema
extraction_functions = [
    {
        "name": "extract_contact",
        "description": "Extract contact information from text",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Person's full name"},
                "email": {"type": "string", "description": "Email address"},
                "phone": {"type": "string", "description": "Phone number"},
                "company": {"type": "string", "description": "Company name if mentioned"}
            },
            "required": ["name", "email"]
        }
    }
]

# Extract from text
text = """
Hi, I'm John Smith. I work at TechCorp.
You can reach me at john.smith@techcorp.com or 555-1234.
"""

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": f"Extract contact info from: {text}"}],
    functions=extraction_functions
)

contact = json.loads(response.choices[0].message.function_call.arguments)
print(contact)
# {'name': 'John Smith', 'email': 'john.smith@techcorp.com', 
#  'phone': '555-1234', 'company': 'TechCorp'}
```

---

## Handling Function Results

```python
async def chat_with_functions(messages, functions):
    """Complete chat loop with function calling"""
    
    while True:
        # Get LLM response
        response = await openai.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            functions=functions
        )
        
        response_message = response.choices[0].message
        
        # If no function call, return content
        if not response_message.function_call:
            return response_message.content
        
        # Add assistant's function call to conversation
        messages.append(response_message)
        
        # Execute function
        func_name = response_message.function_call.name
        args = json.loads(response_message.function_call.arguments)
        
        # Call actual function
        result = await execute_function(func_name, args)
        
        # Add result to conversation
        messages.append({
            "role": "function",
            "name": func_name,
            "content": json.dumps(result)
        })


async def execute_function(name, args):
    """Execute the actual function"""
    
    if name == "get_weather":
        return await get_weather(args["location"], args.get("unit"))
    
    elif name == "send_email":
        return await send_email(args["to"], args["subject"], args["body"])
    
    elif name == "calculate":
        return {"result": eval(args["expression"])}
    
    raise ValueError(f"Unknown function: {name}")
```

---

## Common Use Cases

### 1. Database Queries

```python
functions = [
    {
        "name": "query_database",
        "description": "Query the company's customer database",
        "parameters": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "SQL query to execute"},
                "table": {
                    "type": "string", 
                    "enum": ["customers", "orders", "products"],
                    "description": "Which table to query"
                }
            },
            "required": ["table"]
        }
    }
]

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "How many orders did customer Acme Corp place last month?"}],
    functions=functions
)
```

### 2. API Integration

```python
functions = [
    {
        "name": "create_calendar_event",
        "description": "Create a calendar event",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start_time": {"type": "string", "description": "ISO datetime"},
                "end_time": {"type": "string", "description": "ISO datetime"},
                "attendees": {
                    "type": "array", 
                    "items": {"type": "string"},
                    "description": "Email addresses of attendees"
                }
            },
            "required": ["title", "start_time"]
        }
    }
]
```

---

## Best Practices

```python
# 1. Clear function names
GOOD_NAME = "get_customer_orders"  # Clear
BAD_NAME = "do_query"              # Unclear

# 2. Descriptive parameters
GOOD_PARAM = {
    "location": {
        "type": "string",
        "description": "City name, including country (e.g., 'Paris, France')"
    }
}

# 3. Include examples in description
DESCRIPTION = """Determine shipping cost for an order.

Use this when:
- User asks about shipping options
- User wants to know delivery cost
- Comparing shipping prices

Returns: shipping cost in USD and estimated delivery days."""

# 4. Use enums for limited options
PARAM_WITH_ENUM = {
    "priority": {
        "type": "string",
        "enum": ["low", "normal", "high", "urgent"],
        "description": "Ticket priority level"
    }
}
```

---

## Summary

| Technique | Use Case |
|-----------|----------|
| **function_call="auto"** | Let model decide |
| **function_call={"name": "X"}** | Force specific function |
| **function_call="none"** | No function calling |
| **Schema matching** | Structured data extraction |

**Key insight:** Function calling turns LLM outputs from unstructured text into typed data.

**Next:** Continue to `structured-outputs.md` for more output control.

---

## References

- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [JSON Schema](https://json-schema.org/)