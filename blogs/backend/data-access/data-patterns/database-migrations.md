---
title: "Database Migrations"
description: "Master database migrations with Flyway and Liquibase: version control for schemas, migration strategies, rollback patterns, and production deployment"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - database-migrations
  - flyway
  - liquibase
  - devops
coverImage: "/images/backend/data-access/data-patterns/database-migrations.png"
draft: false
---

# Database Migrations

## Overview

Database migrations provide version control for your database schema. Tools like Flyway and Liquibase enable declarative, repeatable, and automated schema changes. They ensure that database schemas across environments are consistent, changes are auditable, and deployments are reliable.

---

## Flyway Migration

### Configuration

```java
@Configuration
public class FlywayConfig {

    @Bean
    public Flyway flyway(DataSource dataSource) {
        Flyway flyway = Flyway.configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .baselineOnMigrate(true)
            .baselineVersion("0")
            .validateOnMigrate(true)
            .outOfOrder(false)
            .load();

        flyway.migrate();
        return flyway;
    }
}

// application.yml
// spring:
//   flyway:
//     enabled: true
//     locations: classpath:db/migration
//     baseline-on-migrate: true
//     validate-on-migrate: true
```

### Migration Files

```sql
-- V1__create_users_table.sql
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- V2__create_orders_table.sql
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    order_number VARCHAR(50) NOT NULL UNIQUE,
    total_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    shipping_address_id BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- V3__add_tracking_to_orders.sql
ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN carrier VARCHAR(50);
ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMP;

-- V4__create_order_items_table.sql
CREATE TABLE order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id),
    product_id BIGINT NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- V5__add_discount_to_orders.sql
ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(50);

-- V6__seed_reference_data.sql
INSERT INTO categories (name, slug) VALUES
    ('Electronics', 'electronics'),
    ('Clothing', 'clothing'),
    ('Books', 'books'),
    ('Home & Garden', 'home-garden');
```

### Java-Based Migrations

```java
// V7__migrate_user_data.java
public class V7__migrate_user_data extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        // Migrate user data from legacy format
        try (Statement select = context.getConnection().createStatement()) {
            ResultSet rs = select.executeQuery(
                "SELECT id, old_email_field FROM users WHERE email IS NULL");

            try (PreparedStatement update = context.getConnection()
                    .prepareStatement(
                        "UPDATE users SET email = ? WHERE id = ?")) {

                while (rs.next()) {
                    update.setString(1, rs.getString("old_email_field"));
                    update.setLong(2, rs.getLong("id"));
                    update.addBatch();
                }
                update.executeBatch();
            }
        }
    }
}

// V8__add_fulltext_index.java
public class V8__add_fulltext_index extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        try (Statement stmt = context.getConnection().createStatement()) {
            stmt.execute("ALTER TABLE products ADD COLUMN search_vector TSVECTOR");
            stmt.execute("UPDATE products SET search_vector = " +
                "to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))");
            stmt.execute("CREATE INDEX idx_products_search ON products USING GIN(search_vector)");
            stmt.execute("CREATE FUNCTION products_search_update() RETURNS TRIGGER AS $$ " +
                "BEGIN " +
                "  NEW.search_vector := to_tsvector('english', coalesce(NEW.name, '') || ' ' || coalesce(NEW.description, '')); " +
                "  RETURN NEW; " +
                "END; " +
                "$$ LANGUAGE plpgsql");
            stmt.execute("CREATE TRIGGER trg_products_search " +
                "BEFORE INSERT OR UPDATE ON products " +
                "FOR EACH ROW EXECUTE FUNCTION products_search_update()");
        }
    }
}
```

---

## Liquibase Migration

### Configuration

```xml
<!-- liquibase-config.xml -->
<databaseChangeLog
    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
                        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.8.xsd">

    <include file="db/changelog/changelog-master.xml"/>
</databaseChangeLog>
```

### Liquibase Changelogs

```xml
<!-- changelog-master.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
                   http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.8.xsd">

    <include file="db/changelog/001_create_users.xml"/>
    <include file="db/changelog/002_create_orders.xml"/>
    <include file="db/changelog/003_add_tracking.xml"/>
    <include file="db/changelog/004_seed_data.xml"/>
</databaseChangeLog>

<!-- 001_create_users.xml -->
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
                   http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.8.xsd">

    <changeSet id="001" author="atiwari">
        <createTable tableName="users">
            <column name="id" type="BIGINT" autoIncrement="true">
                <constraints primaryKey="true"/>
            </column>
            <column name="name" type="VARCHAR(200)">
                <constraints nullable="false"/>
            </column>
            <column name="email" type="VARCHAR(255)">
                <constraints nullable="false" unique="true"/>
            </column>
            <column name="password_hash" type="VARCHAR(255)">
                <constraints nullable="false"/>
            </column>
            <column name="role" type="VARCHAR(20)" defaultValue="USER">
                <constraints nullable="false"/>
            </column>
            <column name="created_at" type="TIMESTAMP" defaultValueComputed="NOW()">
                <constraints nullable="false"/>
            </column>
            <column name="updated_at" type="TIMESTAMP" defaultValueComputed="NOW()">
                <constraints nullable="false"/>
            </column>
        </createTable>

        <createIndex tableName="users" indexName="idx_users_email">
            <column name="email"/>
        </createIndex>

        <rollback>
            <dropTable tableName="users"/>
        </rollback>
    </changeSet>
</databaseChangeLog>

<!-- 002_create_orders.xml -->
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
                   http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.8.xsd">

    <changeSet id="002" author="atiwari">
        <createTable tableName="orders">
            <column name="id" type="BIGINT" autoIncrement="true">
                <constraints primaryKey="true"/>
            </column>
            <column name="user_id" type="BIGINT">
                <constraints nullable="false"
                    foreignKeyName="fk_orders_users"
                    referencedTableName="users"
                    referencedColumnNames="id"/>
            </column>
            <column name="order_number" type="VARCHAR(50)">
                <constraints nullable="false" unique="true"/>
            </column>
            <column name="total_amount" type="DECIMAL(12,2)">
                <constraints nullable="false"/>
            </column>
            <column name="status" type="VARCHAR(20)" defaultValue="PENDING">
                <constraints nullable="false"/>
            </column>
            <column name="created_at" type="TIMESTAMP" defaultValueComputed="NOW()">
                <constraints nullable="false"/>
            </column>
        </createTable>

        <rollback>
            <dropTable tableName="orders"/>
        </rollback>
    </changeSet>
</databaseChangeLog>
```

### Liquibase with Spring Boot

```java
@Configuration
public class LiquibaseConfig {

    @Bean
    public SpringLiquibase liquibase(DataSource dataSource) {
        SpringLiquibase liquibase = new SpringLiquibase();
        liquibase.setDataSource(dataSource);
        liquibase.setChangeLog("classpath:db/changelog/changelog-master.xml");
        liquibase.setContexts("development,production");
        liquibase.setDefaultSchema("public");
        liquibase.setDropFirst(false);
        liquibase.setShouldRun(true);
        return liquibase;
    }
}
```

---

## Migration Strategies

### Expand-Contract Pattern

```java
// Phase 1: Expand - Add new column alongside old
// V9__add_new_email_column.sql
ALTER TABLE users ADD COLUMN new_email VARCHAR(255);
ALTER TABLE users ADD COLUMN email_migrated BOOLEAN DEFAULT FALSE;

// Application writes to both old and new columns
// Background job copies data from old to new

// Phase 2: Migrate - Backfill data
// V10__backfill_email_data.sql
UPDATE users SET new_email = email, email_migrated = TRUE
WHERE email_migrated = FALSE;

// Phase 3: Contract - Remove old column
// V11__remove_old_email_column.sql
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users RENAME COLUMN new_email TO email;
ALTER TABLE users DROP COLUMN email_migrated;
```

### Online Schema Migration

```java
// Zero-downtime migration approach
// 1. Create new table
// V12__create_orders_v2.sql
CREATE TABLE orders_v2 (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(50) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

// 2. Dual-write to both tables (application change)
@Service
public class DualWriteOrderService {

    public void createOrder(Order order) {
        // Write to old table
        oldOrderRepository.save(order);
        // Write to new table
        newOrderRepository.save(mapToV2(order));
    }
}

// 3. Backfill historical data
// V13__backfill_orders_v2.sql
INSERT INTO orders_v2 (id, order_id, user_id, total, status, created_at)
SELECT id, order_number, user_id, total_amount, status, created_at
FROM orders;

// 4. Switch reads to new table
// 5. Remove dual-write (application change)
// 6. Drop old table
// V14__drop_old_orders.sql
DROP TABLE orders;
ALTER TABLE orders_v2 RENAME TO orders;
```

---

## Rollback Strategies

### Flyway Undo (Pro feature)

```java
// For community edition, use versioned rollback scripts
// V2_1__undo_add_tracking.sql (applied if V2 needs rollback)
ALTER TABLE orders DROP COLUMN tracking_number;
ALTER TABLE orders DROP COLUMN carrier;
ALTER TABLE orders DROP COLUMN shipped_at;
```

### Liquibase Rollback

```xml
<!-- Each changeset includes rollback -->
<changeSet id="003" author="atiwari">
    <addColumn tableName="orders">
        <column name="discount_amount" type="DECIMAL(12,2)" defaultValue="0"/>
        <column name="coupon_code" type="VARCHAR(50)"/>
    </addColumn>

    <rollback>
        <dropColumn tableName="orders" columnName="discount_amount"/>
        <dropColumn tableName="orders" columnName="coupon_code"/>
    </rollback>
</changeSet>
```

---

## Best Practices

1. **One change per migration**: Smaller, focused migrations are safer
2. **Always provide rollback**: Every changeset should be reversible
3. **Test migrations locally**: Verify against local database
4. **Version control migrations**: Store in same repo as application code
5. **Use repeatable migrations**: For views, functions, stored procedures
6. **Avoid modifying existing migrations**: Create new ones to fix issues
7. **Validate in CI pipeline**: Check migration integrity
8. **Run migrations before application start**: Ensure schema compatibility
9. **Monitor migration execution time**: Alert on slow migrations
10. **Use schema version table**: Track applied migrations

```sql
-- Repeatable migration (Flyway R__)
-- R__create_revenue_report_view.sql
CREATE OR REPLACE VIEW revenue_report AS
SELECT
    DATE_TRUNC('day', o.created_at) AS day,
    COUNT(DISTINCT o.id) AS order_count,
    SUM(o.total_amount) AS revenue,
    AVG(o.total_amount) AS avg_order_value
FROM orders o
WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
GROUP BY DATE_TRUNC('day', o.created_at);
```

---

## Common Mistakes

### Mistake 1: Modifying Existing Migrations

```java
// WRONG: Editing V1 after it's been deployed
// Causes checksum mismatch errors

// CORRECT: Create new migration to fix issues
// V15__fix_email_column_constraint.sql
```

### Mistake 2: Long-Running Migrations in Production

```sql
-- WRONG: Blocks writes for extended period
ALTER TABLE orders ADD COLUMN fulltext_index TSVECTOR;
UPDATE orders SET fulltext_index = to_tsvector(...);  -- Minutes/hours

-- CORRECT: Batch the update
-- Use background job or pt-online-schema-change
```

### Mistake 3: No Rollback Plan

```xml
<!-- WRONG: No rollback defined -->
<changeSet id="004" author="atiwari">
    <dropColumn tableName="users" columnName="email"/>
    <!-- Can't recover if this breaks! -->
</changeSet>

<!-- CORRECT: Always provide rollback -->
<changeSet id="004" author="atiwari">
    <dropColumn tableName="users" columnName="email"/>
    <rollback>
        <addColumn tableName="users">
            <column name="email" type="VARCHAR(255)"/>
        </addColumn>
    </rollback>
</changeSet>
```

---

## Summary

1. Database migrations provide version control for schema changes
2. Flyway uses SQL-based migrations with version ordering
3. Liquibase uses XML/YAML/JSON changelogs with database-agnostic format
4. Expand-Contract pattern enables zero-downtime schema changes
5. Always provide rollback scripts for every migration
6. Test migrations locally and in CI pipeline
7. Run migrations before application starts
8. Use repeatable migrations for views and functions
9. Never modify applied migrations - create new ones
10. Monitor migration execution time in production

---

## References

- [Flyway Documentation](https://flywaydb.org/documentation/)
- [Liquibase Documentation](https://docs.liquibase.com/)
- [Online Schema Change Patterns](https://github.com/github/gh-ost)
- [Zero-Downtime Schema Migrations](https://www.braintreepayments.com/blog/safe-operations-for-high-volume-postgresql/)

Happy Coding