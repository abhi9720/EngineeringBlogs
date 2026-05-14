---
title: CSS Reflow and Repaint
description: >-
  Understand browser rendering performance - what causes reflows and repaints,
  and how to optimize.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - css
  - performance
  - reflow
  - repaint
  - frontend
coverImage: /images/frontend/css/reflow-repaint.png
draft: false
order: 20
---
# CSS Reflow and Repaint: The Complete Guide

## Overview

Every time you change an element's style, the browser recalculates layout and repaints the page. Understanding reflows and repaints helps you write performant CSS that keeps animations smooth and pages responsive.

---

## Browser Rendering Pipeline

```
Style Calculation → Layout (Reflow) → Paint → Composite
```

### Steps

1. **Style Calculation**: Determine CSS rules for each element
2. **Layout (Reflow)**: Calculate position and size
3. **Paint**: Draw pixels to layers
4. **Composite**: Combine layers for final display

```css
/* Each style change triggers one or more of these steps */
element.style.width = '100px'; /* Layout + Paint + Composite */
element.style.background = 'red'; /* Paint only */
element.style.transform = 'translateX(100px)'; /* Composite only */
```

---

## What Causes Reflow

### Layout-Threatening Properties

```css
/* Changing these triggers reflow */
element {
  width: 100px;
  height: 100px;
  padding: 10px;
  margin: 10px;
  top: 10px;
  left: 10px;
  bottom: 10px;
  right: 10px;
  position: absolute;
  left: 50%;
  border-width: 1px;
  border-style: solid;
  box-sizing: border-box;
  display: block; /* or flex, grid */
  float: left;
  clear: both;
  overflow: hidden;
  font-size: 16px;
  font-weight: bold;
  line-height: 1.5;
  text-align: center;
  white-space: nowrap;
}
```

### Reflow-Triggering JavaScript

```javascript
// Reading layout properties causes reflow
const width = element.offsetWidth;     // Triggers reflow!
const height = element.clientHeight;   // Triggers reflow!
const rect = element.getBoundingClientRect(); // Triggers reflow!

// Batch reads first, then writes
function updateElement() {
  // Read (these don't trigger because they're batched)
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  
  // Write (this triggers ONE reflow)
  element.style.width = (width + 10) + 'px';
  element.style.height = (height + 10) + 'px';
}

// BAD: Multiple reflows
function badUpdate() {
  element.style.width = '100px';  // Reflow 1
  element.style.height = '100px'; // Reflow 2
  element.style.padding = '10px';  // Reflow 3
}

// GOOD: Single reflow
function goodUpdate() {
  element.style.cssText = 'width: 100px; height: 100px; padding: 10px;';
}
```

---

## What Causes Repaint

### Paint-Only Properties

```css
/* Changing these triggers repaint, but NOT reflow */
element {
  background-color: red;
  background-image: url(image.png);
  background-position: center;
  background-repeat: no-repeat;
  color: blue;
  border-color: green;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  opacity: 0.5;
  visibility: visible;
  text-decoration: underline;
}
```

---

## Properties That Avoid Reflow/Repaint

### Compositor-Only Properties

```css
/* These only affect compositing - GPU accelerated */
element {
  transform: translateX(100px);
  transform: translateY(50px);
  transform: rotate(45deg);
  transform: scale(1.5);
  transform: translate3d(0, 0, 0); /* Force GPU */
  
  opacity: 0.5;
  
  filter: blur(2px);
  /* Note: filter can cause repaint on some browsers */
}
```

---

## Real-World Optimization

### Bad vs Good Animations

```css
/* BAD: Triggers reflow every frame */
@keyframes slide {
  from { left: 0; }
  to { left: 100px; }
}

.animating {
  animation: slide 1s linear;
}

/* GOOD: Uses transform, composited */
@keyframes slide-transform {
  from { transform: translateX(0); }
  to { transform: translateX(100px); }
}

.animating {
  animation: slide-transform 1s linear;
}
```

### JavaScript Animation Loop

```javascript
// BAD: Uses reflow-triggering properties
function animateBad() {
  let pos = 0;
  function step() {
    pos += 1;
    element.style.left = pos + 'px'; // Reflow each frame!
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// GOOD: Uses transform
function animateGood() {
  let pos = 0;
  function step() {
    pos += 1;
    element.style.transform = `translateX(${pos}px)`; // Composite only!
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// BEST: Using Web Animations API
element.animate([
  { transform: 'translateX(0)' },
  { transform: 'translateX(100px)' }
], {
  duration: 1000,
  easing: 'linear'
});
```

### Layout Thrashing (Forced Reflow)

```javascript
// BAD: Reading after writing triggers reflow
function thrashing() {
  element.style.width = '100px';
  const width = element.offsetWidth; // Forces reflow!
  element.style.height = width + 'px';
}

// GOOD: Batch reads, then write
function noThrashing() {
  // Read
  const width = element.offsetWidth;
  
  // Write - single reflow
  element.style.width = '100px';
  element.style.height = width + 'px';
}

// Another example
// BAD
for (const div of divs) {
  div.style.height = div.offsetHeight + 10 + 'px'; // Reflow each iteration!
}

// GOOD
const heights = divs.map(div => div.offsetHeight); // Read all first
heights.forEach((height, i) => {
  divs[i].style.height = height + 10 + 'px'; // Write - single reflow
});
```

---

## Caching Layout Values

```javascript
// Cache values instead of reading repeatedly
const element = document.getElementById('my-element');

// Cache once
const styles = window.getComputedStyle(element);
const width = parseInt(styles.width);
const height = parseInt(styles.height);

// Use cached values
element.style.width = (width + 20) + 'px';
element.style.height = (height + 20) + 'px';

// Or use cached for animation loops
function animate() {
  const currentTransform = element.transform || { x: 0 };
  element.style.transform = `translate(${currentTransform.x + 1}px, 0)`;
}
```

---

## Tooling and Debugging

### Chrome DevTools

```javascript
// 1. Open DevTools → Performance tab
// 2. Click "Start profiling"
// 3. Perform actions
// 4. Look for:
//    - "Layout" (reflow) - purple
//    - "Paint" - green
//    - Long bars mean performance issues

// Also use Rendering panel:
// 1. Cmd+Shift+P → "Show Rendering"
// 2. Check "Paint Flashing" - flashes green on repaint
// 3. Check "Layout Shift Regions" - highlights areas that reflow
```

### Reducing Layout in CSS

```css
/* Use transform instead of position/width/height */
.bad { left: 100px; }
.good { transform: translateX(100px); }

/* Use opacity instead of visibility/display */
.bad { display: none; }
.good { opacity: 0; }

/* Use will-change for upcoming animations */
.animated {
  will-change: transform;
  /* Browser creates compositing layer */
}

/* Avoid animating properties that trigger layout */
.avoid-animating {
  animation: none;
  /* These cause reflow/repaint: */
  /* width, height, padding, margin, top, left, font-size */
}
```

---

## Summary

1. **Reflow**: Recalculates element position/size (expensive)
2. **Repaint**: Redraws pixels (less expensive than reflow)
3. **Composite**: Just combines layers (cheap)
4. **Avoid**: width, height, top, left, margin, padding in animations
5. **Use**: transform, opacity for animations
6. **Batch**: Read layout values together, then write
7. **Cache**: Store layout values instead of reading repeatedly
8. **will-change**: Hint browser to optimize upcoming changes

---

## References

- [Google - Rendering Performance](https://developers.google.com/web/fundamentals/performance/rendering)
- [MDN - Reflow](https://developer.mozilla.org/en-US/docs/Glossary/Reflow)
- [CSS-Tricks - Rendering Performance](https://css-tricks.com/tips-for-approaching-css-performance/)
