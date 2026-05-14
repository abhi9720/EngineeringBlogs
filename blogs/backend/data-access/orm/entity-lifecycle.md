---
title: "Entity Lifecycle"
description: "Master JPA entity lifecycle: entity states, lifecycle callbacks, event listeners, auditing, and best practices for entity state management"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - jpa
  - entity-lifecycle
  - hibernate
  - callbacks
coverImage: "/images/backend/data-access/orm/entity-lifecycle.png"
draft: false
---

# Entity Lifecycle

## Overview

JPA entities go through distinct lifecycle states: new, managed, detached, and removed. Lifecycle callbacks allow you to execute logic at specific points in the entity lifecycle, enabling automatic auditing, validation, and business logic integration.

---

## Entity States

### State Transitions

```java
public class EntityStateDiagram {

    // Entity States and Transitions:
    //
    //                persist()
    //  TRANSIENT ───────────────> MANAGED
    //      ^                         │
    //      │                         │ remove()
    //      │                         │
    //      │                    ┌────┘
    //      │                    ▼
    //      │               REMOVED
    //      │
    //      └── merge() ◄─────────────┐
    //                                │
    //  DETACHED ◄───────────────────┘
    //                    detach()
    //                    close()
    //                    clear()
    //
}
```

### State Demonstration

```java
@Service
public class EntityStateService {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public void demonstrateAllStates() {
        // 1. TRANSIENT (NEW)
        Product product = new Product();
        product.setName("New Product");
        product.setPrice(new BigDecimal("19.99"));
        // Not in persistence context, no database ID

        // 2. MANAGED (PERSISTENT)
        entityManager.persist(product);
        // INSERT scheduled
        // Entity added to persistence context
        // Returns ID after flush
        Long id = product.getId();
        log.info("Product ID after persist: {}", id);

        // 3. MANAGED - Automatic dirty checking
        product.setPrice(new BigDecimal("24.99"));
        // UPDATE automatically generated at flush time

        // 4. DETACHED
        entityManager.detach(product);
        // Entity removed from persistence context
        // Changes no longer tracked
        product.setPrice(new BigDecimal("29.99"));
        // No UPDATE generated!

        // 5. MERGE - Re-attach detached entity
        Product mergedProduct = entityManager.merge(product);
        // Returns a new MANAGED instance
        // Original 'product' remains DETACHED
        assert mergedProduct != product;
        mergedProduct.setPrice(new BigDecimal("34.99"));
        // UPDATE generated for mergedProduct

        // 6. REMOVED
        entityManager.remove(mergedProduct);
        // DELETE scheduled at flush
    }
}
```

### Using find, getReference, and refresh

```java
@Service
public class EntityAccessService {

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public void entityAccessMethods() {
        // find() - Eagerly loads entity, returns null if not found
        Product product = entityManager.find(Product.class, 1L);
        if (product != null) {
            log.info("Found product: {}", product.getName());
        }

        // getReference() - Lazy proxy, throws exception if not found
        // No database query until a non-ID field is accessed
        Product proxy = entityManager.getReference(Product.class, 2L);
        // At this point, no SQL has been executed
        log.info("Proxy name: {}", proxy.getName());
        // SQL executed here - EntityNotFoundException if not found

        // refresh() - Reload entity state from database
        // Discards local changes
        Product managed = entityManager.find(Product.class, 3L);
        managed.setPrice(new BigDecimal("999.99"));
        entityManager.refresh(managed);
        // Local changes discarded, reloaded from database
        log.info("Price after refresh: {}", managed.getPrice());
        // Original database value
    }

    public void findVsGetReference() {
        // Use find() when:
        // - You need the entity data
        // - Entity may not exist (returns null)

        // Use getReference() when:
        // - You only need the ID reference (for relationships)
        // - Entity is guaranteed to exist
        // - You want to avoid unnecessary database query
    }
}
```

---

## Lifecycle Callbacks

### Entity-Level Callbacks

```java
@Entity
@EntityListeners(AuditListener.class)
public class AuditableEntity {

    @Id
    @GeneratedValue
    private Long id;

    private String name;
    private String description;

    @Transient
    private boolean skipAudit;

    // Instance-level callbacks
    @PrePersist
    public void prePersist() {
        log.debug("Pre-persist: will insert {}", this);
    }

    @PostPersist
    public void postPersist() {
        log.debug("Post-persist: inserted with id {}", id);
    }

    @PreUpdate
    public void preUpdate() {
        log.debug("Pre-update: will update {}", id);
    }

    @PostUpdate
    public void postUpdate() {
        log.debug("Post-update: updated {}", id);
    }

    @PreRemove
    public void preRemove() {
        log.debug("Pre-remove: will delete {}", id);
    }

    @PostRemove
    public void postRemove() {
        log.debug("Post-remove: deleted {}", id);
    }

    @PostLoad
    public void postLoad() {
        log.debug("Post-load: loaded {}", id);
    }
}
```

### External Entity Listener

```java
@Component
public class AuditListener {

    private static final Logger log = LoggerFactory.getLogger(AuditListener.class);

    @PrePersist
    public void beforePersist(Object entity) {
        if (entity instanceof Auditable auditable) {
            auditable.setCreatedAt(Instant.now());
            auditable.setCreatedBy(getCurrentUser());
            auditable.setVersion(1L);
        }
    }

    @PreUpdate
    public void beforeUpdate(Object entity) {
        if (entity instanceof Auditable auditable) {
            auditable.setUpdatedAt(Instant.now());
            auditable.setUpdatedBy(getCurrentUser());
        }
    }

    @PreRemove
    public void beforeRemove(Object entity) {
        log.info("About to delete entity: {}", entity);
    }

    @PostLoad
    public void afterLoad(Object entity) {
        if (entity instanceof Auditable auditable) {
            auditable.setPreviouslyLoaded(true);
        }
    }

    private String getCurrentUser() {
        return SecurityContextHolder.getContext().getAuthentication() != null
            ? SecurityContextHolder.getContext().getAuthentication().getName()
            : "SYSTEM";
    }
}

// Mapped superclass for auditable entities
@MappedSuperclass
public abstract class Auditable {

    @Column(updatable = false)
    private Instant createdAt;

    @Column(updatable = false)
    private String createdBy;

    private Instant updatedAt;

    private String updatedBy;

    @Version
    private Long version;

    @Transient
    private boolean previouslyLoaded;
}
```

---

## Spring Data JPA Event Publishing

### Application Events from Entity Lifecycle

```java
@Component
public class EntityEventPublisher {

    private final ApplicationEventPublisher eventPublisher;

    public EntityEventPublisher(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    @PostPersist
    public void handleEntityCreated(Object entity) {
        eventPublisher.publishEvent(new EntityCreatedEvent(this, entity));
    }

    @PostUpdate
    public void handleEntityUpdated(Object entity) {
        eventPublisher.publishEvent(new EntityUpdatedEvent(this, entity));
    }

    @PostRemove
    public void handleEntityDeleted(Object entity) {
        eventPublisher.publishEvent(new EntityDeletedEvent(this, entity));
    }
}

class EntityCreatedEvent extends ApplicationEvent {
    private final Object entity;

    public EntityCreatedEvent(Object source, Object entity) {
        super(source);
        this.entity = entity;
    }

    public Object getEntity() { return entity; }
}

@Component
public class EntityEventHandler {

    @EventListener
    @Async
    public void onEntityCreated(EntityCreatedEvent event) {
        Object entity = event.getEntity();

        if (entity instanceof Order order) {
            // Send confirmation email
            emailService.sendOrderConfirmation(order);

            // Update search index
            searchService.indexOrder(order);

            // Publish integration event
            eventBus.publish(new OrderCreatedEvent(order.getId()));
        }
    }

    @EventListener
    public void onEntityUpdated(EntityUpdatedEvent event) {
        if (event.getEntity() instanceof Product product) {
            cacheService.evictProductCache(product.getId());
        }
    }

    @EventListener
    public void onEntityDeleted(EntityDeletedEvent event) {
        if (event.getEntity() instanceof User user) {
            auditService.logUserDeletion(user.getId());
        }
    }
}
```

---

## Best Practices

1. **Use @PrePersist/@PreUpdate for auditing**: Automatic timestamp/user tracking
2. **Keep callbacks fast**: They execute in the persistence context thread
3. **Avoid database calls in callbacks**: Can cause cascading issues
4. **Use @PostLoad for initialization**: Set transient fields after loading
5. **Don't modify entity state in @PostLoad**: It's for reading only
6. **Use @Version for optimistic locking**: Prevent concurrent modifications
7. **Use @Transient for non-persistent fields**: Callback-generated values
8. **Register external listeners via @EntityListeners**: Separation of concerns
9. **Publish events asynchronously**: Don't block the persistence context
10. **Test callback behavior**: Integration tests with flush/commit

```java
@Entity
public class Product {
    @PostLoad
    public void initTransientFields() {
        // Safe: set transient fields
        this.formattedPrice = NumberFormat.getCurrencyInstance()
            .format(price);
    }
}
```

---

## Common Mistakes

### Mistake 1: Database Queries in Callbacks

```java
// WRONG: Database access in @PrePersist
@PrePersist
public void prePersist() {
    long count = entityManager.createQuery(
        "SELECT COUNT(p) FROM Product p", Long.class)
        .getSingleResult();  // Can cause issues!
}

// CORRECT: Keep callbacks simple
@PrePersist
public void prePersist() {
    this.createdAt = Instant.now();
}
```

### Mistake 2: Throwing Exceptions in Callbacks

```java
// WRONG: Unchecked exception will rollback transaction
@PrePersist
public void validate() {
    if (name == null) {
        throw new ValidationException("Name required");
        // Transaction rolled back unexpectedly
    }
}

// CORRECT: Use Bean Validation (@NotNull, @NotBlank)
```

### Mistake 3: Modifying @PostLoad Entity

```java
// WRONG: Modification in @PostLoad triggers dirty checking
@PostLoad
public void postLoad() {
    this.name = this.name.toUpperCase();
    // Hibernate marks entity as dirty
    // Unnecessary UPDATE on next flush
}
```

---

## Summary

1. Entity states: Transient, Managed, Detached, Removed
2. Persist makes entity managed, detach removes from context
3. Merge re-attaches detached entities (returns new managed instance)
4. find() returns null for missing entities, getReference() throws
5. refresh() reloads from database, discarding local changes
6. @PrePersist, @PostPersist, @PreUpdate, @PostUpdate, @PreRemove, @PostRemove, @PostLoad
7. External listeners via @EntityListeners for separation of concerns
8. Publish application events from callbacks for side effects
9. Keep callbacks fast, free of side effects on persistence context
10. Test entity lifecycle behavior thoroughly

---

## References

- [JPA Entity Lifecycle](https://jakarta.ee/specifications/persistence/3.1/jakarta-persistence-spec-3.1#a11447)
- [Hibernate Entity Lifecycle](https://docs.jboss.org/hibernate/orm/6.2/userguide/html_single/Hibernate_User_Guide.html#events)
- [Spring Data JPA Events](https://docs.spring.io/spring-data/jpa/reference/repositories/core-domain-events.html)
- [Baeldung JPA Callbacks](https://www.baeldung.com/jpa-entity-lifecycle-events)

Happy Coding