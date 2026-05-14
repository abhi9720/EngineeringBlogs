---
title: "Spring Profiles and Environment Abstraction"
description: "Master Spring profiles and the environment abstraction: profile-specific configuration, property sources, conditional beans, and environment post-processing"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - profiles
  - environment
  - configuration
coverImage: "/images/profiles-and-environment.png"
draft: false
---

## Overview

Spring's Environment abstraction provides a unified way to manage application configuration across different environments. Combined with profiles, it enables selective bean registration, property resolution, and configuration separation for development, testing, staging, and production environments.

## The Environment Abstraction

### Accessing the Environment

```java
@Component
public class EnvironmentLogger {
    private final Environment environment;

    public EnvironmentLogger(Environment environment) {
        this.environment = environment;
    }

    public void logEnvironmentInfo() {
        System.out.println("Active Profiles: " + Arrays.toString(environment.getActiveProfiles()));
        System.out.println("Default Profiles: " + Arrays.toString(environment.getDefaultProfiles()));
        System.out.println("App Name: " + environment.getProperty("spring.application.name"));
        System.out.println("Server Port: " + environment.getProperty("server.port", "8080"));
        System.out.println("Required Property: " + environment.getRequiredProperty("app.secret-key"));
    }
}
```

### Property Resolution Order

```java
@Component
public class PropertySourceInspector {
    private final ConfigurableEnvironment environment;

    public PropertySourceInspector(ConfigurableEnvironment environment) {
        this.environment = environment;
    }

    public void inspectPropertySources() {
        MutablePropertySources sources = environment.getPropertySources();
        int order = 1;
        for (PropertySource<?> source : sources) {
            System.out.println(order++ + ". " + source.getName() + " (" + source.getClass().getSimpleName() + ")");
        }
    }
}
```

The property resolution order (highest to lowest precedence):

1. Command line arguments (--server.port=9090)
2. JNDI attributes from java:comp/env
3. System properties (System.getProperties())
4. OS environment variables
5. RandomValuePropertySource (random.*)
6. Profile-specific application properties (application-{profile}.{yml|properties})
7. Application properties (application.{yml|properties})
8. @PropertySource on @Configuration classes
9. Default properties

## Working with Profiles

### Defining Profile-Specific Configurations

```java
// application.yml - common configuration
spring:
  application:
    name: my-service
  datasource:
    url: jdbc:h2:mem:testdb

// application-dev.yml
spring:
  datasource:
    url: jdbc:h2:file:./data/devdb
  jpa:
    show-sql: true
    hibernate:
      ddl-auto: create-drop

// application-prod.yml
spring:
  datasource:
    url: jdbc:postgresql://prod-db:5432/mydb
    hikari:
      maximum-pool-size: 20
  jpa:
    show-sql: false
    hibernate:
      ddl-auto: validate
```

### Profile-Specific Beans

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:h2:mem:devdb")
            .username("sa")
            .password("")
            .driverClassName("org.h2.Driver")
            .build();
    }

    @Bean
    @Profile("prod")
    public DataSource prodDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://prod-db:5432/mydb");
        config.setUsername(System.getenv("DB_USERNAME"));
        config.setPassword(System.getenv("DB_PASSWORD"));
        config.setMaximumPoolSize(20);
        config.setConnectionTimeout(5000);
        return new HikariDataSource(config);
    }

    @Bean
    @Profile("test")
    public DataSource testDataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:h2:mem:test;DB_CLOSE_DELAY=-1")
            .build();
    }
}
```

### Profile Conditions

```java
@Service
@Profile("!test") // Active in all profiles except "test"
public class EmailNotificationService implements NotificationService {
    private final JavaMailSender mailSender;

    public EmailNotificationService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @Override
    public void send(String to, String message) {
        mailSender.send(createMessage(to, message));
    }
}

@Service
@Profile("test")
public class MockNotificationService implements NotificationService {
    private final List<Notification> sent = new ArrayList<>();

    @Override
    public void send(String to, String message) {
        sent.add(new Notification(to, message, Instant.now()));
    }

    public List<Notification> getSent() {
        return List.copyOf(sent);
    }
}
```

### Compound Profile Conditions

```java
@Component
@Profile("prod & !us-east") // Active only in prod, not in us-east region
public class ProdOnlyService {
    // Production-specific implementation
}

@Component
@Profile("dev | staging") // Active in dev OR staging
public class DevStagingService {
    // Development/staging implementation
}

@Component
@Profile("!prod") // Active everywhere except production
public class NonProdService {
    // Non-production implementation
}
```

## Activating Profiles

### Programmatic Activation

```java
@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Application.class);

        // Set active profiles programmatically
        app.setAdditionalProfiles("dev", "cloud");

        // Or activate based on conditions
        String profile = determineProfile();
        app.setAdditionalProfiles(profile);

        app.run(args);
    }

    private static String determineProfile() {
        String env = System.getenv("DEPLOYMENT_ENV");
        if (env == null) {
            return "dev";
        }
        return switch (env.toLowerCase()) {
            case "production" -> "prod";
            case "staging" -> "staging";
            default -> "dev";
        };
    }
}
```

### Property-Based Activation

```yaml
# application.yml
spring:
  profiles:
    active: dev
    group:
      prod: "prod-db,prod-messaging,prod-monitoring"
      dev: "dev-db,dev-messaging"
```

### Activating via Command Line

```bash
# Using --spring.profiles.active
java -jar app.jar --spring.profiles.active=prod

# Using environment variable
set SPRING_PROFILES_ACTIVE=prod,cloud
java -jar app.jar

# Using multiple profiles
java -jar app.jar --spring.profiles.active=prod,us-east
```

## Profile Groups (Spring Boot 2.4+)

```yaml
# application.yml
spring:
  profiles:
    group:
      production: "prod,prod-db,prod-messaging"
      staging: "staging,staging-db,staging-messaging"
      development: "dev,dev-db,h2-console"

# Now --spring.profiles.active=production will activate:
# prod, prod-db, prod-messaging
```

## Custom Environment Post-Processing

### EnvironmentPostProcessor

```java
public class CloudEnvironmentPostProcessor implements EnvironmentPostProcessor {
    private static final String CLOUD_CONFIG_PREFIX = "cloud.config.";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment,
                                       SpringApplication application) {
        if (isCloudEnvironment(environment)) {
            Properties cloudProperties = new Properties();
            cloudProperties.setProperty("server.port", "8080");
            cloudProperties.setProperty("server.ssl.enabled", "true");
            cloudProperties.setProperty("management.endpoints.web.base-path", "/internal/actuator");

            environment.getPropertySources()
                .addFirst(new PropertiesPropertySource("cloud-config", cloudProperties));
        }
    }

    private boolean isCloudEnvironment(Environment environment) {
        return environment.getActiveProfiles().length > 0
            && environment.getActiveProfiles()[0].contains("cloud");
    }
}
```

### Registering the PostProcessor

```java
// META-INF/spring.factories
org.springframework.boot.env.EnvironmentPostProcessor=\
  com.example.config.CloudEnvironmentPostProcessor
```

## Property Overrides

### Using Test Properties

```java
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "app.feature.new-payment=true",
    "app.cache.enabled=false"
})
class PaymentServiceTest {

    @Test
    void testNewPaymentFlow() {
        // Test with specific property overrides
    }
}
```

### Dynamic Property Registration

```java
@SpringBootTest
@ActiveProfiles("test")
class DynamicConfigTest {

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("app.datasource.url", () -> "jdbc:tc:postgresql:15:///testdb");
        registry.add("app.cache.type", () -> "none");
    }

    @Test
    void testWithDynamicProperties() {
        // Properties are available at runtime
    }
}
```

## Multi-Document Properties Files

```yaml
# application.yml - Single file, multiple profile documents
spring:
  application:
    name: my-service
  datasource:
    url: jdbc:h2:mem:defaultdb

---
spring:
  config:
    activate:
      on-profile: dev
  datasource:
    url: jdbc:h2:file:./data/devdb
    username: sa
  jpa:
    show-sql: true

---
spring:
  config:
    activate:
      on-profile: prod
  datasource:
    url: jdbc:postgresql://prod-host:5432/proddb
    username: ${DB_USER}
    password: ${DB_PASS}
  jpa:
    show-sql: false
    hibernate:
      ddl-auto: validate
```

## Using @Profile with Meta-Annotations

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Profile("dev")
public @interface DevOnly {
}

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Profile("prod")
public @interface ProdOnly {
}

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Profile("dev | staging")
public @interface NonProd {
}

// Usage
@DevOnly
@Component
public class DevConsoleService {
    // Only available in dev profile
}

@ProdOnly
@Component
public class ProductionAuditService {
    // Only available in production
}
```

## Best Practices

1. **Use profile groups** (Spring Boot 2.4+) instead of multiple --spring.profiles.active
2. **Externalize profile activation** via environment variables, not hard-coded values
3. **Keep profile-specific config minimal** - share common config in base application.yml
4. **Use @Profile on configuration classes** rather than individual beans
5. **Validate critical properties** at startup using @PostConstruct
6. **Avoid @Profile on @ComponentScan packages** - use it on specific beans
7. **Use @ActiveProfiles in tests** with a dedicated test profile

## Common Mistakes

### Mistake 1: Profile Activation in Production

```java
// Wrong: Hard-coding profile activation
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Application.class);
        app.setAdditionalProfiles("dev"); // NEVER do this in production
        app.run(args);
    }
}
```

```java
// Correct: Externalize profile activation
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

// Activate via: --spring.profiles.active=prod
// Or: SPRING_PROFILES_ACTIVE=prod
```

### Mistake 2: Forgetting to Isolate Profile Beans

```java
// Wrong: Dev tool accidentally registered in production
@Configuration
public class DevConfig {
    @Bean
    public H2ConsoleWebServer h2Console() {
        return new H2ConsoleWebServer(); // Exposed in production!
    }
}
```

```java
// Correct: Profile-protected configuration
@Configuration
@Profile("dev")
public class DevConfig {
    @Bean
    public H2ConsoleWebServer h2Console() {
        return new H2ConsoleWebServer(); // Only in dev
    }
}
```

### Mistake 3: Profile Mismatch in Tests

```java
// Wrong: Test using default profile without explicit activation
@SpringBootTest
class DatabaseServiceTest {
    @Autowired
    private DatabaseService databaseService;

    @Test
    void testConnection() {
        // Might connect to production database if default profile is active
    }
}
```

```java
// Correct: Explicit test profile
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:testdb",
    "spring.jpa.hibernate.ddl-auto=create-drop"
})
class DatabaseServiceTest {
    @Autowired
    private DatabaseService databaseService;

    @Test
    void testConnection() {
        assertDoesNotThrow(() -> databaseService.connect());
    }
}
```

## Summary

Spring's Environment abstraction and profiles provide a powerful, flexible way to manage application configuration across different deployment environments. Use profile-specific configuration files, @Profile annotations, and the Environment API to create applications that adapt seamlessly to development, testing, staging, and production environments.

## References

- [Spring Profiles Documentation](https://docs.spring.io/spring-boot/reference/features/profiles.html)
- [Environment Abstraction](https://docs.spring.io/spring-framework/reference/core/beans/environment.html)
- [Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [Profile Groups](https://docs.spring.io/spring-boot/reference/features/profiles.html#features.profiles.groups)

Happy Coding