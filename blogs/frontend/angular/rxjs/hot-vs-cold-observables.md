---
title: "Hot vs Cold Observables"
description: "Understanding hot and cold observables in RxJS - how data producers work and when each applies."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - rxjs
  - hot
  - cold
  - observables
  - frontend
coverImage: "/images/frontend/angular/hot-cold-observables.png"
draft: false
---

# Hot vs Cold Observables: The Complete Guide

## Overview

Understanding the difference between hot and cold observables is crucial for working with RxJS in Angular.

---

## Cold Observables

```typescript
// Cold: Each subscriber gets own data producer
const cold$ = new Observable(observer => {
  console.log('Producer created');
  observer.next(1);
  observer.next(2);
  observer.complete();
});

cold$.subscribe(v => console.log('A:', v)); // New producer
cold$.subscribe(v => console.log('B:', v)); // Another new producer

// Output:
// Producer created
// A: 1
// A: 2
// Producer created
// B: 1
// B: 2
```

---

## Hot Observables

```typescript
// Hot: All subscribers share same producer
import { Subject } from 'rxjs';

const subject = new Subject<number>();

subject.subscribe(v => console.log('A:', v));
subject.subscribe(v => console.log('B:', v));

subject.next(1);
subject.next(2);

// Output:
// A: 1
// B: 1
// A: 2
// B: 2
```

---

## Common Hot Observables in Angular

```typescript
// fromEvent - hot
import { fromEvent } from 'rxjs';
const clicks = fromEvent(document, 'click');
// All subscribers get same clicks

// Http requests - cold (each subscriber gets new request)
import { HttpClient } from '@angular/common/http';
// http.get() - cold, creates new request per subscription

// BehaviorSubject - hot
import { BehaviorSubject } from 'rxjs';
const auth = new BehaviorSubject<User>(null);
// Shares current value with new subscribers
```

---

## Converting Cold to Hot

```typescript
// Using share() to share subscription
import { interval } from 'rxjs';
import { share } from 'rxjs/operators';

const cold$ = interval(1000).pipe(share());

cold$.subscribe(); // Starts at 1st subscription
cold$.subscribe(); // Same source, no new producer
```

---

## Summary

1. **Cold**: New producer per subscriber (HTTP requests)
2. **Hot**: Shared producer (events, subjects)
3. **share()**: Convert cold to hot

---

## References

- [RxJS - Hot and Cold Observables](https://rxjs.dev/guide/observable)