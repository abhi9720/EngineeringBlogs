---
title: Virtual DOM Explained
description: >-
  Understand the Virtual DOM - how React maintains an in-memory representation
  of the real DOM.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - react
  - virtual dom
  - rendering
  - frontend
coverImage: /images/frontend/react/virtual-dom.png
draft: false
order: 20
---
# Virtual DOM Explained: The Complete Guide

## Overview

The Virtual DOM is a programming concept where React keeps a lightweight copy of the real DOM in memory. When state changes, React compares the new Virtual DOM with the previous one and only updates what's necessary in the real DOM.

---

## What is Virtual DOM?

### The Concept

```javascript
// Real DOM (what browser sees)
const realDOM = {
  tagName: 'div',
  attributes: { class: 'container', id: 'app' },
  children: [
    { tagName: 'h1', children: ['Hello'] },
    { tagName: 'button', attributes: { onClick: 'handleClick' }, children: ['Click'] }
  ]
};

// Virtual DOM (React's in-memory representation)
const virtualDOM = {
  type: 'div',
  props: { className: 'container', id: 'app' },
  children: [
    { type: 'h1', props: {}, children: ['Hello'] },
    { type: 'button', props: { onClick: handleClick }, children: ['Click'] }
  ]
};
```

### Why Use Virtual DOM?

```javascript
/*
Real DOM operations are expensive:
- Querying DOM is slow
- Modifying DOM triggers reflow
- Layout changes cascade

Virtual DOM benefits:
- JavaScript is fast
- Diffing is done in memory
- Batch updates minimize real DOM manipulation
- Only necessary changes applied
*/
```

---

## How It Works

### Step 1: Create Virtual DOM

```jsx
// JSX compiles to createElement calls
// createElement returns a virtual DOM node

function App() {
  // This JSX becomes:
  return (
    <div className="container">
      <h1>Hello World</h1>
      <button onClick={handleClick}>Click</button>
    </div>
  );
}

// Compiled (simplified):
React.createElement(
  'div',
  { className: 'container' },
  React.createElement('h1', null, 'Hello World'),
  React.createElement('button', { onClick: handleClick }, 'Click')
);
```

### Step 2: State Changes Trigger Re-render

```javascript
function Counter() {
  const [count, setCount] = useState(0);
  
  // When count changes:
  // 1. Component function runs again
  // 2. New Virtual DOM created with new count
  // 3. React compares new vs old Virtual DOM
  
  return (
    <div>
      Count: {count}
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
```

### Step 3: Diffing

```javascript
// Old Virtual DOM
const oldVDOM = {
  type: 'div',
  children: [
    { type: 'span', children: ['5'] }
  ]
};

// New Virtual DOM
const newVDOM = {
  type: 'div',
  children: [
    { type: 'span', children: ['6'] }
  ]
};

// Diffing:
// - Same type 'div' = update props/children
// - Same type 'span' = update children only
// - Content changed '5' to '6'
```

### Step 4: Update Real DOM

```javascript
// Only necessary changes applied
// Old: <span>5</span>
// New: <span>6</span>

// React does:
// document.querySelector('span').textContent = '6';
// That's it - minimal update!
```

---

## Key Concepts

### Elements are Immutable

```javascript
// Virtual DOM elements can't be mutated
const element = <div>Hello</div>;

// This doesn't work:
element.props.children = 'World';

// Instead, create new element:
const newElement = <div>World</div>;
```

### Reconciliation Uses Key

```javascript
// Keys help track elements
const oldTree = (
  <ul>
    <li key="a">A</li>
    <li key="b">B</li>
  </ul>
);

const newTree = (
  <ul>
    <li key="a">A</li>
    <li key="c">C</li>
    <li key="b">B</li>
  </ul>
);

// React knows:
// - 'a' stays - keep
// - 'b' moved after 'c'
// - 'c' is new - insert
```

### Components Return Elements

```javascript
// Component returns Virtual DOM element
function Button({ label, onClick }) {
  return (
    <button className="btn" onClick={onClick}>
      {label}
    </button>
  );
}

// Can be composed
function App() {
  return (
    <div>
      <Button label="Submit" onClick={handleSubmit} />
      <Button label="Cancel" onClick={handleCancel} />
    </div>
  );
}
```

---

## Performance Benefits

### Batch Updates

```javascript
// Multiple state changes = single re-render
function App() {
  const [count, setCount] = useState(0);
  
  function increment() {
    setCount(c => c + 1);
    setCount(c => c + 1);
    setCount(c => c + 1);
    // React batches these - only one re-render!
  }
  
  return <button onClick={increment}>{count}</button>;
}
```

### Selective Updates

```javascript
// Only component with state change re-renders
function Parent() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <ChildWithoutState /> {/* Won't re-render */}
      <ChildWithState count={count} /> {/* Will re-render */}
    </div>
  );
}
```

---

## Virtual DOM vs Real DOM

| Aspect | Virtual DOM | Real DOM |
|--------|-------------|----------|
| Updates | Batch + diff | Direct |
| Performance | Fast | Slow |
| Memory | In-memory | Browser memory |
| Debugging | Easy (React DevTools) | Harder |
| Caching | Yes | Limited |

---

## Summary

1. **Virtual DOM**: Lightweight JavaScript representation of real DOM
2. **Diffing**: Compare old and new Virtual DOM
3. **Reconciliation**: Process of updating real DOM
4. **Batching**: Group multiple updates together
5. **Keys**: Help track elements across renders

The Virtual DOM is what makes React fast and efficient at updating the UI.

---

## References

- [React Docs - Virtual DOM](https://react.dev/learn/rendering-elements)
- [React Internals - Virtual DOM](https://www.codecademy.com/article/react-virtual-dom)
- [CodeAcademy - Virtual DOM](https://www.codecademy.com/learn/react)
