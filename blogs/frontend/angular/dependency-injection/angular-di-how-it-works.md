---
title: "Angular DI How It Works"
description: "Understanding Angular's dependency injection system - providers, injectors, and tokens."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - angular
  - dependency injection
  - di
  - frontend
coverImage: "/images/frontend/angular/di-explained.png"
draft: false
---

# Angular DI How It Works: The Complete Guide

## Overview

Angular's Dependency Injection (DI) system provides dependencies to components and services. Understanding how it works helps you write maintainable Angular applications.

---

## Basic DI

```typescript
// Service
@Injectable({ providedIn: 'root' }) // Available app-wide
export class DataService {
  getData() { return fetch('/api/data'); }
}

// Component with injection
@Component({
  selector: 'app-root',
  template: '<div>{{ data }}</div>'
})
export class AppComponent {
  // Angular injects the service
  constructor(private dataService: DataService) {}
  
  ngOnInit() {
    this.dataService.getData()
      .then(data => this.data = data);
  }
}
```

---

## Provider Types

```typescript
// 1. Provided in 'root' - Singleton app-wide
@Injectable({ providedIn: 'root' })
class ServiceA {}

// 2. Provided in component - New instance per component
@Component({
  providers: [ServiceB]
})
class MyComponent {}

// 3. Provided in module - Singleton for module
@NgModule({
  providers: [ServiceC]
})
class MyModule {}

// 4. useClass - Different implementation
@NgModule({
  providers: [
    { provide: Logger, useClass: ConsoleLogger }
  ]
})
class AppModule {}

// 5. useValue - Static value
@NgModule({
  providers: [
    { provide: API_URL, useValue: 'https://api.example.com' }
  ]
})
class AppModule {}

// 6. useFactory - Dynamic creation
@NgModule({
  providers: [
    {
      provide: AuthService,
      useFactory: (http) => new AuthService(http),
      deps: [HttpClient]
    }
  ]
})
class AppModule {}
```

---

## Injector Hierarchy

```typescript
// Angular creates injector hierarchy:
// - Root Injector (app-wide)
// - Module Injector (module-level)  
// - Component Injector (component-level)

/*
AppComponent
  └── ChildComponent
        └── GrandchildComponent

If Service not in component, Angular checks parent injector
*/
```

---

## Summary

1. **DI**: System for providing dependencies
2. **Providers**: Configure how to create services
3. **Injectors**: Hierarchy that resolves dependencies
4. **providedIn: 'root'**: Easiest for app-wide singleton

---

## References

- [Angular DI Guide](https://angular.io/guide/dependency-injection)