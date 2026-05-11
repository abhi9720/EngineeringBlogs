---
title: "Modules vs Standalone Components"
description: "Understanding Angular modules vs standalone components - when to use each approach."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - modules
  - standalone
  - architecture
  - frontend
coverImage: "/images/frontend/angular/modules-standalone.png"
draft: false
---

# Modules vs Standalone Components: The Complete Guide

## Overview

Angular offers two ways to organize applications: NgModules (traditional) and Standalone Components (modern). Understanding when to use each helps you make better architecture decisions.

---

## NgModules (Traditional)

```typescript
// Feature module
@NgModule({
  declarations: [
    UserListComponent,
    UserCardComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule
  ],
  providers: [UserService],
  exports: [UserListComponent]
})
export class UserModule {}

// Root module
@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, UserModule],
  bootstrap: [AppComponent]
})
export class AppModule {}
```

### Pros
- Clear feature boundaries
- Lazy loading support
- Established pattern

### Cons
- Boilerplate code
- Module order matters
- Harder to refactor

---

## Standalone Components (Modern)

```typescript
// Standalone component
@Component({
  selector: 'app-user',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `<div>User: {{ name }}</div>`
})
export class UserComponent {
  @Input() name: string;
}

// Bootstrap standalone
import { bootstrapApplication } from '@angular/platform-browser';

bootstrapApplication(UserComponent, {
  providers: [provideHttpClient()]
});
```

### Pros
- No NgModules needed
- Simpler refactoring
- Tree-shakable imports

### Cons
- Different mental model
- Some patterns need adjustment

---

## Comparison

| Aspect | NgModule | Standalone |
|--------|----------|------------|
| Boilerplate | More | Less |
| Imports | Import module | Import components |
| Lazy loading | loadChildren | loadComponent |
| Testing | Module-based | Simplified |
| Migration | Traditional | Modern (Angular 14+) |

---

## When to Use

```typescript
// Use NgModules for:
// - Large existing projects
// - Team familiar with pattern
// - Complex lazy loading

// Use Standalone for:
// - New projects
// - Simple applications
// - Migrating to modern Angular
```

---

## Summary

1. **NgModules**: Traditional, more boilerplate, good for large apps
2. **Standalone**: Modern, less code, better tree-shaking
3. **Migration**: Angular makes it easy to mix both

---

## References

- [Angular Standalone Guide](https://angular.io/guide/standalone-components)