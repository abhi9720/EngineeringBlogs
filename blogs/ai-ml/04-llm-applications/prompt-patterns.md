---
title: Prompt Patterns
description: >-
  Advanced prompting patterns - chain-of-thought, ReAct, tree-of-thought, and
  more
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - LLM
  - Prompt Engineering
  - Patterns
  - AI
  - Applications
coverImage: /images/prompt-patterns.png
draft: false
order: 50
---
# Prompt Patterns

## Overview

Advanced prompting patterns help LLMs solve complex problems by structuring how they think and respond.

**Think of it as:** Giving the LLM a framework to reason through problems.

---

## Chain-of-Thought (CoT)

### When to Use

```python
# Good for: Math, logic, multi-step problems
# Not needed for: Simple factual questions
```

### Implementation

```python
prompt = """Solve this problem step by step:

Problem: If a train leaves at 2pm traveling 60mph, and another leaves at 3pm traveling 80mph from the same station, when will they meet?

Think through each step:

Step 1: Identify what we know...
[Model reasons through problem]

Final Answer: [Model provides answer]
"""
```

### With Examples

```python
prompt = """Solve these problems step by step:

Example:
Problem: John has 5 apples, gives 2 to Mary. How many left?
Step 1: Start with 5 apples
Step 2: Subtract 2 given away
Step 3: 5 - 2 = 3
Answer: 3 apples

Problem: A store has 20 shirts. Sells 5, then receives 10 more. How many?
Step 1: Start with 20
Step 2: Subtract 5 sold → 15
Step 3: Add 10 received → 25
Answer:"""
```

---

## ReAct (Reasoning + Acting)

### Concept

```
┌─────────────────────────────────────────────────────────────────┐
│              ReAct Loop                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Thought: What should I do?                                      │
│       │                                                         │
│       ▼                                                         │
│  Action: Take an action (search, calculate, etc.)               │
│       │                                                         │
│       ▼                                                         │
│  Observation: What happened?                                      │
│       │                                                         │
│       ▼                                                         │
│  Repeat until answer                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

```python
import openai

def react(query, tools):
    """ReAct prompting with tools"""
    
    prompt = f"""You are a helpful assistant with access to tools.

Question: {query}

Respond in this format:
Thought: [what you're thinking]
Action: [tool name if needed]
Action Input: [input to tool]
Observation: [result from tool]

When you have the answer:
Thought: I now know the answer
Final Answer: [your response]
"""
    
    messages = [{"role": "user", "content": prompt}]
    
    while True:
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )
        
        content = response.choices[0].message.content
        
        if "Final Answer:" in content:
            return content.split("Final Answer:")[-1].strip()
        
        # Extract and execute action
        # (Simplified - real implementation needs parsing)
        messages.append({"role": "assistant", "content": content})
```

---

## Tree-of-Thought

### Exploration Strategy

```python
def tree_of_thought(problem, num_branches=3):
    """Explore multiple solution paths"""
    
    prompt = f"""Solve this problem by exploring multiple approaches:

Problem: {problem}

Generate {num_branches} different solution approaches.

For each approach:
1. Explain the strategy
2. Work through it
3. Evaluate if it leads to solution

Then select the best approach and provide the final answer."""
    
    return openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}]
    )
```

### Use Cases

```python
# Creative writing - multiple plot directions
# Planning - multiple strategies
# Code - different algorithm approaches
# Analysis - multiple perspectives
```

---

## Self-Consistency

### Multiple Reasoning Paths

```python
def self_consistent_answer(query, num_paths=5):
    """Generate multiple solutions, pick most consistent"""
    
    # Generate multiple answers
    answers = []
    for _ in range(num_paths):
        prompt = f"""Think step by step to solve:
{query}

Provide your final answer."""
        
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        answers.append(response.choices[0].message.content)
    
    # Use majority vote for numerical answers
    # Or identify most common reasoning pattern
    return majority_vote(answers)
```

---

## Constitutional AI

### Helpful + Harmless

```python
SYSTEM_PROMPT = """You are a helpful assistant.

Before responding, check if your answer:
1. Is factually accurate
2. Could be harmful in any way
3. Respects privacy
4. Is appropriate for all audiences

If any issues, revise to address them."""

def constitutional_response(query):
    return openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query}
        ]
    )
```

---

## Reflection Pattern

### Self-Critique

```python
def reflective_response(query):
    """Generate, evaluate, and improve response"""
    
    # Generate initial response
    initial = generate_response(query)
    
    # Self-critique
    critique_prompt = f"""Review this response:

{initial}

Evaluate:
1. Is it accurate?
2. Is it complete?
3. Is it well-structured?

If issues, suggest improvements."""
    
    critique = generate_response(critique_prompt)
    
    # Revise based on critique
    revision_prompt = f"""Original response:
{initial}

Critique:
{critique}

Provide an improved response that addresses the critique."""
    
    return generate_response(revision_prompt)
```

---

## Summary

| Pattern | Use Case | Key Benefit |
|---------|---------|------------|
| **Chain-of-Thought** | Math, logic | Breaks down reasoning |
| **ReAct** | Tool use, research | Combines reasoning + action |
| **Tree-of-Thought** | Creative, planning | Explores multiple paths |
| **Self-Consistency** | Complex reasoning | Robust answers |
| **Reflection** | Quality control | Self-correction |

**Key insight:** Different problems need different thinking structures.

**Next:** Continue to `building-llm-apps.md` for building LLM applications.

---

## References

- [ReAct Paper](https://arxiv.org/abs/2210.03629)
- [Tree of Thoughts](https://arxiv.org/abs/2305.10601)
- [Self-Consistency](https://arxiv.org/abs/2203.11171)
