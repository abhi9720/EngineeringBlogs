---
title: List Virtualization
description: >-
  Rendering large lists efficiently - windowing and virtualization techniques in
  React.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - react
  - performance
  - virtualization
  - lists
  - frontend
coverImage: /images/frontend/react/virtualization.png
draft: false
order: 10
---
# List Virtualization: The Complete Guide

## Overview

Rendering thousands of list items slows down React. Virtualization only renders items visible on screen.

---

## The Problem

```jsx
// Without virtualization - renders all items
function BadList() {
  const items = new Array(10000).fill(null).map((_, i) => i);
  
  return (
    <ul>
      {items.map(i => (
        <li key={i}>Item {i}</li>
      ))}
    </ul>
  );
  // Creates 10,000 DOM nodes! Slow!
}
```

---

## The Solution

```jsx
// Using react-window for virtualization
import { FixedSizeList } from 'react-window';

function VirtualizedList() {
  const items = new Array(10000).fill(null).map((_, i) => `Item ${i}`);
  
  const Row = ({ index, style }) => (
    <div style={style}>{items[index]}</div>
  );
  
  return (
    <FixedSizeList
      height={400}
      width={300}
      itemSize={30}
      itemCount={items.length}
    >
      {Row}
    </FixedSizeList>
  );
  // Only renders ~14 items visible + buffer!
}
```

---

## Libraries

```typescript
// react-window - Popular, lightweight
// react-virtualized - More features
// @tanstack/react-virtual - Modern, headless
// react-virtuoso - Easy to use, many features
```

---

## When to Use

```typescript
// Use virtualization for:
// - Lists with 100+ items
// - Infinite scroll
// - Tables with many rows

// Don't use for:
// - Small lists (< 50 items)
// - Fixed, small lists
```

---

## Summary

1. **Virtualization**: Only render visible items
2. **react-window**: Popular library
3. **Performance**: Huge improvement for large lists
4. **Use when**: 100+ items need rendering

---

## References

- [react-window](https://github.com/bvaughn/react-window)
- [React Virtual](https://tanstack.com/react-virtual)
