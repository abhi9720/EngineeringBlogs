---
title: "HATEOAS and Hypermedia APIs"
description: "Implement HATEOAS in REST APIs: hypermedia links, discoverability, Spring HATEOAS implementation, and consumer-driven contracts"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - hateoas
  - rest-api
  - hypermedia
  - spring-hateoas
coverImage: "/images/backend/api-design/rest/hateoas.png"
draft: false
---

# HATEOAS and Hypermedia APIs

## Overview

HATEOAS (Hypermedia As The Engine Of Application State) is a constraint of REST that enables API discoverability through hypermedia links. Clients navigate APIs dynamically through provided links rather than hard-coding URIs, making APIs more flexible and decoupled.

---

## Understanding HATEOAS

HATEOAS (Hypermedia As The Engine Of Application State) is a constraint of the REST architectural style that enables API discoverability through hypermedia links. Instead of clients hard-coding URLs for every possible action, the server includes navigational links in responses that tell clients what actions are available next. This decouples clients from URL structures — the server can change URLs without breaking clients as long as the link relations (rel values) remain stable.

### Core Concept

The traditional response (top) requires the client to know all possible actions and their URLs. The HATEOAS response (bottom) includes a `_links` object with rel → URL mappings that the client can follow dynamically. The client reads the "self" link for the resource's own URL, "cancel" and "pay" for available actions, and "items" for related sub-resources. Crucially, the available links depend on the resource state — a PENDING order shows cancel and pay links, while a PAID order shows refund and ship links. This state-driven linking makes the response self-descriptive and reduces coupling between client and server.

```java
// Traditional response - client must know URLs
{
    "id": 123,
    "status": "PENDING",
    "items": [...]
}

// HATEOAS response - API provides navigation
{
    "id": 123,
    "status": "PENDING",
    "items": [...],
    "_links": {
        "self": { "href": "/api/orders/123" },
        "cancel": { "href": "/api/orders/123/cancel" },
        "pay": { "href": "/api/orders/123/pay" },
        "items": { "href": "/api/orders/123/items" }
    }
}
```

Spring HATEOAS provides the `EntityModel` and `Link` classes for building hypermedia responses. The `EntityModel.of(order)` wraps the order entity, and links are added with `model.add()`. The key design pattern is conditional linking — links are added based on the resource's current state. A PENDING order gets cancel and pay links; a PAID order gets refund and ship links. This pattern guides clients toward valid state transitions and prevents them from attempting invalid operations.

### Spring HATEOAS Implementation

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<EntityModel<Order>> getOrder(@PathVariable Long id) {
        Order order = orderService.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Order not found"));

        EntityModel<Order> model = EntityModel.of(order);
        model.add(Link.of("/api/orders/" + id, "self"));

        if (order.getStatus() == OrderStatus.PENDING) {
            model.add(Link.of("/api/orders/" + id + "/cancel", "cancel"));
            model.add(Link.of("/api/orders/" + id + "/pay", "pay"));
        }

        if (order.getStatus() == OrderStatus.PAID) {
            model.add(Link.of("/api/orders/" + id + "/refund", "refund"));
            model.add(Link.of("/api/orders/" + id + "/ship", "ship"));
        }

        return ResponseEntity.ok(model);
    }
}
```

---

## Hypermedia Link Types

Links in HATEOAS responses use link relations (the `rel` attribute) to describe the relationship between the current resource and the linked resource. Standard relations like `self`, `next`, `prev`, `first`, `last` are registered with IANA and have well-defined semantics. Custom relations allow domain-specific navigation. The choice between standard and custom relations affects client portability — standard relations are understood by generic HTTP clients, while custom relations require domain-specific client logic.

### Standard Link Relations

```java
@RestController
@RequestMapping("/api/users/{userId}/orders")
public class UserOrderController {

    @GetMapping
    public ResponseEntity<CollectionModel<EntityModel<Order>>> getUserOrders(
            @PathVariable Long userId) {

        List<Order> orders = orderService.findByUserId(userId);

        List<EntityModel<Order>> orderModels = orders.stream()
            .map(order -> {
                EntityModel<Order> model = EntityModel.of(order);
                model.add(Link.of("/api/orders/" + order.getId(), "self"));
                model.add(Link.of("/api/users/" + userId, "customer"));
                model.add(Link.of("/api/orders/" + order.getId() + "/items", "items"));

                if (order.getStatus() == OrderStatus.SHIPPED) {
                    model.add(Link.of("/api/orders/" + order.getId() + "/tracking", "tracking"));
                }

                return model;
            })
            .toList();

        CollectionModel<EntityModel<Order>> collection = CollectionModel.of(orderModels);
        collection.add(Link.of("/api/users/" + userId + "/orders", "self"));
        collection.add(Link.of("/api/users/" + userId, "user"));

        return ResponseEntity.ok(collection);
    }
}
```

Custom link relations use fully-qualified URIs (like `http://api.example.com/rels/cancel`) to describe domain-specific relationships. These URIs can link to documentation pages that explain the action, its expected input, and its effects. Using URIs for custom relations prevents naming conflicts and makes the relation semantics globally unique. The `OrderLinkBuilder` centralizes custom link construction, ensuring consistent relation URIs across the API. Document each custom relation so consumers can discover and understand available state transitions.

### Custom Link Relations

```java
@Component
public class OrderLinkBuilder {

    private static final String REL_PREFIX = "http://api.example.com/rels/";

    public Link buildCancelLink(Long orderId) {
        return Link.of("/api/orders/" + orderId + "/cancel", 
            REL_PREFIX + "cancel");
    }

    public Link buildPaymentLink(Long orderId) {
        return Link.of("/api/orders/" + orderId + "/payment", 
            REL_PREFIX + "payment");
    }

    public Link buildInvoiceLink(Long orderId) {
        return Link.of("/api/orders/" + orderId + "/invoice", 
            REL_PREFIX + "invoice");
    }
}

@RestController
@RequestMapping("/api/orders")
public class RichOrderController {

    private final OrderLinkBuilder linkBuilder;

    @GetMapping("/{id}")
    public ResponseEntity<EntityModel<Order>> getOrder(@PathVariable Long id) {
        Order order = orderService.findById(id);

        EntityModel<Order> model = EntityModel.of(order);
        model.add(Link.of("/api/orders/" + id, "self"));
        model.add(linkBuilder.buildCancelLink(id));
        model.add(linkBuilder.buildPaymentLink(id));

        return ResponseEntity.ok(model);
    }
}
```

---

## RepresentationModel and Resource Assembly

Spring HATEOAS provides `RepresentationModel` as a base class for models that need to carry links. Extending `RepresentationModel<T>` gives your resource classes the ability to add links and be wrapped in `EntityModel` or `CollectionModel`. The `OrderModel` extends `RepresentationModel` and includes both data fields and link management. This pattern keeps your domain entities separate from their hypermedia representations, following the DTO pattern where the hypermedia-enriched model is what the API returns.

### Using RepresentationModel

```java
public class OrderModel extends RepresentationModel<OrderModel> {

    private Long id;
    private String orderNumber;
    private BigDecimal total;
    private String status;
    private LocalDateTime createdAt;
    private List<OrderItemModel> items;

    public OrderModel(Order order) {
        this.id = order.getId();
        this.orderNumber = order.getOrderNumber();
        this.total = order.getTotal();
        this.status = order.getStatus().name();
        this.createdAt = order.getCreatedAt();
        this.items = order.getItems().stream()
            .map(OrderItemModel::new)
            .toList();
    }
}

public class OrderItemModel extends RepresentationModel<OrderItemModel> {
    private Long id;
    private String productName;
    private Integer quantity;
    private BigDecimal price;

    public OrderItemModel(OrderItem item) {
        this.id = item.getId();
        this.productName = item.getProduct().getName();
        this.quantity = item.getQuantity();
        this.price = item.getPrice();
    }
}
```

The Resource Assembler pattern centralizes the logic for converting domain entities into hypermedia-enriched models. `OrderModelAssembler` implements `RepresentationModelAssembler<Order, OrderModel>` and is responsible for both the model conversion and link addition. This separation keeps controllers clean (they just call `assembler.toModel()`) and makes link logic testable and reusable. The assembler also handles collection-level links — the `toCollectionModel` method adds a self link to the collection response.

### Resource Assembler Pattern

```java
@Component
public class OrderModelAssembler
        implements RepresentationModelAssembler<Order, OrderModel> {

    private final UserModelAssembler userAssembler;

    public OrderModelAssembler(UserModelAssembler userAssembler) {
        this.userAssembler = userAssembler;
    }

    @Override
    public OrderModel toModel(Order order) {
        OrderModel model = new OrderModel(order);

        model.add(Link.of("/api/orders/" + order.getId(), "self"));
        model.add(Link.of("/api/orders", "orders"));

        if (order.getUser() != null) {
            model.add(userAssembler.toModel(order.getUser())
                .getRequiredLink("self")
                .withRel("customer"));
        }

        if (order.getStatus() == OrderStatus.PENDING) {
            model.add(Link.of("/api/orders/" + order.getId() + "/cancel", "cancel"));
        }

        return model;
    }

    @Override
    public CollectionModel<OrderModel> toCollectionModel(Iterable<? extends Order> orders) {
        CollectionModel<OrderModel> models = 
            RepresentationModelAssembler.super.toCollectionModel(orders);

        models.add(Link.of("/api/orders", "self"));

        return models;
    }
}

@RestController
@RequestMapping("/api/orders")
public class AssembledOrderController {

    private final OrderService orderService;
    private final OrderModelAssembler assembler;

    @GetMapping
    public ResponseEntity<CollectionModel<OrderModel>> getAllOrders() {
        List<Order> orders = orderService.findAll();
        return ResponseEntity.ok(assembler.toCollectionModel(orders));
    }

    @GetMapping("/{id}")
    public ResponseEntity<OrderModel> getOrder(@PathVariable Long id) {
        Order order = orderService.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Order not found"));
        return ResponseEntity.ok(assembler.toModel(order));
    }
}
```

---

## Advanced Hypermedia Patterns

### Conditional Links Based on State

```java
@RestController
@RequestMapping("/api/tickets")
public class TicketController {

    @GetMapping("/{id}")
    public ResponseEntity<EntityModel<Ticket>> getTicket(@PathVariable Long id) {
        Ticket ticket = ticketService.findById(id);

        EntityModel<Ticket> model = EntityModel.of(ticket);
        model.add(Link.of("/api/tickets/" + id, "self"));

        switch (ticket.getStatus()) {
            case OPEN:
                model.add(Link.of("/api/tickets/" + id + "/assign", "assign"));
                model.add(Link.of("/api/tickets/" + id + "/close", "close"));
                break;
            case ASSIGNED:
                model.add(Link.of("/api/tickets/" + id + "/resolve", "resolve"));
                model.add(Link.of("/api/tickets/" + id + "/escalate", "escalate"));
                break;
            case RESOLVED:
                model.add(Link.of("/api/tickets/" + id + "/reopen", "reopen"));
                model.add(Link.of("/api/tickets/" + id + "/close", "close"));
                break;
            case CLOSED:
                model.add(Link.of("/api/tickets/" + id + "/reopen", "reopen"));
                break;
        }

        return ResponseEntity.ok(model);
    }

    @PostMapping("/{id}/assign")
    public ResponseEntity<EntityModel<Ticket>> assignTicket(
            @PathVariable Long id, @RequestBody AssignRequest request) {
        Ticket ticket = ticketService.assign(id, request.getAssigneeId());
        return ResponseEntity.ok(buildTicketModel(ticket));
    }
}
```

### Paginated Responses with Links

```java
public class PagedModel<T> extends RepresentationModel<PagedModel<T>> {
    private List<T> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;

    public PagedModel(List<T> content, Page<?> page) {
        this.content = content;
        this.page = page.getNumber();
        this.size = page.getSize();
        this.totalElements = page.getTotalElements();
        this.totalPages = page.getTotalPages();

        String baseUrl = "/api/orders";

        this.add(Link.of(baseUrl + "?page=" + page.getNumber() + "&size=" + page.getSize(), "self"));

        if (page.hasNext()) {
            this.add(Link.of(baseUrl + "?page=" + (page.getNumber() + 1) + "&size=" + page.getSize(), "next"));
        }

        if (page.hasPrevious()) {
            this.add(Link.of(baseUrl + "?page=" + (page.getNumber() - 1) + "&size=" + page.getSize(), "prev"));
        }

        this.add(Link.of(baseUrl + "?page=0&size=" + page.getSize(), "first"));
        this.add(Link.of(baseUrl + "?page=" + (page.getTotalPages() - 1) + "&size=" + page.getSize(), "last"));
    }
}

@GetMapping("/api/orders")
public ResponseEntity<PagedModel<OrderModel>> getOrders(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size) {

    Page<Order> orderPage = orderService.findAll(PageRequest.of(page, size));
    List<OrderModel> models = orderPage.getContent().stream()
        .map(assembler::toModel)
        .toList();

    return ResponseEntity.ok(new PagedModel<>(models, orderPage));
}
```

---

## Best Practices

1. **Include a `self` link**: Every response should reference itself
2. **Use standard link relations**: Prefer IANA registered relations
3. **State-based links**: Only show actions valid for current resource state
4. **Version link relations**: Use custom relations with versioning
5. **Document your link relations**: Provide documentation for each custom relation
6. **Media type negotiation**: Use `application/hal+json` for HAL format
7. **Avoid over-linking**: Include only relevant navigational links
8. **Link templates**: Use RFC 6570 URI templates for parameterized links
9. **Performance**: Cache link structures where appropriate
10. **Consumer guidance**: Include hints about allowed methods

```java
// Media type configuration
@Configuration
public class HateoasConfig implements WebMvcConfigurer {

    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
        configurer.defaultContentType(MediaTypes.HAL_JSON);
        configurer.mediaType("hal", MediaTypes.HAL_JSON);
    }
}
```

---

## Common Mistakes

### Mistake 1: Hard-Coding URLs in Clients

```java
// WRONG: Client hard-codes URLs
String url = "https://api.example.com/api/orders/123/cancel";
restTemplate.postForEntity(url, null, Void.class);

// CORRECT: Client reads URLs from response
ResponseEntity<OrderResource> response = restTemplate
    .getForEntity("/api/orders/123", OrderResource.class);

String cancelUrl = response.getBody()
    .getLink("cancel")
    .map(Link::getHref)
    .orElseThrow(() -> new IllegalStateException("Cannot cancel this order"));

restTemplate.postForEntity(cancelUrl, null, Void.class);
```

### Mistake 2: Returning Actions Not Available

```java
// WRONG: Showing cancel link for already-cancelled order
// CORRECT: Conditionally add links based on state
if (order.getStatus() == OrderStatus.PENDING) {
    model.add(Link.of("/api/orders/" + id + "/cancel", "cancel"));
}
```

### Mistake 3: Inconsistent Link Relations

```java
// WRONG: Inconsistent naming
"customer" vs "user" vs "owner"

// CORRECT: Standardize and document
"https://api.example.com/rels/customer"
```

---

## Summary

1. HATEOAS enables API discoverability through hypermedia links
2. Links should be state-dependent, showing only valid actions
3. Standarised link relations improve client interoperability
4. Resource assemblers centralize link creation logic
5. Paginated responses should include navigation links
6. Clients should navigate via links rather than hard-coded URLs

---

## References

- [Spring HATEOAS Reference](https://docs.spring.io/spring-hateoas/docs/current/reference/html/)
- [RFC 5988 - Web Linking](https://tools.ietf.org/html/rfc5988)
- [HAL Specification](https://tools.ietf.org/html/draft-kelly-json-hal)
- [RESTful API Hypermedia](https://restfulapi.net/hateoas/)

Happy Coding