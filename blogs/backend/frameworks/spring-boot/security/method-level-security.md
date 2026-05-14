---
title: "Method-Level Security with Spring Security"
description: "Master method-level security annotations: @PreAuthorize, @PostAuthorize, @Secured, @RolesAllowed, custom permission evaluators, and expression-based access control"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - spring-security
  - method-security
  - authorization
coverImage: "/images/method-level-security.png"
draft: false
---

## Overview

Method-level security enables fine-grained access control at the service layer. Spring Security provides annotations like @PreAuthorize, @PostAuthorize, @Secured, and @RolesAllowed to restrict access based on roles, permissions, and custom expressions.

Method security complements web security. Web security (URL patterns) controls access at the controller level, while method security provides fine-grained control at the service layer. A common pattern is: web security ensures the user is authenticated, and method security checks specific permissions for the operation.

## Enabling Method Security

```java
@Configuration
@EnableGlobalMethodSecurity(
    prePostEnabled = true,    // Enable @PreAuthorize, @PostAuthorize
    securedEnabled = true,    // Enable @Secured
    jsr250Enabled = true      // Enable @RolesAllowed
)
public class MethodSecurityConfig {
}
```

## Basic Annotations

### @Secured

`@Secured` is the simplest annotation. It checks for granted authorities (roles) and requires ALL specified authorities. Note that `@Secured` expects the full authority name including the `ROLE_` prefix.

```java
@Service
public class UserService {

    @Secured("ROLE_ADMIN")
    public List<User> findAllUsers() {
        return userRepository.findAll();
    }

    @Secured({"ROLE_ADMIN", "ROLE_MANAGER"})
    public User findById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }
}
```

### @RolesAllowed (JSR-250)

`@RolesAllowed` is a Java EE standard annotation. Unlike `@Secured`, it does NOT require the `ROLE_` prefix — Spring Security adds it automatically.

```java
@Service
public class OrderService {

    @RolesAllowed("ADMIN")
    public void cancelOrder(Long orderId) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
        order.cancel();
        orderRepository.save(order);
    }

    @RolesAllowed({"ADMIN", "SUPPORT_AGENT"})
    public void refundOrder(Long orderId, BigDecimal amount) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
        order.refund(amount);
        orderRepository.save(order);
    }
}
```

## Expression-Based Security

### @PreAuthorize

`@PreAuthorize` evaluates a SpEL expression before the method executes. The expression has access to the `Authentication` object, method arguments (via `#paramName`), and utility methods like `hasRole()`, `hasAuthority()`, and `isAuthenticated()`.

The expression must evaluate to true for the method to execute. If it evaluates to false, an `AccessDeniedException` is thrown and the method is never called.

```java
@Service
public class DocumentService {

    @PreAuthorize("hasRole('ADMIN')")
    public void deleteAllDocuments() { documentRepository.deleteAll(); }

    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public Document createDocument(Document document) { return documentRepository.save(document); }

    @PreAuthorize("hasAuthority('SCOPE_write:documents')")
    public Document updateDocument(@P("document") Document document) { return documentRepository.save(document); }

    @PreAuthorize("isAuthenticated()")
    public List<Document> findMyDocuments(@AuthenticationPrincipal UserDetails user) {
        return documentRepository.findByOwner(user.getUsername());
    }

    @PreAuthorize("hasRole('ADMIN') or #document.owner == authentication.name")
    public Document getDocument(@P("documentId") Long documentId) {
        return documentRepository.findById(documentId)
            .orElseThrow(() -> new DocumentNotFoundException(documentId));
    }

    @PreAuthorize("#contact.userId == authentication.principal.id")
    public void updateContact(@P("contact") Contact contact) {
        contactRepository.save(contact);
    }
}
```

### @PostAuthorize

`@PostAuthorize` evaluates the expression AFTER the method executes. The expression has access to the return value via `returnObject`. This is useful for data-level security where authorization depends on the returned data.

Important: the method still executes even if the expression fails. The access control only prevents the return value from being sent to the caller. This means `@PostAuthorize` should not be used for expensive operations that you want to skip for unauthorized users.

```java
@Service
public class PatientService {

    @PostAuthorize("returnObject.doctor == authentication.name or hasRole('ADMIN')")
    public PatientRecord getPatientRecord(Long recordId) {
        return patientRecordRepository.findById(recordId)
            .orElseThrow(() -> new RecordNotFoundException(recordId));
    }

    @PostAuthorize("hasRole('ADMIN') or returnObject.visibleToAllPatients")
    public List<PatientRecord> getAllRecords() {
        return patientRecordRepository.findAll();
    }

    @PostAuthorize("returnObject.owner == authentication.name")
    public Document getDocument(Long documentId) {
        return documentRepository.findById(documentId)
            .orElseThrow(() -> new DocumentNotFoundException(documentId));
    }

    @PostFilter("hasRole('ADMIN') or filterObject.owner == authentication.name")
    public List<Document> searchDocuments(String query) {
        return documentRepository.search(query);
    }
}
```

### @PreFilter and @PostFilter

`@PreFilter` filters a collection parameter before the method executes. `@PostFilter` filters the returned collection. The expression is evaluated for each element, accessed via `filterObject`.

Warning: `@PostFilter` loads ALL records into memory before filtering. For large datasets, filter at the database level instead, and use `@PostFilter` only when database filtering isn't possible.

```java
@Service
public class BatchService {

    @PreFilter("hasRole('ADMIN') or filterObject.owner == authentication.name")
    public void saveDocuments(List<Document> documents) {
        documentRepository.saveAll(documents);
    }

    @PostFilter("hasRole('ADMIN') or filterObject.owner == authentication.name")
    public List<Document> getAllDocuments() {
        return documentRepository.findAll();
    }

    @PreFilter("filterObject.amount < 10000 or hasRole('MANAGER')")
    @PostFilter("filterObject.status != 'REJECTED' or hasRole('ADMIN')")
    public List<Transaction> processTransactions(List<Transaction> transactions) {
        return transactionService.process(transactions);
    }
}
```

## Custom Permission Evaluator

For complex domain-specific permissions (e.g., "can user X edit document Y?"), implement a `PermissionEvaluator`. This lets you use `hasPermission()` expressions in security annotations, keeping the business logic clean.

```java
@Component
public class DocumentPermissionEvaluator implements PermissionEvaluator {

    @Override
    public boolean hasPermission(Authentication authentication,
                                  Object targetDomainObject, Object permission) {
        if (targetDomainObject instanceof Document document) {
            return hasDocumentPermission(authentication, document, (String) permission);
        }
        return false;
    }

    @Override
    public boolean hasPermission(Authentication authentication,
                                  Serializable targetId, String targetType, Object permission) {
        if ("Document".equals(targetType)) {
            Document document = loadDocument((Long) targetId);
            return hasDocumentPermission(authentication, document, (String) permission);
        }
        return false;
    }

    private boolean hasDocumentPermission(Authentication auth, Document doc, String permission) {
        String username = auth.getName();
        boolean isAdmin = auth.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));

        return switch (permission) {
            case "READ" -> isAdmin || doc.isPublic() || doc.getOwner().equals(username);
            case "WRITE" -> isAdmin || doc.getOwner().equals(username);
            case "DELETE" -> isAdmin;
            case "SHARE" -> doc.getOwner().equals(username);
            default -> false;
        };
    }

    private Document loadDocument(Long id) {
        return new Document(id, "sample", "user1", true);
    }
}
```

### Using Custom Permission

```java
@Service
public class DocumentService {

    @PreAuthorize("hasPermission(#documentId, 'Document', 'READ')")
    public Document getDocument(Long documentId) {
        return documentRepository.findById(documentId).orElseThrow();
    }

    @PreAuthorize("hasPermission(#document, 'WRITE')")
    public Document updateDocument(Document document) {
        return documentRepository.save(document);
    }

    @PreAuthorize("hasPermission(#documentId, 'Document', 'DELETE')")
    public void deleteDocument(Long documentId) {
        documentRepository.deleteById(documentId);
    }
}
```

## Expression Utility Class

For complex logic that doesn't fit in a SpEL expression, create a utility bean and reference it in expressions with `@beanName.method()`.

```java
@Component("security")
public class SecurityUtils {

    public boolean isMemberOf(Long organizationId, Authentication auth) {
        if (auth.getPrincipal() instanceof UserDetails user) {
            return user.getOrganizations().contains(organizationId);
        }
        return false;
    }

    public boolean isAfterBusinessHours() {
        LocalTime now = LocalTime.now();
        return now.isAfter(LocalTime.of(18, 0)) || now.isBefore(LocalTime.of(9, 0));
    }

    public boolean isWeekend() {
        DayOfWeek day = LocalDate.now().getDayOfWeek();
        return day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY;
    }

    public boolean withinRateLimit(String action, Authentication auth, int limit) {
        return rateLimiter.tryConsume(auth.getName() + ":" + action, limit);
    }

    public boolean belongsToDepartment(String department, Authentication auth) {
        if (auth.getPrincipal() instanceof UserDetails user) {
            return department.equals(user.getDepartment());
        }
        return false;
    }
}
```

### Using Security Utils in Expressions

```java
@Service
public class PaymentService {

    @PreAuthorize("@security.isAfterBusinessHours() ? hasRole('MANAGER') : true")
    public void processPayment(Payment payment) { paymentProcessor.process(payment); }

    @PreAuthorize("@security.withinRateLimit('export', authentication, 10)")
    public List<DataPoint> exportData(DateRange range) { return dataService.getData(range); }

    @PreAuthorize("@security.isMemberOf(#orgId, authentication)")
    public void accessOrganizationData(@P("orgId") Long orgId) { }

    @PreAuthorize("@security.belongsToDepartment('ENGINEERING', authentication)")
    public void accessEngineeringResources() { }
}
```

## Composite Expressions

```java
@Service
public class SensitiveDataService {

    @PreAuthorize("isAuthenticated() and " +
                  "(hasRole('ADMIN') or " +
                  "(@security.isAfterBusinessHours() and hasRole('ON_CALL')))")
    public SensitiveData accessSensitiveData(Long dataId) {
        return dataRepository.findById(dataId).orElseThrow();
    }

    @PreAuthorize("hasRole('AUDITOR') or " +
                  "(hasRole('MANAGER') and @security.isMemberOf(#orgId, authentication))")
    public AuditLog getAuditLog(@P("orgId") Long orgId) { return auditService.getLog(orgId); }

    @PreAuthorize("(#action == 'READ' and hasRole('VIEWER')) or " +
                  "(#action == 'WRITE' and hasRole('EDITOR')) or " +
                  "(#action == 'DELETE' and hasRole('ADMIN'))")
    public void performAction(@P("action") String action, Long resourceId) {
        actionService.perform(action, resourceId);
    }
}
```

## Best Practices

1. **Use expression-based annotations** (@PreAuthorize) for fine-grained control
2. **Keep expressions simple** - extract complex logic into @security bean methods
3. **Use @PostAuthorize sparingly** - it still executes the method before checking
4. **Test security rules** thoroughly with @WithMockUser
5. **Fail closed** - default should be denied access
6. **Use method security as a second layer** behind web security
7. **Document permission requirements** in method Javadoc

## Common Mistakes

### Mistake 1: Incorrect Method Expression Syntax

```java
// Wrong: Missing 'hasRole' quotes
@PreAuthorize(hasRole('ADMIN')) // Compilation error

// Correct: Proper SpEL syntax
@PreAuthorize("hasRole('ADMIN')")
```

### Mistake 2: Using @Secured Without ROLE_ Prefix

```java
// Wrong: @Secured expects full role name
@Secured("ADMIN") // Won't match ROLE_ADMIN

// Correct: @Secured requires full authority name
@Secured("ROLE_ADMIN")
```

### Mistake 3: Performance Issues with @PostFilter

```java
// Wrong: @PostFilter loads all records before filtering
@PostFilter("hasPermission(filterObject, 'READ')")
public List<Document> getAllDocuments() {
    return documentRepository.findAll();
}

// Correct: Filter at database level
public List<Document> getAccessibleDocuments() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    return documentRepository.findByOwnerOrPublicDoc(auth.getName());
}
```

## Summary

Method-level security with @PreAuthorize, @PostAuthorize, and custom permission evaluators provides fine-grained access control in Spring applications. Use SpEL expressions for role checks, custom method references for complex logic, and always test security rules. Combine method security with web security for defense in depth.

## References

- [Spring Method Security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html)
- [Expression-Based Access Control](https://docs.spring.io/spring-security/reference/servlet/authorization/expression-based.html)
- [@PreAuthorize and @PostAuthorize](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html#oauth2resourceserver-method-security)
- [PermissionEvaluator Javadoc](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/access/PermissionEvaluator.html)

Happy Coding
