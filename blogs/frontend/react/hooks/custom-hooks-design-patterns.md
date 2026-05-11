---
title: "Custom Hooks Design Patterns"
description: "Creating reusable custom hooks - patterns for extracting logic and state from components."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - react
  - hooks
  - custom hooks
  - frontend
coverImage: "/images/frontend/react/custom-hooks.png"
draft: false
---

# Custom Hooks Design Patterns: The Complete Guide

## Overview

Custom hooks let you extract component logic into reusable functions. This guide covers patterns for creating effective custom hooks.

---

## Basic Custom Hook

### Extracting Logic

```jsx
// Before: Logic in component
function SearchComponent() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (query) {
      setLoading(true);
      fetch(`/api/search?q=${query}`)
        .then(r => r.json())
        .then(setResults)
        .finally(() => setLoading(false));
    }
  }, [query]);
  
  return { query, setQuery, results, loading };
}

// After: Custom hook
function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    
    setLoading(true);
    fetch(`/api/search?q=${query}`)
      .then(r => r.json())
      .then(setResults)
      .finally(() => setLoading(false));
  }, [query]);
  
  return { query, setQuery, results, loading };
}

function SearchComponent() {
  const { query, setQuery, results, loading } = useSearch();
  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}
```

---

## Hook with Storage Persistence

```jsx
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });
  
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('LocalStorage error:', error);
    }
  }, [key, value]);
  
  return [value, setValue];
}

// Usage
function App() {
  const [theme, setTheme] = useLocalStorage('theme', 'dark');
  return <div className={theme}>Content</div>;
}
```

---

## Hook with Event Listeners

```jsx
function useEventListener(event, handler) {
  useEffect(() => {
    window.addEventListener(event, handler);
    return () => window.removeEventListener(event, handler);
  }, [event, handler]);
}

// Usage
function WindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  
  useEventListener('resize', () => {
    setSize({ width: window.innerWidth, height: window.innerHeight });
  });
  
  return <div>{size.width}x{size.height}</div>;
}
```

---

## Hook Patterns

### Conditional Hooks

```jsx
// Only run hook conditionally when needed
function useDeviceInfo() {
  const [info, setInfo] = useState(null);
  
  useEffect(() => {
    setInfo({
      isMobile: window.innerWidth < 768,
      isTablet: window.innerWidth >= 768 && window.innerWidth < 1024,
      isDesktop: window.innerWidth >= 1024
    });
  }, []);
  
  return info;
}

function Component() {
  const info = useDeviceInfo(); // Always called - conditionally inside
  if (!info) return null;
  
  return <div>{info.isMobile ? 'Mobile' : 'Desktop'}</div>;
}
```

### Composable Hooks

```jsx
// Compose multiple hooks
function useSearchAndFilter(baseUrl) {
  const search = useSearch();
  const filter = useFilter();
  
  const results = useMemo(() => {
    return search.results.filter(filter.predicate);
  }, [search.results, filter.predicate]);
  
  return { ...search, ...filter, results };
}
```

---

## Summary

1. **Extract repeated logic**: Create hooks from component code
2. **Name with use prefix**: Always start with "use"
3. **Return consistent shape**: Object or array
4. **Handle cleanup**: Return cleanup function from useEffect
5. **Compose hooks**: Combine multiple hooks for complex logic

---

## References

- [React Docs - Custom Hooks](https://react.dev/learn/reusing-logic-with-hooks)