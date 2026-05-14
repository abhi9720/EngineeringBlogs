---
title: Prop Drilling Problem
description: >-
  Understanding and solving the prop drilling issue - when data needs to pass
  through many component levels.
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - react
  - state management
  - props
  - frontend
coverImage: /images/frontend/react/prop-drilling.png
draft: false
order: 20
---
# Prop Drilling Problem: The Complete Guide

## Overview

Prop drilling occurs when you need to pass data through multiple component levels that don't need the data themselves. This creates maintainability issues.

---

## The Problem

```jsx
// Data at top, needed deep down
function App() {
  const [user, setUser] = useState({ name: 'John', theme: 'dark' });
  
  return <Dashboard user={user} setUser={setUser} />;
}

function Dashboard({ user, setUser }) {
  return <Sidebar user={user} setUser={setUser} />;
}

function Sidebar({ user, setUser }) {
  return <UserMenu user={user} setUser={setUser} />; // Mid component doesn't need user!
}

function UserMenu({ user, setUser }) {
  return <div>{user.name}</div>; // Only this needs it!
}
```

---

## Solutions

### 1. Context API

```jsx
const UserContext = React.createContext();

function App() {
  const [user, setUser] = useState({ name: 'John' });
  
  return (
    <UserContext.Provider value={{ user, setUser }}>
      <Dashboard />
    </UserContext.Provider>
  );
}

function Dashboard() {
  return <Sidebar />; // No props needed!
}

function Sidebar() {
  return <UserMenu />; // No props needed!
}

function UserMenu() {
  const { user } = useContext(UserContext); // Get directly!
  return <div>{user.name}</div>;
}
```

### 2. State Management Libraries

```jsx
// Redux / Zustand store
const useStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user })
}));

function UserMenu() {
  const { user } = useStore();
  return <div>{user?.name}</div>;
}
```

---

## Summary

1. **Prop drilling**: Passing props through unnecessary levels
2. **Problem**: Hard to maintain, tightly coupled
3. **Solution 1**: Context API for app-wide state
4. **Solution 2**: State management library for complex state

---

## References

- [React Docs - Context](https://react.dev/learn/passing-data-deeply-with-context)
