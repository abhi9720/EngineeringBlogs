---
title: Planning and Execution
description: Learn how agents plan and execute tasks to achieve goals
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - AI Agents
  - Planning
  - Execution
  - AI
coverImage: /images/planning-execution.png
draft: false
order: 20
---
# Planning and Execution

## Overview

Agents create plans to achieve goals and execute them systematically, adapting as needed.

---

## Planning Strategies

### Single-Step Planning

```python
async def simple_plan(task):
    """One-shot plan for simple tasks"""
    prompt = f"""How would you complete this task?

Task: {task}

Provide a brief plan."""
    
    return await llm.generate(prompt)
```

### Multi-Step Planning

```python
async def hierarchical_plan(task, max_depth=3):
    """Break into hierarchical steps"""
    
    prompt = f"""Break down this task into {max_depth} levels of detail:

Task: {task}

Format:
1. Main Step 1
   1.1 Sub-step
   1.2 Sub-step
2. Main Step 2
   2.1 Sub-step"""
    
    plan = await llm.generate(prompt)
    return parse_plan(plan)
```

---

## Execution Patterns

### Sequential Execution

```python
async def execute_sequential(agent, steps):
    """Execute steps one by one"""
    results = []
    
    for step in steps:
        result = await agent.execute(step)
        results.append(result)
        
        # Store for next steps
        agent.context["step_results"] = results
    
    return results
```

### Parallel Execution

```python
async def execute_parallel(agent, steps):
    """Execute independent steps concurrently"""
    
    # Find independent steps
    independent = [s for s in steps if not s.depends_on]
    
    # Execute in parallel
    results = await asyncio.gather(*[
        agent.execute(step) for step in independent
    ])
    
    return results
```

---

## Plan Adaptation

```python
class AdaptiveAgent:
    async def execute_with_adaptation(self, task):
        plan = await self.create_plan(task)
        
        for step in plan:
            result = await self.execute(step)
            
            # Evaluate result
            if not self.is_successful(result):
                # Adapt plan
                plan = await self.replan(plan, result)
                if not plan:
                    return "Cannot complete task"
        
        return self.summarize_results()
```

---

## Summary

| Pattern | Best For |
|---------|----------|
| **Sequential** | Dependent steps |
| **Parallel** | Independent tasks |
| **Adaptive** | Uncertain outcomes |

**Key insight:** Good planning enables effective execution.

---

## References

- [PlanGen](https://arxiv.org/abs/2204.10706)
