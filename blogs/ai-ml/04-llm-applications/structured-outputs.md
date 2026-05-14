---
title: Structured Outputs
description: 'Get consistent, typed outputs from LLMs using structured response formats'
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Structured Output
  - JSON Mode
  - AI
  - Applications
coverImage: /images/structured-outputs.png
draft: false
order: 60
---
# Structured Outputs

## Overview

Structured outputs ensure LLMs return data in specific formats, enabling reliable integration with downstream systems.

**Think of it as:** Getting the LLM to fill out a form instead of writing free text.

---

## Why Structured Outputs?

```
┌─────────────────────────────────────────────────────────────────┐
│              The Parsing Problem                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Unstructured:                                                   │
│  "The weather is sunny, 72 degrees, humidity 45%, wind 5mph"     │
│                                                                 │
│  Problem: Parse this into fields?                               │
│  - Temperature: parse "72 degrees" → 72                        │
│  - Conditions: parse "sunny" → "clear"                         │
│  - Humidity: parse "45%" → 45                                  │
│                                                                 │
│  Structured (JSON):                                             │
│  {                                                              │
│    "temperature": 72,                                          │
│    "condition": "sunny",                                        │
│    "humidity": 45,                                             │
│    "wind_speed": 5                                             │
│  }                                                             │
│                                                                 │
│  Benefit: Direct use without parsing!                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## OpenAI JSON Mode

### Basic JSON Response

```python
import openai

response = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are a helpful assistant. Always respond in JSON format."},
        {"role": "user", "content": "What's the weather in Tokyo?"}
    ],
    response_format={"type": "json_object"}
)

result = json.loads(response.choices[0].message.content)
print(result)
# {"temperature": 72, "condition": "sunny", "location": "Tokyo"}
```

### Enforcing Schema

```python
# System prompt to enforce format
SYSTEM_PROMPT = """You are a weather reporting assistant.

Respond ONLY with valid JSON, no markdown, no explanation.
Format:
{
    "location": "City name",
    "temperature": number in Fahrenheit,
    "condition": "clear/cloudy/rainy/snowy/windy",
    "humidity": number 0-100,
    "recommendation": "What to wear/do based on weather"
}
"""

response = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "Weather in Paris"}
    ],
    response_format={"type": "json_object"}
)

weather = json.loads(response.choices[0].message.content)
```

---

## Using JSON Schema

### Define Strict Schema

```python
from pydantic import BaseModel

class WeatherResponse(BaseModel):
    location: str
    temperature: int
    condition: str
    humidity: int
    recommendation: str

# OpenAI doesn't support Pydantic directly, but we can:
# 1. Use function calling with strict schema
# 2. Use prompt engineering with schema examples
```

### Function Calling for Strict Output

```python
# Using function calling for structured output
functions = [
    {
        "name": "weather_report",
        "description": "Return weather information as structured data",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"},
                "temperature": {"type": "integer"},
                "condition": {"type": "string"},
                "humidity": {"type": "integer"},
                "recommendation": {"type": "string"}
            },
            "required": ["location", "temperature", "condition"]
        }
    }
]

response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Weather in London"}],
    functions=functions,
    function_call={"name": "weather_report"}
)

result = json.loads(response.choices[0].message.function_call.arguments)
```

---

## Validation Layer

```python
from pydantic import BaseModel, ValidationError
from typing import List

class Article(BaseModel):
    title: str
    summary: str
    tags: List[str]
    word_count: int
    published_date: str

def extract_article(text: str) -> Article:
    """Extract and validate article info"""
    
    prompt = f"""Extract article information from this text.
Return ONLY valid JSON matching this schema:
{{
    "title": "article title",
    "summary": "2-3 sentence summary",
    "tags": ["tag1", "tag2", "tag3"],
    "word_count": number,
    "published_date": "YYYY-MM-DD"
}}

Text: {text}"""

    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    
    data = json.loads(response.choices[0].message.content)
    
    try:
        return Article(**data)
    except ValidationError as e:
        # Retry or handle error
        raise ValueError(f"Invalid output: {e}")
```

---

## Common Patterns

### 1. Classification with Enum

```python
functions = [
    {
        "name": "classify_ticket",
        "description": "Classify a support ticket",
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["bug", "feature", "question", "complaint"]
                },
                "priority": {
                    "type": "string", 
                    "enum": ["low", "medium", "high", "critical"]
                },
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "reasoning": {"type": "string"}
            },
            "required": ["category", "priority", "confidence"]
        }
    }
]
```

### 2. List of Items

```python
functions = [
    {
        "name": "extract_entities",
        "description": "Extract named entities from text",
        "parameters": {
            "type": "object",
            "properties": {
                "persons": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of person names found"
                },
                "organizations": {
                    "type": "array", 
                    "items": {"type": "string"}
                },
                "dates": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "locations": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            }
        }
    }
]
```

---

## Best Practices

```python
# 1. Be explicit about format
PROMPT = """Return JSON with these fields:
- title (string, max 100 chars)
- score (integer, 0-100)
- tags (array of strings, max 5)"""

# 2. Handle missing fields
PROMPT = """Return JSON. If field is unknown, use null:
{"title": "...", "date": null}"""

# 3. Add validation layer
def validate_json_output(output: str, schema: dict) -> dict:
    try:
        data = json.loads(output)
        # Validate against schema
        return data
    except json.JSONDecodeError:
        # Retry or return error
        raise
```

---

## Summary

| Method | Use Case | Reliability |
|--------|----------|-------------|
| **JSON mode** | Flexible but uncontrolled | Medium |
| **Function calling** | Strict schema | High |
| **Prompt engineering** | Simple structures | Medium |
| **Validation layer** | Any format | High |

**Key insight:** Combine JSON mode with validation for reliable structured outputs.

**Next:** Continue to `llm-application-architecture.md` for system design.

---

## References

- [OpenAI JSON Mode](https://platform.openai.com/docs/guides/json-mode)
- [Pydantic](https://docs.pydantic.dev/)
