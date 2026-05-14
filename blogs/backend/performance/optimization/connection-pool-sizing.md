---
title: "Connection Pool Sizing"
description: "Calculate optimal connection pool sizes for HikariCP: formula-based sizing, monitoring, and tuning for throughput"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - performance
  - optimization
  - hikaricp
  - connection-pool
coverImage: "/images/connection-pool-sizing.png"
draft: false
---

# Connection Pool Sizing

## Overview

Connection pool sizing is one of the most critical configuration decisions for database-backed applications. Too few connections cause request queuing and timeouts. Too many connections overwhelm the database with context switching.

### The Pool Size Myth

Common wisdom says "more connections = more throughput". The reality is:

- **PostgreSQL**: Optimal concurrency = CPU cores × 2 + SSD spindles
- **MySQL**: Slightly higher due to different threading model
- **General rule**: Start at 10-20 connections per pool, not 100+

---

## The Formula

### PostgreSQL Optimal Pool Size

```java
@Component
public class PoolSizeCalculator {

    /**
     * PostgreSQL optimal pool size formula:
     * pool_size = (core_count * 2) + effective_spindle_count
     *
     * For modern SSDs, effective_spindle_count = 1
     * For HDDs, count the number of spindles
     *
     * Core_count = available CPU cores to the application
     * NOT total server cores (if other apps share)
     */
    public int calculateOptimalPoolSize() {
        int availableCores = Runtime.getRuntime().availableProcessors();
        int effectiveSpindles = 1; // SSD

        int poolSize = (availableCores * 2) + effectiveSpindles;

        log.info("Calculated optimal pool size: {} (cores: {}, spindles: {})",
            poolSize, availableCores, effectiveSpindles);

        return Math.min(poolSize, 50); // Cap at 50
    }

    /**
     * For async/reactive applications:
     * pool_size = core_count + 1
     */
    public int calculateReactivePoolSize() {
        return Runtime.getRuntime().availableProcessors() + 1;
    }
}
```

### HikariCP Configuration

```yaml
spring:
  datasource:
    hikari:
      pool-name: OrderPool
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 5000
      idle-timeout: 300000
      max-lifetime: 600000
      keepalive-time: 30000
      connection-test-query: SELECT 1
      validation-timeout: 3000
      leak-detection-threshold: 60000
      data-source-properties:
        cachePrepStmts: true
        prepStmtCacheSize: 250
        prepStmtCacheSqlLimit: 2048
        useServerPrepStmts: true
```

### Programmatic Configuration

```java
@Configuration
public class HikariPoolConfig {

    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setPoolName("OrderPool");
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/orders");
        config.setUsername("app_user");
        config.setPassword("app_password");

        // Pool size (based on formula)
        config.setMaximumPoolSize(20);
        config.setMinimumIdle(5);

        // Timeouts
        config.setConnectionTimeout(5_000);      // 5 seconds
        config.setIdleTimeout(300_000);           // 5 minutes
        config.setMaxLifetime(600_000);           // 10 minutes
        config.setKeepaliveTime(30_000);          // 30 seconds

        // Statement caching
        config.addDataSourceProperty("cachePrepStmts", "true");
        config.addDataSourceProperty("prepStmtCacheSize", "250");
        config.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
        config.addDataSourceProperty("useServerPrepStmts", "true");

        // Leak detection
        config.setLeakDetectionThreshold(60_000);  // 1 minute

        return new HikariDataSource(config);
    }
}
```

---

## Pool Sizing by Use Case

### Read-Heavy Application

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 30  # More connections for reads
      minimum-idle: 10
      read-only: true
```

### Write-Heavy Application

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 15  # Writes are slower, fewer connections
      minimum-idle: 5
      # Also consider separate pools for read/write
```

### Mixed Workload

```java
@Configuration
public class MultiPoolConfig {

    @Bean
    @Qualifier("readPool")
    public DataSource readDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://replica:5432/orders");
        config.setMaximumPoolSize(30);
        config.setReadOnly(true);
        return new HikariDataSource(config);
    }

    @Bean
    @Qualifier("writePool")
    public DataSource writeDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://primary:5432/orders");
        config.setMaximumPoolSize(10);
        config.setReadOnly(false);
        return new HikariDataSource(config);
    }
}
```

### Microservice Considerations

```yaml
# For microservices with many instances:
# 20 instances × 20 connections each = 400 connections to DB
# Adjust pool size inversely with instance count

# Example: 20 instances → pool size 10
# Example: 5 instances → pool size 20
```

---

## Pool Monitoring

### HikariCP Metrics

```java
@Component
public class PoolMonitor {

    private final DataSource dataSource;
    private final MeterRegistry registry;

    @Scheduled(fixedRate = 15_000)
    public void logPoolMetrics() {
        if (dataSource instanceof HikariDataSource hikari) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();

            int active = pool.getActiveConnections();
            int idle = pool.getIdleConnections();
            int pending = pool.getPendingThreads();
            int total = pool.getTotalConnections();
            int max = hikari.getMaximumPoolSize();

            log.info("Pool: {}/{} active, {} idle, {} pending, {} total",
                active, max, idle, pending, total);

            // Record metrics
            Gauge.builder("hikari.connections.active", pool,
                    HikariPoolMXBean::getActiveConnections)
                .tag("pool", hikari.getPoolName())
                .register(registry);

            Gauge.builder("hikari.connections.pending", pool,
                    HikariPoolMXBean::getPendingThreads)
                .tag("pool", hikari.getPoolName())
                .register(registry);

            // Alerting conditions
            if (pending > 0) {
                log.warn("Connection pool has {} pending requests", pending);
            }

            if (active >= max * 0.8) {
                log.warn("Connection pool reaching capacity: {}/{}", active, max);
            }
        }
    }
}
```

### Prometheus Integration

```yaml
# Prometheus metrics for HikariCP
hikaricp_connections_active{pool="OrderPool"} 5
hikaricp_connections_idle{pool="OrderPool"} 15
hikaricp_connections_pending{pool="OrderPool"} 0
hikaricp_connections_timeout_total{pool="OrderPool"} 2
hikaricp_connections_max{pool="OrderPool"} 20
```

---

## Connection Leak Detection

### Configuration

```yaml
spring:
  datasource:
    hikari:
      leak-detection-threshold: 60000  # 1 minute
      # If a connection is held for more than this, log a warning with stack trace
```

### Detecting Leaks

```java
@Component
public class ConnectionLeakDetector {

    private final DataSource dataSource;

    @Scheduled(fixedRate = 60_000)
    public void detectLeaks() {
        if (dataSource instanceof HikariDataSource hikari) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();

            // If pool is exhausted and connections are active
            if (pool.getActiveConnections() >= hikari.getMaximumPoolSize()
                    && pool.getPendingThreads() > 0) {

                log.error("Connection pool exhausted! Potential leak!");
                log.error("Active: {}, Idle: {}, Pending: {}",
                    pool.getActiveConnections(),
                    pool.getIdleConnections(),
                    pool.getPendingThreads());

                // Take thread dump for analysis
                ThreadDumpService.dumpThreads();
            }
        }
    }
}
```

### Common Leak Patterns

```java
// Pattern 1: Unclosed connections
@Service
public class LeakyService {

    public void badQuery() throws SQLException {
        Connection conn = dataSource.getConnection();
        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery("SELECT 1");
        // Never closed! Connection leaked!
    }

    public void goodQuery() throws SQLException {
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT 1")) {
            // Auto-closed by try-with-resources
        }
    }
}
```

---

## Capacity Planning

### Load Testing Formula

```java
@Component
public class CapacityPlanner {

    /**
     * Calculate required pool size:
     *
     * T = average transaction time (in seconds)
     * R = required requests per second
     * P = pool size needed
     *
     * P = T × R × (1 + safety_margin)
     *
     * Example:
     * T = 0.05s (50ms average query)
     * R = 400 requests/second
     * P = 0.05 × 400 × 1.5 = 30 connections
     */
    public int calculatePoolSize(double avgQueryTimeMs,
                                  double targetRps,
                                  double safetyMargin) {
        double avgQuerySeconds = avgQueryTimeMs / 1000.0;
        int poolSize = (int) Math.ceil(
            avgQuerySeconds * targetRps * (1 + safetyMargin));

        log.info("Calculated pool size: {} (query: {}ms, rps: {}, margin: {})",
            poolSize, avgQueryTimeMs, targetRps, safetyMargin);

        return Math.min(Math.max(poolSize, 5), 50);
    }
}
```

---

## Best Practices

### 1. Set Appropriate Timeouts

```yaml
spring:
  datasource:
    hikari:
      connection-timeout: 5000    # Don't let requests hang forever
      socket-timeout: 30000        # 30 seconds for query execution
      validation-timeout: 3000     # 3 seconds for connection validation
```

### 2. Enable Statement Caching

```yaml
spring:
  datasource:
    hikari:
      data-source-properties:
        cachePrepStmts: true
        prepStmtCacheSize: 250
        prepStmtCacheSqlLimit: 2048
```

### 3. Monitor and Alert

```yaml
# Prometheus alerts for connection pool
groups:
  - name: connection-pool
    rules:
      - alert: PoolExhausted
        expr: hikaricp_connections_pending > 0
        for: 1m
        labels:
          severity: critical

      - alert: PoolHighUsage
        expr: hikaricp_connections_active / hikaricp_connections_max > 0.8
        for: 5m
        labels:
          severity: warning
```

---

## Common Mistakes

### Mistake 1: Oversized Pool

```yaml
# WRONG: 100 connections (causes database thrashing)
maximum-pool-size: 100
# Context switching overhead kills performance

# CORRECT: 10-30 connections
maximum-pool-size: 20
```

### Mistake 2: No Connection Timeout

```yaml
# WRONG: No timeout (requests wait forever)
connection-timeout: 0

# CORRECT: Set reasonable timeout
connection-timeout: 5000
```

### Mistake 3: Same Pool for Read and Write

```java
// WRONG: Same pool for OLTP reads and batch writes
// Long-running batch queries consume all connections

// CORRECT: Separate pools
@Bean
@Qualifier("oltpPool")
public DataSource oltpDataSource() {
    // small pool, short timeouts
}

@Bean
@Qualifier("batchPool")
public DataSource batchDataSource() {
    // large pool, long timeouts
}
```

---

## Summary

1. Pool size = (cores × 2) + spindles (typically 10-30)
2. Start small and increase based on monitoring
3. Separate read/write pools for mixed workloads
4. Set connection timeout to prevent hung requests
5. Enable leak detection to find connection leaks
6. Monitor pool utilization and pending requests
7. Smaller pools often outperform larger ones

---

## References

- [HikariCP Configuration](https://github.com/brettwooldridge/HikariCP#configuration-knobs-baby)
- [PostgreSQL Connection Pooling](https://wiki.postgresql.org/wiki/Number_Of_Database_Connections)
- [Brett Wooldridge: Pool Sizing](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing)

Happy Coding