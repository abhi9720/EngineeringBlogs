---
title: "trackBy Function Importance"
description: "Understanding Angular's trackBy function - why it matters for ngFor performance."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - performance
  - ngfor
  - trackby
  - frontend
coverImage: "/images/frontend/angular/trackby.png"
draft: false
---

# trackBy Function Importance: The Complete Guide

## Overview

The trackBy function helps Angular optimize ngFor by tracking items by a unique identifier, preventing unnecessary DOM updates.

---

## Without trackBy

```typescript
// Angular recreates ALL DOM elements when array changes
@Component({
  template: `
    <li *ngFor="let user of users">{{ user.name }}</li>
  `
})
export class UserListComponent {
  users: User[] = [];
  
  updateUsers() {
    // If this replaces array with new reference,
    // Angular destroys and recreates ALL <li> elements
    this.users = [...this.users]; // New array reference
  }
}
```

---

## With trackBy

```typescript
@Component({
  template: `
    <li *ngFor="let user of users; trackBy: trackById">{{ user.name }}</li>
  `
})
export class UserListComponent {
  users: User[] = [];
  
  // Track by unique ID - Angular only updates what changed
  trackById(index: number, user: User): number {
    return user.id; // Unique identifier
  }
  
  updateUsers() {
    this.users = [...this.users];
    // Only new items get new DOM elements
  }
}
```

---

## Why It Matters

```typescript
/*
Without trackBy:
- Array changes → destroy all DOM → create all new DOM
- Slow for large lists
- Flashes/brief visual glitches

With trackBy:
- Array changes → compare IDs → update only changed elements
- Much faster for large lists
- Smooth updates
*/
```

---

## Common trackBy Functions

```typescript
// By ID
trackById(index: number, item: any): number {
  return item.id;
}

// By key (for Maps or objects)
trackByKey(index: number, item: any): string {
  return item.key;
}

// Complex tracking
trackByComposite(index: number, item: any): string {
  return `${item.type}-${item.id}`;
}
```

---

## Summary

1. **trackBy**: Unique identifier for each item
2. **Prevents**: Unnecessary DOM recreation
3. **Use for**: ngFor with frequently changing arrays

---

## References

- [Angular - ngFor trackBy](https://angular.io/api/common/NgForOf#tracking-function)