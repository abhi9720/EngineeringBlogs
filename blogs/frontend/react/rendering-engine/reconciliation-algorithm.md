---
title: React Reconciliation Algorithm
description: >-
  Understand how React compares and updates DOM - the reconciliation algorithm
  and diffing strategy.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - react
  - reconciliation
  - virtual dom
  - diffing
  - frontend
coverImage: /images/frontend/react/reconciliation.png
draft: false
order: 10
---
# React Reconciliation Algorithm: The Complete Guide

## Overview

Reconciliation is React's algorithm for determining how to update the DOM efficiently. When component state changes, React compares the new virtual DOM with the previous one and determines the minimum number of operations to update the real DOM.

---

## The Diffing Algorithm

### Two Key Assumptions

```javascript
/*
1. Two elements of different types produce different trees
2. The developer can hint at which elements are stable
   using a 'key' prop
*/
```

### Element Type Comparison

```jsx
// Different types = destroy and recreate
<div>
  <span />  // Old tree
</div>

// React sees <span> vs <p> = different types
// Destroys span, creates p
<span>     // New tree
  <p />
</span>
```

### Same Type, Different Attributes

```jsx
// Same type = update attributes
<div className="old">    // Old
<div className="new">    // New

// React updates className, leaves other attributes
```

### Recursing on Children

```jsx
// Check children recursively
<ul>
  <li key="a">First</li>  // Old
  <li key="b">Second</li>
</ul>

<ul>
  <li key="a">First</li>   // Same key = keep
  <li key="c">Third</li>   // New key = create
  <li key="b">Second</li>  // Old key moved = move
</ul>
```

---

## Keys and Reconciliation

### Why Keys Matter

```jsx
// Without keys - inefficient
<ul>
  {items.map(item => <li>{item.name}</li>)}
</ul>

// React sees all <li> as same type
// Reorders by comparing each
// May destroy and recreate unnecessarily

// With keys - efficient
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>

// React tracks by key
// Knows exactly which items changed
// Only creates/moves what's necessary
```

### Keys Must Be Unique and Stable

```jsx
// BAD: Using index as key
items.map((item, index) => 
  <li key={index}>{item.name}</li>
)
// Problem: index changes when items reorder!

// GOOD: Using stable ID
items.map(item => 
  <li key={item.id}>{item.name}</li>
)

// GOOD: Stable key from data
items.map((item, index) => 
  item.id 
    ? <li key={item.id}>{item.name}</li>
    : <li key={`temp-${index}`}>{item.name}</li>
)
```

---

## Fiber Architecture

### What is Fiber?

```javascript
// React 16+ uses Fiber
// Fiber = new reconciliation implementation

/*
Fiber features:
- Ability to pause, resume, restart work
- Priority levels for different updates
- Incremental rendering (split work into chunks)
- Better concurrency support
*/
```

### Work Loop

```javascript
// Simplified fiber work loop:
function workLoop() {
  // Get next unit of work
  const nextUnitOfWork = getNextUnitOfWork();
  
  while (nextUnitOfWork) {
    // Perform work
    performUnitOfWork(nextUnitOfWork);
    
    // Check if should yield
    if (shouldYield()) {
      break; // Yield to browser
    }
    
    // Get next work
    nextUnitOfWork = getNextUnitOfWork();
  }
}
```

### Priority Levels

```javascript
// React assigns priority to updates
const priorities = {
  synchronous: 1,      // Immediate
  inputHigh: 2,       // User typing, scrolling
  inputLow: 3,        // Button hover
  background: 4,      // Data fetching
  offscreen: 5        // Hidden content
};

// React prioritizes:
// - Typing/clicking → High priority
// - Data fetching → Lower priority
// - Animation → Medium priority
```

---

## Performance Optimization

### shouldComponentUpdate

```javascript
class Counter extends React.Component {
  shouldComponentUpdate(nextProps, nextState) {
    // Only re-render if count changes
    return nextProps.count !== this.props.count;
  }
  
  render() {
    return <div>{this.props.count}</div>;
  }
}
```

### React.memo

```javascript
// Functional component memoization
const Button = React.memo(function Button({ onClick, children }) {
  return <button onClick={onClick}>{children}</button>;
});

// With custom comparison
const Button = React.memo(
  function Button({ onClick, children }) {
    return <button onClick={onClick}>{children}</button>;
  },
  (prevProps, nextProps) => {
    // Return true to skip re-render
    return prevProps.onClick === nextProps.onClick;
  }
);
```

### useMemo and useCallback

```javascript
function Component({ data }) {
  // Memoize expensive calculation
  const processed = useMemo(() => {
    return expensiveOperation(data);
  }, [data]);
  
  // Memoize callback
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []);
  
  return <div>{processed}</div>;
}
```

---

## Common Mistakes

### Mistake 1: Not Using Keys

```jsx
// WRONG: No keys
items.map(item => <ItemComponent item={item} />);

// CORRECT: Use keys
items.map(item => <ItemComponent key={item.id} item={item} />);
```

### Mistake 2: Using Index as Key

```jsx
// WRONG: Index changes on reorder
list.map((item, index) => <li key={index}>{item.name}</li>);

// CORRECT: Use stable ID
list.map(item => <li key={item.id}>{item.name}</li>);
```

### Mistake 3: Creating Components in Map

```jsx
// WRONG: Creates new component each render
items.map(item => {
  const Component = someCondition ? Comp1 : Comp2;
  return <Component key={item.id} />;
});

// CORRECT: Stable component reference
const MyComponent = someCondition ? Comp1 : Comp2;
items.map(item => <MyComponent key={item.id} />);
```

---

## Summary

1. **Reconciliation**: Algorithm for updating DOM efficiently
2. **Diffing**: Compare old and new trees
3. **Keys**: Help React track elements across renders
4. **Fiber**: New implementation with priorities
5. **Optimization**: Use memo, useMemo, shouldComponentUpdate

Understanding reconciliation helps you write performant React applications.

---

## References

- [React Docs - Reconciliation](https://react.dev/learn/reconciliation)
- [React Fiber Architecture](https://github.com/acdlite/react-fiber-architecture)
- [Inside React - Fiber](https://medium.com/dailyjs/react-internals-explained-part-1-fibers-116193a5b9ce)
