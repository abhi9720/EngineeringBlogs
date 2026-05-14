---
title: "FastAPI Basics"
description: "Master FastAPI framework: path operations, Pydantic models, dependency injection, async support, WebSocket, and building high-performance Python APIs"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - python
  - fastapi
  - pydantic
  - async
coverImage: "/images/fastapi-basics.png"
draft: false
---

## Overview

FastAPI is a modern, fast web framework for building APIs with Python 3.7+ based on standard Python type hints. It provides automatic API documentation, request validation, serialization, and async support.

## Setup

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(
    title="My API",
    description="Production-ready API with FastAPI",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
```

## Path Operations

### Basic Endpoints

```python
from fastapi import FastAPI, HTTPException, status
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

@app.get("/api/users", response_model=List[User])
async def list_users(
    skip: int = 0,
    limit: int = 10,
    role: Optional[str] = None
):
    query = users_collection.find()
    if role:
        query = query.filter({"role": role})
    return await query.skip(skip).limit(limit).to_list()

@app.post("/api/users", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_user(user: UserCreate):
    existing = await users_collection.find_one({"email": user.email})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    new_user = await users_collection.insert_one(user.dict())
    return await users_collection.find_one({"_id": new_user.inserted_id})

@app.get("/api/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    user = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.put("/api/users/{user_id}", response_model=User)
async def update_user(user_id: str, user: UserUpdate):
    result = await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": user.dict(exclude_unset=True)}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return await users_collection.find_one({"_id": ObjectId(user_id)})

@app.delete("/api/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: str):
    result = await users_collection.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
```

## Pydantic Models

```python
from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional, List
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"
    MODERATOR = "moderator"


class UserBase(BaseModel):
    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    role: UserRole = UserRole.USER


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=100)

    @validator('password')
    def validate_password(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain uppercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain digit')
        return v


class UserUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=50)
    last_name: Optional[str] = Field(None, min_length=1, max_length=50)
    role: Optional[UserRole] = None


class User(UserBase):
    id: str
    is_active: bool = True
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        orm_mode = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
```

## Dependency Injection

### Dependencies

```python
from fastapi import Depends, HTTPException, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional


# Simple dependency
async def get_db():
    db = await database.connect()
    try:
        yield db
    finally:
        await database.disconnect()


# Authentication dependency
security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user = await users_collection.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


# Permission dependency
async def require_admin(user: User = Depends(get_current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# Using dependencies
@app.get("/api/users/me", response_model=User)
async def get_my_profile(user: User = Depends(get_current_user)):
    return user


@app.get("/api/admin/dashboard")
async def admin_dashboard(admin: User = Depends(require_admin)):
    return {"message": "Admin dashboard data"}
```

### Dependency with Parameters

```python
from fastapi import Query


async def pagination(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc", regex="^(asc|desc)$")
) -> dict:
    return {
        "skip": skip,
        "limit": limit,
        "sort": [(sort_by, -1 if sort_order == "desc" else 1)]
    }


@app.get("/api/items")
async def list_items(
    pagination: dict = Depends(pagination),
    db: Database = Depends(get_db)
):
    items = await db.items.find()
    items.sort(pagination["sort"])
    items.skip(pagination["skip"]).limit(pagination["limit"])
    return await items.to_list()
```

## Error Handling

```python
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exception_handlers import http_exception_handler


class AppException(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message}
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )
```

## WebSocket

```python
from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except WebSocketDisconnect:
                self.disconnect(connection)


manager = ConnectionManager()


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(f"Room {room_id}: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
```

## Testing

```python
from fastapi.testclient import TestClient
import pytest
from main import app


client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_create_user():
    response = client.post("/api/users", json={
        "email": "test@example.com",
        "password": "TestPass123",
        "first_name": "Test",
        "last_name": "User"
    })
    assert response.status_code == 201
    assert response.json()["email"] == "test@example.com"


def test_duplicate_email():
    client.post("/api/users", json={
        "email": "dup@example.com",
        "password": "TestPass123",
        "first_name": "Test",
        "last_name": "User"
    })
    response = client.post("/api/users", json={
        "email": "dup@example.com",
        "password": "TestPass123",
        "first_name": "Test",
        "last_name": "User"
    })
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


def test_unauthorized_access():
    response = client.get("/api/users/me")
    assert response.status_code == 401
```

## Background Tasks

```python
from fastapi import BackgroundTasks


def send_welcome_email(email: str, user_id: str):
    import time
    time.sleep(2)
    print(f"Welcome email sent to {email}")


@app.post("/api/users", status_code=201)
async def create_user(user: UserCreate, background_tasks: BackgroundTasks):
    new_user = await create_user_in_db(user)
    background_tasks.add_task(
        send_welcome_email, user.email, str(new_user.id)
    )
    return new_user
```

## Best Practices

1. **Use type hints** for automatic validation and documentation
2. **Organize routes with APIRouter** for modular applications
3. **Use dependency injection** for shared logic (auth, DB, pagination)
4. **Define Pydantic schemas** in separate files
5. **Implement proper error handling** with custom exceptions
6. **Use async for I/O bound operations**, sync for CPU-bound
7. **Leverage background tasks** for non-critical operations

## Common Mistakes

### Mistake 1: Blocking Event Loop

```python
# Wrong: Blocking call blocks entire server
@app.get("/api/process")
async def process_data():
    result = some_cpu_intensive_function()  # Blocks event loop
    return {"result": result}
```

```python
# Correct: Use thread pool for CPU-bound work
from concurrent.futures import ThreadPoolExecutor
import asyncio

executor = ThreadPoolExecutor(max_workers=4)

@app.get("/api/process")
async def process_data():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, some_cpu_intensive_function)
    return {"result": result}
```

### Mistake 2: Incorrect Response Model

```python
# Wrong: Returns sensitive data
@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return user  # Returns password hash, internal IDs, etc.
```

```python
# Correct: Use response model
@app.get("/api/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str):
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return user
```

## Summary

FastAPI provides automatic validation, serialization, and documentation through Python type hints. Its dependency injection system makes code modular and testable. Use Pydantic models for request/response schemas, async endpoints for I/O operations, and proper error handling for robustness.

## References

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Pydantic Documentation](https://docs.pydantic.dev/)
- [FastAPI Dependency Injection](https://fastapi.tiangolo.com/tutorial/dependencies/)
- [FastAPI Async Support](https://fastapi.tiangolo.com/async/)

Happy Coding