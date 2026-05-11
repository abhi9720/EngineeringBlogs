---
title: "Positioning: Sticky, Absolute, Fixed"
description: "Master CSS positioning - understand when to use static, relative, absolute, fixed, and sticky for different layouts."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - css
  - positioning
  - layout
  - frontend
coverImage: "/images/frontend/css/positioning.png"
draft: false
---

# Positioning: Sticky, Absolute, Fixed - The Complete Guide

## Overview

CSS positioning is essential for creating overlays, sticky headers, floating elements, and complex layouts. Each position value behaves differently, and understanding the differences is crucial for modern web development.

---

## Position Values

### Static (Default)

```css
/* Default - elements flow normally */
.static {
  position: static;
  /* top, right, bottom, left have NO effect */
}
```

### Relative

```css
/* Relative - positioned relative to its normal position */
.relative {
  position: relative;
  top: 20px;    /* 20px down from normal position */
  left: 10px;   /* 10px right from normal position */
  /* Negative values work too */
  bottom: -10px; /* 10px up */
}

/* Original space is preserved */
```

### Absolute

```css
/* Absolute - positioned relative to nearest positioned ancestor */
.absolute {
  position: absolute;
  top: 0;
  right: 0;
  /* Relative to nearest parent with position: relative/absolute/fixed */
}

/* If no positioned ancestor, relative to viewport */

/* Important: doesn't affect other elements - it's taken out of flow */
```

### Fixed

```css
/* Fixed - positioned relative to viewport */
.fixed {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  /* Always stays in same position when scrolling */
}

/* Also taken out of flow */
```

### Sticky

```css
/* Sticky - hybrid of relative and fixed */
.sticky {
  position: sticky;
  top: 20px;
  /* Acts relative until hits threshold, then becomes fixed */
  /* Stays in container - doesn't escape parent */
}

/* Use case: table headers, navigation that sticks */
```

---

## Real-World Patterns

### Sticky Header

```css
.navbar {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: white;
  /* Won't scroll away until parent scrolls out */
}

/* Works within its container */
.sidebar {
  position: sticky;
  top: 20px;
  /* Sticks when sidebar is in view */
}
```

### Modal Overlay

```css
/* Full screen overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.modal-content {
  background: white;
  padding: 30px;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
}
```

### Tooltip

```css
.tooltip-container {
  position: relative;
  display: inline-block;
}

.tooltip-text {
  position: absolute;
  bottom: 100%;        /* Above the element */
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  white-space: nowrap;
  margin-bottom: 5px;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.tooltip-container:hover .tooltip-text {
  opacity: 1;
}
```

### Floating Action Button

```css
.fab {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #6200ea;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
  z-index: 100;
}
```

### Card with Overlap Image

```css
.card {
  position: relative;
  padding-top: 40px;
}

.badge {
  position: absolute;
  top: -10px;
  left: 20px;
  background: #ff5722;
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
}
```

### Centered Element

```css
.centered {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

/* Modern alternative with flexbox */
.parent {
  display: flex;
  justify-content: center;
  align-items: center;
}
```

### Sidebar with Content

```css
.layout {
  position: relative;
}

.sidebar {
  position: absolute;
  left: 0;
  top: 0;
  width: 250px;
}

.content {
  margin-left: 250px;
}

/* Modern alternative - use Grid or Flexbox instead */
```

---

## Z-Index

### How Z-Index Works

```css
/* Higher z-index appears on top */
.layer-1 { z-index: 1; }
.layer-2 { z-index: 2; }

/* Negative z-index - behind parent */
.behind {
  position: absolute;
  z-index: -1;
}

/* Stacking context - creates new layer */
.context {
  position: relative;
  z-index: 1; /* New stacking context */
}
```

### Stacking Context

```css
/* These create new stacking contexts: */
/* - position: relative/absolute/fixed with z-index */
/* - position: fixed */
/* - opacity < 1 */
/* - transform */
/* - -webkit-overflow-scrolling: touch */

.parent {
  position: relative;
  z-index: 1;
}

.child {
  position: absolute;
  z-index: 999; /* Can't go above parent's siblings! */
}

/* Solution: Parent must have higher z-index or none */
```

---

## Common Mistakes

### Mistake 1: Forgetting Position on Parent

```css
/* WRONG: Tooltip won't position relative to button */
.tooltip {
  position: absolute;
  top: 100%;
}

/* CORRECT: Parent needs position */
.button-wrapper {
  position: relative;
}
.tooltip {
  position: absolute;
  top: 100%;
}
```

### Mistake 2: Using Fixed for Everything

```css
/* WRONG: Fixed causes performance issues on mobile */
/* Fixed elements can cause scroll jank */

.sidebar {
  position: fixed;
  top: 0;
  left: 0;
}

/* BETTER: Use sticky for most cases */
.sidebar {
  position: sticky;
  top: 20px;
}

/* Only use fixed when truly needed (modals, CTAs) */
```

### Mistake 3: Z-Index Wars

```css
/* WRONG: Ever-increasing z-index values */
.modal-1 { z-index: 1000; }
.modal-2 { z-index: 2000; }
.modal-3 { z-index: 3000; }

/* BETTER: Use consistent scale */
.modal-base { z-index: 1000; }
.modal-overlay { z-index: 1001; }
.dropdown { z-index: 100; }
.tooltip { z-index: 200; }
```

### Mistake 4: Breaking Document Flow

```css
/* WRONG: Using absolute for layout that should use flex/grid */
.sidebar {
  position: absolute;
  left: 0;
  width: 250px;
}
.content {
  margin-left: 250px;
}

/* BETTER: Use CSS Grid or Flexbox */
.container {
  display: grid;
  grid-template-columns: 250px 1fr;
}
```

---

## Summary

1. **static** - Default, normal flow
2. **relative** - Offset from normal position, keeps original space
3. **absolute** - Relative to positioned ancestor, removed from flow
4. **fixed** - Relative to viewport, stays on scroll
5. **sticky** - Relative until threshold, then fixed (stays in container)
6. **z-index** - Stacking order, creates stacking context
7. **transform** - Can affect positioning calculations

Use sticky for most "sticky" behavior, fixed for modals/overlays, absolute for tooltips/popovers. Avoid using positioning for main layouts.

---

## References

- [MDN - position](https://developer.mozilla.org/en-US/docs/Web/CSS/position)
- [CSS-Tricks - Absolute Positioning](https://css-tricks.com/almanac/properties/p/position/)
- [Stacking Context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Positioning/Understanding_z_index/The_stacking_context)