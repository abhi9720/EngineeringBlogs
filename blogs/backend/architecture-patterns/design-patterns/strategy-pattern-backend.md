---
title: "Strategy Pattern for Backend"
description: "Implementing the Strategy pattern in backend applications: algorithm selection, dependency injection, and testability"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["strategy-pattern", "design-patterns", "spring-boot", "oop"]
coverImage: "/images/strategy-pattern-backend.png"
draft: false
---

## Overview

The Strategy pattern allows selecting an algorithm's implementation at runtime. In backend systems, this is invaluable for handling varying business rules, pricing strategies, payment methods, or data validation approaches without resorting to massive conditional logic.

Spring Boot's dependency injection makes the Strategy pattern particularly elegant: each strategy is a component, and a context class selects the appropriate strategy at runtime.

## Classic Strategy Pattern

### Without Strategy (Procedural Approach)

```java
@Service
public class PriceCalculator {
    public BigDecimal calculatePrice(String customerType, BigDecimal basePrice) {
        if ("REGULAR".equals(customerType)) {
            return basePrice;
        } else if ("VIP".equals(customerType)) {
            return basePrice.multiply(new BigDecimal("0.9"));
        } else if ("WHOLESALE".equals(customerType)) {
            if (basePrice.compareTo(new BigDecimal("100")) > 0) {
                return basePrice.multiply(new BigDecimal("0.8"));
            }
            return basePrice.multiply(new BigDecimal("0.85"));
        } else if ("EMPLOYEE".equals(customerType)) {
            return basePrice.multiply(new BigDecimal("0.7"));
        }
        throw new IllegalArgumentException("Unknown customer type: " + customerType);
    }
}
```

This violates the Open-Closed Principle: adding a new customer type requires modifying existing code.

### With Strategy Pattern

```java
public interface PricingStrategy {
    BigDecimal calculatePrice(BigDecimal basePrice);
    String getCustomerType();
}

@Component
public class RegularPricingStrategy implements PricingStrategy {
    @Override
    public BigDecimal calculatePrice(BigDecimal basePrice) {
        return basePrice;
    }

    @Override
    public String getCustomerType() {
        return "REGULAR";
    }
}

@Component
public class VipPricingStrategy implements PricingStrategy {
    @Override
    public BigDecimal calculatePrice(BigDecimal basePrice) {
        return basePrice.multiply(new BigDecimal("0.9"));
    }

    @Override
    public String getCustomerType() {
        return "VIP";
    }
}

@Component
public class WholesalePricingStrategy implements PricingStrategy {
    @Override
    public BigDecimal calculatePrice(BigDecimal basePrice) {
        if (basePrice.compareTo(new BigDecimal("100")) > 0) {
            return basePrice.multiply(new BigDecimal("0.8"));
        }
        return basePrice.multiply(new BigDecimal("0.85"));
    }

    @Override
    public String getCustomerType() {
        return "WHOLESALE";
    }
}

@Component
public class EmployeePricingStrategy implements PricingStrategy {
    @Override
    public BigDecimal calculatePrice(BigDecimal basePrice) {
        return basePrice.multiply(new BigDecimal("0.7"));
    }

    @Override
    public String getCustomerType() {
        return "EMPLOYEE";
    }
}
```

### Strategy Context

```java
@Component
public class PricingContext {

    private final Map<String, PricingStrategy> strategyMap;

    public PricingContext(List<PricingStrategy> strategies) {
        this.strategyMap = strategies.stream()
            .collect(Collectors.toMap(
                PricingStrategy::getCustomerType,
                Function.identity()
            ));
    }

    public BigDecimal calculatePrice(String customerType, BigDecimal basePrice) {
        PricingStrategy strategy = strategyMap.get(customerType);
        if (strategy == null) {
            throw new IllegalArgumentException("Unknown customer type: " + customerType);
        }
        return strategy.calculatePrice(basePrice);
    }
}
```

## Advanced Strategy: Payment Processing

A more complex example with payment gateways:

```java
public interface PaymentGatewayStrategy {
    boolean supports(PaymentMethod paymentMethod);
    PaymentResult process(Payment payment);
    PaymentResult refund(String transactionId, Money amount);
    PaymentMethod supportedMethod();
}

@Component
public class CreditCardStrategy implements PaymentGatewayStrategy {
    private final StripeApiClient stripeClient;

    public CreditCardStrategy(StripeApiClient stripeClient) {
        this.stripeClient = stripeClient;
    }

    @Override
    public boolean supports(PaymentMethod method) {
        return method.type() == PaymentType.CREDIT_CARD;
    }

    @Override
    public PaymentResult process(Payment payment) {
        try {
            StripeCharge charge = stripeClient.charge(
                payment.amount(), payment.currency(),
                payment.sourceToken());
            return PaymentResult.success(charge.getId());
        } catch (StripeException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentResult refund(String transactionId, Money amount) {
        try {
            stripeClient.refund(transactionId, amount);
            return PaymentResult.success(transactionId);
        } catch (StripeException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentMethod supportedMethod() {
        return new PaymentMethod(PaymentType.CREDIT_CARD, "Credit Card");
    }
}

@Component
public class PayPalStrategy implements PaymentGatewayStrategy {
    private final PayPalApiClient payPalClient;

    public PayPalStrategy(PayPalApiClient payPalClient) {
        this.payPalClient = payPalClient;
    }

    @Override
    public boolean supports(PaymentMethod method) {
        return method.type() == PaymentType.PAYPAL;
    }

    @Override
    public PaymentResult process(Payment payment) {
        try {
            PayPalOrder order = payPalClient.createOrder(
                payment.amount(), payment.currency());
            return PaymentResult.success(order.getId());
        } catch (PayPalException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentResult refund(String transactionId, Money amount) {
        try {
            payPalClient.refund(transactionId, amount);
            return PaymentResult.success(transactionId);
        } catch (PayPalException e) {
            return PaymentResult.failure(e.getMessage());
        }
    }

    @Override
    public PaymentMethod supportedMethod() {
        return new PaymentMethod(PaymentType.PAYPAL, "PayPal");
    }
}

@Component
public class CryptoCurrencyStrategy implements PaymentGatewayStrategy {
    @Override
    public boolean supports(PaymentMethod method) {
        return method.type() == PaymentType.CRYPTO;
    }

    @Override
    public PaymentResult process(Payment payment) {
        // Crypto payment processing logic
        return PaymentResult.success(UUID.randomUUID().toString());
    }

    @Override
    public PaymentResult refund(String transactionId, Money amount) {
        // Crypto refund logic
        return PaymentResult.success(transactionId);
    }

    @Override
    public PaymentMethod supportedMethod() {
        return new PaymentMethod(PaymentType.CRYPTO, "Cryptocurrency");
    }
}
```

### Payment Strategy Context

```java
@Component
public class PaymentStrategyContext {

    private final List<PaymentGatewayStrategy> strategies;

    public PaymentStrategyContext(List<PaymentGatewayStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentGatewayStrategy getStrategy(PaymentMethod method) {
        return strategies.stream()
            .filter(s -> s.supports(method))
            .findFirst()
            .orElseThrow(() -> new UnsupportedPaymentException(
                "No strategy found for: " + method.type()));
    }

    public PaymentResult processPayment(Payment payment) {
        PaymentGatewayStrategy strategy = getStrategy(payment.method());
        return strategy.process(payment);
    }

    public PaymentResult refundPayment(String transactionId, PaymentMethod method, Money amount) {
        PaymentGatewayStrategy strategy = getStrategy(method);
        return strategy.refund(transactionId, amount);
    }
}
```

## Strategy with Enums

When strategies map cleanly to enum values:

```java
public enum DiscountType {
    SEASONAL,
    CLEARANCE,
    LOYALTY,
    BUNDLE
}

public interface DiscountStrategy {
    DiscountType getType();
    BigDecimal applyDiscount(BigDecimal amount, DiscountContext context);
}

@Component
public class SeasonalDiscountStrategy implements DiscountStrategy {
    @Value("${discount.seasonal.percentage:15}")
    private int percentage;

    @Override
    public DiscountType getType() { return DiscountType.SEASONAL; }

    @Override
    public BigDecimal applyDiscount(BigDecimal amount, DiscountContext context) {
        BigDecimal discount = amount.multiply(
            BigDecimal.valueOf(percentage).divide(BigDecimal.valueOf(100)));
        return amount.subtract(discount);
    }
}

@Component
public class ClearanceDiscountStrategy implements DiscountStrategy {
    @Value("${discount.clearance.percentage:30}")
    private int percentage;

    @Override
    public DiscountType getType() { return DiscountType.CLEARANCE; }

    @Override
    public BigDecimal applyDiscount(BigDecimal amount, DiscountContext context) {
        BigDecimal discount = amount.multiply(
            BigDecimal.valueOf(percentage).divide(BigDecimal.valueOf(100)));
        return amount.subtract(discount).max(BigDecimal.ONE);
    }
}

@Component
public class DiscountService {

    private final Map<DiscountType, DiscountStrategy> strategyMap;

    public DiscountService(List<DiscountStrategy> strategies) {
        this.strategyMap = strategies.stream()
            .collect(Collectors.toMap(
                DiscountStrategy::getType,
                Function.identity()
            ));
    }

    public BigDecimal applyDiscount(DiscountType type, BigDecimal amount, DiscountContext context) {
        DiscountStrategy strategy = strategyMap.get(type);
        if (strategy == null) {
            throw new IllegalArgumentException("Unknown discount type: " + type);
        }
        return strategy.applyDiscount(amount, context);
    }
}
```

## Testing Strategy Pattern

```java
class PricingContextTest {

    private PricingContext pricingContext;

    @BeforeEach
    void setUp() {
        List<PricingStrategy> strategies = List.of(
            new RegularPricingStrategy(),
            new VipPricingStrategy(),
            new WholesalePricingStrategy(),
            new EmployeePricingStrategy()
        );
        pricingContext = new PricingContext(strategies);
    }

    @Test
    void shouldApplyVipDiscount() {
        BigDecimal price = pricingContext.calculatePrice("VIP", new BigDecimal("100"));
        assertThat(price).isEqualByComparingTo(new BigDecimal("90"));
    }

    @Test
    void shouldApplyEmployeeDiscount() {
        BigDecimal price = pricingContext.calculatePrice("EMPLOYEE", new BigDecimal("100"));
        assertThat(price).isEqualByComparingTo(new BigDecimal("70"));
    }

    @Test
    void shouldThrowForUnknownType() {
        assertThatThrownBy(() ->
            pricingContext.calculatePrice("UNKNOWN", new BigDecimal("100")))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
```

## Common Mistakes

### Strategy as God Class

```java
// Wrong: Strategy interface trying to do too much
public interface ReportStrategy {
    String getType();
    ReportData fetchData(ReportRequest request);
    Report format(ReportData data);
    void deliver(Report report, DeliveryConfig config);
    void archive(Report report);
}
```

```java
// Correct: Focused strategy interface
public interface ReportFormatter {
    ReportFormat supportedFormat();
    byte[] format(ReportData data);
}
```

### Mutable Strategy State

```java
// Wrong: Strategy with mutable state causes thread-safety issues
@Component
@Scope("singleton")
public class CounterStrategy implements MetricStrategy {
    private int count = 0;

    @Override
    public MetricResult calculate() {
        count++; // shared mutable state!
        return new MetricResult(count);
    }
}
```

```java
// Correct: Stateless strategy
@Component
public class CounterStrategy implements MetricStrategy {
    @Override
    public MetricResult calculate(MetricContext context) {
        return new MetricResult(context.incrementAndGet());
    }
}
```

## Best Practices

1. Keep strategies stateless and inject dependencies through constructors.
2. Use the strategy interface to define a single responsibility.
3. Use a map or registry to select strategies at runtime.
4. Register strategies automatically using Spring's component scanning.
5. Test each strategy independently and the context selection logic separately.
6. Combine Strategy with Factory pattern when strategy creation is complex.

## Summary

The Strategy pattern eliminates complex conditionals by encapsulating algorithms behind a common interface. Spring's dependency injection makes strategy registration and selection automatic. This leads to more maintainable, testable, and extensible code. Apply Strategy when you have multiple ways to perform an operation that can change at runtime.

## References

- Gamma, E. et al. "Design Patterns: Elements of Reusable Object-Oriented Software"
- Martin, R. C. "Clean Code: A Handbook of Agile Software Craftsmanship"
- Spring Framework Documentation

Happy Coding