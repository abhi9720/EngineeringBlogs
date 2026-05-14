---
title: Permission Checking Strategies
description: >-
  Explore different permission evaluation patterns: method security, AOP, policy
  engines, and centralized authorization
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - authorization
  - permissions
  - spring-security
  - access-control
coverImage: /images/permission-checking-strategies.png
draft: false
order: 30
---
# Permission Checking Strategies

## Overview

Permission checking is the process of determining whether an authenticated user is allowed to perform a specific action on a specific resource. Different strategies exist along a spectrum from simple role checks to complex policy-based evaluations. This guide covers the major patterns, their trade-offs, and implementation in Spring Boot.

---

## Strategy 1: URL-Based Security (Filter Level)

The simplest strategy — define permissions at the URL pattern level in the security configuration. This approach is centralized, performant, and easy to audit. However, it cannot express instance-level permissions — you cannot say "user can only delete their own orders" at the URL level:

```java
@Configuration
@EnableWebSecurity
public class UrlSecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/orders/**").authenticated()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/orders").hasAuthority("ORDER_CREATE")
                .requestMatchers(HttpMethod.DELETE, "/api/orders/**").hasAuthority("ORDER_DELETE")
                .anyRequest().denyAll()
            );
        return http.build();
    }
}
```

**Pros**: Simple, centralized, performant
**Cons**: Cannot express instance-level permissions (e.g., "user can only delete their own orders")

---

## Strategy 2: Method Security Annotations

Method security moves authorization into the business layer, where instance-level checks are possible. Enable it with `@EnableMethodSecurity`:

```java
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {
    // No additional configuration needed
}
```

### @PreAuthorize with SpEL

Spring Expression Language (SpEL) in `@PreAuthorize` can reference method parameters, authentication objects, and bean methods. The `@P("order")` annotation binds the parameter for SpEL access. `@PostFilter` filters returned collections, and `@PostAuthorize` checks the return value:

```java
@Service
public class OrderService {

    @PreAuthorize("hasRole('ADMIN') or #order.customerId == authentication.principal.id")
    public Order updateOrder(@P("order") Order order) {
        return orderRepository.save(order);
    }

    @PreAuthorize("hasAuthority('ORDER_READ')")
    @PostFilter("filterObject.customerId == authentication.principal.id or hasRole('AUDITOR')")
    public List<Order> getAllOrders() {
        return orderRepository.findAll();
    }

    @PostAuthorize("returnObject.customerId == authentication.principal.id or hasRole('ADMIN')")
    public Order getOrder(Long id) {
        return orderRepository.findById(id)
            .orElseThrow(() -> new NotFoundException("Order not found"));
    }
}
```

### Custom Method Security Expression

For complex logic, create a custom security evaluator bean. The SpEL expression `@securityEvaluator.isOwnerOrAdmin(#id, authentication)` delegates to the bean method, keeping the annotation concise:

```java
@Component
public class CustomSecurityEvaluator {

    public boolean isOwnerOrAdmin(String resourceId, Authentication auth) {
        if (auth == null) return false;

        User user = (User) auth.getPrincipal();

        // Check admin role first (fast path)
        if (auth.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"))) {
            return true;
        }

        // Check resource ownership
        return resourceService.isOwner(resourceId, user.getId());
    }

    @PreAuthorize("@securityEvaluator.isOwnerOrAdmin(#id, authentication)")
    public void deleteResource(String id) {
        resourceService.delete(id);
    }
}
```

---

## Strategy 3: Permission Evaluator (ACL-Style)

Spring Security's `PermissionEvaluator` provides a structured approach for domain-object-level permissions. The evaluator below handles different resource types (`Document`, `Project`) and actions (`READ`, `WRITE`, `DELETE`) with type-specific logic:

```java
@Component
public class AclPermissionEvaluator implements PermissionEvaluator {

    private static final Logger log = LoggerFactory.getLogger(AclPermissionEvaluator.class);

    @Override
    public boolean hasPermission(Authentication auth, 
                                  Object target, Object permission) {
        if (auth == null || target == null) {
            return false;
        }

        User user = (User) auth.getPrincipal();

        if (target instanceof Document doc) {
            return evaluateDocumentPermission(user, doc, (String) permission);
        }

        if (target instanceof Project project) {
            return evaluateProjectPermission(user, project, (String) permission);
        }

        log.warn("Unsupported permission check for: {}", target.getClass());
        return false;
    }

    @Override
    public boolean hasPermission(Authentication auth,
                                  Serializable targetId,
                                  String targetType,
                                  Object permission) {
        // Load the domain object by type and ID
        Object target = loadDomainObject(targetType, (Long) targetId);
        if (target == null) return false;
        return hasPermission(auth, target, permission);
    }

    private boolean evaluateDocumentPermission(User user, Document doc, String action) {
        return switch (action) {
            case "READ" -> doc.isPublic() || doc.getOwnerId().equals(user.getId()) ||
                          isInAcl(doc.getId(), user.getId(), "READ");
            case "WRITE" -> doc.getOwnerId().equals(user.getId()) ||
                           isInAcl(doc.getId(), user.getId(), "WRITE");
            case "DELETE" -> doc.getOwnerId().equals(user.getId()) ||
                            hasRole(user, "ADMIN");
            default -> false;
        };
    }

    private boolean evaluateProjectPermission(User user, Project project, String action) {
        return switch (action) {
            case "READ" -> project.getTeamIds().contains(user.getTeamId()) ||
                          project.getOwnerId().equals(user.getId());
            case "ADMIN" -> project.getOwnerId().equals(user.getId());
            default -> false;
        };
    }

    private Object loadDomainObject(String type, Long id) {
        return switch (type) {
            case "Document" -> documentRepository.findById(id).orElse(null);
            case "Project" -> projectRepository.findById(id).orElse(null);
            default -> null;
        };
    }

    private boolean isInAcl(Long documentId, Long userId, String permission) {
        return aclRepository.existsByDocumentAndUserAndPermission(
            documentId, userId, permission
        );
    }

    private boolean hasRole(User user, String role) {
        return user.getRoles().stream()
            .anyMatch(r -> r.getName().equals(role));
    }
}
```

### Enabling in Security Config

Register the custom `PermissionEvaluator` with the method security expression handler:

```java
@Configuration
public class AclConfig {

    @Bean
    public MethodSecurityExpressionHandler expressionHandler(
            AclPermissionEvaluator permissionEvaluator) {
        DefaultMethodSecurityExpressionHandler handler =
            new DefaultMethodSecurityExpressionHandler();
        handler.setPermissionEvaluator(permissionEvaluator);
        return handler;
    }
}
```

### Usage

With the evaluator registered, `@PreAuthorize("hasPermission(#id, 'Document', 'READ')")` invokes the custom evaluation logic, loading the document by ID and checking READ access:

```java
@RestController
@RequestMapping("/documents")
public class DocumentController {

    @GetMapping("/{id}")
    @PreAuthorize("hasPermission(#id, 'Document', 'READ')")
    public Document getDocument(@PathVariable Long id) {
        return documentService.findById(id);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasPermission(#document, 'WRITE')")
    public Document updateDocument(@RequestBody Document document) {
        return documentService.save(document);
    }
}
```

---

## Strategy 4: AOP-Based Authorization

For complex cross-cutting permission logic that cannot be expressed through SpEL, use a custom annotation and AOP aspect. The `@RequiresPermission` annotation below carries the action, resource type, and a SpEL-like expression for extracting the resource ID from method parameters:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresPermission {
    String action();
    String resourceType();
    String resourceIdExpression() default "";
}

@Aspect
@Component
public class AuthorizationAspect {

    @Autowired
    private PermissionEvaluator permissionEvaluator;

    @Around("@annotation(requiresPermission)")
    public Object checkPermission(ProceedingJoinPoint pjp,
                                   RequiresPermission requiresPermission) throws Throwable {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();

        if (auth == null || !auth.isAuthenticated()) {
            throw new AccessDeniedException("Not authenticated");
        }

        // Evaluate the resource ID from the expression
        Object resourceId = evaluateExpression(
            requiresPermission.resourceIdExpression(), pjp
        );

        // Check permission
        boolean allowed = permissionEvaluator.hasPermission(
            auth,
            resourceId,
            requiresPermission.resourceType(),
            requiresPermission.action()
        );

        if (!allowed) {
            log.warn("Access denied: user={} action={} resourceType={} resourceId={}",
                auth.getName(), requiresPermission.action(),
                requiresPermission.resourceType(), resourceId);
            throw new AccessDeniedException("Access denied");
        }

        return pjp.proceed();
    }

    private Object evaluateExpression(String expression, 
                                       ProceedingJoinPoint pjp) {
        if (expression.isEmpty()) return null;

        // Simple expression evaluation
        // Supports: #paramName -> parameter value
        if (expression.startsWith("#")) {
            String paramName = expression.substring(1);
            Object[] args = pjp.getArgs();
            String[] paramNames = ((MethodSignature) pjp.getSignature())
                .getParameterNames();

            for (int i = 0; i < paramNames.length; i++) {
                if (paramNames[i].equals(paramName)) {
                    return args[i];
                }
            }
        }

        return null;
    }
}
```

### Usage

The annotation makes authorization declarative, keeping business logic clean:

```java
@Service
public class PaymentService {

    @RequiresPermission(action = "PROCESS_PAYMENT", 
                        resourceType = "Payment",
                        resourceIdExpression = "#paymentId")
    public Payment processPayment(Long paymentId, PaymentRequest request) {
        // Authorization handled by aspect
        return paymentRepository.findById(paymentId)
            .map(payment -> {
                payment.process(request);
                return paymentRepository.save(payment);
            })
            .orElseThrow(() -> new NotFoundException("Payment not found"));
    }
}
```

---

## Strategy 5: Policy-Based Authorization (Centralized)

For complex, multi-attribute decisions, use a centralized policy service. Policies are evaluated in order: an explicit deny overrides all allows, and the last matching allow wins. This pattern decouples authorization logic from application code and supports dynamic rule updates:

```java
@Component
public class PolicyAuthorizationService {

    private final List<PolicyRule> rules;

    @PostConstruct
    public void loadPolicies() {
        // Load from database, file, or configuration
        rules = policyRepository.findAll();
    }

    public AuthorizationResult authorize(AuthorizationContext context) {
        // Default deny
        AuthorizationDecision decision = AuthorizationDecision.DENY;
        String matchedRule = null;

        for (PolicyRule rule : rules) {
            if (rule.evaluate(context)) {
                if (rule.getEffect() == Effect.DENY) {
                    // Explicit deny overrides all allows
                    return AuthorizationResult.deny(
                        rule.getDescription(),
                        rule.getId()
                    );
                }
                // Last matching allow wins (or highest priority)
                if (decision != AuthorizationDecision.DENY || 
                    rule.getPriority() > 0) {
                    decision = AuthorizationDecision.ALLOW;
                    matchedRule = rule.getDescription();
                }
            }
        }

        return decision == AuthorizationDecision.ALLOW
            ? AuthorizationResult.allow(matchedRule)
            : AuthorizationResult.deny("No matching policy", null);
    }
}

@Data
public class AuthorizationContext {
    private String userId;
    private String action;
    private String resourceType;
    private String resourceId;
    private Map<String, Object> resourceAttributes;
    private Map<String, Object> environmentAttributes;
}

@Data
public class PolicyRule {
    private String id;
    private String description;
    private Effect effect;
    private int priority;
    private List<Condition> conditions;

    public boolean evaluate(AuthorizationContext context) {
        return conditions.stream().allMatch(c -> c.evaluate(context));
    }
}

public interface Condition {
    boolean evaluate(AuthorizationContext context);
}

@Component
public class AttributeCondition implements Condition {

    private String attributeName;
    private String operator;
    private Object expectedValue;

    @Override
    public boolean evaluate(AuthorizationContext context) {
        Object actualValue = context.getResourceAttributes().get(attributeName);
        if (actualValue == null) return false;

        return switch (operator) {
            case "EQUALS" -> actualValue.equals(expectedValue);
            case "IN" -> ((List<?>) expectedValue).contains(actualValue);
            case "GREATER_THAN" -> ((Number) actualValue).doubleValue() >
                                   ((Number) expectedValue).doubleValue();
            case "CONTAINS" -> actualValue.toString()
                .contains(expectedValue.toString());
            default -> false;
        };
    }
}
```

---

## Strategy Comparison

| Strategy | Complexity | Performance | Granularity | Maintainability |
|----------|-----------|-------------|-------------|-----------------|
| URL-based | Low | Fast | Low | Medium |
| Method annotations | Medium | Fast | Medium | High |
| Permission evaluator | Medium | Medium | High | Medium |
| AOP-based | High | Medium | High | Low |
| Policy engine | Very high | Slow | Very high | High |

---

## Common Mistakes

### Mistake 1: Scattered Permission Logic

Repeating the same authorization checks across multiple services leads to inconsistencies and maintenance burden:

```java
// WRONG: Permission checks scattered across services
@Service
public class OrderService {
    public void deleteOrder(Long id) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        // Mixing authz with business logic
        if (!auth.getAuthorities().contains("ORDER_DELETE")) {
            throw new AccessDeniedException("No permission");
        }
        orderRepository.deleteById(id);
    }
}

@Service
public class InvoiceService {
    public void deleteInvoice(Long id) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        // Same check repeated
        if (!auth.getAuthorities().contains("INVOICE_DELETE")) {
            throw new AccessDeniedException("No permission");
        }
        invoiceRepository.deleteById(id);
    }
}

// CORRECT: Centralize with annotations or policy engine
@PreAuthorize("hasAuthority('ORDER_DELETE')")
public void deleteOrder(Long id) { ... }

@PreAuthorize("hasAuthority('INVOICE_DELETE')")
public void deleteInvoice(Long id) { ... }
```

### Mistake 2: Mixing Authentication and Authorization

Authentication (who you are) and authorization (what you can do) are separate concerns. The security filter chain handles authentication; method annotations handle authorization:

```java
// WRONG: Combining authn and authz in same check
if (auth != null && auth.isAuthenticated() && 
    auth.getAuthorities().contains("ROLE_ADMIN")) {
    // Authentication check is redundant here
}

// CORRECT: Separate concerns
// Authentication handled by SecurityFilterChain
// Authorization handled by @PreAuthorize or method security
```

### Mistake 3: Caching Permissions Incorrectly

Cached permissions must be invalidated when the underlying permission data changes. Use `@CacheEvict` to clear the relevant cache entries:

```java
// WRONG: Caching without invalidation
@Cacheable("permissions")
public boolean hasPermission(Long userId, String action) {
    // If permissions change, this returns stale data
    return permissionRepository.checkPermission(userId, action);
}

// CORRECT: Cache with appropriate invalidation
@Cacheable(value = "permissions", key = "#userId + ':' + #action")
public boolean hasPermission(Long userId, String action) {
    return permissionRepository.checkPermission(userId, action);
}

// Invalidate when permissions change
@CacheEvict(value = "permissions", key = "#userId + ':' + #action")
public void updatePermission(Long userId, String action, boolean granted) {
    permissionRepository.updatePermission(userId, action, granted);
}
```

---

## Summary

Choose the permission checking strategy that matches your needs: URL-based for simple apps, method security for most Spring Boot applications, permission evaluators for ACL-style requirements, and policy engines for complex, multi-attribute authorization. Centralize permission logic, avoid scattering checks across services, and ensure proper cache invalidation for permission data.

---

## References

- [Spring Security Authorization Architecture](https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html)
- [Spring Method Security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html)
- [NIST ABAC SP 800-162](https://csrc.nist.gov/publications/detail/sp/800-162/final)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

Happy Coding
