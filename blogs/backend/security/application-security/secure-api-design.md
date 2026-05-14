---
title: "Secure API Design"
description: "Principles and patterns for designing secure REST APIs: authentication, authorization, rate limiting, input validation, and threat modeling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - api-security
  - rest
  - design-patterns
  - spring-boot
coverImage: "/images/secure-api-design.png"
draft: false
---

# Secure API Design Principles

## Overview

API security is not a single feature you add at the end—it must be designed into the architecture from the start. This guide covers threat modeling, authentication placement, input validation strategies, rate limiting patterns, and secure response handling for REST APIs.

---

## Principle 1: Authentication at the Gateway

Authentication should happen as early as possible in the request pipeline:

```java
@Configuration
@EnableWebSecurity
public class ApiSecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/**")
            .addFilterBefore(apiKeyFilter(), UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtFilter(), ApiKeyFilter.class)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/v1/**").authenticated()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().denyAll()
            )
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .csrf(csrf -> csrf.disable());

        return http.build();
    }
}
```

---

## Principle 2: Validate Everything

### Input Validation at the Boundary

```java
@RestController
@RequestMapping("/api/v1/users")
@Validated
public class UserController {

    @PostMapping
    public ResponseEntity<UserResponse> createUser(
            @Valid @RequestBody CreateUserRequest request) {

        User user = userService.create(request);
        return ResponseEntity.status(201).body(UserResponse.from(user));
    }
}

@Data
public class CreateUserRequest {

    @NotBlank(message = "Username is required")
    @Size(min = 3, max = 50, message = "Username must be 3-50 characters")
    @Pattern(regexp = "^[a-zA-Z0-9_]+$", message = "Username contains invalid characters")
    private String username;

    @NotBlank
    @Email(message = "Invalid email format")
    @Size(max = 255)
    private String email;

    @NotBlank
    @Size(min = 8, max = 128)
    @Pattern(
        regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$",
        message = "Password must contain uppercase, lowercase, digit, and special character"
    )
    private String password;

    @NotNull
    private Role role;
}
```

### Custom Validation

```java
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = AllowedValuesValidator.class)
public @interface AllowedValues {
    String[] values();
    String message() default "Value must be one of: {values}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class AllowedValuesValidator 
        implements ConstraintValidator<AllowedValues, String> {

    private Set<String> allowedValues;

    @Override
    public void initialize(AllowedValues constraint) {
        allowedValues = new HashSet<>(Arrays.asList(constraint.values()));
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return allowedValues.contains(value);
    }
}
```

---

## Principle 3: Rate Limiting

### Token Bucket Algorithm

```java
@Component
public class RateLimitingInterceptor implements HandlerInterceptor {

    private final Cache<String, TokenBucket> buckets;

    public RateLimitingInterceptor() {
        this.buckets = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .build();
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                              HttpServletResponse response,
                              Object handler) throws Exception {
        String clientId = extractClientId(request);

        TokenBucket bucket = buckets.get(clientId, k -> 
            new TokenBucket(100, 10)  // 100 requests, refill 10 per second
        );

        if (!bucket.tryConsume()) {
            response.setStatus(429);
            response.setContentType("application/json");
            response.getWriter().write(
                "{\"error\":\"Too Many Requests\",\"retryAfter\":60}"
            );
            return false;
        }

        // Add rate limit headers
        response.setHeader("X-RateLimit-Limit", String.valueOf(100));
        response.setHeader("X-RateLimit-Remaining", 
            String.valueOf(bucket.getAvailableTokens()));
        response.setHeader("X-RateLimit-Reset", 
            String.valueOf(bucket.getResetTimeSeconds()));

        return true;
    }

    private String extractClientId(HttpServletRequest request) {
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null) return apiKey;

        String token = extractJwt(request);
        if (token != null) return extractUserFromJwt(token);

        return request.getRemoteAddr();
    }
}

public class TokenBucket {
    private final int maxTokens;
    private final int refillRate;
    private int availableTokens;
    private long lastRefillTime;

    public TokenBucket(int maxTokens, int refillRate) {
        this.maxTokens = maxTokens;
        this.refillRate = refillRate;
        this.availableTokens = maxTokens;
        this.lastRefillTime = System.currentTimeMillis();
    }

    public synchronized boolean tryConsume() {
        refill();
        if (availableTokens > 0) {
            availableTokens--;
            return true;
        }
        return false;
    }

    private void refill() {
        long now = System.currentTimeMillis();
        long elapsed = now - lastRefillTime;
        int tokensToAdd = (int) (elapsed / 1000 * refillRate);
        if (tokensToAdd > 0) {
            availableTokens = Math.min(maxTokens, availableTokens + tokensToAdd);
            lastRefillTime = now;
        }
    }

    public int getAvailableTokens() { return availableTokens; }
    public long getResetTimeSeconds() {
        long tokensNeeded = maxTokens - availableTokens;
        return tokensNeeded > 0 ? tokensNeeded / refillRate : 0;
    }
}
```

---

## Principle 4: Secure Response Handling

### Structured Error Responses

```java
@RestControllerAdvice
public class SecureExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleValidationError(MethodArgumentNotValidException ex) {
        List<FieldError> fieldErrors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .map(fe -> new FieldError(fe.getField(), fe.getDefaultMessage()))
            .toList();

        return ErrorResponse.builder()
            .status(400)
            .code("VALIDATION_ERROR")
            .message("Request validation failed")
            .details(fieldErrors)
            .build();
        // Never expose stack traces or internal details
    }

    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ErrorResponse handleAccessDenied(AccessDeniedException ex) {
        return ErrorResponse.builder()
            .status(403)
            .code("ACCESS_DENIED")
            .message("Insufficient permissions")
            .build();
        // Generic message - don't reveal what permission was missing
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleUnexpected(Exception ex) {
        log.error("Unexpected error", ex);  // Log full details internally
        return ErrorResponse.builder()
            .status(500)
            .code("INTERNAL_ERROR")
            .message("An unexpected error occurred")
            .build();
        // Never expose the exception message or stack trace to the client
    }
}

@Data
@Builder
public class ErrorResponse {
    private final int status;
    private final String code;
    private final String message;
    private final List<FieldError> details;
}
```

---

## Principle 5: Minimal Data Exposure

### Use DTOs, Never Expose Entities

```java
// INSECURE: Exposing JPA entity directly
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) {
    return userRepository.findById(id).orElseThrow();
    // Exposes: passwordHash, internalId, createdAt, all relations...
}

// SECURE: Use DTO
@GetMapping("/users/{id}")
public UserResponse getUser(@PathVariable Long id) {
    User user = userRepository.findById(id).orElseThrow();
    return UserResponse.builder()
        .id(user.getId())
        .username(user.getUsername())
        .email(user.getEmail())
        .role(user.getRole())
        .build();
    // Only exposes what the client needs
}

@Data
@Builder
public class UserResponse {
    private Long id;
    private String username;
    private String email;
    private String role;
}
```

---

## Principle 6: HATEOAS and Secure Links

```java
@GetMapping("/orders/{id}")
public EntityModel<OrderResponse> getOrder(@PathVariable Long id) {
    Order order = orderService.findById(id);
    OrderResponse response = OrderResponse.from(order);

    return EntityModel.of(response,
        linkTo(methodOn(OrderController.class).getOrder(id)).withSelfRel(),
        linkTo(methodOn(OrderController.class).getOrderItems(id)).withRel("items"),
        // Only include links the user is authorized to use
        conditionalLink(
            order.getStatus() == OrderStatus.DRAFT,
            linkTo(methodOn(OrderController.class).submitOrder(id)).withRel("submit")
        )
    );
}

private Link conditionalLink(boolean condition, Link link) {
    return condition ? link : null;
}
```

---

## Principle 7: Audit Logging

```java
@Aspect
@Component
public class AuditAspect {

    @Autowired
    private AuditLogger auditLogger;

    @Around("@annotation(auditable)")
    public Object audit(ProceedingJoinPoint pjp, Auditable auditable) throws Throwable {
        String action = auditable.action();
        String resourceType = auditable.resourceType();
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();

        String userId = auth != null ? auth.getName() : "anonymous";
        String resourceId = extractResourceId(pjp, auditable);

        try {
            Object result = pjp.proceed();
            auditLogger.logSuccess(userId, action, resourceType, resourceId);
            return result;
        } catch (Exception e) {
            auditLogger.logFailure(userId, action, resourceType, resourceId, e.getMessage());
            throw e;
        }
    }
}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Auditable {
    String action();
    String resourceType();
    String resourceIdExpression() default "";
}
```

---

## Common Mistakes

### Mistake 1: Verbose Error Messages

```java
// WRONG: Exposing too much information
catch (SQLException e) {
    return ResponseEntity.badRequest()
        .body("Database error: " + e.getMessage());
    // Reveals table structure, column names, database type
}

// CORRECT: Generic error messages
catch (DataAccessException e) {
    log.error("Database error", e);  // Full details in server logs
    return ResponseEntity.status(500)
        .body(new ErrorResponse("INTERNAL_ERROR", "An error occurred"));
}
```

### Mistake 2: Not Validating Content-Type

```java
// WRONG: Accepting any content type
@PostMapping("/import")
public void importData(HttpServletRequest request,
                       @RequestBody String body) {
    // Could receive XML, YAML, or binary data
    processData(body);
}

// CORRECT: Enforce content type
@PostMapping(value = "/import", 
             consumes = MediaType.APPLICATION_JSON_VALUE)
public void importData(@Valid @RequestBody ImportRequest request) {
    processData(request);
}
```

---

## Summary

Secure API design requires thinking about security at every layer: authenticate early at the gateway, validate all input at the boundary, rate limit to prevent abuse, expose minimal data through DTOs, use structured error responses, and maintain audit logs. Never expose internal implementation details, stack traces, or sensitive data in API responses.

---

## References

- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [REST API Security Essentials](https://www.ietf.org/archive/id/draft-inadarei-api-security-00.html)
- [Spring Security Documentation](https://docs.spring.io/spring-security/reference/)
- [NIST API Security Guidelines](https://csrc.nist.gov/glossary/term/api_security)

Happy Coding