---
title: "Clean Architecture in Practice"
description: "Implementing Clean Architecture in Spring Boot: dependency rules, use cases, entities, and real-world project structure"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["clean-architecture", "spring-boot", "architecture", "ddd"]
coverImage: "/images/clean-architecture-in-practice.png"
draft: false
---

## Overview

Clean Architecture, introduced by Robert C. Martin, organizes software into concentric layers with the domain at the center. Dependencies point inward: outer layers depend on inner layers, never the reverse. This creates systems that are independent of frameworks, databases, UI, and external agencies.

In practice, Clean Architecture means your business rules are pure Java objects with no Spring annotations, your use cases orchestrate domain logic, and your adapters translate between the domain and external systems.

## Project Structure

A typical Clean Architecture Spring Boot project follows this structure:

```
com.example.orders/
├── domain/
│   ├── model/
│   │   ├── Order.java
│   │   ├── OrderId.java
│   │   ├── OrderLine.java
│   │   ├── OrderStatus.java
│   │   └── Money.java
│   └── service/
│       ├── OrderDomainService.java
│       └── DiscountPolicy.java
├── application/
│   ├── port/
│   │   ├── inbound/
│   │   │   ├── CreateOrderUseCase.java
│   │   │   └── GetOrderQuery.java
│   │   └── outbound/
│   │       ├── OrderRepositoryPort.java
│   │       └── PaymentGatewayPort.java
│   └── service/
│       ├── CreateOrderService.java
│       └── GetOrderService.java
├── adapter/
│   ├── inbound/
│   │   ├── web/
│   │   │   ├── OrderController.java
│   │   │   └── OrderRequest.java
│   │   └── messaging/
│   │       └── OrderEventConsumer.java
│   └── outbound/
│       ├── persistence/
│       │   ├── OrderRepositoryAdapter.java
│       │   └── JpaOrderRepository.java
│       └── payment/
│           └── PaymentGatewayAdapter.java
└── shared/
    └── annotation/
        └── UseCase.java
```

## Domain Layer

The domain layer contains enterprise business rules and entities. It has no framework dependencies.

```java
package com.example.orders.domain.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public class Order {
    private final OrderId id;
    private final String customerId;
    private final List<OrderLine> items;
    private OrderStatus status;
    private Money totalAmount;

    public Order(OrderId id, String customerId) {
        this.id = id;
        this.customerId = customerId;
        this.items = new ArrayList<>();
        this.status = OrderStatus.PENDING;
        this.totalAmount = Money.zero();
    }

    public void addItem(OrderLine item) {
        if (status != OrderStatus.PENDING) {
            throw new IllegalStateException("Cannot add items to a non-pending order");
        }
        this.items.add(item);
        this.totalAmount = this.totalAmount.add(item.getSubtotal());
    }

    public void confirm() {
        if (items.isEmpty()) {
            throw new IllegalStateException("Cannot confirm an empty order");
        }
        if (status != OrderStatus.PENDING) {
            throw new IllegalStateException("Order is not in pending state");
        }
        this.status = OrderStatus.CONFIRMED;
    }

    public void cancel() {
        if (status == OrderStatus.SHIPPED || status == OrderStatus.DELIVERED) {
            throw new IllegalStateException("Cannot cancel shipped or delivered order");
        }
        this.status = OrderStatus.CANCELLED;
    }

    public OrderId getId() { return id; }
    public String getCustomerId() { return customerId; }
    public List<OrderLine> getItems() { return Collections.unmodifiableList(items); }
    public OrderStatus getStatus() { return status; }
    public Money getTotalAmount() { return totalAmount; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Order order = (Order) o;
        return Objects.equals(id, order.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
```

Value objects provide type safety and encapsulate validation:

```java
package com.example.orders.domain.model;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Objects;

public class Money {
    private final BigDecimal amount;
    private final Currency currency;

    private Money(BigDecimal amount, Currency currency) {
        this.amount = amount.setScale(2, RoundingMode.HALF_EVEN);
        this.currency = currency;
    }

    public static Money of(BigDecimal amount, String currencyCode) {
        return new Money(amount, Currency.getInstance(currencyCode));
    }

    public static Money zero() {
        return new Money(BigDecimal.ZERO, Currency.getInstance("USD"));
    }

    public Money add(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(this.amount.add(other.amount), this.currency);
    }

    public Money multiply(int multiplier) {
        return new Money(this.amount.multiply(BigDecimal.valueOf(multiplier)), this.currency);
    }

    public BigDecimal getAmount() { return amount; }
    public Currency getCurrency() { return currency; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Money money = (Money) o;
        return Objects.equals(amount, money.amount) && Objects.equals(currency, money.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount, currency);
    }
}
```

## Application Layer

The application layer defines use cases and ports. Use cases orchestrate the domain layer.

```java
package com.example.orders.application.port.inbound;

import com.example.orders.domain.model.Order;
import com.example.orders.domain.model.OrderId;

public interface CreateOrderUseCase {
    Order createOrder(CreateOrderCommand command);
    OrderId getOrderId();
}

public record CreateOrderCommand(String customerId, List<OrderItemCommand> items) {}

public record OrderItemCommand(String productId, String productName, int quantity, BigDecimal unitPrice) {}
```

```java
package com.example.orders.application.port.outbound;

import com.example.orders.domain.model.Order;
import com.example.orders.domain.model.OrderId;
import java.util.Optional;

public interface OrderRepositoryPort {
    Order save(Order order);
    Optional<Order> findById(OrderId id);
    void deleteById(OrderId id);
}
```

```java
package com.example.orders.application.service;

import com.example.orders.domain.model.*;
import com.example.orders.application.port.inbound.CreateOrderUseCase;
import com.example.orders.application.port.outbound.OrderRepositoryPort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CreateOrderService implements CreateOrderUseCase {

    private final OrderRepositoryPort orderRepository;

    public CreateOrderService(OrderRepositoryPort orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Override
    @Transactional
    public Order createOrder(CreateOrderCommand command) {
        OrderId orderId = OrderId.generate();
        Order order = new Order(orderId, command.customerId());

        for (OrderItemCommand item : command.items()) {
            Money unitPrice = Money.of(item.unitPrice(), "USD");
            OrderLine orderLine = new OrderLine(
                item.productId(),
                item.productName(),
                unitPrice,
                item.quantity()
            );
            order.addItem(orderLine);
        }

        order.confirm();
        return orderRepository.save(order);
    }

    @Override
    public OrderId getOrderId() {
        return null;
    }
}
```

## Adapter Layer

Adapters implement ports using specific technologies. Outbound adapters connect to databases and external services.

```java
package com.example.orders.adapter.outbound.persistence;

import com.example.orders.domain.model.Order;
import com.example.orders.domain.model.OrderId;
import com.example.orders.application.port.outbound.OrderRepositoryPort;
import org.springframework.stereotype.Repository;

@Repository
public class OrderRepositoryAdapter implements OrderRepositoryPort {

    private final JpaOrderRepository jpaRepository;
    private final OrderMapper mapper;

    public OrderRepositoryAdapter(JpaOrderRepository jpaRepository, OrderMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    @Override
    public Order save(Order order) {
        OrderEntity entity = mapper.toEntity(order);
        OrderEntity saved = jpaRepository.save(entity);
        return mapper.toDomain(saved);
    }

    @Override
    public Optional<Order> findById(OrderId id) {
        return jpaRepository.findById(id.getValue())
            .map(mapper::toDomain);
    }

    @Override
    public void deleteById(OrderId id) {
        jpaRepository.deleteById(id.getValue());
    }
}
```

Inbound adapters handle HTTP requests and messaging:

```java
package com.example.orders.adapter.inbound.web;

import com.example.orders.application.port.inbound.CreateOrderUseCase;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final CreateOrderUseCase createOrderUseCase;
    private final GetOrderQuery getOrderQuery;

    public OrderController(CreateOrderUseCase createOrderUseCase, GetOrderQuery getOrderQuery) {
        this.createOrderUseCase = createOrderUseCase;
        this.getOrderQuery = getOrderQuery;
    }

    @PostMapping
    public ResponseEntity<OrderResponse> createOrder(@RequestBody OrderRequest request) {
        CreateOrderCommand command = request.toCommand();
        Order order = createOrderUseCase.createOrder(command);
        return ResponseEntity.status(HttpStatus.CREATED).body(OrderResponse.from(order));
    }

    @GetMapping("/{id}")
    public ResponseEntity<OrderResponse> getOrder(@PathVariable String id) {
        return getOrderQuery.getOrder(new OrderId(id))
            .map(order -> ResponseEntity.ok(OrderResponse.from(order)))
            .orElse(ResponseEntity.notFound().build());
    }
}
```

## Dependency Injection Configuration

Clean Architecture uses DI to wire the layers together at the composition root:

```java
package com.example.orders.config;

import com.example.orders.adapter.outbound.persistence.OrderMapper;
import com.example.orders.adapter.outbound.persistence.OrderRepositoryAdapter;
import com.example.orders.application.port.outbound.OrderRepositoryPort;
import com.example.orders.application.service.CreateOrderService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OrderConfiguration {

    @Bean
    public CreateOrderService createOrderService(OrderRepositoryPort orderRepositoryPort) {
        return new CreateOrderService(orderRepositoryPort);
    }

    @Bean
    public OrderRepositoryPort orderRepositoryPort(
            JpaOrderRepository jpaRepository, OrderMapper mapper) {
        return new OrderRepositoryAdapter(jpaRepository, mapper);
    }

    @Bean
    public OrderMapper orderMapper() {
        return new OrderMapper();
    }
}
```

## Testing Clean Architecture

Domain logic is pure and easily testable without Spring:

```java
class OrderTest {

    @Test
    void shouldConfirmOrderWhenItemsAdded() {
        Order order = new Order(OrderId.generate(), "customer-1");
        order.addItem(new OrderLine("prod-1", "Product 1", Money.of(BigDecimal.TEN, "USD"), 2));
        order.confirm();

        assertThat(order.getStatus()).isEqualTo(OrderStatus.CONFIRMED);
        assertThat(order.getTotalAmount()).isEqualTo(Money.of(new BigDecimal("20.00"), "USD"));
    }

    @Test
    void shouldThrowWhenConfirmingEmptyOrder() {
        Order order = new Order(OrderId.generate(), "customer-1");

        assertThatThrownBy(order::confirm)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("empty");
    }
}
```

## Common Mistakes

### Annotating Domain Objects

```java
// Wrong: Domain objects should not have framework annotations
@Entity
@Table(name = "orders")
public class Order {
    @Id
    @GeneratedValue
    private Long id;

    public Money calculateDiscount() {
        // Domain logic mixed with JPA
    }
}
```

```java
// Correct: Separate domain model from persistence
public class Order {
    private final OrderId id;
    // pure domain logic, no annotations
}

@Entity
@Table(name = "orders")
public class OrderEntity {
    @Id
    private String id;
    // JPA-specific mapping
}
```

### Leaking Infrastructure into Use Cases

```java
// Wrong: Use case depends on infrastructure
@Service
public class CreateOrderService {
    @Autowired
    private JpaOrderRepository repository; // direct dependency on JPA

    @Transactional
    public Order createOrder(CreateOrderCommand command) {
        // ...
    }
}
```

```java
// Correct: Use case depends on abstraction
@Service
public class CreateOrderService {
    private final OrderRepositoryPort repository; // depends on port, not implementation

    @Transactional
    public Order createOrder(CreateOrderCommand command) {
        // ...
    }
}
```

## Best Practices

1. Keep the domain layer completely free of framework annotations and imports.
2. Define ports (interfaces) in the application layer, not the domain layer.
3. Use mapper objects to convert between domain models and persistence entities.
4. Keep use cases focused on a single business operation.
5. Test domain logic with plain unit tests; test adapters with integration tests.

## Summary

Clean Architecture in Spring Boot requires discipline to maintain the dependency rule. The domain layer stays pure, the application layer defines ports and use cases, and adapters handle infrastructure concerns. This separation produces systems that are testable, maintainable, and adaptable to changing requirements.

## References

- Martin, R. C. "Clean Architecture: A Craftsman's Guide to Software Structure and Design"
- Evans, E. "Domain-Driven Design: Tackling Complexity in the Heart of Software"
- Vernon, V. "Implementing Domain-Driven Design"

Happy Coding