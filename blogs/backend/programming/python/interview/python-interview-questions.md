---
title: "Python Interview Questions and Answers"
description: "Curated Python interview questions covering core Python, concurrency, internals, design patterns, and backend development for senior roles"
date: "2026-05-14"
author: "Abhishek Tiwari"
tags:
  - python
  - interview
  - preparation
  - senior-engineer
coverImage: "/images/python-interview.png"
draft: false
---

# Python Interview Questions and Answers

## Overview

Senior Python interviews test more than syntax. They test whether you understand the tradeoffs behind every decision: why a feature exists, when to use it, and what problems it creates. This guide covers 20 questions that probe those tradeoffs, organized by topic.

## Core Python

### 1. Explain mutable vs immutable objects in Python. Why does it matter for backend services?

```python
# Mutable: list, dict, set, bytearray, custom objects
# Immutable: int, float, str, tuple, frozenset, bytes

def process_users(users: list[dict]) -> None:
    # WARNING: modifies the caller's list!
    for user in users:
        user["processed"] = True

# The problem:
user_list = [{"id": 1}, {"id": 2}]
process_users(user_list)
print(user_list)  # [{"id": 1, "processed": True}, {"id": 2, "processed": True}]

# Safe: return a new list
def process_users_safe(users: list[dict]) -> list[dict]:
    return [{**u, "processed": True} for u in users]
```

**Why it matters**: Mutable default arguments are a common bug:

```python
def add_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items

add_item("a")  # ["a"]
add_item("b")  # ["a", "b"] -- SAME list!
```

**Production implication**: In backend services, state mutation across request handlers causes data corruption. Always treat function arguments as read-only unless mutation is the explicit purpose.

### 2. How do decorators work? Write a decorator that measures execution time and logs it.

```python
import functools
import time
import logging
from collections.abc import Callable
from typing import Any, ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")
logger = logging.getLogger(__name__)

def timed(log_level: int = logging.INFO) -> Callable[[Callable[P, T]], Callable[P, T]]:
    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            start = time.perf_counter()
            try:
                return func(*args, **kwargs)
            finally:
                elapsed = time.perf_counter() - start
                logger.log(log_level, "%s took %.3fs", func.__qualname__, elapsed)
        return wrapper
    return decorator

@timed(log_level=logging.WARNING)
def slow_query(user_id: str) -> list[dict]:
    time.sleep(0.5)
    return [{"id": user_id}]
```

**Why it matters**: Decorators are the primary mechanism for cross-cutting concerns (metrics, tracing, caching, auth) in Python backend code.

### 3. What is a generator? When would you use one in a backend service?

```python
from collections.abc import Iterator

def paginate(query, page_size: int = 100) -> Iterator[list[dict]]:
    offset = 0
    while True:
        page = query.offset(offset).limit(page_size).all()
        if not page:
            break
        yield [row._asdict() for row in page]
        offset += page_size

# Process 10 million records with constant memory
for page in paginate(User.query, page_size=1000):
    process_batch(page)
```

**Why it matters**: Generators enable streaming processing of large datasets without loading everything into memory. Essential for ETL pipelines, CSV processing, and database migrations.

### 4. Explain `*args` and `**kwargs`. When should you use them in production?

```python
from typing import Any

def log_event(event: str, **kwargs: Any) -> None:
    """Log an event with structured metadata."""
    import json
    payload = {"event": event, **kwargs}
    print(json.dumps(payload))

log_event("user.login", user_id="123", ip="192.168.1.1", method="oauth")

# Use for:
# 1. Wrapping/delegating calls
def retry(max_attempts: int = 3, **kwargs: Any):
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs_inner: Any) -> Any:
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs_inner)
                except Exception:
                    if attempt == max_attempts - 1:
                        raise
                    time.sleep(2 ** attempt)
            return None
        return wrapper
    return decorator

# Don't use for:
# - Functions with well-known parameters (be explicit)
```

### 5. What is a closure? How does it relate to decorators?

```python
from collections.abc import Callable

def make_counter(initial: int = 0) -> Callable[[], int]:
    count = [initial]  # Must be mutable for nonlocal in Python < 3

    def counter() -> int:
        count[0] += 1
        return count[0]

    return counter

counter_a = make_counter(10)
counter_b = make_counter(100)

print(counter_a())  # 11
print(counter_a())  # 12
print(counter_b())  # 101
```

A closure is a function that captures variables from its enclosing scope. Decorators use closures to wrap functions with pre/post processing.

**Production note**: Closures in loops capture by reference, not value:

```python
funcs = [lambda: i for i in range(10)]
print([f() for f in funcs])  # [9, 9, 9, ...] -- all 9!
# Fix: default argument binding
funcs = [lambda i=i: i for i in range(10)]
```

## Concurrency

### 6. What is the GIL? Why does it exist? How does it affect threading vs multiprocessing?

See full explanation in [Python Internals](#). Key points for interview:

- The GIL is a mutex that prevents multiple threads from executing Python bytecode simultaneously
- It exists because CPython's memory management (reference counting) is not thread-safe
- Without it, every `Py_INCREF`/`Py_DECREF` would need atomic operations, slowing single-threaded code
- **Threading is fine for I/O-bound** work (GIL released during I/O)
- **Threading is useless for CPU-bound** work (GIL contention)
- **Multiprocessing bypasses the GIL** by running separate interpreters

### 7. When would you use asyncio vs threading in a backend service?

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

# USE ASYNCIO WHEN:
# 1. All your libraries support async (httpx, asyncpg, aioredis)
# 2. You need high concurrency (1000+ connections)
# 3. You want to avoid thread overhead

async def async_handler():
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://api.example.com/data")
        return resp.json()

# USE THREADING WHEN:
# 1. Your libraries are sync-only (boto3, psycopg2 sync, requests)
# 2. You have a mix of sync and async code
# 3. Simple background tasks with predictable overhead

def blocking_handler():
    import requests
    resp = requests.get("https://api.example.com/data")
    return resp.json()

# WRONG: blocking call in async endpoint
@app.get("/data")
async def get_data():
    import requests
    resp = requests.get("https://api.example.com/data")
    return resp.json()

# RIGHT: run in executor
@app.get("/data")
async def get_data():
    loop = asyncio.get_running_loop()
    resp = await loop.run_in_executor(None, lambda: requests.get("https://api.example.com/data"))
    return resp.json()
```

### 8. What is a race condition? How does Python's GIL affect race conditions?

The GIL does NOT prevent race conditions. It only ensures one thread executes bytecode at a time, but threads can be interrupted between bytecode instructions:

```python
counter = 0

def increment(n: int) -> None:
    global counter
    for _ in range(n):
        # This single line compiles to:
        # LOAD_GLOBAL counter
        # LOAD_CONST 1
        # BINARY_OP +
        # STORE_GLOBAL counter
        # Thread switch can happen between these!
        counter += 1

# Use threading.Lock for atomicity:
from threading import Lock
lock = Lock()
counter = 0

def safe_increment(n: int) -> None:
    global counter
    for _ in range(n):
        with lock:
            counter += 1
```

## Internals

### 9. How does Python manage memory? Explain reference counting and garbage collection.

Reference counting is the primary mechanism. Each `PyObject` has `ob_refcnt`. When it reaches 0, memory is freed immediately. The GC handles cycles:

```python
import gc

# GC generations
# Gen 0: young objects, collected frequently
# Gen 1: survivors from gen 0
# Gen 2: long-lived objects

# Thresholds
thresholds = gc.get_threshold()
print(thresholds)  # (700, 10, 10)
# Gen 0 collected after 700 allocations since last collection
# Gen 1 collected after 10 gen 0 collections
# Gen 2 collected after 10 gen 1 collections

# Manual triggers
gc.collect(0)  # Collect generation 0
gc.collect()   # Full collection (all generations)
```

### 10. What is `__slots__`? When would you use it?

```python
class User:
    __slots__ = ("id", "name", "email")

    def __init__(self, id: str, name: str, email: str) -> None:
        self.id = id
        self.name = name
        self.email = email

# Benefits:
# 1. ~50% less memory (no __dict__ per instance)
# 2. ~30% faster attribute access (descriptor, not dict lookup)

# Tradeoffs:
# 1. Can't add new attributes dynamically
# 2. Can't be pickled by default
# 3. Inheritance is tricky (child class must define __slots__ too)

# USE CASE: Creating millions of objects in memory-intensive apps
users = [User(str(i), f"User {i}", f"user{i}@example.com") for i in range(1_000_000)]
```

## Data Structures

### 11. What is the difference between a list and a tuple?

| Aspect | List | Tuple |
|--------|------|-------|
| Mutability | Mutable | Immutable |
| Memory | Overallocated (33% extra) | Exact size |
| Creation | `LIST_APPEND` + resize | `BUILD_TUPLE` |
| Hashable | No | Yes (if elements are) |
| Usage | Homogeneous collections | Fixed-structure records |
| Performance | Slower iteration (bounds check) | Faster iteration |

```python
import sys

print(sys.getsizeof([1, 2, 3]))       # 88 bytes (overallocated)
print(sys.getsizeof((1, 2, 3)))      # 56 bytes (exact)

# Tuple as dict key (because hashable):
cache: dict[tuple[str, int], list[dict]] = {}
cache[("user", 42)] = [{"id": 42}]

# List for homogeneous data:
user_ids = [1, 2, 3, 4, 5]
```

### 12. How does Python's dict work internally?

Python dicts use open addressing with quadratic probing:

```python
# Simplified dict insertion
def dict_insert(d: dict, key: str, value: int) -> None:
    hash_val = hash(key)  # Built-in hash
    mask = len(d._table) - 1  # Power of 2 size
    index = hash_val & mask

    while d._table[index] is not None:  # Probing
        if d._table[index][0] == key:
            d._table[index] = (key, value)
            return
        index = (index * 5 + 1) & mask  # PERTURB shift (simplified)

    d._table[index] = (key, value)
    d._size += 1

    if d._size > d._threshold:  # ~66% load factor
        _resize(d, len(d._table) * 2)

# Key properties:
# - Average O(1) lookup, insertion, deletion
# - Memory overhead: ~50-70% empty slots
# - Python 3.7+: insertion order preserved (compact dict)
# - Key sharing: instances of same class share key struct
```

### 13. How is a set different from a dict?

A set is a dict with only keys (value is always `None`). Same hash table implementation, same probing strategy.

```python
s = {1, 2, 3, 4, 5}
# Internally: {1: None, 2: None, 3: None, 4: None, 5: None}

# Use set for membership tests, not lists:
valid_statuses = {"active", "pending", "completed"}
if status in valid_statuses:  # O(1)
    process(status)

# Use frozenset when you need a hashable set:
cache_key = frozenset(["user", "admin", "active"])
```

## OOP

### 14. Explain MRO (Method Resolution Order) in Python. How does C3 linearization work?

```python
class A:
    def method(self) -> str:
        return "A"

class B(A):
    def method(self) -> str:
        return "B"

class C(A):
    def method(self) -> str:
        return "C"

class D(B, C):
    pass

print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)

# C3 linearization rule:
# L[D] = D + merge(L[B], L[C], [B, C])
# L[B] = B + merge(L[A], [A]) = B, A, object
# L[C] = C + merge(L[A], [A]) = C, A, object
# merge: take head of first list that's not in tail of any list
# Result: D, B, C, A, object

D().method()  # "B" (B comes before C in MRO)

# Diamond problem resolution:
class E(D):
    pass

print(E().method())  # "B"
```

**Why it matters**: Multiple inheritance with frameworks (Django class-based views, mixins) depends on correct MRO. Understanding `super()` resolution prevents bugs.

### 15. What is the difference between `@staticmethod` and `@classmethod`?

```python
class Database:
    _instances: dict[str, "Database"] = {}

    def __init__(self, url: str) -> None:
        self.url = url

    @classmethod
    def from_config(cls, config: dict[str, str]) -> "Database":
        """Factory method. Receives the class as first arg."""
        return cls(config["DATABASE_URL"])

    @classmethod
    def get_instance(cls, url: str) -> "Database":
        """Singleton accessor. Uses class-level cache."""
        if url not in cls._instances:
            cls._instances[url] = cls(url)
        return cls._instances[url]

    @staticmethod
    def validate_url(url: str) -> bool:
        """No access to class or instance. Just a function in the class namespace."""
        return url.startswith("postgres://") or url.startswith("mysql://")
```

## Backend

### 16. What is the difference between WSGI and ASGI? When would you use each?

```python
# WSGI (Web Server Gateway Interface)
# Sync-only. One request per thread/process.
# Frameworks: Django (traditional), Flask
# Servers: Gunicorn, uWSGI

def wsgi_app(environ: dict, start_response: Callable) -> list[bytes]:
    status = "200 OK"
    headers = [("Content-Type", "text/plain")]
    start_response(status, headers)
    return [b"Hello, World!"]

# ASGI (Asynchronous Server Gateway Interface)
# Async-first. Supports WebSockets, HTTP/2, long-polling.
# Frameworks: FastAPI, Django Channels
# Servers: Uvicorn, Daphne

async def asgi_app(scope: dict, receive: Callable, send: Callable) -> None:
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [(b"content-type", b"text/plain")],
    })
    await send({
        "type": "http.response.body",
        "body": b"Hello, World!",
    })
```

**When**: Use WSGI for simple CRUD apps with sync ORMs. Use ASGI for high-concurrency, real-time, or streaming applications.

### 17. FastAPI vs Django: When would you choose each?

| Criteria | FastAPI | Django |
|----------|---------|--------|
| Performance | Async-native, very fast | Sync by default, async available |
| Learning curve | Low | Medium |
| ORM | None (bring your own) | Built-in, mature |
| Admin panel | None | Built-in |
| API docs | Automatic (OpenAPI) | Manual (DRF) |
| Project size | Microservices, APIs | Monoliths, full-stack |
| Community | Growing | Massive |

**Choose FastAPI** when: Building JSON APIs, microservices, async-heavy systems, real-time features.

**Choose Django** when: Building monolithic apps, admin-heavy systems, rapid prototyping with batteries included.

## Performance

### 18. How would you profile and optimize a slow endpoint?

```python
# 1. Profile with cProfile
import cProfile
import pstats

profiler = cProfile.Profile()
profiler.enable()
result = slow_endpoint()  # Your code
profiler.disable()

stats = pstats.Stats(profiler)
stats.sort_stats("cumtime")
stats.print_stats(20)

# 2. Line-by-line with line_profiler
# @profile decorator (requires: pip install line_profiler)
@profile
def slow_function(n: int) -> list[int]:
    result = []
    for i in range(n):
        result.append(i ** 2)
    return result

# 3. Memory profiling
# pip install memory_profiler
@profile
def memory_heavy():
    data = [{"id": i, "name": f"User {i}"} for i in range(100_000)]
    return data

# 4. Production profiling with py-spy (no code change)
# py-spy record -o profile.svg --pid 12345
# py-spy top --pid 12345
```

**Optimization order**:
1. Algorithmic: Is there a faster algorithm? (O(n²) → O(n log n))
2. Data structures: Right data structure? (list vs set for membership)
3. I/O: Can we batch, cache, or parallelize?
4. Python: Use local variables, avoid attribute lookups
5. C extensions: Cython, NumPy, Numba for hot paths

### 19. What are some common Python performance optimizations?

```python
# 1. Use local variables
# SLOW
def slow(items: list[int]) -> int:
    total = 0
    for i in items:
        total += i * 2
    return total

# FAST
def fast(items: list[int]) -> int:
    total = 0
    append = total.__add__  # Actually, direct += is fastest
    for i in items:
        total += i * 2
    return total

# 2. List comprehension vs for loop
squares = [x ** 2 for x in range(1000)]  # Faster than manual loop

# 3. Use built-in functions (C speed)
from functools import reduce
import operator

product = reduce(operator.mul, range(1, 11))  # Faster than manual loop

# 4. String join
# SLOW
s = ""
for part in parts:
    s += part  # O(n²)

# FAST
s = "".join(parts)  # O(n)

# 5. Use dict/set for membership
# SLOW
if x in [1, 2, 3, 4, 5]:  # O(n)

# FAST
if x in {1, 2, 3, 4, 5}:  # O(1)

# 6. Avoid dot lookups in loops
# SLOW
for i in range(1000):
    result.append(math.sqrt(i))

# FAST
sqrt = math.sqrt
for i in range(1000):
    result.append(sqrt(i))
```

### 20. What is `__slots__` and how does it improve performance?

(This was covered in question 10, but from a different angle.)

```python
# Memory comparison
import sys

class UserWithDict:
    def __init__(self, name: str) -> None:
        self.name = name

class UserWithSlots:
    __slots__ = ("name",)
    def __init__(self, name: str) -> None:
        self.name = name

users_dict = [UserWithDict(f"user_{i}") for i in range(100_000)]
users_slots = [UserWithSlots(f"user_{i}") for i in range(100_000)]

print(sys.getsizeof(users_dict[0]))   # ~56 bytes (object) + 176 bytes (dict)
print(sys.getsizeof(users_slots[0]))  # ~56 bytes (no dict)

# ~4x memory savings for 100k objects
```

## Best Practices

- Never use mutable default arguments
- Use type hints for all function signatures
- Prefer `pathlib` over `os.path` for file operations
- Use `is` for `None` comparisons, `==` for value comparisons
- Always use context managers (`with` statement) for resources
- Prefer `f""` strings over `%` or `.format()`
- Use `enum` for fixed sets of constants
- Use `dataclasses` for data containers

## Common Mistakes

- **Using `is` for value comparison**: `a == b` vs `a is b` (identity vs equality)
- **Ignoring the GIL**: Using threads for CPU work expecting speedup
- **Not using `__slots__`** when creating millions of objects
- **Catching bare exceptions**: `except:` catches `KeyboardInterrupt`, `SystemExit`
- **Modifying a dict while iterating**: Use `list(d.items())` for a snapshot
- **Forgetting that `or` and `and` are short-circuit**: Order matters in conditions

## Summary

These 20 questions cover the essential Python knowledge for senior backend interviews. The difference between a junior and senior answer is not just knowing the answer -- it is explaining the tradeoffs, production implications, and alternatives. Always connect technical concepts to real backend scenarios: data pipelines, API services, memory-constrained environments, and high-concurrency systems.

Happy Coding
