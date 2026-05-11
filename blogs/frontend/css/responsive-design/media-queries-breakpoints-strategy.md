---
title: "Media Queries & Breakpoints Strategy"
description: "Learn responsive design strategies - breakpoints, media query syntax, and common patterns."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - css
  - responsive
  - media queries
  - frontend
coverImage: "/images/frontend/css/media-queries.png"
draft: false
---

# Media Queries & Breakpoints Strategy: The Complete Guide

## Overview

Media queries allow you to apply CSS based on device characteristics like viewport width, height, orientation, and more. A well-planned breakpoint strategy is essential for creating responsive layouts that work across all devices.

---

## Media Query Syntax

### Basic Syntax

```css
/* All media types */
@media (condition) {
  /* CSS rules */
}

/* Specific media type */
@media screen {
  .container { max-width: 1200px; }
}

@media print {
  .no-print { display: none; }
}

@media speech {
  /* For screen readers */
}

/* Multiple conditions - AND */
@media (min-width: 768px) and (max-width: 1024px) {
  .sidebar { display: none; }
}

/* Multiple queries - comma (OR) */
@media (min-width: 768px), (orientation: portrait) {
  .header { font-size: 18px; }
}

/* NOT - negation */
@media not (min-width: 768px) {
  /* Applied when width < 768px */
}

/* ONLY - prevents older browsers */
@media only screen {
  /* Modern browsers only */
}
```

### Common Features

```css
/* Width */
@media (min-width: 768px) { }
@media (max-width: 1024px) { }

/* Height */
@media (min-height: 600px) { }
@media (max-height: 800px) { }

/* Aspect ratio */
@media (aspect-ratio: 16/9) { }
@media (min-aspect-ratio: 16/9) { }

/* Orientation */
@media (orientation: portrait) { }
@media (orientation: landscape) { }

/* Pixel density */
@media (resolution: 2dppx) { }
@media (min-resolution: 2dppx) { /* Retina */ }

/* Color */
@media (color) { }
@media (color-index: 256) { }
@media (min-color: 8) { /* 8-bit color */ }

/* Pointer */
@media (pointer: coarse) { /* Touch */ }
@media (pointer: fine) { /* Mouse */ }
@media (pointer: none) { /* Keyboard/navigation */ }

/* Hover */
@media (hover: hover) { /* Can hover */ }
@media (hover: none) { /* No hover (touch) */ }

/* Grid (character-based devices) */
@media (grid) { /* Terminals */ }
```

---

## Breakpoint Strategy

### Common Breakpoints

```css
/* Mobile-first approach - start small, add for larger */

/* Extra small (default) - phones */
.container { width: 100%; }

/* Small - tablets */
@media (min-width: 576px) {
  .container { max-width: 540px; }
}

/* Medium - small laptops */
@media (min-width: 768px) {
  .container { max-width: 720px; }
}

/* Large - desktops */
@media (min-width: 992px) {
  .container { max-width: 960px; }
}

/* Extra large - large screens */
@media (min-width: 1200px) {
  .container { max-width: 1140px; }
}

/* Ultra large */
@media (min-width: 1400px) {
  .container { max-width: 1320px; }
}
```

### Alternative: Target Common Devices

```css
/* Target specific devices */
/* Not recommended - device fragmentation makes this unreliable */

/* iPad portrait */
@media (min-width: 768px) and (max-width: 1024px) and (orientation: portrait) { }

/* iPad landscape */
@media (min-width: 768px) and (max-width: 1024px) and (orientation: landscape) { }

/* iPhone X and similar */
@media only screen and (width: 375px) and (height: 812px) { }
```

---

## Mobile-First vs Desktop-First

### Mobile-First (Recommended)

```css
/* Default styles = mobile */
.container {
  padding: 10px;
  font-size: 14px;
  flex-direction: column;
}

.sidebar {
  display: none; /* Hidden on mobile */
}

/* Override for larger screens */
@media (min-width: 768px) {
  .container {
    padding: 20px;
    font-size: 16px;
  }
}

@media (min-width: 992px) {
  .container {
    flex-direction: row;
  }
  .sidebar {
    display: block;
    width: 250px;
  }
}

@media (min-width: 1200px) {
  .sidebar {
    width: 300px;
  }
}
```

### Desktop-First (Less Common)

```css
/* Default styles = desktop */
.container {
  display: flex;
  padding: 20px;
  font-size: 16px;
}

/* Override for smaller screens */
@media (max-width: 991px) {
  .container {
    flex-direction: column;
  }
  .sidebar {
    order: 2;
  }
}

@media (max-width: 767px) {
  .container {
    padding: 10px;
    font-size: 14px;
  }
}
```

---

## Real-World Patterns

### Navigation

```css
/* Mobile navigation */
.nav-menu {
  display: none;
}

.nav-toggle {
  display: block;
}

@media (min-width: 768px) {
  .nav-toggle {
    display: none;
  }
  
  .nav-menu {
    display: flex;
    gap: 20px;
  }
}
```

### Grid Responsiveness

```css
.card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

@media (min-width: 576px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 992px) {
  .card-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 1200px) {
  .card-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
```

### Typography Scale

```css
/* Fluid typography */
html {
  font-size: 16px;
}

body {
  font-size: clamp(14px, 2vw, 18px);
}

h1 {
  font-size: clamp(24px, 5vw, 48px);
}

h2 {
  font-size: clamp(20px, 4vw, 36px);
}

/* Or using media queries */
body { font-size: 14px; }
@media (min-width: 768px) { body { font-size: 16px; } }
@media (min-width: 1200px) { body { font-size: 18px; } }
```

### Hide/Show Patterns

```css
/* Mobile only */
.mobile-only {
  display: block;
}
@media (min-width: 768px) {
  .mobile-only { display: none; }
}

/* Desktop only */
.desktop-only {
  display: none;
}
@media (min-width: 768px) {
  .desktop-only { display: block; }
}

/* Tablet only */
@media (min-width: 576px) and (max-width: 991px) {
  .tablet-only { display: block; }
}
.tablet-only { display: none; }
```

---

## Container Queries (Modern)

```css
/* Container queries - style based on parent container size */
.card-container {
  container-type: inline-size;
  container-name: card;
}

@container card (min-width: 400px) {
  .card-content {
    display: grid;
    grid-template-columns: 200px 1fr;
  }
}

@container card (max-width: 399px) {
  .card-content {
    display: flex;
    flex-direction: column;
  }
}
```

---

## Best Practices

### Use em or rem Instead of px

```css
/* Better for accessibility when user scales text */
@media (min-width: 48em) { /* 48em = 768px with base 16px */ }
```

### Avoid Overly Specific Breakpoints

```css
/* WRONG: Too many breakpoints */
@media (min-width: 320px) { }
@media (min-width: 360px) { }
@media (min-width: 375px) { }
@media (min-width: 414px) { }

/* RIGHT: Logical breakpoints */
@media (min-width: 576px) { }
@media (min-width: 768px) { }
@media (min-width: 992px) { }
```

### Order Matters

```css
/* WRONG: Mobile styles come after desktop */
@media (min-width: 768px) {
  .sidebar { display: block; }
}
.sidebar { display: none; }

/* RIGHT: Mobile first */
.sidebar { display: none; }
@media (min-width: 768px) {
  .sidebar { display: block; }
}
```

### Test Real Devices

```css
/* DevTools device toolbar helps, but real testing is essential */
```

---

## Summary

1. **Use min-width for mobile-first**: Add styles for larger screens
2. **Pick logical breakpoints**: 576px, 768px, 992px, 1200px
3. **Use em/rem**: For better accessibility support
4. **Order matters**: Base styles first, then media queries
5. **Avoid device-specific**: Too many devices to target
6. **Consider aspect-ratio**: For orientation handling
7. **Container queries**: Emerging pattern for component-based responsive

Mobile-first is the recommended approach - design for smallest screens first, then enhance for larger screens.

---

## References

- [MDN - Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_Queries)
- [CSS-Tricks - Media Queries](https://css-tricks.com/snippets/css/media-queries-for-standard-devices/)
- [Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries)