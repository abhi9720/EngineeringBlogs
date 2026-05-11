---
title: "CSS Grid Architecture"
description: "Master CSS Grid for complex two-dimensional layouts - page layouts, card systems, and responsive grids."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - css
  - grid
  - layouts
  - frontend
coverImage: "/images/frontend/css/css-grid.png"
draft: false
---

# CSS Grid Architecture: The Complete Guide

## Overview

CSS Grid is designed for two-dimensional layouts - rows AND columns simultaneously. It's perfect for page layouts, complex card systems, and any layout where you need precise control over both dimensions.

---

## Grid Fundamentals

### Creating a Grid

```css
/* Basic grid container */
.grid-container {
  display: grid;
}

/* Define columns */
.grid-container {
  display: grid;
  grid-template-columns: 100px 100px 100px; /* 3 equal columns */
}

/* Define rows */
.grid-container {
  display: grid;
  grid-template-rows: 100px 200px 100px;
}

/* Both together */
.grid-container {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  grid-template-rows: auto 1fr auto;
}
```

### Grid Units

```css
/* px - fixed */
grid-template-columns: 200px 200px 200px;

/* % - responsive */
grid-template-columns: 25% 50% 25%;

/* fr - flexible (fraction of available space) */
grid-template-columns: 1fr 2fr 1fr; /* 1:2:1 ratio */
grid-template-columns: repeat(3, 1fr); /* 3 equal columns */
grid-template-columns: 1fr 1fr 1fr 1fr; /* 4 equal columns */

/* auto - content-based */
grid-template-columns: auto 1fr auto;

/* minmax - flexible with minimum */
grid-template-columns: minmax(200px, 1fr) 1fr;

/* fit-content - max but flexible */
grid-template-columns: fit-content(300px) 1fr;

/* Repeat function */
grid-template-columns: repeat(3, 1fr); /* 3 equal */
grid-template-columns: repeat(2, 100px 200px); /* 4 columns: 100 200 100 200 */
grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); /* Responsive columns */
grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); /* Responsive with collapse */
```

---

## Grid Lines and Tracks

### Line-Based Placement

```css
/* Place items by line numbers */
.item-1 {
  grid-column: 1 / 3; /* Start at line 1, end at line 3 */
  grid-row: 1 / 2;
}

/* Shorthand */
.item-1 {
  grid-area: 1 / 1 / 2 / 4; /* row-start / col-start / row-end / col-end */
}

/* Span across tracks */
.item-2 {
  grid-column: span 2; /* Span 2 columns */
  grid-row: span 3;     /* Span 3 rows */
}

/* Negative numbers - count from end */
.item-3 {
  grid-column: -1 / -2; /* From last line to second-to-last */
}
```

### Named Lines

```css
/* Named lines */
.grid {
  display: grid;
  grid-template-columns: [start] 200px [middle] 1fr [end];
  grid-template-rows: [header-start] auto [content-start] 1fr [footer-start] auto [end];
}

.item {
  grid-column: start / middle;
  grid-row: header-start / content-start;
}

/* Named areas */
.grid {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  grid-template-columns: 200px 1fr;
  grid-template-rows: auto 1fr auto;
}

.header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main    { grid-area: main; }
.footer  { grid-area: footer; }
```

---

## Real-World Layouts

### Page Layout

```css
/* Full page layout */
.page-layout {
  display: grid;
  grid-template-areas:
    "header header header"
    "nav    main   aside"
    "footer footer footer";
  grid-template-columns: 200px 1fr 250px;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  gap: 20px;
}

.header { grid-area: header; }
.nav    { grid-area: nav; }
.main   { grid-area: main; }
.aside  { grid-area: aside; }
.footer { grid-area: footer; }

/* Responsive: Single column on mobile */
@media (max-width: 768px) {
  .page-layout {
    grid-template-areas:
      "header"
      "nav"
      "main"
      "aside"
      "footer";
    grid-template-columns: 1fr;
  }
}
```

### Dashboard Layout

```css
.dashboard {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: auto auto 1fr;
  gap: 20px;
  padding: 20px;
}

.stat-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
}

/* Stats span 1 column each */
.stat-card:nth-child(1) { grid-column: 1; }
.stat-card:nth-child(2) { grid-column: 2; }
.stat-card:nth-child(3) { grid-column: 3; }
.stat-card:nth-child(4) { grid-column: 4; }

/* Chart spans full width */
.chart {
  grid-column: 1 / -1;
  grid-row: 2;
}

/* Table spans full width */
.table-section {
  grid-column: 1 / -1;
  grid-row: 3;
}

/* Mobile */
@media (max-width: 1024px) {
  .dashboard { grid-template-columns: repeat(2, 1fr); }
  .stat-card:nth-child(1),
  .stat-card:nth-child(2) { grid-column: auto; }
}
@media (max-width: 600px) {
  .dashboard { grid-template-columns: 1fr; }
}
```

### Responsive Card Grid

```css
.card-grid {
  display: grid;
  /* Auto-responsive columns: min 280px, max 1fr */
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  /* No need to specify grid position */
}

/* No media queries needed - grid adjusts automatically! */
```

### Holy Grail Layout

```css
.holy-grail {
  display: grid;
  grid-template-areas:
    "header header header"
    "nav    main   aside"
    "footer footer footer";
  grid-template-columns: minmax(150px, 25%) 1fr minmax(150px, 25%);
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
}
```

---

## Alignment

### Container Alignment

```css
/* Align all items in grid */
.grid {
  /* Horizontal alignment (columns) */
  justify-items: start | end | center | stretch;
  
  /* Vertical alignment (rows) */
  align-items: start | end | center | stretch;
  
  /* Shorthand: */
  place-items: center center; /* align-items justify-items */
}

/* Space between grid cells */
.grid {
  justify-content: start | end | center | stretch | space-around | space-between | space-evenly;
  align-content: start | end | center | stretch | space-around | space-between | space-evenly;
}
```

### Item Alignment

```css
/* Individual item alignment */
.item {
  justify-self: start | end | center | stretch;
  align-self: start | end | center | stretch;
  
  /* Shorthand */
  place-self: center center;
}
```

---

## Subgrid (Modern)

```css
/* Parent grid */
.grid-container {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

/* Child adopts parent's columns */
.card {
  display: grid;
  grid-template-columns: subgrid; /* Inherits 3 columns from parent */
  /* Now can align directly with siblings */
}
```

---

## Grid vs Flexbox

```css
/* Grid for:
   - Two-dimensional layouts
   - Page structures
   - Complex card systems
   - When you need precise control over rows AND columns
   
   Flexbox for:
   - One-dimensional (row OR column)
   - Navigation
   - Button groups
   - Centering
*/

/* Example combining both */
.page {
  display: grid;
  grid-template-columns: 200px 1fr;
}

.page > nav {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
```

---

## Browser Support

```css
/* Modern browsers - full support */
/* IE11 - no support */

/* For older browsers, use fallbacks */
.grid {
  display: -ms-grid; /* No IE support, but shows no grid */
  display: grid;
}
```

---

## Summary

1. **display: grid** - Creates grid container
2. **grid-template-columns/rows** - Define track sizes
3. **fr unit** - Flexible fraction of available space
4. **grid-area** - Place items by line or name
5. **grid-template-areas** - Visual layout syntax
6. **gap** - Spacing between cells
7. **auto-fill/fit** - Responsive without media queries

CSS Grid excels at two-dimensional layouts where you need control over both rows and columns simultaneously.

---

## References

- [MDN - CSS Grid](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout)
- [CSS-Tricks - Complete Grid Guide](https://css-tricks.com/snippets/css/complete-guide-grid/)
- [Grid Garden](https://cssgridgarden.com/)