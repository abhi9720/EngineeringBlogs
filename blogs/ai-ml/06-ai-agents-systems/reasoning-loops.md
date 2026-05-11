---
title: "Reasoning Loops"
description: "Master agent reasoning - chain-of-thought, ReAct, and planning strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - AI Agents
  - Reasoning
  - Chain-of-Thought
  - ReAct
  - AI
coverImage: "/images/reasoning-loops.png"
draft: false
---

# Reasoning Loops

## Overview

Agents use reasoning loops to think through problems step by step, planning their actions.

---

## Chain-of-Thought

```python
async def cot_reasoning(agent, problem):
    """Step-by-step reasoning"""
    
    prompt = f"""Think through this problem step by step:

Problem: {problem}

Think step by step, showing your reasoning at each point."""
    
    return await agent.llm.generate(prompt)
```

---

## ReAct (Reasoning + Acting)

```python
async def react_loop(agent, task, max_iterations=10):
    """Reason, Act, Observe, Repeat"""
    
    observation = None
    
    for i in range(max_iterations):
        # Reason based on current state
        thought = await agent.reason(task, observation)
        
        # Decide action
        action = agent.decide_action(thought)
        
        # Execute
        if action.is_tool_call:
            observation = await agent.execute_tool(
                action.tool,
                action.args
            )
        else:
            # Final response
            return action.response
        
        # Loop
        
    return "Max iterations reached"
```

---

## Planning

```python
class PlanningAgent:
    async def create_plan(self, goal):
        prompt = f"""Break down this goal into actionable steps:

Goal: {goal}

Output a numbered list of steps."""
        
        steps = await self.llm.generate(prompt)
        return self.parse_steps(steps)
    
    async def execute_plan(self, plan):
        results = []
        
        for step in plan:
            result = await self.execute_step(step)
            results.append(result)
            
            # Check if on track
            if not self.is_on_track(result):
                # Replan if needed
                plan = await self.replan(plan, results)
        
        return results
```

---

## Summary

| Method | Use Case |
|--------|----------|
| **CoT** | Math, logic problems |
| **ReAct** | Tool use, research |
| **Planning** | Complex multi-step tasks |

**Key insight:** Different reasoning methods for different problems.

---

## References

- [ReAct Paper](https://arxiv.org/abs/2210.03629)