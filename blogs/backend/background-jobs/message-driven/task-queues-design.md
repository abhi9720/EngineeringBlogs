---
title: "Task Queue Design Patterns"
description: "Design patterns for task queues: prioritization, retry strategies, dead-letter queues, and worker scaling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["task-queues", "design-patterns", "background-jobs", "workers"]
coverImage: "/images/task-queues-design.png"
draft: false
---

## Overview

Task queues are the backbone of asynchronous processing in distributed systems. They decouple work production from work consumption, enabling reliable background processing at scale. However, designing task queues that handle failures gracefully, maintain ordering guarantees, and scale efficiently requires careful consideration of several patterns.

This post covers the essential design patterns for production task queues: prioritization, retry with backoff, dead-letter queues, worker scaling, and idempotency.

## Core Queue Pattern

### Basic Producer-Consumer

The producer-consumer pattern shown here illustrates three important RabbitMQ practices. First, `DeliveryMode.PERSISTENT` ensures messages survive a broker restart — without it, messages live only in memory. Second, the consumer uses `Channel`-level acknowledgements (`basicAck`/`basicNack`) rather than automatic acknowledgement, which gives the consumer control over redelivery. Third, exception-driven routing is implemented via two `basicNack` variants: `requeue=true` for `RetryableException` (the message goes back to the queue for another attempt) and `requeue=false` for `FatalException` (the message is discarded or routed to a dead-letter exchange). This pattern is the foundation on which more sophisticated retry and DLQ mechanisms are built.

```java
// Message producer
@Component
public class TaskProducer {

    private final RabbitTemplate rabbitTemplate;

    public TaskProducer(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public void enqueue(QueueableTask task) {
        MessageProperties props = new MessageProperties();
        props.setMessageId(task.getId());
        props.setTimestamp(Date.from(task.getCreatedAt()));
        props.setContentType("application/json");
        props.setDeliveryMode(MessageDeliveryMode.PERSISTENT);

        Message message = MessageBuilder
            .withBody(serialize(task))
            .andProperties(props)
            .build();

        rabbitTemplate.send(task.getExchange(), task.getRoutingKey(), message);
        log.info("Enqueued task: {} to {}:{}", task.getId(), 
            task.getExchange(), task.getRoutingKey());
    }

    private byte[] serialize(QueueableTask task) {
        try {
            return objectMapper.writeValueAsBytes(task);
        } catch (JsonProcessingException e) {
            throw new TaskSerializationException("Failed to serialize task", e);
        }
    }
}

// Message consumer
@Component
public class TaskConsumer {

    private final Map<String, TaskHandler> handlers;

    public TaskConsumer(List<TaskHandler> handlers) {
        this.handlers = handlers.stream()
            .collect(Collectors.toMap(
                TaskHandler::getTaskType,
                Function.identity()
            ));
    }

    @RabbitListener(queues = "${queue.task.default}")
    public void handleTask(Message message, Channel channel) {
        String taskType = message.getMessageProperties().getType();
        TaskHandler handler = handlers.get(taskType);

        if (handler == null) {
            log.error("No handler found for task type: {}", taskType);
            channel.basicNack(message.getMessageProperties().getDeliveryTag(), 
                false, false);
            return;
        }

        try {
            QueueableTask task = deserialize(message);
            handler.handle(task);
            channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
        } catch (RetryableException e) {
            log.warn("Retryable error processing task: {}", e.getMessage());
            channel.basicNack(message.getMessageProperties().getDeliveryTag(), 
                false, true);
        } catch (FatalException e) {
            log.error("Fatal error processing task: {}", e.getMessage());
            channel.basicNack(message.getMessageProperties().getDeliveryTag(), 
                false, false);
        }
    }
}
```

## Priority Queuing

### Priority Queue Configuration

Three separate queues provide strict priority isolation — tasks in the `high` queue are always consumed before `medium` or `low` tasks, regardless of how many low-priority tasks are backlogged. The `maxPriority` attribute on each queue limits how many priority levels are supported (10 for high, 5 for medium). This approach is simpler than a single queue with message-level priorities, which requires consumers to scan for the highest-priority message, adding overhead. The trade-off is operational complexity: you now have three queues to monitor, three sets of consumers to configure, and the question of what happens to high-priority tasks when all high-priority consumers are busy — they back up in the high queue while lower-priority consumers sit idle.

```java
@Configuration
public class PriorityQueueConfiguration {

    @Bean
    public Queue highPriorityQueue() {
        return QueueBuilder.durable("tasks.high")
            .maxPriority(10)
            .build();
    }

    @Bean
    public Queue mediumPriorityQueue() {
        return QueueBuilder.durable("tasks.medium")
            .maxPriority(5)
            .build();
    }

    @Bean
    public Queue lowPriorityQueue() {
        return QueueBuilder.durable("tasks.low")
            .build();
    }

    @Bean
    public DirectExchange taskExchange() {
        return new DirectExchange("task.exchange");
    }

    @Bean
    public Binding highBinding() {
        return BindingBuilder.bind(highPriorityQueue())
            .to(taskExchange()).with("high");
    }

    @Bean
    public Binding mediumBinding() {
        return BindingBuilder.bind(mediumPriorityQueue())
            .to(taskExchange()).with("medium");
    }

    @Bean
    public Binding lowBinding() {
        return BindingBuilder.bind(lowPriorityQueue())
            .to(taskExchange()).with("low");
    }
}

@Component
public class PriorityTaskProducer {

    private final RabbitTemplate rabbitTemplate;

    public void enqueueWithPriority(QueueableTask task, TaskPriority priority) {
        String routingKey = switch (priority) {
            case HIGH -> "high";
            case MEDIUM -> "medium";
            case LOW -> "low";
        };

        MessageProperties props = new MessageProperties();
        props.setPriority(priority.ordinal());
        props.setMessageId(task.getId());

        rabbitTemplate.send("task.exchange", routingKey,
            MessageBuilder.withBody(serialize(task))
                .andProperties(props)
                .build());
    }
}
```

## Retry Pattern with Exponential Backoff

Two retry strategies are shown here. The first uses Spring's `RetryTemplate` for in-process retry — the consumer thread retries the failed operation up to 5 times with an exponential backoff starting at 1 second and doubling each time, capped at 30 seconds. This works well for transient failures (database deadlocks, network timeouts) but blocks the consumer thread during the backoff window. The second strategy uses RabbitMQ's dead-letter exchange mechanism for out-of-process retry: failed messages from `tasks.main` are routed to `tasks.retry`, which has a 30-second TTL, then automatically re-routed back to the main queue. This frees the consumer thread immediately but is more complex to configure and introduces latency from the TTL-based redelivery.

```java
@Component
public class RetryHandler {

    private final RetryTemplate retryTemplate;

    public RetryHandler() {
        this.retryTemplate = RetryTemplate.builder()
            .maxAttempts(5)
            .exponentialBackoff(1000, 2.0, 30000)
            .retryOn(RetryableException.class)
            .build();
    }

    public <T> T executeWithRetry(Supplier<T> operation, String taskId) {
        return retryTemplate.execute(context -> {
            log.info("Attempt {} for task {}", context.getRetryCount() + 1, taskId);
            return operation.get();
        }, context -> {
            log.warn("Retry {} failed for task {}", context.getRetryCount(), taskId);
            return null;
        });
    }
}

// RabbitMQ retry with DLQ
@Configuration
public class RetryQueueConfiguration {

    public static final String MAIN_QUEUE = "tasks.main";
    public static final String RETRY_QUEUE = "tasks.retry";
    public static final String DLQ = "tasks.dlq";
    public static final String RETRY_EXCHANGE = "task.retry.exchange";

    @Bean
    public Queue mainQueue() {
        return QueueBuilder.durable(MAIN_QUEUE)
            .deadLetterExchange(RETRY_EXCHANGE)
            .deadLetterRoutingKey("retry")
            .build();
    }

    @Bean
    public Queue retryQueue() {
        return QueueBuilder.durable(RETRY_QUEUE)
            .deadLetterExchange("")
            .deadLetterRoutingKey(MAIN_QUEUE)
            .ttl(30000)
            .build();
    }

    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable(DLQ).build();
    }

    @Bean
    public DirectExchange retryExchange() {
        return new DirectExchange(RETRY_EXCHANGE);
    }

    @Bean
    public Binding retryBinding() {
        return BindingBuilder.bind(retryQueue())
            .to(retryExchange()).with("retry");
    }
}

@Component
public class RetryAwareConsumer {

    @RetryableTopic(
        attempts = "5",
        backoff = @Backoff(delay = 1000, multiplier = 2.0),
        dltStrategy = DltStrategy.FAIL_ON_ERROR,
        autoCreateTopics = "false",
        retryTopicSuffix = ".retry",
        dltTopicSuffix = ".dlq"
    )
    @RabbitListener(queues = "tasks.main")
    public void handleTask(QueueableTask task) {
        processTask(task);
    }

    @DltHandler
    public void handleDlt(QueueableTask task) {
        log.error("Task moved to DLQ after all retries: {}", task.getId());
        alertService.notifyTeam("Task failed permanently", task);
    }
}
```

## Dead Letter Queue Pattern

```java
@Component
public class DeadLetterHandler {

    private final DeadLetterRepository dlqRepository;
    private final AlertService alertService;

    public DeadLetterHandler(DeadLetterRepository dlqRepository, AlertService alertService) {
        this.dlqRepository = dlqRepository;
        this.alertService = alertService;
    }

    @RabbitListener(queues = "tasks.dlq")
    public void handleDeadLetter(Message message) {
        DeadLetterInfo info = extractDeadLetterInfo(message);

        dlqRepository.save(new DeadLetterRecord(
            info.originalQueue(),
            info.getOriginalRoutingKey(),
            info.getReason(),
            info.getFirstDeathExchange(),
            info.getFirstDeathQueue(),
            info.getFirstDeathReason(),
            info.getCount(),
            info.getStackTrace(),
            Instant.now()
        ));

        alertService.warning(
            "Task moved to DLQ",
            Map.of(
                "queue", info.originalQueue(),
                "reason", info.getReason(),
                "count", info.getCount()
            )
        );

        log.warn("Task dead-lettered: queue={}, reason={}, count={}",
            info.originalQueue(), info.getReason(), info.getCount());
    }

    public void reprocessDeadLetter(Long recordId) {
        DeadLetterRecord record = dlqRepository.findById(recordId)
            .orElseThrow(() -> new RecordNotFoundException(recordId));

        try {
            Message message = deserialize(record.getMessageBody());
            rabbitTemplate.send(record.getOriginalExchange(),
                record.getOriginalRoutingKey(), message);
            dlqRepository.markAsReprocessed(recordId);
            log.info("Reprocessed dead letter record: {}", recordId);
        } catch (Exception e) {
            throw new ReprocessFailedException("Failed to reprocess record: " + recordId, e);
        }
    }

    private DeadLetterInfo extractDeadLetterInfo(Message message) {
        MessageProperties props = message.getMessageProperties();
        return new DeadLetterInfo(
            (String) props.getHeader("x-first-death-queue"),
            (String) props.getHeader("x-death"),
            (Long) props.getHeader("x-death-count")
        );
    }
}
```

## Worker Scaling Pattern

```java
@Component
public class DynamicWorkerScaler {

    private final ThreadPoolTaskExecutor taskExecutor;
    private final QueueMetrics queueMetrics;
    private final int minWorkers;
    private final int maxWorkers;

    public DynamicWorkerScaler(
            ThreadPoolTaskExecutor taskExecutor,
            QueueMetrics queueMetrics,
            @Value("${worker.min:5}") int minWorkers,
            @Value("${worker.max:20}") int maxWorkers) {
        this.taskExecutor = taskExecutor;
        this.queueMetrics = queueMetrics;
        this.minWorkers = minWorkers;
        this.maxWorkers = maxWorkers;
    }

    @Scheduled(fixedRate = 10000)
    public void adjustWorkerCount() {
        int queueDepth = queueMetrics.getQueueDepth();
        int currentPoolSize = taskExecutor.getPoolSize();
        int activeCount = taskExecutor.getActiveCount();

        if (queueDepth > 100 && currentPoolSize < maxWorkers) {
            int newSize = Math.min(currentPoolSize + 5, maxWorkers);
            taskExecutor.setCorePoolSize(newSize);
            taskExecutor.setMaxPoolSize(newSize);
            log.info("Scaling up workers from {} to {} (queue depth: {})",
                currentPoolSize, newSize, queueDepth);
        } else if (queueDepth < 10 && activeCount < currentPoolSize / 2 
                   && currentPoolSize > minWorkers) {
            int newSize = Math.max(currentPoolSize - 5, minWorkers);
            taskExecutor.setCorePoolSize(newSize);
            taskExecutor.setMaxPoolSize(newSize);
            log.info("Scaling down workers from {} to {} (queue depth: {})",
                currentPoolSize, newSize, queueDepth);
        }
    }
}

@Component
public class QueueMetrics {

    private final RabbitManagementClient managementClient;

    public int getQueueDepth() {
        try {
            QueueInfo queueInfo = managementClient.getQueue("tasks.main");
            return queueInfo.getMessageCount();
        } catch (Exception e) {
            log.error("Failed to get queue depth", e);
            return 0;
        }
    }

    public Map<String, Object> getDetailedMetrics() {
        QueueInfo mainQueue = managementClient.getQueue("tasks.main");
        QueueInfo dlq = managementClient.getQueue("tasks.dlq");
        QueueInfo retryQueue = managementClient.getQueue("tasks.retry");

        return Map.of(
            "main_queue_depth", mainQueue.getMessageCount(),
            "main_queue_consumers", mainQueue.getConsumerCount(),
            "dlq_depth", dlq.getMessageCount(),
            "retry_queue_depth", retryQueue.getMessageCount(),
            "publish_rate", mainQueue.getPublishRate(),
            "delivery_rate", mainQueue.getDeliveryRate()
        );
    }
}
```

## Idempotent Task Processing

```java
@Component
public class IdempotentTaskProcessor {

    private final Set<String> processedIds = Collections.newSetFromMap(
        new ConcurrentHashMap<>());

    public boolean tryProcess(String taskId, Runnable task) {
        if (processedIds.contains(taskId)) {
            log.info("Task {} already processed, skipping", taskId);
            return true;
        }

        synchronized (taskId.intern()) {
            if (processedIds.contains(taskId)) {
                return true;
            }

            try {
                task.run();
                processedIds.add(taskId);
                return true;
            } catch (Exception e) {
                log.error("Task {} failed: {}", taskId, e.getMessage());
                return false;
            }
        }
    }

    @Scheduled(fixedRate = 3600000)
    public void cleanupProcessedIds() {
        processedIds.clear();
    }
}

// Database-backed idempotency
@Component
public class DatabaseIdempotencyChecker {

    private final JdbcTemplate jdbcTemplate;

    public boolean isProcessed(String taskId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM processed_tasks WHERE task_id = ?",
            Integer.class, taskId);
        return count != null && count > 0;
    }

    public boolean markProcessed(String taskId, String taskType) {
        try {
            jdbcTemplate.update(
                "INSERT INTO processed_tasks (task_id, task_type, processed_at) VALUES (?, ?, ?)",
                taskId, taskType, Instant.now());
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    @Transactional
    public boolean processIfNotDone(String taskId, String taskType, Runnable task) {
        if (isProcessed(taskId)) {
            return true;
        }

        task.run();
        markProcessed(taskId, taskType);
        return true;
    }
}
```

## Common Mistakes

### Unbounded Queue Growth

```java
// Wrong: No limit on queue length
@Bean
public Queue unboundedQueue() {
    return new Queue("tasks.unbounded");
}
```

```java
// Correct: Set max queue length
@Bean
public Queue boundedQueue() {
    return QueueBuilder.durable("tasks.bounded")
        .maxLength(10000)
        .overflow(OverflowBehavior.REJECT_PUBLISH)
        .build();
}
```

### Blocking Worker Threads

```java
// Wrong: Worker blocks on external call
@RabbitListener(queues = "tasks")
public void handleTask(QueueableTask task) {
    externalApi.blockingCall(task.getData()); // Blocks consumer thread
}
```

```java
// Correct: Use async processing
@RabbitListener(queues = "tasks")
public void handleTask(QueueableTask task) {
    asyncExecutor.submit(() -> {
        try {
            externalApi.blockingCall(task.getData());
        } catch (Exception e) {
            log.error("Task failed: {}", task.getId(), e);
        }
    });
}
```

## Best Practices

1. Use separate queues for different task priorities and types.
2. Implement exponential backoff with maximum retry limits.
3. Always configure dead-letter queues for failed messages.
4. Make task processing idempotent for safe retries.
5. Monitor queue depths and set up alerts for backlog growth.
6. Set reasonable queue length limits to prevent unbounded growth.
7. Use persistent delivery mode for critical tasks.
8. Implement at-least-once delivery with idempotent consumers.

## Summary

Task queue design requires careful consideration of failure modes, ordering, prioritization, and scaling. Core patterns include priority routing, retry with exponential backoff, dead-letter queues, dynamic worker scaling, and idempotent processing. These patterns ensure reliable, resilient background processing that can handle production workloads.

## References

- "Enterprise Integration Patterns" by Gregor Hohpe and Bobby Woolf
- RabbitMQ Documentation: "Reliability Guide"
- "Building Event-Driven Microservices" by Adam Bellemare

Happy Coding