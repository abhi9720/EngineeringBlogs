---
title: Lifecycle Hooks Deep Dive
description: >-
  Understanding Angular component lifecycle hooks - when each is called and what
  to do in each.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - angular
  - lifecycle
  - components
  - frontend
coverImage: /images/frontend/angular/lifecycle-hooks.png
draft: false
order: 20
---
# Lifecycle Hooks Deep Dive: The Complete Guide

## Overview

Angular components have a lifecycle managed by Angular. Understanding when each hook runs helps you manage initialization, updates, and cleanup.

---

## Lifecycle Order

```
OnChanges → OnInit → DoCheck 
  → AfterContentInit → AfterContentChecked
  → AfterViewInit → AfterViewChecked
  → OnDestroy
```

---

## Each Hook

### ngOnChanges

```typescript
// Called when @Input properties change
@Component({ selector: 'app-child', template: '{{ value }}' })
class ChildComponent implements OnChanges {
  @Input() value: string;
  
  ngOnChanges(changes: SimpleChanges) {
    console.log('Value changed:', changes.value?.currentValue);
  }
}
```

### ngOnInit

```typescript
// Called once after first ngOnChanges
@Component({ selector: 'app-root' })
class AppComponent implements OnInit {
  ngOnInit() {
    // Initialize data, call services
    this.loadData();
  }
}
```

### ngDoCheck

```typescript
// Called during every change detection run
// Use for custom change detection logic
@Component({ selector: 'app-root' })
class AppComponent implements DoCheck {
  ngDoCheck() {
    // Custom change detection
  }
}
```

### ngAfterViewInit

```typescript
// Called after component's view (and child views) is initialized
@Component({ selector: 'app-root', template: '<div #myDiv></div>' })
class AppComponent implements AfterViewInit {
  @ViewChild('myDiv') myDiv: ElementRef;
  
  ngAfterViewInit() {
    // Access child components and elements
    console.log(this.myDiv.nativeElement);
  }
}
```

### ngOnDestroy

```typescript
// Called before component is destroyed
@Component({ selector: 'app-root' })
class AppComponent implements OnDestroy {
  private subscription = interval(1000).subscribe();
  
  ngOnDestroy() {
    // Clean up - prevent memory leaks!
    this.subscription.unsubscribe();
  }
}
```

---

## Summary

1. **OnChanges**: Input property changes
2. **OnInit**: Initialize component
3. **DoCheck**: Custom change detection
4. **AfterViewInit**: View ready
5. **OnDestroy**: Cleanup before destruction

---

## References

- [Angular Lifecycle Hooks](https://angular.io/guide/lifecycle-hooks)
