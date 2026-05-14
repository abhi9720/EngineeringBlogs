---
title: "Spring Batch Introduction"
description: "Master Spring Batch fundamentals: JobRepository, JobLauncher, steps, readers, writers, and building robust batch processing applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - spring-batch
  - batch-processing
  - etl
coverImage: "/images/spring-batch-introduction.png"
draft: false
---

## Overview

Spring Batch is a lightweight, comprehensive batch framework for processing large volumes of data. It provides reusable functions for logging/tracing, transaction management, job processing statistics, job restart, skip, and resource management.

## Core Concepts

### Architecture

```
Job Launcher
    |
    v
   Job -----> JobInstance
    |
    +-- Step 1: Read -> Process -> Write (Chunk-oriented)
    |
    +-- Step 2: Read -> Process -> Write
    |
    +-- Step 3: Tasklet
```

## Dependencies

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-batch</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
<!-- For job repository -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
```

## Basic Job Configuration

```java
@Configuration
@EnableBatchProcessing
public class BatchConfig {

    @Bean
    public Job importUserJob(JobRepository jobRepository,
                             Step importUserStep,
                             JobCompletionNotificationListener listener) {
        return new JobBuilder("importUserJob", jobRepository)
            .incrementer(new RunIdIncrementer())
            .listener(listener)
            .start(importUserStep)
            .build();
    }

    @Bean
    public Step importUserStep(JobRepository jobRepository,
                               PlatformTransactionManager transactionManager,
                               ItemReader<User> reader,
                               ItemProcessor<User, User> processor,
                               ItemWriter<User> writer) {
        return new StepBuilder("importUserStep", jobRepository)
            .<User, User>chunk(10, transactionManager)
            .reader(reader)
            .processor(processor)
            .writer(writer)
            .faultTolerant()
            .skipLimit(5)
            .skip(InvalidDataException.class)
            .retryLimit(3)
            .retry(TransientDataAccessException.class)
            .build();
    }
}
```

### Job Completion Listener

```java
@Component
public class JobCompletionNotificationListener extends JobExecutionListenerSupport {

    @Override
    public void beforeJob(JobExecution jobExecution) {
        System.out.println("Job started: " + jobExecution.getJobInstance().getJobName());
    }

    @Override
    public void afterJob(JobExecution jobExecution) {
        if (jobExecution.getStatus() == BatchStatus.COMPLETED) {
            System.out.println("Job completed successfully");
        } else {
            System.out.println("Job failed with status: " + jobExecution.getStatus());
            for (Throwable t : jobExecution.getAllFailureExceptions()) {
                System.err.println("  - " + t.getMessage());
            }
        }
    }
}
```

## Item Reader

### Flat File Reader

```java
@Bean
public FlatFileItemReader<User> userItemReader() {
    return new FlatFileItemReaderBuilder<User>()
        .name("userItemReader")
        .resource(new ClassPathResource("data/users.csv"))
        .delimited()
        .names("firstName", "lastName", "email", "age")
        .targetType(User.class)
        .linesToSkip(1)
        .recordSeparatorPolicy(new DefaultRecordSeparatorPolicy())
        .build();
}
```

### Database Reader

```java
@Bean
public JdbcCursorItemReader<User> databaseReader(DataSource dataSource) {
    return new JdbcCursorItemReaderBuilder<User>()
        .name("databaseReader")
        .dataSource(dataSource)
        .sql("SELECT id, first_name, last_name, email, age FROM users WHERE active = true")
        .rowMapper(new BeanPropertyRowMapper<>(User.class))
        .fetchSize(100)
        .build();
}

@Bean
public JpaPagingItemReader<User> jpaReader(EntityManagerFactory entityManagerFactory) {
    return new JpaPagingItemReaderBuilder<User>()
        .name("jpaReader")
        .entityManagerFactory(entityManagerFactory)
        .queryString("SELECT u FROM User u WHERE u.active = true")
        .pageSize(50)
        .build();
}
```

## Item Processor

```java
@Component
public class UserValidationProcessor implements ItemProcessor<User, ValidatedUser> {

    @Override
    public ValidatedUser process(User user) throws Exception {
        if (user.getEmail() == null || user.getEmail().isBlank()) {
            throw new InvalidDataException("Email is required for user: " + user.getFirstName());
        }

        if (user.getAge() < 18) {
            return null; // Skip underage users
        }

        ValidatedUser validated = new ValidatedUser();
        validated.setFullName(user.getFirstName() + " " + user.getLastName());
        validated.setEmail(user.getEmail().toLowerCase());
        validated.setAge(user.getAge());
        validated.setProcessedAt(LocalDateTime.now());
        validated.setStatus(UserStatus.ACTIVE);

        return validated;
    }
}
```

## Item Writer

```java
@Bean
public JdbcBatchItemWriter<ValidatedUser> databaseWriter(DataSource dataSource) {
    return new JdbcBatchItemWriterBuilder<ValidatedUser>()
        .dataSource(dataSource)
        .sql("INSERT INTO validated_users (full_name, email, age, processed_at, status) " +
             "VALUES (:fullName, :email, :age, :processedAt, :status)")
        .beanMapped()
        .build();
}

@Bean
public FlatFileItemWriter<ValidatedUser> flatFileWriter() {
    return new FlatFileItemWriterBuilder<ValidatedUser>()
        .name("userItemWriter")
        .resource(new FileSystemResource("output/validated_users.csv"))
        .delimited()
        .delimiter(",")
        .names("fullName", "email", "age", "processedAt", "status")
        .headerCallback(writer -> writer.write("Full Name,Email,Age,Processed At,Status"))
        .footerCallback(writer -> writer.write("End of file"))
        .shouldDeleteIfExists(true)
        .build();
}
```

## Running Jobs

```java
@SpringBootApplication
public class BatchApplication implements CommandLineRunner {
    @Autowired
    private JobLauncher jobLauncher;

    @Autowired
    private Job importUserJob;

    public static void main(String[] args) {
        SpringApplication.run(BatchApplication.class, args);
    }

    @Override
    public void run(String... args) throws Exception {
        JobParameters params = new JobParametersBuilder()
            .addString("JobID", String.valueOf(System.currentTimeMillis()))
            .addString("source", "csv")
            .addDate("date", new Date())
            .toJobParameters();

        JobExecution execution = jobLauncher.run(importUserJob, params);
        System.out.println("Exit Status: " + execution.getStatus());
    }
}
```

### Scheduled Jobs

```java
@Component
public class ScheduledJobLauncher {
    private final JobLauncher jobLauncher;
    private final Job reportGenerationJob;

    public ScheduledJobLauncher(JobLauncher jobLauncher,
                               @Qualifier("reportGenerationJob") Job job) {
        this.jobLauncher = jobLauncher;
        this.reportGenerationJob = job;
    }

    @Scheduled(cron = "0 0 2 * * ?") // Run at 2 AM daily
    public void runDailyReport() {
        JobParameters params = new JobParametersBuilder()
            .addString("trigger", "scheduled")
            .addString("date", LocalDate.now().toString())
            .toJobParameters();

        try {
            jobLauncher.run(reportGenerationJob, params);
        } catch (Exception e) {
            System.err.println("Scheduled job failed: " + e.getMessage());
        }
    }
}
```

## Job Parameters and Execution Context

```java
@Component
public class ParameterValidationTasklet implements Tasklet {
    @Override
    public RepeatStatus execute(StepContribution contribution,
                                ChunkContext chunkContext) throws Exception {
        JobParameters params = chunkContext.getStepContext()
            .getJobParameters();

        String source = params.getString("source");
        String target = params.getString("target");

        if (source == null || target == null) {
            throw new IllegalArgumentException("Source and target parameters required");
        }

        // Store in execution context for later steps
        chunkContext.getStepContext()
            .getStepExecution()
            .getJobExecution()
            .getExecutionContext()
            .put("sourceFile", source);

        return RepeatStatus.FINISHED;
    }
}
```

## Multi-Step Jobs

```java
@Configuration
public class MultiStepJobConfig {

    @Bean
    public Job multiStepJob(JobRepository jobRepository,
                            Step validateStep,
                            Step processStep,
                            Step aggregateStep,
                            Step notifyStep) {
        return new JobBuilder("multiStepJob", jobRepository)
            .start(validateStep)
            .next(processStep)
            .next(aggregateStep)
            .next(notifyStep)
            .build();
    }

    @Bean
    public Step notifyStep(JobRepository jobRepository,
                           PlatformTransactionManager transactionManager) {
        return new StepBuilder("notifyStep", jobRepository)
            .tasklet(notificationTasklet(), transactionManager)
            .build();
    }

    @Bean
    public Tasklet notificationTasklet() {
        return (contribution, chunkContext) -> {
            String source = chunkContext.getStepContext()
                .getJobExecutionContext()
                .getString("sourceFile");

            System.out.println("Sending notification for processed file: " + source);
            // Send email notification
            return RepeatStatus.FINISHED;
        };
    }
}
```

## Testing Batch Jobs

```java
@SpringBootTest
class UserImportJobTest {
    @Autowired
    private JobLauncherTestUtils jobLauncherTestUtils;

    @Test
    void testImportUserJob() throws Exception {
        JobExecution jobExecution = jobLauncherTestUtils.launchJob(
            new JobParametersBuilder()
                .addString("testId", UUID.randomUUID().toString())
                .toJobParameters()
        );

        assertThat(jobExecution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
    }

    @Test
    void testImportUserStep() {
        JobExecution jobExecution = jobLauncherTestUtils.launchStep("importUserStep");

        assertThat(jobExecution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        StepExecution stepExecution = jobExecution.getStepExecutions().iterator().next();
        assertThat(stepExecution.getReadCount()).isGreaterThan(0);
        assertThat(stepExecution.getWriteCount()).isEqualTo(stepExecution.getReadCount());
    }
}
```

## Best Practices

1. **Use chunk-oriented processing** for large datasets instead of tasklets
2. **Configure skip and retry** for fault tolerance
3. **Use JobParameters** for job identification and restartability
4. **Monitor job execution** with Spring Batch Admin or custom listeners
5. **Set appropriate chunk sizes** based on data volume and memory
6. **Use partitioning** for parallel processing of large datasets
7. **Always test jobs** with JobLauncherTestUtils

## Common Mistakes

### Mistake 1: Not Configuring Fault Tolerance

```java
// Wrong: No skip or retry configuration
@Bean
public Step fragileStep(JobRepository jobRepository,
                         PlatformTransactionManager transactionManager) {
    return new StepBuilder("fragileStep", jobRepository)
        .<User, User>chunk(10, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .build(); // Any error fails the entire step
}
```

```java
// Correct: Configure skip and retry
@Bean
public Step resilientStep(JobRepository jobRepository,
                           PlatformTransactionManager transactionManager) {
    return new StepBuilder("resilientStep", jobRepository)
        .<User, User>chunk(10, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .faultTolerant()
        .skipLimit(10)
        .skip(InvalidDataException.class)
        .noSkip(FileNotFoundException.class)
        .retryLimit(3)
        .retry(DeadlockLoserDataAccessException.class)
        .build();
}
```

### Mistake 2: Stateful Processor with Chunks

```java
// Wrong: Processor maintains state across chunks
@Component
public class StatefulProcessor implements ItemProcessor<User, User> {
    private int count = 0; // State shared across chunks

    @Override
    public User process(User user) {
        count++;
        return user;
    }
}
```

```java
// Correct: Use execution context for state
@Component
public class StatelessProcessor implements ItemProcessor<User, User> {
    @Override
    public User process(User user) {
        return user;
    }
}
```

## Summary

Spring Batch provides a robust framework for batch processing with support for chunk-oriented processing, fault tolerance, job restart, and multiple I/O formats. Use the Spring Batch domain objects (Job, Step, ItemReader, ItemProcessor, ItemWriter) to build reliable, scalable batch applications.

## References

- [Spring Batch Documentation](https://docs.spring.io/spring-batch/reference/index.html)
- [Spring Batch Domain Model](https://docs.spring.io/spring-batch/reference/domain.html)
- [ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-writers.html)
- [Configuring Steps](https://docs.spring.io/spring-batch/reference/step.html)

Happy Coding