---
title: "Input Output Patterns"
description: "Angular component communication - @Input, @Output, and alternative patterns for parent-child communication."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - components
  - input
  - output
  - frontend
coverImage: "/images/frontend/angular/input-output.png"
draft: false
---

# Input Output Patterns: The Complete Guide

## Overview

Angular components communicate through @Input and @Output decorators. Understanding these patterns enables clean component architecture.

---

## Basic Input/Output

```typescript
// Child component
@Component({
  selector: 'app-button',
  template: `<button (click)="onClick.emit()">{{ label }}</button>`
})
export class ButtonComponent {
  @Input() label: string = 'Click';
  @Output() onClick = new EventEmitter<void>();
}

// Parent component usage
@Component({
  template: `<app-button label="Submit" (onClick)="handleSubmit()"></app-button>`
})
class ParentComponent {
  handleSubmit() {
    console.log('Clicked!');
  }
}
```

---

## Two-Way Binding

```typescript
// Child with two-way binding (Banana in a box)
@Component({
  selector: 'app-input',
  template: `<input [ngModel]="value" (ngModelChange)="valueChange.emit($event)">`
})
export class InputComponent {
  @Input() value: string;
  @Output() valueChange = new EventEmitter<string>();
}

// Parent usage - two-way binding
@Component({
  template: `<app-input [(value)]="name"></app-input>`
})
class ParentComponent {
  name = 'John';
}
```

---

## Alternative: Template Variables

```typescript
// Using ViewChild
@Component({
  selector: 'app-parent',
  template: `<app-child #child></app-child>
             <button (click)="child.reset()">Reset</button>`
})
class ParentComponent {
  @ViewChild('child') childComponent: ChildComponent;
}

// Using ContentChild for projected content
@Component({ selector: 'app-card' })
class CardComponent {
  @ContentChild(TemplateRef) template: TemplateRef<any>;
}
```

---

## Summary

1. **@Input**: Pass data to component
2. **@Output**: Emit events from component
3. **Two-way**: [(ngModel)] or valueChange pattern
4. **ViewChild**: Access child from parent

---

## References

- [Angular Component Interaction](https://angular.io/guide/component-interaction)