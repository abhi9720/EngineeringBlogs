---
title: "Pydantic Validation Deep Dive"
description: "Deep dive into Pydantic: model validation, field types, validators, custom types, model configuration, serialization, and performance optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - python
  - pydantic
  - validation
  - data-modeling
coverImage: "/images/pydantic-validation-deep-dive.png"
draft: false
---

## Overview

Pydantic is the most widely used data validation library for Python. It provides runtime type checking, data parsing, serialization, and schema generation. FastAPI uses Pydantic extensively for request/response validation and OpenAPI schema generation.

## Basic Model

Pydantic models are defined by inheriting from `BaseModel` and declaring fields with type annotations. Each field undergoes validation and type coercion during initialization. Field constraints are specified via `Field()` — `Field(..., min_length=3)` means required (`...`) with a minimum length of 3. Custom validators are defined with the `@validator` decorator and run after type coercion. Multiple validators for the same field can be chained with the `each_item` or `pre` options.

```python
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Optional, List
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    ADMIN = "admin"
    USER = "user"
    MODERATOR = "moderator"


class User(BaseModel):
    id: int
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50, regex="^[a-zA-Z0-9_]+$")
    full_name: Optional[str] = None
    role: UserRole = UserRole.USER
    age: int = Field(18, ge=0, le=150)
    tags: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @validator('username')
    def username_alphanumeric(cls, v):
        if not v.isalnum():
            raise ValueError('Username must be alphanumeric')
        return v.lower()

    @validator('email')
    def email_unique(cls, v):
        if v in existing_emails:
            raise ValueError('Email already registered')
        return v


# Usage
user = User(
    id=1,
    email="john@example.com",
    username="john_doe",
    age=25
)
print(user.json())
print(user.dict())
```

## Field Types and Constraints

Pydantic supports a rich set of field types that go beyond basic Python types. The standard library types (`str`, `int`, `float`, `Decimal`, `UUID`, `date`, etc.) are handled natively, along with collections (`List`, `Set`, `Dict`, `Tuple`) and network types (`IPv4Address`, `IPv6Address`). Each type has specific validation rules — `EmailStr` checks email format, `UUID` validates UUID format, and `Decimal` enforces precision constraints.

### Standard Types

```python
from pydantic import BaseModel, Field
from typing import Optional, List, Set, Dict, Tuple
from decimal import Decimal
from uuid import UUID, uuid4
from datetime import date, time, timedelta
from ipaddress import IPv4Address, IPv6Address


class ComplexModel(BaseModel):
    # Numeric types
    price: Decimal = Field(..., max_digits=10, decimal_places=2)
    quantity: int = Field(..., ge=0)
    rating: float = Field(0.0, ge=0.0, le=5.0)

    # String types
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(None, max_length=1000)

    # Collections
    tags: List[str] = []
    unique_tags: Set[str] = set()
    metadata: Dict[str, str] = {}
    coordinates: Tuple[float, float]

    # Identifiers
    id: UUID = Field(default_factory=uuid4)
    slug: str = Field(..., regex="^[a-z0-9-]+$")

    # Date/Time
    event_date: date
    event_time: time
    duration: timedelta
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Network types
    ip_address: IPv4Address
    server_ip: Optional[IPv6Address] = None
```

Field constraints are specified through `Field()` arguments. `min_length`/`max_length` constrain string lengths, `ge`/`le` constrain numeric values, `regex` validates string patterns, and `max_digits`/`decimal_places` control decimal precision. `default_factory` enables dynamic defaults (like `uuid4` or `datetime.utcnow`). Using these declarative constraints reduces the need for custom validators on common patterns.

### Custom Validators

```python
from pydantic import BaseModel, validator, root_validator
from typing import List, Optional


class OrderCreate(BaseModel):
    product_ids: List[int]
    quantities: List[int]
    coupon_code: Optional[str]
    shipping_address: str

    @validator('product_ids')
    def product_ids_not_empty(cls, v):
        if not v:
            raise ValueError('At least one product required')
        return v

    @validator('quantities')
    def quantities_match_products(cls, v, values):
        if 'product_ids' in values and len(v) != len(values['product_ids']):
            raise ValueError('quantities must match product_ids length')
        return v

    @validator('coupon_code')
    def validate_coupon(cls, v):
        if v and not v.startswith('SAVE'):
            raise ValueError('Invalid coupon format')
        return v

    @root_validator
    def validate_order(cls, values):
        if values.get('coupon_code'):
            total = sum(values.get('quantities', []))
            if total < 5:
                raise ValueError('Coupon requires minimum 5 items')
        return values
```

Pydantic validators can access other field values through the `values` parameter (note the spelling — it's `values`, not `values`). The `quantities_match_products` validator uses `values['product_ids']` to cross-validate. The `@root_validator` operates on all fields at once, enabling cross-field validation like "coupon requires minimum 5 items". `root_validator` returns the full `values` dict, optionally modified.

### Pre and Post Validators

```python
from pydantic import BaseModel, validator


class SanitizedModel(BaseModel):
    name: str
    email: str
    description: str

    @validator('name', pre=True)
    def strip_name(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v

    @validator('email')
    def normalize_email(cls, v):
        return v.lower().strip()

    @validator('description')
    def sanitize_html(cls, v):
        import html
        return html.escape(v)

    @validator('*', pre=True)
    def trim_strings(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v
```

Validators have an execution order controlled by the `pre` parameter. Pre-validators (`pre=True`) run before type coercion — useful for data cleaning like stripping whitespace or normalizing formats. Post-validators (the default) run after type coercion and validation, operating on already-converted values. The `*` wildcard in `@validator('*', pre=True)` applies a validator to all fields, enabling cross-cutting transformations like trimming all strings.

## Model Configuration

```python
from pydantic import BaseModel, Field
from typing import Optional


class ConfigurableModel(BaseModel):
    name: str = Field(..., alias="user_name")
    email: str
    password: str

    class Config:
        # Allow population by field name or alias
        allow_population_by_field_name = True

        # Extra fields behavior
        extra = "forbid"  # "ignore" or "allow"

        # Immutable after creation
        frozen = True

        # Use enum values instead of names
        use_enum_values = True

        # Validate default values
        validate_default = True

        # Error message customization
        error_msg_templates = {
            'value_error.missing': 'Field {field} is required',
            'value_error.any_str.min_length': 'Field {field} is too short',
        }

        # ORM mode (enables reading from ORM objects)
        orm_mode = True

        # Allow arbitrary types
        arbitrary_types_allowed = False

        # Keep undefined types
        undefined_types = False


# ORM mode usage
class UserORM(BaseModel):
    id: int
    name: str
    email: str

    class Config:
        orm_mode = True


# SQLAlchemy model
class UserTable(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    name = Column(String)
    email = Column(String)

# Convert ORM to Pydantic
user_orm = session.query(UserTable).first()
user_pydantic = UserORM.from_orm(user_orm)
```

The `Config` class controls model behavior. `allow_population_by_field_name = True` enables populating via either field name or alias. `extra = "forbid"` rejects unknown fields (safe default). `frozen = True` makes the model immutable and hashable. `orm_mode = True` enables `.from_orm()` for populating from ORM objects. `use_enum_values = True` serializes enum members as their values instead of names. Configuration choices significantly affect API behavior and should be set consciously.

## Generic Models

```python
from typing import Generic, TypeVar, List, Optional
from pydantic import BaseModel, Field
from pydantic.generics import GenericModel

T = TypeVar('T')


class PaginatedResponse(GenericModel, Generic[T]):
    items: List[T]
    total: int
    page: int = Field(1, ge=1)
    page_size: int = Field(10, ge=1, le=100)
    total_pages: int = 0

    @validator('total_pages', always=True)
    def compute_total_pages(cls, v, values):
        total = values.get('total', 0)
        page_size = values.get('page_size', 10)
        return (total + page_size - 1) // page_size


class UserResponse(BaseModel):
    id: int
    email: str
    name: str


# Usage
response = PaginatedResponse[UserResponse](
    items=[UserResponse(id=1, email="a@b.com", name="A")],
    total=1,
    page=1,
    page_size=10
)
```

Generic models enable reusable, type-safe wrappers. `PaginatedResponse[T]` wraps any type `T` in a pagination envelope with `total`, `page`, `page_size`, and `total_pages` fields. The `total_pages` field is computed automatically via a validator with `always=True` — it runs even if the field isn't explicitly provided. This pattern eliminates repetitive pagination boilerplate while maintaining full type safety.

## Custom Types

```python
from pydantic import BaseModel
from typing import Any, Callable, Optional
import re


class PhoneNumber(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v: Any) -> str:
        if isinstance(v, str):
            v = re.sub(r'[\s\-\(\)]', '', v)
            if not re.match(r'^\+?1?\d{10,15}$', v):
                raise ValueError('Invalid phone number')
            return v
        raise TypeError('String required')


class PostalCode(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v: Any) -> str:
        if isinstance(v, str):
            v = v.upper().strip()
            if not re.match(r'^[A-Z0-9]{3}\s?[A-Z0-9]{3}$', v):
                raise ValueError('Invalid postal code')
            return v
        raise TypeError('String required')


class ModelWithCustomTypes(BaseModel):
    phone: PhoneNumber
    postal_code: PostalCode = None


# Usage
m = ModelWithCustomTypes(phone="+1 (555) 123-4567")
print(m.phone)  # "+15551234567"
```

Custom types extend Pydantic with domain-specific validation. A custom type is a class that implements `__get_validators__` returning a generator of validator functions. The `PhoneNumber` type validates and normalizes phone numbers — stripping formatting characters and validating the digit pattern. Custom types encapsulate validation logic in reusable components, keeping model definitions clean and enforcing consistent validation across the application.

## Performance Optimization

```python
from pydantic import BaseModel
from typing import List
import time


# Performance tips:

# 1. Use __slots__ for immutable models
class OptimizedModel(BaseModel):
    __slots__ = ('name', 'email', 'age')

    name: str
    email: str
    age: int

    class Config:
        frozen = True  # Enables hashing, better performance


# 2. Use model_validate for dicts
# Fast: dict -> model (single validation)
data = {"name": "John", "email": "john@example.com", "age": 30}
user = User.model_validate(data)

# Slower: Creating model with **data (per-field validation)
user = User(**data)


# 3. Batch validation
class BatchProcessor:
    def process_batch(self, items: List[dict]) -> List[User]:
        # Validate all at once
        return [User.model_validate(item) for item in items]


# 4. Avoid field aliases in performance-critical paths
# Aliases add lookup overhead


# 5. Use model_dump(mode='json') instead of .json()
# .json() calls .dict() then json.dumps()
# model_dump(mode='json') does it in one pass
```

Performance optimization in Pydantic follows a few key principles. `model_validate(data)` is faster than `Model(**data)` because it skips the per-field validation loop when given a dict that matches the model structure. `model_dump(mode='json')` is faster than `.json()` because it serializes in a single pass rather than calling `.dict()` then `json.dumps()`. Setting `frozen=True` enables hashing and cache-friendly behavior. Avoid field aliases in hot paths as they add dict key lookup overhead.

## Testing

```python
import pytest
from pydantic import ValidationError


def test_valid_user():
    user = User(id=1, email="test@test.com", username="testuser")
    assert user.email == "test@test.com"
    assert user.role == UserRole.USER


def test_invalid_email():
    with pytest.raises(ValidationError) as exc_info:
        User(id=1, email="invalid", username="testuser")
    errors = exc_info.value.errors()
    assert any(e['type'] == 'value_error.email' for e in errors)


def test_missing_required_field():
    with pytest.raises(ValidationError):
        User(id=1)  # Missing email and username


def test_custom_validator():
    with pytest.raises(ValidationError, match="Username must be alphanumeric"):
        User(id=1, email="test@test.com", username="invalid username!")


def test_field_constraints():
    with pytest.raises(ValidationError):
        User(id=1, email="test@test.com", username="ab", age=200)
```

## Best Practices

1. **Use Field() for constraints** - min_length, max_length, regex, ge, le
2. **Use custom validators** for business logic validation
3. **Use root_validator** for cross-field validation
4. **Use GenericModel** for reusable response wrappers
5. **Set frozen=True** for immutable, hashable models
6. **Use orm_mode=True** when reading from ORM objects
7. **Use model_validate** for better performance with dicts

## Common Mistakes

### Mistake 1: Not Handling Validation Errors

```python
# Wrong: Catching generic Exception
@app.post("/api/users")
async def create_user(user_data: dict):
    try:
        user = User(**user_data)
    except Exception as e:
        return {"error": str(e)}  # Catches too much
```

```python
# Correct: Handle ValidationError specifically
from pydantic import ValidationError

@app.post("/api/users")
async def create_user(user_data: dict):
    try:
        user = User(**user_data)
    except ValidationError as e:
        return {"errors": e.errors()}
```

### Mistake 2: Mutating Validated Data

```python
# Wrong: Modifying model directly
user = User(id=1, email="test@test.com", username="test")
user.email = "new@test.com"  # Bypasses validation
```

```python
# Correct: Use model_copy with update
updated = user.model_copy(update={"email": "new@test.com"})

# Or create new model
new_user = User(id=user.id, email="new@test.com", username=user.username)
```

## Summary

Pydantic provides robust data validation with type hints, custom validators, and model configuration. Use Field() for constraints, validators for business logic, and GenericModel for reusable patterns. Configure frozen=True for immutability and orm_mode=True for ORM integration. Always handle ValidationError specifically in your API endpoints.

## References

- [Pydantic Documentation](https://docs.pydantic.dev/)
- [Pydantic Field Types](https://docs.pydantic.dev/latest/concepts/fields/)
- [Pydantic Validators](https://docs.pydantic.dev/latest/concepts/validators/)
- [Pydantic Model Config](https://docs.pydantic.dev/latest/api/config/)

Happy Coding