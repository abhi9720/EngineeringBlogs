---
title: "Redux Flow Explained"
description: "Understanding Redux architecture - actions, reducers, store, and how data flows."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - redux
  - state management
  - frontend
coverImage: "/images/frontend/react/redux-flow.png"
draft: false
---

# Redux Flow Explained: The Complete Guide

## Overview

Redux is a predictable state container for JavaScript apps. Understanding the unidirectional data flow helps you use it effectively.

---

## Redux Architecture

```
┌─────────────────────────────────────────────────────┐
│                    STORE                            │
│  ┌─────────────────────────────────────────────┐   │
│  │              Current State                   │   │
│  │  { users: [], loading: false, error: null }│   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         ↑                    ↓                    ↑
    Reducers              Actions              Components
```

---

## Core Concepts

### 1. Store

```javascript
import { createStore } from 'redux';
import rootReducer from './reducers';

const store = createStore(rootReducer);

console.log(store.getState()); // { users: [] }
```

### 2. Actions

```javascript
// Action creators
const addUser = (user) => ({
  type: 'ADD_USER',
  payload: user
});

const setLoading = (isLoading) => ({
  type: 'SET_LOADING',
  payload: isLoading
});
```

### 3. Reducers

```javascript
const userReducer = (state = initialState, action) => {
  switch (action.type) {
    case 'ADD_USER':
      return {
        ...state,
        users: [...state.users, action.payload]
      };
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload
      };
    default:
      return state;
  }
};
```

### 4. Dispatch

```javascript
// Component dispatches action
function UserList() {
  const dispatch = useDispatch();
  
  const handleAdd = (user) => {
    dispatch(addUser(user)); // Triggers reducer → new state
  };
  
  return <button onClick={() => handleAdd({name: 'John'})}>Add</button>;
}
```

---

## Data Flow

```typescript
/*
1. User clicks button
2. Component dispatches action: dispatch({ type: 'ADD_USER', payload: {...} })
3. Store calls reducer with (currentState, action)
4. Reducer returns new state
5. Store updates state
6. Components subscribed to store re-render with new state
*/
```

---

## With Redux Toolkit (Modern)

```javascript
import { createSlice, configureStore } from '@reduxjs/toolkit';

const usersSlice = createSlice({
  name: 'users',
  initialState: { items: [], loading: false },
  reducers: {
    addUser: (state, action) => {
      state.items.push(action.payload);
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    }
  }
});

const store = configureStore({
  reducer: { users: usersSlice.reducer }
});

export const { addUser, setLoading } = usersSlice.actions;
```

---

## Summary

1. **Store**: Single source of truth
2. **Actions**: Describe what happened
3. **Reducers**: Calculate new state
4. **Dispatch**: Trigger action → reducer → new state
5. **Unidirectional**: One-way data flow

---

## References

- [Redux Docs](https://redux.js.org/)
- [Redux Toolkit](https://redux-toolkit.js.org/)