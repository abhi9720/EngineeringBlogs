---
title: "Multi-Module Project Structure"
description: "Design and organize multi-module Maven and Gradle projects for microservices: module boundaries, dependency management, and build optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - maven
  - gradle
  - multi-module
  - project-structure
  - architecture
coverImage: "/images/multi-module-project-structure.png"
draft: false
---

# Multi-Module Project Structure: Organization and Best Practices

## Overview

As backend applications grow beyond a single module, organizing code into a multi-module structure becomes essential. Multi-module projects enforce separation of concerns, enable parallel development, and produce reusable artifacts. Both Maven and Gradle support multi-module builds, and many large Spring Boot applications use this pattern.

This guide covers module design principles, dependency management, build optimization, and common patterns for organizing enterprise-grade multi-module projects.

---

## Module Design Principles

### Layered Architecture

```
order-management/
    ├── order-common/           # Shared DTOs, constants, utilities
    ├── order-domain/           # Business logic, domain models
    ├── order-repository/       # Data access, repositories
    ├── order-service/          # Service layer with business logic
    ├── order-web/              # REST controllers, request/response
    └── order-bootstrap/        # Spring Boot application entry point
```

### Key Principles

```java
// Module A: order-common (no Spring dependencies)
package com.example.order.common.dto;

public class OrderCreatedEvent {
    private final String orderId;
    private final String customerId;
    private final BigDecimal total;
    private final Instant timestamp;

    public OrderCreatedEvent(String orderId, String customerId,
                              BigDecimal total, Instant timestamp) {
        this.orderId = orderId;
        this.customerId = customerId;
        this.total = total;
        this.timestamp = timestamp;
    }

    // Getters only - immutable DTO
}

// Module B: order-domain (pure Java, no framework dependencies)
package com.example.order.domain;

public class Order {
    private OrderId id;
    private CustomerId customerId;
    private List<OrderLineItem> items;
    private OrderStatus status;
    private Money totalAmount;

    public void addItem(Product product, int quantity) {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Cannot modify non-draft order");
        }
        items.add(new OrderLineItem(product, quantity));
        recalculateTotal();
    }

    public void submit() {
        validateForSubmission();
        this.status = OrderStatus.SUBMITTED;
        registerEvent(new OrderSubmittedEvent(this.id));
    }

    private void validateForSubmission() {
        if (items.isEmpty()) {
            throw new ValidationException("Order must have at least one item");
        }
    }

    private void recalculateTotal() {
        this.totalAmount = items.stream()
            .map(OrderLineItem::getSubtotal)
            .reduce(Money.ZERO, Money::add);
    }
}
```

---

## Maven Multi-Module Setup

### Parent POM Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>order-management</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>pom</packaging>

    <modules>
        <module>order-common</module>
        <module>order-domain</module>
        <module>order-repository</module>
        <module>order-service</module>
        <module>order-web</module>
        <module>order-bootstrap</module>
    </modules>

    <properties>
        <java.version>21</java.version>
        <spring-boot.version>3.2.0</spring-boot.version>
        <mapstruct.version>1.5.5.Final</mapstruct.version>
        <jackson.version>2.16.1</jackson.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <!-- Internal modules -->
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>order-common</artifactId>
                <version>${project.version}</version>
            </dependency>
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>order-domain</artifactId>
                <version>${project.version}</version>
            </dependency>

            <!-- External BOMs -->
            <dependency>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-dependencies</artifactId>
                <version>${spring-boot.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-maven-plugin</artifactId>
                    <version>${spring-boot.version}</version>
                </plugin>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-compiler-plugin</artifactId>
                    <configuration>
                        <source>${java.version}</source>
                        <target>${java.version}</target>
                    </configuration>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
```

### Child Module POM

```xml
<!-- order-service/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <parent>
        <groupId>com.example</groupId>
        <artifactId>order-management</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </parent>

    <artifactId>order-service</artifactId>
    <packaging>jar</packaging>

    <dependencies>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>order-domain</artifactId>
        </dependency>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>order-repository</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>

<!-- order-bootstrap/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <parent>
        <groupId>com.example</groupId>
        <artifactId>order-management</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </parent>

    <artifactId>order-bootstrap</artifactId>
    <packaging>jar</packaging>

    <dependencies>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>order-web</artifactId>
        </dependency>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>order-service</artifactId>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <mainClass>com.example.order.OrderApplication</mainClass>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

---

## Gradle Multi-Module Setup

### Settings and Root Build

```kotlin
// settings.gradle.kts
rootProject.name = "order-management"

include(
    "order-common",
    "order-domain",
    "order-repository",
    "order-service",
    "order-web",
    "order-bootstrap"
)

// Give modules descriptive names
project(":order-common").name = "order-common"
project(":order-domain").name = "order-domain"
project(":order-repository").name = "order-repository"
project(":order-service").name = "order-service"
project(":order-web").name = "order-web"
project(":order-bootstrap").name = "order-bootstrap"

// Enable parallel execution and caching
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")
enableFeaturePreview("STABLE_CONFIGURATION_CACHE")
```

```kotlin
// build.gradle.kts (root)
plugins {
    id("org.springframework.boot") version "3.2.0" apply false
    id("io.spring.dependency-management") version "1.1.4" apply false
    java
}

group = "com.example"
version = "1.0.0-SNAPSHOT"

subprojects {
    apply(plugin = "java")
    apply(plugin = "io.spring.dependency-management")

    group = rootProject.group
    version = rootProject.version

    java {
        sourceCompatibility = JavaVersion.VERSION_21
        toolchain {
            languageVersion.set(JavaLanguageVersion.of(21))
        }
    }

    repositories {
        mavenCentral()
    }

    the<io.spring.gradle.dependencymanagement.DependencyManagementExtension>().apply {
        imports {
            mavenBom("org.springframework.boot:spring-boot-dependencies:3.2.0")
            mavenBom("org.springframework.cloud:spring-cloud-dependencies:2023.0.0")
        }
    }
}

// Version catalog
// gradle/libs.versions.toml
[versions]
spring-boot = "3.2.0"
spring-cloud = "2023.0.0"
mapstruct = "1.5.5.Final"
testcontainers = "1.19.3"
lombok = "1.18.30"

[libraries]
spring-boot-starter-web = { module = "org.springframework.boot:spring-boot-starter-web" }
spring-boot-starter-data-jpa = { module = "org.springframework.boot:spring-boot-starter-data-jpa" }
spring-boot-starter-validation = { module = "org.springframework.boot:spring-boot-starter-validation" }
mapstruct = { module = "org.mapstruct:mapstruct", version.ref = "mapstruct" }
mapstruct-processor = { module = "org.mapstruct:mapstruct-processor", version.ref = "mapstruct" }
lombok = { module = "org.projectlombok:lombok", version.ref = "lombok" }
testcontainers-bom = { module = "org.testcontainers:testcontainers-bom", version.ref = "testcontainers" }
testcontainers-postgresql = { module = "org.testcontainers:postgresql", version.ref = "testcontainers" }
testcontainers-junit-jupiter = { module = "org.testcontainers:junit-jupiter", version.ref = "testcontainers" }

[bundles]
spring-web = ["spring-boot-starter-web", "spring-boot-starter-validation"]
testing = ["testcontainers-postgresql", "testcontainers-junit-jupiter"]

[plugins]
spring-boot = { id = "org.springframework.boot", version.ref = "spring-boot" }
spring-dependency-management = { id = "io.spring.dependency-management", version.ref = "spring-dependency-management" }
```

### Submodule Build Files

```kotlin
// order-common/build.gradle.kts
plugins {
    `java-library`
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind")
    api("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
    api("jakarta.validation:jakarta.validation-api")
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")
}

tasks.jar {
    enabled = true
}

// order-domain/build.gradle.kts
plugins {
    `java-library`
}

dependencies {
    api(project(":order-common"))
    api("jakarta.validation:jakarta.validation-api")
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")
}

// order-repository/build.gradle.kts
plugins {
    `java-library`
}

dependencies {
    api(project(":order-domain"))
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    runtimeOnly("org.postgresql:postgresql")
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")
}

// order-service/build.gradle.kts
plugins {
    `java-library`
}

dependencies {
    api(project(":order-domain"))
    implementation(project(":order-repository"))
    implementation("org.springframework.boot:spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:postgresql")
    testImplementation("org.testcontainers:junit-jupiter")
}

// order-web/build.gradle.kts
plugins {
    `java-library`
}

dependencies {
    api(project(":order-service"))
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")
}

// order-bootstrap/build.gradle.kts
plugins {
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

dependencies {
    implementation(project(":order-web"))
    implementation(project(":order-service"))
    implementation("org.springframework.boot:spring-boot-starter-actuator")
}
```

---

## Dependency Management Patterns

### Enforcing Module Boundaries

```java
// ArchUnit test to enforce module boundaries
@RunWith(ArchUnitRunner.class)
public class ModuleArchitectureTest {

    @Test
    public void domainShouldNotDependOnInfrastructure() {
        JavaClasses classes = new ClassFileImporter()
            .importPackages("com.example.order..");

        ArchRule rule = classes()
            .that().resideInAPackage("..domain..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage(
                "..domain..",
                "..common..",
                "java..",
                "jakarta.."
            );

        rule.check(classes);
    }

    @Test
    public void webShouldOnlyDependOnService() {
        JavaClasses classes = new ClassFileImporter()
            .importPackages("com.example.order..");

        ArchRule rule = classes()
            .that().resideInAPackage("..web..")
            .should().onlyAccessClassesThat()
            .resideInAnyPackage(
                "..web..",
                "..service..",
                "..common..",
                "java..",
                "org.springframework..",
                "jakarta.."
            );

        rule.check(classes);
    }

    @Test
    public void noCyclicDependencies() {
        JavaClasses classes = new ClassFileImporter()
            .importPackages("com.example.order..");

        ArchRule rule = slices()
            .matching("com.example.order.(*)..")
            .should().beFreeOfCycles();

        rule.check(classes);
    }
}
```

### Version Alignment Strategy

```kotlin
// Gradle: Enforce consistent versions across all modules
// build.gradle.kts (root)
allprojects {
    configurations.all {
        resolutionStrategy {
            // Fail on version conflicts
            failOnVersionConflict()

            // Force specific versions
            force(
                "com.fasterxml.jackson.core:jackson-databind:2.16.1",
                "com.fasterxml.jackson.core:jackson-core:2.16.1",
                "com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.16.1"
            )

            // Cache dynamic versions for 10 minutes
            cacheDynamicVersionsFor(10, TimeUnit.MINUTES)
            cacheChangingModulesFor(0, TimeUnit.SECONDS)
        }

        // Exclude commons-logging globally
        exclude(group = "commons-logging", module = "commons-logging")
    }
}

// Gradle: Dependency locking for reproducible builds
dependencyLocking {
    lockAllConfigurations()
    lockMode = LockMode.STRICT
}
```

---

## Build Optimization

### Parallel Build Configuration

```xml
<!-- Maven: .mvn/maven.config -->
-T 4
--also-make
--also-make-dependents
--fail-at-end
```

```properties
# Maven: .mvn/jvm.config
-Xmx2g
-XX:+UseParallelGC
-XX:+TieredCompilation
-XX:TieredStopAtLevel=1
```

```kotlin
// Gradle: gradle.properties
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.configuration-cache=true
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m
org.gradle.workers.max=4
```

### Selective Build

```bash
# Maven: Build only specific modules
mvn install -pl order-service,order-web -am
# -pl: project list
# -am: also make dependencies

# Gradle: Build specific modules
./gradlew :order-web:build
./gradlew :order-service:test

# Gradle: Build changed modules only
./gradlew build -x :order-common:test -x :order-domain:test
```

### Build Cache Configuration

```kotlin
// Gradle: settings.gradle.kts
buildCache {
    local {
        isEnabled = true
        directory = File(rootDir, ".gradle-build-cache")
        removeUnusedEntriesAfterDays = 7
    }

    remote(HttpBuildCache::class) {
        url = uri("https://build-cache.internal.company.com/cache/")
        isPush = System.getenv("CI") == "true"
        credentials {
            username = System.getenv("BUILD_CACHE_USER")
            password = System.getenv("BUILD_CACHE_PASS")
        }
    }
}
```

---

## Testing in Multi-Module Projects

### Test Configuration

```kotlin
// Gradle: Configure test tasks consistently
subprojects {
    tasks.withType<Test> {
        useJUnitPlatform()
        maxParallelForks = Runtime.getRuntime().availableProcessors()
        testLogging {
            events("passed", "skipped", "failed")
            showExceptions = true
            showCauses = true
            showStackTraces = true
        }

        reports {
            html.required.set(true)
            junitXml.required.set(true)
        }
    }

    // Unit test vs integration test separation
    tasks.register<Test>("unitTest") {
        description = "Runs unit tests"
        group = "verification"
        useJUnitPlatform {
            excludeTags("integration", "slow")
        }
    }

    tasks.register<Test>("integrationTest") {
        description = "Runs integration tests"
        group = "verification"
        useJUnitPlatform {
            includeTags("integration")
        }
        shouldRunAfter("test")
    }
}

// Shared test utilities module
// order-test-support/build.gradle.kts
plugins {
    `java-library`
}

dependencies {
    api("org.springframework.boot:spring-boot-starter-test")
    api("org.testcontainers:testcontainers")
    api("org.testcontainers:postgresql")
    api("org.testcontainers:junit-jupiter")
}

// Abstract test container class
public abstract class AbstractIntegrationTest {

    @Container
    protected static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
        .withDatabaseName("testdb")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
}
```

---

## Common Mistakes

### Mistake 1: Fat Module (Kitchen Sink Pattern)

```java
// WRONG: Single massive module
// order-service (contains everything!)
//   - src/main/java/com/example/order/
//       model/
//       repository/
//       service/
//       controller/
//       config/
//       dto/
//       mapper/
//       exception/
//       client/
// Everything depends on Spring Boot
// Any change rebuilds everything

// CORRECT: Split into focused modules
// order-common/  -> DTOs, constants
// order-domain/  -> pure domain logic
// order-repository/ -> data access
// order-service/ -> orchestration
// order-web/     -> HTTP layer
// order-bootstrap/ -> entry point
```

### Mistake 2: Circular Dependencies Between Modules

```xml
<!-- WRONG: Module A depends on B, B depends on A -->
<!-- order-service depends on order-web -->
<!-- order-web depends on order-service -->

<!-- CORRECT: Dependencies flow in one direction -->
<!-- order-web -> order-service -> order-repository -> order-domain -> order-common -->
```

### Mistake 3: Duplicating Dependency Versions

```xml
<!-- WRONG: Version repeated in each module -->
<version>3.2.0</version>  <!-- In order-service -->
<version>3.2.0</version>  <!-- In order-web -->

<!-- CORRECT: Single source of truth in parent POM -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
</parent>
<!-- No version needed in child POM -->
```

### Mistake 4: Not Using Test Fixtures Module

```kotlin
// WRONG: Copying test utilities across modules
// order-service/src/test has @SpringBootTest config
// order-web/src/test has same @SpringBootTest config
// Duplication and inconsistency

// CORRECT: Shared test support module
dependencies {
    testImplementation(testFixtures(project(":order-test-support")))
}
```

### Mistake 5: Ignoring Build Order

```bash
# WRONG: Building modules independently
cd order-service && mvn install  # Fails because order-domain isn't built yet

# CORRECT: Build from root with dependency awareness
cd .. && mvn install -pl order-service -am
# or
./gradlew :order-service:build  # Gradle handles dependencies automatically
```

---

## Summary

A well-structured multi-module project provides:

1. **Clear boundaries**: Each module has a defined responsibility and dependency direction
2. **Reusable artifacts**: Common code is shared without duplication
3. **Faster builds**: Selective builds and caching reduce build times
4. **Parallel development**: Teams work on independent modules
5. **Enforced architecture**: Module boundaries prevent architectural drift

Key rules: dependencies flow one way, no cycles, fat modules are bad, versions are centralized, and build order is automated.

---

## References

- [Maven Multi-Module Guide](https://maven.apache.org/guides/mini/guide-multiple-modules.html)
- [Gradle Multi-Project Builds](https://docs.gradle.org/current/userguide/multi_project_builds.html)
- [Spring Boot Multi-Module Example](https://spring.io/guides/gs/multi-module/)
- [ArchUnit Documentation](https://www.archunit.org/)

---

Happy Coding 👨‍💻

Happy Coding