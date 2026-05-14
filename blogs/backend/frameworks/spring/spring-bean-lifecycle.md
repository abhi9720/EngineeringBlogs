---
title: "Spring Bean Lifecycle"
description: "Deep dive into the Spring bean lifecycle: instantiation, property setting, initialization, destruction, and customizing with BeanPostProcessors"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - bean-lifecycle
  - spring-core
  - ioc
coverImage: "/images/spring-bean-lifecycle.png"
draft: false
---
## Overview

The Spring bean lifecycle encompasses the entire journey of a bean from instantiation to destruction. Understanding this lifecycle is crucial for writing reliable initialization code, managing resources, and debugging bean-related issues. Spring provides multiple hooks to customize behavior at each stage.

## Bean Lifecycle Phases

### Complete Lifecycle Diagram

`mermaid
flowchart TB
    I[1. Instantiation] --> PP[2. Populate Properties]
    PP --> BA[3-11. Aware Interfaces]
    BA --> BP1[12. BeanPostProcessor<br/>postProcessBeforeInitialization]
    BP1 --> INIT[13. @PostConstruct<br/>InitializingBean<br/>@Bean initMethod]
    INIT --> BP2[14. BeanPostProcessor<br/>postProcessAfterInitialization]
    BP2 --> READY[15. Bean Ready for Use]
    READY --> DESTROY[16. @PreDestroy<br/>DisposableBean<br/>@Bean destroyMethod]

    linkStyle default stroke:#278ea5

    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff

    class I,PP,BA blue
    class BP1,BP2 green
    class INIT,READY yellow
    class DESTROY pink
`

### Phase 1: Instantiation

The constructor is called during instantiation. Spring uses reflection to create the bean instance. For classes with a single constructor, Spring automatically resolves and injects dependencies through that constructor. This is why constructor injection is preferred.

`java
@Component
public class DatabaseHealthChecker {
    private DataSource dataSource;
    private boolean healthy;

    // Constructor is called during instantiation
    public DatabaseHealthChecker() {
        System.out.println("Phase 1: Instantiation - " + this.getClass().getSimpleName());
    }

    @Autowired
    public void setDataSource(DataSource dataSource) {
        // Dependency injection via setter
        this.dataSource = dataSource;
    }
}
`

### Phase 2: Populate Properties

After instantiation, Spring populates all bean properties. This includes both @Autowired fields/setters and @Value injections. For @ConfigurationProperties beans, the entire property hierarchy is bound at this stage. Properties are set before any initialization callbacks run.

`java
@Component
@ConfigurationProperties(prefix = "app.database")
public class DatabaseProperties {
    private String url;
    private String username;
    private String password;
    private int maxPoolSize;
    private Duration connectionTimeout;

    // Properties are populated after instantiation
    public void validate() {
        System.out.println("Phase 2: Properties populated - " + url);
    }
}
`

### Phase 3: Aware Interfaces

Aware interfaces inject framework infrastructure into beans. The most commonly used are ApplicationContextAware (to access the full application context), BeanNameAware (to know the bean's name in the container), and EnvironmentAware (to access environment properties). These are called in a specific order.

`java
@Component
public class ApplicationAwareBean implements ApplicationContextAware,
                                             BeanNameAware,
                                             EnvironmentAware {

    private ApplicationContext applicationContext;
    private String beanName;
    private Environment environment;

    @Override
    public void setBeanName(String name) {
        this.beanName = name;
        System.out.println("Aware: Bean name set to " + name);
    }

    @Override
    public void setApplicationContext(ApplicationContext context) {
        this.applicationContext = context;
        System.out.println("Aware: ApplicationContext set");
    }

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
        System.out.println("Aware: Environment set");
    }

    public String getActiveProfile() {
        return Arrays.toString(environment.getActiveProfiles());
    }
}
`

### Phase 4: BeanPostProcessors

BeanPostProcessor is the most powerful extension point in the Spring container. It intercepts every bean after instantiation, before and after initialization. Use it for cross-cutting concerns: validation, proxying, wrapping, or modifying beans.

The postProcessBeforeInitialization call is ideal for validation or setting up infrastructure. postProcessAfterInitialization is where AOP proxies are typically created — Spring's AbstractAutoProxyCreator creates transaction, caching, and security proxies at this stage.

`java
@Component
public class ValidationBeanPostProcessor implements BeanPostProcessor {
    private static final Logger log = LoggerFactory.getLogger(ValidationBeanPostProcessor.class);

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (bean instanceof Validatable validatable) {
            log.info("BeforeInit: Validating bean {}", beanName);
            validatable.validate();
        }
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean instanceof InitializingBean) {
            log.info("AfterInit: Bean {} has completed initialization", beanName);
        }
        if (bean instanceof ProxyCandidate candidate) {
            return createProxy(bean);
        }
        return bean;
    }

    private Object createProxy(Object target) {
        return Proxy.newProxyInstance(
            target.getClass().getClassLoader(),
            target.getClass().getInterfaces(),
            (proxy, method, args) -> {
                long start = System.nanoTime();
                Object result = method.invoke(target, args);
                long elapsed = System.nanoTime() - start;
                System.out.println("Method " + method.getName() + " took " + elapsed/1_000_000 + "ms");
                return result;
            }
        );
    }
}
`

### Phase 5: Initialization

Three approaches to initialization exist, and they run in the following order: @PostConstruct (most common), InitializingBean.afterPropertiesSet(), and @Bean(initMethod). Using @PostConstruct is recommended because it doesn't couple your code to Spring-specific interfaces.

The initialization phase is where you perform setup that requires all properties to be set and all dependencies injected. Common use cases: opening connections, warming caches, validating configuration, registering shutdown hooks.

`java
@Component
public class CacheInitializer implements InitializingBean {
    private final CacheManager cacheManager;
    private final List<String> predefinedCaches;

    public CacheInitializer(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
        this.predefinedCaches = List.of("users", "products", "sessions");
    }

    // @PostConstruct approach
    @PostConstruct
    public void init() {
        System.out.println("@PostConstruct: CacheInitializer initialization starting");
        createPredefinedCaches();
    }

    // InitializingBean approach
    @Override
    public void afterPropertiesSet() {
        System.out.println("afterPropertiesSet: All properties have been set");
        validateConfiguration();
    }

    // Init method approach (used with @Bean(initMethod="initialize"))
    public void initialize() {
        System.out.println("initMethod: Starting cache warming");
        warmUpCaches();
    }

    private void createPredefinedCaches() {
        for (String cacheName : predefinedCaches) {
            cacheManager.getCache(cacheName);
        }
    }

    private void validateConfiguration() {
        if (cacheManager == null) {
            throw new IllegalStateException("CacheManager must not be null");
        }
    }

    private void warmUpCaches() {
        // Load frequently accessed data into cache
    }
}
`

### Phase 6: Destruction

Destruction callbacks are invoked during graceful shutdown. The same ordering as initialization applies in reverse: @PreDestroy, DisposableBean.destroy(), @Bean(destroyMethod). Use this phase to close connections, release thread pools, flush buffers, and clean up resources.

Prototype-scoped beans do NOT trigger destroy callbacks. The Spring container creates them and hands them over — it doesn't track them afterward. For prototype beans with cleanup needs, use a custom destruction pattern or explicitly manage their lifecycle.

`java
@Component
public class ConnectionPoolManager implements DisposableBean {
    private final List<Connection> connections = new CopyOnWriteArrayList<>();

    @PreDestroy
    public void shutdown() {
        System.out.println("@PreDestroy: Shutting down connection pool");
        closeAllConnections();
    }

    @Override
    public void destroy() {
        System.out.println("DisposableBean.destroy(): Final cleanup");
        releaseResources();
    }

    public void shutdownMethod() {
        System.out.println("destroyMethod: Custom cleanup");
        drainActiveConnections();
    }

    private void closeAllConnections() {
        for (Connection conn : connections) {
            try {
                conn.close();
            } catch (Exception e) {
                System.err.println("Error closing connection: " + e.getMessage());
            }
        }
        connections.clear();
    }

    private void releaseResources() {
        // Release thread pool, file handles, etc.
    }

    private void drainActiveConnections() {
        // Wait for active queries to complete
    }
}
`

## Custom BeanPostProcessor Examples

### Timing PostProcessor

A BeanPostProcessor that measures initialization time for every bean. This is useful for identifying slow-starting beans that delay application startup. Beans taking more than 1 second to initialize are flagged for optimization.

`java
@Component
public class TimingBeanPostProcessor implements BeanPostProcessor {
    private final Map<String, Long> startTimes = new ConcurrentHashMap<>();

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        startTimes.put(beanName, System.nanoTime());
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        Long startTime = startTimes.remove(beanName);
        if (startTime != null) {
            long duration = System.nanoTime() - startTime;
            long durationMs = TimeUnit.NANOSECONDS.toMillis(duration);
            if (durationMs > 1000) {
                System.err.println("Slow initialization: " + beanName + " took " + durationMs + "ms");
            }
        }
        return bean;
    }
}
`

### Proxy-Based PostProcessor

A BeanPostProcessor that creates AOP proxies for beans with @Transactional annotations. This is essentially how Spring's own TransactionInterceptor works: it checks for @Transactional on the class or methods and wraps the bean in a JDK dynamic proxy or CGLIB proxy.

The proxy intercepts all method calls, begins a transaction for annotated methods, commits on success, and rolls back on exception. Beans without @Transactional pass through unmodified.

`java
@Component
public class TransactionalProxyPostProcessor implements BeanPostProcessor {
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean.getClass().isAnnotationPresent(Transactional.class) ||
            hasTransactionalMethods(bean.getClass())) {
            return createTransactionalProxy(bean);
        }
        return bean;
    }

    private boolean hasTransactionalMethods(Class<?> clazz) {
        return Arrays.stream(clazz.getMethods())
            .anyMatch(m -> m.isAnnotationPresent(Transactional.class));
    }

    private Object createTransactionalProxy(Object target) {
        return Proxy.newProxyInstance(
            target.getClass().getClassLoader(),
            target.getClass().getInterfaces(),
            (proxy, method, args) -> {
                if (method.isAnnotationPresent(Transactional.class)) {
                    // Begin transaction
                    try {
                        Object result = method.invoke(target, args);
                        // Commit transaction
                        return result;
                    } catch (Exception e) {
                        // Rollback transaction
                        throw e;
                    }
                }
                return method.invoke(target, args);
            }
        );
    }
}
`

## Ordering BeanPostProcessors

When multiple BeanPostProcessor instances exist, control the execution order using @Order or the Ordered interface. Processors with higher precedence (lower order value) run first in postProcessBeforeInitialization and postProcessAfterInitialization.

The SecurityPostProcessor with the highest precedence ensures security proxies are applied first. The LoggingPostProcessor with the lowest precedence runs last, wrapping the already-proxied bean in a logging layer.

`java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SecurityPostProcessor implements BeanPostProcessor, Ordered {
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean instanceof Secured secured) {
            // Apply security checks first (highest priority)
            return createSecurityProxy(secured);
        }
        return bean;
    }

    @Override
    public int getOrder() {
        return 0;
    }
}

@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class LoggingPostProcessor implements BeanPostProcessor, Ordered {
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean instanceof Secured) {
            // Apply logging last (lowest priority)
            return createLoggingProxy(bean);
        }
        return bean;
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }
}
`

## Bean Definition Merging

Parent-child bean definitions allow sharing common configuration. The ParentConfig defines a DataSource with common settings. The ChildConfig imports the parent and defines its own DataSource, inheriting any settings not explicitly overridden.

This pattern is rarely used in modern Spring Boot (which favors auto-configuration), but it's useful when constructing bean definitions programmatically.

`java
@Configuration
public class ParentConfig {
    @Bean
    public DataSource parentDataSource() {
        return DataSourceBuilder.create()
            .url("")
            .username("")
            .password("")
            .build();
    }
}

@Configuration
@Import(ParentConfig.class)
public class ChildConfig {
    @Bean
    public DataSource childDataSource() {
        return DataSourceBuilder.create()
            .url("")
            .build();
    }
}
`

## Best Practices

1. **Use @PostConstruct for lightweight initialization** - heavy work should be done lazily
2. **Implement InitializingBean sparingly** - prefer @PostConstruct for Spring-specific code
3. **Always pair resource acquisition with destruction** in a DisposableBean or @PreDestroy
4. **Keep BeanPostProcessors stateless** - they process all beans
5. **Use Ordered interface** when multiple BeanPostProcessors exist
6. **Avoid heavy computation in postProcessBeforeInitialization** - it delays all bean creation
7. **Log lifecycle events at DEBUG level** to avoid noise in production logs

## Common Mistakes

### Mistake 1: Accessing Uninitialized Dependencies

`java
// Wrong: Accessing dependency before it's fully initialized
@Component
public class EmailService {
    private final MailServer mailServer;
    private final TemplateEngine templateEngine;

    public EmailService(MailServer mailServer, TemplateEngine templateEngine) {
        this.mailServer = mailServer;
        this.templateEngine = templateEngine;
        sendStartupNotification(); // MailServer might not be ready yet
    }

    private void sendStartupNotification() {
        mailServer.send("admin@example.com", "Service started");
    }
}
`

`java
// Correct: Use @PostConstruct for post-initialization logic
@Component
public class EmailService {
    private final MailServer mailServer;
    private final TemplateEngine templateEngine;

    public EmailService(MailServer mailServer, TemplateEngine templateEngine) {
        this.mailServer = mailServer;
        this.templateEngine = templateEngine;
    }

    @PostConstruct
    public void init() {
        sendStartupNotification();
    }

    private void sendStartupNotification() {
        mailServer.send("admin@example.com", "Service started");
    }
}
`

### Mistake 2: Exception in PostProcessor

`java
// Wrong: Throwing exception from postProcessBeforeInitialization blocks all beans
@Component
public class StrictValidationPostProcessor implements BeanPostProcessor {
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (bean.getClass().getName().contains("")) {
            throw new RuntimeException("Cannot process proxy beans");
        }
        return bean;
    }
}
`

`java
// Correct: Handle gracefully and skip beans that can't be processed
@Component
public class RobustValidationPostProcessor implements BeanPostProcessor {
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (AopUtils.isAopProxy(bean)) {
            return bean; // Skip proxy beans
        }
        try {
            validateBean(bean);
        } catch (Exception e) {
            System.err.println("Validation failed for " + beanName + ": " + e.getMessage());
        }
        return bean;
    }

    private void validateBean(Object bean) {
        // Validation logic
    }
}
`

### Mistake 3: Forgetting Destroy Callbacks for Prototype Beans

`java
// Wrong: Prototype beans skip destroy lifecycle callbacks
@Component
@Scope("prototype")
public class ExpensiveResource implements DisposableBean {
    private Connection connection;

    public ExpensiveResource() {
        this.connection = createConnection();
    }

    @Override
    public void destroy() {
        connection.close(); // This will NEVER be called for prototypes
    }
}
`

`java
// Correct: Use custom destruction for prototype beans
@Component
@Scope("prototype")
public class ExpensiveResource {
    private Connection connection;

    public ExpensiveResource() {
        this.connection = createConnection();
    }

    public void cleanup() {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }
}

// Usage in singleton bean
@Component
public class ResourceManager {
    private final ObjectProvider<ExpensiveResource> resourceProvider;

    public ResourceManager(ObjectProvider<ExpensiveResource> resourceProvider) {
        this.resourceProvider = resourceProvider;
    }

    public void useResource() {
        ExpensiveResource resource = resourceProvider.getObject();
        try {
            // Use the resource
        } finally {
            resource.cleanup();
        }
    }
}
`

## Summary

Understanding the Spring bean lifecycle is essential for writing reliable enterprise applications. The lifecycle provides hooks at every stage, from instantiation through destruction. Use @PostConstruct and @PreDestroy for most lifecycle needs, BeanPostProcessors for cross-cutting concerns, and always pair resource acquisition with proper cleanup.

## References

- [Spring Bean Lifecycle Documentation](https://docs.spring.io/spring-framework/reference/core/beans/factory-lifecycle.html)
- [BeanPostProcessor Javadoc](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/config/BeanPostProcessor.html)
- [InitializingBean Javadoc](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/InitializingBean.html)
- [DisposableBean Javadoc](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/DisposableBean.html)

Happy Coding
