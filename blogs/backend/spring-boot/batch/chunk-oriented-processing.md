---
title: "Chunk-Oriented Processing in Spring Batch"
description: "Deep dive into chunk-oriented processing: commit intervals, skip/retry within chunks, chunk listeners, multi-threaded steps, and partitioning"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - spring-batch
  - chunk-processing
  - batch-processing
coverImage: "/images/chunk-oriented-processing.png"
draft: false
---

## Overview

Chunk-oriented processing is the core processing model in Spring Batch. Items are read one at a time, processed, and accumulated into a chunk. When the chunk reaches the configured size, it is written as a single unit within a transaction. This approach provides efficient, transaction-safe batch processing.

## How Chunk Processing Works

```
Read  ->  Read  ->  Read  ->  ...  ->  Chunk Full
                                           |
                                           v
                                     Process -> Process -> ... (within transaction)
                                           |
                                           v
                                     Write (entire chunk)
                                           |
                                           v
                                     Commit Transaction
```

## Basic Chunk Configuration

```java
@Configuration
public class ChunkProcessingConfig {

    @Bean
    public Job chunkJob(JobRepository jobRepository, Step chunkStep) {
        return new JobBuilder("chunkJob", jobRepository)
            .start(chunkStep)
            .build();
    }

    @Bean
    public Step chunkStep(JobRepository jobRepository,
                          PlatformTransactionManager transactionManager,
                          ItemReader<Transaction> reader,
                          ItemProcessor<Transaction, ValidatedTransaction> processor,
                          ItemWriter<ValidatedTransaction> writer) {
        return new StepBuilder("chunkStep", jobRepository)
            .<Transaction, ValidatedTransaction>chunk(50, transactionManager) // 50 items per chunk
            .reader(reader)
            .processor(processor)
            .writer(writer)
            .build();
    }
}
```

## Chunk Listeners

```java
@Component
public class ChunkExecutionListener implements ChunkListener {

    @Override
    public void beforeChunk(ChunkContext context) {
        StepContext stepContext = context.getStepContext();
        System.out.println("Starting chunk for step: " + stepContext.getStepName());
    }

    @Override
    public void afterChunk(StepContext context) {
        System.out.println("Chunk completed. Read count: " +
            context.getStepExecution().getReadCount());
    }

    @Override
    public void afterChunkError(ChunkContext context) {
        System.err.println("Chunk failed. Rolling back transaction.");
    }
}

// Register the listener
@Bean
public Step chunkStep(JobRepository jobRepository,
                      PlatformTransactionManager transactionManager,
                      ChunkExecutionListener listener) {
    return new StepBuilder("chunkStep", jobRepository)
        .<Input, Output>chunk(50, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .listener(listener)
        .build();
}
```

## Commit Interval Strategies

### Dynamic Commit Interval

```java
@Component
public class DynamicCommitIntervalPolicy extends DefaultCompletionPolicy {
    private int totalProcessed = 0;
    private int chunkSize = 10;

    @Override
    protected boolean isComplete(RepeatContext context, RepeatStatus result) {
        if (super.isComplete(context, result)) {
            return true;
        }
        // Adjust chunk size based on processing time
        long duration = System.currentTimeMillis() - getStartTime();
        if (duration > 1000 && chunkSize > 5) {
            chunkSize = Math.max(5, chunkSize / 2);
        } else if (duration < 100 && chunkSize < 100) {
            chunkSize = Math.min(100, chunkSize * 2);
        }
        return totalProcessed++ >= chunkSize;
    }
}

@Bean
public Step dynamicCommitStep(JobRepository jobRepository,
                              PlatformTransactionManager transactionManager) {
    return new StepBuilder("dynamicCommitStep", jobRepository)
        .<Input, Output>chunk(new DynamicCommitIntervalPolicy(), transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .build();
}
```

## Fault Tolerance in Chunks

### Complete Chunk Tolerant Configuration

```java
@Bean
public Step faultTolerantChunk(JobRepository jobRepository,
                                PlatformTransactionManager transactionManager) {
    return new StepBuilder("faultTolerantChunk", jobRepository)
        .<Transaction, ProcessedTransaction>chunk(100, transactionManager)
        .reader(transactionReader())
        .processor(transactionProcessor())
        .writer(transactionWriter())
        .faultTolerant()
        .skipLimit(50)
        .skip(InvalidTransactionException.class)
        .skip(ValidationException.class)
        .noSkip(IllegalStateException.class)
        .noSkip(OutOfMemoryError.class)
        .retryLimit(5)
        .retry(OptimisticLockingFailureException.class)
        .retry(DeadlockLoserDataAccessException.class)
        .noRetry(InvalidParameterException.class)
        .backOffPolicy(backOffPolicy())
        .build();
}

@Bean
public BackOffPolicy backOffPolicy() {
    ExponentialBackOffPolicy policy = new ExponentialBackOffPolicy();
    policy.setInitialInterval(1000);
    policy.setMultiplier(2.0);
    policy.setMaxInterval(30000);
    return policy;
}
```

### Custom Skip Policy

```java
@Component
public class ThresholdSkipPolicy implements SkipPolicy {
    private final Map<Class<? extends Throwable>, AtomicInteger> skipCounts = new ConcurrentHashMap<>();

    @Override
    public boolean shouldSkip(Throwable t, int skipCount) throws SkipLimitExceededException {
        Class<? extends Throwable> throwableClass = t.getClass();

        if (throwableClass == FatalBatchException.class) {
            return false; // Never skip fatal errors
        }

        int maxSkipForType = getMaxSkipForType(t);
        AtomicInteger count = skipCounts.computeIfAbsent(throwableClass, k -> new AtomicInteger(0));

        if (count.incrementAndGet() > maxSkipForType) {
            throw new SkipLimitExceededException("Skip limit exceeded for " +
                throwableClass.getSimpleName(), skipCount);
        }

        return true;
    }

    private int getMaxSkipForType(Throwable t) {
        if (t instanceof TransientDataAccessException) return 10;
        if (t instanceof ValidationException) return 5;
        if (t instanceof ParseException) return 3;
        return 1;
    }
}
```

## Multi-Threaded Chunk Processing

```java
@Configuration
public class MultiThreadedChunkConfig {

    @Bean
    public Step parallelChunkStep(JobRepository jobRepository,
                                   PlatformTransactionManager transactionManager) {
        return new StepBuilder("parallelChunkStep", jobRepository)
            .<Transaction, ProcessedTransaction>chunk(100, transactionManager)
            .reader(reader())
            .processor(processor())
            .writer(writer())
            .taskExecutor(taskExecutor())
            .throttleLimit(8) // Max 8 concurrent threads
            .build();
    }

    @Bean
    public TaskExecutor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("batch-");
        return executor;
    }
}
```

## Partitioning

### Master-Slave Partitioning

```java
@Configuration
public class PartitionedChunkConfig {

    @Bean
    public Step masterStep(JobRepository jobRepository,
                           Step slaveStep,
                           Partitioner partitioner) {
        return new StepBuilder("masterStep", jobRepository)
            .partitioner("slaveStep", partitioner)
            .step(slaveStep)
            .gridSize(4) // 4 partitions
            .taskExecutor(taskExecutor())
            .build();
    }

    @Bean
    public Step slaveStep(JobRepository jobRepository,
                          PlatformTransactionManager transactionManager) {
        return new StepBuilder("slaveStep", jobRepository)
            .<Transaction, ProcessedTransaction>chunk(100, transactionManager)
            .reader(partitionedReader(null, null)) // Configured at runtime
            .processor(processor())
            .writer(writer())
            .build();
    }

    @Bean
    public Partitioner partitioner() {
        return new ColumnRangePartitioner() {
            @Override
            public Map<String, ExecutionContext> partition(int gridSize) {
                Map<String, ExecutionContext> partitions = new HashMap<>(gridSize);
                int totalRecords = getTotalRecordCount();
                int partitionSize = totalRecords / gridSize;

                for (int i = 0; i < gridSize; i++) {
                    ExecutionContext context = new ExecutionContext();
                    context.putInt("startId", i * partitionSize);
                    context.putInt("endId", (i + 1) * partitionSize);
                    context.putInt("partition", i);
                    partitions.put("partition-" + i, context);
                }
                return partitions;
            }
        };
    }

    @StepScope
    @Bean
    public JdbcCursorItemReader<Transaction> partitionedReader(
            @Value("#{stepExecutionContext['startId']}") Integer startId,
            @Value("#{stepExecutionContext['endId']}") Integer endId) {
        return new JdbcCursorItemReaderBuilder<Transaction>()
            .name("partitionedReader")
            .dataSource(dataSource)
            .sql("SELECT * FROM transactions WHERE id BETWEEN ? AND ? ORDER BY id")
            .preparedStatementSetter((ps) -> {
                ps.setInt(1, startId);
                ps.setInt(2, endId);
            })
            .rowMapper(new BeanPropertyRowMapper<>(Transaction.class))
            .build();
    }
}
```

## Reprocessing Failed Chunks

```java
@Component
public class ChunkReprocessor {
    private final JobRepository jobRepository;
    private final JobLauncher jobLauncher;

    public ChunkReprocessor(JobRepository jobRepository, JobLauncher jobLauncher) {
        this.jobRepository = jobRepository;
        this.jobLauncher = jobLauncher;
    }

    public void reprocessFailedChunks(Long jobExecutionId) {
        JobExecution jobExecution = jobRepository.getJobExecution(jobExecutionId);

        jobExecution.getStepExecutions().stream()
            .filter(step -> step.getStatus() == BatchStatus.FAILED)
            .forEach(failedStep -> {
                List<Throwable> failures = failedStep.getFailureExceptions();
                for (Throwable t : failures) {
                    ChunkContext chunkContext = findChunkContext(failedStep, t);
                    if (chunkContext != null) {
                        reprocessChunk(chunkContext);
                    }
                }
            });
    }

    private ChunkContext findChunkContext(StepExecution stepExecution, Throwable failure) {
        // Locate the specific chunk context from execution context
        return null;
    }

    private void reprocessChunk(ChunkContext context) {
        // Isolate and reprocess the failed chunk
    }
}
```

## Chunk Metrics

```java
@Component
public class ChunkMetricsListener implements ChunkListener {
    private final MeterRegistry meterRegistry;

    public ChunkMetricsListener(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @Override
    public void beforeChunk(ChunkContext context) {
        // Start timing
    }

    @Override
    public void afterChunk(StepContext context) {
        StepExecution stepExecution = context.getStepExecution();
        meterRegistry.counter("batch.chunks.completed",
            "job", stepExecution.getJobExecution().getJobInstance().getJobName(),
            "step", stepExecution.getStepName()
        ).increment();

        meterRegistry.gauge("batch.chunk.size",
            stepExecution,
            se -> se.getWriteCount()
        );
    }

    @Override
    public void afterChunkError(ChunkContext context) {
        meterRegistry.counter("batch.chunks.error").increment();
    }
}
```

## Best Practices

1. **Choose appropriate chunk size** - 10-100 for DB operations, 100-1000 for file processing
2. **Use fault tolerance** with skip/retry for transient failures
3. **Monitor chunk performance** - track read/write counts and times
4. **Use partitioning** for large datasets to parallelize processing
5. **Configure commit intervals** based on transaction overhead
6. **Avoid state in processors** - use execution context for shared state
7. **Benchmark different chunk sizes** for optimal throughput

## Common Mistakes

### Mistake 1: Too Large Chunk Size

```java
// Wrong: Gigantic chunk exhausts memory
@Bean
public Step bigChunkStep(JobRepository jobRepository,
                          PlatformTransactionManager transactionManager) {
    return new StepBuilder("bigChunkStep", jobRepository)
        .<Transaction, ProcessedTransaction>chunk(100000, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .build();
}
```

```java
// Correct: Balanced chunk size
@Bean
public Step balancedChunkStep(JobRepository jobRepository,
                               PlatformTransactionManager transactionManager) {
    return new StepBuilder("balancedChunkStep", jobRepository)
        .<Transaction, ProcessedTransaction>chunk(100, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .build();
}
```

### Mistake 2: Not Handling Rollback Correctly

```java
// Wrong: Rollback clears entire chunk including successfully processed items
@Bean
public Step noSkipStep(JobRepository jobRepository,
                        PlatformTransactionManager transactionManager) {
    return new StepBuilder("noSkipStep", jobRepository)
        .<Item, Item>chunk(50, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .build();
    // Any error rolls back ALL 50 items
}
```

```java
// Correct: Use skip to avoid full rollback
@Bean
public Step skipStep(JobRepository jobRepository,
                      PlatformTransactionManager transactionManager) {
    return new StepBuilder("skipStep", jobRepository)
        .<Item, Item>chunk(50, transactionManager)
        .reader(reader())
        .processor(processor())
        .writer(writer())
        .faultTolerant()
        .skipLimit(10)
        .skip(ProcessingException.class)
        .listener(new SkipListener<>() {
            @Override
            public void onSkipInProcess(Item item, Throwable t) {
                log.warn("Skipped item {}: {}", item, t.getMessage());
            }
        })
        .build();
}
```

## Summary

Chunk-oriented processing is Spring Batch's most powerful processing model. It provides efficient, transaction-safe batch processing with configurable chunk sizes, fault tolerance, and parallel processing capabilities. Use appropriate chunk sizes, configure skip/retry for resilience, and leverage partitioning for large-scale data processing.

## References

- [Spring Batch Chunk Processing](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing.html)
- [Configuring Skip/Retry](https://docs.spring.io/spring-batch/reference/step/skip-retry-listeners.html)
- [Multi-Threaded Steps](https://docs.spring.io/spring-batch/reference/step/multi-threaded-step.html)
- [Partitioning](https://docs.spring.io/spring-batch/reference/step/partitioning.html)

Happy Coding