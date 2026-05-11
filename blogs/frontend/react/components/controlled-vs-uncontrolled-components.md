---
title: "Controlled vs Uncontrolled Components"
description: "Understand controlled (state-driven) vs uncontrolled (ref-driven) components in React."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - forms
  - controlled
  - uncontrolled
  - frontend
coverImage: "/images/frontend/react/controlled-uncontrolled.png"
draft: false
---

# Controlled vs Uncontrolled Components: The Complete Guide

## Overview

Controlled components have their form data handled by React state, while uncontrolled components store form data in the DOM itself. Each has use cases.

---

## Controlled Components

### How They Work

```jsx
// React manages the form state
function ControlledForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  
  function handleSubmit(e) {
    e.preventDefault();
    console.log({ name, email });
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <input 
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name"
      />
      <input 
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email"
      />
      <button type="submit">Submit</button>
    </form>
  );
}
```

### When to Use

```jsx
// 1. Validation during typing
function FormWithValidation() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  
  const handleChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setError(value.includes('@') ? '' : 'Invalid email');
  };
  
  return (
    <input value={email} onChange={handleChange} />
  );
}

// 2. Conditional submit
// 3. Immediate feedback
// 4. Integration with other state
```

---

## Uncontrolled Components

### How They Work

```jsx
// DOM manages the form state
function UncontrolledForm() {
  const nameRef = useRef(null);
  const emailRef = useRef(null);
  
  function handleSubmit(e) {
    e.preventDefault();
    const data = {
      name: nameRef.current.value,
      email: emailRef.current.value
    };
    console.log(data);
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <input ref={nameRef} placeholder="Name" />
      <input ref={emailRef} placeholder="Email" />
      <button type="submit">Submit</button>
    </form>
  );
}
```

### When to Use

```jsx
// 1. Simple forms with no validation
// 2. Integrating with non-React code
// 3. File input
function FileInput() {
  const fileRef = useRef(null);
  
  function handleSubmit() {
    const file = fileRef.current.files[0];
    console.log(file.name);
  }
  
  return <input type="file" ref={fileRef} />;
}

// 4. Performance (when avoiding re-renders on every keystroke)
```

---

## Comparison

| Aspect | Controlled | Uncontrolled |
|-------|-----------|--------------|
| Data storage | React state | DOM |
| Validation | Easy (in onChange) | Need ref access |
| Reset | Easy (set state) | Need ref manipulation |
| Default value | Must set in state | Use defaultValue prop |
| Performance | Re-renders on input | No re-renders |

---

## Summary

1. **Controlled**: React owns the data via state
2. **Uncontrolled**: DOM owns the data via refs
3. **Use controlled**: When you need validation, conditional logic
4. **Use uncontrolled**: Simple forms, file inputs, performance

---

## References

- [React Docs - Forms](https://react.dev/learn/forms)