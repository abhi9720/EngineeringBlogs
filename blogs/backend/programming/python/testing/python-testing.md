---
title: "Python Testing: unittest, pytest, Mocking, and Beyond"
description: "Master Python testing: pytest, unittest, fixtures, mocking, property-based testing, integration testing, and test infrastructure"
date: "2026-05-14"
author: "Abhishek Tiwari"
tags:
  - python
  - testing
  - pytest
  - unittest
  - mocking
  - tdd
coverImage: "/images/python-testing.png"
draft: false
---

# Python Testing: unittest, pytest, Mocking, and Beyond

## Overview

You deployed a one-line change to a Python backend. It brought down production. The change was simple -- a `str` where an `int` was expected in a helper function used by six services. No tests caught it because there were no tests.

Testing is not optional in backend engineering. It is the safety net that lets you refactor, upgrade libraries, and deploy on Friday without checking your phone. This guide covers the testing patterns that matter for Python backend services: what to test, how to test, and which tools to use.

## Mental Model: The Test Pyramid

```mermaid
graph TD
    subgraph "Test Pyramid"
        T1["E2E Tests (5%)
        Full system, slow, expensive"]
        T2["Integration Tests (15%)
        Service + DB + external APIs
        Test that components work together"]
        T3["Unit Tests (80%)
        Fast, isolated, no I/O
        Test business logic"]
    end
    
    subgraph "Python Tools"
        P1["pytest + Selenium/Playwright
        docker-compose, Testcontainers"]
        P2["pytest + pytest-docker
        httpx, test databases"]
        P3["pytest + unittest.mock
        pytest-mock, hypothesis"]
    end

    T3 --> P3
    T2 --> P2
    T1 --> P1

    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff

    class T1 green
    class T2 blue
    class T3 pink
    class P1,P2,P3 yellow
```

**Key insight**: Most of your tests should be fast, isolated unit tests. Integration tests confirm components work together. E2E tests verify the critical paths.

## pytest vs unittest

### unittest (Built-in)

```python
import unittest
from typing import Any

def validate_email(email: str) -> bool:
    return "@" in email and "." in email

class TestEmailValidation(unittest.TestCase):
    def setUp(self) -> None:
        # Runs before each test
        self.valid_emails = ["a@b.com", "user@example.org"]

    def test_valid_emails(self) -> None:
        for email in self.valid_emails:
            with self.subTest(email=email):
                self.assertTrue(validate_email(email))

    def test_invalid_emails(self) -> None:
        self.assertFalse(validate_email("notanemail"))
        self.assertFalse(validate_email(""))

    def tearDown(self) -> None:
        # Runs after each test
        pass

if __name__ == "__main__":
    unittest.main()
```

### pytest (Third-party, Dominant in Industry)

```python
# test_email.py -- no class needed
import pytest
from typing import Any

def validate_email(email: str) -> bool:
    return "@" in email and "." in email

def test_valid_email() -> None:
    assert validate_email("a@b.com")

def test_invalid_email() -> None:
    assert not validate_email("")

# Parameterized tests
@pytest.mark.parametrize("email,expected", [
    ("a@b.com", True),
    ("", False),
    ("user@example.org", True),
    ("notanemail", False),
])
def test_email_param(email: str, expected: bool) -> None:
    assert validate_email(email) == expected
```

**Why pytest dominates**:
- Less boilerplate (no classes, no `self.assert*`)
- Powerful fixtures (no `setUp`/`tearDown`)
- Better assertion introspection (`assert` shows values)
- Plugin ecosystem (pytest-cov, pytest-mock, pytest-asyncio)
- Automatic test discovery

## Fixtures and conftest.py

### Basic Fixtures

```python
import pytest
from typing import Iterator, Any
import tempfile
import os

@pytest.fixture
def temp_file() -> Iterator[str]:
    """Create a temporary file for testing."""
    path = tempfile.mktemp()
    yield path
    os.remove(path)

@pytest.fixture(scope="session")
def database_url() -> str:
    """Shared across all tests in the session."""
    return "postgresql://test:test@localhost:5432/testdb"

@pytest.fixture(scope="module")
def api_client() -> Iterator[Any]:
    """Shared within a module, created once."""
    import httpx
    client = httpx.AsyncClient(base_url="http://localhost:8000")
    yield client
    # Cleanup after all tests in module
    import asyncio
    asyncio.run(client.aclose())

def test_file_creation(temp_file: str) -> None:
    with open(temp_file, "w") as f:
        f.write("test data")
    assert os.path.exists(temp_file)
```

**Scope matters**:
- `function` (default): Created per test
- `class`: Created per class
- `module`: Created per module
- `session`: Created once per test run

### conftest.py: Shared Fixtures

```python
# tests/conftest.py
import pytest
from typing import AsyncIterator, Any
import asyncio
from myapp.database import Database

@pytest.fixture(scope="session")
def event_loop() -> Iterator[asyncio.AbstractEventLoop]:
    """Override default event loop for session scope."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture
async def db() -> AsyncIterator[Database]:
    """Test database with transaction rollback."""
    database = Database("postgresql://test:test@localhost:5432/testdb")
    await database.connect()
    async with database.transaction():
        yield database
        await database.rollback()
    await database.disconnect()

@pytest.fixture
def sample_user() -> dict:
    return {"id": "1", "name": "Alice", "email": "alice@example.com"}
```

```python
# tests/test_users.py -- automatically uses conftest fixtures
import pytest
from typing import Any

async def test_create_user(db: Any, sample_user: dict) -> None:
    result = await db.create_user(sample_user)
    assert result["id"] == sample_user["id"]
    assert result["name"] == sample_user["name"]

async def test_get_user(db: Any, sample_user: dict) -> None:
    await db.create_user(sample_user)
    user = await db.get_user(sample_user["id"])
    assert user is not None
    assert user["email"] == sample_user["email"]
```

## Mocking

### Why Mock

```python
import pytest
from unittest.mock import AsyncMock, Mock, patch
from typing import Any
import httpx

# Service that calls an external API
class WeatherService:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def get_temperature(self, city: str) -> float:
        response = self._client.get(f"https://api.weather.com/v1/{city}")
        data = response.json()
        return data["temperature"]

# Test WITHOUT mocking (slow, flaky, requires network)
# def test_get_temperature():
#     service = WeatherService(httpx.Client())
#     temp = service.get_temperature("London")
#     assert isinstance(temp, float)  # Fails if API is down!

# Test WITH mocking (fast, deterministic)
def test_get_temperature() -> None:
    mock_client = Mock(spec=httpx.Client)
    mock_response = Mock()
    mock_response.json.return_value = {"temperature": 22.5}
    mock_client.get.return_value = mock_response

    service = WeatherService(mock_client)
    temp = service.get_temperature("London")

    assert temp == 22.5
    mock_client.get.assert_called_once_with("https://api.weather.com/v1/London")
```

### pytest-mock

```python
# pip install pytest-mock
def test_with_mocker(mocker: Any) -> None:
    # mocker is a pytest fixture wrapping unittest.mock
    mock_get = mocker.patch("httpx.Client.get")
    mock_get.return_value.json.return_value = {"temperature": 22.5}

    client = httpx.Client()
    response = client.get("https://api.example.com")
    assert response.json()["temperature"] == 22.5

# Async mocking
@pytest.mark.asyncio
async def test_async_mock(mocker: Any) -> None:
    mock_get = mocker.patch("httpx.AsyncClient.get", new_callable=AsyncMock)
    mock_response = AsyncMock()
    mock_response.json.return_value = {"status": "ok"}
    mock_get.return_value = mock_response

    async with httpx.AsyncClient() as client:
        response = await client.get("https://api.example.com")
        data = response.json()
        assert data["status"] == "ok"
```

### When to Mock vs When Not To

```python
# MOCK: External services, APIs, message queues
# DO NOT MOCK: Your own business logic, database (use test DB instead)

# Good mock target:
class EmailService:
    def send_welcome(self, email: str) -> bool:
        # Calls SendGrid API
        return self._client.post("/send", json={"to": email, "template": "welcome"})

# Bad mock target (test the logic directly):
class OrderTotalCalculator:
    def calculate(self, items: list[dict]) -> float:
        return sum(item["price"] * item["quantity"] for item in items)

# Test directly -- no mocking needed!
def test_calculate_total() -> None:
    calc = OrderTotalCalculator()
    items = [{"price": 10.0, "quantity": 2}, {"price": 5.0, "quantity": 1}]
    assert calc.calculate(items) == 25.0
```

## Async Testing

```python
import pytest
from typing import AsyncIterator
import httpx

# Service
class UserFetcher:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def get_user(self, user_id: str) -> dict:
        resp = await self._client.get(f"https://api.example.com/users/{user_id}")
        resp.raise_for_status()
        return resp.json()

# Test
@pytest.mark.asyncio
async def test_get_user(mocker: Any) -> None:
    mock_get = mocker.patch("httpx.AsyncClient.get", new_callable=AsyncMock)
    mock_get.return_value.json.return_value = {"id": "1", "name": "Alice"}

    async with httpx.AsyncClient() as client:
        fetcher = UserFetcher(client)
        user = await fetcher.get_user("1")

    assert user["name"] == "Alice"

# Testing async context managers
@pytest.mark.asyncio
async def test_async_context_manager() -> None:
    class ManagedResource:
        async def __aenter__(self) -> str:
            return "resource"

        async def __aexit__(self, *args: Any) -> None:
            pass

    async with ManagedResource() as resource:
        assert resource == "resource"
```

## Property-Based Testing with Hypothesis

```python
# pip install hypothesis
from hypothesis import given, strategies as st, assume
from typing import Any

def sort_numbers(items: list[int]) -> list[int]:
    """A buggy sort (for demonstration)."""
    if not items:
        return items
    for i in range(len(items) - 1):
        if items[i] > items[i + 1]:
            items[i], items[i + 1] = items[i + 1], items[i]
    return items  # Bug: doesn't sort fully

# Property-based test: for ANY list of ints...
@given(st.lists(st.integers()))
def test_sort_properties(items: list[int]) -> None:
    sorted_items = sort_numbers(list(items))  # Copy

    # Property 1: Length preserved
    assert len(sorted_items) == len(items)

    # Property 2: Same elements
    assert sorted(sorted_items) == sorted(items)

    # Property 3: Non-decreasing
    for i in range(len(sorted_items) - 1):
        assert sorted_items[i] <= sorted_items[i + 1]

# Example strategies
@given(
    st.emails(),
    st.text(min_size=1, max_size=100),
    st.integers(min_value=18, max_value=120),
)
def test_user_creation(email: str, name: str, age: int) -> None:
    # Hypothesis generates 100 random valid inputs
    # It finds edge cases you wouldn't think of
    user = create_user(email=email, name=name, age=age)
    assert user.email == email
    assert user.age >= 18

# Custom strategies
from hypothesis.strategies import composite

@composite
def valid_address(draw: Any) -> dict:
    return {
        "street": draw(st.text(min_size=1)),
        "city": draw(st.text(min_size=1)),
        "zip": draw(st.from_regex(r"\d{5}", fullmatch=True)),
    }

@given(valid_address())
def test_address_validation(address: dict) -> None:
    assert validate_address(address) is True
```

## Integration Testing

### Testcontainers

```python
# pip install testcontainers[postgresql]
import pytest
from testcontainers.postgres import PostgresContainer
from typing import Iterator, Any
import asyncpg

@pytest.fixture(scope="module")
def postgres_container() -> Iterator[PostgresContainer]:
    with PostgresContainer("postgres:16-alpine") as postgres:
        yield postgres

@pytest.fixture
async def db_pool(postgres_container: PostgresContainer) -> AsyncIterator[asyncpg.Pool]:
    pool = await asyncpg.create_pool(
        postgres_container.get_connection_url(),
        min_size=1,
        max_size=5,
    )
    yield pool
    await pool.close()

@pytest.mark.asyncio
async def test_database_insert(db_pool: asyncpg.Pool) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT)")
        result = await conn.fetchval(
            "INSERT INTO users (name) VALUES ($1) RETURNING id",
            "Alice",
        )
        assert result == 1

        row = await conn.fetchrow("SELECT * FROM users WHERE id = $1", result)
        assert row["name"] == "Alice"
```

### FastAPI Test Client

```python
import pytest
from httpx import AsyncClient, ASGITransport
from typing import AsyncIterator, Any
from myapp.main import app  # Your FastAPI app
from myapp.database import get_db

# Test database
class TestDatabase:
    async def fetch_all(self, query: str) -> list[dict]:
        return [{"id": 1, "name": "Alice"}]

    async def execute(self, query: str, *args: Any) -> None:
        pass

@pytest.fixture
def test_db() -> TestDatabase:
    return TestDatabase()

@pytest.fixture
async def client(test_db: TestDatabase) -> AsyncIterator[AsyncClient]:
    # Override dependency
    app.dependency_overrides[get_db] = lambda: test_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()

@pytest.mark.asyncio
async def test_get_users(client: AsyncClient) -> None:
    response = await client.get("/users")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alice"

@pytest.mark.asyncio
async def test_create_user(client: AsyncClient) -> None:
    response = await client.post("/users", json={"name": "Bob"})
    assert response.status_code == 201
```

## Test Organization

```python
# Recommended structure:
# tests/
#   conftest.py          # Shared fixtures
#   test_models.py       # Unit tests for data models
#   test_services.py     # Unit tests for business logic
#   test_api.py          # Integration tests for API endpoints
#   integration/
#     test_database.py   # Tests requiring real DB
#     test_external_api.py  # Tests using testcontainers
#   e2e/
#     test_workflow.py   # Full system tests

# tests/test_services.py
import pytest
from datetime import datetime, timedelta
from myapp.services import OrderService
from myapp.models import Order, OrderStatus

class TestOrderService:
    @pytest.fixture
    def service(self) -> OrderService:
        return OrderService()

    def test_create_order(self, service: OrderService) -> None:
        order = service.create_order(user_id="1", items=["item_1"], total=29.99)
        assert order.status == OrderStatus.PENDING
        assert order.total == 29.99

    def test_cancel_pending_order(self, service: OrderService) -> None:
        order = service.create_order(user_id="1", items=[], total=0)
        result = service.cancel_order(order.id)
        assert result.status == OrderStatus.CANCELLED

    def test_cancel_shipped_order_fails(self, service: OrderService) -> None:
        order = service.create_order(user_id="1", items=[], total=0)
        order.status = OrderStatus.SHIPPED
        with pytest.raises(ValueError, match="Cannot cancel shipped order"):
            service.cancel_order(order.id)
```

## Coverage

```python
# .coveragerc
[run]
source = myapp
omit = */tests/*,*/migrations/*

[report]
exclude_lines =
    pragma: no cover
    def __repr__
    raise NotImplementedError
    if __name__ == .__main__.:
```

```bash
# Run with coverage
pytest --cov=myapp --cov-report=term-missing --cov-report=html

# Output:
# Name                     Stmts   Miss  Cover   Missing
# ------------------------------------------------------
# myapp/models.py            45      2    96%   32, 45
# myapp/services.py         120      8    93%   67-74
# myapp/api.py               89     15    83%   12, 23, 45-50
# ------------------------------------------------------
# TOTAL                     254     25    90%
```

**Coverage targets**:
- Unit tests: > 90%
- Integration tests: > 70% (focus on critical paths)
- Overall: > 85%

**Warning**: Coverage is a floor, not a ceiling. 100% coverage with bad tests is worse than 80% with good tests.

## CI Integration

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          pip install -e ".[dev]"
          pip install pytest pytest-cov pytest-asyncio

      - name: Run tests
        run: |
          pytest --cov=myapp --cov-report=xml --cov-report=term-missing -v

      - name: Upload coverage
        uses: codecov/codecov-action@v4
```

## Flaky Tests

```python
# Common causes and fixes:

# 1. Timing-dependent tests
@pytest.mark.asyncio
async def test_eventual_consistency() -> None:
    # BAD: assumes operation completes instantly
    await publish_event("user.created")
    user = await get_user("1")
    assert user is not None  # May fail!

    # GOOD: retry with timeout
    import asyncio
    for _ in range(10):
        user = await get_user("1")
        if user is not None:
            break
        await asyncio.sleep(0.1)
    assert user is not None

# 2. Shared state between tests
@pytest.fixture(autouse=True)
def cleanup_database(db: Any) -> AsyncIterator[None]:
    yield
    await db.execute("DELETE FROM users")  # Reset after each test

# 3. Random data in assertions
from hypothesis import given, strategies as st

@given(st.integers(min_value=0, max_value=100))
def test_discount_calculation(amount: int) -> None:
    # If test fails, Hypothesis saves the failing input
    discount = calculate_discount(amount)
    assert 0 <= discount <= amount
```

## Best Practices

- **One assertion per test concept**: A test should verify one behavior, not everything
- **Arrange-Act-Assert**: Structure each test clearly
- **Test behavior, not implementation**: Tests should not break when you refactor
- **Use factories, not fixtures for data**: `factory_boy` or `model_bakery` for complex model creation
- **Prefer `pytest.raises` over `try/except` in tests**
- **Use `conftest.py` for shared fixtures, not shared test files**
- **Never use `time.sleep` in tests**: Use `await asyncio.sleep` or polling with timeout
- **Run tests in random order**: `pytest --random-order` catches state leakage

## Common Mistakes

- **Mocking what you don't own**: Mocking external APIs is fine. Mocking your own business logic makes tests useless.
- **Over-mocking**: If every test has 5 mocks, the tests are testing the mocks, not the code.
- **Testing implementation details**: Tests that check internal method calls make refactoring impossible.
- **Flaky test tolerance**: A flaky test that you ignore is worse than no test. It erodes trust in the suite.
- **No integration tests**: Unit tests alone cannot catch database or API contract issues.
- **Not testing error paths**: Happy-path-only tests miss the bugs that actually hit production.

## Interview Perspective

- **pytest vs unittest**: pytest is more concise, has better fixtures, better assertions, and a rich plugin ecosystem.
- **When to mock**: External APIs, message queues, file systems. Not your own business logic.
- **What are fixtures?** Reusable test components with scoped setup/teardown. Replace `setUp`/`tearDown`.
- **What is property-based testing?** Generate random inputs and verify invariants. Catches edge cases you didn't think of.
- **How do you test async code?** `pytest-asyncio` with `@pytest.mark.asyncio` and `AsyncMock`.
- **What is the test pyramid?** Unit (fast, many) → Integration (fewer, slower) → E2E (few, slow).
- **What makes a test good?** Fast, isolated, deterministic, tests behavior not implementation, readable.

## Summary

Testing Python backend services is not about hitting a coverage number. It is about building confidence that your code works correctly, even as it changes. Use pytest for its simplicity and ecosystem. Mock external dependencies but not your own logic. Write property-based tests to find edge cases. Use Testcontainers for real integration tests in CI.

The best test suite is one your team trusts. If tests fail, you know something is wrong. If tests pass, you deploy with confidence. That trust is hard to build and easy to lose -- protect it by writing meaningful, maintainable tests.

Happy Coding
