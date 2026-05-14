---
title: "Containerizing Backend Applications"
description: "Dockerize Spring Boot applications for production: Dockerfiles, docker-compose, image optimization, and container best practices"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - docker
  - spring-boot
  - containerization
  - devops
coverImage: "/images/containerizing-backend-apps.png"
draft: false
---

# Containerizing Backend Applications with Docker

## Overview

Containerization has become the standard deployment model for backend applications. Docker provides consistent environments across development, testing, and production. Spring Boot applications are particularly well-suited for containerization due to their embedded server model and fat JAR packaging.

This guide covers Dockerfile creation, image optimization, docker-compose for local development, production considerations, and integration with build tools.

---

## How Docker Works with Java Applications

### Container vs JVM

```java
// Understanding container-aware JVM
// Java 10+ automatically detects container limits

@SpringBootApplication
public class OrderApplication {

    public static void main(String[] args) {
        // Spring Boot runs inside the container
        // JVM sees container memory/cpu limits
        SpringApplication.run(OrderApplication.class, args);
    }
}

// JVM container detection (Java 10+)
// -XX:+UseContainerSupport  (enabled by default)
// -XX:ActiveProcessorCount=N
// -XX:InitialRAMPercentage=N
// -XX:MaxRAMPercentage=N
// -XX:MinRAMPercentage=N
```

### Docker Build Context

```dockerfile
# The build context determines what files are available
# .dockerignore prevents sending unnecessary files

# .dockerignore
.git/
.gitignore
README.md
*.md
target/
build/
.idea/
*.iml
node_modules/
*.log
.dockerignore
Dockerfile
```

---

## Dockerfile for Spring Boot

### Basic Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-alpine AS base

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY target/order-service-*.jar app.jar

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:+ExitOnOutOfMemoryError \
    -XX:+HeapDumpOnOutOfMemoryError \
    -XX:HeapDumpPath=/tmp/heapdump.hprof \
    -Djava.security.egd=file:/dev/./urandom"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

### Optimized Multi-Layer Dockerfile

```dockerfile
# Build stage
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

# Copy only build artifacts
COPY target/order-service-*.jar app.jar

# Extract layers from Spring Boot fat JAR
RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# Runtime stage
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy extracted layers in order of change frequency
COPY --from=builder /app/extracted/dependencies/ ./
COPY --from=builder /app/extracted/spring-boot-loader/ ./
COPY --from=builder /app/extracted/snapshot-dependencies/ ./
COPY --from=builder /app/extracted/application/ ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
```

### Gradle Jib Plugin (No Dockerfile)

```kotlin
// build.gradle.kts with Jib plugin
plugins {
    id("com.google.cloud.tools.jib") version "3.4.0"
}

jib {
    from {
        image = "eclipse-temurin:21-jre-alpine"
        platforms {
            platform {
                architecture = "amd64"
                os = "linux"
            }
            platform {
                architecture = "arm64"
                os = "linux"
            }
        }
    }
    to {
        image = "registry.example.com/order-service"
        tags = setOf(
            project.version.toString(),
            "latest"
        )
        auth {
            username = System.getenv("REGISTRY_USER")
            password = System.getenv("REGISTRY_PASS")
        }
    }
    container {
        jvmFlags = listOf(
            "-XX:+UseContainerSupport",
            "-XX:MaxRAMPercentage=75.0",
            "-XX:+ExitOnOutOfMemoryError",
            "-Djava.security.egd=file:/dev/./urandom"
        )
        mainClass = "com.example.order.OrderApplication"
        ports = listOf("8080")
        user = "appuser:appgroup"
        labels = mapOf(
            "maintainer" to "platform-team@example.com",
            "project" to "order-management"
        )
        creationTime = "USE_CURRENT_TIMESTAMP"
    }
    allowInsecureRegistries = false
}

// Build and push: ./gradlew jib
// Build to daemon: ./gradlew jibDockerBuild
```

---

## Docker Compose for Local Development

### docker-compose.yml

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: orderdb
      POSTGRES_USER: orderuser
      POSTGRES_PASSWORD: orderpass
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orderuser -d orderdb"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-redispass}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on:
      kafka-zk:
        condition: service_healthy
    ports:
      - "9092:9092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: kafka-zk:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092,PLAINTEXT_INTERNAL://kafka:29092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_INTERNAL:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT_INTERNAL
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
    healthcheck:
      test: ["CMD", "kafka-topics", "--bootstrap-server", "localhost:9092", "--list"]
      interval: 15s
      timeout: 10s
      retries: 5

  kafka-zk:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    healthcheck:
      test: ["CMD", "echo", "ruok", "|", "nc", "localhost", "2181"]
      interval: 10s
      timeout: 5s
      retries: 5

  order-service:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: docker
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orderdb
      SPRING_DATASOURCE_USERNAME: orderuser
      SPRING_DATASOURCE_PASSWORD: orderpass
      SPRING_REDIS_HOST: redis
      SPRING_REDIS_PASSWORD: ${REDIS_PASSWORD:-redispass}
      SPRING_KAFKA_BOOTSTRAP_SERVERS: kafka:29092
      JAVA_OPTS: "-XX:MaxRAMPercentage=75.0"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      kafka:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - order-service

volumes:
  postgres_data:
  redis_data:
```

### application-docker.properties

```properties
# src/main/resources/application-docker.properties
spring.datasource.url=${SPRING_DATASOURCE_URL}
spring.datasource.username=${SPRING_DATASOURCE_USERNAME}
spring.datasource.password=${SPRING_DATASOURCE_PASSWORD}
spring.jpa.hibernate.ddl-auto=validate

spring.redis.host=${SPRING_REDIS_HOST}
spring.redis.password=${SPRING_REDIS_PASSWORD}

spring.kafka.bootstrap-servers=${SPRING_KAFKA_BOOTSTRAP_SERVERS}
spring.kafka.producer.properties.enable.idempotence=true

management.health.redis.enabled=true
management.health.kafka.enabled=true
```

---

## Image Optimization

### Size Reduction Techniques

```dockerfile
# 1. Use slim base images
FROM eclipse-temurin:21-jre-alpine  # ~180MB vs 400MB for full JDK

# 2. Use jlink to create custom JRE
FROM eclipse-temurin:21-jdk-alpine AS jre-builder
RUN jlink \
    --add-modules java.base,java.logging,java.naming,java.sql,java.management \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

FROM alpine:3.19
ENV JAVA_HOME=/jre
ENV PATH="$JAVA_HOME/bin:$PATH"
COPY --from=jre-builder /custom-jre $JAVA_HOME

# 3. Remove debug symbols from dependencies
FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache binutils && \
    strip --strip-debug /opt/java/lib/server/libjvm.so && \
    apk del binutils

# 4. Use Docker squash (--squash flag) to combine layers
```

### Layer Caching Strategy

```dockerfile
# Optimize layer caching by ordering COPY commands

# Dockerfile.build
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# Step 1: Copy pom/build files first (changes rarely)
COPY pom.xml .
COPY order-common/pom.xml order-common/
COPY order-domain/pom.xml order-domain/
COPY order-repository/pom.xml order-repository/
COPY order-service/pom.xml order-service/
COPY order-web/pom.xml order-web/
COPY order-bootstrap/pom.xml order-bootstrap/

# Step 2: Download dependencies (cached unless pom changes)
RUN mvn dependency:go-offline -B

# Step 3: Copy source code (changes frequently)
COPY . .

# Step 4: Build
RUN mvn package -DskipTests -B
```

### Multi-Architecture Builds

```dockerfile
# Dockerfile cross-platform
FROM --platform=$TARGETPLATFORM eclipse-temurin:21-jre-alpine

ARG TARGETPLATFORM
ARG BUILDPLATFORM

RUN echo "Building for $TARGETPLATFORM on $BUILDPLATFORM"

COPY target/order-service-*.jar app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

# Build command:
# docker buildx build --platform linux/amd64,linux/arm64 -t registry/image:tag --push .
```

---

## Production Considerations

### Security Hardening

```dockerfile
FROM eclipse-temurin:21-jre-alpine

# Run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set secure file permissions
COPY --chown=appuser:appgroup target/app.jar app.jar
RUN chmod 400 app.jar  # Read-only

# Remove shell access for appuser
RUN usermod -s /sbin/nologin appuser

# Run with least privilege
USER appuser

# Security options in compose
# docker-compose.yml
services:
  order-service:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
      - /var/tmp
    cap_drop:
      - ALL
```

### Resource Limits

```yaml
# docker-compose.yml resource constraints
services:
  order-service:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.5"
          memory: 256M
    # Docker run flags
    mem_limit: 512m
    cpus: "1.0"
    ulimits:
      nofile:
        soft: 1024
        hard: 2048
```

### Logging Configuration

```dockerfile
# Dockerfile logging
ENV LOGGING_CONFIG="-Dlogging.config=/config/logback-spring.xml"

# Use JSON logging for better integration with log aggregators
# application-docker.properties
logging.pattern.console={"timestamp":"%d{ISO8601}","level":"%p","thread":"%t","logger":"%c","message":"%m","traceId":"%X{traceId:-}","spanId":"%X{spanId:-}"}%n
```

### Graceful Shutdown

```java
@Configuration
public class GracefulShutdownConfig {

    @Bean
    public GracefulShutdownWrapper gracefulShutdownWrapper() {
        return new GracefulShutdownWrapper();
    }

    @Bean
    public ServletWebServerFactory servletContainer() {
        TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory();
        factory.addConnectorCustomizers(connector -> {
            connector.setProperty("connectionTimeout", "5000");
            connector.setProperty("maxKeepAliveRequests", "100");
        });
        return factory;
    }
}

// application.yml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

---

## CI/CD Integration

### GitHub Actions Docker Build

```yaml
# .github/workflows/docker-build.yml
name: Docker Build and Push

on:
  push:
    branches: [main]
    tags: ["v*"]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"

      - name: Build with Maven
        run: mvn package -DskipTests

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64
```

---

## Common Mistakes

### Mistake 1: Running as Root

```dockerfile
# WRONG: Running as root
FROM eclipse-temurin:21-jre-alpine
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]  # Running as root!

# CORRECT: Use non-root user
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --chown=appuser:appgroup app.jar app.jar
USER appuser
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Mistake 2: No Health Check

```dockerfile
# WRONG: No health check
FROM eclipse-temurin:21-jre-alpine
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]

# CORRECT: Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1
```

### Mistake 3: Not Setting Container-Aware JVM Flags

```dockerfile
# WRONG: JVM ignores container limits
ENTRYPOINT ["java", "-jar", "app.jar"]
# JVM sees host CPU/memory, not container limits

# CORRECT: Use container-aware flags
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

### Mistake 4: Building Image in Runtime Stage

```dockerfile
# WRONG: Using JDK in production image
FROM eclipse-temurin:21-jdk  # ~400MB image!
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]

# CORRECT: Multi-stage build
FROM eclipse-temurin:21-jdk AS builder
COPY target/app.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre-alpine  # ~180MB image!
COPY --from=builder dependencies/ ./
COPY --from=builder application/ ./
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Mistake 5: Hardcoding Environment-Specific Values

```dockerfile
# WRONG: Hardcoded database URL
ENV SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/orderdb

# CORRECT: Use environment variables at runtime
ENV SPRING_DATASOURCE_URL=${DB_URL:-jdbc:postgresql://localhost:5432/orderdb}
# Override in docker-compose:
# environment:
#   SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orderdb
```

---

## Summary

Containerizing Spring Boot applications requires attention to:

1. **Base images**: Use slim JRE images (eclipse-temurin:21-jre-alpine)
2. **Multi-stage builds**: Separate build and runtime stages
3. **Layer caching**: Order Dockerfile commands for optimal caching
4. **Security**: Run as non-root, drop capabilities
5. **Resource management**: Set JVM flags, container limits, health checks
6. **Configuration**: Externalize all environment-specific values

Proper containerization makes deployments predictable, scalable, and secure across all environments.

---

## References

- [Docker Documentation](https://docs.docker.com/)
- [Spring Boot Docker Guide](https://spring.io/guides/topicals/spring-boot-docker/)
- [Google Jib](https://github.com/GoogleContainerTools/jib)
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)

---

Happy Coding 👨‍💻

Happy Coding