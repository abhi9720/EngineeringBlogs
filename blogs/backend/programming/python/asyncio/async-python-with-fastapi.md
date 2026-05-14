---
title: "Async Python with FastAPI"
description: "Master asynchronous programming in Python with FastAPI: async/await, coroutines, event loops, async database drivers, and building high-concurrency APIs"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - python
  - fastapi
  - async
  - performance
coverImage: "/images/async-python-with-fastapi.png"
draft: false
---

## Overview

Python's async/await syntax enables concurrent code using coroutines. FastAPI leverages this to handle thousands of concurrent connections with minimal resource usage. This guide covers async Python patterns, event loops, async database access, and practical patterns for FastAPI.

## Python Async Fundamentals

Python's `async`/`await` syntax enables cooperative multitasking. A coroutine (`async def`) is a function that can suspend its execution via `await`, yielding control back to the event loop. When the awaited operation completes, the coroutine resumes from where it paused. This model enables thousands of concurrent I/O operations within a single OS thread, each suspended while waiting for IO and resumed when data arrives.

### Coroutines and Await

```python
import asyncio
from typing import AsyncGenerator


async def fetch_data(url: str) -> dict:
    print(f"Fetching {url}")
    await asyncio.sleep(1)  # Simulate I/O
    return {"url": url, "data": "response"}


async def main():
    # Sequential execution
    result1 = await fetch_data("/api/users")
    result2 = await fetch_data("/api/orders")
    print(result1, result2)


# Concurrent execution
async def main_concurrent():
    task1 = asyncio.create_task(fetch_data("/api/users"))
    task2 = asyncio.create_task(fetch_data("/api/orders"))
    results = await asyncio.gather(task1, task2)
    print(results)


asyncio.run(main_concurrent())
```

The key difference between sequential and concurrent execution: sequential `await` calls run one after another (each blocking until completion), while `asyncio.create_task()` schedules coroutines for concurrent execution and `asyncio.gather()` collects all results. The concurrent version completes in the time of the slowest operation, not the sum of all operations. This is the fundamental performance advantage of async I/O.

### Async Generators

```python
import asyncio
from typing import AsyncGenerator


async def stream_data() -> AsyncGenerator[int, None]:
    for i in range(10):
        await asyncio.sleep(0.1)
        yield i


async def process_stream():
    async for item in stream_data():
        print(f"Processing: {item}")


# FastAPI streaming endpoint
from fastapi.responses import StreamingResponse


@app.get('/api/stream')
async def stream_endpoint():
    async def generate():
        for i in range(100):
            await asyncio.sleep(0.01)
            yield f"data: {i}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

Async generators (`async for`) enable streaming data without loading everything into memory. FastAPI's `StreamingResponse` leverages this for Server-Sent Events (SSE) and large file streaming. The generator yields values as they become available, and the response sends each chunk to the client incrementally. This pattern is essential for real-time data feeds, progress updates, and large dataset streaming.

## Async Database Access

### Databases Library

```python
from databases import Database
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, select

DATABASE_URL = "postgresql+asyncpg://user:pass@localhost/db"
database = Database(DATABASE_URL)

metadata = MetaData()
users = Table(
    'users', metadata,
    Column('id', Integer, primary_key=True),
    Column('email', String(255)),
    Column('name', String(255))
)


async def get_user(user_id: int) -> dict:
    query = users.select().where(users.c.id == user_id)
    return await database.fetch_one(query)


async def create_user(email: str, name: str) -> dict:
    query = users.insert().values(email=email, name=name)
    user_id = await database.execute(query)
    return {"id": user_id, "email": email, "name": name}


# FastAPI integration
@app.on_event("startup")
async def startup():
    await database.connect()


@app.on_event("shutdown")
async def shutdown():
    await database.disconnect()


@app.get("/api/users/{user_id}")
async def get_user_endpoint(user_id: int):
    user = await get_user(user_id)
    if not user:
        raise HTTPException(status_code=404)
    return user
```

Async database access requires drivers that support the async protocol. The `databases` library provides a lightweight async wrapper around SQL queries using `asyncpg` for PostgreSQL. The `database.execute()` and `database.fetch_one()` methods are awaitable, yielding control to the event loop while the database processes the query. FastAPI's startup/shutdown events manage the connection lifecycle.

### SQLAlchemy Async

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

DATABASE_URL = "postgresql+asyncpg://user:pass@localhost/db"
engine = create_async_engine(DATABASE_URL, echo=True)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_users_async(skip: int = 0, limit: int = 10) -> list[User]:
    async with async_session() as session:
        stmt = select(User).offset(skip).limit(limit)
        result = await session.execute(stmt)
        return result.scalars().all()


async def create_user_async(user_data: dict) -> User:
    async with async_session() as session:
        user = User(**user_data)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user
```

SQLAlchemy's async support (since version 1.4) uses `create_async_engine` and `AsyncSession`. The `async with` statement manages session lifecycle — the session is acquired, used, and automatically closed via the context manager. This pattern is similar to synchronous SQLAlchemy but uses `await session.execute()` instead of `session.execute().fetchall()`. The `async_sessionmaker` factory creates new `AsyncSession` instances per request.

### Redis Async

```python
import aioredis
from typing import Optional


class CacheService:
    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None

    async def init(self):
        self.redis = await aioredis.from_url(
            "redis://localhost:6379",
            encoding="utf-8",
            decode_responses=True
        )

    async def close(self):
        if self.redis:
            await self.redis.close()

    async def get(self, key: str) -> Optional[str]:
        return await self.redis.get(key)

    async def set(self, key: str, value: str, ttl: int = 300):
        await self.redis.set(key, value, ex=ttl)

    async def invalidate(self, pattern: str):
        keys = await self.redis.keys(pattern)
        if keys:
            await self.redis.delete(*keys)


# FastAPI integration
cache = CacheService()


@app.on_event("startup")
async def startup():
    await cache.init()


@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    cached = await cache.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)

    user = await get_user_from_db(user_id)
    await cache.set(f"user:{user_id}", json.dumps(user.dict()), ttl=300)
    return user
```

Async Redis via `aioredis` follows the same connection lifecycle pattern. The cache service is initialized at startup and closed at shutdown. Async cache lookups with `await cache.get()` enable non-blocking caching — the event loop processes other requests while waiting for Redis. The `invalidate` method with `keys` pattern supports cache invalidation by prefix, a common pattern for clearing related cache entries.

## HTTP Client

```python
import httpx
from typing import List, Optional


class ExternalAPIClient:
    def __init__(self, base_url: str):
        self.client = httpx.AsyncClient(base_url=base_url, timeout=30.0)

    async def close(self):
        await self.client.aclose()

    async def get_user(self, user_id: str) -> dict:
        response = await self.client.get(f"/users/{user_id}")
        response.raise_for_status()
        return response.json()

    async def get_users_batch(self, user_ids: List[str]) -> List[dict]:
        async with httpx.AsyncClient() as client:
            tasks = [client.get(f"/users/{uid}") for uid in user_ids]
            responses = await asyncio.gather(*tasks, return_exceptions=True)

            results = []
            for response in responses:
                if isinstance(response, Exception):
                    continue
                results.append(response.json())
            return results


# Using the client
client = ExternalAPIClient("https://api.example.com")


@app.get("/api/external/users")
async def get_external_users():
    users = await client.get_users_batch(["1", "2", "3"])
    return users


@app.on_event("shutdown")
async def shutdown():
    await client.close()
```

`httpx.AsyncClient` provides a fully async HTTP client. The `asyncio.gather(*tasks)` pattern sends multiple HTTP requests concurrently, reducing the total time to the slowest response rather than the sum. The `return_exceptions=True` parameter prevents one failing request from cancelling others — useful when individual failures should be handled gracefully rather than failing the entire batch request.

## Background Tasks

```python
from fastapi import BackgroundTasks
from typing import Callable


class BackgroundTaskManager:
    def __init__(self):
        self.tasks: List[asyncio.Task] = []

    async def run_background(self, coro):
        task = asyncio.create_task(coro)
        self.tasks.append(task)
        task.add_done_callback(lambda t: self.tasks.remove(t))

    async def shutdown(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)


manager = BackgroundTaskManager()


@app.post("/api/process")
async def process_data(data: dict):
    await manager.run_background(heavy_processing(data))
    return {"status": "processing started"}


async def heavy_processing(data: dict):
    await asyncio.sleep(5)
    print(f"Processed: {data}")
```

Background tasks run after the response is sent, making them ideal for non-critical operations like log processing, analytics events, or email sending. FastAPI's `BackgroundTasks` type is injection-friendly and managed by the framework. More complex background processing (with cancellation, error handling, and monitoring) benefits from a dedicated task manager that tracks running `asyncio.Task` objects for graceful shutdown.

## Concurrency Patterns

### Async Context Manager

```python
from contextlib import asynccontextmanager
from typing import AsyncIterator


@asynccontextmanager
async def database_transaction():
    transaction = await database.start_transaction()
    try:
        yield transaction
        await transaction.commit()
    except Exception:
        await transaction.rollback()
        raise


@app.post("/api/orders")
async def create_order(order_data: OrderCreate):
    async with database_transaction():
        order = await create_order_in_db(order_data)
        await update_inventory(order.items)
        return order
```

Async context managers (created with `@asynccontextmanager`) wrap resource setup and teardown. The `database_transaction` context manager starts a transaction on enter, commits on success, and rolls back on exception. Using `async with database_transaction()` in FastAPI ensures database transactions are properly scoped and cleaned up, even when exceptions occur.

### Rate Limiting with Async

```python
import time
from collections import defaultdict
from typing import Dict, List


class AsyncRateLimiter:
    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)

    async def check_rate_limit(self, key: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds

        requests = self.requests[key]
        requests[:] = [t for t in requests if t > window_start]

        if len(requests) >= self.max_requests:
            return False

        requests.append(now)
        return True


rate_limiter = AsyncRateLimiter()


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host
    allowed = await rate_limiter.check_rate_limit(client_ip)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests"}
        )
    return await call_next(request)
```

The async rate limiter demonstrates that not everything needs database-backed storage. This in-memory implementation uses a dictionary of timestamps per client, pruning expired entries on each check. While adequate for single-process deployments, production systems typically use Redis-based rate limiting to share state across multiple server instances.

## Testing Async Code

```python
import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_create_user(client: AsyncClient):
    response = await client.post("/api/users", json={
        "email": "test@example.com",
        "name": "Test User"
    })
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_concurrent_requests(client: AsyncClient):
    async def make_request():
        return await client.get("/api/users")

    tasks = [make_request() for _ in range(10)]
    responses = await asyncio.gather(*tasks)
    assert all(r.status_code == 200 for r in responses)
```

## Best Practices

1. **Use async for I/O-bound operations** (database, HTTP, file I/O)
2. **Use thread pool for CPU-bound operations** (image processing, computation)
3. **Always await coroutines** - never forget the await keyword
4. **Use asyncio.gather for concurrent tasks** instead of sequential awaits
5. **Implement proper timeout handling** for all async operations
6. **Always handle task cancellation** in background tasks
7. **Use async context managers** for resource management

## Common Mistakes

### Mistake 1: Forgetting to Await

```python
# Wrong: Missing await
@app.get("/api/users")
async def get_users():
    result = fetch_users()  # Returns coroutine, not result
    return result
```

```python
# Correct: Use await
@app.get("/api/users")
async def get_users():
    result = await fetch_users()
    return result
```

### Mistake 2: Blocking the Event Loop

```python
# Wrong: CPU-bound work blocks event loop
@app.get("/api/process")
async def process():
    result = heavy_computation()  # Blocks all concurrent requests
    return result
```

```python
# Correct: Run in thread pool
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)

@app.get("/api/process")
async def process():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, heavy_computation)
    return result
```

## Summary

Python's async/await enables efficient concurrent I/O in FastAPI applications. Use async database drivers (asyncpg, databases, SQLAlchemy async), async HTTP clients (httpx), and proper concurrency patterns. Avoid blocking the event loop with CPU-intensive work, always await coroutines, and use asyncio.gather for concurrent operations.

## References

- [Python asyncio Documentation](https://docs.python.org/3/library/asyncio.html)
- [FastAPI Async](https://fastapi.tiangolo.com/async/)
- [SQLAlchemy Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [httpx Async Client](https://www.python-httpx.org/async/)

Happy Coding