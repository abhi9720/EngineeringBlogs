---
title: DOM Manipulation Best Practices
description: >-
  Optimize DOM operations - minimize reflows, use DocumentFragment, batch
  updates, and more.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - javascript
  - dom
  - performance
  - frontend
coverImage: /images/frontend/javascript/dom-manipulation.png
draft: false
order: 10
---
# DOM Manipulation Best Practices: The Complete Guide

## Overview

DOM manipulation is expensive. Each change can trigger reflows, repaints, and style calculations. Understanding how to minimize these operations is crucial for building performant web applications.

---

## DOM is Slow

### Why DOM Operations Cost

```javascript
// Each DOM operation involves:
// 1. JavaScript engine ↔ Browser engine communication
// 2. Style calculation
// 3. Layout (reflow)
// 4. Painting
// 5. Compositing

// BAD: Multiple individual updates
function badWay() {
  for (let i = 0; i < 100; i++) {
    const div = document.createElement('div');
    div.textContent = i;
    document.body.appendChild(div); // 100 reflows!
  }
}

// GOOD: Batch updates
function goodWay() {
  const fragment = document.createDocumentFragment();
  
  for (let i = 0; i < 100; i++) {
    const div = document.createElement('div');
    div.textContent = i;
    fragment.appendChild(div); // No reflow!
  }
  
  document.body.appendChild(fragment); // 1 reflow!
}
```

---

## Batching Updates

### Cache and Update Once

```javascript
// BAD: Reading then writing causes multiple reflows
element.style.width = '100px';
console.log(element.offsetWidth); // Read - causes reflow
element.style.height = '100px'; // Write
element.style.padding = '10px'; // Write

// GOOD: Read all, then write
const width = element.offsetWidth;
const height = element.offsetHeight;

element.style.cssText = 'width: 100px; height: 100px; padding: 10px;';
```

### Use cssText

```javascript
// BAD: Multiple properties
element.style.width = '100px';
element.style.height = '100px';
element.style.color = 'red';
element.style.background = 'white';

// GOOD: Single cssText
element.style.cssText = 'width: 100px; height: 100px; color: red; background: white;';

// BETTER: Preserve existing styles
element.style.setProperty('--custom-width', '100px');
```

---

## DocumentFragment

```javascript
// Create DOM outside the live document
const fragment = document.createDocumentFragment();

// Add elements to fragment
for (let i = 0; i < 10; i++) {
  const item = document.createElement('li');
  item.textContent = `Item ${i}`;
  fragment.appendChild(item);
}

// Add all at once - single reflow
document.querySelector('ul').appendChild(fragment);

// Fragment is empty after appending
console.log(fragment.childNodes.length); // 0
```

### Template Pattern

```javascript
// Use template element
const template = document.querySelector('#item-template');
const list = document.querySelector('.list');

for (const data of items) {
  const clone = template.content.cloneNode(true);
  clone.querySelector('.title').textContent = data.title;
  clone.querySelector('.desc').textContent = data.description;
  list.appendChild(clone);
}
```

---

## Query and Cache

### Cache DOM References

```javascript
// BAD: Query every time
function updateItems() {
  const items = document.querySelectorAll('.item'); // Query each call
  
  items.forEach(item => {
    item.classList.add('updated');
  });
}

// GOOD: Cache reference
const items = document.querySelectorAll('.item');

function updateItems() {
  items.forEach(item => {
    item.classList.add('updated');
  });
}

// BETTER: Cache specific elements
const elements = {
  header: document.querySelector('.header'),
  footer: document.querySelector('.footer'),
  button: document.getElementById('submit-btn'),
  input: document.getElementById('name-input')
};
```

### Query Methods Performance

```javascript
// Fastest to slowest:
document.getElementById('id');           // Very fast - uses index
document.querySelector('.class');       // Fast for simple selectors
document.getElementsByClassName('class'); // Fast
document.querySelectorAll('selector');   // Slower - full document scan

// Use specific methods when possible
const el = document.getElementById('my-id'); // Better than .querySelector
const children = parentElement.children;     // Better than .querySelectorAll
```

---

## Virtual DOM vs Real DOM

### When to Use Vanilla JS

```javascript
// Direct DOM is fine for:
const button = document.getElementById('btn');
button.addEventListener('click', () => {
  button.classList.toggle('active');
});

// Simple updates to single elements
element.textContent = 'New text';
element.classList.add('visible');
```

### When to Use Frameworks

```javascript
// Frameworks help when:
// - Many dynamic elements
// - Complex state changes
// - Frequent re-renders
// - Data-driven UI

// React, Vue, Angular handle DOM efficiently
// They batch updates and minimize actual DOM changes
```

---

## Modern APIs

### classList

```javascript
// classList is more efficient than style
element.classList.add('active');
element.classList.remove('hidden');
element.classList.toggle('expanded');
element.classList.contains('selected');

// Multiple at once
element.classList.add('active', 'visible');
element.classList.remove('disabled', 'hidden');
```

### dataset

```javascript
// Access data attributes efficiently
element.dataset.userId = '123';
element.dataset.loading = 'true';

// Reads back as strings
console.log(element.dataset.userId); // '123'

// Remove with delete
delete element.dataset.loading;
```

---

## Common Mistakes

### Mistake 1: Not Using DocumentFragment

```javascript
// BAD: Adding each element individually
for (const item of items) {
  const li = document.createElement('li');
  li.textContent = item.name;
  list.appendChild(li); // Causes reflow each time!
}

// GOOD: Use DocumentFragment
const fragment = document.createDocumentFragment();
for (const item of items) {
  const li = document.createElement('li');
  li.textContent = item.name;
  fragment.appendChild(li);
}
list.appendChild(fragment);
```

### Mistake 2: Modifying Layout Properties

```javascript
// BAD: Reading layout causes reflow
function animate() {
  const currentLeft = element.offsetLeft; // Reflow!
  element.style.left = (currentLeft + 1) + 'px';
  
  requestAnimationFrame(animate);
}

// GOOD: Use transform
function animate() {
  const currentTransform = element.style.transform || 'translateX(0)';
  element.style.transform = `translateX(${newPosition}px)`;
  requestAnimationFrame(animate);
}
```

### Mistake 3: Querying Inside Loop

```javascript
// BAD: Query in loop
for (const button of buttons) {
  const icon = button.querySelector('.icon'); // Query each iteration!
}

// GOOD: Cache before loop
const icon = button.querySelector('.icon');
for (const button of buttons) {
  button.classList.add('processed');
}
```

---

## Summary

1. **Batch writes**: Use DocumentFragment, cssText
2. **Cache queries**: Store references, don't query repeatedly
3. **Read then write**: Batch reads, then writes
4. **Use transform**: For animations, not left/top
5. **Use classList**: More efficient than style
6. **Use querySelector**: But prefer getElementById when possible

DOM is slow. Minimize operations, batch updates, and use modern APIs.

---

## References

- [MDN - DOM](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model)
- [Google - Rendering Performance](https://developers.google.com/web/fundamentals/performance/rendering)
- [Tricks - DOM](https://css-tricks.com/ways-to-select-elements-in-the-dom/)
