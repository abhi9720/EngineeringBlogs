---
title: Spring IoC and Dependency Injection Deep Dive
description: >-
  Master the Spring IoC container and dependency injection patterns: constructor
  injection, setter injection, field injection, and advanced DI techniques
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - ioc
  - dependency-injection
  - spring-core
coverImage: /images/spring-ioc-di-deep-dive.png
draft: false
order: 100
---
## Overview

The Inversion of Control (IoC) principle is the foundation of the Spring Framework. Instead of objects creating their own dependencies, control is inverted: the container manages object creation and wiring. This deep dive explores the Spring IoC container, dependency injection patterns, and advanced configuration techniques.

IoC means your classes don't control their dependencies — the container does. This decouples object creation from object usage, making your code more testable, flexible, and maintainable. Instead of calling `new PaymentService()`, you declare `PaymentService` as a constructor parameter and let Spring provide it.

## The IoC Container

Spring's `ApplicationContext` is the central interface for providing configuration to the application. It manages bean lifecycle, dependency resolution, and configuration.

### Types of ApplicationContext

The `AnnotationConfigApplicationContext` is the standard choice for Spring Boot applications. It processes `@Configuration` classes and `@Component`-annotated beans. The XML-based context is legacy but may appear in older projects. The Groovy-based context is rarely used.

```java
// Annotation-based context (most common in Spring Boot)
ApplicationContext context = new AnnotationConfigApplicationContext(AppConfig.class);

// XML-based context (legacy)
ApplicationContext context = new ClassPathXmlApplicationContext("applicationContext.xml");

// Groovy-based context
ApplicationContext context = new GenericGroovyApplicationContext("config.groovy");
```

### BeanFactory vs ApplicationContext

The `BeanFactory` is the lowest-level container with lazy initialization — beans are created only when requested. The `ApplicationContext` extends `BeanFactory` with eager initialization, AOP support, event publishing, internationalization, and resource loading. Spring Boot always uses `ApplicationContext`.

```java
// BeanFactory is the lowest-level container - lazy initialization
BeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));
MyService service = factory.getBean(MyService.class);

// ApplicationContext extends BeanFactory - eager init, AOP, events, i18n
ApplicationContext context = new AnnotationConfigApplicationContext(Config.class);
MyService service = context.getBean(MyService.class);
```

## Dependency Injection Patterns

### Constructor Injection (Recommended)

Constructor injection is the recommended approach. It ensures the bean is fully initialized when constructed, makes dependencies explicit, enables immutability with `final` fields, and simplifies testing — just pass mocks to the constructor.

```java
@Component
public class OrderService {
    private final PaymentService paymentService;
    private final InventoryService inventoryService;
    private final NotificationService notificationService;

    public OrderService(PaymentService paymentService,
                       InventoryService inventoryService,
                       NotificationService notificationService) {
        this.paymentService = paymentService;
        this.inventoryService = inventoryService;
        this.notificationService = notificationService;
    }

    public Order createOrder(OrderRequest request) {
        paymentService.processPayment(request.getPayment());
        inventoryService.reserveItems(request.getItems());
        notificationService.sendConfirmation(request.getUserEmail());
        return new Order(request);
    }
}
```

### Setter Injection

Setter injection is useful for optional dependencies or circular dependencies. Spring calls the setter after the bean is constructed. The `@Autowired` annotation on the setter triggers injection. Unlike constructor injection, the fields cannot be final.

```java
@Component
public class EmailService {
    private MailServer mailServer;
    private TemplateEngine templateEngine;

    @Autowired
    public void setMailServer(MailServer mailServer) {
        this.mailServer = mailServer;
    }

    @Autowired
    public void setTemplateEngine(TemplateEngine templateEngine) {
        this.templateEngine = templateEngine;
    }

    public void sendEmail(String to, String template, Map<String, Object> params) {
        String content = templateEngine.render(template, params);
        mailServer.send(to, content);
    }
}
```

### Field Injection (Not Recommended)

Field injection uses `@Autowired` directly on fields. While concise, it makes testing difficult — you can't construct the object without reflection or a Spring context, and the bean isn't fully initialized after construction. Avoid field injection in production code.

```java
@Component
public class UserService {
    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    public User registerUser(RegistrationRequest request) {
        String encodedPassword = passwordEncoder.encode(request.getPassword());
        return userRepository.save(new User(request.getEmail(), encodedPassword));
    }
}
```

## Java-Based Configuration

### @Configuration and @Bean

`@Configuration` classes are the standard way to define beans in modern Spring. Each `@Bean` method creates a bean of the return type. Spring calls these methods, injecting dependencies via method parameters. The `DataSourceConfig` below creates three beans that depend on each other: `DataSource`, `PlatformTransactionManager`, and `JdbcTemplate`.

The `PlatformTransactionManager` method takes a `DataSource` parameter — Spring automatically injects the `dataSource()` bean. This is method-level injection, which is explicit and refactoring-friendly.

```java
@Configuration
@EnableTransactionManagement
public class DataSourceConfig {

    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        config.setUsername("app_user");
        config.setPassword("secret");
        config.setMaximumPoolSize(20);
        config.setMinimumIdle(5);
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        return new HikariDataSource(config);
    }

    @Bean
    public PlatformTransactionManager transactionManager(DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }
}
```

### @Bean with Factory Methods

Factory methods in `@Configuration` classes can use conditional logic. The example below returns a different `CacheManager` implementation based on the `cache.type` property. This pattern lets users choose the implementation without changing code.

```java
@Configuration
public class CacheConfig {

    @Bean
    @ConditionalOnProperty(name = "cache.type", havingValue = "redis")
    public CacheManager redisCacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(30))
            .disableCachingNullValues();
        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(config)
            .build();
    }

    @Bean
    @ConditionalOnProperty(name = "cache.type", havingValue = "caffeine", matchIfMissing = true)
    public CacheManager caffeineCacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        manager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(Duration.ofMinutes(10)));
        return manager;
    }
}
```

## Qualifier and Primary

### Resolving Ambiguous Dependencies

When multiple beans implement the same interface, Spring throws a `NoUniqueBeanDefinitionException`. Use `@Qualifier` to specify which bean to inject. The qualifier value matches the bean name or a custom `@Qualifier` annotation value.

```java
@Component
@Qualifier("creditCard")
public class CreditCardPaymentService implements PaymentService {
    @Override
    public PaymentResult process(PaymentRequest request) {
        return new PaymentResult(true, "CC-" + UUID.randomUUID());
    }
}

@Component
@Qualifier("paypal")
public class PayPalPaymentService implements PaymentService {
    @Override
    public PaymentResult process(PaymentRequest request) {
        return new PaymentResult(true, "PP-" + UUID.randomUUID());
    }
}
```

### Using @Primary

`@Primary` marks a bean as the default when multiple candidates exist. It's useful for providing a fallback implementation that applies when no specific qualifier is used.

```java
@Component
@Primary
public class DefaultPaymentService implements PaymentService {
    @Override
    public PaymentResult process(PaymentRequest request) {
        return new PaymentResult(true, "DEFAULT-" + UUID.randomUUID());
    }
}
```

### Injecting with Qualifier

```java
@Service
public class CheckoutService {
    private final PaymentService primaryPaymentService;
    private final PaymentService creditCardService;
    private final PaymentService paypalService;

    public CheckoutService(
            PaymentService primaryPaymentService,
            @Qualifier("creditCardPaymentService") PaymentService creditCardService,
            @Qualifier("payPalPaymentService") PaymentService paypalService) {
        this.primaryPaymentService = primaryPaymentService;
        this.creditCardService = creditCardService;
        this.paypalService = paypalService;
    }

    public PaymentResult checkout(Order order, String method) {
        return switch (method) {
            case "credit_card" -> creditCardService.process(order.toPaymentRequest());
            case "paypal" -> paypalService.process(order.toPaymentRequest());
            default -> primaryPaymentService.process(order.toPaymentRequest());
        };
    }
}
```

## Injecting Collections

Spring can inject all beans of a given type as a `List` or `Map`. The `List<PaymentService>` contains all implementations ordered by `@Order` or `@Priority`. The `Map<String, PaymentService>` maps bean names to their instances.

```java
@Component
public class PaymentRouter {
    private final List<PaymentService> allPaymentServices;
    private final Map<String, PaymentService> paymentServiceMap;

    public PaymentRouter(List<PaymentService> allPaymentServices,
                        Map<String, PaymentService> paymentServiceMap) {
        this.allPaymentServices = allPaymentServices;
        this.paymentServiceMap = paymentServiceMap;
    }

    public PaymentResult process(String provider, PaymentRequest request) {
        PaymentService service = paymentServiceMap.get(provider);
        if (service == null) {
            throw new IllegalArgumentException("Unknown provider: " + provider);
        }
        return service.process(request);
    }
}
```

## Lazy Initialization

`@Lazy` delays bean creation until it's first requested. Use it for expensive resources that may not be needed in every request path. The `ExpensiveResource` below is created only when `ResourceService` first calls a method that uses it.

```java
@Component
@Lazy
public class ExpensiveResource {
    public ExpensiveResource() {
        initializeConnectionPool();
        loadConfiguration();
    }
}

@Component
public class ResourceService {
    private final ExpensiveResource resource;

    public ResourceService(@Lazy ExpensiveResource resource) {
        this.resource = resource;
    }
}
```

## Scopes

### Prototype Scope with Lookup Method

Singleton beans holding prototype-scoped dependencies must use `@Lookup` or `ObjectProvider` to get a new instance on each call. The `@Lookup` annotation tells Spring to override the method with a new instance lookup at runtime.

```java
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
public class ShoppingCart {
    private List<Item> items = new ArrayList<>();
    private BigDecimal total = BigDecimal.ZERO;

    public void addItem(Item item) {
        items.add(item);
        total = total.add(item.getPrice());
    }
}

@Component
public class CheckoutService {
    @Lookup
    public ShoppingCart createCart() {
        return null;
    }

    public CheckoutResult startCheckout() {
        ShoppingCart cart = createCart();
        return new CheckoutResult(cart);
    }
}
```

### Custom Scope

Custom scopes extend the container's scope mechanism. The `ThreadScope` below creates one bean instance per thread using a `ThreadLocal`. Implement the `Scope` interface and register it to make the scope available via `@Scope("thread")`.

```java
public class ThreadScope implements Scope {
    private final ThreadLocal<Map<String, Object>> threadScope = ThreadLocal.withInitial(HashMap::new);

    @Override
    public Object get(String name, ObjectFactory<?> objectFactory) {
        Map<String, Object> scope = threadScope.get();
        return scope.computeIfAbsent(name, k -> objectFactory.getObject());
    }

    @Override
    public String getConversationId() {
        return String.valueOf(Thread.currentThread().getId());
    }

    @Override
    public void registerDestructionCallback(String name, Runnable callback) {
    }

    @Override
    public Object resolveContextualObject(String key) {
        return null;
    }

    @Override
    public String remove(String name) {
        Map<String, Object> scope = threadScope.get();
        return scope.remove(name);
    }
}
```

## Bean Post-Processing

```java
@Component
public class AuditingBeanPostProcessor implements BeanPostProcessor {
    private final Map<String, Instant> creationTimestamps = new ConcurrentHashMap<>();

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        creationTimestamps.put(beanName, Instant.now());
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean instanceof Auditable auditable) {
            auditable.setCreatedAt(creationTimestamps.get(beanName));
        }
        return bean;
    }
}
```

## Best Practices

1. **Prefer constructor injection** over field injection for immutability and testability
2. **Use @Qualifier with custom annotations** to reduce ambiguity
3. **Avoid circular dependencies** - refactor into three or more beans
4. **Use @Configuration with @Bean** for third-party library integration
5. **Prefer interface injection** over concrete class injection for flexibility
6. **Use @Primary sparingly** - explicit qualification is clearer
7. **Keep configuration classes focused** on a single concern

## Common Mistakes

### Mistake 1: Field Injection (Hard to Test)

```java
// Wrong: Field injection makes testing difficult
@Component
public class OrderProcessor {
    @Autowired
    private PaymentService paymentService;
    @Autowired
    private InventoryService inventoryService;
    public void process(Order order) { }
}

// Correct: Constructor injection enables easy mocking
@Component
public class OrderProcessor {
    private final PaymentService paymentService;
    private final InventoryService inventoryService;
    public OrderProcessor(PaymentService paymentService, InventoryService inventoryService) {
        this.paymentService = paymentService;
        this.inventoryService = inventoryService;
    }
    public void process(Order order) {
        paymentService.charge(order.getTotal());
        inventoryService.deduct(order.getItems());
    }
}
```

### Mistake 2: Circular Dependencies

```java
// Wrong: Circular dependency
@Component
public class OrderService {
    private final InvoiceService invoiceService;
    public OrderService(InvoiceService invoiceService) { this.invoiceService = invoiceService; }
}
@Component
public class InvoiceService {
    private final OrderService orderService;
    public InvoiceService(OrderService orderService) { this.orderService = orderService; }
}

// Correct: Introduce a third service to break the cycle
@Component
public class BillingService { }
@Component
public class OrderService {
    private final BillingService billingService;
    public OrderService(BillingService billingService) { this.billingService = billingService; }
}
@Component
public class InvoiceService {
    private final BillingService billingService;
    public InvoiceService(BillingService billingService) { this.billingService = billingService; }
}
```

### Mistake 3: Forgetting Scope for Stateful Beans

```java
// Wrong: Singleton for stateful beans causes thread-safety issues
@Component
public class RequestContext {
    private String currentUserId;
    public void setCurrentUserId(String userId) { this.currentUserId = userId; }
    public String getCurrentUserId() { return currentUserId; }
}

// Correct: Use proper scope for stateful beans
@Component
@Scope(value = "request", proxyMode = ScopedProxyMode.TARGET_PROXY)
public class RequestContext {
    private String currentUserId;
    public void setCurrentUserId(String userId) { this.currentUserId = userId; }
    public String getCurrentUserId() { return currentUserId; }
}
```

## Summary

Spring's IoC container provides flexible dependency management through constructor injection, setter injection, and configuration classes. Understanding bean scopes, qualifiers, and the @Primary annotation is essential for building maintainable applications. Follow the principle of coding to interfaces and prefer constructor injection for immutability and testability.

## References

- [Spring IoC Container Documentation](https://docs.spring.io/spring-framework/reference/core/beans.html)
- [Spring Dependency Injection](https://docs.spring.io/spring-framework/reference/core/beans/dependencies.html)
- [Bean Scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html)
- [Spring @Configuration](https://docs.spring.io/spring-framework/reference/core/beans/java.html)

Happy Coding
