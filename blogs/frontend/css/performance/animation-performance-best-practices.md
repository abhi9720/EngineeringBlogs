---
title: "Animation Performance Best Practices"
description: "Create smooth 60fps animations - GPU acceleration, will-change, and avoiding layout thrashing."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - css
  - animation
  - performance
  - frontend
coverImage: "/images/frontend/css/animation-performance.png"
draft: false
---

# Animation Performance Best Practices: The Complete Guide

## Overview

Smooth animations require 60fps (16.67ms per frame). Understanding how browsers render animations and which properties to animate ensures your UI feels responsive and professional.

---

## The 60fps Goal

### Frame Budget

```javascript
// At 60fps, you have 16.67ms per frame
// Browser needs ~6ms, leaving ~10ms for your code

const FRAME_TIME = 1000 / 60; // 16.67ms
const BUDGET = 10; // ms for JavaScript

// If animation drops below 60fps:
// - Animation janks/stutters
// - User perceives lag
// - Battery drains faster
```

### Main Thread vs Compositor

```javascript
// Main Thread (slower):
// - JavaScript execution
// - Style calculation
// - Layout (reflow)
// - Paint

// Compositor Thread (fast):
// - Transform
// - Opacity
// - Filter (sometimes)
// - Will-change triggered layers

// Compositor runs independently - continues even if main thread is busy
```

---

## Properties to Animate

### Compositor-Only (Smooth)

```css
/* These run on compositor - always smooth */
element {
  transform: translate(100px, 0);
  transform: rotate(45deg);
  transform: scale(1.5);
  transform: translate3d(0, 0, 0); /* Force GPU */
  
  opacity: 0.5;
  
  /* May be compositor in some browsers */
  filter: blur(2px);
  clip-path: polygon(0 0, 100% 0, 100% 50%, 0 50%);
}
```

### Trigger Reflow (Avoid)

```css
/* These cause layout - avoid in animations */
element {
  width: 100px;      /* Layout */
  height: 100px;    /* Layout */
  padding: 10px;    /* Layout */
  margin: 10px;     /* Layout */
  top: 10px;        /* Layout */
  left: 10px;       /* Layout */
  border: 1px;      /* Layout */
  font-size: 16px;  /* Layout */
}
```

### Trigger Repaint (Minimize)

```css
/* These cause repaint - less expensive than reflow */
element {
  background-color: red;
  color: blue;
  border-color: green;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
```

---

## CSS Transitions

```css
/* Basic transition */
.smooth {
  transition: transform 0.3s ease;
}

.smooth:hover {
  transform: translateX(100px);
}

/* Multiple properties */
.complex {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

/* Performance optimized */
.optimized {
  /* Specify what to animate */
  transition: transform 0.3s;
  
  /* Will-change hints browser to prepare */
  will-change: transform;
}

/* Easing functions */
.ease-in { transition-timing-function: ease-in; }
.ease-out { transition-timing-function: ease-out; }
.ease-in-out { transition-timing-function: ease-in-out; }
.linear { transition-timing-function: linear; }

/* Custom cubic-bezier */
.custom {
  transition-timing-function: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

---

## CSS Keyframe Animations

```css
/* Keyframe animation */
@keyframes slideIn {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animated {
  animation: slideIn 0.5s ease forwards;
}

/* Running animation */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 2s linear infinite;
}

/* Pause on hover */
.pause:hover {
  animation-play-state: paused;
}
```

---

## JavaScript Animations

### requestAnimationFrame

```javascript
// Better than setInterval/requestAnimationFrame
function animate() {
  // Runs ~60 times per second, synced with display refresh
  element.style.transform = `translateX(${position}px)`;
  position += 5;
  
  if (position < 500) {
    requestAnimationFrame(animate);
  }
}

requestAnimationFrame(animate);

// Cancel animation
const animationId = requestAnimationFrame(animate);
cancelAnimationFrame(animationId);
```

### Web Animations API

```javascript
// Modern, performant API
const animation = element.animate([
  { transform: 'translateX(0)', opacity: 1 },
  { transform: 'translateX(100px)', opacity: 0.5 }
], {
  duration: 1000,
  easing: 'ease-out',
  fill: 'forwards'
});

// Control
animation.play();
animation.pause();
animation.cancel();
animation.currentTime = 500;
animation.playbackRate = 2; // 2x speed
```

### Velocity.js

```javascript
// Lightweight animation library
Velocity(element, {
  translateX: 100,
  opacity: 0
}, {
  duration: 500,
  easing: 'easeOutQuad'
});
```

---

## Optimization Techniques

### Will-Change

```css
/* Hint browser to prepare for animation */
.element {
  will-change: transform;
  /* Creates compositing layer */
}

/* Don't overuse - causes memory issues */
.too-much {
  will-change: all; /* Bad! */
}

/* Remove after animation */
.element {
  will-change: transform;
}

.element.animation-complete {
  will-change: auto; /* Clean up */
}
```

### Force GPU Acceleration

```css
/* Old technique - still works */
.gpu {
  transform: translateZ(0);
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  perspective: 1000;
}

/* Modern: use will-change */
.gpu-modern {
  will-change: transform;
}
```

### Debouncing Expensive Animations

```javascript
// Don't animate on every scroll event
let ticking = false;

window.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(() => {
      updateAnimation();
      ticking = false;
    });
    ticking = true;
  }
});
```

---

## Real-World Patterns

### Fade In Animation

```css
.fade-in {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-in.visible {
  opacity: 1;
  transform: translateY(0);
}

/* JavaScript to trigger */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
});

observer.observe(document.querySelector('.fade-in'));
```

### Hover Effects

```css
/* Optimized hover */
.btn {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
}

.btn:active {
  transform: scale(0.98);
}

/* Avoid hover animations on mobile that cause repaints */
@media (hover: none) {
  .btn:hover {
    transform: none;
    box-shadow: none;
  }
}
```

### Loading Animation

```css
@keyframes shimmer {
  from { background-position: -200px 0; }
  to { background-position: 200px 0; }
}

.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite;
}

/* More efficient than animating width or background-position */
```

---

## Common Mistakes

### Mistake 1: Animating Wrong Properties

```css
/* WRONG: Triggers layout */
@keyframes bad {
  0% { left: 0; }
  100% { left: 100px; }
}

/* CORRECT: Uses transform */
@keyframes good {
  0% { transform: translateX(0); }
  100% { transform: translateX(100px); }
}
```

### Mistake 2: Not Using transform: translate3d

```css
/* May not use GPU without it */
.slow { transform: translateX(100px); }

/* Forces GPU acceleration */
.fast { transform: translate3d(100px, 0, 0); }
```

### Mistake 3: Overusing will-change

```css
/* WRONG: Too many elements with will-change */
* { will-change: auto; } /* Too much */

/* CORRECT: Only on animated elements */
.element-to-animate {
  will-change: transform;
}
```

### Mistake 4: Animating During Scroll

```javascript
// WRONG: Expensive on scroll
window.addEventListener('scroll', () => {
  element.style.left = window.scrollY + 'px';
});

// CORRECT: Use requestAnimationFrame + passive listener
window.addEventListener('scroll', () => {
  requestAnimationFrame(updatePosition);
}, { passive: true });
```

---

## Summary

1. **Goal**: 60fps = 16.67ms per frame
2. **Compositor**: transform, opacity - run on GPU
3. **Layout**: width, height, top, left - avoid in animation
4. **Will-change**: Use sparingly on animated elements
5. **RAF**: Use requestAnimationFrame for JS animations
6. **Avoid**: scroll-triggered animations without optimization
7. **Test**: Chrome DevTools Performance tab

Smooth animations make your UI feel professional. Always animate compositor-friendly properties like `transform` and `opacity`.

---

## References

- [Google - Animations](https://developers.google.com/web/fundamentals/performance/rendering/animations)
- [MDN - CSS animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations)
- [CSS-Tricks - Animation Performance](https://css-tricks.com/almanac/properties/a/animation/)