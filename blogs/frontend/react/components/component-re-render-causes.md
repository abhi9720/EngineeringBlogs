---
title: "Component Re-render Causes"
description: "Understanding why React components re-render - state changes, props, context, and how to optimize."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - re-render
  - performance
  - frontend
coverImage: "/images/frontend/react/re-render-causes.png"
draft: false
---

# Component Re-render Causes: The Complete Guide

## Overview

Understanding why components re-render is essential for React performance. This guide covers all causes of re-renders and how to prevent unnecessary ones.

---

## What Triggers Re-render

### State Changes

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  
  // State change → re-render
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
```

### Parent Re-renders

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  
  // Parent re-renders when count changes
  return <Child count={count} />;
}

function Child({ count }) {
  // Child re-renders even without its own state change
  return <div>Count: {count}</div>;
}
```

### Context Changes

```jsx
const ThemeContext = React.createContext('light');

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Toolbar />
    </ThemeContext.Provider>
  );
}

function Toolbar() {
  // Re-renders when context value changes
  const theme = useContext(ThemeContext);
  return <div className={theme}>Theme</div>;
}
```

---

## Preventing Unnecessary Re-renders

### React.memo

```jsx
// Memoized component - only re-renders when props change
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

### useMemo

```jsx
function ExpensiveComponent({ data }) {
  // Memoize expensive calculation
  const processed = useMemo(() => {
    return data.items.map(item => ({
      ...item,
      display: expensiveTransform(item.value)
    }));
  }, [data.items]);
  
  return <ul>{processed.map(item => <li key={item.id}>{item.display}</li>)}</ul>;
}
```

### useCallback

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  
  // Memoize callback to prevent child re-renders
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []);
  
  return <Child onClick={handleClick} count={count} />;
}

const Child = React.memo(function Child({ onClick, count }) {
  return <button onClick={onClick}>{count}</button>;
});
```

---

## Common Causes of Unnecessary Re-renders

### Passing New Object as Prop

```jsx
// BAD: New object every render
function Parent() {
  return <Child 
    style={{ color: 'red' }} // New object each render!
    onClick={() => doSomething()} // New function each render!
  />;
}

// GOOD: Memoize or use stable reference
const style = { color: 'red' };
const handleClick = useCallback(() => doSomething(), []);

function Parent() {
  return <Child style={style} onClick={handleClick} />;
}
```

### Inline Functions in JSX

```jsx
// BAD: Function created each render
<Button onClick={() => setCount(count + 1)}>Click</Button>

// GOOD: Use stable function
const increment = useCallback(() => setCount(c => c + 1), []);
<Button onClick={increment}>Click</Button>
```

### Not Using Keys Properly

```jsx
// BAD: No key or index key causes issues
items.map((item, index) => (
  <Item key={index} data={item} /> // Index changes on reorder!
));

// GOOD: Use stable ID
items.map(item => (
  <Item key={item.id} data={item} />
));
```

---

## Summary

1. **State changes**: Trigger re-render
2. **Parent renders**: Child re-renders by default
3. **Context changes**: All consumers re-render
4. **Prevent**: Use React.memo, useMemo, useCallback
5. **Avoid**: Inline functions, new objects in props

Optimize re-renders to improve React performance.

---

## References

- [React Docs - Reconciliation](https://react.dev/learn/reconciliation)
- [useMemo API](https://react.dev/reference/react/useMemo)