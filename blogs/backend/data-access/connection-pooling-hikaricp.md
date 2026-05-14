---
title: "Connection Pooling with HikariCP"
description: "Configure HikariCP for optimal database connection management: pool sizing, health checks, and performance tuning"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - hikaricp
  - connection-pool
  - database
  - performance
coverImage: "/images/connection-pooling-hikaricp.png"
draft: false
---

# Connection Pooling with HikariCP

## Overview

Database connections are expensive to create. Connection pooling reuses connections to dramatically improve performance. HikariCP is the standard connection pool for Spring Boot—fast, reliable, and production-ready.

---

## How HikariCP Works

```java
// HikariCP maintains a pool of connections
// When you request a connection:
// 1. Check pool for available connection
// 2. If none available, wait or create new (up to max)
// 3. Return connection for use
// 4. On close, return to pool (not close!)
```

### Basic Configuration

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb
    username: user
    password: password
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000
      pool-name: MyHikariPool
```

---

## Real-World Use Cases

### Production Pool Sizing

```java
// Rule of thumb: connections = (core_count * 2) + spindle_count
// But start simple and tune

@Configuration
public class HikariConfig {
    
    @Value("${DB_CORE_COUNT:4}")
    private int coreCount;
    
    @Value("${DB_SPINDLE_COUNT:1}")
    private int spindleCount;
    
    @Bean
    public DataSource dataSource() {
        
        int poolSize = (coreCount * 2) + spindleCount;
        
        HikariConfig config = new HikariConfig();
        config.setMaximumPoolSize(poolSize);
        config.setMinimumIdle(poolSize / 2);
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);
        config.setPoolName("ProductionPool");
        
        // Health check
        config.setConnectionTestQuery("SELECT 1");
        
        return new HikariDataSource(config);
    }
}
```

### Monitoring Pool Health

```java
@Service
public class PoolHealthMonitor {
    
    @Autowired
    private DataSource dataSource;
    
    public PoolStats getStats() {
        if (dataSource instanceof HikariDataSource) {
            HikariDataSource hikari = (HikariDataSource) dataSource;
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            
            return PoolStats.builder()
                .activeConnections(pool.getActiveConnections())
                .idleConnections(pool.getIdleConnections())
                .totalConnections(pool.getTotalConnections())
                .threadsAwaitingConnection(pool.getThreadsAwaitingConnection())
                .build();
        }
        return null;
    }
}

// Actuator endpoint
management:
  endpoints:
    web:
      exposure:
        include: health
  health:
    hikari:
      enabled: true
```

---

## Common Mistakes

### Mistake 1: Pool Too Small

```yaml
# WRONG: Default pool might be too small for concurrent users
spring:
  datasource:
    hikari:
      maximum-pool-size: 10  # Too small for 100 concurrent users!

# CORRECT: Size based on concurrency needs
spring:
  datasource:
    hikari:
      maximum-pool-size: 50
      minimum-idle: 10
```

### Mistake 2: No Connection Timeout

```yaml
# WRONG: Default wait is infinite - threads hang forever!
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb

# CORRECT: Set timeout
spring:
  datasource:
    hikari:
      connection-timeout: 30000  # Wait max 30 seconds
```

---

## Summary

1. **Size appropriately**: Start with 20, tune based on metrics
2. **Set timeouts**: Prevent thread hangs
3. **Monitor**: Use actuator to track pool health
4. **Minimum idle**: Keep connections warm for latency-sensitive operations

---

## References

- [HikariCP GitHub](https://github.com/brettwooldridge/HikariCP)
- [Spring Boot DataSource Configuration](https://docs.spring.io/spring-boot/docs/current/reference/html/data.html#data.sql.datasource)

---

Happy Coding 👨‍💻