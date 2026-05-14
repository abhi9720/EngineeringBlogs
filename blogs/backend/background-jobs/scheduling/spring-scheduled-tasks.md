---
title: "Spring @Scheduled Tasks"
description: "Using Spring's @Scheduled annotation: fixed rate, cron, task executor configuration, and error handling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["spring-scheduled", "task-executor", "scheduling", "spring-boot"]
coverImage: "/images/spring-scheduled-tasks.png"
draft: false
---

## Overview

Spring's `@Scheduled` annotation provides a declarative approach to scheduling tasks. It integrates seamlessly with Spring's task execution infrastructure, supporting fixed-rate, fixed-delay, and cron-based scheduling. While simpler than Quartz, it covers most common scheduling needs without external dependencies.

This post covers configuring scheduling, different scheduling modes, the task executor, error handling, and best practices.

## Enabling Scheduling

```java
@Configuration
@EnableScheduling
public class SchedulerConfiguration {

    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("scheduled-task-");
        executor.setRejectedExecutionHandler(
            new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    @Bean(name = "scheduledTaskExecutor")
    public ScheduledExecutorService scheduledTaskExecutor() {
        return Executors.newScheduledThreadPool(10, taskFactory());
    }

    private ThreadFactory taskFactory() {
        return new ThreadFactoryBuilder()
            .setNameFormat("scheduled-pool-%d")
            .setDaemon(false)
            .build();
    }
}
```

## Scheduling Modes

### Fixed Rate

Executes the task at a fixed interval, regardless of when the previous execution completed. If a task exceeds the interval, the next execution waits until the current one finishes.

```java
@Component
public class MetricsCollector {

    private final MetricsService metricsService;

    public MetricsCollector(MetricsService metricsService) {
        this.metricsService = metricsService;
    }

    @Scheduled(fixedRate = 60000, initialDelay = 10000)
    public void collectSystemMetrics() {
        log.info("Collecting system metrics");
        Map<String, Double> metrics = metricsService.collect();
        metricsService.publish(metrics);
    }

    @Scheduled(fixedRateString = "${scheduling.metrics.rate:30000}")
    public void collectApplicationMetrics() {
        Map<String, Double> metrics = metricsService.collectApplicationMetrics();
        metricsService.publish(metrics);
    }
}
```

### Fixed Delay

Waits for the specified delay after the previous execution completes before starting the next.

```java
@Component
public class IndexMaintenanceTask {

    private final IndexRebuildService indexService;

    public IndexMaintenanceTask(IndexRebuildService indexService) {
        this.indexService = indexService;
    }

    @Scheduled(fixedDelay = 5000)
    public void processPendingIndexUpdates() {
        log.info("Processing pending index updates");
        List<IndexUpdate> pending = indexService.getPendingUpdates();
        for (IndexUpdate update : pending) {
            indexService.processUpdate(update);
        }
    }

    @Scheduled(fixedDelay = 3600000, initialDelay = 60000)
    public void optimizeIndex() {
        log.info("Optimizing search index");
        indexService.optimize();
    }
}
```

### Cron Scheduling

```java
@Component
public class ReportScheduler {

    private final ReportService reportService;

    public ReportScheduler(ReportService reportService) {
        this.reportService = reportService;
    }

    @Scheduled(cron = "0 0 2 * * ?")
    public void generateDailySalesReport() {
        log.info("Generating daily sales report");
        reportService.generateDailyReport();
    }

    @Scheduled(cron = "0 0 3 * * MON")
    public void generateWeeklyReport() {
        log.info("Generating weekly report");
        reportService.generateWeeklyReport();
    }

    @Scheduled(cron = "0 0 4 1 * ?")
    public void generateMonthlyReport() {
        log.info("Generating monthly report");
        reportService.generateMonthlyReport();
    }

    // Cron expression from configuration
    @Scheduled(cron = "${scheduling.reports.hourly.cron:0 0 * * * ?}")
    public void generateHourlySnapshot() {
        reportService.generateHourlySnapshot();
    }
}
```

## Async Scheduled Tasks

Combine `@Scheduled` with `@Async` for non-blocking execution:

```java
@Component
@EnableAsync
public class AsyncScheduledTasks {

    @Async("taskExecutor")
    @Scheduled(fixedRate = 60000)
    public void processHighVolumeTask() {
        log.info("Processing high volume task asynchronously");
        List<Record> records = dataService.fetchRecords();
        records.parallelStream().forEach(this::processRecord);
    }

    @Async
    @Scheduled(cron = "0 0/5 * * * ?")
    public CompletableFuture<List<Notification>> sendBatchNotifications() {
        log.info("Sending batch notifications");
        List<Notification> sent = notificationService.sendPending();
        return CompletableFuture.completedFuture(sent);
    }

    @Async
    @Scheduled(fixedDelayString = "${scheduling.audit.delay:10000}")
    public void processAuditLogs() {
        List<AuditLog> logs = auditService.getUnprocessedLogs();
        for (AuditLog log : logs) {
            auditService.processLog(log);
        }
    }
}
```

## Conditional Scheduling

### Using @ConditionalOnProperty

```java
@Component
@ConditionalOnProperty(name = "scheduling.cache.eviction.enabled",
    havingValue = "true", matchIfMissing = true)
public class CacheEvictionTask {

    private final CacheManager cacheManager;

    public CacheEvictionTask(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    @Scheduled(fixedRate = 300000)
    public void evictExpiredEntries() {
        log.info("Evicting expired cache entries");
        cacheManager.getCacheNames().forEach(cacheName -> {
            Cache cache = cacheManager.getCache(cacheName);
            if (cache != null) {
                cache.evictIfExpired();
            }
        });
    }
}
```

### Programmatic Conditional Scheduling

```java
@Component
public class ConditionalTaskRunner {

    private final TaskScheduler taskScheduler;
    private final FeatureFlagService featureFlagService;
    private ScheduledFuture<?> currentTask;

    public ConditionalTaskRunner(
            TaskScheduler taskScheduler,
            FeatureFlagService featureFlagService) {
        this.taskScheduler = taskScheduler;
        this.featureFlagService = featureFlagService;
    }

    @PostConstruct
    public void init() {
        featureFlagService.registerListener("dataSyncEnabled", this::onFeatureChange);
        if (featureFlagService.isEnabled("dataSyncEnabled")) {
            startTask();
        }
    }

    private void onFeatureChange(boolean enabled) {
        if (enabled) {
            startTask();
        } else {
            stopTask();
        }
    }

    private void startTask() {
        if (currentTask == null || currentTask.isCancelled()) {
            currentTask = taskScheduler.scheduleAtFixedRate(
                this::executeDataSync,
                Duration.ofMinutes(5));
            log.info("Data sync task started");
        }
    }

    private void stopTask() {
        if (currentTask != null) {
            currentTask.cancel(false);
            log.info("Data sync task stopped");
        }
    }

    private void executeDataSync() {
        try {
            dataSyncService.sync();
        } catch (Exception e) {
            log.error("Data sync failed", e);
        }
    }
}
```

## Error Handling

### With AsyncUncaughtExceptionHandler

```java
@Configuration
@EnableAsync
public class AsyncExceptionConfiguration implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(25);
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            log.error("Async task {} failed with parameters: {}",
                method.getName(), params, ex);
            alertService.sendAlert("Scheduled task failure: " + method.getName(), ex);
        };
    }
}
```

### Per-Task Error Handling

```java
@Component
public class ResilientScheduledTasks {

    private final MetricsRecorder metrics;

    public ResilientScheduledTasks(MetricsRecorder metrics) {
        this.metrics = metrics;
    }

    @Scheduled(fixedRate = 60000)
    public void resilientTask() {
        try {
            metrics.increment("task.execution.started");
            executeBusinessLogic();
            metrics.increment("task.execution.completed");
        } catch (DataAccessException e) {
            metrics.increment("task.execution.retryable_error");
            log.warn("Retryable error in task: {}", e.getMessage());
        } catch (FatalException e) {
            metrics.increment("task.execution.fatal_error");
            log.error("Fatal error in task, alerting team", e);
            alertService.critical("Scheduled task failed fatally", e);
        } catch (Exception e) {
            metrics.increment("task.execution.unknown_error");
            log.error("Unknown error in task", e);
        }
    }

    @Scheduled(fixedDelay = 300000)
    public void taskWithCircuitBreaker() {
        if (circuitBreaker.isOpen()) {
            log.info("Circuit breaker is open, skipping task");
            return;
        }
        try {
            executeExternalApiCall();
            circuitBreaker.recordSuccess();
        } catch (ExternalApiException e) {
            circuitBreaker.recordFailure();
            log.error("External API call failed", e);
        }
    }
}
```

## Monitoring Scheduled Tasks

```java
@Component
public class TaskMonitor {

    private final MetricRegistry metricRegistry;

    public TaskMonitor(MetricRegistry metricRegistry) {
        this.metricRegistry = metricRegistry;
    }

    @EventListener
    public void handleTaskScheduled(ScheduledTaskEvent event) {
        log.info("Task scheduled: {}", event.getTaskName());
        metricRegistry.counter("scheduled.task." + event.getTaskName() + ".scheduled").inc();
    }

    @EventListener
    public void handleTaskExecution(TaskExecutionEvent event) {
        long duration = Duration.between(
            event.getStartTime(), event.getEndTime()).toMillis();
        metricRegistry.timer("scheduled.task." + event.getTaskName() + ".duration")
            .update(duration, TimeUnit.MILLISECONDS);
        metricRegistry.counter("scheduled.task." + event.getTaskName() + ".completed").inc();
    }

    @EventListener
    public void handleTaskFailure(TaskExecutionFailureEvent event) {
        log.error("Task execution failed: {}", event.getTaskName(), event.getThrowable());
        metricRegistry.counter("scheduled.task." + event.getTaskName() + ".failed").inc();
    }
}
```

## Common Mistakes

### Long-Running Tasks Blocking the Pool

```java
// Wrong: Long task blocks thread pool
@Component
public class BadScheduler {
    @Scheduled(fixedRate = 1000)
    public void longRunningTask() {
        Thread.sleep(30000); // Blocks the single scheduler thread
        processData();
    }
}
```

```java
// Correct: Async execution for long tasks
@Component
public class GoodScheduler {
    @Async("taskExecutor")
    @Scheduled(fixedRate = 1000)
    public CompletableFuture<Void> longRunningTask() {
        return CompletableFuture.runAsync(() -> {
            processData();
        });
    }
}
```

### Ignoring Previous Execution

```java
// Wrong: Can overlap with previous execution
@Scheduled(fixedRate = 5000)
public void processQueue() {
    while (queue.hasMore()) {
        processItem(queue.next());
    }
}
```

```java
// Correct: Use fixedDelay to prevent overlap, or check status
@Scheduled(fixedDelay = 5000)
public void processQueue() {
    while (queue.hasMore()) {
        processItem(queue.next());
    }
}
```

### Missing Shutdown Handling

```java
// Wrong: Running tasks are killed ungracefully on shutdown
public void shutdown() {
    // No wait for running tasks
    executor.shutdown();
}
```

```java
// Correct: Graceful shutdown
@Bean(name = "taskExecutor")
public Executor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    return executor;
}
```

## Best Practices

1. Always use `fixedDelay` instead of `fixedRate` when task execution time varies.
2. Use `@Async` with `@Scheduled` for non-blocking execution of long tasks.
3. Configure a separate task executor with appropriate pool size for scheduled tasks.
4. Implement error handling within each scheduled method.
5. Use metrics to monitor task execution duration and failure rates.
6. Enable graceful shutdown with `setWaitForTasksToCompleteOnShutdown(true)`.
7. Use `initialDelay` to stagger startup of scheduled tasks.
8. Externalize cron expressions and rates to configuration.

## Summary

Spring's `@Scheduled` annotation provides a simple yet powerful way to schedule tasks. Choose `fixedRate` for time-critical periodic tasks, `fixedDelay` for tasks that should not overlap, and cron for precise time-based scheduling. Always handle errors explicitly and configure appropriate thread pools for production workloads.

## References

- Spring Framework Documentation: "Task Execution and Scheduling"
- "Spring in Action" by Craig Walls
- Spring Boot Reference Guide

Happy Coding