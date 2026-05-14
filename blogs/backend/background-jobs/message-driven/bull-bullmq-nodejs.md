---
title: "Bull and BullMQ for Node.js"
description: "Background job processing with Bull and BullMQ: queues, workers, rate limiting, and job lifecycle in Node.js"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["bull", "bullmq", "nodejs", "redis", "background-jobs"]
coverImage: "/images/bull-bullmq-nodejs.png"
draft: false
---

## Overview

Bull and BullMQ are Redis-based queue libraries for Node.js that provide robust background job processing. Bull is the original library, while BullMQ is a complete rewrite with improved TypeScript support, progress tracking, rate limiting, and job lifecycle management.

Both libraries use Redis as a backing store, ensuring jobs survive server restarts and can be distributed across multiple worker processes. This post covers setup, job lifecycle, advanced patterns, and best practices.

## Setting Up Bull

### Basic Queue and Worker

```javascript
const Queue = require('bull');

// Create a queue
const emailQueue = new Queue('email', {
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'optional-redis-auth'
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

// Add a job to the queue
async function sendWelcomeEmail(userId, email) {
  const job = await emailQueue.add(
    'welcome-email',
    { userId, email, template: 'welcome' },
    {
      priority: 1,
      delay: 1000,
      jobId: `welcome-${userId}`
    }
  );
  console.log(`Job ${job.id} added to queue`);
  return job;
}

// Process jobs
emailQueue.process('welcome-email', async (job) => {
  const { userId, email, template } = job.data;
  console.log(`Processing welcome email for ${email}`);

  // Update job progress
  job.progress(25);
  const html = await renderTemplate(template, { userId });

  job.progress(50);
  await emailService.send(email, 'Welcome!', html);

  job.progress(100);
  return { sent: true, email, timestamp: new Date() };
});

// Event handlers
emailQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

emailQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

emailQueue.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});
```

## BullMQ (Modern Approach)

### Queue and Worker with TypeScript

```typescript
import { Queue, Worker, QueueScheduler } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null
});

// Define job types
interface ReportJobData {
  reportType: 'daily' | 'weekly' | 'monthly';
  generatedAt: Date;
  userId: string;
  filters: Record<string, unknown>;
}

interface ReportJobResult {
  reportId: string;
  url: string;
  pages: number;
};

// Create queue
const reportQueue = new Queue<ReportJobData, ReportJobResult>('reports', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: {
      age: 3600 * 24
    },
    removeOnFail: {
      count: 50
    }
  }
});

// Create worker
const reportWorker = new Worker<ReportJobData, ReportJobResult>(
  'reports',
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.data.reportType}`);

    await job.updateProgress(10);
    const data = await fetchReportData(job.data);

    await job.updateProgress(40);
    const report = await generateReport(data, job.data.reportType);

    await job.updateProgress(70);
    const url = await uploadReport(report);

    await job.updateProgress(100);
    return {
      reportId: report.id,
      url,
      pages: report.pages
    };
  },
  {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000
    }
  }
);

reportWorker.on('completed', (job, result) => {
  console.log(`Report ${job.data.reportType} generated: ${result.url}`);
});

reportWorker.on('failed', (job, error) => {
  console.error(`Report generation failed: ${error.message}`);
});
```

## Advanced Job Lifecycle Management

```typescript
// Custom job scheduler
class ScheduledJobService {
  private readonly queue: Queue;
  private readonly scheduler: QueueScheduler;

  constructor(connection: IORedis) {
    this.queue = new Queue('scheduled-jobs', { connection });
    this.scheduler = new QueueScheduler('scheduled-jobs', { connection });
  }

  async scheduleRecurringJob(
    name: string,
    data: Record<string, unknown>,
    cronExpression: string
  ) {
    await this.queue.upsertJobScheduler(
      name,
      { pattern: cronExpression, tz: 'UTC' },
      { name, data }
    );
    console.log(`Scheduled recurring job: ${name} at ${cronExpression}`);
  }

  async scheduleDelayedJob(
    name: string,
    data: Record<string, unknown>,
    delayMs: number
  ) {
    await this.queue.add(name, data, {
      delay: delayMs,
      attempts: 3
    });
    console.log(`Scheduled delayed job: ${name} in ${delayMs}ms`);
  }

  async cancelRecurringJob(name: string) {
    await this.queue.removeJobScheduler(name);
    console.log(`Cancelled recurring job: ${name}`);
  }
}
```

## Rate Limiting and Throttling

```typescript
// Rate-limited email worker
const emailWorker = new Worker(
  'emails',
  async (job) => {
    await sendEmail(job.data);
  },
  {
    connection,
    limiter: {
      max: 50,         // max jobs
      duration: 1000   // per second
    }
  }
);

// Group-based rate limiting
class RateLimitedQueue {
  private readonly queues: Map<string, Queue> = new Map();

  async getOrCreateQueue(tenantId: string): Promise<Queue> {
    if (!this.queues.has(tenantId)) {
      const queue = new Queue(`emails-${tenantId}`, {
        connection,
        defaultJobOptions: {
          attempts: 3
        }
      });
      this.queues.set(tenantId, queue);

      const worker = new Worker(
        `emails-${tenantId}`,
        async (job) => {
          await sendEmail(job.data);
        },
        {
          connection,
          limiter: {
            max: 10,
            duration: 1000
          }
        }
      );
    }
    return this.queues.get(tenantId);
  }
}
```

## Job Chaining and Dependencies

```typescript
// Sequential job processing pipeline
async function processOrderPipeline(orderId: string) {
  const pipeline = new Queue('order-pipeline', { connection });

  // Step 1: Validate order
  const validateJob = await pipeline.add(
    'validate-order',
    { orderId },
    { jobId: `validate-${orderId}` }
  );

  // Step 2: Process payment (depends on validation)
  const paymentJob = await pipeline.add(
    'process-payment',
    { orderId },
    {
      jobId: `payment-${orderId}`,
      dependsOn: [validateJob.id]
    }
  );

  // Step 3: Update inventory (depends on payment)
  const inventoryJob = await pipeline.add(
    'update-inventory',
    { orderId },
    {
      jobId: `inventory-${orderId}`,
      dependsOn: [paymentJob.id]
    }
  );

  // Step 4: Send confirmation (depends on inventory)
  await pipeline.add(
    'send-confirmation',
    { orderId },
    {
      jobId: `confirm-${orderId}`,
      dependsOn: [inventoryJob.id]
    }
  );
}
```

## Job Events and Monitoring

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('reports', { connection });

queueEvents.on('waiting', ({ jobId }) => {
  console.log(`Job ${jobId} is waiting`);
});

queueEvents.on('active', ({ jobId, prev }) => {
  console.log(`Job ${jobId} is now active`);
});

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed:`, returnvalue);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed:`, failedReason);
});

queueEvents.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} progress:`, data);
});

// Job metrics
class JobMonitor {
  private readonly queue: Queue;

  constructor(queue: Queue) {
    this.queue = queue;
  }

  async getQueueMetrics() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed
    };
  }

  async getFailedJobs(offset = 0, limit = 10) {
    return this.queue.getJobs(['failed'], offset, limit);
  }
}
```

## Common Mistakes

### Missing Error Handling in Workers

```javascript
// Wrong: Unhandled rejection in worker
queue.process(async (job) => {
  const result = await externalApi.call(job.data); // May throw
  return result;
});
```

```javascript
// Correct: Proper error handling
queue.process(async (job) => {
  try {
    const result = await externalApi.call(job.data);
    return result;
  } catch (error) {
    if (error.status === 429) {
      // Rate limited, throw to retry
      throw error;
    }
    if (error.status >= 500) {
      // Server error, retry with backoff
      throw error;
    }
    // Client error, don't retry
    await job.discard();
    return { error: error.message };
  }
});
```

### Not Setting Job IDs

```javascript
// Wrong: Duplicate jobs possible
await emailQueue.add('send-email', { email: 'test@example.com' });
await emailQueue.add('send-email', { email: 'test@example.com' }); // Duplicate!
```

```javascript
// Correct: Use deduplication with jobId
await emailQueue.add('send-email', { email: 'test@example.com' }, {
  jobId: `send-email-${email}`
});
// Second add with same jobId will be ignored
```

## Best Practices

1. Always set `jobId` for idempotent job deduplication.
2. Configure retry strategies with exponential backoff.
3. Use job progress reporting for long-running tasks.
4. Set sensible `removeOnComplete` and `removeOnFail` to manage Redis memory.
5. Separate queues for different job types to isolate failures.
6. Monitor queue metrics and set up alerts for stalled/failed jobs.
7. Use separate Redis databases or instances for different environments.
8. Implement graceful shutdown to let active jobs complete.

## Summary

Bull and BullMQ provide a production-grade task queue system for Node.js applications built on Redis. BullMQ offers improved TypeScript support, job scheduling, rate limiting, and progress tracking. Key practices include proper error handling with retry strategies, job deduplication, queue separation, and comprehensive monitoring.

## References

- BullMQ Documentation
- Bull Documentation
- Redis Documentation

Happy Coding