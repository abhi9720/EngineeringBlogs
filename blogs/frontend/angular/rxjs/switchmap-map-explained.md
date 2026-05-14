---
title: 'switchMap, map Explained'
description: >-
  Master RxJS switchMap and map operators - flattening streams and transforming
  data.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - angular
  - rxjs
  - switchmap
  - map
  - frontend
coverImage: /images/frontend/angular/rxjs-switchmap.png
draft: false
order: 10
---
# switchMap, map Explained: The Complete Guide

## Overview

map and switchMap are essential RxJS operators. Understanding them enables complex async workflows in Angular.

---

## map Operator

### Transform Each Value

```typescript
import { of } from 'rxjs';
import { map } from 'rxjs/operators';

of(1, 2, 3).pipe(
  map(x => x * 2)
).subscribe(x => console.log(x));
// Output: 2, 4, 6
```

### Real Example

```typescript
import { from } from 'rxjs';
import { map } from 'rxjs/operators';

from(fetch('/api/users').then(r => r.json())).pipe(
  map(users => users.map(u => u.name.toUpperCase()))
).subscribe(names => console.log(names));
```

---

## switchMap Operator

### Cancel Previous Request

```typescript
import { Subject } from 'rxjs';
import { switchMap, debounceTime } from 'rxjs/operators';

const searchTerm = new Subject<string>();

searchTerm.pipe(
  debounceTime(300),
  switchMap(term => 
    fetch(`/api/search?q=${term}`).then(r => r.json())
  )
).subscribe(results => console.log(results));

// When user types quickly, previous requests are cancelled
searchTerm.next('hello'); // Request starts
searchTerm.next('hello w'); // Previous cancelled, new starts
```

### Use Cases

```typescript
// Typeahead search
inputControl.valueChanges.pipe(
  debounceTime(300),
  switchMap(term => api.search(term))
).subscribe(results => this.results = results);

// Route to data
route.params.pipe(
  switchMap(params => api.getProduct(params.id))
).subscribe(product => this.product = product);
```

---

## Combining with Other Operators

```typescript
import { interval } from 'rxjs';
import { switchMap, map, take, filter } from 'rxjs/operators';

interval(1000).pipe(
  switchMap(() => fetch('/api/data').then(r => r.json())),
  map(data => data.value),
  filter(value => value > 10),
  take(5)
).subscribe(value => console.log(value));
```

---

## Summary

1. **map**: Transform each emitted value
2. **switchMap**: Map to inner observable, cancel previous
3. **Use switchMap**: For requests that can be cancelled
4. **Use map**: For simple transformations

---

## References

- [RxJS switchMap](https://rxjs.dev/api/operators/switchMap)
- [RxJS map](https://rxjs.dev/api/operators/map)
