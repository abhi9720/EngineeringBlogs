---
title: Prompt Engineering
description: Master prompt engineering - crafting effective prompts for better LLM outputs
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Prompt Engineering
  - AI
  - Applications
  - Generative AI
coverImage: /images/prompt-engineering.png
draft: false
order: 40
---
# Prompt Engineering

## Overview

Prompt engineering is the art of crafting effective inputs to get better outputs from LLMs. Small changes in wording can dramatically affect results.

**Think of it as:** Learning to ask questions the right way.

---

## Core Principles

### Be Specific

```python
# ❌ Vague prompt
prompt = "Write about AI"

# ✅ Specific prompt
prompt = """Write a 500-word blog post about AI for beginners.
Include:
- What AI is in simple terms
- 3 real-world examples
- Why it matters today
Tone: Friendly and educational"""
```

### Add Context

```python
# ❌ No context
prompt = "Explain React"

# ✅ With context
prompt = """Explain React to a backend developer.
Assume they know:
- JavaScript basics
- HTML/CSS

Focus on:
- Component model
- Virtual DOM (briefly)
- Why it's popular for UIs"""
```

### Define Output Format

```python
prompt = """Extract key info from this article.
Output as JSON:
{
    "topic": "main topic",
    "key_points": ["point1", "point2"],
    "sentiment": "positive/negative/neutral",
    "word_count": number
}"""
```

---

## Prompting Techniques

### 1. Zero-Shot

```python
# No examples, just instructions
prompt = "Classify this review as positive, negative, or neutral: 'Great product!'"
```

### 2. Few-Shot

```python
# Provide examples
prompt = """Classify sentiment:

"Amazing, love it!" → positive
"Terrible, waste of money" → negative
"Not bad, worth it" → neutral

Now classify:
"Could be better" →"""
```

### 3. Chain-of-Thought

```python
prompt = """Solve this step by step:

Problem: A store sells 5 items at $10 each. If they give a 20% discount, what's the total?

Step 1: Calculate original price (5 × $10)
Step 2: Calculate discount (20% of $50)
Step 3: Subtract from original

Problem: You buy 3 books at $15 each with a 10% discount. What's the total?"""
```

### 4. Role Prompting

```python
prompt = """You are an experienced senior software engineer.
You value:
- Clean, readable code
- Proper error handling
- Good documentation

Review this code and provide feedback:

```python
def calc(x,y):
    return x/y
```"""
```

---

## Prompt Templates

### Structured Prompt

```python
SYSTEM_PROMPT = """You are a {role} assistant.
Your expertise: {expertise}
Communication style: {style}

Guidelines:
{guidelines}
"""

def create_prompt(role, expertise, style, guidelines, user_query):
    return f"""{SYSTEM_PROMPT.format(
        role=role,
        expertise=expertise,
        style=style,
        guidelines=guidelines
    )}

User Question: {user_query}

Answer:"""
```

### Task-Specific Templates

```python
# Summarization template
SUMMARY_TEMPLATE = """Summarize the following text in {length}:

Text: {text}

Requirements:
- Main points only
- {format_requirement}
- No opinions, just facts"""

# Code review template
CODE_REVIEW_TEMPLATE = """You are a code reviewer.

Code to review:
```{language}
{code}
```

Review checklist:
1. Correctness
2. Security issues
3. Performance
4. Readability
5. Best practices

Provide feedback on each point."""
```

---

## Common Patterns

### Classification

```python
prompt = """Classify the intent of user messages:

Examples:
- "What's the weather?" → weather
- "I want to order pizza" → ordering
- "Help me login" → support

Classify:
User: "{user_message}"
Intent:"""
```

### Data Extraction

```python
prompt = """Extract information from the text:

Text: "John Smith, born on January 15, 1985, works as a Software Engineer at Google."

Extract:
- Name: 
- Date of Birth:
- Occupation:
- Company:"""
```

### Code Generation

```python
prompt = """Write {language} code that:
1. {requirement1}
2. {requirement2}
3. {requirement3}

Constraints:
- {constraint1}
- {constraint2}

Code:"""
```

---

## Iterative Prompting

```python
# First attempt
response = llm.generate("Explain quantum computing")

# If too technical, refine:
response = llm.generate("""Explain quantum computing to a 10-year-old.
Use simple words, no math.
Include one analogy.""")

# If too simple, refine:
response = llm.generate("""Explain quantum computing to a college student.
Assume basic physics knowledge.
Focus on qubits and superposition.
Keep under 300 words.""")
```

---

## Best Practices

1. **Start with clear instructions**
   ```python
   # Do this first, refine later
   prompt = "Do X, Y, Z"
   ```

2. **Use delimiters for structure**
   ```python
   prompt = """
   Instructions: ...
   
   Context:
   ```
   {context}
   ```
   
   Task: ..."""
   ```

3. **Be explicit about format**
   ```python
   # Don't say "make a table"
   # Say "Output as a markdown table with columns A, B, C"
   ```

4. **Test edge cases**
   ```python
   # Test your prompt with:
   # - Empty input
   # - Very long input
   # - Ambiguous input
   ```

---

## Summary

| Technique | Best For |
|-----------|----------|
| **Zero-shot** | Simple, clear tasks |
| **Few-shot** | Complex patterns, specific formats |
| **Chain-of-thought** | Reasoning tasks |
| **Role prompting** | Domain-specific expertise |

**Key insight:** Be specific, provide context, and iterate based on results.

**Next:** Continue to `prompt-patterns.md` for advanced prompting patterns.

---

## References

- [OpenAI Prompting Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic Prompt Engineering](https://docs.anthropic.com/)
