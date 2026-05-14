---
title: async/await Internals
description: >-
  Understand how async/await works - syntactic sugar over Promises, execution
  flow, and common pitfalls.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - javascript
  - async
  - await
  - promises
  - frontend
coverImage: /images/frontend/javascript/async-await.png
draft: false
order: 10
---
# async/await Internals: The Complete Guide

## Overview

async/await is syntactic sugar over Promises that makes asynchronous code look and behave more like synchronous code. Understanding how it works under the hood helps you debug issues and write better async code.

---

## How async/await Works

### Function Transformation

```javascript
// async function
async function fetchData() {
  const response = await fetch('/api/data');
  return response.json();
}

// Compiler transforms this into something like:
function fetchData() {
  return new Promise((resolve, reject) => {
    try {
      const response = await fetch('/api/data'); // How does this work?
      resolve(response.json());
    } catch (error) {
      reject(error);
    }
  });
}
```

### Behind the Scenes

```javascript
// What actually happens when you use await:
/*
1. async function returns a Promise
2. When await is reached:
   - Function execution pauses
   - Returns from async function (Promise pending)
3. When awaited Promise resolves:
   - Resume execution from where it paused
   - Return value becomes the await expression value
4. If awaited Promise rejects:
   - Throw the rejection as an exception
*/

// Simple example
async function example() {
  console.log('1: start');
  
  const data = await new Promise(resolve => {
    setTimeout(() => {
      resolve('resolved!');
    }, 1000);
  });
  
  console.log('2: after await', data);
  return 'done';
}

console.log('Calling...');
example().then(result => console.log('Result:', result));

// Output:
// Calling...
// 1: start
// (1 second passes)
// 2: after await resolved!
// Result: done
```

---

## Execution Flow

### Sequential vs Parallel

```javascript
// Sequential - each await waits for previous
async function sequential() {
  const user = await fetch('/api/user').then(r => r.json());
  const posts = await fetch('/api/posts').then(r => r.json());
  const comments = await fetch('/api/comments').then(r => r.json());
  
  return { user, posts, comments };
  // Takes 3x as long as each fetch (assuming parallel possible)
}

// Parallel - start all together, await all results
async function parallel() {
  const [userRes, postsRes, commentsRes] = await Promise.all([
    fetch('/api/user'),
    fetch('/api/posts'),
    fetch('/api/comments')
  ]);
  
  const user = await userRes.json();
  const posts = await postsRes.json();
  const comments = await commentsRes.json();
  
  return { user, posts, comments };
  // Takes as long as the slowest single request
}
```

### Error Handling Differences

```javascript
// try/catch approach
async function withTryCatch() {
  try {
    const response = await fetch('/api/data');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed:', error);
    throw error;
  }
}

// Promise.catch approach  
async function withCatch() {
  const response = await fetch('/api/data').catch(err => {
    console.error('Error:', err);
    throw err;
  });
  
  return response.json();
}

// Return value handling
async function getData() {
  try {
    const result = await fetch('/api/data');
    return result.json(); // Returns Promise, not value!
  } catch (error) {
    return { error: true }; // Still returns Promise
  }
}
```

---

## Common Pitfalls

### Pitfall 1: Not Awaiting

```javascript
// WRONG: Forgot await
async function getData() {
  const response = fetch('/api/data'); // Returns Promise, not data!
  return response.json(); // Error!
}

// CORRECT
async function getData() {
  const response = await fetch('/api/data');
  return response.json();
}
```

### Pitfall 2: Using await in Loop

```javascript
// WRONG: Sequential in loop
async function processItems(items) {
  const results = [];
  
  for (const item of items) {
    const result = await processItem(item); // Waits for each!
    results.push(result);
  }
  
  return results;
}

// CORRECT: Parallel where possible
async function processItems(items) {
  const promises = items.map(item => processItem(item));
  const results = await Promise.all(promises);
  
  return results;
}

// Only use sequential when order matters
async function processSequentially(items) {
  const results = [];
  
  for (const item of items) {
    const result = await processItem(item); // Wait in order
    results.push(result);
  }
  
  return results;
}
```

### Pitfall 3: Not Handling Promise Rejection

```javascript
// WRONG: async function without catch
async function getData() {
  const response = await fetch('/api/data');
  return response.json();
}

// Calling this without .catch() - unhandled rejection!
getData();

// CORRECT: Always handle
getData().catch(err => console.error(err));

// Or use IIFE
(async () => {
  try {
    const data = await getData();
    console.log(data);
  } catch (err) {
    console.error(err);
  }
})();
```

---

## Advanced Patterns

### Promise.all with async/await

```javascript
async function fetchMultiple() {
  // Start all requests in parallel
  const usersPromise = fetch('/api/users').then(r => r.json());
  const postsPromise = fetch('/api/posts').then(r => r.json());
  
  // Wait for all to complete
  const [users, posts] = await Promise.all([usersPromise, postsPromise]);
  
  return { users, posts };
}

// With error handling
async function fetchMultipleSafe() {
  const results = await Promise.allSettled([
    fetch('/api/users').then(r => r.json()),
    fetch('/api/posts').then(r => r.json())
  ]);
  
  const users = results[0].status === 'fulfilled' ? results[0].value : null;
  const posts = results[1].status === 'fulfilled' ? results[1].value : null;
  
  return { users, posts };
}
```

### Sequential with Recovery

```javascript
async function fetchWithFallback() {
  try {
    // Try primary source
    return await fetch('/api/primary').then(r => r.json());
  } catch (primaryError) {
    try {
      // Fallback to secondary
      return await fetch('/api/secondary').then(r => r.json());
    } catch (secondaryError) {
      // Both failed, return default
      return { data: [], error: 'All sources failed' };
    }
  }
}
```

### Queue with Concurrency Limit

```javascript
async function parallelLimit(tasks, limit = 3) {
  const results = [];
  const running = [];
  
  for (const task of tasks) {
    const p = Promise.resolve(task()).then(result => {
      results.push(result);
      running.splice(running.indexOf(p), 1);
    });
    
    running.push(p);
    
    if (running.length >= limit) {
      await Promise.race(running);
    }
  }
  
  await Promise.all(running);
  return results;
}

// Usage
const tasks = [() => fetch('/api/1'), () => fetch('/api/2'), ...];
const results = await parallelLimit(tasks, 3);
```

---

## Async Iterators

```javascript
// for await...of with async iterables
async function fetchPages(urls) {
  for await (const response of urls.map(url => fetch(url))) {
    const data = await response.json();
    console.log(data);
  }
}

// Async generator
async function* fetchPagesGenerator(urls) {
  for (const url of urls) {
    const response = await fetch(url);
    yield await response.json();
  }
}

// Usage
for await (const page of fetchPagesGenerator(urls)) {
  console.log(page);
}
```

---

## Summary

1. **async** transforms function to return a Promise
2. **await** pauses execution until Promise resolves
3. **await** only works in async functions
4. **Sequential**: await in loop processes one at a time
5. **Parallel**: Use Promise.all for concurrent operations
6. **Error handling**: Use try/catch with await
7. **Always await**: Don't forget the await keyword

async/await makes Promise code cleaner. Remember it's still Promise-based under the hood.

---

## References

- [MDN - async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
- [MDN - await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await)
- [V8 Blog - async/await](https://v8.dev/blog/fast-async)
