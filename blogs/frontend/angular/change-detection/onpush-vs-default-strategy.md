---
title: "OnPush vs Default Strategy"
description: "Understanding Angular change detection strategies - when to use OnPush for performance."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - change detection
  - onpush
  - performance
  - frontend
coverImage: "/images/frontend/angular/change-detection-strategy.png"
draft: false
---

# OnPush vs Default Strategy: The Complete Guide

## Overview

Angular's change detection can run in Default or OnPush mode. Understanding when to use OnPush significantly improves performance.

---

## Default Strategy

```typescript
// Default: Angular checks on every change anywhere in app
@Component({
  selector: 'app-root',
  template: `<div>Count: {{ count }}</div>`
})
export class AppComponent {
  count = 0;
  
  increment() {
    this.count++;
    // Angular checks entire component tree
  }
}
```

---

## OnPush Strategy

```typescript
// OnPush: Only check when:
@Component({
  selector: 'app-child',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div>{{ data.name }}</div>`
})
export class ChildComponent {
  @Input() data: { name: string };
  
  // Angular checks when:
  // 1. Input reference changes
  // 2. Event from component or child
  // 3. Async pipe emits
  // 4. Manual change detection triggered
}
```

---

## When to Use OnPush

```typescript
// Perfect for:
// - Pure presentation components
// - Redux/State management (state comes from store)
// - Unidirectional data flow

@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
  `
})
export class CardComponent {
  @Input() title: string;
  @Input() description: string;
}
```

---

## Manual Change Detection

```typescript
import { ChangeDetectorRef } from '@angular/core';

@Component({
  selector: 'app-manual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div>{{ data }}</div>`
})
export class ManualComponent {
  data: string;
  
  constructor(private cdr: ChangeDetectorRef) {}
  
  updateData(newData: string) {
    this.data = newData;
    this.cdr.detectChanges(); // Manual trigger
  }
}
```

---

## Summary

1. **Default**: Checks entire tree on any change
2. **OnPush**: Only checks when inputs change, events, or manually triggered
3. **Use OnPush**: For presentational components, better performance
4. **Always use**: With reactive state management

---

## References

- [Angular - Change Detection](https://angular.io/guide/change-detection)