---
title: Memoization Mistakes
description: >-
  Common mistakes with React memoization - using React.memo, useMemo, and
  useCallback incorrectly.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - react
  - memoization
  - performance
  - frontend
coverImage: /images/frontend/react/memoization-mistakes.png
draft: false
order: 20
---
# Memoization Mistakes: The Complete Guide

## Overview

React memoization can hurt performance if used incorrectly. This guide covers common mistakes and how to fix them.

---

## Mistake 1: Memoizing Everything

```jsx
// WRONG: Over-memoization adds overhead
const Button = React.memo(function Button({ onClick }) {
  return <button onClick={onClick}>Click</button>;
});

const Text = React.memo(function Text({ children }) {
  return <span>{children}</span>;
});

// These are simple - no need to memoize
// Memoization has cost: comparison + memory
```

---

## Mistake 2: Wrong Dependencies

```jsx
// WRONG: Dependencies that change every render
useMemo(() => {
  return heavyComputation(data);
}, [someRandomValue]); // New reference each render!

// CORRECT: Stable dependencies
useMemo(() => {
  return heavyComputation(data);
}, [data.id]); // Stable identifier
```

---

## Mistake 3: Inline Functions in JSX

```jsx
// WRONG: New function each render triggers re-render
<Child onClick={() => doSomething(id)} />

// CORRECT: Use useCallback
const handleClick = useCallback(() => doSomething(id), [id]);
<Child onClick={handleClick} />
```

---

## Mistake 4: Not Understanding Reference Equality

```jsx
// WRONG: New object every render
const options = { limit: 10, offset: 0 };
useEffect(() => {
  fetchData(options);
}, [options]); // Runs every render!

// CORRECT: Separate dependencies
const limit = 10;
const offset = 0;
useEffect(() => {
  fetchData({ limit, offset });
}, [limit, offset]); // Only runs when these change
```

---

## When to Use Memoization

```typescript
// Use when:
// - Component renders slowly
// - Complex calculations
// - Stable callbacks needed for memoized children

// Don't use for:
// - Simple components
// - Primitive values
// - Already optimized by framework
```

---

## Summary

1. **Don't over-memoize**: Adds overhead
2. **Dependencies matter**: Wrong deps = ineffective
3. **Inline functions**: Create new references
4. **Reference equality**: Objects/arrays need special handling

---

## References

- [React Docs - useMemo](https://react.dev/reference/react/useMemo)
