title: Redis Caching in Spring Boot
description: Learn how to integrate Redis caching with Spring Boot for high-performance applications
date: 2026-05-10
tags:
  - springboot
  - redis
  - caching
author: Abhishek Tiwari
coverImage: /images/redis-caching.png
---

# Redis Caching in Spring Boot 🚀

Redis is an in-memory data structure store that is widely used as a caching layer to improve application performance.

In this blog, we will understand how Redis works with Spring Boot and how to set it up in a simple way.

---

## Why Use Redis?

Using Redis helps in:

- Reducing database load
- Improving API response time
- Storing frequently accessed data in memory
- Supporting distributed caching in microservices

---

## Add Dependencies

Add the following dependency in your `pom.xml`:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
````

---

## Configure Redis

Add configuration in `application.properties`:

```properties
spring.redis.host=localhost
spring.redis.port=6379
```

---

## Enable Caching

Enable caching in your Spring Boot application:

```java
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@EnableCaching
public class App {
    public static void main(String[] args) {
        SpringApplication.run(App.class, args);
    }
}
```

---

## Example Service with Cache

```java
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    @Cacheable(value = "users", key = "#id")
    public String getUserById(String id) {
        simulateSlowService();
        return "User-" + id;
    }

    private void simulateSlowService() {
        try {
            Thread.sleep(3000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}
```

---

## How It Works

1. First request → data fetched from method (slow)
2. Data stored in Redis cache
3. Next request → data served from Redis (fast ⚡)

---

## Conclusion

Redis caching significantly improves performance in Spring Boot applications by reducing redundant processing and database calls.

It is especially useful in microservices and high-traffic systems.
