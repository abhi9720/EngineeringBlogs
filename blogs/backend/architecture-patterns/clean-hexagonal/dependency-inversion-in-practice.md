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