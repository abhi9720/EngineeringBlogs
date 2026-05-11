---
title: "Observables vs Promises"
description: "Understanding the difference between RxJS Observables and JavaScript Promises for async operations."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - rxjs
  - observables
  - promises
  - frontend
coverImage: "/images/frontend/angular/observables-promises.png"
draft: false
---

# Observables vs Promises: The Complete Guide

## Overview

Promises and Observables both handle async operations, but they work differently. Understanding when to use each is essential in Angular.

---

## Promises

```javascript
// Promises are single-value async containers
const promise = new Promise((resolve, reject) => {
  setTimeout(() => resolve('Done!'), 1000);
});

promise.then(result => console.log(result)); // 'Done!'

// Can only resolve/reject once
```

---

## Observables

```javascript
// Observables are streams of values over time
import { Observable } from 'rxjs';

const observable = new Observable(observer => {
  setTimeout(() => observer.next('First'), 1000);
  setTimeout(() => observer.next('Second'), 2000);
  setTimeout(() => observer.complete(), 3000);
});

observable.subscribe(
  value => console.log(value),  // 'First', 'Second'
  error => console.error(error),
  () => console.log('Complete!')
);
```

---

## Key Differences

| Aspect | Promise | Observable |
|--------|---------|------------|
| Values | Single | Multiple over time |
| Cancellation | Not cancellable | Cancellable |
| Operators | None | Rich operator library |
| Lazy | Starts immediately | Starts on subscribe |
| Error handling | .catch() | Error handling in stream |

---

## When to Use Each

```javascript
// Use Promises for:
// - Single async operation
// - HTTP requests that complete once

const user = await fetch('/api/user').then(r => r.json());

// Use Observables for:
// - Multiple values over time
// - Streams (user input, websocket)
// - Complex async workflows with operators

import { fromEvent } from 'rxjs';
const clicks = fromEvent(button, 'click');
clicks.pipe(
  debounceTime(300),
  map(event => event.clientX)
).subscribe(x => console.log(x));
```

---

## Converting Between

```javascript
// Promise to Observable
import { from } from 'rxjs';
const observable = from(promise);

// Observable to Promise
import { firstValueFrom } from 'rxjs';
const promise = firstValueFrom(observable);
```

---

## Summary

1. **Promise**: Single async value, not cancellable
2. **Observable**: Multiple values over time, cancellable
3. **Use Promise**: One-time HTTP requests
4. **Use Observable**: Streams, user events, real-time data

---

## References

- [RxJS Documentation](https://rxjs.dev/)
- [Angular - Observables](https://angular.io/guide/observables)