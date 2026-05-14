---
title: "Distributed Scheduling with ShedLock"
description: "Implement distributed scheduling with ShedLock: preventing duplicate execution across nodes with locks"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["shedlock", "distributed-scheduling", "spring-boot", "locks"]
coverImage: "/images/distributed-scheduling.png"
draft: false
---

## Overview

When running multiple instances of a Spring Boot application, scheduled tasks execute on every instance by default. This causes duplicate work, data corruption, or resource contention. ShedLock solves this by ensuring that scheduled tasks execute at most once across all instances, regardless of the number of nodes.

ShedLock uses a centralized lock store (database, Redis, ZooKeeper, etc.) to coordinate execution. Unlike Quartz clustering, ShedLock works with Spring's `@Scheduled` annotation without replacing the scheduling mechanism.

## How ShedLock Works

ShedLock adds a lightweight locking layer on top of Spring's scheduler:

1. Before a task executes, ShedLock attempts to acquire a lock in the lock store.
2. If the lock is acquired, the task executes.
3. After execution (or after lock timeout), the lock is released.
4. Other instances skip execution if they cannot acquire the lock.

## ShedLock Configuration

### Maven/Gradle Dependency

```xml
<dependency>
    <groupId>net.javacrumbs.shedlock</groupId>
    <artifactId>shedlock-spring</artifactId>
    <version>5.10.0</version>
</dependency>
<dependency>
    <groupId>net.javacrumbs.shedlock</groupId>
    <artifactId>shedlock-provider-jdbc-template</artifactId>
    <version>5.10.0</version>
</dependency>
```

### Enable ShedLock

```java
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT30M")
public class ShedLockConfiguration {

    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(
            JdbcTemplateLockProvider.Configuration.builder()
                .withTableName("shedlock")
                .withJdbcTemplate(new JdbcTemplate(dataSource))
                .withColumnNames(new JdbcTemplateLockProvider.ColumnNames(
                    "name", "lock_until", "locked_at", "locked_by"))
                .build()
        );
    }
}
```

### Database Table

```sql
CREATE TABLE shedlock (
    name VARCHAR(64) NOT NULL,
    lock_until TIMESTAMP(3) NOT NULL,
    locked_at TIMESTAMP(3) NOT NULL,
    locked_by VARCHAR(255) NOT NULL,
    PRIMARY KEY (name)
);
```

## Using ShedLock

### Basic Usage

```java
@Component
public class DistributedTaskService {

    @Scheduled(cron = "0 0 2 * * ?")
    @SchedulerLock(name = "dailyDataCleanup", 
                   lockAtLeastFor = "PT30M", 
                   lockAtMostFor = "PT1H")
    public void cleanUpOldData() {
        log.info("Starting daily data cleanup");
        dataCleanupService.purgeRecordsOlderThan(Duration.ofDays(90));
        log.info("Daily data cleanup completed");
    }

    @Scheduled(fixedRate = 300000)
    @SchedulerLock(name = "cacheWarmup", lockAtLeastFor = "PT4M")
    public void warmUpCache() {
        log.info("Warming up cache");
        cacheService.preloadPopularItems();
    }
}
```

### With Parameters

```java
@Component
public class ReportGenerationService {

    @Scheduled(cron = "0 0 3 * * ?")
    @SchedulerLock(
        name = "generateDailyReport",
        lockAtLeastFor = "PT1H",
        lockAtMostFor = "PT2H"
    )
    public void generateDailyReport() {
        List<String> regions = regionService.getActiveRegions();
        for (String region : regions) {
            try {
                Report report = reportService.generateDaily(region);
                reportStore.save(report);
                log.info("Generated daily report for region: {}", region);
            } catch (Exception e) {
                log.error("Failed to generate report for region: {}", region, e);
            }
        }
    }
}
```

## Lock Providers

### JDBC Lock Provider

```java
@Bean
public LockProvider jdbcLockProvider(DataSource dataSource) {
    return new JdbcTemplateLockProvider(dataSource, "shedlock");
}
```

### Redis Lock Provider

```java
@Bean
public LockProvider redisLockProvider(RedisTemplate<String, String> redisTemplate) {
    return new RedisLockProvider(redisTemplate.getConnectionFactory(), "shedlock");
}
```

### ZooKeeper Lock Provider

```java
@Bean
public LockProvider zookeeperLockProvider(CuratorFramework client) {
    return new ZookeeperLockProvider(client, "/shedlock");
}
```

### Multiple Lock Providers for Different Tasks

```java
@Configuration
public class MultiProviderConfiguration {

    @Bean
    @Qualifier("jdbcLockProvider")
    public LockProvider jdbcLockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(dataSource, "shedlock");
    }

    @Bean
    @Qualifier("redisLockProvider")
    public LockProvider redisLockProvider(RedisTemplate<String, String> redisTemplate) {
        return new RedisLockProvider(redisTemplate.getConnectionFactory(), "shedlock");
    }

    @Bean
    public LockManager lockManager() {
        LockManager manager = new LockManager();
        manager.registerLockProvider("reports", jdbcLockProvider(null));
        manager.registerLockProvider("cache", redisLockProvider(null));
        return manager;
    }
}
```

## Advanced ShedLock Configuration

### Custom Lock Manager

```java
@Component
public class CustomLockManager {

    private final LockProvider lockProvider;

    public CustomLockManager(LockProvider lockProvider) {
        this.lockProvider = lockProvider;
    }

    public <T> T executeWithLock(String lockName, Duration lockAtMostFor,
                                  Duration lockAtLeastFor, Supplier<T> task) {
        LockConfiguration config = new LockConfiguration(
            Instant.now(),
            lockName,
            lockAtMostFor,
            lockAtLeastFor
        );

        Optional<SimpleLock> lock = lockProvider.lock(config);
        if (lock.isEmpty()) {
            throw new LockNotAvailableException("Could not acquire lock: " + lockName);
        }

        try {
            return task.get();
        } finally {
            lock.get().unlock();
        }
    }

    public boolean tryExecuteWithLock(String lockName, Duration lockAtMostFor,
                                       Duration lockAtLeastFor, Runnable task) {
        LockConfiguration config = new LockConfiguration(
            Instant.now(),
            lockName,
            lockAtMostFor,
            lockAtLeastFor
        );

        Optional<SimpleLock> lock = lockProvider.lock(config);
        if (lock.isEmpty()) {
            return false;
        }

        try {
            task.run();
            return true;
        } finally {
            lock.get().unlock();
        }
    }
}
```

### Conditional Locking Based on Environment

```java
@Component
public class ConditionalDistributedTask {

    @Scheduled(cron = "0 0/30 * * * ?")
    @SchedulerLock(name = "indexOptimization")
    public void optimizeIndex() {
        // Only executes on one instance per cluster
        log.info("Optimizing search index from instance: {}",
            ManagementFactory.getRuntimeMXBean().getName());
        searchService.optimizeIndex();
    }

    // Non-distributed task runs on every instance
    @Scheduled(fixedRate = 10000)
    public void collectLocalMetrics() {
        // Each instance collects its own metrics
        metricsService.collectLocalMetrics();
    }
}
```

## Programmatic Locking

```java
@Component
public class ProgrammaticShedLockService {

    private final LockProvider lockProvider;
    private final TaskScheduler taskScheduler;

    public ProgrammaticShedLockService(
            LockProvider lockProvider,
            TaskScheduler taskScheduler) {
        this.lockProvider = lockProvider;
        this.taskScheduler = taskScheduler;
    }

    public void scheduleWithLock(String taskName, String cronExpression, Runnable task) {
        taskScheduler.schedule(() -> {
            LockConfiguration config = new LockConfiguration(
                Instant.now(),
                taskName,
                Duration.ofMinutes(30),
                Duration.ofMinutes(5)
            );

            Optional<SimpleLock> lock = lockProvider.lock(config);
            if (lock.isPresent()) {
                try {
                    log.info("Executing locked task: {}", taskName);
                    task.run();
                } finally {
                    lock.get().unlock();
                }
            } else {
                log.debug("Could not acquire lock for task: {}", taskName);
            }
        }, new CronTrigger(cronExpression));
    }
}
```

## Monitoring ShedLock

```java
@Component
public class ShedLockMonitor {

    private final JdbcTemplate jdbcTemplate;

    public ShedLockMonitor(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Scheduled(fixedRate = 60000)
    public void checkLockStatus() {
        List<LockStatus> locks = jdbcTemplate.query(
            "SELECT name, lock_until, locked_at, locked_by FROM shedlock",
            (rs, rowNum) -> new LockStatus(
                rs.getString("name"),
                rs.getTimestamp("lock_until").toInstant(),
                rs.getTimestamp("locked_at").toInstant(),
                rs.getString("locked_by")
            )
        );

        Instant now = Instant.now();
        for (LockStatus lock : locks) {
            if (lock.lockUntil().isBefore(now)) {
                log.warn("Lock '{}' has expired but still exists in table", lock.name());
            }
            Duration heldDuration = Duration.between(lock.lockedAt(), now);
            log.debug("Lock '{}' held by {} for {}", lock.name(), lock.lockedBy(), heldDuration);
        }
    }

    public record LockStatus(
        String name, Instant lockUntil,
        Instant lockedAt, String lockedBy) {}
}
```

## Common Mistakes

### Missing lockAtLeastFor

```java
// Wrong: No minimum lock duration, task may re-execute immediately after completion
@Scheduled(cron = "0 0 * * * ?")
@SchedulerLock(name = "hourlyTask")
public void hourlyTask() {
    performWork();
}
```

```java
// Correct: Minimum lock duration prevents re-execution
@Scheduled(cron = "0 0 * * * ?")
@SchedulerLock(name = "hourlyTask", lockAtLeastFor = "PT55M")
public void hourlyTask() {
    performWork();
}
```

### Too Short lockAtMostFor

```java
// Wrong: Task may take longer than lock duration
@Scheduled(fixedRate = 300000)
@SchedulerLock(name = "longTask", lockAtMostFor = "PT5M")
public void longRunningTask() {
    processLargeDataSet(); // Takes 10-15 minutes
}
```

```java
// Correct: lockAtMostFor should exceed maximum expected duration
@Scheduled(fixedRate = 300000)
@SchedulerLock(name = "longTask", lockAtMostFor = "PT30M")
public void longRunningTask() {
    processLargeDataSet();
}
```

### Using ShedLock for Non-Distributed Tasks

```java
// Wrong: Unnecessary ShedLock on single-instance task
@Component
public class LocalTask {
    @Scheduled(fixedRate = 5000)
    @SchedulerLock(name = "localMetrics")
    public void collectLocalMetrics() {
        // Each instance should collect its own metrics
        metrics.collect();
    }
}
```

## Best Practices

1. Always specify both `lockAtLeastFor` and `lockAtMostFor` for predictable behavior.
2. Set `lockAtLeastFor` to slightly less than the scheduling interval for fixed-rate tasks.
3. Set `lockAtMostFor` generously to account for worst-case execution time.
4. Use descriptive lock names that reflect the task purpose.
5. Choose the lock provider that matches your infrastructure.
6. Monitor lock acquisition failures as they indicate contention or configuration issues.
7. Test distributed behavior with multiple instances in development.
8. Do not use ShedLock for tasks that must run on every instance.

## Comparison: ShedLock vs Quartz Clustering

| Feature | ShedLock | Quartz Clustering |
|---------|----------|------------------|
| Setup complexity | Low | Medium-High |
| Works with @Scheduled | Yes | No (requires Quartz API) |
| Database tables | 1 (shedlock) | 11 (QRTZ_ tables) |
| Dynamic scheduling | No | Yes |
| Misfire handling | No | Yes |
| Job persistence | Basic (lock only) | Full job/trigger state |
| Learning curve | Low | High |

## Summary

ShedLock provides a simple, lightweight solution for preventing duplicate execution of scheduled tasks in multi-instance deployments. It integrates seamlessly with Spring's `@Scheduled` annotation and supports multiple lock providers. For basic distributed scheduling needs, ShedLock is often the right choice over the heavier Quartz clustering approach.

## References

- ShedLock GitHub Documentation
- "Spring Boot in Practice" by Somnath Musib
- Spring Framework Scheduling Documentation

Happy Coding