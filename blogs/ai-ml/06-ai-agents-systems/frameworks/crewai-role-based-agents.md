---
title: CrewAI Role-Based Agents
description: Build role-based agent teams with CrewAI framework
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - CrewAI
  - Role-Based
  - AI Agents
  - AI
  - Production AI
coverImage: /images/crewai-role-based-agents.png
draft: false
order: 20
---
# CrewAI Role-Based Agents

## Overview

CrewAI organizes agents into crews with defined roles, goals, and workflows.

**Think of it as:** Building an AI team with specialists.

---

## Core Concepts

```python
CREWAI_CONCEPTS = {
    "Agent": "An AI with a specific role",
    "Task": "A piece of work",
    "Crew": "Team of agents",
    "Process": "How agents work together"
}
```

---

## Building a Crew

```python
from crewai import Agent, Task, Crew, Process

# Define agents
researcher = Agent(
    role="Research Analyst",
    goal="Find the latest AI trends",
    backstory="Expert at finding and summarizing information"
)

writer = Agent(
    role="Content Writer",
    goal="Write engaging blog posts",
    backstory="Skilled writer with creative flair"
)

# Define tasks
research_task = Task(
    description="Research AI trends in 2026",
    agent=researcher
)

write_task = Task(
    description="Write a blog post about the research",
    agent=writer,
    context=[research_task]  # Input from research
)

# Create crew
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, write_task],
    process=Process.sequential  # Or Process.hierarchical
)

# Run
result = crew.kickoff()
```

---

## Hierarchical Process

```python
crew = Crew(
    agents=[manager, researcher, writer],
    tasks=tasks,
    process=Process.hierarchical,
    manager_agent=manager  # Manager coordinates
)
```

---

## Summary

| Concept | Description |
|---------|-------------|
| **Role** | Agent's job |
| **Goal** | What to achieve |
| **Backstory** | Context for behavior |
| **Crew** | Working team |

**Key insight:** Role-based design makes complex tasks manageable.

---

## References

- [CrewAI](https://github.com/crewAIInc/crewAI)
