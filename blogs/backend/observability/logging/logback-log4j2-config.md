---
title: "Logback vs Log4j2 Configuration"
description: "Compare Logback and Log4j2 logging frameworks: configuration, performance, async logging, and production patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - observability
  - logging
  - logback
  - log4j2
coverImage: "/images/logback-log4j2-config.png"
draft: false
---

# Logback vs Log4j2 Configuration

## Overview

Logback and Log4j2 are the two primary logging frameworks for Java applications. Both provide powerful configuration options, async logging, and integration with monitoring systems. This guide compares their configuration approaches, performance characteristics, and production patterns.

### Framework History

- **Logback**: Successor to Log4j 1.x, same creator (Ceki Gulcu), default in Spring Boot
- **Log4j2**: Apache rewrite of Log4j, supports plugins, async loggers, and garbage-free logging

---

## Configuration Comparison

### Logback Configuration

```xml
<!-- logback-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <springProperty name="appName" source="spring.application.name"/>
    <springProperty name="logLevel" source="logging.level.root" defaultValue="INFO"/>

    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>logs/${appName}.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <fileNamePattern>logs/${appName}-%d{yyyy-MM-dd}.log.gz</fileNamePattern>
            <maxHistory>30</maxHistory>
        </rollingPolicy>
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
        <appender-ref ref="FILE"/>
        <queueSize>1024</queueSize>
        <discardingThreshold>0</discardingThreshold>
        <neverBlock>true</neverBlock>
    </appender>

    <logger name="com.myapp" level="DEBUG"/>
    <logger name="org.springframework" level="WARN"/>

    <root level="${logLevel}">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="ASYNC"/>
    </root>
</configuration>
```

Logback uses `<springProperty>` to pull values from Spring's `application.properties` at runtime. The `rollingPolicy` compresses old log files with gzip (`.gz` extension), reducing disk usage by 80-90% for text logs. The `discardingThreshold` of 0 tells the async appender to never drop events—even when the queue is full, the application thread blocks rather than losing a log entry. Setting `neverBlock: true` reverses this: the application thread is never blocked, but events are silently dropped when the queue is full.

### Log4j2 Configuration

```xml
<!-- log4j2-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN" monitorInterval="30">
    <Properties>
        <Property name="appName">${sys:spring.application.name}</Property>
        <Property name="logPattern">%d{yyyy-MM-dd HH:mm:ss.SSS} [%t] %-5level %c{1.} - %msg%n</Property>
    </Properties>

    <Appenders>
        <Console name="CONSOLE" target="SYSTEM_OUT">
            <PatternLayout pattern="${logPattern}"/>
        </Console>

        <RollingFile name="FILE" fileName="logs/${appName}.log"
                     filePattern="logs/${appName}-%d{yyyy-MM-dd}.log.gz">
            <PatternLayout pattern="${logPattern}"/>
            <Policies>
                <TimeBasedTriggeringPolicy interval="1" modulate="true"/>
            </Policies>
            <DefaultRolloverStrategy max="30"/>
        </RollingFile>

        <Async name="ASYNC">
            <AppenderRef ref="FILE"/>
        </Async>
    </Appenders>

    <Loggers>
        <Logger name="com.myapp" level="DEBUG"/>
        <Logger name="org.springframework" level="WARN"/>

        <Root level="INFO">
            <AppenderRef ref="CONSOLE"/>
            <AppenderRef ref="ASYNC"/>
        </Root>
    </Loggers>
</Configuration>
```

Log4j2's `monitorInterval="30"` tells the framework to check for configuration file changes every 30 seconds—log levels can be adjusted without restarting the application. The `<Properties>` block uses `${sys:...}` syntax to reference system properties, and the abbreviated logger pattern `%c{1.}` shows only the last element of the class name (e.g., `MyService` instead of `com.myapp.service.MyService`), reducing log line length.

---

## Async Logging Deep Dive

### Logback AsyncAppender

```java
// Logback uses a blocking queue with a dispatcher thread
// Configuration:
// <queueSize> - Size of the blocking queue (default: 256)
// <discardingThreshold> - When queue is full, discard DEBUG/TRACE (default: 0.2)
// <neverBlock> - If true, never block the application thread

@Service
public class LogbackAsyncService {

    private static final Logger log = LoggerFactory.getLogger(LogbackAsyncService.class);

    public void highThroughputMethod() {
        for (int i = 0; i < 10000; i++) {
            log.info("Processing item: {}", i);
            // Returns immediately - logged by dispatcher thread
        }
    }
}
```

Logback's `AsyncAppender` wraps another appender with a bounded blocking queue. When the queue reaches capacity, the `discardingThreshold` (default 20%) determines how aggressively events are dropped. At the default of 0.2, when the queue is 80% full, Logback starts dropping DEBUG and TRACE events—preserving higher-priority INFO, WARN, and ERROR events. This is a reasonable default for production, but for critical systems where no log should be dropped, set `discardingThreshold` to 0.

### Log4j2 Async Logger

```xml
<!-- Log4j2 uses LMAX Disruptor for async logging - higher throughput -->
<Configuration>
    <Appenders>
        <File name="FILE" fileName="logs/app.log"/>
    </Appenders>

    <Loggers>
        <AsyncLogger name="com.myapp" level="INFO" includeLocation="false">
            <AppenderRef ref="FILE"/>
        </AsyncLogger>
        <Root level="INFO">
            <AppenderRef ref="FILE"/>
        </Root>
    </Loggers>
</Configuration>
```

```java
// Log4j2 async logger usage
@Service
public class Log4j2AsyncService {

    private static final Logger log = LogManager.getLogger(Log4j2AsyncService.class);

    public void highThroughputMethod() {
        for (int i = 0; i < 100000; i++) {
            log.info("Processing item: {}", i);
            // Uses Disruptor ring buffer - faster than Logback's blocking queue
        }
    }
}
```

Log4j2's async logger uses the LMAX Disruptor, a lock-free ring buffer, instead of a blocking queue. The ring buffer pre-allocates slots and uses CAS operations for coordination, avoiding lock contention under high throughput. The `includeLocation="false"` is a critical performance setting: when true, Log4j2 captures the caller's file name and line number by examining the call stack, which is 10-20x more expensive than omitting it.

---

## Performance Comparison

### Throughput Benchmark

| Framework | Threads | Logs/sec (sync) | Logs/sec (async) | GC pressure |
|-----------|---------|-----------------|-------------------|-------------|
| Logback   | 4       | 850,000         | 2,100,000         | Medium      |
| Log4j2    | 4       | 1,200,000       | 4,500,000         | Low         |
| Log4j2 (no GC) | 4 | 1,500,000 | 6,800,000 | None |

### Garbage-Free Logging (Log4j2)

```xml
<!-- Log4j2 garbage-free logging -->
<Configuration>
    <Properties>
        <!-- Disable garbage generation -->
        <Property name="log4j2.enable.threadlocals">true</Property>
        <Property name="log4j2.enable.direct.encoders">true</Property>
    </Properties>

    <Appenders>
        <Console name="CONSOLE" target="SYSTEM_OUT">
            <!-- %enc{msg} for garbage-free encoding -->
            <PatternLayout pattern="%d{HH:mm:ss.SSS} [%t] %-5level %logger - %enc{%msg}%n"/>
        </Console>
    </Appenders>
</Configuration>
```

Log4j2's garbage-free mode reuses thread-local buffers and direct encoders to avoid allocating objects during logging. In throughput benchmarks, this doubles performance and eliminates GC pauses attributable to logging. The trade-off is that thread-local buffers consume memory proportional to the number of logging threads—typically a few dozen KB per thread.

---

## Advanced Features

### Logback: Conditional Logging

```xml
<configuration>
    <!-- Conditional configuration based on Spring profiles -->
    <springProfile name="development">
        <root level="DEBUG">
            <appender-ref ref="CONSOLE"/>
        </root>
    </springProfile>

    <springProfile name="production">
        <root level="INFO">
            <appender-ref ref="ASYNC_FILE"/>
            <appender-ref ref="JSON_CONSOLE"/>
        </root>
    </springProfile>
</configuration>
```

### Log4j2: Routing Appender

```xml
<Configuration>
    <Appenders>
        <Routing name="ROUTING">
            <Routes pattern="$${ctx:serviceType}">
                <Route key="payment">
                    <RollingFile name="PAYMENT" fileName="logs/payment.log"/>
                </Route>
                <Route key="order">
                    <RollingFile name="ORDER" fileName="logs/order.log"/>
                </Route>
                <Route>
                    <RollingFile name="GENERAL" fileName="logs/general.log"/>
                </Route>
            </Routes>
        </Routing>
    </Appenders>

    <Loggers>
        <Root level="INFO">
            <AppenderRef ref="ROUTING"/>
        </Root>
    </Loggers>
</Configuration>
```

The Routing Appender routes log events to different files based on the `serviceType` MDC value. Payment-related events go to `payment.log`, order events to `order.log`, and everything else to `general.log`. This is useful for compliance (keeping payment logs separate) or for reducing index sizes in centralized logging (different logs go to different Elasticsearch indices).

---

## Best Practices

### 1. Use Async Logging in Production

```xml
<!-- Logback: Always wrap appenders in AsyncAppender -->
<appender name="ASYNC" class="ch.qos.logback.classic.AsyncAppender">
    <queueSize>2048</queueSize>
    <neverBlock>true</neverBlock>
    <appender-ref ref="FILE"/>
</appender>
```

### 2. Disable Caller Location in Production

```java
// Logback: caller info is expensive
// Include only in development
%file:%line  // Expensive

// Log4j2: Disable location for async loggers
<AsyncLogger name="com.myapp" includeLocation="false"/>
```

### 3. Configure Log Rotation Properly

```xml
<!-- Logback: Time + size based rotation -->
<rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
    <fileNamePattern>logs/app-%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
    <maxFileSize>100MB</maxFileSize>
    <maxHistory>30</maxHistory>
    <totalSizeCap>10GB</totalSizeCap>
</rollingPolicy>
```

---

## Common Mistakes

### Mistake 1: Mixing Frameworks

```xml
<!-- WRONG: Logback with Log4j2 APIs on classpath -->
<!-- Causes unpredictable behavior -->

<!-- CORRECT: Choose one framework and use its API consistently -->
<!-- Spring Boot default: Logback -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-logging</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-log4j2</artifactId>
</dependency>
```

### Mistake 2: Not Configuring Async Logging Properly

```java
// WRONG: Direct file appender in high-throughput service
// Blocks application thread on disk I/O

// CORRECT: Always wrap file appenders with AsyncAppender
```

### Mistake 3: Logging Exceptions Incorrectly

```java
// WRONG: Exception as message parameter
log.error("Error processing order: {}", exception.getMessage());

// CORRECT: Pass exception as last argument
log.error("Error processing order: orderId={}", orderId, exception);
```

---

## Summary

| Feature | Logback | Log4j2 |
|---------|---------|--------|
| Configuration | XML, Groovy | XML, JSON, YAML |
| Async logging | BlockingQueue | LMAX Disruptor |
| Garbage-free | No | Yes |
| Throughput | Good | Excellent |
| Spring Boot | Default | Manual setup |
| Lambda support | Limited | Yes |
| Plugin system | No | Yes |

Choose Logback for simplicity and Spring Boot compatibility. Choose Log4j2 for maximum throughput and garbage-free logging.

---

## References

- [Logback Documentation](https://logback.qos.ch/documentation.html)
- [Log4j2 Documentation](https://logging.apache.org/log4j/2.x/manual/)
- [Spring Boot Logging](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.logging)
- [Log4j2 Async Loggers](https://logging.apache.org/log4j/2.x/manual/async.html)

Happy Coding
