---
title: "Memory Leaks in JavaScript"
description: "Identify and prevent memory leaks - common causes, detection, and best practices."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - javascript
  - memory
  - performance
  - frontend
coverImage: "/images/frontend/javascript/memory-leaks.png"
draft: false
---

# Memory Leaks in JavaScript: The Complete Guide

## Overview

Memory leaks occur when applications allocate memory but fail to release it. In JavaScript, garbage collection should handle this automatically, but common patterns can prevent proper cleanup. Understanding these patterns helps you write leak-free code.

---

## How Garbage Collection Works

```javascript
// JavaScript uses automatic garbage collection
// Objects that are no longer reachable are collected

// When object becomes unreachable:
let obj = { value: 100 };
obj = null; // Original object has no references - collected

// But circular references are handled
function createCycle() {
  const a = {};
  const b = {};
  a.prop = b;
  b.prop = a; // Circular reference
  return { a, b };
}

const obj = createCycle();
obj = null; // Both a and b become unreachable, collected together

// Closures keep references - can cause leaks
function createLeak() {
  const largeData = new Array(1000000).fill('x');
  
  return function() {
    return largeData[0]; // Keeps largeData in memory forever!
  };
}
```

---

## Common Causes of Memory Leaks

### Cause 1: Global Variables

```javascript
// Global variables are never garbage collected
function leak() {
  someGlobal = 'This is never cleaned up';
}

// Even worse: accidental globals
function foo() {
  this.variable = 'leaks to global'; // 'this' is global in non-strict
}

foo();

// Solution: use 'use strict'
```

### Cause 2: Forgotten Timers

```javascript
// setTimeout/setInterval that never clear
function startTimer() {
  setInterval(() => {
    // This runs forever
    updateDashboard();
  }, 1000);
}

// Don't forget to clear
function stopTimer() {
  clearInterval(timerId);
}

// Better: clean up in component unmount/unload
function componentMount() {
  const timer = setInterval(doWork, 1000);
  
  return () => clearInterval(timer); // Cleanup function
}

const cleanup = componentMount();
// When done:
cleanup(); // Clears timer
```

### Cause 3: Event Listeners

```javascript
// Event listeners create references to handler
element.addEventListener('click', handler);
element = null; // Element might be collected, but handler keeps reference

// Always remove listeners
element.addEventListener('click', handler);
// ... later
element.removeEventListener('click', handler);

// With component frameworks
class Component {
  mount() {
    window.addEventListener('resize', this.handleResize);
  }
  
  unmount() {
    window.removeEventListener('resize', this.handleResize);
  }
}
```

### Cause 4: Closures

```javascript
// Closures that capture more than needed
function createBigClosure() {
  const bigArray = new Array(1000000);
  const bigObject = { data: bigArray };
  
  return function(smallData) {
    return smallData; // Still keeps bigObject in memory!
  };
}

// Fix: only capture what you need
function createFixedClosure() {
  const bigArray = new Array(1000000);
  
  return function(index) {
    return bigArray[index]; // Only references specific index
  };
}
```

### Cause 5: Detached DOM

```javascript
// DOM elements kept in memory after removal
const list = document.getElementById('list');
const items = [];

for (let i = 0; i < 1000; i++) {
  const item = document.createElement('div');
  items.push(item);
  list.appendChild(item);
}

// If we keep reference to items, removing from DOM doesn't free memory
list.innerHTML = ''; // DOM nodes removed, but items array still has references

// Keep only what you need
const data = items.map(item => ({ text: item.textContent }));
// Clear references
items.length = 0;
```

---

## Detection

### Chrome DevTools

```javascript
// Memory Profiler:
// 1. Open DevTools → Memory
// 2. Take heap snapshot
// 3. Compare snapshots for growing objects

// Allocation timeline:
// 1. Start recording
// 2. Perform actions
// 3. Look for increasing memory
```

### Memory Timeline

```javascript
// Watch for patterns in DevTools:

// Stable: Memory stays consistent
// // // // // // //

// Leak: Memory grows continuously
// ///// ////// /////// ////////// /////////////

// Garbage collection: Drops in memory
// //// // //// // //// // //
```

---

## Prevention

### Use WeakMap/WeakSet

```javascript
// WeakMap doesn't prevent garbage collection of keys
const cache = new WeakMap();

function processData(data) {
  if (!cache.has(data)) {
    const result = expensiveOperation(data);
    cache.set(data, result);
  }
  return cache.get(data);
}
// When data is no longer used elsewhere, it can be garbage collected
```

### Clean Up in React/Angular

```javascript
// React
useEffect(() => {
  window.addEventListener('resize', handleResize);
  
  return () => {
    window.removeEventListener('resize', handleResize);
  };
}, []);

// Angular
ngOnInit() {
  this.resizeSub = fromEvent(window, 'resize')
    .pipe(throttleTime(100))
    .subscribe();
}

ngOnDestroy() {
  this.resizeSub.unsubscribe();
}
```

### Avoid Creating References

```javascript
// Instead of storing DOM references
const elements = {
  header: document.querySelector('.header'),
  footer: document.querySelector('.footer')
};
// elements stays in memory forever

// Use ID lookup when needed
function getHeader() {
  return document.getElementById('header');
}
```

---

## Best Practices

### 1. Always Clean Up

```javascript
// Timers
const timer = setInterval(fn, 100);
clearInterval(timer);

// Event listeners
el.addEventListener('click', handler);
el.removeEventListener('click', handler);

// Subscriptions
const sub = observable.subscribe(fn);
sub.unsubscribe();
```

### 2. Nullify Large References

```javascript
function processLargeData() {
  const data = loadBigData();
  
  // Process...
  
  // Clean up
  data = null;
}
```

### 3. Use Component Lifecycle

```javascript
class Component {
  constructor() {
    this.listeners = [];
  }
  
  addListener() {
    const listener = () => {};
    this.listeners.push(listener);
    window.addEventListener('resize', listener);
  }
  
  destroy() {
    this.listeners.forEach(listener => {
      window.removeEventListener('resize', listener);
    });
    this.listeners = [];
  }
}
```

### 4. Monitor in Production

```javascript
// Use performance monitoring
// - Chrome Lighthouse
// - Web Vitals
// - Sentry or similar for error tracking

// Log memory if available
if (performance.memory) {
  console.log('JS Heap:', performance.memory.jsHeapSizeLimit);
}
```

---

## Summary

1. **Globals**: Avoid accidental global variables
2. **Timers**: Always clear setTimeout/setInterval
3. **Events**: Remove event listeners when done
4. **Closures**: Only capture what you need
5. **DOM**: Don't hold references to removed DOM
6. **Detect**: Use Chrome DevTools memory profiler
7. **Prevent**: Clean up in component lifecycle

Memory leaks accumulate over time. Monitor, detect, and fix early.

---

## References

- [MDN - Memory Management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_Management)
- [Chrome DevTools - Memory](https://developer.chrome.com/docs/devtools/memory-problems/)
- [GitHub - Memory Leaks](https://github.com/nickdnk/fixing-memory-leaks-in-javascript)