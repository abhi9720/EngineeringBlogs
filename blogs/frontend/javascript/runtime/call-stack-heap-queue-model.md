---
title: 'Call Stack, Heap & Queue Model'
description: >-
  Understand JavaScript runtime - how call stack, memory heap, and task queue
  work together.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - javascript
  - runtime
  - call stack
  - memory heap
  - frontend
coverImage: /images/frontend/javascript/call-stack-heap.png
draft: false
order: 10
---
# Call Stack, Heap & Queue Model: The Complete Guide

## Overview

JavaScript is single-threaded - it can only do one thing at a time. Understanding how the call stack, heap, and task queue work together explains how async code executes and where performance issues come from.

---

## The JavaScript Runtime

```
┌─────────────────────────────────────────────────────────────┐
│                     JavaScript Runtime                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐   ┌──────────────────┐               │
│  │    Call Stack    │   │    Task Queue    │               │
│  │                  │   │                  │               │
│  │  - synchronous   │   │  - setTimeout    │               │
│  │  - LIFO          │   │  - DOM events    │               │
│  │                  │   │  - I/O callbacks│               │
│  └──────────────────┘   └──────────────────┘               │
│           ↓                         ↓                     │
│  ┌──────────────────────────────────────────────┐         │
│  │              Microtask Queue                  │         │
│  │  - Promises                                  │         │
│  │  - MutationObserver                          │         │
│  │  - queueMicrotask                            │         │
│  └──────────────────────────────────────────────┘         │
│                                                             │
│  ┌──────────────────┐                                       │
│  │    Memory Heap   │                                       │
│  │                  │                                       │
│  │  - objects       │                                       │
│  │  - functions     │                                       │
│  │  - closures      │                                       │
│  └──────────────────┘                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Call Stack

### What It Does

```javascript
// The call stack tracks what function is executing

function greet() {
  console.log('Hello!');
}

function sayHello() {
  greet();  // Push to stack
}           // Pop from stack

sayHello(); // Push to stack
// ...
```

### Stack Visualization

```javascript
// Step-by-step execution
function a() {
  console.log('a: start');
  b();
  console.log('a: end');
}

function b() {
  console.log('b: start');
  c();
  console.log('b: end');
}

function c() {
  console.log('c');
}

a();

/*
Call Stack:
1. [] - start
2. [a] - a() called
3. [a, b] - b() called from a
4. [a, b, c] - c() called from b
5. [a, b] - c() finished
6. [a] - b() finished
7. [] - a() finished
*/

// Output:
// a: start
// b: start
// c
// b: end
// a: end
```

### Stack Overflow

```javascript
// Infinite recursion causes stack overflow
function recurse() {
  recurse();
}

recurse(); // RangeError: Maximum call stack size exceeded

// Using tail recursion (ES6 optimized)
function tailRecurse(n, acc = 0) {
  if (n <= 0) return acc;
  return tailRecurse(n - 1, acc + n);
}

tailRecurse(100000); // Works in some environments
```

---

## Memory Heap

### Allocation

```javascript
// Heap stores objects, functions, closures

// Object allocation
const user = {
  name: 'John',
  age: 30
};

// Function allocation
function greet(name) {
  return `Hello, ${name}!`;
}

// Closure - function with its scope
function createCounter() {
  let count = 0;  // Stored in heap with closure
  
  return function() {
    return ++count;
  };
}

const counter = createCounter(); // Closure retained in heap
```

### Garbage Collection

```javascript
// JavaScript uses automatic garbage collection

// Objects become eligible for garbage collection
// when there's no references to them

let obj = { value: 100 }; // obj references the object
obj = null; // No references, object becomes garbage

// Closures keep references
function outer() {
  const largeData = new Array(1000000); // Big array
  
  return function inner() {
    return largeData[0]; // Keeps largeData in memory!
  };
}

// Prevent memory leaks by clearing references
function onComponentUnmount() {
  this.data = null;
  this.callbacks = [];
  this.eventListeners = [];
}
```

---

## Task Queue (Macrotasks)

### How It Works

```javascript
// setTimeout goes to task queue, not call stack
console.log('1');

setTimeout(() => {
  console.log('2');
}, 0);

console.log('3');

// Output: 1, 3, 2
// setTimeout callback runs AFTER current execution completes
```

### Task Queue Order

```javascript
// Multiple async operations
console.log('1');

setTimeout(() => console.log('2'), 0);
setTimeout(() => console.log('3'), 0);
setTimeout(() => console.log('4'), 0);

console.log('5');

// Output: 1, 5, 2, 3, 4
// All setTimeout callbacks run in order after sync code
```

---

## Microtask Queue

### What Goes to Microtasks

```javascript
// Promises go to microtask queue
console.log('1');

Promise.resolve().then(() => console.log('2'));

console.log('3');

// Output: 1, 3, 2
// Promise callbacks have higher priority than setTimeout
```

### Macrotask vs Microtask

```javascript
console.log('1');

setTimeout(() => console.log('2'), 0);

Promise.resolve().then(() => console.log('3'));

Promise.resolve().then(() => {
  setTimeout(() => console.log('4'), 0);
});

console.log('5');

// Output: 1, 5, 3, 2, 4

/*
Order:
1. Sync: 1, 5
2. Microtasks: 3 (then Promise.resolve())
3. Macrotasks: 2 (setTimeout)
4. After macrotask, check microtasks (none)
5. Then microtask from step 3 created setTimeout(4) - runs after
*/
```

---

## Execution Flow

### The Full Picture

```javascript
// Browser runs in this order:
/*
1. Execute all synchronous code in call stack
2. When call stack is empty:
   a. Execute ALL microtasks (until empty)
   b. Execute ONE macrotask
   c. Render if needed
   d. Back to step 2
*/

// Example
async function main() {
  console.log('A');
  
  await Promise.resolve();
  console.log('B');
  
  setTimeout(() => console.log('C'), 0);
  
  console.log('D');
}

main();

// Output: A, D, B, C
```

---

## Blocking the Event Loop

### Synchronous Code Blocks Everything

```javascript
// BAD: Long synchronous operation
function heavyCalculation() {
  let result = 0;
  for (let i = 0; i < 1000000000; i++) {
    result += i;
  }
  return result;
}

// UI freezes while this runs
document.getElementById('btn').addEventListener('click', () => {
  heavyCalculation(); // Page freezes!
});
```

### Non-Blocking Solutions

```javascript
// Solution 1: Chunking with setTimeout
function processLargeArray(data, callback) {
  let i = 0;
  
  function processChunk() {
    const chunk = 1000;
    const end = Math.min(i + chunk, data.length);
    
    for (; i < end; i++) {
      // Process data[i]
    }
    
    if (i < data.length) {
      setTimeout(processChunk, 0); // Yield to event loop
    } else {
      callback();
    }
  }
  
  processChunk();
}

// Solution 2: Web Workers
// const worker = new Worker('worker.js');
// worker.postMessage(largeData);

// Solution 3: Async Iterators
async function* processLargeData(data) {
  const chunkSize = 1000;
  for (let i = 0; i < data.length; i += chunkSize) {
    yield data.slice(i, i + chunkSize);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

---

## Common Pitfalls

### Pitfall 1: Forgetting Async

```javascript
// WRONG: Expecting sync behavior from async
const users = ['Alice', 'Bob', 'Charlie'];
let results = [];

for (const user of users) {
  results.push(fetch(`/api/users/${user}`)); // Returns Promise, not data
}

// results is [Promise, Promise, Promise]

// CORRECT: Use Promise.all
const results = await Promise.all(
  users.map(user => fetch(`/api/users/${user}`))
);
```

### Pitfall 2: Mixing Sync and Async

```javascript
// WRONG
function getData() {
  let data;
  
  fetch('/api/data').then(result => {
    data = result; // This runs LATER
  });
  
  console.log(data); // undefined!
}

// CORRECT
async function getData() {
  const response = await fetch('/api/data');
  const data = await response.json();
  console.log(data); // Works!
}
```

---

## Summary

1. **Call Stack**: LIFO - executes synchronous code, tracks function calls
2. **Memory Heap**: Stores objects, functions, closures
3. **Task Queue**: Stores macrotasks (setTimeout, I/O, events)
4. **Microtask Queue**: Stores promises, has higher priority
5. **Event Loop**: When stack is empty, processes microtasks first, then one macrotask
6. **Blocking**: Synchronous code blocks everything - use async patterns

Understanding this model helps you write non-blocking code and debug async issues.

---

## References

- [MDN - Event Loop](https://developer.mozilla.org/en-US/docs/Web/JavaScript/EventLoop)
- [What happens when you type google.com](https://github.com/alex/what-happens-when)
- [Loupe - Visualize event loop](http://latentflip.com/loupe/)
