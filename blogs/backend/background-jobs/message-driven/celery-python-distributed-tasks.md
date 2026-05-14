---
title: "Celery for Python Distributed Tasks"
description: "Distributed task processing with Celery: workers, brokers, result backends, and advanced task patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["celery", "python", "distributed-tasks", "redis", "rabbitmq"]
coverImage: "/images/celery-python-distributed-tasks.png"
draft: false
---

## Overview

Celery is a distributed task queue for Python applications that enables asynchronous execution of work outside the HTTP request-response cycle. It supports multiple brokers (RabbitMQ, Redis, Amazon SQS) and result backends, with built-in retry, rate limiting, scheduling, and monitoring.

Celery is widely used in Python backend applications for sending emails, generating reports, processing uploads, and running scheduled tasks. This post covers setup, task patterns, advanced configuration, and production best practices.

## Setup and Configuration

### Basic Celery Application

```python
from celery import Celery

# Create Celery application
app = Celery(
    'tasks',
    broker='redis://localhost:6379/0',
    backend='redis://localhost:6379/1',
    include=['tasks.email', 'tasks.reports', 'tasks.cleanup']
)

# Optional configuration
app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,
    task_soft_time_limit=25 * 60,
    worker_max_tasks_per_child=200,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    result_expires=3600,
    task_default_retry_delay=60,
    task_max_retries=3
)

if __name__ == '__main__':
    app.start()
```

### Configuration with Config Class

```python
class CeleryConfig:
    broker_url = 'redis://localhost:6379/0'
    result_backend = 'redis://localhost:6379/1'
    task_serializer = 'json'
    result_serializer = 'json'
    accept_content = ['json']
    timezone = 'UTC'
    enable_utc = True
    task_track_started = True
    task_time_limit = 30 * 60
    task_soft_time_limit = 25 * 60
    worker_max_tasks_per_child = 200
    worker_prefetch_multiplier = 1
    task_acks_late = True
    task_reject_on_worker_lost = True
    result_expires = 3600
    task_default_retry_delay = 60
    task_max_retries = 3
    task_queues = {
        'high': {'exchange': 'high', 'routing_key': 'high'},
        'default': {'exchange': 'default', 'routing_key': 'default'},
        'low': {'exchange': 'low', 'routing_key': 'low'},
    }
    task_routes = {
        'tasks.email.*': {'queue': 'high'},
        'tasks.reports.*': {'queue': 'low'},
    }

app = Celery('tasks')
app.config_from_object(CeleryConfig)
```

## Defining Tasks

### Basic Tasks

```python
from celery import shared_task
import logging

logger = logging.getLogger(__name__)

@shared_task
def send_email(recipient: str, subject: str, body: str) -> dict:
    """Send an email asynchronously."""
    logger.info(f"Sending email to {recipient}: {subject}")
    try:
        mail_service = EmailService()
        message_id = mail_service.send(recipient, subject, body)
        return {
            'success': True,
            'message_id': message_id,
            'recipient': recipient
        }
    except Exception as exc:
        logger.error(f"Failed to send email to {recipient}: {exc}")
        raise send_email.retry(exc=exc, countdown=60)

@shared_task(bind=True, max_retries=5)
def process_upload(self, upload_id: str, file_path: str) -> dict:
    """Process a file upload asynchronously."""
    logger.info(f"Processing upload {upload_id}: {file_path}")
    try:
        processor = UploadProcessor()
        result = processor.process(file_path)
        result['upload_id'] = upload_id
        return result
    except RetryableError as exc:
        logger.warning(f"Retryable error for upload {upload_id}: {exc}")
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 60)
    except FatalError as exc:
        logger.error(f"Fatal error for upload {upload_id}: {exc}")
        return {'success': False, 'error': str(exc)}
```

### Tasks with Custom Base Class

```python
from celery import Task

class DatabaseTask(Task):
    """Task base class that manages database connections."""
    _db = None

    def after_return(self, status, retval, task_id, args, kwargs, einfo):
        if self._db is not None:
            self._db.close()
            self._db = None

    @property
    def db(self):
        if self._db is None:
            self._db = DatabaseConnection()
        return self._db

@shared_task(base=DatabaseTask, bind=True)
def generate_report(self, report_type: str, user_id: str) -> str:
    """Generate a report using database task base class."""
    data = self.db.query(f"SELECT * FROM reports WHERE type = {report_type}")
    report = ReportGenerator.generate(report_type, data, user_id)
    report_url = upload_to_storage(report)
    logger.info(f"Report generated for user {user_id}: {report_url}")
    return report_url
```

## Task Routing and Queues

```python
from kombu import Queue, Exchange

# Define queues with priorities
default_exchange = Exchange('default', type='direct')
high_exchange = Exchange('high', type='direct')

app.conf.task_queues = (
    Queue('default', default_exchange, routing_key='default'),
    Queue('high', high_exchange, routing_key='high'),
    Queue('email', Exchange('email', type='direct'), routing_key='email'),
    Queue('reports', Exchange('reports', type='direct'), routing_key='reports'),
)

# Route tasks to specific queues
app.conf.task_routes = {
    'tasks.email.*': {'queue': 'email'},
    'tasks.reports.*': {'queue': 'reports', 'routing_key': 'reports'},
    'tasks.urgent.*': {'queue': 'high', 'routing_key': 'high'},
}

# Urgent task
@shared_task(queue='high')
def process_urgent_payment(payment_id: str) -> dict:
    logger.info(f"Processing urgent payment: {payment_id}")
    return payment_service.process(payment_id)

# Default task
@shared_task(queue='default')
def cleanup_old_records(days: int = 90) -> int:
    count = database.cleanup(days)
    logger.info(f"Cleaned up {count} records older than {days} days")
    return count
```

## Periodic Tasks (Celery Beat)

```python
from celery import shared_task
from celery.schedules import crontab

@shared_task
def generate_daily_sales_report():
    logger.info("Generating daily sales report")
    data = fetch_sales_data()
    report = ReportGenerator.daily_sales(data)
    notify_stakeholders(report)
    return report.id

@shared_task
def cleanup_expired_sessions():
    count = Session.objects.filter(
        expires_at__lt=timezone.now()
    ).delete()
    logger.info(f"Cleaned up {count} expired sessions")
    return count

@shared_task
def sync_with_external_api():
    logger.info("Syncing with external API")
    changes = get_pending_changes()
    results = []
    for change in changes:
        result = external_api.sync(change)
        results.append(result)
    return {'synced': len(results), 'failed': 0}

# Beat schedule configuration
app.conf.beat_schedule = {
    'daily-sales-report': {
        'task': 'tasks.reports.generate_daily_sales_report',
        'schedule': crontab(hour=2, minute=0),
        'args': (),
        'options': {'queue': 'reports'}
    },
    'cleanup-sessions': {
        'task': 'tasks.cleanup.expired_sessions',
        'schedule': crontab(hour='*/6'),
        'options': {'queue': 'low'}
    },
    'sync-external-api': {
        'task': 'tasks.cleanup.sync_with_external_api',
        'schedule': crontab(minute='*/15'),
        'options': {'expires': 300}
    },
}
```

## Task Chaining and Workflows

```python
from celery import chain, group, chord

@shared_task
def validate_order(order_id: str) -> str:
    if validate(order_id):
        return order_id
    raise ValueError(f"Order {order_id} validation failed")

@shared_task
def process_payment(order_id: str) -> str:
    payment_id = payment_service.charge(order_id)
    logger.info(f"Payment processed for order {order_id}: {payment_id}")
    return order_id

@shared_task
def update_inventory(order_id: str) -> str:
    inventory_service.deduct(order_id)
    return order_id

@shared_task
def send_confirmation(order_id: str) -> dict:
    email = get_customer_email(order_id)
    send_email.delay(email, "Order Confirmed", f"Your order {order_id} is confirmed")
    return {'order_id': order_id, 'status': 'confirmed'}

# Sequential execution with chain
def process_order_chain(order_id: str):
    workflow = chain(
        validate_order.s(order_id),
        process_payment.s(),
        update_inventory.s(),
        send_confirmation.s()
    )
    result = workflow()
    return result

# Parallel execution with group
def send_bulk_notifications(user_ids: list):
    job = group(
        send_email.s(user_id, "Notification", "You have a new message")
        for user_id in user_ids
    )
    result = job.apply_async()
    return result

# Parallel with callback using chord
def process_batch_orders(order_ids: list):
    callback = handle_batch_completion.s()
    header = [process_order_chain.s(oid) for oid in order_ids]
    workflow = chord(header, callback)
    result = workflow()
    return result

@shared_task
def handle_batch_completion(results: list) -> dict:
    completed = sum(1 for r in results if r.get('status') == 'confirmed')
    failed = len(results) - completed
    logger.info(f"Batch complete: {completed} succeeded, {failed} failed")
    return {'completed': completed, 'failed': failed}
```

## Monitoring and Flower

```python
# Flower configuration in settings
flower_conf = {
    'broker_api': 'http://guest:guest@localhost:15672/api/',
    'port': 5555,
    'basic_auth': ['admin:password'],
    'url_prefix': 'flower',
    'max_tasks': 10000,
}

# Programmatic task monitoring
from celery.events import Events

class TaskMonitor:
    def __init__(self, app):
        self.app = app
        self.state = self.app.events.State()

    def on_task_received(self, event):
        self.state.event(event)
        task = self.state.tasks.get(event['uuid'])
        if task:
            logger.info(f"Task received: {task.name} ({task.uuid})")

    def on_task_succeeded(self, event):
        self.state.event(event)
        task = self.state.tasks.get(event['uuid'])
        if task:
            runtime = task.runtime
            logger.info(f"Task succeeded: {task.name} in {runtime:.2f}s")

    def on_task_failed(self, event):
        self.state.event(event)
        task = self.state.tasks.get(event['uuid'])
        if task:
            logger.error(f"Task failed: {task.name}: {task.exception}")
```

## Common Mistakes

### Using Synchronous Operations in Tasks

```python
# Wrong: Blocking I/O in task
@shared_task
def process_data(data_id: int):
    import time
    time.sleep(5)  # Blocks the worker
    data = fetch_data(data_id)
    return process(data)
```

```python
# Correct: Use async where available or split into smaller tasks
@shared_task
def process_data(data_id: int):
    data = fetch_data(data_id)
    return process(data)
```

### Not Configuring Time Limits

```python
# Wrong: No timeout, task can run forever
@shared_task
def generate_report():
    data = fetch_large_dataset()  # Could hang
    return process(data)

# Correct: Set time limits
@shared_task(
    time_limit=300,      # Hard limit
    soft_time_limit=270  # Soft limit raises exception
)
def generate_report():
    data = fetch_large_dataset()
    return process(data)
```

### Ignoring Task Result Size

```python
# Wrong: Returning large result
@shared_task
def export_all_users() -> list:
    return User.objects.all().values()  # Could be millions of records
```

```python
# Correct: Return reference, store data elsewhere
@shared_task
def export_all_users() -> str:
    export_id = str(uuid.uuid4())
    file_path = f"/exports/users_{export_id}.csv"
    UserExporter.export_to_csv(file_path)
    return file_path
```

## Best Practices

1. Use `task_acks_late=True` with `task_reject_on_worker_lost=True` for reliable delivery.
2. Set appropriate `time_limit` and `soft_time_limit` on all tasks.
3. Configure `worker_max_tasks_per_child` to prevent memory leaks.
4. Use task routing to separate high-priority from low-priority work.
5. Always handle exceptions and use retry with exponential backoff.
6. Monitor queue depths and task execution times.
7. Use Flower or custom monitoring for production visibility.
8. Set `result_expires` to prevent result backend from growing unbounded.

## Summary

Celery provides a mature, battle-tested distributed task queue for Python applications. With support for multiple brokers, result backends, task routing, periodic scheduling, and complex workflows, it handles everything from simple background tasks to sophisticated multi-step job pipelines. Proper configuration of timeouts, retries, and worker settings is essential for production reliability.

## References

- Celery Documentation: "First Steps with Celery"
- "Python Distilled" by David Beazley
- Flower Documentation (Celery Monitoring)

Happy Coding