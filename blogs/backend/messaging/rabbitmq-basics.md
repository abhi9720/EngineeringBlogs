---
title: "RabbitMQ Basics"
description: "Learn RabbitMQ fundamentals: exchanges, queues, bindings, and message patterns for asynchronous communication"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - rabbitmq
  - messaging
  - amqp
coverImage: "/images/rabbitmq-basics.png"
draft: false
---

# RabbitMQ Fundamentals

## Overview

RabbitMQ is a feature-rich message broker implementing AMQP (Advanced Message Queuing Protocol). Unlike Kafka's log-based model, RabbitMQ uses traditional message queue semantics with exchanges, queues, and bindings. It's ideal for task queues, RPC, and complex routing scenarios.

---

## Architecture

```mermaid
flowchart TB

    Producer[Producer] --> Exchange[Exchange]
    Exchange --> Queue[(Queue)]
    Queue --> Consumer[Consumer]

    Exchange -.->|Binding| Producer
    Queue --> DLQ[(Dead Letter<br/>Queue)]

    linkStyle default stroke:#278ea5

    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff

    class Queue,DLQ green
    class Exchange,Producer,Consumer blue
```

---

## Exchange Types

### Direct Exchange

```java
// Direct: Exact matching on routing key
@Configuration
public class DirectExchangeConfig {
    
    @Bean
    public DirectExchange ordersExchange() {
        return new DirectExchange("orders.exchange");
    }
    
    @Bean
    public Queue urgentQueue() {
        return QueueBuilder.durable("orders.urgent").build();
    }
    
    @Bean
    public Binding urgentBinding() {
        return BindingBuilder.bind(urgentQueue())
            .to(ordersExchange())
            .with("order.urgent");  // Exact routing key match
    }
}

// Producer: Send with specific routing key
@Service
public class OrderProducer {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void sendUrgentOrder(Order order) {
        rabbitTemplate.convertAndSend(
            "orders.exchange",
            "order.urgent",        // routing key
            order
        );
    }
}
```

### Topic Exchange

```java
// Topic: Pattern-based matching
@Configuration
public class TopicExchangeConfig {
    
    @Bean
    public TopicExchange notificationsExchange() {
        return new TopicExchange("notifications.exchange");
    }
    
    @Bean
    public Queue emailQueue() {
        return QueueBuilder.durable("notifications.email").build();
    }
    
    @Bean
    public Queue smsQueue() {
        return QueueBuilder.durable("notifications.sms").build();
    }
    
    // Bind with wildcards: # = zero or more, * = exactly one word
    @Bean
    public Binding emailBinding() {
        return BindingBuilder.bind(emailQueue())
            .to(notificationsExchange())
            .with("notification.email.#");  // Matches notification.email, notification.email.order
    }
}
```

---

## Real-World Use Cases

### 1. Task Queue

```java
@Service
public class TaskProducer {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void queueTask(Task task) {
        rabbitTemplate.convertAndSend("tasks", task);
    }
}

@Component
public class TaskWorker {
    
    @RabbitListener(queues = "tasks")
    public void processTask(Task task) {
        log.info("Processing task: {}", task.getId());
        // Process...
    }
}
```

### 2. Dead Letter Queue

```java
@Configuration
public class DLQConfig {
    
    @Bean
    public Queue mainQueue() {
        return QueueBuilder.durable("orders")
            .withArgument("x-dead-letter-exchange", "orders.dlx")
            .withArgument("x-dead-letter-routing-key", "orders.dead")
            .build();
    }
    
    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder.durable("orders.dead").build();
    }
    
    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange("orders.dlx");
    }
    
    @Bean
    public Binding deadBinding() {
        return BindingBuilder.bind(deadLetterQueue())
            .to(deadLetterExchange())
            .with("orders.dead");
    }
}
```

---

## Production Configuration

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
    virtual-host: /
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
        concurrency: 5
        max-concurrency: 10
    publisher-confirm-type: correlated
    publisher-returns: true
```

---

## Common Mistakes

### Mistake 1: Not Using DLQ

```java
// WRONG: Lost messages when consumer fails

// CORRECT: Configure dead letter queue
```

### Mistake 2: Not Acknowledging Messages

```java
// WRONG
@RabbitListener(queues = "tasks")
public void process(Task task) {
    // Process
    // No acknowledgment - message stays in queue but consumed
}

// CORRECT
@RabbitListener(queues = "tasks")
public void process(Task task, Channel channel, 
                    @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
    try {
        process(task);
        channel.basicAck(tag, false);  // Acknowledge
    } catch (Exception e) {
        channel.basicNack(tag, false, true);  // Requeue
    }
}
```

---

## Summary

1. **Exchanges**: Route messages to queues
2. **Queues**: Store messages until consumed
3. **Bindings**: Connect exchanges to queues with routing keys
4. **DLQ**: Handle failed messages
5. **Acknowledgments**: Ensure reliable processing

---

## References

- [RabbitMQ Documentation](https://www.rabbitmq.com/documentation.html)
- [Spring AMQP Reference](https://docs.spring.io/spring-amqp/reference/)
- [RabbitMQ in Action](https://www.manning.com/books/rabbitmq-in-action)

---

Happy Coding 👨‍💻