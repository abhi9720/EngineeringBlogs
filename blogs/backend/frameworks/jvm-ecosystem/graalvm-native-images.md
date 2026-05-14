---
title: "GraalVM Native Images for Java Applications"
description: "Master GraalVM native images: AOT compilation, reflection configuration, resource handling, native-image building, and deploying optimized JVM applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - java
  - graalvm
  - native-image
  - performance
coverImage: "/images/graalvm-native-images.png"
draft: false
---

## Overview

GraalVM Native Image compiles Java applications ahead-of-time (AOT) into standalone executables that start instantly, use less memory, and require no JVM. This guide covers creating, configuring, and deploying native images with Spring Boot and Quarkus.

## Benefits of Native Images

| Metric | JVM Deploy | Native Image |
|--------|-----------|--------------|
| Startup Time | 3-5 seconds | 10-50ms |
| Memory (RSS) | 150-200MB | 15-30MB |
| First Response | 5-10 seconds | <100ms |
| Packaging | Fat JAR (20MB+) | Single binary (50-80MB) |
| Build Time | Seconds | Minutes (AOT compilation) |

## Installation

```bash
# Install GraalVM using SDKMAN
sdk install java 21.0.2-graal

# Install native-image tool
gu install native-image

# Verify installation
java -version
native-image --version
```

## Spring Boot Native Image

### Dependencies

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
</dependency>

<build>
    <plugins>
        <plugin>
            <groupId>org.graalvm.buildtools</groupId>
            <artifactId>native-maven-plugin</artifactId>
        </plugin>
        <plugin>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-maven-plugin</artifactId>
            <configuration>
                <image>
                    <builder>paketobuildpacks/builder:tiny</builder>
                </image>
            </configuration>
        </plugin>
    </plugins>
</build>
```

### Building Native Image

```bash
# Build native image
mvn -Pnative native:compile

# Or using Spring Boot Maven plugin
mvn spring-boot:build-image

# Run the native executable
./target/my-application
```

## Reflection Configuration

### For Spring Boot

```java
import org.springframework.aot.hint.annotation.Reflective;

@Reflective
public class UserService {
    // Methods will be included in reflection hints
}

// Or use @RegisterReflectionForBinding
import org.springframework.aot.hint.annotation.RegisterReflectionForBinding;

@RegisterReflectionForBinding({User.class, Order.class})
@Configuration
public class ReflectionConfig {
    // Register types for reflection access
}
```

### Manual Reflection Hints

```json
// META-INF/native-image/my-app/reflect-config.json
[
  {
    "name": "com.example.User",
    "allDeclaredFields": true,
    "allDeclaredMethods": true,
    "allDeclaredConstructors": true
  },
  {
    "name": "com.example.UserService",
    "methods": [
      {"name": "findById", "parameterTypes": ["long"] },
      {"name": "createUser", "parameterTypes": ["com.example.CreateUserRequest"] }
    ]
  },
  {
    "name": "java.sql.Driver",
    "methods": [
      {"name": "getConnection", "parameterTypes": ["java.lang.String", "java.util.Properties"] }
    ]
  }
]
```

### Proxy Configuration

```json
// META-INF/native-image/my-app/proxy-config.json
[
  ["com.example.UserRepository"],
  ["org.springframework.data.jpa.repository.JpaRepository", "com.example.UserRepository"]
]
```

### Resource Configuration

```json
// META-INF/native-image/my-app/resource-config.json
{
  "resources": [
    {"pattern": ".*\\.yml$"},
    {"pattern": ".*\\.properties$"},
    {"pattern": "application.*\\.yml$"},
    {"pattern": "messages.*\\.properties$"}
  ],
  "bundles": [
    {"name": "messages"},
    {"name": "javax.servlet.LocalStrings"}
  ]
}
```

## Creating Native Images without Framework

```java
// HelloWorld.java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello from Native Image!");
        System.out.println("Args: " + java.util.Arrays.toString(args));
    }
}

// Build: native-image HelloWorld
// Run: ./helloworld
// Output: Hello from Native Image!
```

### Native Image with GraalVM SDK

```java
import org.graalvm.nativeimage.*;
import org.graalvm.nativeimage.c.function.CFunction;

public class NativeFeatures {
    
    // Image build time initialization
    @org.graalvm.nativeimage.hosted.Feature
    public static class MyFeature implements Feature {
        @Override
        public void duringSetup(DuringSetupAccess access) {
            System.out.println("Setup phase");
        }

        @Override
        public void beforeAnalysis(BeforeAnalysisAccess access) {
            System.out.println("Analysis phase");
        }
    }

    // Initialize at build time
    public static class BuildTimeInit {
        private static final String CONFIG = loadConfig();

        private static String loadConfig() {
            // Runs at build time, not runtime
            return "build-time-config";
        }
    }

    // SubstrateVM API
    public static long getCurrentTime() {
        return ImageInfo.getImageBuildTime();
    }
}
```

## Serialization Configuration

```json
// META-INF/native-image/my-app/serialization-config.json
[
  {
    "name": "com.example.User",
    "customTargetConstructorClass": "com.example.User"
  },
  {
    "name": "java.util.ArrayList"
  }
]
```

## JNI Configuration

```json
// META-INF/native-image/my-app/jni-config.json
[
  {
    "name": "java.lang.ClassLoader",
    "methods": [
      {"name": "loadClass", "parameterTypes": ["java.lang.String"]}
    ]
  },
  {
    "name": "com.example.NativeLibWrapper",
    "allDeclaredFields": true,
    "allDeclaredMethods": true
  }
]
```

## Quarkus Native Image

```xml
<plugin>
    <groupId>io.quarkus.platform</groupId>
    <artifactId>quarkus-maven-plugin</artifactId>
    <extensions>true</extensions>
    <executions>
        <execution>
            <goals>
                <goal>build</goal>
                <goal>generate-code</goal>
                <goal>generate-code-tests</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

```bash
# Build native image with Quarkus
mvn package -Pnative

# Run
./target/my-app-runner

# Build container image
mvn package -Pnative -Dquarkus.native.container-build=true
```

## Performance Comparison

```java
// Test startup time
public class StartupTest {
    public static void main(String[] args) {
        long start = System.nanoTime();
        
        // Application startup
        SpringApplication.run(Application.class, args);
        
        long duration = System.nanoTime() - start;
        System.out.println("Startup: " + duration / 1_000_000 + "ms");
    }
}

// JVM: ~3000-5000ms
// Native: ~30-100ms
// Memory: JVM ~200MB vs Native ~30MB
// Binary: JAR ~20MB vs Native ~60MB
```

## Debugging Native Images

```bash
# Build with verbose output
native-image -H:+ReportExceptionStackTraces -H:Log=registerResource:3

# Build with quick build mode (no optimization)
native-image -Ob

# Enable runtime debugging
native-image -H:-DeleteLocalSymbols -H:+SourceLevelDebug

# Run with native image debugging
./my-app -agentlib:native-image-agent=config-output-dir=config/
```

## Testing Native Images

```java
@SpringBootTest
class NativeApplicationTest {

    @Test
    void shouldStartApplication() {
        assertTrue(SpringApplication.exit(SpringApplication.run(Application.class)) == 0);
    }

    @Test
    void shouldHandleReflection() {
        User user = new User(1L, "test@test.com");
        // Verify all reflection paths work
        Method method = User.class.getMethod("getEmail");
        assertEquals("test@test.com", method.invoke(user));
    }
}
```

## Best Practices

1. **Test native images early** - catch reflection and serialization issues during development
2. **Use tracing agent** (`-agentlib:native-image-agent`) to generate configuration
3. **Minimize dynamic class loading** - avoid Class.forName() and ServiceLoader
4. **Use @RegisterReflectionForBinding** in Spring Boot for all serialized types
5. **Initialize config at build time** with static final fields
6. **Avoid proxies and dynamic proxies** unless configured in reflect-config.json
7. **Use Quarkus for better default native image support** compared to Spring Boot

## Common Mistakes

### Mistake 1: Missing Reflection Configuration

```java
// Wrong: Dynamic reflection without configuration
public class DynamicService {
    public Object createInstance(String className) {
        return Class.forName(className).getDeclaredConstructor().newInstance();
        // Fails in native image: ClassNotFoundException
    }
}
```

```java
// Correct: Pre-register reflected classes
@RegisterReflectionForBinding({User.class, Order.class})
public class DynamicService {
    public Object createInstance(Class<?> clazz) {
        return clazz.getDeclaredConstructor().newInstance();
    }
}
```

### Mistake 2: Runtime Configuration Loading

```java
// Wrong: Config loaded at runtime
public class ConfigService {
    private Properties properties = new Properties();

    public ConfigService() throws IOException {
        properties.load(getClass().getClassLoader().getResourceAsStream("config.properties"));
        // Fails in native image: resource not included
    }
}
```

```java
// Correct: Pre-register resources
// resource-config.json: {"resources": [{"pattern": "config\\.properties$"}]}

public class ConfigService {
    private Properties properties = new Properties();

    public ConfigService() throws IOException {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("config.properties")) {
            properties.load(is);
        }
    }
}
```

## Summary

GraalVM Native Image enables Java applications to start in milliseconds and use minimal memory. While Spring Boot requires reflection configuration, Quarkus has better built-in native image support. Use the tracing agent to generate configuration, test native images thoroughly, and plan for longer build times.

## References

- [GraalVM Native Image Documentation](https://www.graalvm.org/latest/reference-manual/native-image/)
- [Spring Boot Native Image Support](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html)
- [Quarkus Native Image Guide](https://quarkus.io/guides/building-native-image)
- [GraalVM Tracing Agent](https://www.graalvm.org/latest/reference-manual/native-image/agent/)

Happy Coding