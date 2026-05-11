---
title: "Microtasks vs Macrotasks"
description: "Understand JavaScript task queues - microtasks (promises) vs macrotasks (setTimeout), execution order."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - javascript
  - async
  - microtasks
  - macrotasks
  - frontend
coverImage: "/images/frontend/javascript/microtasks-macrotasks.png"
draft: false
---

# Microtasks vs Macrotasks: The Complete Guide

## Overview

JavaScript has two types of task queues: the macrotask queue (also called task queue) and the microtask queue. Understanding how they work and their execution order is crucial for predicting async code behavior.

---

## Two Queues

```javascript
/*
┌─────────────────────────────────────────────────────────────┐
│                    Event Loop                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────┐    ┌─────────────────────────┐   │
│   │   Microtask Queue   │    │   Macrotask (Task) Queue│   │
│   │                     │    │                         │   │
│   │  - Promises         │    │  - setTimeout           │   │
│   │  - queueMicrotask   │    │  - setInterval          │   │
│   │  - MutationObserver │    │  - I/O callbacks        │   │
│   │  - IntersectionObs │    │  - UI rendering         │   │
│   │  - await            │    │  - event handlers       │   │
│   │                     │    │                        │   │
│   └─────────────────────┘    └─────────────────────────┘   │
│                                                             │
│   Execution order:                                          │
│   1. Run current call stack                                 │
│   2. Run ALL microtasks (until empty)                       │
│   3. Run ONE macrotask                                     │
│   4. Render (if needed)                                     │
│   5. Back to step 2                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
*/
```

---

## Macrotasks (Tasks)

```javascript
// setTimeout goes to macrotask queue
console.log('1');

setTimeout(() => {
  console.log('2');
}, 0);

console.log('3');

// Output: 1, 3, 2

/* 
After sync code (1, 3):
- setTimeout callback goes to macrotask queue
- When call stack is empty, event loop picks up macrotask
- Callback runs: prints 2
*/

// Other macrotasks
setInterval(() => console.log('tick'), 1000);
IOTask(callback); // I/O callbacks
UIEvent(callback); // Click, keypress events
```

---

## Microtasks

```javascript
// Promise callbacks go to microtask queue
console.log('1');

Promise.resolve().then(() => {
  console.log('2');
});

console.log('3');

// Output: 1, 3, 2

/*
After sync code (1, 3):
- Promise callback goes to microtask queue
- Event loop runs ALL microtasks (not just one)
- Microtask runs: prints 2
*/

// Multiple promises
Promise.resolve().then(() => console.log('a'));
Promise.resolve().then(() => console.log('b'));
Promise.resolve().then(() => console.log('c'));

// Output: a, b, c - all microtasks run in order
```

---

## Execution Order

```javascript
// Complete example
console.log('1: sync');

setTimeout(() => console.log('2: timeout'), 0);

Promise.resolve().then(() => console.log('3: promise'));

console.log('4: sync');

/*
Output:
1: sync
4: sync
3: promise   ← microtasks run first
2: timeout   ← then ONE macrotask
*/

// More complex
console.log('1');

setTimeout(() => console.log('2'), 0);

Promise.resolve().then(() => {
  console.log('3');
  Promise.resolve().then(() => console.log('4'));
});

Promise.resolve().then(() => console.log('5'));

console.log('6');

/*
Output:
1
6
3          ← first promise microtask
5          ← second microtask
4          ← microtask created by other microtask (runs immediately!)
2          ← macrotask
*/
```

---

## What Goes Where

### Microtasks

```javascript
// Promise callbacks
Promise.resolve().then(fn);

// queueMicrotask
queueMicrotask(() => console.log('microtask'));

// MutationObserver
new MutationObserver(callback).observe(element, config);

// Async/await (implicitly uses promises)
async function foo() {
  await bar(); // bar()'s resolve goes to microtask
}

// await pauses and resolves in microtask
async function example() {
  console.log('1');
  await console.log('2'); // resolved in microtask
  console.log('3'); // runs in microtask
}
example();
console.log('4');

// Output: 1, 2, 4, 3
```

### Macrotasks

```javascript
// setTimeout/setInterval
setTimeout(fn, 0);
setInterval(fn, 100);

// I/O operations
fs.readFile('file', callback);

// Event callbacks
element.addEventListener('click', fn);

// UI rendering (browser)
requestAnimationFrame(fn); // Actually runs before next paint
```

---

## Practical Implications

### Blocking the Event Loop

```javascript
// Heavy microtask blocks everything
function blockMicrotasks() {
  return new Promise(resolve => {
    // Runs microtasks until resolve is called
    queueMicrotask(resolve); // Won't run until after all microtasks!
  });
}

// Running during macro to micro transition
async function demo() {
  console.log('start');
  
  setTimeout(() => console.log('timeout'), 0);
  
  await Promise.resolve(); // Creates microtask checkpoint
  
  console.log('checkpoint');
  
  await Promise.resolve(); // Another checkpoint
  
  console.log('end');
}

demo();
console.log('sync end');

// Output: start, sync end, checkpoint, end, timeout
```

### Animation Frames

```javascript
// requestAnimationFrame runs after microtasks, before paint
console.log('1');

requestAnimationFrame(() => console.log('2'));

Promise.resolve().then(() => console.log('3'));

setTimeout(() => console.log('4'), 0);

console.log('5');

// Output order: 1, 5, 3, 2, 4
/*
1, 5 - sync
3 - microtask
2 - rAF (after microtasks, before paint)
4 - macrotask
*/
```

---

## Common Mistakes

### Mistake 1: Expecting setTimeout First

```javascript
// WRONG expectation
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));

// Both added at ~same time, but promise runs first!
```

### Mistake 2: Infinite Microtask Loop

```javascript
// This creates an infinite loop!
function loop() {
  queueMicrotask(loop);
}
loop();

// Browser will show: "Script takes too long to execute"
```

### Mistake 3: Mixing setTimeout and Promise

```javascript
// Confusion about timing
async function demo() {
  await Promise.resolve(); // microtask
  console.log('1');
  
  await new Promise(r => setTimeout(r, 0)); // macrotask!
  console.log('2');
}
```

---

## Summary

1. **Microtasks**: Promises, queueMicrotask, MutationObserver, await
2. **Macrotasks**: setTimeout, setInterval, I/O, events
3. **Order**: After sync code → ALL microtasks → ONE macrotask → repeat
4. **Microtasks have higher priority**: Run before macrotasks
5. **await creates microtask**: Resumes in microtask queue
6. **Blocking**: Long microtask chains block rendering

Remember: microtasks run in batches, macrotasks run one at a time.

---

## References

- [HTML Spec - Event loop](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop)
- [Jake Archibald - Tasks, microtasks](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)
- [MDN - queueMicrotask](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)