---
title: "Debounce & Throttle: Use Cases"
description: "Master debounce and throttle - when to use each, implementation, and real-world patterns."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - javascript
  - performance
  - debounce
  - throttle
  - frontend
coverImage: "/images/frontend/javascript/debounce-throttle.png"
draft: false
---

# Debounce & Throttle: The Complete Guide

## Overview

Debounce and throttle are techniques to limit how often a function executes. They're essential for optimizing expensive operations like API calls, resize handlers, and scroll listeners.

---

## When to Use Each

### Debounce - Wait for Inactivity

```javascript
// Debounce: Function executes AFTER wait period of no calls
// Use for:
// - Search input (wait for user to stop typing)
// - Window resize (wait for resize to finish)
// - Button clicks (prevent double-submit)

/*
Timeline (debounce 300ms):
user types "h" ─────► wait 300ms ─────► execute handler
user types "e" ─────────────────────► wait 300ms ─────► execute handler
user types "l" ──────────────────────────────► wait 300ms ──► execute handler
*/
```

### Throttle - Limit Execution Rate

```javascript
// Throttle: Function executes at most once per wait period
// Use for:
// - Scroll events (limit position updates)
// - Mouse move (limit tracking)
// - Window resize (limit layout recalculations)

/*
Timeline (throttle 300ms):
scroll ─► execute ─► [300ms block] ─► scroll ─► execute ─► [300ms block] ─► scroll ─► execute
scroll ─► ignored ──► ignored ──► [300ms block clears] ─► scroll ─► execute
*/
```

---

## Debounce Implementation

### Basic Debounce

```javascript
function debounce(fn, delay) {
  let timeoutId;
  
  return function(...args) {
    clearTimeout(timeoutId);
    
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

// Usage
const handleSearch = debounce((query) => {
  console.log('Searching for:', query);
  fetchResults(query);
}, 300);

input.addEventListener('input', (e) => {
  handleSearch(e.target.value);
});
```

### Leading Edge Debounce

```javascript
// Execute on leading edge (first call) AND trailing edge (after wait)
function debounceLeadingTrailing(fn, delay) {
  let timeoutId;
  let called = false;
  
  return function(...args) {
    if (!called) {
      fn.apply(this, args);
      called = true;
    }
    
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      called = false;
    }, delay);
  };
}
```

### Promise-Based Debounce

```javascript
// Debounce that returns a promise
function debouncePromise(fn, delay) {
  let timeoutId;
  let pendingPromise;
  let resolver;
  
  return function(...args) {
    clearTimeout(timeoutId);
    
    pendingPromise = new Promise(resolve => {
      resolver = resolve;
    });
    
    timeoutId = setTimeout(() => {
      const result = fn.apply(this, args);
      resolver(result);
    }, delay);
    
    return pendingPromise;
  };
}

// Usage
const search = debouncePromise(async (query) => {
  const response = await fetch(`/api/search?q=${query}`);
  return response.json();
}, 300);

async function handleInput(value) {
  const results = await search(value);
  renderResults(results);
}
```

---

## Throttle Implementation

### Basic Throttle

```javascript
function throttle(fn, limit) {
  let inThrottle;
  let lastArgs;
  
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) {
          fn.apply(this, lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}
```

### requestAnimationFrame Throttle

```javascript
// Better for visual updates - syncs with display refresh
function throttleRAF(fn) {
  let rafId;
  let lastArgs;
  
  return function(...args) {
    lastArgs = args;
    
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        fn.apply(this, lastArgs);
        rafId = null;
      });
    }
  };
}

// Usage - for smooth scroll animations
window.addEventListener('scroll', throttleRAF((e) => {
  console.log('Scroll position:', window.scrollY);
}));
```

---

## Real-World Use Cases

### Search Input

```javascript
// Search with debounce
const searchInput = document.getElementById('search');
const resultsContainer = document.getElementById('results');

const performSearch = debounce(async (query) => {
  if (!query.trim()) {
    resultsContainer.innerHTML = '';
    return;
  }
  
  const results = await fetch(`/api/search?q=${query}`).then(r => r.json());
  renderResults(results);
}, 300);

searchInput.addEventListener('input', (e) => {
  performSearch(e.target.value);
});
```

### Window Resize

```javascript
// Resize handler with debounce
const handleResize = debounce(() => {
  console.log('Resized:', window.innerWidth, window.innerHeight);
  updateLayout();
}, 250);

window.addEventListener('resize', handleResize);

// Alternative: throttle for continuous updates during resize
const handleResizeContinuous = throttle(() => {
  console.log('Resize:', window.innerWidth);
  updateLayout();
}, 100);

window.addEventListener('resize', handleResizeContinuous);
```

### Infinite Scroll

```javascript
// Infinite scroll with throttle
let page = 1;
let loading = false;

const loadMore = throttle(async () => {
  if (loading) return;
  loading = true;
  
  const moreItems = await fetch(`/api/items?page=${page}`).then(r => r.json());
  
  if (moreItems.length) {
    appendItems(moreItems);
    page++;
  }
  
  loading = false;
}, 1000);

window.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
  
  if (scrollTop + clientHeight >= scrollHeight - 100) {
    loadMore();
  }
});
```

### Form Submit Prevention

```javascript
// Prevent double submit
const handleSubmit = debounce(async (formData) => {
  const response = await fetch('/api/submit', {
    method: 'POST',
    body: formData
  });
  
  alert('Submitted successfully!');
}, 2000);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  handleSubmit(formData);
  submitBtn.disabled = true;
  
  setTimeout(() => submitBtn.disabled = false, 2000);
});
```

### Mouse Tracking

```javascript
// Track mouse with throttle
const trackMouse = throttle((x, y) => {
  // Send analytics
  analytics.track('mouseMove', { x, y });
}, 100);

document.addEventListener('mousemove', (e) => {
  trackMouse(e.clientX, e.clientY);
});
```

---

## Lodash/Underscore Usage

```javascript
// Using lodash
import { debounce, throttle } from 'lodash';

const debouncedSearch = debounce(search, 300);
const throttledScroll = throttle(handleScroll, 100);

// With options
const debouncedLeading = debounce(fn, 300, { leading: true });
const debouncedTrailing = debounce(fn, 300, { trailing: true });
const throttledTrailing = throttle(fn, 100, { trailing: false });
```

---

## Summary

1. **Debounce**: Wait for inactivity before executing
2. **Throttle**: Limit execution rate
3. **Use debounce**: Search, resize, form submit
4. **Use throttle**: Scroll, mouse move, infinite scroll
5. **Implement**: Basic versions are simple to write
6. **Consider**: requestAnimationFrame for visual updates

Debounce for "stopped" actions, throttle for "limited rate" actions.

---

## References

- [Lodash Debounce](https://lodash.com/docs/4.17.15#debounce)
- [Lodash Throttle](https://lodash.com/docs/4.17.15#throttle)
- [CSS-Tricks - Debouncing](https://css-tricks.com/debouncing-throttling-explained-examples/)