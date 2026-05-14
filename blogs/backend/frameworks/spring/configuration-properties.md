---
title: "Configuration Properties in Spring Boot"
description: "Master type-safe configuration with @ConfigurationProperties, property binding, validation, and advanced configuration techniques in Spring Boot"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - configuration
  - properties
  - externalized-config
coverImage: "/images/configuration-properties.png"
draft: false
---

## Overview

Spring Boot's @ConfigurationProperties provides type-safe, structured access to application properties. Unlike @Value which injects individual properties, @ConfigurationProperties binds entire property hierarchies to strongly-typed Java objects with built-in validation and IDE support.

The fundamental advantage over `@Value` is structure. `@Value` scatters property access across your codebase as string literals, making refactoring and audit difficult. `@ConfigurationProperties` centralizes all related properties in one class with a defined prefix, enabling IDE auto-completion, type conversion, and validation at startup.

## Basic ConfigurationProperties

### Simple Binding

The class below binds all `app.mail.*` properties. Default values are provided directly on fields, so the application works even without explicit configuration. The `@Component` annotation enables component scanning, making the properties injectable anywhere.

```java
@ConfigurationProperties(prefix = "app.mail")
@Component
public class MailProperties {
    private String host = "localhost";
    private int port = 25;
    private String username;
    private String password;
    private boolean tls = true;
    private Duration timeout = Duration.ofSeconds(30);

    // Getters and setters
    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }

    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public boolean isTls() { return tls; }
    public void setTls(boolean tls) { this.tls = tls; }

    public Duration getTimeout() { return timeout; }
    public void setTimeout(Duration timeout) { this.timeout = timeout; }
}
```

```yaml
# application.yml
app:
  mail:
    host: smtp.gmail.com
    port: 587
    username: user@gmail.com
    password: ${MAIL_PASSWORD}
    tls: true
    timeout: 30s
```

### Enabling ConfigurationProperties

There are three ways to enable `@ConfigurationProperties` binding. `@Component` on the properties class is the simplest for standalone applications. `@EnableConfigurationProperties` on a `@Configuration` class is better for libraries and starters. `@ConfigurationPropertiesScan` enables scanning across specific packages.

```java
// Method 1: @EnableConfigurationProperties
@SpringBootApplication
@EnableConfigurationProperties(MailProperties.class)
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

// Method 2: @ComponentScan (already covered by @Component)
// Method 3: @ConfigurationPropertiesScan
@SpringBootApplication
@ConfigurationPropertiesScan("com.example.config")
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

## Nested Properties

Nested objects are created automatically by Spring Boot's binder. The `PoolConfig` and `ReplicaConfig` inner classes in `DataSourceProperties` are populated from the YAML hierarchy. Spring Boot matches the flattened property names (e.g., `app.datasource.pool.max-size`) to the nested object structure.

This pattern keeps the configuration organized: top-level properties for the service, nested for related subsystems. The inner classes are typically `public static` so they can be instantiated by the binding framework.

```java
@ConfigurationProperties(prefix = "app.datasource")
@Component
public class DataSourceProperties {
    private String url;
    private String driverClassName = "org.postgresql.Driver";
    private PoolConfig pool = new PoolConfig();
    private ReplicaConfig replica = new ReplicaConfig();

    // Getters and setters for url, driverClassName, pool, replica

    public static class PoolConfig {
        private int maxSize = 10;
        private int minIdle = 2;
        private Duration maxLifetime = Duration.ofMinutes(30);
        private Duration connectionTimeout = Duration.ofSeconds(5);
        private String validationQuery = "SELECT 1";

        // Getters and setters
        public int getMaxSize() { return maxSize; }
        public void setMaxSize(int maxSize) { this.maxSize = maxSize; }
        public int getMinIdle() { return minIdle; }
        public void setMinIdle(int minIdle) { this.minIdle = minIdle; }
        public Duration getMaxLifetime() { return maxLifetime; }
        public void setMaxLifetime(Duration maxLifetime) { this.maxLifetime = maxLifetime; }
        public Duration getConnectionTimeout() { return connectionTimeout; }
        public void setConnectionTimeout(Duration connectionTimeout) { this.connectionTimeout = connectionTimeout; }
        public String getValidationQuery() { return validationQuery; }
        public void setValidationQuery(String validationQuery) { this.validationQuery = validationQuery; }
    }

    public static class ReplicaConfig {
        private String url;
        private int poolSize = 5;

        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }
        public int getPoolSize() { return poolSize; }
        public void setPoolSize(int poolSize) { this.poolSize = poolSize; }
    }
}
```

```yaml
app:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb
    driver-class-name: org.postgresql.Driver
    pool:
      max-size: 20
      min-idle: 5
      max-lifetime: 30m
      connection-timeout: 5s
      validation-query: SELECT 1
    replica:
      url: jdbc:postgresql://replica:5432/mydb
      pool-size: 5
```

## Lists and Maps

Collections are bound naturally. Lists are populated from YAML sequences, and maps from key-value pairs. For maps with complex values, the value type's fields are bound from the nested YAML properties.

The `CacheProperties` example below shows three collection patterns: a simple list of strings (`cacheNames`), a map of named cache configurations (`caches`), and a list of complex objects (`defaults`). Each pattern is bound by a different YAML structure.

```java
@ConfigurationProperties(prefix = "app.cache")
@Component
public class CacheProperties {
    private List<String> cacheNames = new ArrayList<>();
    private Map<String, CacheConfig> caches = new HashMap<>();
    private List<CacheConfig> defaults = new ArrayList<>();

    // Getters and setters
    public List<String> getCacheNames() { return cacheNames; }
    public void setCacheNames(List<String> cacheNames) { this.cacheNames = cacheNames; }
    public Map<String, CacheConfig> getCaches() { return caches; }
    public void setCaches(Map<String, CacheConfig> caches) { this.caches = caches; }
    public List<CacheConfig> getDefaults() { return defaults; }
    public void setDefaults(List<CacheConfig> defaults) { this.defaults = defaults; }

    public static class CacheConfig {
        private Duration ttl = Duration.ofMinutes(10);
        private int maxSize = 1000;
        private boolean useRedis = false;

        public Duration getTtl() { return ttl; }
        public void setTtl(Duration ttl) { this.ttl = ttl; }
        public int getMaxSize() { return maxSize; }
        public void setMaxSize(int maxSize) { this.maxSize = maxSize; }
        public boolean isUseRedis() { return useRedis; }
        public void setUseRedis(boolean useRedis) { this.useRedis = useRedis; }
    }
}
```

```yaml
app:
  cache:
    cache-names:
      - users
      - products
      - sessions
    caches:
      users:
        ttl: 5m
        max-size: 5000
      products:
        ttl: 30m
        max-size: 10000
        use-redis: true
      sessions:
        ttl: 15m
        max-size: 2000
    defaults:
      - ttl: 5m
        max-size: 500
```

## Validation

Validation is enabled with the `@Validated` annotation on the properties class. Standard Jakarta Bean Validation annotations (`@NotEmpty`, `@Min`, `@Max`, `@Email`, `@Pattern`, `@URL`) work on individual fields. The `@Valid` annotation triggers validation on nested objects.

Validation happens at startup, immediately after property binding. If validation fails, the application fails to start with a clear error message. This is far better than discovering configuration errors at runtime when a service call fails.

```java
@ConfigurationProperties(prefix = "app.service")
@Component
@Validated
public class ServiceProperties {
    @NotEmpty(message = "Service name must not be empty")
    private String name;

    @Min(value = 1, message = "Port must be at least 1")
    @Max(value = 65535, message = "Port must be at most 65535")
    private int port = 8080;

    @NotNull
    @Valid
    private EndpointConfig endpoint = new EndpointConfig();

    @Email
    private String contactEmail;

    @Pattern(regexp = "^[a-zA-Z0-9-]+$", message = "Instance ID must be alphanumeric")
    private String instanceId;

    @DurationMin(seconds = 1)
    @DurationMax(seconds = 60)
    private Duration healthCheckInterval = Duration.ofSeconds(10);

    // Getters and setters
}

public class EndpointConfig {
    @NotBlank
    @URL(protocol = "https")
    private String baseUrl;

    @Min(0)
    @Max(100)
    private int retryCount = 3;

    @AssertTrue(message = "SSL must be enabled for production")
    public boolean isSslEnabled() {
        return baseUrl == null || baseUrl.startsWith("https://");
    }

    // Getters and setters
}
```

## Immutable ConfigurationProperties

`@ConstructorBinding` creates immutable properties classes. Instead of setters, the single constructor receives all bound values. This pattern is preferred for configuration objects because it enforces immutability — once bound, the configuration cannot be changed at runtime.

Constructor binding works with both Java records and regular classes with a single constructor. Nested objects must also use constructor binding or be mutable inner classes.

```java
@ConfigurationProperties(prefix = "app.kafka")
@ConstructorBinding
public class KafkaProperties {
    private final String bootstrapServers;
    private final String groupId;
    private final boolean autoOffsetReset;
    private final ProducerConfig producer;
    private final ConsumerConfig consumer;

    public KafkaProperties(String bootstrapServers,
                          String groupId,
                          boolean autoOffsetReset,
                          ProducerConfig producer,
                          ConsumerConfig consumer) {
        this.bootstrapServers = bootstrapServers;
        this.groupId = groupId;
        this.autoOffsetReset = autoOffsetReset;
        this.producer = producer;
        this.consumer = consumer;
    }

    // Getters only (no setters)
    public String getBootstrapServers() { return bootstrapServers; }
    public String getGroupId() { return groupId; }
    public boolean isAutoOffsetReset() { return autoOffsetReset; }
    public ProducerConfig getProducer() { return producer; }
    public ConsumerConfig getConsumer() { return consumer; }

    public static class ProducerConfig {
        private final int acks;
        private final int retries;
        private final int batchSize;

        public ProducerConfig(int acks, int retries, int batchSize) {
            this.acks = acks;
            this.retries = retries;
            this.batchSize = batchSize;
        }

        public int getAcks() { return acks; }
        public int getRetries() { return retries; }
        public int getBatchSize() { return batchSize; }
    }

    public static class ConsumerConfig {
        private final String autoOffsetReset;
        private final int maxPollRecords;
        private final Duration sessionTimeout;

        public ConsumerConfig(String autoOffsetReset, int maxPollRecords, Duration sessionTimeout) {
            this.autoOffsetReset = autoOffsetReset;
            this.maxPollRecords = maxPollRecords;
            this.sessionTimeout = sessionTimeout;
        }

        public String getAutoOffsetReset() { return autoOffsetReset; }
        public int getMaxPollRecords() { return maxPollRecords; }
        public Duration getSessionTimeout() { return sessionTimeout; }
    }
}
```

## Property Conversion

### Custom Converters

Spring Boot automatically converts String properties to common types (Duration, DataSize, InetAddress, etc.). For custom types, implement `Converter<String, T>` and annotate with `@ConfigurationPropertiesBinding`. Spring Boot discovers these converters automatically and uses them during property binding.

The `CidrBlockConverter` below converts a string like `"10.0.0.0/8"` into a `CidrBlock` object. Without the converter, Spring Boot would fail to bind the property with a "Failed to convert value" error.

```java
@ConfigurationProperties(prefix = "app.security")
@Component
public class SecurityProperties {
    private List<String> allowedOrigins;
    private Duration sessionTimeout;
    private DataSize maxUploadSize;
    private Map<String, Role> roleMappings;

    // Custom type conversion
    private CidrBlock allowedCidr;

    // Getters and setters
}

// Custom converter
@ConfigurationPropertiesBinding
public class CidrBlockConverter implements Converter<String, CidrBlock> {
    @Override
    public CidrBlock convert(String source) {
        String[] parts = source.split("/");
        String ip = parts[0];
        int prefix = parts.length > 1 ? Integer.parseInt(parts[1]) : 32;
        return new CidrBlock(ip, prefix);
    }
}

public record CidrBlock(String ip, int prefix) {
    public boolean contains(String ipAddress) {
        // CIDR matching logic
        return true;
    }
}
```

## Relaxed Binding

Spring Boot's relaxed binding (also called "lenient binding") allows properties to be specified in multiple formats. This eliminates the friction between environment variable naming conventions (UPPER_CASE with underscores) and Java naming conventions (camelCase).

The `jwtSecret` property below can be set as:
- `app.security.jwt-secret` (kebab-case, recommended in .yml/.properties)
- `app.security.jwt_secret` (underscore notation)
- `app.security.JWT_SECRET` (UPPER_CASE)
- `app.security.jwtSecret` (camelCase, as in Java)

```java
// All of these will bind to the same property
@ConfigurationProperties(prefix = "app.security")
@Component
public class SecurityProperties {
    private String jwtSecret; // camelCase
    // Matches: jwt-secret, jwt_secret, JWT_SECRET, jwtSecret
}
```

```yaml
app:
  security:
    jwt-secret: my-secret-key  # kebab-case (recommended in YAML)
    # jwt_secret: my-secret-key  # underscore notation
    # JWT_SECRET: my-secret-key  # UPPER_CASE (for environment variables)
```

## @ConfigurationProperties vs @Value

`@Value` is for simple, single-value injection, especially when you need SpEL expressions. `@ConfigurationProperties` is for structured, grouped configuration. The decision rule: if you have more than two related properties, use `@ConfigurationProperties`. If you need a single property with a default, `@Value` is fine.

`@Value` supports SpEL (`#{...}`) which `@ConfigurationProperties` does not. However, `@ConfigurationProperties` supports relaxed binding, validation, IDE metadata, and nested objects.

```java
// @Value - for simple, individual property injection
@Component
public class SimpleConfig {
    @Value("${app.name:default-name}")
    private String appName;

    @Value("#{2 * T(java.lang.Math).PI}")
    private double piValue;

    @Value("#{systemProperties['user.home']}")
    private String userHome;
}

// @ConfigurationProperties - for structured, grouped configuration
@ConfigurationProperties(prefix = "app")
@Component
public class AppProperties {
    private String name;
    private String version;
    private String description;
    private Contact contact = new Contact();
    private License license = new License();

    // Getters and setters

    public static class Contact {
        private String name;
        private String email;
        private String url;
        // Getters and setters
    }

    public static class License {
        private String type;
        private String url;
        // Getters and setters
    }
}
```

## Using Properties in Beans

Inject `@ConfigurationProperties` beans via constructor injection. The properties class is a regular Spring bean, so it participates in dependency injection normally. Using constructor injection ensures the properties are immutable and testable — you can construct the service with any properties instance in tests.

```java
@Service
public class EmailSender {
    private final MailProperties mailProperties;
    private final JavaMailSender mailSender;

    public EmailSender(MailProperties mailProperties, JavaMailSender mailSender) {
        this.mailProperties = mailProperties;
        this.mailSender = mailSender;
    }

    public void sendEmail(String to, String subject, String body) {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message);

        helper.setFrom(mailProperties.getUsername());
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(body);

        mailSender.send(message);
    }
}
```

## Best Practices

1. **Use @ConfigurationProperties for grouped configuration** - use @Value for single values
2. **Enable validation with @Validated** to catch misconfiguration early
3. **Prefer @ConstructorBinding** for immutable properties
4. **Use meaningful prefix names** following a hierarchical structure
5. **Provide sensible defaults** in the properties class
6. **Use metadata annotations** (@JsonPropertyDescription) for IDE support
7. **Externalize sensitive values** using environment variables or Vault

## Common Mistakes

### Mistake 1: Not Enabling ConfigurationProperties

```java
// Wrong: @ConfigurationProperties without enabling it
@ConfigurationProperties(prefix = "app.database")
public class DatabaseProperties {
    private String url;
    private String username;
    // Properties will NOT be bound
}
```

```java
// Correct: Enable via @Component or @EnableConfigurationProperties
@ConfigurationProperties(prefix = "app.database")
@Component // Option 1: Component scan
public class DatabaseProperties {
    private String url;
    private String username;

    // Getters and setters
}

// Or
@Configuration
@EnableConfigurationProperties(DatabaseProperties.class) // Option 2
public class AppConfig {
}
```

### Mistake 2: Mutable Properties in Thread-Safe Context

```java
// Wrong: Exposing mutable collections
@ConfigurationProperties(prefix = "app.config")
@Component
public class AppConfig {
    private List<String> allowedUsers = new ArrayList<>();

    public List<String> getAllowedUsers() {
        return allowedUsers; // Caller can modify the internal list
    }
}
```

```java
// Correct: Return unmodifiable collections
@ConfigurationProperties(prefix = "app.config")
@Component
public class AppConfig {
    private List<String> allowedUsers = new ArrayList<>();

    public List<String> getAllowedUsers() {
        return Collections.unmodifiableList(allowedUsers);
    }

    // Or use @ConstructorBinding for full immutability
}
```

### Mistake 3: Missing Default Constructor

```java
// Wrong: No default constructor required for @ConstructorBinding
@ConfigurationProperties(prefix = "app.db")
@ConstructorBinding
public class DbProperties {
    private final String url;

    public DbProperties(String url) {
        this.url = url;
    }

    public String getUrl() { return url; }
}
```

## Summary

@ConfigurationProperties provides type-safe, structured configuration binding in Spring Boot. It supports nested objects, collections, validation, relaxed binding, and custom type converters. Prefer it over @Value for grouped configuration properties and always validate configuration at startup to catch issues early.

## References

- [Spring Boot Configuration Properties](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [@ConfigurationProperties Annotation](https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.typesafe-configuration-properties)
- [Property Conversion](https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.typesafe-configuration-properties.conversion)
- [Configuration Metadata](https://docs.spring.io/spring-boot/reference/configuration-metadata.html)

Happy Coding
