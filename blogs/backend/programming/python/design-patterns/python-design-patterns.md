---
title: "Python Design Patterns and Idioms"
description: "Essential design patterns in Python: creational, structural, behavioral patterns with Pythonic idioms and production examples"
date: "2026-05-14"
author: "Abhishek Tiwari"
tags:
  - python
  - design-patterns
  - architecture
  - idioms
coverImage: "/images/python-design-patterns.png"
draft: false
---

# Python Design Patterns and Idioms

## Overview

You have built a Python backend. It works. But every time you need to add a feature, you touch ten files. Every bug fix breaks something unrelated. The code is rigid, fragile, and immobile. You need design patterns -- not as rigid templates to copy, but as vocabulary for describing solutions to recurring architectural problems.

Design patterns in Python look different than in Java or C++. Python's first-class functions, dynamic typing, and metaprogramming capabilities make many GoF patterns trivial or unnecessary. This guide covers the patterns that matter in Python, with Pythonic implementations.

## Mental Model: Patterns Are a Shared Vocabulary

Patterns are not recipes you copy. They are names for common solutions. When a teammate says "we need a strategy pattern here," they mean "we should make this algorithm swappable." When they say "use a factory," they mean "delegate object creation to a function."

Python lets you implement most patterns in fewer lines than Java because:
- Functions are first-class objects (no need for function interfaces)
- Duck typing (no need for abstract classes in many cases)
- Metaclasses and decorators (implement patterns as language features)
- Dynamic nature (modify classes at runtime if needed)

## Creational Patterns

### Singleton

In Java, Singleton requires a private constructor and static method. In Python, there are simpler approaches.

**Module-level Singleton** (the Pythonic way):

```python
# config.py -- modules are singletons
DATABASE_URL = "postgres://localhost:5432/db"
REDIS_URL = "redis://localhost:6379"
API_KEY = "secret"

class Config:
    def __init__(self) -> None:
        self.database_url = DATABASE_URL
        self.redis_url = REDIS_URL
        self.api_key = API_KEY

config = Config()  # Import this anywhere, get the same instance
```

**Metaclass Singleton** (when you need a class):

```python
class SingletonMeta(type):
    _instances: dict[type, object] = {}

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Database(metaclass=SingletonMeta):
    def __init__(self) -> None:
        self.connection = self._connect()

    def _connect(self) -> str:
        return "Connected to database"

# Both variables point to the same instance
db1 = Database()
db2 = Database()
assert db1 is db2  # True
```

**What**: Ensures a class has only one instance.
**Why**: Shared state (config, connection pool, logging) should have a single point of access.
**When**: Database pools, configuration objects, caching layers.
**Tradeoff**: Singletons are global state. They make testing harder. Use dependency injection instead when possible.

### Factory

```python
from dataclasses import dataclass
from typing import Protocol

class NotificationService(Protocol):
    def send(self, message: str, recipient: str) -> bool: ...

@dataclass
class EmailService:
    smtp_host: str
    smtp_port: int

    def send(self, message: str, recipient: str) -> bool:
        print(f"Sending email to {recipient}: {message}")
        return True

@dataclass
class SMSService:
    api_key: str

    def send(self, message: str, recipient: str) -> bool:
        print(f"Sending SMS to {recipient}: {message}")
        return True

# Factory function -- idiomatic Python
def create_notification_service(kind: str, **kwargs: str) -> NotificationService:
    services = {
        "email": EmailService,
        "sms": SMSService,
    }
    service_cls = services.get(kind)
    if not service_cls:
        raise ValueError(f"Unknown notification service: {kind}")
    return service_cls(**kwargs)

# Usage
service = create_notification_service("email", smtp_host="smtp.example.com", smtp_port="587")
service.send("Hello!", "user@example.com")
```

**What**: Encapsulates object creation logic.
**Why**: Callers should not know concrete classes. Centralizes creation logic.
**When**: Creating objects based on configuration, environment, or dynamic conditions.
**Tradeoff**: Adds indirection. For simple cases, direct construction is clearer.

### Builder

```python
from dataclasses import dataclass, field
from typing import Self

@dataclass
class SQLQuery:
    table: str = ""
    columns: list[str] = field(default_factory=lambda: ["*"])
    where_clauses: list[str] = field(default_factory=list)
    order_by: str = ""
    limit: int | None = None
    offset: int | None = None

class QueryBuilder:
    def __init__(self) -> None:
        self._query = SQLQuery()

    def select(self, *columns: str) -> Self:
        self._query.columns = list(columns) if columns else ["*"]
        return self

    def from_table(self, table: str) -> Self:
        self._query.table = table
        return self

    def where(self, condition: str) -> Self:
        self._query.where_clauses.append(condition)
        return self

    def order(self, column: str) -> Self:
        self._query.order_by = column
        return self

    def with_limit(self, n: int) -> Self:
        self._query.limit = n
        return self

    def build(self) -> SQLQuery:
        return self._query

# Usage
query = (QueryBuilder()
         .select("id", "name", "email")
         .from_table("users")
         .where("active = true")
         .where("created_at > '2024-01-01'")
         .order("name")
         .with_limit(100)
         .build())
```

**What**: Separates object construction from its representation.
**Why**: When object creation involves many optional parameters, ordering, or validation.
**When**: Building complex queries, HTTP requests, configurations.
**Tradeoff**: More boilerplate than a simple constructor or `**kwargs`.

## Structural Patterns

### Adapter

```python
from typing import Protocol

# Target interface
class PaymentProcessor(Protocol):
    def charge(self, amount: float, currency: str) -> bool: ...

# Third-party library (incompatible interface)
class StripeAPI:
    def create_charge(self, amount_cents: int, currency_code: str) -> dict:
        print(f"Charging {amount_cents} cents in {currency_code}")
        return {"status": "success"}

# Adapter
class StripeAdapter:
    def __init__(self, api: StripeAPI) -> None:
        self._api = api

    def charge(self, amount: float, currency: str) -> bool:
        amount_cents = int(amount * 100)
        result = self._api.create_charge(amount_cents, currency)
        return result["status"] == "success"

# Usage
stripe = StripeAdapter(StripeAPI())
stripe.charge(49.99, "usd")
```

**What**: Lets incompatible interfaces work together.
**Why**: Integrate third-party code without changing your domain logic.
**When**: Wrapping external libraries, legacy systems, or APIs with different interfaces.

### Composite

```python
from dataclasses import dataclass
from collections.abc import Iterable

class MenuComponent:
    def render(self) -> str: ...

@dataclass
class MenuItem(MenuComponent):
    name: str
    url: str

    def render(self) -> str:
        return f'<li><a href="{self.url}">{self.name}</a></li>'

@dataclass
class MenuCategory(MenuComponent):
    name: str
    children: list[MenuComponent] = None  # type: ignore

    def __post_init__(self) -> None:
        self.children = self.children or []

    def add(self, component: MenuComponent) -> None:
        self.children.append(component)

    def render(self) -> str:
        items = "".join(child.render() for child in self.children)
        return f"<li>{self.name}<ul>{items}</ul></li>"

# Build a menu tree
menu = MenuCategory("Products")
menu.add(MenuItem("Widgets", "/widgets"))
menu.add(MenuItem("Gadgets", "/gadgets"))

category = MenuCategory("More")
category.add(MenuItem("About", "/about"))
category.add(MenuItem("Contact", "/contact"))
menu.add(category)

print(menu.render())
```

**What**: Composes objects into tree structures.
**Why**: Treat individual objects and compositions uniformly.
**When**: Tree structures (UI components, file systems, organizational charts).

## Behavioral Patterns

### Strategy

In Python, strategies are often just functions:

```python
from collections.abc import Callable
from typing import Protocol

# Strategy as a Protocol (type-safe)
class SerializationStrategy(Protocol):
    def serialize(self, data: dict) -> str: ...
    def deserialize(self, data: str) -> dict: ...

# Strategy implementations
class JSONSerializer:
    def serialize(self, data: dict) -> str:
        import json
        return json.dumps(data)

    def deserialize(self, data: str) -> dict:
        import json
        return json.loads(data)

class MsgPackSerializer:
    def serialize(self, data: dict) -> str:
        import msgpack
        return msgpack.packb(data)  # type: ignore

    def deserialize(self, data: str) -> dict:
        import msgpack
        return msgpack.unpackb(data)  # type: ignore

class ConfigurableCache:
    def __init__(self, serializer: SerializationStrategy) -> None:
        self._serializer = serializer
        self._store: dict[str, str] = {}

    def set(self, key: str, value: dict) -> None:
        self._store[key] = self._serializer.serialize(value)

    def get(self, key: str) -> dict | None:
        data = self._store.get(key)
        return self._serializer.deserialize(data) if data else None

# Or even simpler -- function-based strategy
CompressionStrategy = Callable[[bytes], bytes]

def gzip_compress(data: bytes) -> bytes:
    import gzip
    return gzip.compress(data)

def lz4_compress(data: bytes) -> bytes:
    import lz4.frame  # type: ignore
    return lz4.frame.compress(data)
```

**What**: Defines a family of algorithms and makes them interchangeable.
**Why**: Avoids conditional logic. Each algorithm is isolated and testable.
**When**: Different serialization formats, compression algorithms, authentication methods, pricing calculations.

### Observer

```python
from collections.abc import Callable
from dataclasses import dataclass, field

class EventEmitter:
    def __init__(self) -> None:
        self._listeners: dict[str, list[Callable]] = {}

    def on(self, event: str, listener: Callable) -> None:
        self._listeners.setdefault(event, []).append(listener)

    def off(self, event: str, listener: Callable) -> None:
        self._listeners[event].remove(listener)

    def emit(self, event: str, *args: Any, **kwargs: Any) -> None:  # type: ignore
        for listener in self._listeners.get(event, []):
            listener(*args, **kwargs)

# Usage
events = EventEmitter()

def on_user_created(user_id: str) -> None:
    print(f"Send welcome email to {user_id}")

def on_user_created_analytics(user_id: str) -> None:
    print(f"Log signup event for {user_id}")

events.on("user.created", on_user_created)
events.on("user.created", on_user_created_analytics)

# When user is created:
events.emit("user.created", "user_12345")
```

**What**: Defines a one-to-many dependency between objects.
**Why**: Decouple event producers from consumers. New handlers can be added without modifying producers.
**When**: Event-driven systems, webhook dispatchers, UI updates, audit logging.
**Tradeoff**: Hard to reason about execution order. Can cause memory leaks if listeners are not deregistered.

### Template Method

```python
from abc import ABC, abstractmethod

class DataImporter(ABC):
    def import_data(self, source: str) -> list[dict]:
        raw = self._fetch(source)
        parsed = self._parse(raw)
        validated = self._validate(parsed)
        return self._transform(validated)

    def _fetch(self, source: str) -> bytes:
        # Default implementation
        with open(source, "rb") as f:
            return f.read()

    @abstractmethod
    def _parse(self, data: bytes) -> list[dict]: ...

    def _validate(self, records: list[dict]) -> list[dict]:
        # Default: no validation
        return records

    @abstractmethod
    def _transform(self, records: list[dict]) -> list[dict]: ...

class CSVImporter(DataImporter):
    def _parse(self, data: bytes) -> list[dict]:
        import csv
        import io
        reader = csv.DictReader(io.StringIO(data.decode()))
        return list(reader)

    def _transform(self, records: list[dict]) -> list[dict]:
        return [{k.lower(): v for k, v in r.items()} for r in records]

class JSONImporter(DataImporter):
    def _parse(self, data: bytes) -> list[dict]:
        import json
        return json.loads(data)

    def _transform(self, records: list[dict]) -> list[dict]:
        return records  # Already structured
```

**What**: Defines the skeleton of an algorithm in a base class, letting subclasses override steps.
**Why**: Reuse the algorithm structure while allowing customization.
**When**: ETL pipelines, data importers, report generators.

### Chain of Responsibility

```python
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

@dataclass
class HTTPRequest:
    method: str
    path: str
    headers: dict[str, str]
    body: Any

Middleware = Callable[[HTTPRequest, Callable[[HTTPRequest], Any]], Any]

def logging_middleware(request: HTTPRequest, next: Callable) -> Any:
    print(f"{request.method} {request.path}")
    return next(request)

def auth_middleware(request: HTTPRequest, next: Callable) -> Any:
    if "Authorization" not in request.headers:
        return {"error": "Unauthorized"}, 401
    return next(request)

def cors_middleware(request: HTTPRequest, next: Callable) -> Any:
    response = next(request)
    if isinstance(response, tuple):
        data, status = response
        response = (data, status, {"Access-Control-Allow-Origin": "*"})
    return response

def compose_middleware(*middlewares: Middleware) -> Callable:
    def handler(request: HTTPRequest) -> Any:
        def chain(index: int) -> Callable[[HTTPRequest], Any]:
            if index == len(middlewares):
                return lambda req: {"message": "Not found"}, 404
            current = middlewares[index]
            def wrapped(req: HTTPRequest) -> Any:
                return current(req, chain(index + 1))
            return wrapped
        return chain(0)(request)
    return handler
```

**What**: Passes a request along a chain of handlers.
**Why**: Decouple request senders from receivers. Each handler can process or pass.
**When**: HTTP middleware, validation pipelines, logging/audit chains.

## Pythonic Idioms

### Context Managers for Resource Management

```python
from contextlib import contextmanager
from collections.abc import Iterator

@contextmanager
def database_transaction(conn):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
```

### Decorators for Cross-Cutting Concerns

```python
import functools
import time
from collections.abc import Callable
from typing import Any

def retry(max_attempts: int = 3, delay: float = 0.1) -> Callable:
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Exception | None = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        time.sleep(delay * (2 ** attempt))
            raise last_exception  # type: ignore
        return wrapper
    return decorator
```

### Generators for Lazy Evaluation

```python
from collections.abc import Iterator

def read_in_chunks(file_path: str, chunk_size: int = 8192) -> Iterator[bytes]:
    with open(file_path, "rb") as f:
        while chunk := f.read(chunk_size):
            yield chunk

# Process a 10GB file with constant memory
for chunk in read_in_chunks("large_file.bin"):
    process(chunk)
```

### Protocols for Structural Subtyping

```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class Serializable(Protocol):
    def to_dict(self) -> dict: ...

class User:
    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name}

class Order:
    def to_dict(self) -> dict:
        return {"id": self.id, "total": self.total}

def serialize(obj: Serializable) -> str:
    import json
    return json.dumps(obj.to_dict())

# Both classes satisfy the protocol without inheritance
serialize(User())
serialize(Order())
```

## Tradeoffs Summary

| Pattern | Benefit | Cost | Pythonic Alternative |
|---------|---------|------|---------------------|
| Singleton | Global state | Testing difficulty | Module-level instance, DI |
| Factory | Centralized creation | Indirection | Factory function |
| Builder | Flexible construction | Boilerplate | `dataclass` with defaults |
| Observer | Loose coupling | Hard to debug | Signals, callbacks |
| Strategy | Algorithm swapping | Additional types | Functions as strategies |
| Template Method | Code reuse | Rigid hierarchy | Composition + callbacks |

## Common Mistakes

- **Implementing patterns before you need them**: Patterns are solutions to problems. If you don't have the problem, the pattern is just complexity.
- **Over-abstracting**: A factory for a factory is not clever. It is a readability disaster.
- **Java-style patterns in Python**: `AbstractFactoryProviderFactory` is not Pythonic. Use factory functions.
- **Forgetting that Python has first-class functions**: Many patterns (Strategy, Command, Observer) are just functions.
- **Using metaclasses for patterns that decorators solve**: 90% of metaclass use cases are better served by decorators.

## Interview Perspective

- **Singleton**: How would you implement a singleton? (Module-level, metaclass, or `__new__`). What are the testing implications?
- **Factory vs Builder**: When would you use one over the other?
- **Strategy vs Template Method**: Strategy uses composition, Template Method uses inheritance. Which is more flexible?
- **Observer pattern in async code**: How would you implement an event system that works with asyncio?
- **Protocols vs ABCs**: When would you use `Protocol` vs `ABC`? (Duck typing vs explicit inheritance.)
- **Context managers**: What makes a context manager? `__enter__`/`__exit__`. When would you write one vs using `@contextmanager`?

## Summary

Design patterns in Python are not about copying GoF diagrams. They are about recognizing recurring problems and applying Pythonic solutions. Python's first-class functions, protocols, context managers, and decorators make many patterns simpler than their classic implementations.

The best "pattern" in Python is often no pattern at all -- just a well-designed function or a dataclass. Add patterns only when they remove complexity, not when they add it.

Happy Coding
