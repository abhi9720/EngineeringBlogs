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

Java 10+ includes container support that detects cgroup limits automatically. Without this, the JVM would see the host's total memory and CPUs, potentially exceeding container limits and triggering OOM kills.

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

The `UseContainerSupport` flag (enabled by default since Java 10) allows the JVM to read CPU and memory limits from cgroups. `MaxRAMPercentage` lets you control how much of the container's memory the JVM heap uses — 75% is a good starting point, leaving headroom for off-heap and native memory.

### Docker Build Context

The `.dockerignore` file is essential for keeping the build context small. Every file in the context is sent to the Docker daemon — a large context slows builds and increases network transfer in CI/CD.

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

The basic Dockerfile uses Alpine Linux for a minimal base image and runs the application as a non-root user for security. The `HEALTHCHECK` instruction tells Docker how to verify the container is functioning.

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

Using `-XX:+ExitOnOutOfMemoryError` ensures the JVM exits when it can't allocate memory, allowing Docker or Kubernetes to restart the container. The `HeapDumpOnOutOfMemoryError` flag generates a heap dump for post-mortem analysis. Setting the entropy source to `/dev/./urandom` avoids blocking on entropy pool starvation during startup.

### Optimized Multi-Layer Dockerfile

Spring Boot's layered JAR feature separates dependencies, framework classes, and application code into distinct layers. This enables Docker layer caching — only the layer that changes needs to be rebuilt.

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

The layers are copied in order of change frequency: dependencies change least often, application code changes most often. This means Docker caches the dependency layer across builds — only the application layer rebuilds when you change code, drastically reducing rebuild time in CI.

### Gradle Jib Plugin (No Dockerfile)

Jib is a Maven/Gradle plugin that builds optimized Docker images without requiring Docker to be installed. It handles layering, base image selection, and multi-architecture builds automatically.

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

Jib's key advantage is that it does not need a Docker daemon — it builds the image directly via the registry protocol. The `platforms` block enables multi-architecture builds (amd64 + arm64) in a single command, which is essential for mixed Kubernetes node pools.

---

## Docker Compose for Local Development

### docker-compose.yml

Docker Compose orchestrates all the services a backend needs locally. Each service includes health checks so dependent services wait for dependencies to be ready before starting.

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

Using `depends_on` with `condition: service_healthy` is far more reliable than just `depends_on` without conditions — the application only starts after PostgreSQL, Redis, and Kafka are fully ready. Named volumes (`postgres_data`, `redis_data`) persist data across restarts.

### application-docker.properties

The Docker profile externalizes all configuration through environment variables. This is the twelve-factor app approach: configuration varies across deployments, code does not.

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

Smaller images mean faster deployments, less storage, and a smaller attack surface. The techniques below reduce image size from ~500MB (full JDK) to under 100MB.

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

`jlink` creates a JRE with only the modules your application actually uses. Running `jdeps` on your JAR first identifies required modules, which can shrink the JRE to under 40MB. The trade-off is longer build time and the need to re-run `jdeps` when dependencies change.

### Layer Caching Strategy

Docker caches each layer independently. By copying files that change least often first (POM files, then dependencies, then source code), you maximize cache reuse.

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

With ARM-based Macs and ARM nodes in Kubernetes, multi-architecture images are essential. Docker BuildX handles this natively.

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

Running as root inside a container is a major security concern — if an attacker exploits the application, they gain root access to the container. The non-root user pattern combined with read-only filesystems and dropped capabilities creates defense in depth.

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

The `no-new-privileges` flag prevents privilege escalation via `suid` binaries. Setting the filesystem to `read_only` and using `tmpfs` for writable directories limits the blast radius of any compromise.

### Resource Limits

Without resource limits, a single container can consume all host resources and starve other containers. CPU and memory limits also provide predictable performance.

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

JSON-structured logs are essential for log aggregation systems like ELK, Splunk, or Datadog. Spring Boot's logging pattern can output JSON directly, avoiding the need for sidecar log parsers.

```dockerfile
# Dockerfile logging
ENV LOGGING_CONFIG="-Dlogging.config=/config/logback-spring.xml"

# Use JSON logging for better integration with log aggregators
# application-docker.properties
logging.pattern.console={"timestamp":"%d{ISO8601}","level":"%p","thread":"%t","logger":"%c","message":"%m","traceId":"%X{traceId:-}","spanId":"%X{spanId:-}"}%n
```

### Graceful Shutdown

Kubernetes sends a SIGTERM to containers before forcefully killing them. The application must handle this signal to complete in-flight requests and close resources cleanly.

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

The CI workflow integrates with GitHub Container Registry (GHCR) and uses Docker BuildX for caching and multi-platform builds. Layer caching with `type=gha` stores cache in GitHub Actions' own storage.

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

Running as root inside a container is a security anti-pattern. If the application is compromised, the attacker has root access to the container and potentially the host.

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

Without health checks, Docker and Kubernetes cannot determine if the application is actually serving traffic. A process may be running but the application could be in a bad state.

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

Without `UseContainerSupport`, the JVM sees the host's total memory and CPUs. It may request more memory than the container allows, getting OOM-killed.

```dockerfile
# WRONG: JVM ignores container limits
ENTRYPOINT ["java", "-jar", "app.jar"]
# JVM sees host CPU/memory, not container limits

# CORRECT: Use container-aware flags
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

### Mistake 4: Building Image in Runtime Stage

Including the JDK and build tools in the final image adds hundreds of megabytes and increases the attack surface.

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

Hardcoded values make the image non-portable across environments. Externalize configuration through environment variables.

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

Happy Coding