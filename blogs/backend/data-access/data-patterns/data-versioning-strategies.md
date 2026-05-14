---
title: "Data Versioning Strategies"
description: "Implement data versioning strategies: schema versioning, backward compatibility, data migration patterns, and managing evolving data models"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - data-versioning
  - schema-evolution
  - backward-compatibility
  - database
coverImage: "/images/backend/data-access/data-patterns/data-versioning-strategies.png"
draft: false
---

# Data Versioning Strategies

## Overview

Data versioning manages changes to data schemas and structures over time. As applications evolve, databases must accommodate new fields, changed constraints, and restructured relationships without breaking existing functionality. Effective versioning strategies ensure backward compatibility and smooth transitions.

---

## Schema Versioning

### Database Schema Versions

```sql
-- V1: Initial schema
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE
);

-- V2: Add phone number (backward compatible - nullable)
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- V3: Add address fields (backward compatible)
ALTER TABLE users ADD COLUMN address_line1 VARCHAR(255);
ALTER TABLE users ADD COLUMN address_city VARCHAR(100);
ALTER TABLE users ADD COLUMN address_country VARCHAR(100);

-- V4: Replace single name with first/last (requires migration)
ALTER TABLE users ADD COLUMN first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN last_name VARCHAR(100);

-- Backfill data
UPDATE users SET
    first_name = SPLIT_PART(name, ' ', 1),
    last_name = SUBSTRING(name FROM POSITION(' ' IN name) + 1)
WHERE first_name IS NULL;

-- V5: Make name nullable after migration (eventually)
ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
```

---

## Backward Compatibility Patterns

### Additive Changes (Safe)

```java
// Adding new optional fields is always backward compatible
@Entity
public class Product {

    @Id
    private Long id;

    private String name;

    private BigDecimal price;

    // NEW: Optional fields - old clients can ignore
    private String description;

    @ElementCollection
    private List<String> tags;

    private Boolean featured;
}
```

### Read-Only Old Fields

```java
@Entity
public class User {

    @Id
    private Long id;

    // Old field - kept for backward compatibility
    @Deprecated
    private String name;

    // New fields replacing name
    private String firstName;

    private String lastName;

    // Computed getter for backward compatibility
    @Transient
    public String getName() {
        if (name != null) return name;
        if (firstName != null && lastName != null) {
            return firstName + " " + lastName;
        }
        return null;
    }

    @PreUpdate
    @PrePersist
    public void syncName() {
        // Keep old field in sync for backward compatibility
        if (firstName != null && lastName != null) {
            this.name = firstName + " " + lastName;
        }
    }
}
```

---

## Data Migration Patterns

### Versioned Documents

```java
// Document with version marker
@Document(collection = "products")
public class ProductDocument {

    @Id
    private String id;

    // Schema version for migration
    private int schemaVersion = 2;

    // V1 fields
    private String name;
    private BigDecimal price;

    // V2 fields
    private String description;
    private String category;

    // V3 fields
    private Map<String, String> attributes;
    private List<String> tags;

    @PostLoad
    public void migrate() {
        if (schemaVersion < 2) {
            migrateV1ToV2();
        }
        if (schemaVersion < 3) {
            migrateV2ToV3();
        }
    }

    private void migrateV1ToV2() {
        this.description = "";
        this.category = "UNCATEGORIZED";
        this.schemaVersion = 2;
    }

    private void migrateV2ToV3() {
        this.attributes = new HashMap<>();
        this.tags = new ArrayList<>();
        this.schemaVersion = 3;
    }
}
```

### Background Migration Job

```java
@Service
public class DataMigrationService {

    private final ProductRepository productRepository;
    private static final int BATCH_SIZE = 100;

    @Scheduled(cron = "0 0 2 * * ?") // Daily at 2 AM
    @Transactional
    public void migrateLegacyProducts() {
        Pageable pageable = PageRequest.of(0, BATCH_SIZE);
        Page<Product> legacyProducts;

        do {
            legacyProducts = productRepository
                .findBySchemaVersionLessThan(2, pageable);

            for (Product product : legacyProducts.getContent()) {
                try {
                    migrateProduct(product);
                } catch (Exception e) {
                    log.error("Failed to migrate product {}: {}",
                        product.getId(), e.getMessage());
                }
            }

            productRepository.saveAll(legacyProducts.getContent());
            pageable = legacyProducts.nextPageable();

        } while (legacyProducts.hasNext());
    }

    private void migrateProduct(Product product) {
        // Migrate from V1 to V2
        if (product.getSchemaVersion() < 2) {
            // Split single name field
            String fullName = product.getLegacyName();
            String[] parts = fullName.split(" ", 2);
            product.setName(parts[0]);
            if (parts.length > 1) {
                product.setDescription(parts[1]);
            }
            product.setSchemaVersion(2);
        }
    }
}
```

---

## API Versioning for Data

### Response Versioning

```java
@RestController
@RequestMapping("/api/users")
public class UserVersionedController {

    private final UserService userService;

    // V1 response - minimal fields
    @GetMapping(value = "/{id}", produces = "application/vnd.api.v1+json")
    public ResponseEntity<UserV1> getUserV1(@PathVariable Long id) {
        User user = userService.findById(id);
        return ResponseEntity.ok(new UserV1(user.getId(), user.getName(), user.getEmail()));
    }

    // V2 response - extended fields
    @GetMapping(value = "/{id}", produces = "application/vnd.api.v2+json")
    public ResponseEntity<UserV2> getUserV2(@PathVariable Long id) {
        User user = userService.findById(id);
        return ResponseEntity.ok(new UserV2(
            user.getId(),
            user.getFirstName() + " " + user.getLastName(),
            user.getEmail(),
            user.getPhone(),
            user.getAddress()
        ));
    }
}

// V1 - backward compatible response
class UserV1 {
    public final Long id;
    public final String name;
    public final String email;

    public UserV1(Long id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }
}

// V2 - extended response
class UserV2 {
    public final Long id;
    public final String name;
    public final String email;
    public final String phone;
    public final String address;

    public UserV2(Long id, String name, String email, String phone, String address) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.phone = phone;
        this.address = address;
    }
}
```

---

## Event Versioning

### Versioned Events

```java
// Base event with version
public abstract class VersionedEvent {
    private final int eventVersion;

    protected VersionedEvent(int eventVersion) {
        this.eventVersion = eventVersion;
    }

    public int getEventVersion() { return eventVersion; }
}

// V1 event
public class UserRegisteredV1 extends VersionedEvent {
    private final Long userId;
    private final String email;
    private final String name;

    public UserRegisteredV1(Long userId, String email, String name) {
        super(1);
        this.userId = userId;
        this.email = email;
        this.name = name;
    }
}

// V2 event - added phone and address
public class UserRegisteredV2 extends VersionedEvent {
    private final Long userId;
    private final String email;
    private final String firstName;
    private final String lastName;
    private final String phone;
    private final String address;

    public UserRegisteredV2(Long userId, String email, String firstName,
                            String lastName, String phone, String address) {
        super(2);
        this.userId = userId;
        this.email = email;
        this.firstName = firstName;
        this.lastName = lastName;
        this.phone = phone;
        this.address = address;
    }

    // Upgrade V1 to V2
    public static UserRegisteredV2 fromV1(UserRegisteredV1 v1) {
        String[] nameParts = v1.getName().split(" ", 2);
        return new UserRegisteredV2(
            v1.getUserId(),
            v1.getEmail(),
            nameParts[0],
            nameParts.length > 1 ? nameParts[1] : "",
            null,
            null
        );
    }
}

// Event upcaster for replaying old events
@Component
public class EventUpcaster {

    private final ObjectMapper objectMapper;

    public DomainEvent upcast(Map<String, Object> rawEvent) {
        int version = (int) rawEvent.getOrDefault("eventVersion", 1);
        String eventType = (String) rawEvent.get("eventType");

        return switch (eventType) {
            case "UserRegistered" -> upcastUserRegistered(rawEvent, version);
            case "OrderPlaced" -> upcastOrderPlaced(rawEvent, version);
            default -> throw new IllegalArgumentException("Unknown event: " + eventType);
        };
    }

    private DomainEvent upcastUserRegistered(Map<String, Object> raw, int version) {
        if (version == 1) {
            UserRegisteredV1 v1 = objectMapper.convertValue(raw, UserRegisteredV1.class);
            return UserRegisteredV2.fromV1(v1);
        }
        return objectMapper.convertValue(raw, UserRegisteredV2.class);
    }
}
```

---

## Best Practices

1. **Additive changes first**: Add nullable columns, never remove
2. **Version your documents**: Include schema version in stored documents
3. **Deprecate gradually**: Mark old fields as deprecated before removal
4. **Provide backward-compatible access**: Old getters still work
5. **Use background migrations**: Async migration for large datasets
6. **Monitor migration progress**: Track migrated vs pending records
7. **Event upcasting**: Upgrade old events during replay
8. **API versioning**: Serve multiple response versions
9. **Test migration scenarios**: Test with production-like data
10. **Plan for rollback**: Every migration must be reversible

```java
// Migration health monitoring
@Component
public class MigrationMonitor {

    private final ProductRepository productRepository;

    @Scheduled(fixedDelay = 3600000)
    public void checkMigrationProgress() {
        long totalProducts = productRepository.count();
        long migratedProducts = productRepository.countBySchemaVersion(2);
        long pendingMigration = totalProducts - migratedProducts;

        log.info("Migration progress: {}/{} migrated ({} pending)",
            migratedProducts, totalProducts, pendingMigration);

        if (pendingMigration > 1000) {
            log.warn("Large number of pending migrations: {}", pendingMigration);
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Breaking Changes Without Migration

```sql
-- WRONG: Removing column without migration
ALTER TABLE users DROP COLUMN name;
-- Old code trying to read name will fail!

-- CORRECT: Gradual deprecation
-- 1. Add new fields, keep old
-- 2. Migrate data
-- 3. Remove old field
```

### Mistake 2: Not Versioning Schema Metadata

```java
// WRONG: No schema version - don't know document format
public class Product {
    private String name;
    // Was this added in V2? V3? No way to tell
}

// CORRECT: Include schema version
public class Product {
    private int schemaVersion = 3;
    private String name;
}
```

### Mistake 3: Ignoring Downstream Consumers

```java
// WRONG: Changing event schema without notifying consumers
// Breaking existing event handlers

// CORRECT: Create new event version
public class OrderPlacedV2 extends OrderPlacedV1 {
    // Keep V1 fields, add V2 fields
}
```

---

## Summary

1. Additive schema changes (nullable columns) are backward compatible
2. Include schema version in stored documents for migration logic
3. Background migrations handle large-scale data transformation
4. Event upcasting upgrades old events during replay
5. API versioning serves different data formats to different clients
6. Deprecate fields gradually, never remove abruptly
7. Test migration scenarios with production-like data
8. Monitor migration progress and alert on stagnation
9. Every migration should be reversible
10. Communicate schema changes to downstream consumers

---

## References

- [Schema Versioning in Microservices](https://martinfowler.com/articles/evolving-applications.html)
- [Event Versioning Best Practices](https://www.confluent.io/blog/event-sourcing-and-event-versioning/)
- [Backward Compatibility Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/backward-compatibility)
- [Data Migration Patterns](https://www.databasestar.com/database-migration/)

Happy Coding