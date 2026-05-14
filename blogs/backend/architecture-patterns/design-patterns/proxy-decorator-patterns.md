---
title: "Proxy and Decorator Patterns"
description: "Understanding Proxy and Decorator patterns: AOP proxies, Spring aspects, and transparent behavior wrapping"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["proxy-pattern", "decorator-pattern", "aop", "spring-aspects"]
coverImage: "/images/proxy-decorator-patterns.png"
draft: false
---

## Overview

The Proxy and Decorator patterns are structural patterns that wrap objects to add behavior. While they share similar structures, they serve different purposes: Proxy controls access to an object, while Decorator adds responsibilities dynamically.

Spring extensively uses both patterns through AOP proxies, `@Transactional`, `@Cacheable`, and security annotations. Understanding these patterns is essential for working effectively with Spring's proxy-based infrastructure.

## Proxy Pattern

Proxy provides a surrogate or placeholder for another object to control access to it.

```java
// Subject interface
public interface PaymentService {
    PaymentResult process(Payment payment);
    PaymentResult refund(String transactionId);
}

// Real subject
@Component
public class RealPaymentService implements PaymentService {
    @Override
    public PaymentResult process(Payment payment) {
        // Actual payment processing logic
        return PaymentResult.success(UUID.randomUUID().toString());
    }

    @Override
    public PaymentResult refund(String transactionId) {
        // Actual refund logic
        return PaymentResult.success(transactionId);
    }
}

// Protection proxy
@Component
public class PaymentServiceProxy implements PaymentService {

    private final RealPaymentService realService;
    private final RateLimiter rateLimiter;
    private final AuditLogger auditLogger;

    public PaymentServiceProxy(
            RealPaymentService realService,
            RateLimiter rateLimiter,
            AuditLogger auditLogger) {
        this.realService = realService;
        this.rateLimiter = rateLimiter;
        this.auditLogger = auditLogger;
    }

    @Override
    public PaymentResult process(Payment payment) {
        if (!rateLimiter.tryAcquire(payment.customerId())) {
            auditLogger.log("RATE_LIMIT_EXCEEDED", payment.customerId());
            throw new RateLimitExceededException("Too many requests");
        }

        auditLogger.log("PAYMENT_INITIATED", payment);
        long start = System.currentTimeMillis();

        try {
            PaymentResult result = realService.process(payment);
            auditLogger.log("PAYMENT_COMPLETED", result);
            return result;
        } catch (Exception e) {
            auditLogger.log("PAYMENT_FAILED", e.getMessage());
            throw e;
        } finally {
            long duration = System.currentTimeMillis() - start;
            metricsRecorder.record("payment.duration", duration);
        }
    }

    @Override
    public PaymentResult refund(String transactionId) {
        auditLogger.log("REFUND_INITIATED", transactionId);
        try {
            PaymentResult result = realService.refund(transactionId);
            auditLogger.log("REFUND_COMPLETED", result);
            return result;
        } catch (Exception e) {
            auditLogger.log("REFUND_FAILED", e.getMessage());
            throw e;
        }
    }
}
```

The `PaymentServiceProxy` controls access to `RealPaymentService` by adding rate limiting, audit logging, and metrics collection — all without modifying the real service. The proxy implements the same interface as the real subject, so callers cannot tell whether they are talking to the proxy or the real object. This is the essence of the proxy pattern: transparent access control.

### Virtual Proxy

Defers object creation until needed:

```java
@Component
@Scope("prototype")
public class HeavyReportGenerator {
    private final ReportDataRepository repository;

    public HeavyReportGenerator(ReportDataRepository repository) {
        this.repository = repository;
    }

    public Report generate(String reportId) {
        log.info("Generating heavy report: {}", reportId);
        List<ReportData> data = repository.fetchReportData(reportId);
        return new Report(reportId, data, processData(data));
    }

    private Map<String, Object> processData(List<ReportData> data) {
        // CPU-intensive processing
        return Map.of("total", data.size(), "processed", true);
    }
}

@Component
public class LazyReportProxy {
    private final ApplicationContext context;
    private HeavyReportGenerator realGenerator;

    public LazyReportProxy(ApplicationContext context) {
        this.context = context;
    }

    public Report generate(String reportId) {
        if (realGenerator == null) {
            realGenerator = context.getBean(HeavyReportGenerator.class);
        }
        return realGenerator.generate(reportId);
    }
}
```

The virtual proxy delays the creation of `HeavyReportGenerator` until `generate()` is first called. The `HeavyReportGenerator` is prototype-scoped, so the proxy creates it lazily and reuses the instance for subsequent calls. This is useful when the real object is expensive to construct (requires heavy initialization, loads large configuration, or connects to external services).

## Decorator Pattern

Decorator attaches additional responsibilities to an object dynamically:

```java
// Component interface
public interface DataExporter {
    byte[] export(Data data);
}

// Concrete component
@Component
public class CsvDataExporter implements DataExporter {
    @Override
    public byte[] export(Data data) {
        StringBuilder sb = new StringBuilder();
        if (!data.getColumns().isEmpty()) {
            sb.append(String.join(",", data.getColumns()));
            sb.append("\n");
        }
        for (DataRow row : data.getRows()) {
            sb.append(String.join(",", row.getValues()));
            sb.append("\n");
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }
}

// Base decorator
public abstract class DataExporterDecorator implements DataExporter {
    protected final DataExporter wrapped;

    protected DataExporterDecorator(DataExporter wrapped) {
        this.wrapped = wrapped;
    }

    @Override
    public byte[] export(Data data) {
        return wrapped.export(data);
    }
}

// Compression decorator
@Component
public class CompressedDataExporter extends DataExporterDecorator {

    public CompressedDataExporter(DataExporter wrapped) {
        super(wrapped);
    }

    @Override
    public byte[] export(Data data) {
        byte[] exported = super.export(data);
        return compress(exported);
    }

    private byte[] compress(byte[] data) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             GzipOutputStream gzip = new GzipOutputStream(baos)) {
            gzip.write(data);
            gzip.finish();
            return baos.toByteArray();
        } catch (IOException e) {
            throw new ExportException("Compression failed", e);
        }
    }
}

// Encryption decorator
@Component
public class EncryptedDataExporter extends DataExporterDecorator {

    private final SecretKey key;

    public EncryptedDataExporter(DataExporter wrapped, @Value("${export.secret}") String secret) {
        super(wrapped);
        this.key = generateKey(secret);
    }

    @Override
    public byte[] export(Data data) {
        byte[] exported = super.export(data);
        return encrypt(exported);
    }

    private byte[] encrypt(byte[] data) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(data);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            baos.write(iv);
            baos.write(encrypted);
            return baos.toByteArray();
        } catch (Exception e) {
            throw new ExportException("Encryption failed", e);
        }
    }

    private SecretKey generateKey(String secret) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = digest.digest(secret.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(keyBytes, "AES");
        } catch (NoSuchAlgorithmException e) {
            throw new ExportException("Key generation failed", e);
        }
    }
}

// Base64 encoding decorator
@Component
public class Base64DataExporter extends DataExporterDecorator {

    public Base64DataExporter(DataExporter wrapped) {
        super(wrapped);
    }

    @Override
    public byte[] export(Data data) {
        byte[] exported = super.export(data);
        return Base64.getEncoder().encode(exported);
    }
}
```

Decorators compose dynamically. You could create a pipeline like `new Base64DataExporter(new EncryptedDataExporter(new CompressedDataExporter(new CsvDataExporter())))`. Each decorator wraps the previous one and adds its behavior before or after delegating to the wrapped object. The `DataExporterDecorator` abstract class makes it easy to create new decorators by providing a default pass-through implementation.

## Spring AOP Proxies

Spring uses JDK dynamic proxies or CGLIB proxies to implement cross-cutting concerns:

```java
@Aspect
@Component
public class LoggingAspect {

    private final Logger log = LoggerFactory.getLogger(LoggingAspect.class);

    @Around("@annotation(LogExecutionTime)")
    public Object logExecutionTime(ProceedingJoinPoint joinPoint) throws Throwable {
        long start = System.currentTimeMillis();
        String methodName = joinPoint.getSignature().toShortString();

        try {
            Object result = joinPoint.proceed();
            long duration = System.currentTimeMillis() - start;
            log.info("{} completed in {}ms", methodName, duration);
            return result;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - start;
            log.error("{} failed after {}ms: {}", methodName, duration, e.getMessage());
            throw e;
        }
    }

    @Around("@annotation(retry)")
    public Object retryOnFailure(ProceedingJoinPoint joinPoint, Retryable retry)
            throws Throwable {
        int maxAttempts = retry.maxAttempts();
        Exception lastException = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return joinPoint.proceed();
            } catch (Exception e) {
                lastException = e;
                if (attempt < maxAttempts) {
                    long backoff = (long) (retry.backoff() * Math.pow(2, attempt - 1));
                    log.warn("Attempt {} failed, retrying in {}ms: {}",
                        attempt, backoff, e.getMessage());
                    Thread.sleep(backoff);
                }
            }
        }
        throw lastException;
    }

    @Around("@annotation(circuitBreaker)")
    public Object circuitBreaker(ProceedingJoinPoint joinPoint, CircuitBreaker circuitBreaker)
            throws Throwable {
        String key = circuitBreaker.name();
        CircuitBreakerState state = circuitBreakerRegistry.getState(key);

        if (state == CircuitBreakerState.OPEN) {
            throw new CircuitBreakerOpenException(key + " circuit breaker is OPEN");
        }

        try {
            Object result = joinPoint.proceed();
            circuitBreakerRegistry.recordSuccess(key);
            return result;
        } catch (Exception e) {
            circuitBreakerRegistry.recordFailure(key);
            throw e;
        }
    }
}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface LogExecutionTime {}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Retryable {
    int maxAttempts() default 3;
    long backoff() default 1000;
}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface CircuitBreaker {
    String name();
}
```

Spring AOP creates proxies around beans at runtime. When you annotate a method with `@LogExecutionTime`, Spring creates a proxy that intercepts calls to that method, executes the aspect logic (timing, logging), and then proceeds to the real method. The `@Around` advice wraps the method execution, enabling cross-cutting concerns like retry with exponential backoff and circuit breaker patterns without modifying business code.

## Dynamic Proxy in Java

```java
public class DynamicProxyExample {

    @SuppressWarnings("unchecked")
    public static <T> T createMetricsProxy(T target, Class<T> interfaceType) {
        return (T) Proxy.newProxyInstance(
            interfaceType.getClassLoader(),
            new Class<?>[]{interfaceType},
            new MetricsInvocationHandler(target));
    }

    private static class MetricsInvocationHandler implements InvocationHandler {
        private final Object target;
        private final Map<String, List<Long>> durations = new ConcurrentHashMap<>();

        public MetricsInvocationHandler(Object target) {
            this.target = target;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            long start = System.nanoTime();
            try {
                return method.invoke(target, args);
            } finally {
                long duration = System.nanoTime() - start;
                durations.computeIfAbsent(method.getName(), k -> new ArrayList<>()).add(duration);
                log.info("Method {} took {} ns", method.getName(), duration);
            }
        }

        public Map<String, Double> getAverageDurations() {
            return durations.entrySet().stream()
                .collect(Collectors.toMap(
                    Map.Entry::getKey,
                    e -> e.getValue().stream()
                        .mapToLong(Long::longValue)
                        .average()
                        .orElse(0.0)
                ));
        }
    }
}
```

Java's `Proxy.newProxyInstance` creates a dynamic proxy at runtime for any interface. The `MetricsInvocationHandler` intercepts every method call, records timing, and logs the duration. Unlike Spring AOP which requires a list of pointcuts and advice, dynamic proxies let you intercept all methods with a single handler — useful for generic concerns like metrics, logging, or access control.

## Common Mistakes

### Self-Invocation Bypasses Proxy

```java
// Wrong: Self-invocation bypasses AOP proxy
@Service
public class UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }

    public void createUserWithProfile(User user, Profile profile) {
        this.createUser(user); // @Transactional is NOT applied!
        profileService.createProfile(profile);
    }
}
```

```java
// Correct: Inject self-reference or use separate service
@Service
public class UserService {
    @Autowired
    private UserService self; // Self-reference for proxy invocation

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }

    public void createUserWithProfile(User user, Profile profile) {
        self.createUser(user); // Goes through proxy, @Transactional applied
        profileService.createProfile(profile);
    }
}
```

Self-invocation (`this.createUser()`) bypasses the AOP proxy because `this` is the raw object, not the proxy. The `@Transactional` annotation is never processed. The fix is to inject a self-reference (`@Autowired private UserService self`) which goes through the proxy. Alternatively, extract the transactional method into a separate service.

### Decorator State Mutation

```java
// Wrong: Decorator modifies shared state
@Component
public class LoggingDecorator implements SomeInterface {
    private int invocationCount = 0;

    @Override
    public void execute() {
        invocationCount++; // Not thread-safe!
        log.info("Invocation count: {}", invocationCount);
        wrapped.execute();
    }
}
```

```java
// Correct: Use thread-safe or local state
@Component
public class LoggingDecorator implements SomeInterface {
    private final AtomicLong invocationCount = new AtomicLong(0);

    @Override
    public void execute() {
        long count = invocationCount.incrementAndGet();
        log.info("Invocation count: {}", count);
        wrapped.execute();
    }
}
```

## Best Practices

1. Use Proxy for access control, lazy initialization, or remote object representation.
2. Use Decorator for adding responsibilities dynamically without subclassing.
3. Leverage Spring AOP for cross-cutting concerns like logging, transactions, and security.
4. Be aware of proxy limitations: self-invocation bypasses AOP, final methods cannot be proxied.
5. Keep proxy implementations lightweight to avoid performance overhead.
6. For complex decoration chains, consider using a builder or factory.
7. Document which beans are proxied and what aspects apply.

## Summary

Proxy and Decorator are essential patterns in Spring-based applications. Proxy controls access and is used extensively by Spring's AOP infrastructure for transactions, caching, and security. Decorator adds responsibilities dynamically and is useful for composing behaviors like compression, encryption, and logging. Understanding how Spring's proxy mechanism works is critical for avoiding common pitfalls like self-invocation issues.

## References

- Gamma, E. et al. "Design Patterns: Elements of Reusable Object-Oriented Software"
- Spring Framework Documentation: "AOP Proxies"
- "Pro Spring 5" by Iuliana Cosmina et al.

Happy Coding
