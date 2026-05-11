---
title: "Props vs State Decision Guide"
description: "When to use props vs state - making the right architectural decisions in React components."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - props
  - state
  - architecture
  - frontend
coverImage: "/images/frontend/react/props-vs-state.png"
draft: false
---

# Props vs State Decision Guide: The Complete Guide

## Overview

Props and state are the two types of data in React. Understanding when to use each is fundamental to building maintainable applications.

---

## Props - Read-Only Data

### What are Props?

```jsx
// Props flow down from parent to child
function Parent() {
  return <Child name="John" age={30} />;
}

function Child({ name, age }) {
  return <div>{name} is {age} years old</div>;
}
```

### When to Use Props

```jsx
// 1. Data from parent component
function Card({ title, content, onAction }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p>{content}</p>
      <button onClick={onAction}>Action</button>
    </div>
  );
}

// 2. Configuration/options
function Button({ variant = 'primary', size = 'medium', children }) {
  return <button className={`btn btn-${variant} btn-${size}`}>{children}</button>;
}

// 3. Callbacks for parent to handle
function Input({ value, onChange, onBlur }) {
  return <input value={value} onChange={onChange} onBlur={onBlur} />;
}
```

---

## State - Mutable Data

### What is State?

```jsx
// State is managed internally by component
function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
```

### When to Use State

```jsx
// 1. User input
function SearchInput() {
  const [query, setQuery] = useState('');
  
  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}

// 2. Toggle states
function Modal({ isOpen }) {
  const [show, setShow] = useState(isOpen);
  
  return show ? <div>Modal</div> : null;
}

// 3. Loading states
function DataFetcher() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  
  async function load() {
    setLoading(true);
    const result = await fetchData();
    setData(result);
    setLoading(false);
  }
  
  return <button onClick={load}>Load</button>;
}
```

---

## Decision Matrix

| Scenario | Use | Why |
|----------|-----|-----|
| Parent passes data to child | Props | Data flows down |
| Component manages its own data | State | Component owns the data |
| Component receives action handler | Props | Parent handles action |
| Component responds to user | State | User interaction changes data |
| Data needs to persist between renders | State | Props reset each render |
| Sibling components share data | Lift state or use context | Props alone can't share |
| Global app state | Context or state management | Props drilling is impractical |

---

## Lifting State Up

```jsx
// Siblings need to share data - lift to parent
function Parent() {
  const [value, setValue] = useState('');
  
  return (
    <>
      <Input value={value} onChange={setValue} />
      <Display value={value} />
    </>
  );
}

function Input({ value, onChange }) {
  return <input value={value} onChange={e => onChange(e.target.value)} />;
}

function Display({ value }) {
  return <p>Value: {value}</p>;
}
```

---

## Summary

1. **Props**: Data passed from parent, read-only in child
2. **State**: Internal component data, mutable
3. **Props for**: Configuration, callbacks, data from parent
4. **State for**: User input, toggle states, loading states
5. **Share between siblings**: Lift state to common parent

---

## References

- [React Docs - State](https://react.dev/learn/state-a-component-memory)
- [React Docs - Props](https://react.dev/learn/passing-props-to-a-component)