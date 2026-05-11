---
title: "HTML Forms Validation Model"
description: "Master HTML5 form validation - built-in constraints, custom validation, and the Constraint Validation API."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - html
  - forms
  - validation
  - frontend
coverImage: "/images/frontend/html/forms-validation.png"
draft: false
---

# HTML Forms Validation Model: The Complete Guide

## Overview

HTML5 introduced built-in form validation that works without JavaScript. Combined with the Constraint Validation API, you can create robust, accessible forms with minimal code. This guide covers everything from basic attributes to custom validation logic.

---

## Built-in Validation Attributes

### Required Fields

```html
<!-- Simple required field -->
<input type="text" required>

<!-- Required with custom message -->
<input type="email" required id="email" name="email">
<span class="error" id="email-error" aria-live="polite"></span>

<script>
const input = document.getElementById('email');
input.addEventListener('invalid', (e) => {
  if (input.validity.valueMissing) {
    input.setCustomValidity('Please enter your email address');
  } else if (input.validity.typeMismatch) {
    input.setCustomValidity('Please enter a valid email address');
  } else {
    input.setCustomValidity('');
  }
});
</script>
```

### Pattern Matching

```html
<!-- US phone: (123) 456-7890 or 123-456-7890 -->
<input type="tel" 
       pattern="(\+1[-.]?)?\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}"
       placeholder="(123) 456-7890">

<!-- Postal code (US) -->
<input type="text" pattern="[0-9]{5}(-[0-9]{4})?" placeholder="12345">

<!-- Username: alphanumeric, 3-15 chars -->
<input type="text" pattern="[A-Za-z0-9_]{3,15}" 
       title="3-15 characters, letters, numbers, underscore">

<!-- Strong password -->
<input type="password" 
       pattern="(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}"
       title="Min 8 chars, include uppercase, lowercase, number">
```

### Length Constraints

```html
<!-- Min/Max length for text -->
<input type="text" name="username" 
       minlength="3" maxlength="20"
       placeholder="3-20 characters">

<!-- Min/Max for number -->
<input type="number" name="age" 
       min="13" max="120"
       placeholder="13-120">

<!-- Min/Max for date -->
<input type="date" name="appointment"
       min="2024-01-01" max="2025-12-31">

<!-- Step for number/date -->
<input type="number" name="quantity" 
       min="0" max="100" step="5"
       placeholder="Multiples of 5">

<input type="range" min="0" max="100" step="10">
```

---

## Input Types and Validation

### Email and URL

```html
<!-- Email with multiple addresses (comma-separated) -->
<input type="email" multiple placeholder="one@example.com, two@example.com">

<!-- URL - must start with http:// or https:// -->
<input type="url" placeholder="https://example.com">

<!-- File - accept specific types -->
<input type="file" accept=".jpg,.jpeg,.png" accept="image/*">
<input type="file" accept=".pdf,.doc,.docx" accept="application/pdf,application/msword">
```

### Color and Range

```html
<!-- Color picker -->
<input type="color" name="theme" value="#007bff">

<!-- Range with datalist for tick marks -->
<input type="range" name="volume" min="0" max="100" value="50"
       list="volume-marks">
<datalist id="volume-marks">
  <option value="0">
  <option value="25">
  <option value="50">
  <option value="75">
  <option value="100">
</datalist>
```

### Date and Time

```html
<!-- Date -->
<input type="date" name="birthday" min="1900-01-01" max="2024-01-01">

<!-- Month -->
<input type="month" name="expiry" min="2024-01">

<!-- Week -->
<input type="week" name="vacation" min="2024-W01" max="2024-W52">

<!-- Time -->
<input type="time" name="appointment-time" min="09:00" max="17:00">

<!-- DateTime Local -->
<input type="datetime-local" name="meeting" 
       min="2024-01-01T09:00" max="2024-12-31T17:00">
```

---

## The Constraint Validation API

### Checking Validity

```javascript
const input = document.getElementById('email');

// Check individual validity states
console.log(input.validity.valueMissing);   // true if required but empty
console.log(input.validity.typeMismatch);   // true if value doesn't match type
console.log(input.validity.patternMismatch); // true if pattern doesn't match
console.log(input.validity.tooLong);       // true if exceeds maxlength
console.log(input.validity.tooShort);      // true if below minlength
console.log(input.validity.rangeUnderflow); // true if below min
console.log(input.validity.rangeOverflow); // true if above max
console.log(input.validity.stepMismatch);  // true if not matching step
console.log(input.validity.badInput);     // true if input can't be parsed
console.log(input.validity.valid);         // true if no errors

// checkValidity() - returns boolean
if (!input.checkValidity()) {
  console.log(input.validationMessage);
}

// reportValidity() - shows browser's error message
input.reportValidity();
```

### Custom Validation

```javascript
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirm-password');

function validatePasswordMatch() {
  if (password.value !== confirmPassword.value) {
    confirmPassword.setCustomValidity('Passwords do not match');
  } else {
    confirmPassword.setCustomValidity('');
  }
}

password.addEventListener('input', validatePasswordMatch);
confirmPassword.addEventListener('input', validatePasswordMatch);

// Check entire form
const form = document.getElementById('myForm');
form.addEventListener('submit', (e) => {
  if (!form.checkValidity()) {
    e.preventDefault();
    form.reportValidity();
  }
});
```

---

## Styling Valid and Invalid States

### CSS Pseudo-classes

```css
/* Applied to valid inputs */
input:valid {
  border-color: #28a745;
}

/* Applied to invalid inputs */
input:invalid {
  border-color: #dc3545;
}

/* Only show error after interaction */
input:invalid:not(:placeholder-shown):not(:focus) {
  border-color: #dc3545;
}

/* Required fields styling */
input:required {
  border-left: 3px solid #007bff;
}

/* Optional fields */
input:optional {
  border-style: dashed;
}
```

### Custom Error Messages

```css
/* Style the validation message bubble */
input:invalid + .error-message::after {
  content: attr(data-error);
  color: #dc3545;
  font-size: 0.875rem;
  display: none;
}

input:invalid:not(:placeholder-shown):not(:focus) + .error-message::after {
  display: block;
}

/* Custom validity UI */
input:invalid::-webkit-validation-message {
  color: #dc3545;
}

input:invalid::-moz-validation-message {
  color: #dc3545;
}
```

---

## Real-World Validation Patterns

### Registration Form

```html
<form id="register-form" novalidate>
  <div class="form-group">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required
           autocomplete="email">
    <span class="error" aria-live="polite"></span>
  </div>
  
  <div class="form-group">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required
           minlength="8" pattern="(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).*"
           autocomplete="new-password">
    <span class="hint">Min 8 chars, uppercase, lowercase, number</span>
  </div>
  
  <div class="form-group">
    <label for="confirm-password">Confirm Password</label>
    <input type="password" id="confirm-password" name="confirm-password"
           required autocomplete="new-password">
  </div>
  
  <div class="form-group">
    <label for="age">Age</label>
    <input type="number" id="age" name="age" min="13" max="120" required>
  </div>
  
  <button type="submit">Create Account</button>
</form>

<script>
const form = document.getElementById('register-form');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirm-password');

// Custom validation for password match
function validatePasswordMatch() {
  if (password.value && confirmPassword.value) {
    if (password.value !== confirmPassword.value) {
      confirmPassword.setCustomValidity('Passwords do not match');
    } else {
      confirmPassword.setCustomValidity('');
    }
  }
}

password.addEventListener('input', validatePasswordMatch);
confirmPassword.addEventListener('input', validatePasswordMatch);

// Submit handler
form.addEventListener('submit', (e) => {
  if (!form.checkValidity()) {
    e.preventDefault();
    form.reportValidity();
  }
});
</script>
```

### Real-time Validation

```javascript
class FormValidator {
  constructor(form) {
    this.form = form;
    this.inputs = form.querySelectorAll('input, textarea, select');
    this.init();
  }
  
  init() {
    this.inputs.forEach(input => {
      // Validate on blur (user leaves field)
      input.addEventListener('blur', () => this.validateInput(input));
      
      // Clear error on input (user typing)
      input.addEventListener('input', () => this.clearError(input));
    });
    
    this.form.addEventListener('submit', (e) => {
      if (!this.form.checkValidity()) {
        e.preventDefault();
        this.form.reportValidity();
      }
    });
  }
  
  validateInput(input) {
    if (input.validity.valid) {
      this.showSuccess(input);
    } else {
      this.showError(input);
    }
  }
  
  showError(input) {
    input.classList.remove('valid');
    input.classList.add('invalid');
    this.updateErrorMessage(input);
  }
  
  showSuccess(input) {
    input.classList.remove('invalid');
    input.classList.add('valid');
    this.clearErrorMessage(input);
  }
  
  clearError(input) {
    if (input.validity.valid) {
      this.showSuccess(input);
    }
  }
  
  updateErrorMessage(input) {
    const errorElement = input.parentElement.querySelector('.error');
    if (errorElement) {
      errorElement.textContent = input.validationMessage;
    }
  }
  
  clearErrorMessage(input) {
    const errorElement = input.parentElement.querySelector('.error');
    if (errorElement) {
      errorElement.textContent = '';
    }
  }
}

// Usage
new FormValidator(document.getElementById('my-form'));
```

---

## Accessibility Considerations

### aria-invalid and aria-describedby

```html
<label for="email">Email</label>
<input type="email" id="email" name="email" required
       aria-describedby="email-hint email-error"
       aria-invalid="false">

<span id="email-hint" class="hint">we'll never share your email</span>
<span id="email-error" class="error" role="alert"></span>

<script>
const email = document.getElementById('email');
const errorSpan = document.getElementById('email-error');

email.addEventListener('invalid', (e) => {
  email.setAttribute('aria-invalid', 'true');
  errorSpan.textContent = email.validationMessage;
});

email.addEventListener('input', () => {
  if (email.validity.valid) {
    email.setAttribute('aria-invalid', 'false');
    errorSpan.textContent = '';
  }
});
</script>
```

### Live Regions for Errors

```html
<form>
  <!-- Error container with aria-live -->
  <div id="form-errors" role="alert" aria-live="polite" class="hidden">
    Please correct the following errors:
  </div>
  
  <input type="text" id="name" required>
  <input type="email" id="email" required>
  <button type="submit">Submit</button>
</form>

<script>
form.addEventListener('submit', (e) => {
  if (!form.checkValidity()) {
    e.preventDefault();
    const errors = form.querySelectorAll(':invalid');
    const errorList = Array.from(errors)
      .map(input => `${input.labels[0].textContent}: ${input.validationMessage}`)
      .join('\n');
    
    document.getElementById('form-errors').textContent = errorList;
    document.getElementById('form-errors').classList.remove('hidden');
  }
});
</script>
```

---

## Common Mistakes

### Mistake 1: Disabling Validation Without Fallback

```html
<!-- WRONG: No validation at all -->
<form action="/submit" novalidate>

<!-- CORRECT: Add JS validation when disabling browser validation -->
<form action="/submit" novalidate onsubmit="return validateForm(this)">
```

### Mistake 2: Not Checking validity Before Submitting

```html
<!-- WRONG: Always submit -->
<form action="/submit">
  <button>Submit</button>
</form>

<!-- CORRECT: Validate first -->
<form action="/submit" onsubmit="return this.checkValidity()">
```

### Mistake 3: Relying Only on Pattern

```html
<!-- WRONG: No required + only pattern -->
<input type="email" pattern=".+@.+\..+" title="Email">

<!-- CORRECT: Use type + required -->
<input type="email" required>
```

### Mistake 4: Not Clearing Custom Validity

```javascript
// WRONG: Custom validity never cleared
input.addEventListener('invalid', () => {
  input.setCustomValidity('Error');
});

// CORRECT: Clear on valid
input.addEventListener('invalid', () => {
  if (input.validity.valueMissing) {
    input.setCustomValidity('Required');
  } else {
    input.setCustomValidity(''); // Clear!
  }
});
```

---

## Summary

1. **Use native attributes**: `required`, `min`, `max`, `minlength`, `maxlength`, `pattern`, `type`
2. **Leverage input types**: `email`, `tel`, `url`, `number`, `date`, `color` for automatic validation
3. **Use Constraint Validation API**: `checkValidity()`, `validationMessage`, `validity` object
4. **Custom validation**: `setCustomValidity()` for complex rules
5. **Style with pseudo-classes**: `:valid`, `:invalid`, `:required`, `:optional`
6. **Accessibility**: `aria-invalid`, `aria-describedby`, live regions for errors
7. **novalidate**: Only use when providing full JavaScript fallback

---

## References

- [MDN - Form validation](https://developer.mozilla.org/en-US/docs/Web/HTML/Constraint_validation)
- [HTML Spec - Constraint validation](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constraints)
- [Can I Use - Constraint validation](https://caniuse.com/constraint-validation)