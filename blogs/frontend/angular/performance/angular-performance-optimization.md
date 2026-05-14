---
title: Angular Performance Optimization
description: >-
  Optimizing Angular applications - change detection, lazy loading, bundle size,
  and more.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - angular
  - performance
  - optimization
  - frontend
coverImage: /images/frontend/angular/performance-optimization.png
draft: false
order: 10
---
# Angular Performance Optimization: The Complete Guide

## Overview

Angular apps can become slow without proper optimization. This guide covers key techniques for better performance.

---

## Change Detection Optimization

```typescript
// OnPush change detection strategy
@Component({
  selector: 'app-user',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div>{{ user.name }}</div>`
})
export class UserComponent {
  @Input() user: User;
}
```

---

## Lazy Loading

```typescript
// Lazy load feature modules
const routes: Routes = [
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.module')
      .then(m => m.AdminModule)
  }
];

// Lazy load standalone components (Angular 15+)
const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component')
      .then(c => c.DashboardComponent)
  }
];
```

---

## Bundle Optimization

```typescript
// angular.json
{
  "configurations": {
    "production": {
      "optimization": true,
      "sourceMap": false,
      "buildOptimizer": true,
      "namedChunks": false
    }
  }
}
```

---

## Other Optimizations

```typescript
// TrackBy for ngFor
*ngFor="let item of items; trackBy: trackById"
trackById(index: number, item: Item): number {
  return item.id;
}

// Pure pipes (default)
@Pipe({ name: 'filter', pure: true })
export class FilterPipe {}
```

---

## Summary

1. **OnPush**: Reduce change detection
2. **Lazy loading**: Split code bundles
3. **TrackBy**: Optimize ngFor
4. **Build optimization**: Production config

---

## References

- [Angular Performance](https://angular.io/guide/performance)
