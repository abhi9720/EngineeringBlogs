---
title: "Spring Conditional Configuration"
description: "Master Spring's @Conditional annotations: @ConditionalOnClass, @ConditionalOnProperty, @ConditionalOnBean, and creating custom conditions for intelligent bean registration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - conditional-config
  - auto-configuration
  - spring-core
coverImage: "/images/spring-conditional-config.png"
draft: false
---

## Overview

Spring's conditional configuration enables beans to be registered based on specific conditions - whether a class is on the classpath, a property is set, or another bean exists. This is the core mechanism behind Spring Boot's auto-configuration and enables flexible, environment-aware application setup.

## The @Conditional Annotation

### Creating a Custom Condition

```java
public class OnWindowsCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String osName = context.getEnvironment().getProperty("os.name");
        return osName != null && osName.toLowerCase().contains("windows");
    }
}

public class OnMacCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String osName = context.getEnvironment().getProperty("os.name");
        return osName != null && osName.toLowerCase().contains("mac");
    }
}
```

```java
@Configuration
public class OsSpecificConfig {

    @Bean
    @Conditional(OnWindowsCondition.class)
    public FileSystemService windowsFileSystem() {
        return new WindowsFileSystemService();
    }

    @Bean
    @Conditional(OnMacCondition.class)
    public FileSystemService macFileSystem() {
        return new MacFileSystemService();
    }
}
```

## Spring Boot's @ConditionalOn* Annotations

### @ConditionalOnClass

```java
@Configuration
public class DatabaseAutoConfig {

    @Bean
    @ConditionalOnClass(name = "org.postgresql.Driver")
    public DataSource postgresDataSource() {
        return DataSourceBuilder.create()
            .driverClassName("org.postgresql.Driver")
            .url("jdbc:postgresql://localhost:5432/mydb")
            .build();
    }

    @Bean
    @ConditionalOnClass(name = "com.mysql.cj.jdbc.Driver")
    public DataSource mysqlDataSource() {
        return DataSourceBuilder.create()
            .driverClassName("com.mysql.cj.jdbc.Driver")
            .url("jdbc:mysql://localhost:3306/mydb")
            .build();
    }

    @Bean
    @ConditionalOnClass(name = "org.h2.Driver")
    public DataSource h2DataSource() {
        return DataSourceBuilder.create()
            .driverClassName("org.h2.Driver")
            .url("jdbc:h2:mem:testdb")
            .build();
    }
}
```

### @ConditionalOnMissingClass

```java
@Configuration
public class FallbackConfig {

    @Bean
    @ConditionalOnMissingClass("org.postgresql.Driver")
    @ConditionalOnMissingClass("com.mysql.cj.jdbc.Driver")
    public DataSource fallbackDataSource() {
        // H2 in-memory database as fallback
        return DataSourceBuilder.create()
            .driverClassName("org.h2.Driver")
            .url("jdbc:h2:mem:fallback")
            .build();
    }
}
```

### @ConditionalOnProperty

```java
@Component
@ConditionalOnProperty(
    name = "app.feature.notifications.enabled",
    havingValue = "true",
    matchIfMissing = false
)
public class EmailNotificationService implements NotificationService {
    private final JavaMailSender mailSender;

    public EmailNotificationService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendNotification(User user, String message) {
        mailSender.send(createEmail(user.getEmail(), message));
    }
}

@Component
@ConditionalOnProperty(
    name = "app.feature.notifications.provider",
    havingValue = "sms",
    matchIfMissing = true
)
public class SmsNotificationService implements NotificationService {
    private final TwilioClient twilioClient;

    public SmsNotificationService(TwilioClient twilioClient) {
        this.twilioClient = twilioClient;
    }

    public void sendNotification(User user, String message) {
        twilioClient.sendSms(user.getPhone(), message);
    }
}
```

### @ConditionalOnBean and @ConditionalOnMissingBean

```java
@Configuration
public class CacheConfiguration {

    @Bean
    @ConditionalOnMissingBean(CacheManager.class)
    public CacheManager simpleCacheManager() {
        System.out.println("No CacheManager found, creating SimpleCacheManager");
        SimpleCacheManager cacheManager = new SimpleCacheManager();
        cacheManager.setCaches(Set.of(
            new ConcurrentMapCache("default"),
            new ConcurrentMapCache("users")
        ));
        return cacheManager;
    }

    @Bean
    @ConditionalOnBean(name = "redisConnectionFactory")
    public CacheManager redisCacheManager(RedisConnectionFactory connectionFactory) {
        System.out.println("Redis available, creating RedisCacheManager");
        return RedisCacheManager.builder(connectionFactory).build();
    }
}

@Component
@ConditionalOnBean(DataSource.class)
public class DatabaseHealthIndicator implements HealthIndicator {
    private final DataSource dataSource;

    public DatabaseHealthIndicator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Health health() {
        try (Connection conn = dataSource.getConnection()) {
            return Health.up().withDetail("database", conn.getMetaData().getDatabaseProductName()).build();
        } catch (Exception e) {
            return Health.down(e).build();
        }
    }
}
```

### @ConditionalOnResource

```java
@Configuration
public class KeyStoreConfig {

    @Bean
    @ConditionalOnResource(resources = "classpath:keystore.jks")
    public KeyStore keyStore() {
        try {
            KeyStore ks = KeyStore.getInstance("JKS");
            ks.load(new FileInputStream("keystore.jks"), "changeit".toCharArray());
            return ks;
        } catch (Exception e) {
            throw new RuntimeException("Failed to load keystore", e);
        }
    }

    @Bean
    @ConditionalOnResource(resources = "classpath:bootstrap.yml")
    public BootstrapConfig bootstrapConfig() {
        return new BootstrapConfig();
    }
}
```

### @ConditionalOnExpression

```java
@Component
@ConditionalOnExpression("${app.feature.advanced-search:false} and ${app.search.engine:elasticsearch} == 'elasticsearch'")
public class ElasticsearchAdvancedSearchService implements SearchService {
    private final ElasticsearchClient client;

    public ElasticsearchAdvancedSearchService(ElasticsearchClient client) {
        this.client = client;
    }

    @Override
    public SearchResult search(SearchRequest request) {
        return client.search(s -> s
            .index(request.getIndex())
            .query(q -> q
                .bool(b -> {
                    b.must(m -> m.match(t -> t.field("content").query(request.getQuery())));
                    if (request.getFilter() != null) {
                        b.filter(f -> f.term(t -> t.field("category").value(request.getFilter())));
                    }
                    return b;
                })
            )
        ).map(SearchResult::fromElasticsearchResponse);
    }
}
```

### @ConditionalOnJava

```java
@Configuration
public class JavaVersionSpecificConfig {

    @Bean
    @ConditionalOnJava(JavaVersion.SEVENTEEN)
    public RecordService recordService() {
        // Uses Java 17+ records feature
        return new RecordService();
    }

    @Bean
    @ConditionalOnJava(range = ConditionalOnJava.Range.EQUAL_OR_NEWER, value = JavaVersion.TWENTY_ONE)
    public VirtualThreadService virtualThreadService() {
        // Uses Java 21+ virtual threads
        return new VirtualThreadService();
    }
}
```

### @ConditionalOnSingleCandidate

```java
@Configuration
public class PaymentConfig {

    @Bean
    @ConditionalOnSingleCandidate(PaymentGateway.class)
    public PaymentService paymentService(PaymentGateway gateway) {
        // Only create when exactly one PaymentGateway bean exists
        return new PaymentService(gateway);
    }
}
```

### @ConditionalOnCloudPlatform

```java
@Configuration
public class CloudConfig {

    @Bean
    @ConditionalOnCloudPlatform(CloudPlatform.HEROKU)
    public CloudFoundryService herokuService() {
        return new HerokuService();
    }

    @Bean
    @ConditionalOnCloudPlatform(CloudPlatform.KUBERNETES)
    public KubernetesService kubernetesService() {
        return new KubernetesService();
    }
}
```

### @ConditionalOnNotWebApplication

```java
@Component
@ConditionalOnNotWebApplication
public class CliRunner implements CommandLineRunner {
    @Override
    public void run(String... args) {
        System.out.println("Running in non-web context");
    }
}

@Component
@ConditionalOnWarDeployment
public class ServletInitializerConfig {
    // Configuration specific to WAR deployment
}
```

## Custom Conditional Annotations

### Creating Composed Annotations

```java
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Conditional(OnRedisCondition.class)
public @interface ConditionalOnRedis {
}

@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@ConditionalOnClass(name = "redis.clients.jedis.Jedis")
@ConditionalOnProperty(name = "app.cache.type", havingValue = "redis")
public @interface ConditionalOnRedisEnabled {
}

@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@ConditionalOnProperty(name = "app.feature.flag", havingValue = "true")
@ConditionalOnExpression("T(java.lang.Runtime).getRuntime().availableProcessors() > 4")
public @interface ConditionalOnHighPerformance {
}
```

### Using Custom Annotations

```java
@Configuration
public class FeatureConfig {

    @Bean
    @ConditionalOnRedisEnabled
    public CacheManager redisCacheConfig(RedisConnectionFactory factory) {
        return RedisCacheManager.builder(factory).build();
    }

    @Bean
    @ConditionalOnHighPerformance
    public ParallelProcessor parallelProcessor() {
        return new ParallelProcessor(Runtime.getRuntime().availableProcessors());
    }
}
```

## Combining Conditions

### Logical Conditions

```java
@Component
@ConditionalOnProperty("app.feature.fraud-detection")
@ConditionalOnBean(RulesEngine.class)
@ConditionalOnClass(name = "com.example.ml.ModelEvaluator")
public class FraudDetectionService {
    private final RulesEngine rulesEngine;
    private final ModelEvaluator modelEvaluator;

    public FraudDetectionService(RulesEngine rulesEngine, ModelEvaluator modelEvaluator) {
        this.rulesEngine = rulesEngine;
        this.modelEvaluator = modelEvaluator;
    }

    public FraudScore evaluate(Transaction transaction) {
        double rulesScore = rulesEngine.evaluate(transaction);
        double mlScore = modelEvaluator.predict(transaction);
        return new FraudScore(rulesScore * 0.4 + mlScore * 0.6);
    }
}
```

### AllNestedConditions

```java
public class OnProductionWithHighTraffic extends AllNestedConditions {

    public OnProductionWithHighTraffic() {
        super(ConfigurationPhase.REGISTER_BEAN);
    }

    @ConditionalOnProperty(name = "app.env", havingValue = "prod")
    static class OnProduction {}

    @ConditionalOnExpression("${app.max-concurrent-users:0} > 10000")
    static class OnHighTraffic {}
}

@Component
@Conditional(OnProductionWithHighTraffic.class)
public class ProductionHighTrafficService {
    // Only active in production with high traffic
}
```

### AnyNestedCondition

```java
public class OnAnyDatabaseAvailable extends AnyNestedCondition {

    public OnAnyDatabaseAvailable() {
        super(ConfigurationPhase.REGISTER_BEAN);
    }

    @ConditionalOnBean(DataSource.class)
    static class OnDataSource {}

    @ConditionalOnProperty(name = "app.database.url")
    static class OnDatabaseUrl {}
}

@Component
@Conditional(OnAnyDatabaseAvailable.class)
public class DatabaseService {
    // Active if any database configuration is present
}
```

## Condition Evaluation in Auto-Configuration

```java
@AutoConfiguration
@ConditionalOnClass(DataSource.class)
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnProperty(prefix = "spring.datasource", name = "url")
    public DataSource dataSource(DataSourceProperties properties) {
        return DataSourceBuilder.create()
            .url(properties.getUrl())
            .username(properties.getUsername())
            .password(properties.getPassword())
            .driverClassName(properties.getDriverClassName())
            .build();
    }

    @Configuration
    @ConditionalOnClass(HikariDataSource.class)
    @ConditionalOnMissingBean(DataSource.class)
    @ConditionalOnProperty(name = "spring.datasource.type", havingValue = "com.zaxxer.hikari.HikariDataSource", matchIfMissing = true)
    static class Hikari {
        @Bean
        @ConditionalOnMissingBean
        public DataSource hikariDataSource(DataSourceProperties properties) {
            HikariConfig config = new HikariConfig();
            config.setJdbcUrl(properties.getUrl());
            config.setUsername(properties.getUsername());
            config.setPassword(properties.getPassword());
            return new HikariDataSource(config);
        }
    }
}
```

## Debugging Conditions

```java
// application.yml
debug: true

// Or
logging:
  level:
    org.springframework.boot.autoconfigure: DEBUG
```

This enables condition evaluation logging:

```
Positive matches:
-----------------
   DataSourceAutoConfiguration matched:
      - @ConditionalOnClass found required class 'javax.sql.DataSource' (OnClassCondition)
      - @ConditionalOnProperty (spring.datasource.url) matched (OnPropertyCondition)

Negative matches:
-----------------
   ActiveMQAutoConfiguration:
      Did not match:
         - @ConditionalOnClass did not find required class 'javax.jms.ConnectionFactory' (OnClassCondition)
```

## Best Practices

1. **Prefer Spring Boot's @ConditionalOn* over raw @Conditional**
2. **Use @ConditionalOnMissingBean for fallback defaults**
3. **Combine conditions rather than nesting configuration classes**
4. **Keep conditions simple and readable** - extract complex logic into custom Condition classes
5. **Use @ConditionalOnProperty with matchIfMissing for backward compatibility**
6. **Test condition evaluation** with @SpringBootTest and mock environments
7. **Document required conditions** for custom auto-configuration modules

## Common Mistakes

### Mistake 1: Conditions that Always Match

```java
// Wrong: Condition evaluates incorrectly
public class AlwaysTrueCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return true; // This condition is useless
    }
}

// The below condition depends on Spring Boot auto-configuration having already run
// which may not be the case during early context initialization
```

```java
// Correct: Proper condition implementation
public class OnCustomFeatureEnabled implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String value = context.getEnvironment().getProperty("app.custom.feature");
        return "enabled".equalsIgnoreCase(value)
            || Boolean.parseBoolean(value);
    }
}
```

### Mistake 2: Race Conditions in Bean Creation

```java
// Wrong: @ConditionalOnBean may fail due to bean creation order
@Configuration
public class ServiceConfig {

    @Bean
    @ConditionalOnBean(DataSource.class)
    public DatabaseService databaseService() {
        // May fail if DataSource hasn't been registered yet
        return new DatabaseService();
    }

    @Bean
    public DataSource dataSource() {
        return DataSourceBuilder.create().build();
    }
}
```

```java
// Correct: Use @ConditionalOnMissingBean for proper ordering
@Configuration
public class ServiceConfig {

    @Bean
    public DataSource dataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean
    @ConditionalOnBean(DataSource.class)
    public DatabaseService databaseService() {
        return new DatabaseService();
    }
}
```

### Mistake 3: Mismatching Condition Phases

```java
// Wrong: PARSE_CONFIGURATION phase condition accessing bean registry
public class WrongPhaseCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        // Bean definitions not available during PARSE_CONFIGURATION phase
        return context.getBeanFactory().containsBean("someBean");
    }
}
```

```java
// Correct: Use appropriate phase
public class CorrectPhaseCondition extends SpringBootCondition {
    @Override
    public ConditionOutcome getMatchOutcome(ConditionContext context,
                                            AnnotatedTypeMetadata metadata) {
        ConditionMessage message = ConditionMessage.forCondition("CorrectPhase");
        if (context.getBeanFactory() != null
            && context.getBeanFactory().containsBean("someBean")) {
            return ConditionOutcome.match(message.found("bean").items("someBean"));
        }
        return ConditionOutcome.noMatch(message.didNotFind("bean").items("someBean"));
    }
}
```

## Summary

Spring's conditional configuration enables intelligent, environment-aware bean registration. Spring Boot's @ConditionalOn* annotations handle most use cases - classpath checks, property conditions, bean presence, and resource availability. Custom conditions and composed annotations allow for domain-specific conditional logic, which is the foundation of auto-configuration.

## References

- [Spring @Conditional Documentation](https://docs.spring.io/spring-framework/reference/core/beans/condition.html)
- [Spring Boot Auto-Configuration](https://docs.spring.io/spring-boot/reference/auto-configuration.html)
- [Condition Annotations](https://docs.spring.io/spring-boot/reference/auto-configuration/custom.html)
- [Condition Evaluation](https://docs.spring.io/spring-boot/reference/auto-configuration/custom.html#auto-configuration-custom-condition)

Happy Coding