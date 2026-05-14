---
title: Scheduling with Quartz in Spring Boot
description: >-
  Master Quartz scheduler integration with Spring Boot: job scheduling,
  triggers, persistence, clustering, cron expressions, and dynamic scheduling
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - quartz
  - scheduling
  - batch
coverImage: /images/scheduling-with-quartz.png
draft: false
order: 30
---
## Overview

Quartz is a full-featured, open-source job scheduling library that can be integrated with Spring Boot. It supports persistent jobs, clustering, cron expressions, and dynamic job creation. This guide covers production-ready scheduling patterns with Quartz in Spring Boot.

When to choose Quartz over Spring's `@Scheduled` annotation: Quartz provides persistence (jobs survive application restarts), clustering (only one node executes a job), advanced misfire handling, and dynamic job creation at runtime. Spring's `@Scheduled` is simpler but lacks these enterprise features. Use Quartz for critical scheduling that must be reliable and auditable.

## Dependencies

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-quartz</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
</dependency>
```

## Basic Job Configuration

### Simple Job

A Quartz job extends `QuartzJobBean` and implements `executeInternal`. The `JobExecutionContext` provides access to the `JobDataMap`, which carries parameters set when the job was scheduled. The `JobDataMap` is the recommended way to parameterize jobs — it's persistent (stored in the database) and survives restarts.

The example below demonstrates a job with retry logic. The `retryCount` is decremented each time the job fails, and the job is re-fired immediately if retries remain. This pattern is useful for jobs that depend on transient conditions (network availability, external service health).

```java
@Component
public class EmailJob extends QuartzJobBean {

    @Autowired
    private EmailService emailService;

    @Override
    protected void executeInternal(JobExecutionContext context) throws JobExecutionException {
        JobDataMap dataMap = context.getMergedJobDataMap();

        String template = dataMap.getString("template");
        String recipient = dataMap.getString("recipient");
        int retryCount = dataMap.getInt("retryCount");

        try {
            emailService.sendTemplatedEmail(template, recipient);
            System.out.println("Email sent to " + recipient + " using template " + template);
        } catch (Exception e) {
            if (retryCount > 0) {
                dataMap.put("retryCount", retryCount - 1);
                JobExecutionException retry = new JobExecutionException(e);
                retry.setRefireImmediately(true);
                throw retry;
            }
            throw new JobExecutionException("Failed to send email after retries", e);
        }
    }
}
```

### Scheduling the Job

Jobs and triggers are defined as Spring beans. The `JobDetail` defines the job class, identity, and data map (default parameters). The `Trigger` defines the schedule. Separating job detail from trigger allows multiple triggers to share the same job.

The `storeDurably(true)` flag keeps the job in the store even without a trigger, enabling boundary cases like adding a trigger later. `requestRecovery(true)` tells the scheduler to re-execute the job if it was in progress when the scheduler shut down unexpectedly.

```java
@Configuration
public class QuartzSchedulerConfig {

    @Bean
    public JobDetail emailJobDetail() {
        return JobBuilder.newJob(EmailJob.class)
            .withIdentity("emailJob", "emailJobs")
            .usingJobData("template", "welcome")
            .usingJobData("recipient", "default@example.com")
            .usingJobData("retryCount", 3)
            .storeDurably(true)
            .requestRecovery(true)
            .build();
    }

    @Bean
    public Trigger emailJobTrigger() {
        return TriggerBuilder.newTrigger()
            .forJob(emailJobDetail())
            .withIdentity("emailTrigger", "emailTriggers")
            .withSchedule(CronScheduleBuilder.cronSchedule("0 0 8 * * ? *")) // 8 AM daily
            .withPriority(5)
            .build();
    }
}
```

## Cron Expressions

Cron expressions can be intimidating. Quartz's `CronScheduleBuilder` provides type-safe helper methods that eliminate the need to write raw cron expressions for common schedules. The examples below use `dailyAtHourAndMinute`, `weeklyOnDayAndHourAndMinute`, and `monthlyOnDayAndHourAndMinute`.

Each trigger on the same job fires independently. In the example below, the report generation job fires daily at 2 AM, weekly on Monday at 3 AM, and monthly on the 1st at 4 AM. This pattern is useful when the same logic needs to run on different schedules.

```java
@Configuration
public class CronJobsConfig {

    @Bean
    public JobDetail reportGenerationJob() {
        return JobBuilder.newJob(ReportGenerationJob.class)
            .withIdentity("reportGenerationJob", "reports")
            .storeDurably()
            .build();
    }

    @Bean
    public Trigger dailyReportTrigger() {
        return TriggerBuilder.newTrigger()
            .forJob(reportGenerationJob())
            .withIdentity("dailyReportTrigger")
            .withSchedule(CronScheduleBuilder
                .dailyAtHourAndMinute(2, 0)) // 2:00 AM daily
            .build();
    }

    @Bean
    public Trigger weeklyReportTrigger() {
        return TriggerBuilder.newTrigger()
            .forJob(reportGenerationJob())
            .withIdentity("weeklyReportTrigger")
            .withSchedule(CronScheduleBuilder
                .weeklyOnDayAndHourAndMinute(DateBuilder.MONDAY, 3, 0)) // Monday 3 AM
            .build();
    }

    @Bean
    public Trigger monthlyCleanupTrigger() {
        return TriggerBuilder.newTrigger()
            .forJob(reportGenerationJob())
            .withIdentity("monthlyCleanupTrigger")
            .withSchedule(CronScheduleBuilder
                .monthlyOnDayAndHourAndMinute(1, 4, 0)) // 1st of month at 4 AM
            .build();
    }
}
```

## Persistent Jobs with Database

### Configuration

Persist all job and trigger state in a database to survive application restarts. The `job-store-type: jdbc` tells Spring Boot to use the JDBC job store. Set `initialize-schema: always` during development to auto-create the Quartz tables; switch to `never` in production and manage schema migrations manually.

The `LocalDataSourceJobStore` uses the application's configured data source. The `tablePrefix` defaults to `QRTZ_`. The `isClustered` flag enables clustering support.

```yaml
spring:
  quartz:
    job-store-type: jdbc
    jdbc:
      initialize-schema: always
    properties:
      org:
        quartz:
          scheduler:
            instanceId: AUTO
          jobStore:
            class: org.springframework.scheduling.quartz.LocalDataSourceJobStore
            driverDelegateClass: org.quartz.impl.jdbcjobstore.PostgreSQLDelegate
            tablePrefix: QRTZ_
            isClustered: false
            clusterCheckinInterval: 15000
            useProperties: true
          threadPool:
            class: org.quartz.simpl.SimpleThreadPool
            threadCount: 10
            threadPriority: 5
```

## Clustered Scheduling

In a clustered deployment, multiple application instances share the same Quartz database tables. The cluster configuration ensures that each job is executed by exactly one node. If a node fails, another node in the cluster picks up its jobs.

Key settings: `isClustered: true` enables cluster mode, `instanceId: AUTO` generates a unique instance ID automatically, and `clusterCheckinInterval` controls how often instances check in with the database. A node is considered dead if it misses checkins for more than two intervals.

```yaml
spring:
  quartz:
    job-store-type: jdbc
    properties:
      org:
        quartz:
          scheduler:
            instanceName: MyClusteredScheduler
            instanceId: AUTO
          jobStore:
            class: org.springframework.scheduling.quartz.LocalDataSourceJobStore
            driverDelegateClass: org.quartz.impl.jdbcjobstore.PostgreSQLDelegate
            isClustered: true
            clusterCheckinInterval: 15000
            misfireThreshold: 60000
          threadPool:
            threadCount: 5
```

### Cluster-Aware Job

A cluster-aware job should be idempotent and use database-level locks for distributed operations. The `getSchedulerInstanceId()` method returns which node is executing the job, which is useful for debugging and monitoring.

If you use optimistic locking in your business logic (e.g., `@Version` on entities), concurrent execution across cluster nodes will cause `OptimisticLockException`. Design jobs to handle these gracefully via retry or by using database-level advisory locks.

```java
@Component
public class ClusterJob extends QuartzJobBean {

    @Override
    protected void executeInternal(JobExecutionContext context) throws JobExecutionException {
        String instanceId = context.getScheduler().getSchedulerInstanceId();
        System.out.println("Job executing on instance: " + instanceId);

        // Use database-level locks for distributed operations
        try {
            processItems();
        } catch (Exception e) {
            // In cluster, check if another node should handle it
            if (isRecoverableFailure(e)) {
                JobExecutionException ex = new JobExecutionException(e);
                ex.setUnscheduleAllTriggers(false);
                throw ex;
            }
        }
    }
}
```

## Dynamic Job Scheduling

### Job Controller

A REST controller for managing jobs at runtime enables admin UIs for scheduling. The `Scheduler` API provides methods to schedule, delete, and list jobs. Dynamic scheduling is a key advantage of Quartz over Spring's `@Scheduled`.

The `DynamicJob` class is a generic executor that delegates to a Spring bean based on the `jobType` parameter. This allows adding new job types without modifying the scheduling infrastructure — just create a new `JobExecutor` implementation and inject it into the `ApplicationContext`.

```java
@RestController
@RequestMapping("/api/scheduler")
public class JobSchedulerController {
    private final Scheduler scheduler;

    public JobSchedulerController(Scheduler scheduler) {
        this.scheduler = scheduler;
    }

    @PostMapping("/jobs")
    public Map<String, String> createJob(@RequestBody CreateJobRequest request) {
        try {
            JobDetail jobDetail = JobBuilder.newJob(DynamicJob.class)
                .withIdentity(request.getJobName(), request.getJobGroup())
                .usingJobData("jobType", request.getJobType())
                .usingJobData("config", request.getConfig())
                .storeDurably()
                .build();

            Trigger trigger = TriggerBuilder.newTrigger()
                .withIdentity(request.getJobName() + "Trigger", request.getJobGroup())
                .withSchedule(CronScheduleBuilder.cronSchedule(request.getCronExpression()))
                .build();

            scheduler.scheduleJob(jobDetail, trigger);

            return Map.of(
                "status", "scheduled",
                "jobName", request.getJobName(),
                "nextFire", trigger.getNextFireTime().toString()
            );
        } catch (SchedulerException e) {
            throw new RuntimeException("Failed to schedule job", e);
        }
    }

    @DeleteMapping("/jobs/{jobName}/{jobGroup}")
    public Map<String, String> deleteJob(@PathVariable String jobName,
                                          @PathVariable String jobGroup) {
        try {
            JobKey jobKey = new JobKey(jobName, jobGroup);
            scheduler.deleteJob(jobKey);
            return Map.of("status", "deleted");
        } catch (SchedulerException e) {
            throw new RuntimeException("Failed to delete job", e);
        }
    }

    @GetMapping("/jobs")
    public List<Map<String, Object>> listJobs() throws SchedulerException {
        List<Map<String, Object>> jobs = new ArrayList<>();
        for (String groupName : scheduler.getJobGroupNames()) {
            for (JobKey jobKey : scheduler.getJobKeys(GroupMatcher.jobGroupEquals(groupName))) {
                List<Trigger> triggers = (List<Trigger>) scheduler.getTriggersOfJob(jobKey);
                Map<String, Object> jobInfo = new HashMap<>();
                jobInfo.put("name", jobKey.getName());
                jobInfo.put("group", jobKey.getGroup());
                jobInfo.put("triggers", triggers.stream()
                    .map(t -> Map.of(
                        "nextFireTime", String.valueOf(t.getNextFireTime()),
                        "previousFireTime", String.valueOf(t.getPreviousFireTime())
                    ))
                    .toList());
                jobs.add(jobInfo);
            }
        }
        return jobs;
    }
}
```

### Dynamic Job Implementation

The dynamic job resolves the executor at runtime based on `jobType`. This pattern allows the scheduling infrastructure to remain unchanged while business teams add new job types by implementing `JobExecutor`.

```java
@Component
public class DynamicJob extends QuartzJobBean {

    @Autowired
    private ApplicationContext applicationContext;

    @Override
    protected void executeInternal(JobExecutionContext context) throws JobExecutionException {
        JobDataMap dataMap = context.getMergedJobDataMap();
        String jobType = dataMap.getString("jobType");
        String config = dataMap.getString("config");

        JobExecutor executor = findExecutor(jobType);
        if (executor == null) {
            throw new JobExecutionException("No executor found for: " + jobType);
        }

        try {
            executor.execute(config);
        } catch (Exception e) {
            throw new JobExecutionException("Job execution failed", e);
        }
    }

    private JobExecutor findExecutor(String jobType) {
        Map<String, JobExecutor> executors = applicationContext.getBeansOfType(JobExecutor.class);
        return executors.get(jobType + "Executor");
    }
}
```

## Job Listeners

Global job listeners provide cross-cutting monitoring and logging. The listener below logs job start, completion, and failure with timing information. Register listeners on the `SchedulerFactoryBean` to apply them to all jobs.

For per-job listeners, implement `JobListener` and register them on individual `JobDetail` beans. Per-job listeners are useful for job-specific metrics or notifications.

```java
@Component
public class GlobalJobListener implements JobListener {

    @Override
    public String getName() {
        return "GlobalJobListener";
    }

    @Override
    public void jobToBeExecuted(JobExecutionContext context) {
        System.out.println("Job to be executed: " + context.getJobDetail().getKey());
    }

    @Override
    public void jobExecutionVetoed(JobExecutionContext context) {
        System.out.println("Job execution vetoed: " + context.getJobDetail().getKey());
    }

    @Override
    public void jobWasExecuted(JobExecutionContext context, JobExecutionException jobException) {
        JobKey key = context.getJobDetail().getKey();
        long duration = context.getJobRunTime();

        if (jobException != null) {
            System.err.println("Job " + key + " failed after " + duration + "ms");
        } else {
            System.out.println("Job " + key + " completed in " + duration + "ms");
        }
    }
}

// Register the listener
@Configuration
public class ListenerConfig {

    @Bean
    public SchedulerFactoryBean schedulerFactoryBean(GlobalJobListener listener) {
        SchedulerFactoryBean factory = new SchedulerFactoryBean();
        factory.setGlobalJobListeners(listener);
        return factory;
    }
}
```

## Misfire Handling

Misfire handling determines what happens when a trigger misses its fire time. The three strategies are:

- **Fire Now**: Re-fires the job immediately. Use for critical jobs that must not be skipped (e.g., payment processing).
- **Do Nothing**: Skips the missed fire. Use for non-critical jobs where the next scheduled run suffices (e.g., hourly reports).
- **Ignore Misfires**: Runs all missed fires immediately. Use for catch-up scenarios (e.g., batch jobs that must process every interval).

```java
@Configuration
public class MisfireConfig {

    @Bean
    public Trigger misfireAwareTrigger() {
        return TriggerBuilder.newTrigger()
            .withIdentity("criticalJobTrigger")
            .forJob("criticalJob")
            .withSchedule(SimpleScheduleBuilder.simpleSchedule()
                .withIntervalInMinutes(5)
                .repeatForever()
                .withMisfireHandlingInstructionFireNow() // Fire immediately on misfire
            )
            .build();
    }

    @Bean
    public Trigger nonCriticalTrigger() {
        return TriggerBuilder.newTrigger()
            .withIdentity("reportTrigger")
            .forJob("reportJob")
            .withSchedule(CronScheduleBuilder.cronSchedule("0 0 * * * ?")
                .withMisfireHandlingInstructionDoNothing() // Skip misfired executions
            )
            .build();
    }

    @Bean
    public Trigger batchTrigger() {
        return TriggerBuilder.newTrigger()
            .withIdentity("batchTrigger")
            .forJob("batchJob")
            .withSchedule(CronScheduleBuilder.cronSchedule("0 0 2 * * ?")
                .withMisfireHandlingInstructionIgnoreMisfires() // Run all missed
            )
            .build();
    }
}
```

## Testing Quartz Jobs

```java
@SpringBootTest
class EmailJobTest {
    @Autowired
    private Scheduler scheduler;

    @Test
    void shouldExecuteEmailJob() throws Exception {
        JobDetail jobDetail = JobBuilder.newJob(EmailJob.class)
            .withIdentity("testEmailJob")
            .usingJobData("template", "test")
            .usingJobData("recipient", "test@example.com")
            .usingJobData("retryCount", 1)
            .build();

        SimpleTrigger trigger = TriggerBuilder.newTrigger()
            .forJob(jobDetail)
            .withIdentity("testTrigger")
            .startNow()
            .withSchedule(SimpleScheduleBuilder.simpleSchedule()
                .withRepeatCount(0))
            .build();

        scheduler.scheduleJob(jobDetail, trigger);

        // Wait for execution
        Thread.sleep(2000);

        // Verify job ran
        assertThat(scheduler.getCurrentlyExecutingJobs()).isEmpty();
    }
}
```

## Best Practices

1. **Use persistent job store** for production to survive restarts
2. **Configure clustering** for high availability
3. **Handle misfires appropriately** based on job criticality
4. **Use JobDataMap for parameterization** instead of hard-coding
5. **Implement job listeners** for monitoring and logging
6. **Set appropriate thread pool size** based on concurrent job needs
7. **Use @DisallowConcurrentExecution** for jobs that shouldn't run in parallel

## Common Mistakes

### Mistake 1: Not Configuring Misfire Handling

```java
// Wrong: Default misfire handling may not be appropriate
@Bean
public Trigger trigger() {
    return TriggerBuilder.newTrigger()
        .withIdentity("criticalTrigger")
        .forJob("criticalJob")
        .withSchedule(CronScheduleBuilder.cronSchedule("0 */5 * * * ?"))
        .build();
    // Default: misfired jobs might be lost
}
```

The default misfire handling for cron triggers is `withMisfireHandlingInstructionFireAndProceed`, which fires immediately and then continues with the next scheduled time. This may not be appropriate: for critical jobs, you might want to fire all missed runs; for non-critical ones, you might want to skip and wait for the next schedule.

```java
// Correct: Explicit misfire handling
@Bean
public Trigger trigger() {
    return TriggerBuilder.newTrigger()
        .withIdentity("criticalTrigger")
        .forJob("criticalJob")
        .withSchedule(CronScheduleBuilder.cronSchedule("0 */5 * * * ?")
            .withMisfireHandlingInstructionFireAndProceed()
        )
        .build();
}
```

### Mistake 2: Non-Disallow Concurrent Jobs

```java
// Wrong: Job can run concurrently causing data issues
@Component
public class DataSyncJob extends QuartzJobBean {
    @Override
    protected void executeInternal(JobExecutionContext context) {
        syncData(); // Can run multiple times concurrently
    }
}
```

If the job takes longer than its trigger interval, a second instance starts while the first is still running. For data synchronization jobs, this causes race conditions and duplicate processing. The `@DisallowConcurrentExecution` annotation prevents this by blocking subsequent executions until the current one finishes.

```java
// Correct: Prevent concurrent execution
@Component
@DisallowConcurrentExecution
public class DataSyncJob extends QuartzJobBean {
    @Override
    protected void executeInternal(JobExecutionContext context) {
        syncData(); // Waits for previous execution to complete
    }
}
```

## Summary

Quartz provides enterprise-grade job scheduling with persistence, clustering, and flexible triggering. Integrate it with Spring Boot using the spring-boot-starter-quartz dependency, configure persistent job stores for production, handle misfires appropriately, and use clustering for high availability. Always use @DisallowConcurrentExecution for jobs that modify shared data.

## References

- [Spring Boot Quartz Integration](https://docs.spring.io/spring-boot/reference/io/quartz.html)
- [Quartz Scheduler Documentation](http://www.quartz-scheduler.org/documentation/)
- [Cron Expression Reference](http://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html)
- [Quartz Clustering](http://www.quartz-scheduler.org/documentation/quartz-2.3.0/configuration/ConfigJobStoreTX.html)

Happy Coding
