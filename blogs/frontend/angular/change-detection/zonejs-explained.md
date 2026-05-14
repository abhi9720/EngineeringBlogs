---
title: Zone.js Explained
description: Understanding how Zone.js works with Angular for automatic change detection.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - angular
  - zonejs
  - change detection
  - frontend
coverImage: /images/frontend/angular/zonejs.png
draft: false
order: 10
---
# Zone.js Explained: The Complete Guide

## Overview

Zone.js is a library that patches async APIs to make them "aware" of the execution context. Angular uses it to know when to trigger change detection.

---

## How Zone.js Works

```javascript
// Zone.js patches:
// - setTimeout, setInterval
// - Promise
// - Event listeners (click, mousemove, etc.)
// - XHR/fetch
// - MutationObserver

// Each async operation runs in a "zone"
zone.run(() => {
  setTimeout(() => {
    // This callback runs in the same zone
    // Angular knows to check for changes after
  }, 1000);
});
```

---

## Why Angular Needs It

```typescript
// Without Zone.js:
// - Angular wouldn't know when async operations complete
// - Manual change detection needed

// With Zone.js:
// - After every async operation, Angular checks for changes
// - View updates automatically

@Component({ template: '<button (click)="count()">{{count}}</button>' })
class AppComponent {
  count = 0;
  
  count() {
    this.count++; // Angular detects change automatically
  }
}
```

---

## zoneless (Modern)

```typescript
// Angular 18+ supports zoneless
import { Component, signal, computed, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-zoneless',
  template: `
    <p>Count: {{ count() }}</p>
    <p>Doubled: {{ doubled() }}</p>
    <button (click)="increment()">Increment</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ZonelessComponent {
  count = signal(0);
  doubled = computed(() => this.count() * 2);
  
  increment() {
    this.count.update(c => c + 1);
  }
}
```

---

## Summary

1. **Zone.js**: Patches async APIs for context awareness
2. **Automatic detection**: Angular checks after async operations
3. **Zoneless**: New approach in Angular 18+ using signals

---

## References

- [Zone.js GitHub](https://github.com/angular/zone.js)
- [Angular Zoneless](https://angular.dev/guide/zoneless)
