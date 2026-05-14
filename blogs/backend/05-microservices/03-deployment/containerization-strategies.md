---
title: Containerization Strategies for Microservices
description: >-
  Docker best practices for microservices: multi-stage builds, layer
  optimization, JVM tuning, health checks, Docker Compose, and Kubernetes
  deployment strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - docker
  - containerization
  - spring-boot
  - kubernetes
coverImage: /images/containerization-strategies.png
draft: false
order: 30
---
## Overview

Containerization is fundamental to microservices deployment. Docker packages applications with their dependencies, ensuring consistency across environments. This article covers Dockerfile best practices, JVM optimization, multi-stage builds, and production deployment strategies.

## Dockerfile for Spring Boot

### Minimal Dockerfile

The minimal Dockerfile uses a two-stage build — the first stage compiles the application with the JDK, the second stage runs it with the lighter JRE. Multi-stage builds reduce the final image size by excluding build tools, compiler, and source files from the production image.

```dockerfile
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN ./mvnw dependency:go-offline
COPY src src
RUN ./mvnw package -DskipTests

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Optimized Dockerfile with JVM Tuning

This production-ready Dockerfile adds JVM tuning flags: ZGC for low-latency garbage collection, `MaxRAMPercentage=75` to let the JVM dynamically size its heap within container memory limits, and heap dump on OOM for post-mortem analysis. The `tini` init process handles zombie reaping and signal forwarding.

```dockerfile
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN ./mvnw dependency:go-offline
COPY src src
RUN ./mvnw package -DskipTests -Dspring.profiles.active=prod

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl tini && \
    addgroup -S spring && adduser -S spring -G spring

USER spring:spring
WORKDIR /app

# Copy JAR with layers
COPY --from=builder /app/target/*.jar app.jar

# Extract layers for better caching
RUN java -Djarmode=layertools -jar app.jar extract

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "java"]
CMD ["-XX:+UseZGC", \
     "-XX:MaxRAMPercentage=75.0", \
     "-XX:+ExitOnOutOfMemoryError", \
     "-XX:+HeapDumpOnOutOfMemoryError", \
     "-XX:HeapDumpPath=/tmp/heapdump.hprof", \
     "-Djava.security.egd=file:/dev/./urandom", \
     "-Dspring.profiles.active=prod", \
     "org.springframework.boot.loader.launch.JarLauncher"]
```

## Layer Optimization

Layered JARs split the Spring Boot application into four layers: dependencies (third-party libs), spring-boot-loader (framework classes), snapshot-dependencies (local snapshot deps), and application (your code). Docker caches each layer independently — rebuilding after a code change only invalidates the thin application layer, dramatically reducing build and push time.

```dockerfile
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app
COPY pom.xml ./
COPY src src
RUN mvn package -DskipTests
RUN java -Djarmode=layertools -jar target/*.jar extract

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Copy layers in dependency order
COPY --from=builder app/dependencies/ ./
COPY --from=builder app/spring-boot-loader/ ./
COPY --from=builder app/snapshot-dependencies/ ./
COPY --from=builder app/application/ ./

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

## Docker Compose

Docker Compose orchestrates local development environments with all dependencies — Eureka, Config Server, Kafka, and Zookeeper. The `depends_on` with `condition: service_healthy` ensures services start in the correct order. Resource limits prevent any single service from starving others during local testing.

```yaml
version: '3.8'

networks:
  microservices-network:
    driver: bridge

services:
  service-registry:
    image: eureka-server:latest
    ports:
      - "8761:8761"
    networks:
      - microservices-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8761/actuator/health"]
      interval: 30s
      timeout: 10s
      retries: 5

  config-server:
    image: config-server:latest
    ports:
      - "8888:8888"
    networks:
      - microservices-network
    depends_on:
      service-registry:
        condition: service_healthy
    environment:
      - EUREKA_CLIENT_SERVICEURL_DEFAULTZONE=http://service-registry:8761/eureka/

  order-service:
    image: order-service:latest
    ports:
      - "8081:8080"
    networks:
      - microservices-network
    depends_on:
      config-server:
        condition: service_started
      kafka:
        condition: service_healthy
    environment:
      - SPRING_PROFILES_ACTIVE=docker
      - SPRING_CONFIG_IMPORT=configserver:http://config-server:8888
      - KAFKA_BOOTSTRAP_SERVERS=kafka:9092
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  payment-service:
    image: payment-service:latest
    ports:
      - "8082:8080"
    networks:
      - microservices-network
    depends_on:
      - config-server
      - kafka
    environment:
      - SPRING_PROFILES_ACTIVE=docker
      - SPRING_CONFIG_IMPORT=configserver:http://config-server:8888
    deploy:
      resources:
        limits:
          memory: 512M

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    ports:
      - "9092:9092"
    networks:
      - microservices-network
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    healthcheck:
      test: ["CMD-SHELL", "kafka-topics --bootstrap-server localhost:9092 --list"]
      interval: 15s
      timeout: 10s
      retries: 5

  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    ports:
      - "2181:2181"
    networks:
      - microservices-network
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
```

## .dockerignore

```
.git
.gitignore
node_modules/
npm-debug.log
target/
*.log
*.pid
.DS_Store
README.md
docker-compose*.yml
*.md
```

## Kubernetes Deployment

The Kubernetes deployment configures rolling updates (`maxUnavailable: 0` for zero-downtime), three health probes (liveness, readiness, startup), resource limits, and a 60-second graceful shutdown period. The separate management port (8081) keeps actuator endpoints accessible without exposing them on the main application port.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: microservices
  labels:
    app: order-service
    version: v1
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
        version: v1
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 8080
              name: http
            - containerPort: 8081
              name: management
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: "k8s"
            - name: JAVA_OPTS
              value: "-XX:+UseZGC -XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            initialDelaySeconds: 20
            periodSeconds: 5
            timeoutSeconds: 3
          startupProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 30
          volumeMounts:
            - name: config
              mountPath: /etc/config
              readOnly: true
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: config
          configMap:
            name: order-service-config
        - name: tmp
          emptyDir: {}
      terminationGracePeriodSeconds: 60
---
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: microservices
spec:
  selector:
    app: order-service
  ports:
    - name: http
      port: 80
      targetPort: http
    - name: management
      port: 8081
      targetPort: management
  type: ClusterIP
```

## Best Practices

- Use multi-stage builds to minimize image size.
- Use distroless or Alpine-based JRE images for smaller attack surface.
- Extract Spring Boot layers for faster rebuilds.
- Set JVM memory limits using `-XX:MaxRAMPercentage` rather than `-Xmx`.
- Define health checks for container orchestration.
- Run containers as non-root user.
- Configure graceful shutdown with `terminationGracePeriodSeconds`.

## Common Mistakes

### Mistake: Running containers as root

```dockerfile
# Wrong - root user
FROM eclipse-temurin:21-jre-alpine
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

```dockerfile
# Correct - non-root user
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Mistake: No resource limits

```yaml
# Wrong - no resource constraints
containers:
  - name: order-service
    image: order-service:latest
```

```yaml
# Correct - resource limits and requests
containers:
  - name: order-service
    image: order-service:latest
    resources:
      requests:
        memory: "256Mi"
        cpu: "250m"
      limits:
        memory: "512Mi"
        cpu: "500m"
```

## Summary

Proper containerization is essential for consistent and reliable microservices deployment. Use multi-stage builds, layered JARs, non-root users, and health checks. Configure JVM and container resource limits appropriately for the target deployment environment.

## References

- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Spring Boot Docker Documentation](https://docs.spring.io/spring-boot/reference/packaging/container-images.html)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)

Happy Coding
