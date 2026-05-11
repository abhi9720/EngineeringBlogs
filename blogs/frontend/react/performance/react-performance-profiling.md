---
title: "React Performance Profiling"
description: "Profiling React applications - using React DevTools to find and fix performance issues."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - performance
  - profiling
  - frontend
coverImage: "/images/frontend/react/profiling.png"
draft: false
---

# React Performance Profiling: The Complete Guide

## Overview

React DevTools helps you identify why components re-render and find performance bottlenecks.

---

## React DevTools Profiler

```javascript
/*
Profiling workflow:
1. Open DevTools → Profiler tab
2. Click "Record" to start profiling
3. Perform actions in app
4. Click "Stop" to see results

View:
- Flamegraph: Shows render time for each component
- Ranked: Components sorted by render time
- Timeline: Shows when rendering happens
*/
```

---

## Key Metrics

```typescript
/*
Profiler shows:
- Commit: When changes were applied to DOM
- Render duration: How long component took
- Why it rendered: Props, state, or context changed
- Did it render?: Whether component re-rendered
*/
```

---

## Finding Issues

```javascript
// Look for:
// 1. Components that render too often
// 2. Components that take too long to render
// 3. Components that render unnecessarily

// Red bars = components that re-rendered
// Orange bars = component took time to render
```

---

## Fixing Performance Issues

```typescript
// 1. Memoize components
const Expensive = React.memo(function Expensive({ data }) {
  return <div>{process(data)}</div>;
});

// 2. Memoize values
const processed = useMemo(() => processData(data), [data]);

// 3. Memoize callbacks
const handleClick = useCallback(() => {}, []);

// 4. Use production mode
// React is slower in development
```

---

## Summary

1. **DevTools**: Essential for performance debugging
2. **Profiler**: Find unnecessary re-renders
3. **Flamegraph**: Visualize render time
4. **Fix**: Use memo, useMemo, useCallback

---

## References

- [React DevTools](https://react.dev/learn/react-developer-tools)