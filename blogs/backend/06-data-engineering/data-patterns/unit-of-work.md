---
title: Unit of Work Pattern
description: >-
  Implement Unit of Work pattern in Java: transaction management, change
  tracking, write-behind caching, and integration with JPA/Hibernate
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - unit-of-work
  - design-patterns
  - transactions
  - jpa
coverImage: /images/backend/data-access/data-patterns/unit-of-work.png
draft: false
order: 50
---
# Unit of Work Pattern

## Overview

The Unit of Work pattern maintains a list of objects affected by a business transaction and coordinates the writing out of changes. It ensures that all changes are persisted atomically, tracks what has changed, and prevents unnecessary database round trips by batching operations.

---

## Core Concepts

### How Unit of Work Works

A custom Unit of Work tracks entities in three maps: `newEntities` (to be inserted), `dirtyEntities` (to be updated), and `removedEntities` (to be deleted). When `commit()` is called, it processes the three categories in order: first persist new entities, then merge dirty ones, then remove deleted ones. The flush sends all pending SQL statements to the database in a single network round trip. The `rollback()` method discards all tracked changes without touching the database.

```java
public class UnitOfWork<T> {

    private final Map<Long, T> newEntities = new LinkedHashMap<>();
    private final Map<Long, T> dirtyEntities = new LinkedHashMap<>();
    private final Map<Long, T> removedEntities = new LinkedHashMap<>();
    private final EntityManager entityManager;

    public UnitOfWork(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public void registerNew(T entity) {
        // Assign temporary ID for tracking
        Long tempId = generateTempId();
        newEntities.put(tempId, entity);
    }

    public void registerDirty(T entity) {
        Long id = extractId(entity);
        if (!newEntities.containsKey(id)) {
            dirtyEntities.put(id, entity);
        }
    }

    public void registerRemoved(T entity) {
        Long id = extractId(entity);
        if (newEntities.remove(id) == null) {
            removedEntities.put(id, entity);
        }
    }

    @Transactional
    public void commit() {
        // 1. Insert new entities
        for (T entity : newEntities.values()) {
            entityManager.persist(entity);
        }

        // 2. Merge dirty entities
        for (T entity : dirtyEntities.values()) {
            entityManager.merge(entity);
        }

        // 3. Remove deleted entities
        for (T entity : removedEntities.values()) {
            T managed = entityManager.contains(entity) ? entity
                : entityManager.merge(entity);
            entityManager.remove(managed);
        }

        // Flush all changes
        entityManager.flush();

        // Clear tracking
        clear();
    }

    public void rollback() {
        clear();
    }

    private void clear() {
        newEntities.clear();
        dirtyEntities.clear();
        removedEntities.clear();
    }
}
```

---

## Hibernate's Built-in Unit of Work

### Persistence Context

Hibernate's persistence context is, in fact, a built-in Unit of Work. When you load an entity with `find()`, it becomes **managed**—Hibernate stores both the current state and a snapshot taken at load time. Any subsequent modifications are automatically detected during `flush()` through a process called dirty checking. Below, the order status is changed, a user's login timestamp is updated, a new item is persisted, and an old item is removed—all tracked transparently within the same persistence context. At commit time, Hibernate generates the appropriate `INSERT`, `UPDATE`, and `DELETE` statements, ordered to respect foreign key constraints, and executes them in a single database transaction.

```java
@Service
public class HibernateUnitOfWorkDemo {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public void hibernateUnitOfWork() {
        // Hibernate's persistence context IS the Unit of Work

        // 1. Load entities (becomes MANAGED - tracked)
        Order order = entityManager.find(Order.class, 1L);
        User user = entityManager.find(User.class, 1L);

        // 2. Modify entities (Hibernate tracks changes automatically)
        order.setStatus(OrderStatus.SHIPPED);
        user.setLastLoginAt(Instant.now());

        // 3. Create new entity (registered with persist)
        OrderItem newItem = new OrderItem();
        newItem.setProductId(10L);
        newItem.setQuantity(2);
        entityManager.persist(newItem);
        order.addItem(newItem);  // Bidirectional sync

        // 4. Remove entity (registered with remove)
        OrderItem oldItem = order.getItems().get(0);
        entityManager.remove(oldItem);

        // 5. At commit/flush, Hibernate:
        //    - Detects all changes via dirty checking
        //    - Generates INSERT for newItem
        //    - Generates UPDATE for order, user
        //    - Generates DELETE for oldItem
        //    - Orders SQL statements to respect FK constraints
        //    - Executes in a single database transaction

        // Explicit flush if needed before query
        entityManager.flush();

        // After commit:
        // - Persistence context cleared (or closed)
        // - Transaction committed
    }
}
```

### Change Tracking Internals

Hibernate's default dirty checking compares every persistent field of every managed entity against the snapshot taken at load time. For entities with many fields or for large persistence contexts, this can become expensive. The `Statistics` API exposes load, update, and flush counts that help diagnose inefficiencies. In batch operations, it is critical to periodically `flush()` and `clear()` the persistence context to prevent memory exhaustion—each managed entity stays in memory until the context is cleared.

```java
@Component
public class ChangeTrackerDebug {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public void trackChanges() {
        Session session = entityManager.unwrap(Session.class);

        // Load entities
        Product product = entityManager.find(Product.class, 1L);
        product.setPrice(new BigDecimal("49.99"));

        // Get Hibernate statistics
        Statistics stats = session.getSessionFactory().getStatistics();

        // Before flush: dirty checking happens here
        // Hibernate compares current state with snapshot taken at load time
        // Default: field-by-field comparison (all persistent fields)
        // With bytecode enhancement: tracks which fields actually changed

        // Force flush to see SQL
        session.flush();

        log.info("Entities loaded: {}", stats.getEntityLoadCount());
        log.info("Entities updated: {}", stats.getEntityUpdateCount());
        log.info("Flush executions: {}", stats.getFlushCount());
    }

    @Transactional
    public void batchChanges() {
        Session session = entityManager.unwrap(Session.class);

        // Batch processing with Unit of Work
        for (int i = 0; i < 1000; i++) {
            Product product = new Product();
            product.setName("Product " + i);
            product.setPrice(new BigDecimal("10.00"));
            session.persist(product);  // Registered in UoW

            // Flush and clear periodically to prevent OOM
            if (i % 50 == 0) {
                session.flush();   // Execute SQL statements
                session.clear();   // Clear persistence context
            }
        }

        session.flush();
    }
}
```

---

## Custom Unit of Work Implementation

### Generic Unit of Work

When you need explicit control over transaction boundaries or when you are not using Hibernate, a custom Unit of Work implementation gives you the same pattern. The `JpaUnitOfWork` below wraps an `EntityManager` and an `EntityTransaction`, providing `registerNew`, `registerDirty`, and `registerRemoved` methods. The `close()` method from `AutoCloseable` enables the try-with-resources idiom, ensuring that the transaction is committed or rolled back automatically.

```java
public interface IUnitOfWork extends AutoCloseable {

    <T> void registerNew(T entity);

    <T> void registerDirty(T entity);

    <T> void registerRemoved(T entity);

    void commit();

    void rollback();
}

public class JpaUnitOfWork implements IUnitOfWork {

    private final EntityManager entityManager;
    private final EntityTransaction transaction;

    private final List<Object> newEntities = new ArrayList<>();
    private final List<Object> dirtyEntities = new ArrayList<>();
    private final List<Object> removedEntities = new ArrayList<>();

    public JpaUnitOfWork(EntityManager entityManager) {
        this.entityManager = entityManager;
        this.transaction = entityManager.getTransaction();
    }

    public void begin() {
        if (!transaction.isActive()) {
            transaction.begin();
        }
    }

    @Override
    public <T> void registerNew(T entity) {
        newEntities.add(entity);
    }

    @Override
    public <T> void registerDirty(T entity) {
        if (!newEntities.contains(entity)) {
            dirtyEntities.add(entity);
        }
    }

    @Override
    public <T> void registerRemoved(T entity) {
        if (!newEntities.remove(entity)) {
            removedEntities.add(entity);
        }
    }

    @Override
    public void commit() {
        try {
            // Persist new entities first
            for (Object entity : newEntities) {
                entityManager.persist(entity);
            }

            // Merge dirty entities
            for (Object entity : dirtyEntities) {
                entityManager.merge(entity);
            }

            // Remove deleted entities
            for (Object entity : removedEntities) {
                Object managed = entityManager.contains(entity)
                    ? entity : entityManager.merge(entity);
                entityManager.remove(managed);
            }

            entityManager.flush();
            transaction.commit();

        } catch (RuntimeException e) {
            rollback();
            throw e;
        } finally {
            clear();
        }
    }

    @Override
    public void rollback() {
        if (transaction.isActive()) {
            try {
                transaction.rollback();
            } catch (Exception e) {
                log.error("Rollback failed", e);
            }
        }
        clear();
    }

    @Override
    public void close() {
        if (transaction.isActive()) {
            commit();
        }
    }

    private void clear() {
        newEntities.clear();
        dirtyEntities.clear();
        removedEntities.clear();
    }
}

// Usage with service
@Service
public class OrderServiceWithUoW {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public Order createOrder(CreateOrderRequest request) {
        try (JpaUnitOfWork uow = new JpaUnitOfWork(entityManager)) {
            uow.begin();

            Order order = new Order();
            order.setUserId(request.getUserId());
            order.setTotal(request.getTotal());
            uow.registerNew(order);

            User user = entityManager.find(User.class, request.getUserId());
            user.setLastOrderDate(LocalDateTime.now());
            uow.registerDirty(user);

            Inventory inventory = entityManager.find(Inventory.class,
                request.getProductId());
            inventory.decrementStock(request.getQuantity());
            uow.registerDirty(inventory);

            uow.commit();
            return order;
        }
    }
}
```

---

## Unit of Work with Repositories

### Coordinating Multiple Repositories

When a single business operation spans multiple repositories, the Unit of Work coordinates the transaction boundaries. The `UnitOfWorkCoordinator` below accepts a callback that receives the Unit of Work, allowing multiple repositories to register changes within the same transaction. The callback pattern ensures that either all changes commit or none do.

```java
// Unit of Work coordination class
@Component
public class UnitOfWorkCoordinator {

    private final EntityManager entityManager;

    public UnitOfWorkCoordinator(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public <T> T executeInUnitOfWork(UnitOfWorkCallback<T> callback) {
        try (JpaUnitOfWork uow = new JpaUnitOfWork(entityManager)) {
            uow.begin();
            T result = callback.execute(uow);
            uow.commit();
            return result;
        }
    }

    @FunctionalInterface
    public interface UnitOfWorkCallback<T> {
        T execute(JpaUnitOfWork uow);
    }
}

// Repository using UoW
@Repository
public class OrderRepositoryUoW {

    private final UnitOfWorkCoordinator coordinator;

    public OrderRepositoryUoW(UnitOfWorkCoordinator coordinator) {
        this.coordinator = coordinator;
    }

    public Order createOrderWithDetails(CreateOrderRequest request) {
        return coordinator.executeInUnitOfWork(uow -> {
            Order order = new Order(request);
            uow.registerNew(order);

            List<OrderItem> items = request.getItems().stream()
                .map(item -> new OrderItem(order, item))
                .toList();
            items.forEach(uow::registerNew);

            // Update inventory
            request.getItems().forEach(item -> {
                Inventory inv = findInventory(item.getProductId());
                inv.decrementStock(item.getQuantity());
                uow.registerDirty(inv);
            });

            return order;
        });
    }
}
```

---

## Best Practices

1. **Use Hibernate's built-in UoW**: The persistence context is already a Unit of Work
2. **Keep transaction scope small**: Short-lived UoW prevents locking issues
3. **Flush strategically**: Explicit flush before queries for consistency
4. **Batch operations**: Periodically flush and clear for large datasets
5. **Avoid long-running UoW**: Don't keep UoW open across user interactions
6. **Register changes explicitly**: For custom UoW, track all changes
7. **Handle rollback gracefully**: Clean up resources on failure
8. **Test rollback scenarios**: Verify atomicity behavior
9. **Monitor persistence context size**: Prevent memory leaks
10. **Use @Transactional for declarative UoW**: Spring manages transaction boundaries

Spring's `@Transactional` is itself a declarative Unit of Work. The annotation wraps the method in a transaction with automatic session management, so you get all the benefits of the pattern without writing any tracking code.

```java
// Spring's @Transactional is a declarative Unit of Work
@Service
@Transactional
public class SpringUoWService {

    public void businessMethod() {
        // Spring creates UoW before method
        // Hibernate Session opened, transaction started

        order.setStatus(OrderStatus.SHIPPED);  // Tracked
        user.setLastLogin(Instant.now());       // Tracked
        paymentRepository.save(payment);        // Tracked

        // Spring commits UoW after method
        // Hibernate flushes, transaction commits, session closes
    }
}
```

---

## Common Mistakes

### Mistake 1: Long-Living Unit of Work

Keeping a Unit of Work open across HTTP requests or user interactions causes database connections to be held for too long, leading to connection pool exhaustion and stale data. The Unit of Work should span exactly one logical business operation.

```java
// WRONG: UoW open across HTTP request
@Service
@Scope("session")
@Transactional
public class ShoppingCartService {
    // UoW lives as long as HTTP session

    public void addItem(Item item) {
        // ...
    }
}

// CORRECT: Keep UoW per operation
@Transactional
public void addItemToCart(Cart cart, Item item) {
    // UoW for this operation only
}
```

### Mistake 2: Ignoring Flush Order

When a custom Unit of Work processes inserts, updates, and deletes, the order matters. New entities must be persisted first (to generate IDs), then updates applied, then deletions performed. Hibernate handles this ordering automatically, but a custom implementation must be explicit.

```java
// WRONG: Not considering FK constraints
// Hibernate orders SQL statements automatically
// But custom UoW must handle insert/delete ordering

// CORRECT: Let Hibernate manage flush order
// Or manually order: inserts before updates before deletes
```

### Mistake 3: Manual UoW Without Cleanup

A custom Unit of Work that is not closed on exception leaks database resources. Always use try-with-resources or a finally block to ensure cleanup.

```java
// WRONG: Not closing UoW on exception
JpaUnitOfWork uow = new JpaUnitOfWork(em);
uow.begin();
// Exception thrown here - uow never closed!

// CORRECT: try-with-resources or finally block
try (JpaUnitOfWork uow = new JpaUnitOfWork(em)) {
    uow.begin();
    // business logic
    uow.commit();
}
```

---

## Summary

1. Unit of Work tracks changes and coordinates persistence atomically
2. Hibernate's persistence context is a built-in Unit of Work
3. Register new, dirty, and removed entities for batch persistence
4. Commit flushes all changes in a single transaction
5. Rollback discards all tracked changes
6. Spring's @Transactional provides declarative UoW management
7. Keep UoW scope short - per business operation
8. Custom UoW implementation needs careful cleanup
9. Flush and clear periodically for batch operations
10. Always handle rollback and cleanup in finally blocks

---

## References

- [Unit of Work - Martin Fowler](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- [Hibernate Persistence Context](https://docs.jboss.org/hibernate/orm/6.2/userguide/html_single/Hibernate_User_Guide.html#pc)
- [Spring Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html)
- [Baeldung - Unit of Work](https://www.baeldung.com/unit-of-work-pattern-in-java)

Happy Coding
