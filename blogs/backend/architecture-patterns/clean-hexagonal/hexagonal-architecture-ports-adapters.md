---
title: "Hexagonal Architecture: Ports and Adapters"
description: "Deep dive into hexagonal architecture, port-adapter pattern, and how to isolate core business logic from infrastructure"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["hexagonal-architecture", "ports-and-adapters", "spring-boot", "ddd"]
coverImage: "/images/hexagonal-architecture-ports-adapters.png"
draft: false
---

## Overview

Hexagonal Architecture, also known as Ports and Adapters, was introduced by Alistair Cockburn to create applications where the core business logic is isolated from external concerns like databases, web frameworks, and message queues. The name comes from the visual representation of the application as a hexagon with ports on each side.

The key insight is that the application core exposes ports (interfaces) that define how the outside world can interact with it, and adapters implement those ports for specific technologies.

## Core Concepts

### Ports

Ports are interfaces that define boundaries between the application core and the outside world. There are two types:

- **Inbound Ports**: Define how external actors can drive the application (use cases, queries).
- **Outbound Ports**: Define how the application accesses external resources (repositories, gateways).

```java
// Inbound port: defines how the outside world drives the application
public interface PlaceOrderUseCase {
    Order placeOrder(PlaceOrderCommand command);
}

// Outbound port: defines how the application accesses external resources
public interface OrderRepository {
    Order save(Order order);
    Optional<Order> findById(OrderId id);
}

public interface InventoryService {
    boolean isProductAvailable(String productId, int quantity);
    void reserveProduct(String productId, int quantity);
    void releaseProduct(String productId, int quantity);
}
```

Ports are contracts. Inbound ports describe what the application can do ("place an order"). Outbound ports describe what the application needs ("save an order", "check inventory"). They are defined in the application core and are technology-agnostic — they import no framework annotations, no HTTP classes, no database drivers.

### Adapters

Adapters implement ports for specific technologies. Each adapter translates between the port interface and the concrete technology.

```java
// Inbound adapter: web controller exposing HTTP API
@RestController
@RequestMapping("/orders")
public class OrderWebAdapter {

    private final PlaceOrderUseCase placeOrderUseCase;

    public OrderWebAdapter(PlaceOrderUseCase placeOrderUseCase) {
        this.placeOrderUseCase = placeOrderUseCase;
    }

    @PostMapping
    public ResponseEntity<OrderResponse> placeOrder(@RequestBody OrderRequest request) {
        PlaceOrderCommand command = PlaceOrderCommand.builder()
            .customerId(request.customerId())
            .items(request.items().stream()
                .map(i -> new OrderItem(i.productId(), i.quantity()))
                .toList())
            .build();

        Order order = placeOrderUseCase.placeOrder(command);
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(OrderResponse.from(order));
    }
}

// Outbound adapter: JPA implementation of OrderRepository
@Repository
public class OrderJpaAdapter implements OrderRepository {

    private final SpringDataOrderRepository jpaRepository;
    private final OrderEntityMapper mapper;

    public OrderJpaAdapter(SpringDataOrderRepository jpaRepository, OrderEntityMapper mapper) {
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
        return jpaRepository.findById(id.value())
            .map(mapper::toDomain);
    }
}
```

The `OrderWebAdapter` translates HTTP JSON requests into `PlaceOrderCommand` objects and delegates to the use case. The `OrderJpaAdapter` translates between the domain `Order` and the JPA `OrderEntity`. Neither adapter contains business logic — they are pure translation layers. The core remains completely testable without HTTP or a database.

## Building the Hexagon Core

The core contains domain entities and business logic with zero infrastructure dependencies:

```java
public class Order {
    private final OrderId id;
    private final String customerId;
    private final List<OrderLine> items;
    private OrderStatus status;
    private Money total;

    public Order(OrderId id, String customerId) {
        this.id = id;
        this.customerId = customerId;
        this.items = new ArrayList<>();
        this.status = OrderStatus.PENDING;
        this.total = Money.zero();
    }

    public void addProduct(String productId, String productName, Money price, int quantity) {
        if (status != OrderStatus.PENDING) {
            throw new OrderAlreadyConfirmedException(id);
        }
        OrderLine line = new OrderLine(productId, productName, price, quantity);
        items.add(line);
        total = total.add(line.subtotal());
    }

    public PlaceOrderResult place(InventoryService inventory) {
        for (OrderLine item : items) {
            if (!inventory.isProductAvailable(item.productId(), item.quantity())) {
                return PlaceOrderResult.failed("Product unavailable: " + item.productId());
            }
        }
        for (OrderLine item : items) {
            inventory.reserveProduct(item.productId(), item.quantity());
        }
        this.status = OrderStatus.CONFIRMED;
        return PlaceOrderResult.succeeded(this);
    }

    public void cancel(InventoryService inventory) {
        if (status == OrderStatus.CONFIRMED) {
            for (OrderLine item : items) {
                inventory.releaseProduct(item.productId(), item.quantity());
            }
        }
        this.status = OrderStatus.CANCELLED;
    }
}
```

The `Order` entity accepts an `InventoryService` (an outbound port) as a parameter to `place()` and `cancel()`. This is an important design choice: by injecting the port at the method level rather than in the constructor, the `Order` entity can interact with external services without violating the hexagonal boundary. The `PlaceOrderResult` return type encapsulates success or failure as a domain concept rather than throwing exceptions for predictable business rule violations.

The application service orchestrates domain logic through ports:

```java
public class OrderApplicationService implements PlaceOrderUseCase {

    private final OrderRepository orderRepository;
    private final InventoryService inventoryService;

    public OrderApplicationService(
            OrderRepository orderRepository,
            InventoryService inventoryService) {
        this.orderRepository = orderRepository;
        this.inventoryService = inventoryService;
    }

    @Override
    @Transactional
    public Order placeOrder(PlaceOrderCommand command) {
        Order order = new Order(
            OrderId.generate(),
            command.customerId()
        );

        command.items().forEach(item ->
            order.addProduct(item.productId(), item.productName(),
                item.price(), item.quantity()));

        PlaceOrderResult result = order.place(inventoryService);
        if (result.isFailure()) {
            throw new OrderPlacementException(result.errorMessage());
        }

        return orderRepository.save(order);
    }
}
```

`OrderApplicationService` implements the inbound port. It creates domain objects, calls domain methods, and coordinates the flow between ports. The use case is intentionally thin — all business rules live in the domain entity. If the inventory check logic changes, you modify `Order.place()`, not this service.

## Database Adapter Implementation

```java
@Entity
@Table(name = "orders")
public class OrderEntity {
    @Id
    private String id;
    private String customerId;
    @Enumerated(EnumType.STRING)
    private OrderStatus status;
    private BigDecimal totalAmount;
    private String currency;
    @OneToMany(cascade = CascadeType.ALL, mappedBy = "order")
    private List<OrderLineEntity> items;
    @Version
    private Long version;

    public OrderEntity() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getCustomerId() { return customerId; }
    public void setCustomerId(String customerId) { this.customerId = customerId; }
    public OrderStatus getStatus() { return status; }
    public void setStatus(OrderStatus status) { this.status = status; }
    public BigDecimal getTotalAmount() { return totalAmount; }
    public void setTotalAmount(BigDecimal totalAmount) { this.totalAmount = totalAmount; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public List<OrderLineEntity> getItems() { return items; }
    public void setItems(List<OrderLineEntity> items) { this.items = items; }
    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }
}

public interface SpringDataOrderRepository extends JpaRepository<OrderEntity, String> {}

@Component
public class OrderEntityMapper {

    public OrderEntity toEntity(Order domain) {
        OrderEntity entity = new OrderEntity();
        entity.setId(domain.getId().value());
        entity.setCustomerId(domain.getCustomerId());
        entity.setStatus(domain.getStatus());
        entity.setTotalAmount(domain.getTotal().getAmount());
        entity.setCurrency(domain.getTotal().getCurrency().getCurrencyCode());
        entity.setItems(domain.getItems().stream()
            .map(this::toLineEntity)
            .toList());
        entity.getItems().forEach(line -> line.setOrder(entity));
        return entity;
    }

    public Order toDomain(OrderEntity entity) {
        OrderId id = new OrderId(entity.getId());
        Order order = new Order(id, entity.getCustomerId());
        entity.getItems().stream()
            .map(this::toLineDomain)
            .forEach(line -> order.addProduct(
                line.productId(), line.productName(),
                line.price(), line.quantity()));
        if (entity.getStatus() == OrderStatus.CONFIRMED) {
            order.confirmDirectly();
        }
        return order;
    }

    private OrderLineEntity toLineEntity(OrderLine domain) {
        OrderLineEntity entity = new OrderLineEntity();
        entity.setProductId(domain.productId());
        entity.setProductName(domain.productName());
        entity.setQuantity(domain.quantity());
        entity.setUnitPrice(domain.price().getAmount());
        entity.setCurrency(domain.price().getCurrency().getCurrencyCode());
        return entity;
    }

    private OrderLine toLineDomain(OrderLineEntity entity) {
        Money price = Money.of(entity.getUnitPrice(), entity.getCurrency());
        return new OrderLine(entity.getProductId(), entity.getProductName(),
            price, entity.getQuantity());
    }
}
```

The persistence layer has three parts: the JPA entity (`OrderEntity`), the Spring Data repository (`SpringDataOrderRepository`), and the mapper (`OrderEntityMapper`). The mapper is the critical piece — it converts between the domain model (with value objects like `Money` and `OrderId`) and the persistence model (with primitives like `BigDecimal` and `String`). The `@Version` annotation on `OrderEntity` enables optimistic locking, preventing concurrent modifications.

## Testing Hexagonal Architecture

The core can be tested in isolation by mocking ports:

```java
class OrderTest {

    private InventoryService inventoryService;
    private Order order;

    @BeforeEach
    void setUp() {
        inventoryService = mock(InventoryService.class);
        order = new Order(OrderId.generate(), "customer-1");
        order.addProduct("prod-1", "Product 1", Money.of(BigDecimal.TEN, "USD"), 2);
    }

    @Test
    void shouldPlaceOrderWhenInventoryAvailable() {
        when(inventoryService.isProductAvailable("prod-1", 2)).thenReturn(true);

        PlaceOrderResult result = order.place(inventoryService);

        assertThat(result.isSuccess()).isTrue();
        assertThat(order.getStatus()).isEqualTo(OrderStatus.CONFIRMED);
        verify(inventoryService).reserveProduct("prod-1", 2);
    }

    @Test
    void shouldFailWhenInventoryUnavailable() {
        when(inventoryService.isProductAvailable("prod-1", 2)).thenReturn(false);

        PlaceOrderResult result = order.place(inventoryService);

        assertThat(result.isFailure()).isTrue();
        assertThat(order.getStatus()).isEqualTo(OrderStatus.PENDING);
        verify(inventoryService, never()).reserveProduct(any(), anyInt());
    }
}
```

The domain tests mock the `InventoryService` port to test both success and failure paths. The `Order` entity has no knowledge that `inventoryService` is a mock — it just calls the interface methods. This level of testing requires no Spring context, no database, and no stubs. It validates business logic in pure Java.

## Common Mistakes

### Leaking Adapter Code into the Core

```java
// Wrong: Core depends on JSON library
import com.fasterxml.jackson.annotation.JsonProperty;

public class Order {
    @JsonProperty("order_id")
    private String id;
}
```

```java
// Correct: Core has no external dependencies
public class Order {
    private final OrderId id;
}
```

A `@JsonProperty` annotation in a domain entity couples the core to Jackson's serialization behavior. If you later switch to a different JSON library or a binary serialization format, this annotation becomes meaningless or breaks. The core should have zero imports from external libraries.

### Multiple Adapters for the Same Port

Having multiple implementations of the same port is a strength of hexagonal architecture. For example, you might have a real database adapter and an in-memory one for tests:

```java
@TestConfiguration
public class TestConfiguration {

    @Bean
    @Primary
    public OrderRepository inMemoryOrderRepository() {
        return new InMemoryOrderRepository();
    }
}

public class InMemoryOrderRepository implements OrderRepository {
    private final Map<String, Order> store = new ConcurrentHashMap<>();

    @Override
    public Order save(Order order) {
        store.put(order.getId().value(), order);
        return order;
    }

    @Override
    public Optional<Order> findById(OrderId id) {
        return Optional.ofNullable(store.get(id.value()));
    }
}
```

The `InMemoryOrderRepository` is a test-only adapter that implements the same `OrderRepository` port. It uses a `ConcurrentHashMap` instead of a database. This can be used in integration tests to verify the application service behavior without setting up a database. The `@Primary` annotation ensures Spring uses the in-memory adapter during tests.

## Best Practices

1. Define ports in the application core, not in adapter modules.
2. Use dependency injection to wire adapters to ports at the composition root.
3. Keep adapters thin: they translate, not implement business logic.
4. Test the core with mocked ports; test adapters with integration tests.
5. Use value objects for domain primitives (OrderId, Money, etc.).

## Summary

Hexagonal architecture provides a clean separation between business logic and infrastructure through ports and adapters. The core remains pure and testable, while adapters handle the messy details of specific technologies. This architecture excels in complex domains where business logic stability is more important than framework convenience.

## References

- Cockburn, A. "Hexagonal Architecture"
- Martin, R. C. "Clean Architecture"
- Evans, E. "Domain-Driven Design"

Happy Coding
