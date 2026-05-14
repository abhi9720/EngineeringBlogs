---
title: "SQL Injection Prevention"
description: "Comprehensive guide to SQL injection prevention: parameterized queries, ORM safety, stored procedures, and defense-in-depth strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - sql-injection
  - database
  - security
  - jpa
coverImage: "/images/sql-injection-prevention.png"
draft: false
---

# SQL Injection Prevention

## Overview

SQL injection remains one of the most dangerous and prevalent web application vulnerabilities despite being well-understood for decades. An injection occurs when untrusted data is sent to a database interpreter as part of a SQL command. This guide covers how SQL injection works, how to prevent it in Java/Spring Boot applications, and defense-in-depth strategies.

---

## How SQL Injection Works

### Classic Injection

Consider a login endpoint that builds a SQL query by concatenating user input. The normal request produces a valid query. The injection attack uses `--` to comment out the password check, bypassing authentication entirely:

```java
// VULNERABLE
String query = "SELECT * FROM users WHERE username = '" + username + 
               "' AND password = '" + password + "'";
ResultSet rs = statement.executeQuery(query);
```

Normal request:
```
POST /login
username=alice&password=secret123

SELECT * FROM users WHERE username = 'alice' AND password = 'secret123'
```

Injection attack:
```
POST /login
username=admin'--&password=

SELECT * FROM users WHERE username = 'admin'--' AND password = ''
-- Everything after -- is a comment -> password check bypassed!
```

### More Sophisticated Attacks

Attackers can extract data through UNION queries, infer information through boolean-based blind injection, or trigger time delays to confirm vulnerability:

```
Union-based injection:
username=' UNION SELECT id, username, password FROM admins--

Blind injection (boolean-based):
username=admin' AND (SELECT COUNT(*) FROM users) > 100--

Time-based blind:
username=admin'; IF (SELECT COUNT(*) FROM users) > 0 WAITFOR DELAY '0:0:5'--
```

---

## Prevention Strategy 1: Parameterized Queries (Prepared Statements)

### With JDBC

Parameterized queries separate SQL code from data. The `PreparedStatement` sends the SQL template to the database first, then binds parameters separately — the database driver escapes values before they reach the SQL parser, so malicious input cannot alter the query structure:

```java
@Repository
public class UserJdbcRepository {

    @Autowired
    private DataSource dataSource;

    // SECURE: Always use parameterized queries
    public Optional<User> findByUsername(String username) {
        String sql = "SELECT * FROM users WHERE username = ?";

        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {

            ps.setString(1, username);  // Parameter is escaped automatically

            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapUser(rs));
                }
            }
        } catch (SQLException e) {
            throw new DataAccessException("Query failed", e);
        }

        return Optional.empty();
    }

    // INSECURE: String concatenation
    public List<User> searchUsers(String searchTerm) {
        // NEVER DO THIS
        String sql = "SELECT * FROM users WHERE name LIKE '%" + searchTerm + "%'";
        // searchTerm = "'; DROP TABLE users; --"
        // Result: SELECT * FROM users WHERE name LIKE '%'; DROP TABLE users; --%'

        // SECURE: Use parameterized query
        String secureSql = "SELECT * FROM users WHERE name LIKE ?";
        // searchTerm = "'; DROP TABLE users; --"
        // Result: SELECT * FROM users WHERE name LIKE '%''; DROP TABLE users; --%'
        // The quote is escaped, injection prevented

        try (PreparedStatement ps = dataSource.getConnection()
                .prepareStatement(secureSql)) {
            ps.setString(1, "%" + searchTerm + "%");
            // Parameter value is escaped, not the SQL string
            return executeQuery(ps);
        }
    }
}
```

### With Spring Data JPA

Spring Data JPA derived query methods are automatically parameterized. Even `@Query` with named parameters (`:username`) is safe because Hibernate uses `PreparedStatement` internally. Never concatenate values into JPQL strings:

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // SECURE: Derived query methods are automatically parameterized
    Optional<User> findByUsername(String username);

    List<User> findByEmailAndActive(String email, boolean active);

    // SECURE: @Query with named parameters
    @Query("SELECT u FROM User u WHERE u.username = :username")
    Optional<User> findByUsernameNamed(@Param("username") String username);

    @Query("SELECT u FROM User u WHERE u.email LIKE :emailPattern")
    List<User> searchByEmail(@Param("emailPattern") String emailPattern);

    // VULNERABLE: String concatenation in @Query
    @Query("SELECT u FROM User u WHERE " +
           "u.username = '" + "' OR '1'='1'")  // NEVER DO THIS
    List<User> vulnerableFindAll();
}
```

### With Native Queries

Native SQL queries offer maximum flexibility but require the same parameterization discipline. Always use `setParameter` — never concatenate conditions into the SQL string:

```java
@Repository
public class UserNativeQueryRepository {

    @PersistenceContext
    private EntityManager entityManager;

    // SECURE: Native queries with parameters
    public List<User> findActiveUsersSince(LocalDate since) {
        Query query = entityManager.createNativeQuery(
            "SELECT * FROM users WHERE active = true AND created_at >= ?",
            User.class
        );
        query.setParameter(1, java.sql.Date.valueOf(since));
        return query.getResultList();
    }

    // INSECURE: Native query with string concatenation
    public List<User> findUsersByCustomCondition(String condition) {
        // NEVER DO THIS
        Query query = entityManager.createNativeQuery(
            "SELECT * FROM users WHERE " + condition, User.class
        );
        return query.getResultList();
    }
}
```

---

## Prevention Strategy 2: Stored Procedures

Stored procedures encapsulate SQL logic in the database and accept parameters safely. The procedure below takes a username parameter and returns matching non-deleted users:

```sql
-- SECURE: Stored procedure with parameterized input
CREATE PROCEDURE get_user_by_username(
    IN p_username VARCHAR(50)
)
BEGIN
    SELECT id, username, email, role
    FROM users
    WHERE username = p_username
    AND deleted = false;
END;
```

```java
@Procedure("get_user_by_username")
Optional<User> findByUsernameStoredProcedure(@Param("p_username") String username);
```

---

## Prevention Strategy 3: Input Validation (Defense in Depth)

### Whitelist Validation

While parameterized queries prevent injection for data values, you sometimes need dynamic identifiers (table names, column names, sort directions) that cannot be parameterized. For these cases, validate against a strict whitelist:

```java
@Component
public class SqlInputValidator {

    private static final Pattern SAFE_ID_PATTERN = Pattern.compile("^[a-zA-Z0-9_]+$");
    private static final Pattern SAFE_ORDER_BY = Pattern.compile(
        "^(name|email|created_at|updated_at)\\s+(asc|desc)$", 
        Pattern.CASE_INSENSITIVE
    );

    // For identifiers that cannot be parameterized (table names, column names)
    public String validateColumnName(String input) {
        if (!SAFE_ID_PATTERN.matcher(input).matches()) {
            throw new SecurityException("Invalid column name: " + input);
        }
        return input;
    }

    // For dynamic ORDER BY clauses
    public String validateOrderBy(String input) {
        if (!SAFE_ORDER_BY.matcher(input).matches()) {
            throw new SecurityException("Invalid ORDER BY: " + input);
        }
        return input;
    }
}
```

### Safe Dynamic Sorting

Dynamic sorting by user-controlled input is a common injection vector. The safe approach maps user-facing sort field names to known-safe column names in a whitelist map:

```java
@Service
public class UserService {

    private static final Map<String, String> SORT_FIELDS = Map.of(
        "name", "u.name",
        "email", "u.email",
        "created", "u.createdAt"
    );

    public List<User> getUsers(String sortField, String sortDir) {
        // Validate sort field against whitelist
        String mappedField = SORT_FIELDS.get(sortField);
        if (mappedField == null) {
            throw new IllegalArgumentException("Invalid sort field");
        }

        // Validate sort direction
        String direction = "asc".equalsIgnoreCase(sortDir) ? "ASC" : "DESC";

        String jpql = "SELECT u FROM User u ORDER BY " + mappedField + " " + direction;
        return entityManager.createQuery(jpql, User.class).getResultList();
    }
}
```

---

## Prevention Strategy 4: ORM Safety Best Practices

### JPA Specification (Dynamic Queries)

The JPA Criteria API and Spring Data Specifications build queries programmatically using type-safe API methods. The `CriteriaBuilder` automatically escapes values — there is no risk of injection because no string concatenation is involved:

```java
public class UserSpecifications {

    public static Specification<User> usernameContains(String keyword) {
        return (root, query, cb) -> {
            if (keyword == null) return null;
            // SECURE: CriteriaBuilder escapes automatically
            return cb.like(cb.lower(root.get("username")),
                "%" + keyword.toLowerCase() + "%");
        };
    }

    public static Specification<User> hasRole(String role) {
        return (root, query, cb) -> {
            if (role == null) return null;
            return cb.equal(root.get("role"), role);
        };
    }
}

// Usage
@Service
public class UserSearchService {
    public Page<User> search(String keyword, String role, Pageable pageable) {
        Specification<User> spec = Specification
            .where(UserSpecifications.usernameContains(keyword))
            .and(UserSpecifications.hasRole(role));
        return userRepository.findAll(spec, pageable);
    }
}
```

### QueryDSL

QueryDSL takes type safety further by generating Q-classes from your entity model. The `BooleanBuilder` dynamically composes `WHERE` clauses with method calls — injection is structurally impossible:

```java
// SECURE: QueryDSL generates type-safe queries
public class UserQueryRepository {

    private final JPAQueryFactory queryFactory;
    private final QUser user = QUser.user;

    public UserQueryRepository(EntityManager entityManager) {
        this.queryFactory = new JPAQueryFactory(entityManager);
    }

    public List<User> search(String username, String email, String role) {
        BooleanBuilder where = new BooleanBuilder();

        if (username != null) {
            where.and(user.username.containsIgnoreCase(username));
        }
        if (email != null) {
            where.and(user.email.containsIgnoreCase(email));
        }
        if (role != null) {
            where.and(user.role.eq(role));
        }

        return queryFactory
            .selectFrom(user)
            .where(where)
            .fetch();
    }
}
```

---

## Defense in Depth Checklist

1. **Always use parameterized queries** for all database operations
2. **Never concatenate user input** into SQL strings
3. **Use ORM frameworks** (JPA, Hibernate) which parameterize by default
4. **Validate input format** with whitelist patterns for identifiers
5. **Use stored procedures** when complex logic cannot use parameterized queries
6. **Apply least privilege** - database user should only have necessary permissions
7. **Implement WAF rules** to detect and block injection patterns
8. **Run regular DAST scans** to detect injection vulnerabilities

---

## Common Mistakes

### Mistake 1: Dynamic Query Building with String Concatenation

Building JPQL with string concatenation is just as dangerous as JDBC string concatenation. The Criteria API provides the same flexibility without the risk:

```java
// WRONG: Building JPQL with string concatenation
String jpql = "FROM User WHERE 1=1";
if (name != null) jpql += " AND name = '" + name + "'";
if (email != null) jpql += " AND email = '" + email + "'";
Query query = entityManager.createQuery("SELECT u " + jpql);

// CORRECT: Use Criteria API or Specification
Specification<User> spec = Specification.where(null);
if (name != null) spec = spec.and((root, q, cb) -> cb.equal(root.get("name"), name));
if (email != null) spec = spec.and((root, q, cb) -> cb.equal(root.get("email"), email));
List<User> users = userRepository.findAll(spec);
```

### Mistake 2: Escaping Instead of Parameterizing

Manual escaping (replacing `'` with `''`) is error-prone and does not protect against all injection vectors. Parameterized queries are the only reliable defense:

```java
// WRONG: Manual escaping (it's very difficult to get right)
String safeUsername = username.replace("'", "''");
// Still vulnerable to: username = "' OR 1=1 -- "
String sql = "SELECT * FROM users WHERE username = '" + safeUsername + "'";

// CORRECT: Use PreparedStatement (escaping is handled by the driver)
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM users WHERE username = ?"
);
ps.setString(1, username);
```

### Mistake 3: Logging Sensitive SQL

Logging full SQL queries with parameter values leaks passwords and sensitive data into log files:

```java
// WRONG: Logging the full SQL with parameters
log.debug("Executing query: SELECT * FROM users WHERE password = '{}'", password);
// Password leaked in logs!

// CORRECT: Log query structure, not parameter values
log.debug("Authenticating user: {}", username);
```

---

## Summary

SQL injection is entirely preventable with parameterized queries. Every modern database driver and ORM supports parameterized queries. Never concatenate user input into SQL strings. Use Spring Data JPA derived queries, @Query with named parameters, Criteria API, or QueryDSL. For the rare cases where dynamic SQL is unavoidable, validate identifiers against a strict whitelist.

---

## References

- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [OWASP Query Parameterization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html)
- [Baeldung - Criteria Queries](https://www.baeldung.com/hibernate-criteria-queries)
- [Spring Data JPA - Query Methods](https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html)

Happy Coding
