---
title: Hoisting Behavior
description: >-
  Understand JavaScript hoisting - how var, let, const, and function
  declarations are hoisted differently.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - javascript
  - hoisting
  - scope
  - frontend
coverImage: /images/frontend/javascript/hoisting.png
draft: false
order: 10
---
# Hoisting Behavior: The Complete Guide

## Overview

Hoisting is JavaScript's behavior of moving declarations to the top of their scope before execution. But it's not literally moving code - it's how JavaScript treats declarations during the compilation phase. Understanding hoisting prevents common bugs and confusing behavior.

---

## How Hoisting Works

### Compilation vs Execution

```javascript
// JavaScript runs in two phases:
// 1. Compilation (scanning, hoisting)
// 2. Execution (running code)

/*
Before execution, JavaScript "hoists":
- var declarations
- function declarations
- class declarations
- import statements

NOT hoisted:
- let declarations  
- const declarations
- function expressions
- arrow functions
*/
```

### What Gets Hoisted

```javascript
// var - hoisted and initialized with undefined
console.log(x); // undefined (not ReferenceError!)
var x = 5;

// What actually happens:
var x;           // Hoisted: declaration
console.log(x); // undefined
x = 5;          // Assignment stays in place

// function declarations - fully hoisted
sayHello(); // "Hello!" - works!
function sayHello() {
  console.log('Hello!');
}

// What actually happens:
function sayHello() {
  console.log('Hello!');
}
sayHello();
```

---

## var vs let vs const

### var - Function Scoped

```javascript
// var is hoisted to function scope (or global)
function test() {
  if (true) {
    var x = 10;
  }
  console.log(x); // 10 - x is available in whole function!
}

// var gets undefined as initial value
console.log(y); // undefined (not error!)
var y = 20;

// Multiple declarations
var a = 1;
var a = 2; // Allowed - var can be redeclared
```

### let - Block Scoped (Temporal Dead Zone)

```javascript
// let is hoisted but NOT initialized
// Accessing before declaration = ReferenceError

// console.log(z); // ReferenceError: Cannot access 'z' before initialization
let z = 10;

// let has "temporal dead zone" - from start of block to declaration
{
  // TDZ starts here
  // console.log(w); // ReferenceError!
  let w = 5;
  // TDZ ends here
}

// let cannot be redeclared in same scope
let a = 1;
// let a = 2; // SyntaxError
```

### const - Like let but Immutable

```javascript
// const has same TDZ as let
// console.log(c); // ReferenceError
const c = 3;

// Must be initialized at declaration
const d; // SyntaxError: Missing initializer

// Cannot be reassigned
const e = 1;
e = 2; // TypeError: Assignment to constant variable

// Object properties can change
const obj = { a: 1 };
obj.a = 2; // OK - changing property, not reassignment
```

---

## Function Hoisting

### Function Declaration

```javascript
// Fully hoisted - works anywhere in function
console.log(add(2, 3)); // 5

function add(a, b) {
  return a + b;
}

// Overwrites variable declarations
var multiply = 'string';
function multiply(a, b) { return a * b; }

console.log(typeof multiply); // 'function' - declaration wins
```

### Function Expression

```javascript
// NOT hoisted - only variable is hoisted
// console.log(greet()); // TypeError: greet is not a function

var greet = function() {
  console.log('Hello!');
};

// What actually happens:
var greet;           // Hoisted (undefined)
console.log(greet()); // TypeError - trying to call undefined
greet = function() { // Assignment
  console.log('Hello!');
};
```

### Arrow Functions

```javascript
// Arrow functions behave like function expressions
// Not hoisted

// sayHi(); // ReferenceError
const sayHi = () => 'Hi';
```

---

## Class Hoisting

```javascript
// Class declarations are NOT hoisted
// console.log(Person); // ReferenceError

class Person {
  constructor(name) {
    this.name = name;
  }
}

// Class expressions
// const Animal = class { }; // Not hoisted
```

---

## Practical Examples

### Example 1: Loop with var

```javascript
// Classic bug: var doesn't have block scope
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// Output: 3, 3, 3 (var i is shared!)

// Solution 1: Use let
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// Output: 0, 1, 2 (let creates new binding each iteration)

// Solution 2: IIFE
for (var i = 0; i < 3; i++) {
  (function(index) {
    setTimeout(() => console.log(index), 100);
  })(i);
}
```

### Example 2: Function Call Order

```javascript
// What happens with multiple function declarations?
foo(); // "second"

function foo() {
  console.log('first');
}

function foo() {
  console.log('second');
}

// Last declaration wins - all hoisted together, last one assigned

// But with var:
bar(); // "first"

var bar = function() {
  console.log('second');
};

var bar = function() {
  console.log('first');
};
```

### Example 3: Hoisting in Conditions

```javascript
function hoistingExample() {
  console.log(x); // undefined (not ReferenceError!)
  
  if (false) {
    var x = 'declared';
  }
  
  console.log(y); // ReferenceError - let is not hoisted
  if (false) {
    let y = 'declared';
  }
}
```

---

## Best Practices

### Use let/const Instead of var

```javascript
// BAD: var has confusing hoisting
var x = 1;

// GOOD: let/const have clear scoping
let x = 1;
const x = 1;

// For variables that will be reassigned: let
// For constants: const
```

### Declare Before Use

```javascript
// GOOD: Use before declare
const fn = () => { /* code */ };
const obj = { /* code */ };
const arr = [];

// Avoid relying on hoisting
```

### Use IIFE for var Scope

```javascript
// Old pattern: IIFE to create block scope
(function() {
  var privateVar = 'hidden';
})();

// Modern: use let/const instead
{
  let privateVar = 'hidden';
}
```

---

## Summary

1. **Hoisting**: JavaScript's behavior of processing declarations before execution
2. **var**: Function-scoped, hoisted and initialized with undefined
3. **let/const**: Block-scoped, hoisted but in temporal dead zone (TDZ)
4. **Function declarations**: Fully hoisted (name and body)
5. **Function expressions**: Only the variable is hoisted
6. **Best practice**: Use let/const, declare before use
7. **Common bug**: var in loops - use let instead

Understanding hoisting prevents confusing bugs, especially with var in loops and closures.

---

## References

- [MDN - Hoisting](https://developer.mozilla.org/en-US/docs/Glossary/Hoisting)
- [JavaScript.info - Hoisting](https://javascript.info/hoisting)
- [ES6 Specification - Lexical Declarations](https://262.ecma-international.org/6.0/)
