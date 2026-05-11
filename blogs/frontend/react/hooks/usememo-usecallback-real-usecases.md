---
title: "useMemo & useCallback Real Use Cases"
description: "Practical examples of when and how to use useMemo and useCallback for performance optimization."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - hooks
  - usememo
  - usecallback
  - frontend
coverImage: "/images/frontend/react/usememo-usecallback.png"
draft: false
---

# useMemo & useCallback Real Use Cases: The Complete Guide

## Overview

useMemo and useCallback are optimization hooks. They memoize values and functions to prevent unnecessary calculations and re-renders.

---

## useMemo - Memoizing Values

### Expensive Calculations

```jsx
function ExpensiveComponent({ items }) {
  // Only recalculates when items changes
  const sortedItems = useMemo(() => {
    return items
      .filter(item => item.active)
      .sort((a, b) => b.value - a.value)
      .map(item => ({
        ...item,
        display: formatCurrency(item.value)
      }));
  }, [items]);
  
  return <List items={sortedItems} />;
}
```

### Avoiding Object Recreation

```jsx
function Component({ name, age }) {
  // Avoid creating new object each render
  const personInfo = useMemo(() => ({
    name,
    age,
    fullInfo: `${name} is ${age} years old`
  }), [name, age]);
  
  return <div>{personInfo.fullInfo}</div>;
}
```

### Dependent Calculations

```jsx
function Dashboard({ users, filter }) {
  // Chain memoized values
  const filteredUsers = useMemo(
    () => users.filter(u => u.active),
    [users]
  );
  
  const groupedByAge = useMemo(
    () => groupBy(filteredUsers, 'age'),
    [filteredUsers]
  );
  
  const stats = useMemo(
    () => calculateStats(groupedByAge),
    [groupedByAge]
  );
  
  return <StatsDisplay stats={stats} />;
}
```

---

## useCallback - Memoizing Functions

### Passing Callbacks to Children

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  
  // Stable reference - won't trigger child's re-render
  const handleIncrement = useCallback(() => {
    setCount(c => c + 1);
  }, []);
  
  return <Child onIncrement={handleIncrement} />;
}

const Child = React.memo(function Child({ onIncrement }) {
  return <button onClick={onIncrement}>Increment</button>;
});
```

### Event Handlers with Dependencies

```jsx
function Component({ userId }) {
  const [data, setData] = useState(null);
  
  // Include dependencies in dependency array
  const fetchData = useCallback(async () => {
    const result = await api.getUser(userId);
    setData(result);
  }, [userId]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  return <div>{data?.name}</div>;
}
```

---

## When NOT to Use Them

### Don't Over-Optimize

```jsx
// NOT NEEDED: Simple values
const value = 10;
const name = 'John';

// NOT NEEDED: Primitive dependencies
useMemo(() => x + 1, [x]);

// NOT NEEDED: Functions without dependencies
const fn = () => doSomething();
// fn changes only when component re-renders anyway
```

### When to Avoid

```jsx
// Simple calculations
const fullName = `${firstName} ${lastName}`;

// Primitive values
const count = 0;

// Functions that don't affect children
function handleClick() { console.log('click'); }
```

---

## Performance Comparison

```javascript
// Without memoization - re-renders on every parent update
function Parent() {
  const [count, setCount] = useState(0);
  return <Child onClick={() => setCount(c => c + 1)} />;
}

function Child({ onClick }) {
  return <button onClick={onClick}>Click</button>;
}

// With memoization - only re-renders when onClick changes
function Parent() {
  const [count, setCount] = useState(0);
  const handleClick = useCallback(() => setCount(c => c + 1), []);
  
  return <Child onClick={handleClick} />;
}

const Child = React.memo(function Child({ onClick }) {
  return <button onClick={onClick}>Click</button>;
});
```

---

## Summary

1. **useMemo**: Memoize expensive calculations and objects
2. **useCallback**: Memoize functions to prevent child re-renders
3. **Don't over-optimize**: Profile first, optimize after
4. **Dependencies matter**: Correct dependency array is critical
5. **Custom hooks**: Can also benefit from memoization

---

## References

- [React Docs - useMemo](https://react.dev/reference/react/useMemo)
- [React Docs - useCallback](https://react.dev/reference/react/useCallback)