---
title: Building Accessible Forms
description: >-
  Create accessible forms that work for everyone - proper labeling, error
  handling, and navigation.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - html
  - forms
  - accessibility
  - frontend
coverImage: /images/frontend/html/accessible-forms.png
draft: false
order: 20
---
# Building Accessible Forms: The Complete Guide

## Overview

Forms are one of the most common sources of accessibility issues. This guide covers everything from proper labeling to error handling, ensuring your forms work for all users including those using screen readers, keyboard-only navigation, and assistive technologies.

---

## Proper Labeling

### Explicit Labeling

```html
<!-- Best: Explicit association with for/id -->
<label for="first-name">First Name</label>
<input type="text" id="first-name" name="firstName">

<!-- Wrapping (implicit) -->
<label>
  First Name
  <input type="text" name="firstName">
</label>

<!-- Both work, explicit is preferred for complex layouts -->
```

### Implicit Labeling

```html
<!-- Works but less flexible for styling -->
<label>Email Address
  <input type="email" name="email">
</label>

<!-- Fieldset/Legend for grouped controls -->
<fieldset>
  <legend>Contact Preference</legend>
  <label>
    <input type="radio" name="contact" value="email">
    Email
  </label>
  <label>
    <input type="radio" name="contact" value="phone">
    Phone
  </label>
</fieldset>
```

### Multiple Labels

```html
<!-- Using aria-labelledby for complex labeling -->
<label for="search-input" class="sr-only">Search</label>
<input type="search" id="search-input" placeholder="Search..."
       aria-describedby="search-help">
<span id="search-help">Search for products, brands, or categories</span>

<!-- Multiple references -->
<label for="username">
  Username <span aria-hidden="true">*</span>
</label>
<input type="text" id="username" aria-required="true"
       aria-describedby="username-hint username-error">
<span id="username-hint" class="hint">3-20 characters</span>
<span id="username-error" class="error" role="alert"></span>
```

### Visual vs Audio Labels

```html
<!-- Screen-reader-only label -->
<label for="search" class="sr-only">Search</label>
<div class="search-box">
  <input type="search" id="search">
  <button type="submit">Search</button>
</div>

<style>
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
</style>

<!-- Visible label hidden on focus (for complex forms) -->
<label for="comment" class="sr-only">Your comment</label>
<textarea id="comment" placeholder="Enter your comment"></textarea>
```

---

## Required Fields

### Visual Indication

```html
<!-- Visual asterisk with screen reader only text -->
<label for="name">
  Name <span aria-hidden="true">*</span>
  <span class="sr-only">(required)</span>
</label>
<input type="text" id="name" required>

<!-- Using aria-required -->
<label for="email">Email</label>
<input type="email" id="email" required aria-required="true">

<!-- Fieldset for group -->
<fieldset>
  <legend>
    Contact Information <span aria-hidden="true">*</span>
    <span class="sr-only">(required)</span>
  </legend>
  <label for="email">Email</label>
  <input type="email" id="email" required>
</fieldset>
```

### Styling Required Fields

```css
/* Visual indication */
input[aria-required="true"],
input[required] {
  border-left: 3px solid #dc3545;
}

label.required::after {
  content: ' *';
  color: #dc3545;
}

/* Placeholder is NOT a substitute for label */
input::placeholder {
  color: #999; /* This is not a label! */
}
```

---

## Error Handling

### Inline Errors

```html
<!-- Error message linked to input -->
<label for="email">Email</label>
<input type="email" id="email" 
       aria-invalid="false" 
       aria-describedby="email-error">

<span id="email-error" class="error" role="alert" aria-live="polite">
</span>

<script>
// On validation error
emailInput.addEventListener('invalid', () => {
  emailInput.setAttribute('aria-invalid', 'true');
  errorSpan.textContent = emailInput.validationMessage;
});

// Clear on valid input
emailInput.addEventListener('input', () => {
  if (emailInput.validity.valid) {
    emailInput.setAttribute('aria-invalid', 'false');
    errorSpan.textContent = '';
  }
});
</script>
```

### Error Summary

```html
<!-- Error summary at top of form -->
<div id="error-summary" role="alert" aria-live="assertive" hidden>
  <h2>Please correct the following errors:</h2>
  <ul id="error-list"></ul>
</div>

<form id="my-form">
  <div class="form-group">
    <label for="name">Name</label>
    <input type="text" id="name" required>
    <span class="error"></span>
  </div>
  
  <div class="form-group">
    <label for="email">Email</label>
    <input type="email" id="email" required>
    <span class="error"></span>
  </div>
  
  <button type="submit">Submit</button>
</form>

<script>
form.addEventListener('submit', (e) => {
  e.preventDefault();
  
  // Clear previous errors
  document.querySelectorAll('.error').forEach(el => el.textContent = '');
  document.getElementById('error-summary').hidden = true;
  
  // Collect errors
  const errors = [];
  const inputs = form.querySelectorAll('input');
  
  inputs.forEach(input => {
    if (!input.validity.valid) {
      const errorSpan = input.parentElement.querySelector('.error');
      errorSpan.textContent = input.validationMessage;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errorSpan.id || undefined);
      errors.push({ input, message: input.validationMessage });
    }
  });
  
  // Show error summary
  if (errors.length > 0) {
    const summary = document.getElementById('error-summary');
    const list = document.getElementById('error-list');
    list.innerHTML = errors.map(e => 
      `<li><a href="#${e.input.id}">${e.message}</a></li>`
    ).join('');
    summary.hidden = false;
    summary.querySelector('a').focus(); // Focus first error
  }
});
</script>
```

### Focus Management

```html
<!-- Focus first error field -->
<script>
function focusFirstError() {
  const firstError = form.querySelector('[aria-invalid="true"]');
  if (firstError) {
    firstError.focus();
    firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
</script>

<!-- Also handle multiple error pages -->
<div aria-live="polite">
  <!-- Error announced as user fills -->
</div>

<div aria-live="assertive">
  <!-- Error announced immediately -->
</div>
```

---

## Field Groups

### Fieldset and Legend

```html
<fieldset>
  <legend>Shipping Address</legend>
  
  <div class="form-row">
    <label for="shipping-name">Full Name</label>
    <input type="text" id="shipping-name" autocomplete="name">
  </div>
  
  <div class="form-row">
    <label for="shipping-street">Street Address</label>
    <input type="text" id="shipping-street" autocomplete="shipping street-address">
  </div>
  
  <div class="form-row">
    <label for="shipping-city">City</label>
    <input type="text" id="shipping-city" autocomplete="shipping address-level2">
  </div>
</fieldset>

<fieldset>
  <legend>Billing Address</legend>
  <!-- Same structure -->
</fieldset>

<!-- Same address checkbox -->
<label>
  <input type="checkbox" id="same-address">
  Same as shipping address
</label>
```

### Group with aria-labelledby

```html
<!-- Complex grouping without fieldset -->
<div role="group" aria-labelledby="card-header">
  <h3 id="card-header">Credit Card</h3>
  
  <div class="form-row">
    <label for="card-number">Card Number</label>
    <input type="text" id="card-number" 
           inputmode="numeric"
           pattern="[0-9]*"
           autocomplete="cc-number">
  </div>
  
  <div class="form-row">
    <label for="card-expiry">Expiry</label>
    <input type="text" id="card-expiry" 
           placeholder="MM/YY"
           autocomplete="cc-exp">
  </div>
  
  <div class="form-row">
    <label for="card-cvv">CVV</label>
    <input type="text" id="card-cvv" 
           inputmode="numeric"
           pattern="[0-9]*"
           autocomplete="cc-csc">
  </div>
</div>
```

---

## Keyboard Navigation

### Tab Order

```html
<!-- Default: document order -->
<form>
  <label for="first">First</label>
  <input type="text" id="first">
  
  <label for="second">Second</label>
  <input type="text" id="second">
  
  <label for="third">Third</label>
  <input type="text" id="third">
</form>

<!-- Custom tab order -->
<label for="a">A</label>
<input type="text" id="a" tabindex="3">

<label for="b">B</label>
<input type="text" id="b" tabindex="1">

<label for="c">C</label>
<input type="text" id="c" tabindex="2">

<!-- Avoid tabindex > 0 on custom elements - breaks natural order -->
```

### Skip Links

```html
<body>
  <!-- Skip to main content -->
  <a href="#main-content" class="skip-link">Skip to main content</a>
  
  <header>
    <nav>...</nav>
  </header>
  
  <main id="main-content">
    <h1>Page Title</h1>
    <form>...</form>
  </main>
  
  <footer>...</footer>
</body>

<style>
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: blue;
  color: white;
  padding: 8px;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}
</style>
```

### Arrow Key Navigation

```html
<!-- Radio group with arrow key navigation -->
<fieldset role="radiogroup" aria-labelledby="shipping-label">
  <legend id="shipping-label">Shipping Method</legend>
  
  <label>
    <input type="radio" name="shipping" value="standard" checked>
    Standard (5-7 days)
  </label>
  
  <label>
    <input type="radio" name="shipping" value="express">
    Express (2-3 days)
  </label>
  
  <label>
    <input type="radio" name="shipping" value="overnight">
    Overnight
  </label>
</fieldset>

<!-- Native radio buttons handle arrow keys automatically -->
<!-- For custom controls, implement arrow key handling -->
```

---

## Autocomplete Attributes

```html
<!-- Help browsers autofill and announce correctly -->
<input type="text" name="name" autocomplete="name">
<input type="text" name="given-name" autocomplete="given-name">
<input type="text" name="family-name" autocomplete="family-name">

<input type="email" name="email" autocomplete="email">
<input type="tel" name="phone" autocomplete="tel">

<input type="text" name="address" autocomplete="address-line1">
<input type="text" name="city" autocomplete="address-level2">
<input type="text" name="state" autocomplete="address-level1">
<input type="text" name="zip" autocomplete="postal-code">
<input type="text" name="country" autocomplete="country">

<input type="text" name="cc-name" autocomplete="cc-name">
<input type="text" name="cc-number" autocomplete="cc-number">
<input type="text" name="cc-exp" autocomplete="cc-exp">
<input type="text" name="cc-csc" autocomplete="cc-csc">
```

---

## Real-World Complete Example

```html
<form id="signup-form" novalidate>
  <h1>Create Account</h1>
  
  <!-- Error summary -->
  <div id="error-summary" class="error-summary" hidden role="alert" aria-live="assertive">
    <h2>Please fix the following errors:</h2>
    <ul></ul>
  </div>
  
  <fieldset>
    <legend>Personal Information</legend>
    
    <div class="form-group">
      <label for="first-name">First Name <span aria-hidden="true">*</span></label>
      <input type="text" id="first-name" name="firstName" 
             required autocomplete="given-name"
             aria-describedby="first-name-hint">
      <span id="first-name-hint" class="hint">Your first name</span>
      <span class="error" role="alert" aria-live="polite"></span>
    </div>
    
    <div class="form-group">
      <label for="last-name">Last Name <span aria-hidden="true">*</span></label>
      <input type="text" id="last-name" name="lastName" 
             required autocomplete="family-name"
             aria-describedby="last-name-hint">
      <span id="last-name-hint" class="hint">Your last name</span>
      <span class="error" role="alert" aria-live="polite"></span>
    </div>
  </fieldset>
  
  <fieldset>
    <legend>Account Details</legend>
    
    <div class="form-group">
      <label for="email">Email <span aria-hidden="true">*</span></label>
      <input type="email" id="email" name="email" 
             required autocomplete="email"
             aria-describedby="email-hint email-error">
      <span id="email-hint" class="hint">We'll send confirmation here</span>
      <span id="email-error" class="error" role="alert" aria-live="polite"></span>
    </div>
    
    <div class="form-group">
      <label for="password">Password <span aria-hidden="true">*</span></label>
      <input type="password" id="password" name="password" 
             required minlength="8"
             autocomplete="new-password"
             aria-describedby="password-hint password-error">
      <span id="password-hint" class="hint">At least 8 characters</span>
      <span id="password-error" class="error" role="alert" aria-live="polite"></span>
    </div>
  </fieldset>
  
  <div class="form-group">
    <label>
      <input type="checkbox" name="terms" required>
      I agree to the <a href="/terms">Terms</a> <span aria-hidden="true">*</span>
    </label>
    <span class="error" role="alert" aria-live="polite"></span>
  </div>
  
  <button type="submit">Create Account</button>
</form>

<script>
const form = document.getElementById('signup-form');
const errorSummary = document.getElementById('error-summary');

// Clear errors on input
form.querySelectorAll('input').forEach(input => {
  input.addEventListener('input', () => clearError(input));
});

function clearError(input) {
  const errorSpan = input.parentElement.querySelector('.error');
  if (input.validity.valid) {
    input.setAttribute('aria-invalid', 'false');
    if (errorSpan) errorSpan.textContent = '';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const errors = [];
  const inputs = form.querySelectorAll('input[aria-invalid="true"], input:invalid');
  
  // Clear all errors first
  form.querySelectorAll('[aria-invalid="true"]').forEach(input => {
    input.setAttribute('aria-invalid', 'false');
  });
  form.querySelectorAll('.error').forEach(el => el.textContent = '');
  errorSummary.hidden = true;
  
  // Validate
  inputs.forEach(input => {
    const errorSpan = input.parentElement.querySelector('.error');
    if (errorSpan && input.validationMessage) {
      errorSpan.textContent = input.validationMessage;
      input.setAttribute('aria-invalid', 'true');
      errors.push({ input, message: input.validationMessage });
    }
  });
  
  // Show summary if errors
  if (errors.length > 0) {
    const list = errorSummary.querySelector('ul');
    list.innerHTML = errors.map(err => 
      `<li><a href="#${err.input.id}">${err.message}</a></li>`
    ).join('');
    errorSummary.hidden = false;
    errorSummary.querySelector('a').focus();
  } else {
    form.submit();
  }
});
</script>
```

---

## Best Practices Summary

1. **Always label inputs**: Use `<label>` elements, never rely on placeholder
2. **Use appropriate input types**: `type="email"`, `type="tel"`, etc.
3. **Indicate required fields**: Visual + `aria-required="true"`
4. **Provide clear error messages**: Link with `aria-describedby`
5. **Use `aria-invalid`**: Indicate error state to screen readers
6. **Use `autocomplete`**: Helps everyone, especially with disabilities
7. **Group related fields**: Use `<fieldset>` and `<legend>`
8. **Manage focus**: Move focus to first error on submit
9. **Use live regions**: `aria-live="polite"` or `"assertive"` for errors
10. **Test with screen readers**: NVDA, VoiceOver, JAWS

---

## References

- [WebAIM - Creating Accessible Forms](https://webaim.org/techniques/forms/)
- [MDN - Forms accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Accessibility_for_developers)
- [WCAG 2.1 - Input Purpose](https://www.w3.org/WAI/WCAG21/Understanding/input-purpose.html)
