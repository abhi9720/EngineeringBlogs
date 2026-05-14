---
title: "Builder Pattern and Immutability"
description: "Using Builder pattern for immutable objects: Lombok, generated builders, and thread-safe object construction"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["builder-pattern", "immutability", "lombok", "design-patterns"]
coverImage: "/images/builder-pattern-immutability.png"
draft: false
---

## Overview

The Builder pattern separates the construction of a complex object from its representation, allowing the same construction process to create different representations. When combined with immutability, it produces thread-safe, predictable objects that are easier to reason about and test.

In Java and Spring Boot, the Builder pattern is widely used for constructing domain objects, DTOs, request objects, and configuration classes. Tools like Lombok reduce boilerplate, but understanding the pattern's fundamentals is essential.

## The Problem: Telescoping Constructors

Without builders, objects with many parameters suffer from telescoping constructor anti-pattern:

```java
public class SearchRequest {
    private final String query;
    private final String category;
    private final String sortBy;
    private final boolean ascending;
    private final int page;
    private final int size;
    private final List<String> filters;
    private final String locale;

    public SearchRequest(String query) {
        this(query, null, null, true, 0, 20, List.of(), "en");
    }

    public SearchRequest(String query, String category) {
        this(query, category, null, true, 0, 20, List.of(), "en");
    }

    public SearchRequest(String query, String category, String sortBy) {
        this(query, category, sortBy, true, 0, 20, List.of(), "en");
    }

    public SearchRequest(String query, String category, String sortBy,
                         boolean ascending, int page, int size,
                         List<String> filters, String locale) {
        this.query = query;
        this.category = category;
        this.sortBy = sortBy;
        this.ascending = ascending;
        this.page = page;
        this.size = size;
        this.filters = filters;
        this.locale = locale;
    }
}
```

## Builder Pattern Implementation

### Manual Builder

```java
public final class SearchRequest {
    private final String query;
    private final String category;
    private final String sortBy;
    private final boolean ascending;
    private final int page;
    private final int size;
    private final List<String> filters;
    private final String locale;

    private SearchRequest(Builder builder) {
        this.query = builder.query;
        this.category = builder.category;
        this.sortBy = builder.sortBy;
        this.ascending = builder.ascending;
        this.page = builder.page;
        this.size = builder.size;
        this.filters = Collections.unmodifiableList(builder.filters);
        this.locale = builder.locale;
    }

    public static Builder builder() {
        return new Builder();
    }

    public String getQuery() { return query; }
    public String getCategory() { return category; }
    public String getSortBy() { return sortBy; }
    public boolean isAscending() { return ascending; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public List<String> getFilters() { return filters; }
    public String getLocale() { return locale; }

    public static class Builder {
        private String query;
        private String category;
        private String sortBy;
        private boolean ascending = true;
        private int page = 0;
        private int size = 20;
        private List<String> filters = new ArrayList<>();
        private String locale = "en";

        public Builder query(String query) {
            if (query == null || query.isBlank()) {
                throw new IllegalArgumentException("Query must not be empty");
            }
            this.query = query;
            return this;
        }

        public Builder category(String category) {
            this.category = category;
            return this;
        }

        public Builder sortBy(String sortBy) {
            this.sortBy = sortBy;
            return this;
        }

        public Builder ascending(boolean ascending) {
            this.ascending = ascending;
            return this;
        }

        public Builder page(int page) {
            if (page < 0) {
                throw new IllegalArgumentException("Page must be non-negative");
            }
            this.page = page;
            return this;
        }

        public Builder size(int size) {
            if (size < 1 || size > 100) {
                throw new IllegalArgumentException("Size must be between 1 and 100");
            }
            this.size = size;
            return this;
        }

        public Builder addFilter(String filter) {
            this.filters.add(filter);
            return this;
        }

        public Builder filters(List<String> filters) {
            this.filters = new ArrayList<>(filters);
            return this;
        }

        public Builder locale(String locale) {
            this.locale = locale;
            return this;
        }

        public SearchRequest build() {
            if (query == null) {
                throw new IllegalStateException("Query is required");
            }
            return new SearchRequest(this);
        }
    }
}
```

### Using the Builder

```java
SearchRequest request = SearchRequest.builder()
    .query("spring boot")
    .category("backend")
    .sortBy("relevance")
    .page(1)
    .size(10)
    .addFilter("published:2024")
    .addFilter("language:java")
    .locale("en")
    .build();
```

## Lombok @Builder

Lombok reduces the boilerplate significantly:

```java
import lombok.Builder;
import lombok.Value;

@Value
@Builder(toBuilder = true)
public class CreateOrderCommand {
    @Builder.Default
    String orderId = UUID.randomUUID().toString();
    String customerId;
    List<OrderItem> items;
    Address shippingAddress;
    @Builder.Default
    BigDecimal totalAmount = BigDecimal.ZERO;
    @Builder.Default
    OrderStatus status = OrderStatus.PENDING;
    @Builder.Default
    Instant createdAt = Instant.now();
}

@Value
@Builder
public class OrderItem {
    String productId;
    String productName;
    int quantity;
    BigDecimal unitPrice;
}

@Value
@Builder
public class Address {
    String street;
    String city;
    String state;
    String zipCode;
    String country;
}
```

Using Lombok builders:

```java
CreateOrderCommand command = CreateOrderCommand.builder()
    .customerId("cust-123")
    .item(OrderItem.builder()
        .productId("prod-456")
        .productName("Wireless Mouse")
        .quantity(2)
        .unitPrice(new BigDecimal("29.99"))
        .build())
    .item(OrderItem.builder()
        .productId("prod-789")
        .productName("USB-C Hub")
        .quantity(1)
        .unitPrice(new BigDecimal("49.99"))
        .build())
    .shippingAddress(Address.builder()
        .street("123 Main St")
        .city("San Francisco")
        .state("CA")
        .zipCode("94105")
        .country("US")
        .build())
    .build();
```

## Immutable Domain Objects with Builder

```java
public final class Order {
    private final OrderId id;
    private final String customerId;
    private final List<OrderLine> items;
    private final OrderStatus status;
    private final Money total;
    private final Instant createdAt;
    private final Instant updatedAt;

    private Order(Builder builder) {
        this.id = builder.id;
        this.customerId = builder.customerId;
        this.items = Collections.unmodifiableList(builder.items);
        this.status = builder.status;
        this.total = builder.total;
        this.createdAt = builder.createdAt;
        this.updatedAt = builder.updatedAt;
    }

    public static Builder builder() {
        return new Builder();
    }

    public Builder toBuilder() {
        return new Builder()
            .id(this.id)
            .customerId(this.customerId)
            .items(new ArrayList<>(this.items))
            .status(this.status)
            .total(this.total)
            .createdAt(this.createdAt)
            .updatedAt(this.updatedAt);
    }

    public Order withStatus(OrderStatus newStatus) {
        return toBuilder()
            .status(newStatus)
            .updatedAt(Instant.now())
            .build();
    }

    public Order addItem(OrderLine item) {
        List<OrderLine> newItems = new ArrayList<>(this.items);
        newItems.add(item);
        Money newTotal = this.total.add(item.subtotal());
        return toBuilder()
            .items(newItems)
            .total(newTotal)
            .updatedAt(Instant.now())
            .build();
    }

    // Getters
    public OrderId getId() { return id; }
    public String getCustomerId() { return customerId; }
    public List<OrderLine> getItems() { return items; }
    public OrderStatus getStatus() { return status; }
    public Money getTotal() { return total; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public static class Builder {
        private OrderId id;
        private String customerId;
        private List<OrderLine> items = new ArrayList<>();
        private OrderStatus status = OrderStatus.PENDING;
        private Money total = Money.zero();
        private Instant createdAt = Instant.now();
        private Instant updatedAt;

        public Builder id(OrderId id) { this.id = id; return this; }
        public Builder customerId(String customerId) { this.customerId = customerId; return this; }
        public Builder items(List<OrderLine> items) { this.items = new ArrayList<>(items); return this; }
        public Builder addItem(OrderLine item) { this.items.add(item); return this; }
        public Builder status(OrderStatus status) { this.status = status; return this; }
        public Builder total(Money total) { this.total = total; return this; }
        public Builder createdAt(Instant createdAt) { this.createdAt = createdAt; return this; }
        public Builder updatedAt(Instant updatedAt) { this.updatedAt = updatedAt; return this; }

        public Order build() {
            if (id == null) {
                throw new IllegalStateException("Order ID is required");
            }
            if (customerId == null) {
                throw new IllegalStateException("Customer ID is required");
            }
            return new Order(this);
        }
    }
}
```

## Advantages of Immutable Objects with Builders

### Thread Safety

```java
@Service
public class OrderService {

    // Immutable objects are inherently thread-safe
    private final ConcurrentHashMap<String, Order> orderCache = new ConcurrentHashMap<>();

    public Order updateOrderStatus(String orderId, OrderStatus newStatus) {
        Order existing = orderCache.get(orderId);
        if (existing == null) {
            throw new OrderNotFoundException(orderId);
        }

        // withStatus() returns a new object, no shared mutable state
        Order updated = existing.withStatus(newStatus);
        orderCache.put(orderId, updated);
        return updated;
    }
}
```

### Defensive Copies Eliminated

```java
// With mutable objects, defensive copies needed
public class MutableOrder {
    private List<OrderLine> items;

    public List<OrderLine> getItems() {
        return new ArrayList<>(items); // defensive copy
    }
}

// With immutable objects, no defensive copy needed
public final class ImmutableOrder {
    private final List<OrderLine> items;

    public List<OrderLine> getItems() {
        return items; // Safe because neither items nor OrderLine can be modified
    }
}
```

## Builder in Test Factories

```java
public class OrderTestFactory {

    public static Order.Builder aDefaultOrder() {
        return Order.builder()
            .id(OrderId.of(UUID.randomUUID().toString()))
            .customerId("test-customer")
            .status(OrderStatus.PENDING);
    }

    public static Order.Builder aConfirmedOrder() {
        return aDefaultOrder()
            .status(OrderStatus.CONFIRMED)
            .addItem(OrderLine.builder()
                .productId("prod-1")
                .productName("Test Product")
                .quantity(1)
                .unitPrice(new BigDecimal("10.00"))
                .build());
    }

    public static Order.Builder aShippedOrder() {
        return aConfirmedOrder()
            .status(OrderStatus.SHIPPED);
    }
}

// Usage in tests
@Test
void shouldCalculateTotalCorrectly() {
    Order order = OrderTestFactory.aConfirmedOrder()
        .addItem(OrderLine.builder()
            .productId("prod-2")
            .productName("Another Product")
            .quantity(3)
            .unitPrice(new BigDecimal("5.00"))
            .build())
        .build();

    assertThat(order.getTotal()).isEqualTo(Money.of(new BigDecimal("25.00"), "USD"));
}
```

## Common Mistakes

### Mutable Fields in Builder

```java
// Wrong: Builder exposes mutable internals
public class UserProfile {
    private final List<String> roles;

    public List<String> getRoles() {
        return roles; // Exposes internal mutable list
    }

    public static class Builder {
        private List<String> roles = new ArrayList<>();

        public List<String> getRoles() {
            return roles; // Caller can modify builder's internal list
        }
    }
}
```

```java
// Correct: Immutable collections and defensive copies
public class UserProfile {
    private final List<String> roles;

    public List<String> getRoles() {
        return roles;
    }

    public static class Builder {
        private List<String> roles = new ArrayList<>();

        public Builder roles(List<String> roles) {
            this.roles = new ArrayList<>(roles);
            return this;
        }

        public Builder addRole(String role) {
            this.roles.add(role);
            return this;
        }

        public UserProfile build() {
            return new UserProfile(Collections.unmodifiableList(new ArrayList<>(roles)));
        }
    }

    private UserProfile(List<String> roles) {
        this.roles = Collections.unmodifiableList(roles);
    }
}
```

### Missing Validation in Build Method

```java
// Wrong: Builder accepts invalid state
CreateOrderCommand command = CreateOrderCommand.builder()
    .customerId(null) // No validation
    .build();
```

```java
// Correct: Validate in build method
public static class Builder {
    public CreateOrderCommand build() {
        if (customerId == null || customerId.isBlank()) {
            throw new IllegalStateException("Customer ID is required");
        }
        if (items == null || items.isEmpty()) {
            throw new IllegalStateException("At least one item is required");
        }
        return new CreateOrderCommand(this);
    }
}
```

## Best Practices

1. Make domain objects immutable using builders for construction.
2. Validate builder state in the `build()` method, not in individual setters.
3. Use `Collections.unmodifiableList` (or other unmodifiable wrappers) for collection fields.
4. Provide `toBuilder()` methods for creating modified copies.
5. Use Lombok `@Builder` for simple DTOs and manual builders for complex domain objects with validation.
6. Keep builders as inner static classes of the object they construct.
7. Combine Builder with Factory for creating objects with default configurations.

## Summary

The Builder pattern provides clean, readable object construction, especially for objects with many parameters. When combined with immutability, builders create thread-safe, predictable objects that eliminate entire categories of bugs. Lombok reduces boilerplate for simple cases, but manual builders provide greater control over validation and construction logic for complex domain objects.

## References

- Gamma, E. et al. "Design Patterns: Elements of Reusable Object-Oriented Software"
- Bloch, J. "Effective Java" (Item 2: Builder Pattern)
- Lombok @Builder Documentation

Happy Coding