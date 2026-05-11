---
title: "ARIA Basics for Developers"
description: "Learn ARIA fundamentals - when to use it, common patterns, and accessibility best practices."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - html
  - aria
  - accessibility
  - frontend
coverImage: "/images/frontend/html/aria-basics.png"
draft: false
---

# ARIA Basics for Developers

## Overview

ARIA (Accessible Rich Internet Applications) is a set of attributes that help make web content more accessible to people with disabilities. It provides semantic information about elements that don't have native HTML semantics. But ARIA is a last resort—always use semantic HTML first.

---

## The First Rule of ARIA

> "If you can use a native HTML element or attribute with the semantics and behavior you require, do so. ARIA is only for when you need to augment or change semantics that HTML can't provide."

### Bad Practice: Using ARIA Instead of Semantic HTML

```html
<!-- BAD: Using role instead of semantic element -->
<div role="button" onclick="submit()">Submit</div>
<span role="heading" level="1">Title</span>
<div role="link" href="/page">Go to page</div>

<!-- GOOD: Use semantic elements -->
<button onclick="submit()">Submit</button>
<h1>Title</h1>
<a href="/page">Go to page</a>
```

### When ARIA is Necessary

```html
<!-- Custom widget without native equivalent -->
<div role="slider" 
     aria-valuemin="0" 
     aria-valuemax="100" 
     aria-valuenow="50"
     aria-label="Volume"
     tabindex="0">
</div>

<!-- Complex interactive component -->
<div role="tablist" aria-label="Document sections">
  <button role="tab" aria-selected="true" aria-controls="panel1">Overview</button>
  <button role="tab" aria-selected="false" aria-controls="panel2">Details</button>
</div>
<div role="tabpanel" id="panel1">Content 1</div>
<div role="tabpanel" id="panel2" hidden>Content 2</div>
```

---

## ARIA Roles

### Landmark Roles

```html
<!-- Page structure landmarks -->
<header role="banner">Site header</header>
<nav role="navigation">Menu</nav>
<main role="main">Content</main>
<aside role="complementary">Sidebar</aside>
<footer role="contentinfo">Footer</footer>

<!-- Search is a landmark but has no native element -->
<form role="search">
  <input type="search" placeholder="Search">
</form>

<!-- Region creates a landmark -->
<section role="region" aria-label="Latest news">...</section>
```

### Widget Roles

```html
<!-- Interactive widgets -->
<button role="button">Click me</button>
<button role="checkbox" aria-checked="false">Accept terms</button>
<button role="radio" aria-checked="false" name="choice">Option 1</button>

<!-- Slider -->
<div role="slider" 
     aria-valuemin="0" 
     aria-valuemax="100" 
     aria-valuenow="25"
     tabindex="0">
</div>

<!-- Combobox (dropdown) -->
<input type="text" role="combobox" aria-expanded="false" aria-haspopup="listbox">
<ul role="listbox">
  <li role="option">Option 1</li>
  <li role="option">Option 2</li>
</ul>

<!-- Dialog -->
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Action</h2>
</div>
```

### Document Structure Roles

```html
<!-- List -->
<ul role="list">
  <li role="listitem">Item 1</li>
  <li role="listitem">Item 2</li>
</ul>

<!-- Feed (blog-like content) -->
<article role="article">...</article>
<article role="feed">
  <article role="article">Post 1</article>
  <article role="article">Post 2</article>
</article>

<!-- Figure -->
<figure role="figure" aria-label="Sales chart">
  <img src="chart.png" alt="Chart showing sales growth">
</figure>
```

---

## ARIA Attributes

### States and Properties

```html
<!-- Checkbox with state -->
<button role="checkbox" 
        aria-checked="false"
        onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')">
  Accept Terms
</button>

<!-- Expanded state -->
<button aria-expanded="false" 
        aria-controls="menu"
        onclick="toggleMenu()">
  Menu
</button>
<nav id="menu" hidden>...</nav>

<!-- Selected state -->
<option role="option" aria-selected="true">Selected</option>

<!-- Disabled state -->
<button aria-disabled="true">Cannot click</button>

<!-- Hidden state -->
<span aria-hidden="true">Not visible to screen readers</span>
```

### Relationships

```html
<!-- Labeling -->
<input aria-label="Search">
<input aria-labelledby="label-id">
<label id="label-id">Enter your name</label>

<!-- Described by -->
<input aria-describedby="hint-id error-id">
<span id="hint-id">Enter your email</span>
<span id="error-id" class="error"></span>

<!-- Owns (parent relationship) -->
<div role="menu" aria-owns="menuitem1 menuitem2">
  <div id="menuitem1" role="menuitem">Item 1</div>
  <div id="menuitem2" role="menuitem">Item 2</div>
</div>

<!-- Active descendant -->
<input role="textbox" aria-activedescendant="option1">
<ul role="listbox" hidden>
  <li id="option1" role="option">Option 1</li>
  <li id="option2" role="option">Option 2</li>
</ul>
```

### Live Regions

```html
<!-- Announce important changes -->
<div aria-live="polite">Changes will be announced politely</div>
<div aria-live="assertive">Urgent: announced immediately</div>

<!-- Status (role=status is implicit with aria-live="polite") -->
<div role="status" aria-live="polite">Form saved</div>

<!-- Alert for errors -->
<div role="alert" aria-live="assertive">Error: Invalid email</div>

<!-- Log for chat -->
<ol role="log" aria-live="polite" aria-label="Chat messages">
  <li>User1: Hello</li>
  <li>User2: Hi there</li>
</ol>
```

---

## Common Patterns

### Toggle Button

```html
<!-- Without ARIA - still accessible -->
<button aria-pressed="false" onclick="toggle(this)">
  <span>Follow</span>
</button>

<script>
function toggle(button) {
  const isPressed = button.getAttribute('aria-pressed') === 'true';
  button.setAttribute('aria-pressed', !isPressed);
  button.querySelector('span').textContent = isPressed ? 'Follow' : 'Following';
}
</script>
```

### Tabs

```html
<div role="tablist" aria-label="Settings">
  <button role="tab" 
          aria-selected="true" 
          aria-controls="general"
          id="tab-general">
    General
  </button>
  <button role="tab" 
          aria-selected="false" 
          aria-controls="security"
          id="tab-security">
    Security
  </button>
</div>

<div role="tabpanel" id="general" aria-labelledby="tab-general">
  <h2>General Settings</h2>
</div>

<div role="tabpanel" id="security" aria-labelledby="tab-security" hidden>
  <h2>Security Settings</h2>
</div>

<script>
document.querySelectorAll('[role="tab"]').forEach(tab => {
  tab.addEventListener('click', () => {
    // Update aria-selected
    document.querySelectorAll('[role="tab"]').forEach(t => 
      t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    
    // Show/hide panels
    const controls = tab.getAttribute('aria-controls');
    document.querySelectorAll('[role="tabpanel"]').forEach(p => p.hidden = true);
    document.getElementById(controls).hidden = false;
  });
});
</script>
```

### Modal Dialog

```html
<button onclick="openDialog()">Open Dialog</button>

<div role="dialog" 
     aria-modal="true" 
     aria-labelledby="dialog-title"
     aria-describedby="dialog-desc"
     id="my-dialog"
     hidden>
  <h2 id="dialog-title">Confirm Delete</h2>
  <p id="dialog-desc">Are you sure you want to delete this item?</p>
  <button onclick="closeDialog()">Cancel</button>
  <button onclick="confirmDelete()">Delete</button>
</div>

<!-- Focus trap -->
<div id="focus-trap" tabindex="-1" style="position:absolute;"></div>

<script>
let lastFocused;

function openDialog() {
  lastFocused = document.activeElement;
  document.getElementById('my-dialog').hidden = false;
  document.getElementById('my-dialog').querySelector('button').focus();
  document.body.addEventListener('keydown', handleTab);
}

function closeDialog() {
  document.getElementById('my-dialog').hidden = true;
  lastFocused.focus();
  document.body.removeEventListener('keydown', handleTab);
}

function handleTab(e) {
  if (e.key !== 'Tab') return;
  const dialog = document.getElementById('my-dialog');
  const focusable = dialog.querySelectorAll('button');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
</script>
```

### Tooltip

```html
<button aria-describedby="tooltip-id">Hover me</button>
<span role="tooltip" id="tooltip-id" 
       style="position:absolute; visibility:hidden;">
  Helpful information
</span>

<style>
button:hover + span,
button:focus + span {
  visibility: visible;
}
</style>
```

---

## ARIA in CSS

### Visibility and Screen Readers

```css
/* Hide from screen but keep available */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

/* Hide from everyone including screen readers */
.hidden {
  display: none;
}

/* Visible only on focus (skip links) */
.skip-link:focus {
  position: static;
  width: auto;
  height: auto;
  clip: auto;
}
```

### Styling Based on ARIA State

```css
/* Highlight disabled elements */
[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Active tab styling */
[role="tab"][aria-selected="true"] {
  background: white;
  border-bottom: 2px solid blue;
}

/* Focus visible styling */
[role="button"]:focus-visible {
  outline: 3px solid blue;
  outline-offset: 2px;
}
```

---

## Common Mistakes

### Mistake 1: Overriding Native Semantics

```html
<!-- WRONG: Remove semantics -->
<button role="presentation">I'm not a button</button>
<input role="none">

<!-- CORRECT: Use appropriate element -->
<span>I'm not a button</span>
```

### Mistake 2: Missing Labels

```html
<!-- WRONG: No accessible name -->
<div role="button">Click</div>

<!-- CORRECT: Proper labeling -->
<button>Click</button>
<!-- or -->
<div role="button" aria-label="Submit form">Click</div>
```

### Mistake 3: Incorrect Role Hierarchy

```html
<!-- WRONG: Role doesn't match element type -->
<ul role="menu">
  <li role="menuitem">Item</li>
</ul>

<!-- CORRECT: Proper roles -->
<nav role="navigation" aria-label="Main">
  <ul role="list">
    <li role="listitem"><a href="#">Link</a></li>
  </ul>
</nav>
```

### Mistake 4: Not Managing Focus

```html
<!-- WRONG: Focus goes to hidden element -->
<button onclick="showPanel()">Show</button>
<div id="panel" hidden>Panel content</div>

<script>
function showPanel() {
  document.getElementById('panel').hidden = false;
  // Focus should move to panel!
}
</script>

<!-- CORRECT: Move focus -->
<button onclick="showPanel()">Show</button>
<div id="panel" role="dialog" hidden aria-label="Panel">
  <h2 id="panel-title">Panel</h2>
  <button onclick="closePanel()">Close</button>
</div>

<script>
function showPanel() {
  const panel = document.getElementById('panel');
  panel.hidden = false;
  panel.querySelector('button').focus(); // Move focus!
}
</script>
```

---

## Testing ARIA

### Browser DevTools

1. Inspect element → See ARIA attributes in Accessibility pane
2. Accessibility Tree shows how screen readers see the page
3. Use Accessibility Inspector (Firefox) or Accessibility panel (Chrome)

### Screen Reader Testing

```bash
# Test with:
# - NVDA + Firefox (Windows)
# - JAWS + Chrome (Windows)
# - VoiceOver + Safari (Mac)
# - Orca + Firefox (Linux)
```

### Automated Testing

```javascript
// Using axe-core
const axe = require('axe-core');
axe.run(document, (err, results) => {
  console.log(results.violations);
});

// In browser
axe.run().then(results => console.log(results));
```

```html
<!-- Or include script -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/axe/4.8.3/axe.min.js"></script>
```

---

## Summary

1. **Use semantic HTML first**: ARIA is a last resort
2. **Don't change native semantics**: Don't add role="button" to a button
3. **Always provide labels**: aria-label, aria-labelledby, or native label
4. **Manage focus**: When showing/hiding content, manage focus appropriately
5. **Use live regions**: For dynamic content that updates
6. **Test with screen readers**: Different screen readers interpret ARIA differently
7. **Use landmark roles**: Make navigation easier for assistive technology

---

## References

- [MDN - Using ARIA](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [A11y Project - ARIA](https://www.a11yproject.com/checklist/)