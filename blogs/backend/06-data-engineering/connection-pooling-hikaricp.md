---
title: Connection Pooling with HikariCP
description: >-
  Configure HikariCP for optimal database connection management: pool sizing,
  health checks, and performance tuning
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - hikaricp
  - connection-pool
  - database
  - performance
coverImage: /images/connection-pooling-hikaricp.png
draft: false
order: 10
---
# Connection Pooling with HikariCP

## Overview

Database connections are expensive to create. Connection pooling reuses connections to dramatically improve performance. HikariCP is the standard connection pool for Spring Boot—fast, reliable, and production-ready.

---

## How HikariCP Works

The lifecycle of a pooled connection follows a consistent pattern: when the application requests a `Connection` from the `DataSource`, HikariCP first checks for an idle connection in the pool. If none is available and the pool has not reached its maximum size, a new connection is created. If all connections are active, the calling thread blocks for up to `connectionTimeout` milliseconds waiting for a connection to be returned. When the application calls `close()`, the connection is not actually closed—it is returned to the pool for reuse, avoiding the significant overhead of TCP handshakes, SSL negotiation, and database authentication on every request.

```java
// HikariCP maintains a pool of connections
// When you request a connection:
// 1. Check pool for available connection
// 2. If none available, wait or create new (up to max)
// 3. Return connection for use
// 4. On close, return to pool (not close!)
```

### Basic Configuration

The configuration below defines a pool named `MyHikariPool` with a maximum of 20 connections, a minimum of 5 idle connections kept warm, a 30-second timeout for waiting on a connection, a 10-minute idle timeout before evicting unused connections, and a 30-minute max lifetime after which connections are recycled to prevent issues with network middleboxes or database-side timeouts.

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

A common rule of thumb for initial pool sizing is `(core_count * 2) + spindle_count`, but the true optimal size depends on your database's response time and your application's throughput requirements. The key insight—popularized by the HikariCP documentation—is that more connections do not equal more throughput beyond a certain point. Each connection consumes a database worker thread, and context switching overhead eventually dominates. The configuration below computes pool size dynamically based on available CPU cores and disk spindles, sets timeouts appropriate for a production environment, and uses `SELECT 1` as a lightweight connection health check.

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

Once the pool is configured, monitoring its runtime behavior is essential. The `HikariPoolMXBean` exposes four key metrics—active connections, idle connections, total connections, and threads awaiting a connection. A high number of threads awaiting connection indicates that the pool is undersized or that queries are taking too long. Spring Boot Actuator can automatically expose these metrics when the HikariCP health indicator is enabled, allowing integration with Prometheus, Grafana, or your existing monitoring stack.

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

Setting the pool size too small leads to threads queueing up waiting for connections, increasing response latency under load. Conversely, setting it too large wastes database resources and can degrade performance due to context switching. The right size balances concurrency needs against database capacity—start conservatively and tune upward based on observed `threadsAwaitingConnection` counts.

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

Without a connection timeout, threads can block indefinitely waiting for a connection, leading to thread starvation and cascading failures across the application. Always set a reasonable timeout so that failures are fast and the system can degrade gracefully or trigger circuit breakers.

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

Happy Coding
