---
title: "LangChain Introduction"
description: "Get started with LangChain - the framework for building LLM applications and agents"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - LangChain
  - AI Agents
  - Framework
  - AI
  - Production AI
coverImage: "/images/langchain-introduction.png"
draft: false
---

# LangChain Introduction

## Overview

LangChain is a framework for building applications with LLMs, including agents, RAG, and chains.

**Think of it as:** Lego blocks for LLM applications.

---

## Core Concepts

```python
LANCHAIN_CONCEPTS = {
    "models": "Interface to LLMs",
    "prompts": "Template and manage prompts",
    "chains": "Combine components in sequences",
    "agents": "Autonomous actors with tools",
    "memory": "Store and retrieve conversation context",
    "tools": "External capabilities for models"
}
```

---

## Basic LangChain

### LLM Call

```python
from langchain.llms import OpenAI

llm = OpenAI(temperature=0.9)

response = llm("What is Python?")
print(response)
```

### Chain

```python
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate

prompt = PromptTemplate(
    input_variables=["topic"],
    template="Explain {topic} in one sentence."
)

chain = LLMChain(llm=llm, prompt=prompt)
result = chain.run("machine learning")
```

---

## LangChain Agents

```python
from langchain.agents import AgentType, initialize_agent, load_tools
from langchain.llms import OpenAI

# Initialize LLM
llm = OpenAI(temperature=0)

# Load tools
tools = load_tools(["serpapi", "python_repl"])

# Create agent
agent = initialize_agent(
    tools,
    llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True
)

# Run
result = agent.run("What is the weather in Tokyo?")
```

---

## RAG with LangChain

```python
from langchain.document_loaders import TextLoader
from langchain.vectorstores import Chroma
from langchain.chains import RetrievalQA

# Load and split
loader = TextLoader("document.txt")
docs = loader.load()

# Create vector store
vectorstore = Chroma.from_documents(docs, OpenAIEmbeddings())

# Create QA chain
qa = RetrievalQA.from_chain_type(
    llm=OpenAI(),
    chain_type="stuff",
    retriever=vectorstore.as_retriever()
)

result = qa.run("Summarize the document")
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| **Models** | LLM interface |
| **Chains** | Sequence operations |
| **Agents** | Autonomous action |
| **Tools** | External capabilities |

**Key insight:** LangChain provides building blocks for LLM applications.

---

## References

- [LangChain Docs](https://python.langchain.com/)
- [LangChain GitHub](https://github.com/langchain-ai/langchain)