---
title: "Flexbox Real-World Layouts"
description: "Master Flexbox with practical examples - navigation, card grids, form layouts, and common patterns."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - css
  - flexbox
  - layouts
  - frontend
coverImage: "/images/frontend/css/flexbox-layouts.png"
draft: false
---

# Flexbox Real-World Layouts: The Complete Guide

## Overview

Flexbox (Flexible Box Layout) is designed for one-dimensional layouts - either a row OR a column. It's perfect for navigation bars, card layouts, form controls, and centering. This guide covers real-world patterns you'll use daily.

---

## Core Flexbox Properties

### Container Properties

```css
/* Create flex container */
.flex-container {
  display: flex;
}

/* Main axis direction */
flex-direction: row;           /* Default: left to right */
flex-direction: row-reverse;  /* Right to left */
flex-direction: column;        /* Top to bottom */
flex-direction: column-reverse; /* Bottom to top */

/* Wrapping */
flex-wrap: nowrap;    /* Default: all in one line */
flex-wrap: wrap;      /* Wrap to multiple lines */
flex-wrap: wrap-reverse; /* Wrap, but reverse */

/* Short-hand: direction + wrap */
flex-flow: row wrap;

/* Alignment on main axis */
justify-content: flex-start;   /* Default */
justify-content: flex-end;
justify-content: center;
justify-content: space-between; /* Equal spacing */
justify-content: space-around; /* Space around each */
justify-content: space-evenly; /* Equal space everywhere */

/* Alignment on cross axis */
align-items: stretch;      /* Default: fill container */
align-items: flex-start;
align-items: flex-end;
align-items: center;
align-items: baseline;     /* Align by text baseline */

/* Multiple lines alignment */
align-content: flex-start;
align-content: flex-end;
align-content: center;
align-content: space-between;
align-content: space-around;
align-content: stretch;
```

### Item Properties

```css
/* Individual item alignment */
align-self: auto;     /* Default: inherit from align-items */
align-self: flex-start;
align-self: flex-end;
align-self: center;
align-self: baseline;
align-self: stretch;

/* Order - change visual order */
order: 0;  /* Default */
order: 1;  /* Move to end */
order: -1; /* Move to start */

/* Grow - how much to grow relative to others */
flex-grow: 0;  /* Default: don't grow */
flex-grow: 1; /* Grow to fill space */

/* Shrink - how much to shrink */
flex-shrink: 1; /* Default: can shrink */
flex-shrink: 0; /* Don't shrink below min-width */

/* Basis - initial size */
flex-basis: auto;  /* Default: use width/height */
flex-basis: 200px;
flex-basis: 50%;
flex-basis: 0;     /* Use for equal distribution */

/* Short-hand */
flex: 0 1 auto;    /* grow shrink basis */
flex: 1;           /* flex: 1 1 0% - grow to fill */
flex: auto;        /* flex: 1 1 auto */
flex: none;        /* flex: 0 0 auto - no growth/shrink */
flex: initial;     /* flex: 0 1 auto */
```

---

## Real-World Patterns

### Navigation Bar

```css
/* Horizontal navigation with logo */
.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  background: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.nav-links {
  display: flex;
  gap: 20px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-links a {
  text-decoration: none;
  color: #333;
  padding: 10px 0;
  display: block;
}

.nav-links a:hover {
  color: blue;
}

/* Mobile: Stack vertically */
@media (max-width: 768px) {
  .navbar {
    flex-direction: column;
    align-items: stretch;
  }
  .nav-links {
    flex-direction: column;
    gap: 0;
  }
  .nav-links a {
    padding: 15px;
    border-bottom: 1px solid #eee;
  }
}
```

```html
<nav class="navbar">
  <div class="logo">
    <img src="logo.svg" alt="Logo">
  </div>
  <ul class="nav-links">
    <li><a href="/">Home</a></li>
    <li><a href="/about">About</a></li>
    <li><a href="/services">Services</a></li>
    <li><a href="/contact">Contact</a></li>
  </ul>
</nav>
```

### Card Grid

```css
/* Responsive card grid */
.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.card {
  /* Each card takes equal width, wrap to next line */
  flex: 1 1 300px;  /* grow shrink basis */
  max-width: 400px; /* Don't get too big */
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* Alternative: Fixed number per row */
.card-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.card {
  flex-basis: calc(33.333% - 20px); /* 3 per row */
}

/* 2 per row on tablet */
@media (max-width: 900px) {
  .card { flex-basis: calc(50% - 20px); }
}

/* 1 per row on mobile */
@media (max-width: 600px) {
  .card { flex-basis: 100%; }
}
```

```html
<div class="card-grid">
  <article class="card">
    <h3>Card 1</h3>
    <p>Content here</p>
  </article>
  <article class="card">
    <h3>Card 2</h3>
    <p>Content here</p>
  </article>
  <article class="card">
    <h3>Card 3</h3>
    <p>Content here</p>
  </article>
</div>
```

### Form Layout

```css
/* Inline form */
.form-row {
  display: flex;
  gap: 15px;
  align-items: center;
  margin-bottom: 15px;
}

.form-row label {
  flex: 0 0 120px; /* Fixed width */
}

.form-row input,
.form-row select,
.form-row textarea {
  flex: 1; /* Grow to fill */
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

/* Stacked on mobile */
@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
    align-items: stretch;
  }
  .form-row label {
    flex: 0 0 auto;
    margin-bottom: 5px;
  }
}

/* Button row */
.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}
```

```html
<form class="form">
  <div class="form-row">
    <label for="name">Name:</label>
    <input type="text" id="name" name="name">
  </div>
  <div class="form-row">
    <label for="email">Email:</label>
    <input type="email" id="email" name="email">
  </div>
  <div class="form-row">
    <label for="message">Message:</label>
    <textarea id="message" name="message" rows="4"></textarea>
  </div>
  <div class="form-actions">
    <button type="button">Cancel</button>
    <button type="submit">Submit</button>
  </div>
</form>
```

### Centering (The Holy Grail)

```css
/* Perfect centering */
.center-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

/* Centering with flexbox is easier than old methods */
```

```html
<div class="center-content">
  <div class="modal">
    <h2>Modal Content</h2>
    <p>Perfectly centered!</p>
  </div>
</div>
```

### Footer Always at Bottom

```css
/* Sticky footer */
html, body {
  height: 100%;
  margin: 0;
}

body {
  display: flex;
  flex-direction: column;
}

main {
  flex: 1; /* Grow to fill available space */
}

footer {
  /* Stays at bottom or flows normally */
  padding: 20px;
  background: #f5f5f5;
}
```

```html
<body>
  <header>Header</header>
  <main>Content (grows to fill)</main>
  <footer>Footer</footer>
</body>
```

### Equal Height Columns

```css
/* Equal height columns */
.row {
  display: flex;
  gap: 20px;
}

.col {
  flex: 1;
  padding: 20px;
  background: white;
  /* All columns have same height now! */
}
```

---

## Common Flexbox Issues

### Issue 1: Item Won't Shrink Below Content

```css
/* Default: flex-shrink: 1, items can shrink */
.item {
  /* If you don't want it to shrink: */
  flex-shrink: 0;
  min-width: 0; /* Also reset min-width/height */
}
```

### Issue 2: Items Not Wrapping

```css
/* Default is nowrap */
.container {
  flex-wrap: wrap; /* Add this to wrap */
}
```

### Issue 3: Gap Not Working

```css
/* gap is newer - older browsers need fallback */
.container {
  gap: 20px; /* Modern */
  
  /* Fallback: */
  margin-left: -20px;
  margin-top: -20px;
}
.container > * {
  margin-left: 20px;
  margin-top: 20px;
}
```

### Issue 4: Want 3 Items Per Row

```css
/* Use flex-basis or calc */
.item {
  flex: 0 0 33.333%;
  /* or */
  flex: 1 1 30%;
  max-width: 33.333%;
}
```

---

## Flexbox vs Grid

```css
/* Use Flexbox for: */
/* - One dimensional (row OR column) */
/* - Navigation */
/* - Button groups */
/* - Card grids where items may wrap */

/* Use Grid for: */
/* - Two dimensional (rows AND columns) */
/* - Page layouts */
/* - Complex card layouts with alignment */

/* Example: Flexbox for buttons, Grid for layout */
.toolbar {
  display: flex;
  gap: 10px;
}

.page {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 20px;
}
```

---

## Browser Support

```css
/* All modern browsers support flexbox */
/* IE11 partial support - need prefixes */

.flex-container {
  display: -webkit-flex;
  display: -ms-flexbox;
  display: flex;
}

/* IE11 issues:
   - min-height on flex items
   - flex-basis: content
   - flex-wrap: wrap
*/
```

---

## Summary

1. **display: flex** - Creates flex container
2. **justify-content** - Main axis alignment
3. **align-items** - Cross axis alignment
4. **flex-wrap** - Enable wrapping
5. **flex: 1** - Grow to fill space
6. **gap** - Spacing between items (modern)
7. **Perfect for**: Navigation, forms, centering, card layouts

Flexbox is your go-to for one-dimensional layouts. Use it for horizontal menus, button groups, and when you need items to flow in a single direction.

---

## References

- [MDN - Flexbox](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Flexible_Box_Layout)
- [CSS-Tricks - Flexbox](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)
- [Flexbox Froggy](https://flexboxfroggy.com/)