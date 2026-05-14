---
title: Event Delegation Pattern
description: >-
  Master event delegation - handle many events with one listener, improve
  performance, and understand the pattern.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - javascript
  - events
  - delegation
  - performance
  - frontend
coverImage: /images/frontend/javascript/event-delegation.png
draft: false
order: 20
---
# Event Delegation Pattern: The Complete Guide

## Overview

Event delegation is a technique where you attach a single event listener to a parent element instead of attaching to each child. This improves performance and simplifies code, especially for dynamic content.

---

## How It Works

### Concept

```javascript
// Instead of attaching to each item:
document.querySelectorAll('.item').forEach(item => {
  item.addEventListener('click', handleClick);
});

// Attach to parent once:
document.querySelector('.list').addEventListener('click', (e) => {
  // e.target is the actual clicked element
  // Check if it's an item
  if (e.target.classList.contains('item')) {
    handleClick(e);
  }
});
```

### The Event Flow

```javascript
// When clicking on nested element:
/*
Event bubbles up from:
  <span class="icon">X</span> 
  → <button class="item"> 
  → <li class="item"> 
  → <ul>
*/

list.addEventListener('click', (e) => {
  console.log(e.target);      // The actual element clicked
  console.log(e.currentTarget); // The element with listener (list)
  console.log(e.target.closest('.item')); // Find closest match
});
```

---

## Implementation

### Basic Delegation

```html
<ul id="menu">
  <li><a href="/home">Home</a></li>
  <li><a href="/about">About</a></li>
  <li><a href="/contact">Contact</a></li>
</ul>
```

```javascript
document.getElementById('menu').addEventListener('click', (e) => {
  // Find if anchor was clicked
  const link = e.target.closest('a');
  
  if (link) {
    e.preventDefault();
    const href = link.getAttribute('href');
    console.log('Navigate to:', href);
    // Handle navigation
  }
});
```

### With Data Attributes

```html
<div class="grid" id="products">
  <button data-id="1" data-action="add">Add</button>
  <button data-id="2" data-action="remove">Remove</button>
  <button data-id="3" data-action="edit">Edit</button>
</div>
```

```javascript
document.getElementById('products').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-id]');
  
  if (button) {
    const { id, action } = button.dataset;
    console.log(`Action: ${action}, ID: ${id}`);
    
    switch (action) {
      case 'add': addItem(id); break;
      case 'remove': removeItem(id); break;
      case 'edit': editItem(id); break;
    }
  }
});
```

---

## Dynamic Content

### Delegation Works with Dynamic Elements

```javascript
// Adding new items doesn't need new listeners!
const list = document.getElementById('list');

list.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) {
    handleItemClick(item);
  }
});

// This new item works automatically
const newItem = document.createElement('div');
newItem.className = 'item';
newItem.textContent = 'New Item';
list.appendChild(newItem);
```

### When to Use Delegation

```javascript
// Good for:
/*
- Lists with many items (100+)
- Dynamically added items
- Table rows
- Tree views
- Menu items
- Grid cells
*/

// Bad for:
/*
- Single elements
- Elements with unique behavior
- Very frequent events (mousemove)
- When you need precise control over individual elements
*/
```

---

## Advanced Patterns

### Multiple Event Types

```javascript
// Delegate multiple events to same handler
parent.addEventListener('click', handleClick);
parent.addEventListener('mouseover', handleHover);

// Distinguish inside handler
function handleClick(e) {
  const target = e.target.closest('.actionable');
  if (!target) return;
  
  console.log('clicked', target);
}

function handleHover(e) {
  const target = e.target.closest('.hoverable');
  if (!target) return;
  
  console.log('hovered', target);
}
```

### Event Types with Data Attributes

```html
<div class="action-panel" id="panel">
  <button data-action="save" data-type="primary">Save</button>
  <button data-action="cancel">Cancel</button>
  <button data-action="delete" data-type="danger">Delete</button>
  <a href="/help" data-action="link">Help</a>
</div>
```

```javascript
document.getElementById('panel').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  
  const { action, type } = el.dataset;
  
  switch (action) {
    case 'save':
      if (type === 'primary') savePrimary();
      else save();
      break;
    case 'cancel': cancel(); break;
    case 'delete': if (type === 'danger') confirmDelete(); break;
    case 'link': break; // Let default happen
  }
});
```

---

## Stopping Delegation

```javascript
// Stop propagation when needed
list.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) {
    handleItem(item);
    // Don't let parent handle this
    e.stopPropagation();
  }
});

// Use event.stopImmediatePropagation()
// to stop other listeners on same element
```

---

## Performance Comparison

```javascript
// Individual listeners: O(n) memory, O(n) setup
const items = document.querySelectorAll('.item');
items.forEach(item => {
  item.addEventListener('click', handler); // 1000 listeners for 1000 items
});

// Delegation: O(1) memory, O(1) setup
document.querySelector('.list').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) handler(e);
}); // 1 listener for 1000 items
```

---

## Common Mistakes

### Mistake 1: Not Filtering Target

```javascript
// BAD: Handler runs for every click
list.addEventListener('click', (e) => {
  console.log('Clicked!'); // Runs even on padding, text, etc.
});

// GOOD: Check actual target
list.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) {
    console.log('Item clicked!');
  }
});
```

### Mistake 2: Using e.target Instead of e.currentTarget

```javascript
// confusion about what "this" is
list.addEventListener('click', function(e) {
  console.log(e.currentTarget === this); // true - the list
  console.log(e.target); // the clicked element (could be child)
});
```

### Mistake 3: Not Using closest

```javascript
// WRONG: Direct check fails for nested elements
if (e.target.classList.contains('item'))

// CORRECT: Use closest to find any ancestor
if (e.target.closest('.item'))
```

---

## Summary

1. **Delegate to parent**: One listener instead of many
2. **Use e.target**: The actual clicked element
3. **Use closest()**: Find matching ancestor
4. **Works with dynamic content**: New elements work automatically
5. **Clean up**: Use stopPropagation when needed
6. **Use data attributes**: Store action info in HTML

Event delegation is essential for dynamic lists and tables. Attach once, works forever.

---

## References

- [MDN - Event delegation](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#event_delegation)
- [JavaScript.info - Event delegation](https://javascript.info/event-delegation)
- [Google Web Fundamentals - Event delegation](https://developers.google.com/web/fundamentals/performance/rendering)
