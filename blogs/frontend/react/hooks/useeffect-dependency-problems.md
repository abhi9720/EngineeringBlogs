---
title: useEffect Dependency Problems
description: >-
  Common useEffect issues - infinite loops, missing dependencies, and how to fix
  them.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - react
  - hooks
  - useEffect
  - frontend
coverImage: /images/frontend/react/useeffect-problems.png
draft: false
order: 20
---
# useEffect Dependency Problems: The Complete Guide

## Overview

useEffect is powerful but tricky. This guide covers common problems and solutions for dependency arrays and effect behavior.

---

## Problem 1: Missing Dependencies

```jsx
// WRONG: Missing dependencies
function Component() {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    console.log('Count:', count);
  }); // No dependency array!
  
  // CORRECT: Add all used values
  useEffect(() => {
    console.log('Count:', count);
  }, [count]);
}
```

---

## Problem 2: Infinite Loops

```jsx
// WRONG: Object as dependency causes infinite loop
function Component() {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    setCount(count + 1); // Updates state, triggers effect again!
  }, [{}]); // New object each render!
  
  // CORRECT: Use primitive or stable reference
  useEffect(() => {
    setCount(c => c + 1);
  }, []); // Only run once
  
  // Or separate logic
  useEffect(() => {
    if (someCondition) {
      setCount(c => c + 1);
    }
  }, [someCondition]);
}
```

---

## Problem 3: Stale Closures

```jsx
// WRONG: Effect captures old state
function Component() {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      console.log(count); // Always logs 0!
    }, 1000);
    
    return () => clearInterval(interval);
  }, []); // Empty deps - closure captures initial count
  
  // CORRECT: Add to dependencies
  useEffect(() => {
    const interval = setInterval(() => {
      console.log(count);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [count]);
  
  // CORRECT: Use ref for mutable value
  function Component() {
    const countRef = useRef(0);
    const [_, setTick] = useState(0);
    
    useEffect(() => {
      countRef.current++;
      setTick(t => t + 1);
    }, []);
    
    return <div>{countRef.current}</div>;
  }
}
```

---

## Solutions

### Solution 1: Functional Updates

```jsx
// Don't need current value in dependency
setCount(prev => prev + 1); // Works with empty deps

useEffect(() => {
  setCount(prev => prev + 1);
}, []); // Safe - doesn't read current value
```

### Solution 2: useRef for Values

```jsx
// Store value in ref to avoid re-renders
function Timer() {
  const countRef = useRef(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      countRef.current++;
      console.log(countRef.current);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return null;
}
```

### Solution 3: useCallback for Stable Functions

```jsx
// Pass stable callback to child
function Parent() {
  const [value, setValue] = useState('');
  
  const handleChange = useCallback((newValue) => {
    setValue(newValue);
  }, []); // Stable reference
  
  return <Child onChange={handleChange} />;
}

function Child({ onChange }) {
  return <input onChange={e => onChange(e.target.value)} />;
}
```

---

## Summary

1. **Always include** used values in dependency array
2. **Avoid objects** as dependencies - use primitives
3. **Use functional updates** to avoid reading current state
4. **Use useRef** for values that shouldn't trigger re-renders
5. **Use useCallback** for stable function references

---

## References

- [React Docs - useEffect](https://react.dev/reference/react/useEffect)
