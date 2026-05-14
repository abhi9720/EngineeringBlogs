---
title: Injector Hierarchy
description: >-
  Understanding Angular's injector hierarchy - how Angular resolves dependencies
  at different levels.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - angular
  - dependency injection
  - injectors
  - frontend
coverImage: /images/frontend/angular/injector-hierarchy.png
draft: false
order: 20
---
# Injector Hierarchy: The Complete Guide

## Overview

Angular maintains a hierarchy of injectors that resolve dependencies. Understanding this hierarchy helps you control scope and optimize your application.

---

## Injector Levels

```typescript
/*
Injector Hierarchy:
┌─────────────────────────────────────────┐
│            Root Injector               │
│  (providedIn: 'root' services)          │
│  ┌───────────────────────────────────┐  │
│  │      Module Injector               │  │
│  │  (lazy module injectors)          │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   Component Injector         │  │  │
│  │  │  (component-level services) │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
*/
```

---

## Resolution Process

```typescript
// When Angular needs a dependency:
// 1. Check component's injector
// 2. If not found, check parent component
// 3. Continue up to root injector
// 4. If not found, throw error

@Component({
  selector: 'child',
  providers: [MyService] // New instance for this component + children
})
class ChildComponent {
  constructor(private myService: MyService) {}
}

// Parent gets different instance or root instance
```

---

## Provide in Module vs Component

```typescript
// Module - singleton for entire module
@NgModule({
  providers: [UserService]
})
class UserModule {}

// Component - new instance per component
@Component({
  selector: 'app-child',
  providers: [UserService]
})
class ChildComponent {}

// Lazy Module - new instance per lazy loaded portion
const routes: Routes = [
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule)
  }
];
```

---

## Summary

1. **Root Injector**: App-wide singleton
2. **Module Injector**: Module-level scope
3. **Component Injector**: Component-level scope
4. **Resolution**: Bottom-up, first match wins

---

## References

- [Angular DI - Injectors](https://angular.io/guide/dependency-injection-providers)
