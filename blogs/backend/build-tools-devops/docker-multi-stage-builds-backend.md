---
title: "Docker Multi-Stage Builds for Backend"
description: "Optimize Docker images for backend applications using multi-stage builds, layer caching, and jlink for minimal JRE images"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - docker
  - multi-stage
  - spring-boot
  - image-optimization
  - devops
coverImage: "/images/docker-multi-stage-builds-backend.png"
draft: false
---

# Docker Multi-Stage Builds for Backend Applications

## Overview

Multi-stage builds are one of Docker's most powerful features for backend applications. They allow you to use a full-featured build environment (JDK, Maven, Gradle) in one stage and produce a minimal production image in a final stage. This results in smaller, more secure images without sacrificing build capabilities.

This guide covers multi-stage build patterns for Java/Spring Boot applications, Maven and Gradle integration, jlink for custom JREs, and advanced optimization techniques.

---

## How Multi-Stage Builds Work

### Basic Concept

A multi-stage Dockerfile uses multiple `FROM` statements. Each `FROM` begins a new stage. The final stage produces the runtime image — everything from earlier stages is discarded unless explicitly copied.

```dockerfile
# Stage 1: Build with full JDK and tools
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app
COPY . .
RUN ./mvnw package -DskipTests

# Stage 2: Runtime with minimal JRE
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]

# Final image: only JRE + JAR (~180MB instead of ~400MB)
```

The `COPY --from=builder` syntax copies artifacts from the builder stage into the runtime stage. The builder stage's layers (JDK, Maven, source code, compiled classes) are not part of the final image — only what you explicitly copy over.

### Why Multi-Stage Matters

A single-stage build with the JDK produces images that are 2–3× larger. Beyond size, including build tools in the final image increases the attack surface for production deployments.

```dockerfile
# Without multi-stage: everything in one image
FROM eclipse-temurin:21-jdk-alpine  # 400MB
WORKDIR /app
COPY . .
RUN ./mvnw package
ENTRYPOINT ["java", "-jar", "target/app.jar"]
# Contains JDK, Maven wrapper, source code, build artifacts
# Size: ~500MB

# With multi-stage: only runtime essentials
FROM eclipse-temurin:21-jre-alpine  # 180MB
COPY --from=builder target/app.jar .
ENTRYPOINT ["java", "-jar", "app.jar"]
# Size: ~190MB (60% reduction)
```

---

## Spring Boot Layered JAR Pattern

### Spring Boot Layered JAR Extraction

Spring Boot 2.3+ supports building "layered" JARs. These JARs group files into layers (dependencies, framework classes, application code) that can be extracted and copied separately for optimal Docker layer caching.

```dockerfile
# Build stage
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

# Copy pre-built JAR from host
COPY target/*.jar app.jar

# Extract Spring Boot layered JAR
RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# Runtime stage
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy layers in order of change frequency (most stable first)
COPY --from=builder /app/extracted/dependencies/ ./
COPY --from=builder /app/extracted/spring-boot-loader/ ./
COPY --from=builder /app/extracted/snapshot-dependencies/ ./
COPY --from=builder /app/extracted/application/ ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
```

The key insight is layer ordering: `dependencies/` contains third-party libraries that rarely change, `application/` contains your code that changes frequently. When you rebuild after a code change, the `dependencies/` layer is served from cache, and only the `application/` layer is rebuilt.

### Enabling Layered JAR in Build

Layered JARs must be explicitly enabled in your build tool. Without this, the JAR is a single fat JAR and cannot be extracted into layers.

```xml
<!-- Maven: pom.xml -->
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <layers>
            <enabled>true</enabled>
            <configuration>${project.basedir}/layers.xml</configuration>
        </layers>
    </configuration>
</plugin>
```

```kotlin
// Gradle: build.gradle.kts
tasks.bootJar {
    layered {
        application {
            intoLayer("application")
        }
        dependencies {
            intoLayer("dependencies")
        }
        layerOrder = listOf("dependencies", "application")
    }
}
```

### Custom Layer Configuration

You can customize which dependencies go into which layer using a `layers.xml` file. This is useful for separating internal library dependencies from third-party dependencies.

```xml
<!-- layers.xml -->
<layers xmlns="http://www.springframework.org/schema/boot/layers"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.springframework.org/schema/boot/layers
                          https://www.springframework.org/schema/boot/layers/layers-3.xsd">
    <application>
        <into-layer>application</into-layer>
    </application>
    <dependencies>
        <into-layer>dependencies</into-layer>
    </dependencies>
    <layerOrder>
        <layer>application</layer>
        <layer>dependencies</layer>
    </layerOrder>
</layers>
```

---

## Maven Multi-Stage Dockerfile

### Full Maven Multi-Stage Build

This Dockerfile builds the application entirely inside Docker — the host machine only needs Docker, not Maven or JDK. This is the approach used in CI/CD pipelines.

```dockerfile
# Stage 1: Maven build
FROM maven:3.9.6-eclipse-temurin-21-alpine AS maven-build

WORKDIR /app

# Copy dependency descriptors first (for layer caching)
COPY pom.xml .
COPY order-common/pom.xml order-common/pom.xml
COPY order-domain/pom.xml order-domain/pom.xml
COPY order-repository/pom.xml order-repository/pom.xml
COPY order-service/pom.xml order-service/pom.xml
COPY order-web/pom.xml order-web/pom.xml
COPY order-bootstrap/pom.xml order-bootstrap/pom.xml

# Download dependencies (cached unless pom.xml changes)
RUN mvn dependency:go-offline -B

# Copy source code
COPY . .

# Build the application
RUN mvn package -DskipTests -B

# Stage 2: Extract layers
FROM eclipse-temurin:21-jdk-alpine AS layers

WORKDIR /app

COPY --from=maven-build /app/order-bootstrap/target/*.jar app.jar

RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# Stage 3: Runtime
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=layers /app/extracted/dependencies/ ./
COPY --from=layers /app/extracted/spring-boot-loader/ ./
COPY --from=layers /app/extracted/snapshot-dependencies/ ./
COPY --from=layers /app/extracted/application/ ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Djava.security.egd=file:/dev/./urandom"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
```

Three stages separate concerns: build (Maven + source → JAR), extract (JAR → layers), and runtime (JRE + layers → runnable container). Each stage discards tools from the previous stage, keeping the final image minimal.

### Optimized Maven with Cache

Using Google's distroless base image for the runtime stage removes even the OS package manager and shell, reducing the attack surface to just the JVM and application code.

```dockerfile
# Use Maven cache for faster rebuilds
FROM maven:3.9.6-eclipse-temurin-21-alpine AS build

WORKDIR /app

# Copy only POM files first
COPY pom.xml .
COPY order-common/pom.xml order-common/
COPY order-domain/pom.xml order-domain/
COPY order-repository/pom.xml order-repository/
COPY order-service/pom.xml order-service/
COPY order-web/pom.xml order-web/
COPY order-bootstrap/pom.xml order-bootstrap/

# Download dependencies
RUN mvn dependency:go-offline -B

# Copy source and build
COPY . .

# Test in build stage (results not in final image)
RUN mvn verify -B

# Package
RUN mvn package -DskipTests -B

# Runtime stage
FROM gcr.io/distroless/java21-debian12:nonroot

WORKDIR /app

COPY --from=build /app/order-bootstrap/target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

---

## Gradle Multi-Stage Dockerfile

### Gradle Build with Daemon

Gradle's build cache and incremental compilation make it faster than Maven for multi-module projects. The same multi-stage pattern applies.

```dockerfile
# Stage 1: Gradle build
FROM gradle:8.5-jdk21-alpine AS gradle-build

WORKDIR /app

# Copy gradle wrapper and configuration
COPY gradlew .
COPY gradle/ gradle/
COPY settings.gradle.kts .
COPY build.gradle.kts .
COPY order-common/ order-common/
COPY order-domain/ order-domain/
COPY order-repository/ order-repository/
COPY order-service/ order-service/
COPY order-web/ order-web/
COPY order-bootstrap/ order-bootstrap/

# Pre-download dependencies
RUN ./gradlew dependencies --no-daemon

# Build (with build cache)
RUN ./gradlew build -x test --no-daemon

# Stage 2: Extract layers
FROM eclipse-temurin:21-jdk-alpine AS layers

WORKDIR /app

COPY --from=gradle-build /app/order-bootstrap/build/libs/*.jar app.jar

RUN java -Djarmode=layertools -jar app.jar extract --destination extracted

# Stage 3: Runtime
FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=layers /app/extracted/dependencies/ ./
COPY --from=layers /app/extracted/spring-boot-loader/ ./
COPY --from=layers /app/extracted/snapshot-dependencies/ ./
COPY --from=layers /app/extracted/application/ ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
```

### BuildKit Cache Mount

BuildKit cache mounts persist the Gradle cache across builds on the same host, radically reducing build time for CI runners that reuse the same build host.

```dockerfile
# syntax=docker/dockerfile:1.4
# Use BuildKit cache mounts for faster builds

FROM gradle:8.5-jdk21-alpine AS build

WORKDIR /app

# Cache for Gradle dependencies
RUN --mount=type=cache,target=/root/.gradle \
    --mount=type=bind,source=.,target=/app,readonly \
    ./gradlew build -x test

FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

COPY --from=build /app/order-bootstrap/build/libs/*.jar app.jar

ENTRYPOINT ["java", "-jar", "app.jar"]

# Build with:
# DOCKER_BUILDKIT=1 docker build --cache-from=type=local,src=.build-cache --cache-to=type=local,dest=.build-cache .
```

---

## Custom JRE with jlink

### Minimal JRE Creation

`jlink` creates a custom JRE containing only the Java modules your application needs. This can shrink the runtime from ~180MB (full JRE) to under 40MB.

```dockerfile
# Stage 1: Build application
FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /app
COPY . .
RUN ./mvnw package -DskipTests

# Stage 2: Create custom JRE with jlink
FROM eclipse-temurin:21-jdk-alpine AS jre

# Create minimal runtime image with only needed modules
RUN jlink \
    --add-modules \
        java.base,\
        java.logging,\
        java.naming,\
        java.sql,\
        java.management,\
        java.xml,\
        jdk.unsupported,\
        java.instrument,\
        java.security.jgss,\
        java.security.sasl,\
        java.desktop \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

# Stage 3: Runtime with custom JRE
FROM alpine:3.19 AS runtime

# Install CA certificates for HTTPS
RUN apk add --no-cache ca-certificates tzdata

COPY --from=jre /custom-jre /jre

ENV JAVA_HOME=/jre
ENV PATH="$JAVA_HOME/bin:$PATH"

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build /app/target/*.jar app.jar

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

# Image size: ~80MB (custom JRE) vs ~180MB (full JRE)
```

### Module Analysis for jlink

Instead of guessing which modules you need, `jdeps` analyzes the compiled bytecode to determine exactly which Java modules are required. This eliminates guesswork and produces the smallest possible JRE.

```dockerfile
# Stage: Analyze which modules are needed
FROM eclipse-temurin:21-jdk-alpine AS module-analyzer

WORKDIR /app
COPY target/*.jar app.jar

# Use jdeps to find required modules
RUN jdeps \
    --print-module-deps \
    --ignore-missing-deps \
    app.jar > /required-modules.txt

# Build custom JRE with only required modules
FROM eclipse-temurin:21-jdk-alpine AS jre-builder

COPY --from=module-analyzer /required-modules.txt /required-modules.txt

RUN jlink \
    --add-modules $(cat /required-modules.txt) \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

FROM alpine:3.19

COPY --from=jre-builder /custom-jre /jre

WORKDIR /app

COPY --from=module-analyzer /app/app.jar app.jar

ENV JAVA_HOME=/jre
ENV PATH="$JAVA_HOME/bin:$PATH"

ENTRYPOINT ["java", "-jar", "app.jar"]
```

---

## Advanced Optimization

### Distroless Images

Distroless images contain only the application and its runtime dependencies — no shell, package manager, or system utilities. This dramatically reduces the attack surface.

```dockerfile
# Use Google Distroless for minimal attack surface
FROM maven:3.9.6-eclipse-temurin-21-alpine AS build

WORKDIR /app
COPY . .
RUN mvn package -DskipTests

FROM gcr.io/distroless/java21-debian12:nonroot AS runtime

WORKDIR /app

COPY --from=build /app/target/*.jar app.jar

# No shell, no package manager, no utilities
# Only JVM + application
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]

# Distroless image: ~160MB
# Alpine image: ~190MB
# Full JDK image: ~500MB
```

### Layered Caching with BuildKit

BuildKit (available as `DOCKER_BUILDKIT=1`) introduces `--mount=type=cache` which persists directories across builds without adding them to image layers. This is ideal for Maven's `.m2` repository and Gradle's cache.

```dockerfile
# syntax=docker/dockerfile:1.4

FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# Mount Maven cache from BuildKit
RUN --mount=type=cache,target=/root/.m2,sharing=locked \
    --mount=type=bind,source=pom.xml,target=pom.xml \
    --mount=type=bind,source=src,target=src \
    mvn package -DskipTests -B

FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

COPY --from=builder /app/target/*.jar app.jar

ENTRYPOINT ["java", "-jar", "app.jar"]

# Build with BuildKit caching:
# docker build --cache-from type=local,src=.m2-cache --cache-to type=local,dest=.m2-cache .
```

### Combined Multi-Stage with CI

This GitHub Actions workflow integrates multi-stage Docker builds with layer caching. The cache is stored on disk and moved between runs to preserve it across CI jobs.

```yaml
# .github/workflows/docker-multi-stage.yml
name: Multi-Stage Docker Build

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Cache Docker layers
        uses: actions/cache@v4
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-buildx-

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:latest
          cache-from: type=local,src=/tmp/.buildx-cache
          cache-to: type=local,dest=/tmp/.buildx-cache-new,mode=max

      - name: Move cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache
```

---

## Performance Comparison

### Image Size Comparison

The table below compares image sizes across different build approaches. The multi-stage jlink approach produces an image 6× smaller than the naive single-stage JDK approach.

```
Application: Spring Boot order-service (100MB JAR)

| Approach                    | Image Size | Build Time | Notes                  |
|-----------------------------|-----------|------------|------------------------|
| Single-stage JDK            | ~500MB    | ~120s      | Everything included    |
| Single-stage JRE            | ~280MB    | ~120s      | JRE only               |
| Multi-stage (Maven+JRE)     | ~190MB    | ~180s      | Build in Docker        |
| Multi-stage (layered)       | ~190MB    | ~190s      | Layer caching          |
| Multi-stage (jlink)         | ~80MB     | ~200s      | Custom JRE             |
| Distroless (multi-stage)    | ~160MB    | ~180s      | Minimal OS             |
```

---

## Common Mistakes

### Mistake 1: Not Ordering COPY for Layer Cache

Docker caches layers based on whether the input files changed. Copying source code before downloading dependencies means any source change invalidates the dependency download cache.

```dockerfile
# WRONG: Source code copied before dependency download
FROM maven:3.9.6 AS build
WORKDIR /app
COPY . .  # All source first
RUN mvn dependency:go-offline  # Cache invalidated on any source change!
RUN mvn package

# CORRECT: Dependencies first, source last
FROM maven:3.9.6 AS build
WORKDIR /app
COPY pom.xml .
COPY */pom.xml ./
RUN mvn dependency:go-offline  # Cached unless pom.xml changes
COPY . .
RUN mvn package
```

### Mistake 2: Including Build Tools in Runtime

Build tools (JDK, Maven, Gradle) add hundreds of megabytes and increase the attack surface. They should never appear in the final runtime image.

```dockerfile
# WRONG: Build stage artifacts leak to runtime
FROM eclipse-temurin:21-jdk-alpine
WORKDIR /app
RUN mvn package  # JDK and Maven in final image!
COPY target/*.jar .
ENTRYPOINT ["java", "-jar", "app.jar"]

# CORRECT: Use separate stages
FROM maven:3.9.6 AS build
# ... build ...

FROM eclipse-temurin:21-jre-alpine
COPY --from=build /app/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Mistake 3: Not Extracting Layers for Spring Boot

Without layer extraction, any change to any class file invalidates the entire JAR layer, forcing a full rebuild of that layer.

```dockerfile
# WRONG: Copying whole JAR (no layer caching)
FROM eclipse-temurin:21-jre-alpine
COPY target/*.jar app.jar  # Any change to any class rebuilds layer

# CORRECT: Extract layers
FROM eclipse-temurin:21-jdk-alpine AS layers
COPY target/*.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre-alpine
COPY --from=layers dependencies/ ./
COPY --from=layers application/ ./
# Dependencies cached separately from application code
```

### Mistake 4: Using Same Stage for Multiple Architectures

Hardcoded JDK paths break when building for different architectures. Use `$JAVA_HOME` instead.

```dockerfile
# WRONG: Platform-specific JDK path
RUN jlink --module-path /usr/lib/jvm/java-21-openjdk/jmods  # Hardcoded path!

# CORRECT: Use environment variable
RUN jlink --module-path $JAVA_HOME/jmods

# Or use multi-platform build
FROM --platform=$TARGETPLATFORM eclipse-temurin:21-jdk-alpine AS jre
RUN jlink --module-path $JAVA_HOME/jmods --add-modules java.base --output /jre
```

### Mistake 5: Not Cleaning Up in Build Stage

The build stage's `.m2` directory contains all downloaded dependencies (~500MB). While this doesn't affect the final image (it's a separate stage), it adds to the build cache size on disk and slows cache export/import in CI.

```dockerfile
# WRONG: Build stage accumulates temp files
FROM maven:3.9.6 AS build
WORKDIR /app
COPY . .
RUN mvn package
# .m2 directory contains all downloaded dependencies (~500MB)
# These are still in the build stage image layers

# CORRECT: Clean up or use multi-stage
FROM maven:3.9.6 AS build
WORKDIR /app
COPY . .
RUN mvn package -B && \
    rm -rf /root/.m2/repository  # Remove cached dependencies
```

---

## Summary

Multi-stage builds are essential for production Docker images:

1. **Separation of concerns**: Build tools stay in build stage, runtime gets minimal image
2. **Smaller images**: 60-80% size reduction compared to single-stage JDK images
3. **Faster deployments**: Smaller images transfer faster
4. **Better security**: Fewer packages means smaller attack surface
5. **Layer caching**: Proper ordering maximizes Docker build cache

Use layered JAR extraction for Spring Boot, jlink for minimal JREs, and BuildKit cache mounts for CI/CD pipeline performance.

---

## References

- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Spring Boot Layered JARs](https://docs.spring.io/spring-boot/docs/current/reference/html/container-images.html)
- [Google Distroless Images](https://github.com/GoogleContainerTools/distroless)
- [jlink Documentation](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jlink.html)

---

Happy Coding