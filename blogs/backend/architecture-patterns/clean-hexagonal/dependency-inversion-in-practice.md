---
title: "Dependency Inversion in Practice"
description: "Applying the Dependency Inversion Principle in Spring Boot: abstractions, DI containers, and decoupling strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["dependency-inversion", "solid", "spring-boot", "di"]
coverImage: "/images/dependency-inversion-in-practice.png"
draft: false
---

## Overview

The Dependency Inversion Principle (DIP) is the fifth principle of SOLID and arguably the most impactful for backend architecture. DIP states that high-level modules should not depend on low-level modules; both should depend on abstractions. Abstractions should not depend on details; details should depend on abstractions.

In Spring Boot, DIP manifests through interfaces, dependency injection, and Inversion of Control (IoC). This principle is the foundation for Clean and Hexagonal architectures.

## Understanding DIP

When code violates DIP, changes to low-level details ripple through the entire system:

```java
// Violates DIP: High-level depends on low-level
public class OrderService {
    private final PostgresOrderRepository repository;
    private final SmtpEmailService emailService;

    public OrderService() {
        this.repository = new PostgresOrderRepository();
        this.emailService = new SmtpEmailService();
    }

    public void processOrder(Order order) {
        repository.save(order);
        emailService.sendConfirmation(order.getCustomerEmail());
    }
}
```

The violating example creates concrete dependencies inside the constructor. `OrderService` is now coupled to `PostgresOrderRepository` and `SmtpEmailService`. Testing requires a real Postgres database and an SMTP server. Switching to MongoDB or a different email provider means modifying `OrderService` itself. This is rigid, fragile, and hard to test.

Applying DIP, both depend on abstractions:

```java
// Follows DIP: Both depend on abstractions
public class OrderService {
    private final OrderRepository repository;
    private final NotificationService notificationService;

    public OrderService(OrderRepository repository, NotificationService notificationService) {
        this.repository = repository;
        this.notificationService = notificationService;
    }

    public void processOrder(Order order) {
        repository.save(order);
        notificationService.sendOrderConfirmation(order);
    }
}

// Abstractions defined by high-level module
public interface OrderRepository {
    Order save(Order order);
    Optional<Order> findById(OrderId id);
}

public interface NotificationService {
    void sendOrderConfirmation(Order order);
}
```

With DIP applied, `OrderService` depends on `OrderRepository` and `NotificationService` interfaces. The concrete implementations (`PostgresOrderRepository`, `SmtpEmailService`) are injected at construction time. The high-level module defines what it needs (the interface), and the low-level module fulfills that contract. Testing becomes trivial: pass mock implementations of the interfaces.

## DIP in Spring Boot

Spring's IoC container makes DIP natural to implement:

```java
@Component
public class PaymentProcessor {
    private final PaymentGateway gateway;
    private final TransactionLogger logger;

    public PaymentProcessor(PaymentGateway gateway, TransactionLogger logger) {
        this.gateway = gateway;
        this.logger = logger;
    }

    public PaymentResult process(Payment payment) {
        try {
            PaymentResult result = gateway.charge(payment);
            logger.log(payment.transactionId(), result.status());
            return result;
        } catch (GatewayException e) {
            logger.log(payment.transactionId(), TransactionStatus.FAILED);
            throw new PaymentProcessingException("Payment failed", e);
        }
    }
}

public interface PaymentGateway {
    PaymentResult charge(Payment payment);
}

public interface TransactionLogger {
    void log(String transactionId, TransactionStatus status);
}
```

Spring's `@Component` annotation marks `PaymentProcessor` as a bean. The constructor parameters `PaymentGateway` and `TransactionLogger` are interfaces; Spring resolves them to concrete implementations at runtime. The `PaymentProcessor` never imports a concrete class — it operates entirely through abstractions. This means you can replace the payment gateway from Stripe to PayPal by adding a new implementation of `PaymentGateway` and changing configuration, without touching `PaymentProcessor`.

## Using Factories for Dynamic DIP

When the implementation needs to be selected at runtime, combine DIP with the Factory pattern:

```java
@Component
public class NotificationFactory {
    private final Map<NotificationChannel, NotificationSender> senders;

    public NotificationFactory(List<NotificationSender> senderList) {
        this.senders = senderList.stream()
            .collect(Collectors.toMap(
                NotificationSender::supportedChannel,
                Function.identity()
            ));
    }

    public NotificationSender getSender(NotificationChannel channel) {
        NotificationSender sender = senders.get(channel);
        if (sender == null) {
            throw new IllegalArgumentException("Unsupported channel: " + channel);
        }
        return sender;
    }
}

public interface NotificationSender {
    NotificationChannel supportedChannel();
    void send(Notification notification);
}

@Component
public class EmailNotificationSender implements NotificationSender {
    private final EmailService emailService;

    public EmailNotificationSender(EmailService emailService) {
        this.emailService = emailService;
    }

    @Override
    public NotificationChannel supportedChannel() {
        return NotificationChannel.EMAIL;
    }

    @Override
    public void send(Notification notification) {
        emailService.send(notification.recipient(), notification.subject(), notification.body());
    }
}

@Component
public class SmsNotificationSender implements NotificationSender {
    private final SmsService smsService;

    public SmsNotificationSender(SmsService smsService) {
        this.smsService = smsService;
    }

    @Override
    public NotificationChannel supportedChannel() {
        return NotificationChannel.SMS;
    }

    @Override
    public void send(Notification notification) {
        smsService.send(notification.recipient(), notification.body());
    }
}
```

The `NotificationFactory` combines DIP with the factory pattern. All `NotificationSender` implementations are injected as a `List` by Spring's auto-collection feature. The factory builds a map from channel to sender. When a new notification channel (e.g., Push) needs to be added, you create a new `@Component` implementing `NotificationSender` — no factory code changes. This is the Open-Closed Principle in action: open for extension, closed for modification.

## Abstracting External APIs

DIP is particularly valuable for abstracting external service dependencies:

```java
// High-level abstraction
public interface PaymentGateway {
    PaymentResult authorize(Payment payment);
    PaymentResult capture(String authorizationId, Money amount);
    PaymentResult refund(String transactionId, Money amount);
    PaymentResult voidTransaction(String transactionId);
}

// Low-level implementation
@Component
public class StripePaymentGateway implements PaymentGateway {
    private final StripeApiClient stripeClient;

    public StripePaymentGateway(StripeApiClient stripeClient) {
        this.stripeClient = stripeClient;
    }

    @Override
    public PaymentResult authorize(Payment payment) {
        StripeAuthorizationRequest request = new StripeAuthorizationRequest(
            payment.amount().getAmount(),
            payment.currency().getCurrencyCode(),
            payment.sourceToken()
        );
        try {
            StripeAuthorizationResponse response = stripeClient.authorize(request);
            return PaymentResult.success(response.getId());
        } catch (StripeException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentResult capture(String authorizationId, Money amount) {
        try {
            StripeCaptureResponse response = stripeClient.capture(
                authorizationId, amount.getAmount());
            return PaymentResult.success(response.getTransactionId());
        } catch (StripeException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentResult refund(String transactionId, Money amount) {
        try {
            stripeClient.refund(transactionId, amount.getAmount());
            return PaymentResult.success(transactionId);
        } catch (StripeException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentResult voidTransaction(String transactionId) {
        try {
            stripeClient.voidTransaction(transactionId);
            return PaymentResult.success(transactionId);
        } catch (StripeException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }
}

@Component
public class PaymentService {
    private final PaymentGateway paymentGateway;
    private final PaymentRepository paymentRepository;

    public PaymentService(PaymentGateway paymentGateway, PaymentRepository paymentRepository) {
        this.paymentGateway = paymentGateway;
        this.paymentRepository = paymentRepository;
    }

    @Transactional
    public PaymentResult processPayment(Order order) {
        Payment payment = new Payment(
            order.getId().value(),
            order.getTotalAmount(),
            order.getCustomerId()
        );
        PaymentResult result = paymentGateway.authorize(payment);

        if (result.isSuccess()) {
            paymentRepository.save(payment.authorized(result.transactionId()));
            return result;
        }

        paymentRepository.save(payment.failed(result.errorMessage()));
        return result;
    }
}
```

The `PaymentGateway` interface defines the complete payment lifecycle: authorize, capture, refund, void. `StripePaymentGateway` translates domain concepts to Stripe-specific API calls, isolating Stripe's exception types (`StripeException`) behind the `PaymentResult` abstraction. `PaymentService` depends only on the interface — switching from Stripe to PayPal requires writing a new `PaymentGateway` implementation and changing one bean definition.

## Testing with DIP

DIP enables isolated testing by swapping real implementations with mocks or stubs:

```java
class OrderServiceTest {
    private OrderService orderService;
    private OrderRepository orderRepository;
    private NotificationService notificationService;

    @BeforeEach
    void setUp() {
        orderRepository = mock(OrderRepository.class);
        notificationService = mock(NotificationService.class);
        orderService = new OrderService(orderRepository, notificationService);
    }

    @Test
    void shouldProcessOrderSuccessfully() {
        Order order = new Order(OrderId.generate(), "customer-1");
        when(orderRepository.save(any(Order.class))).thenReturn(order);

        orderService.processOrder(order);

        verify(orderRepository).save(order);
        verify(notificationService).sendOrderConfirmation(order);
    }

    @Test
    void shouldHandleRepositoryFailure() {
        Order order = new Order(OrderId.generate(), "customer-1");
        when(orderRepository.save(any(Order.class)))
            .thenThrow(new DatabaseException("Connection failed"));

        assertThatThrownBy(() -> orderService.processOrder(order))
            .isInstanceOf(DatabaseException.class);

        verify(notificationService, never()).sendOrderConfirmation(any());
    }
}
```

Because `OrderService` depends on interfaces, tests can use Mockito to create mock implementations. No database, no email server — just pure Java assertions. The second test verifies that when the repository fails, the notification service is never called. This granular behavior verification is impossible without DIP.

## Common Mistakes

### Constructor Does Real Work

```java
// Wrong: Constructor creates concrete dependencies
public class ReportService {
    private final ReportRepository repository;
    private final ReportGenerator generator;

    public ReportService() {
        this.repository = new JdbcReportRepository();
        this.generator = new PdfReportGenerator();
    }
}
```

```java
// Correct: Constructor receives dependencies
public class ReportService {
    private final ReportRepository repository;
    private final ReportGenerator generator;

    public ReportService(ReportRepository repository, ReportGenerator generator) {
        this.repository = repository;
        this.generator = generator;
    }
}
```

Constructors should do assignment, not work. Creating concrete dependencies in the constructor makes testing impossible without those dependencies being fully initialized. The fix is trivial: accept dependencies as parameters.

### Using Field Injection

```java
// Wrong: Field injection hides dependencies and breaks DIP
@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private EmailService emailService;
}
```

```java
// Correct: Constructor injection makes dependencies explicit
@Service
public class UserService {
    private final UserRepository userRepository;
    private final EmailService emailService;

    public UserService(UserRepository userRepository, EmailService emailService) {
        this.userRepository = userRepository;
        this.emailService = emailService;
    }
}
```

Field injection with `@Autowired` makes dependencies invisible to callers and prevents `final` fields. You cannot know what a `UserService` needs without reading the class body. Constructor injection makes every dependency visible in the constructor signature, enables `final` fields, and works with any DI container.

### Over-Abstraction

```java
// Wrong: Unnecessary abstraction for stable dependency
public interface StringUtils {
    boolean isEmpty(String s);
    String capitalize(String s);
}

public class StringUtilsImpl implements StringUtils {
    // wrapping standard library methods
}
```

```java
// Correct: Abstract external boundaries, not internal utilities
// No need for DIP on stable standard library dependencies
```

DIP is a tool for managing change at module boundaries. Wrapping `String.isEmpty()` behind an interface adds indirection without benefit — the standard library is not going to change its `isEmpty` behavior. Apply DIP at system boundaries: databases, networks, filesystems, external APIs.

## Best Practices

1. Apply DIP at module boundaries (database, network, filesystem), not for every class.
2. Use constructor injection for mandatory dependencies.
3. Define interfaces from the client's perspective, not the implementation's.
4. Keep interfaces focused (Interface Segregation Principle).
5. Use DIP to protect high-level policies from changes in low-level details.
6. Avoid over-abstraction; not every class needs an interface.

## Summary

The Dependency Inversion Principle is the key to building flexible, testable systems. By depending on abstractions rather than concrete implementations, you decouple high-level business logic from low-level infrastructure details. In Spring Boot, DIP is implemented through interface-based design and constructor injection, enabled by the IoC container.

## References

- Martin, R. C. "Clean Code: A Handbook of Agile Software Craftsmanship"
- Martin, R. C. "Clean Architecture: A Craftsman's Guide to Software Structure and Design"
- Fowler, M. "Inversion of Control Containers and the Dependency Injection pattern"

Happy Coding
