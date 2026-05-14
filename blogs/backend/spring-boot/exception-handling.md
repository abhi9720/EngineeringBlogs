---
title: "Exception Handling"
description: "Master exception handling in Spring Boot with global error handling, custom exceptions, and production-ready patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - exception-handling
  - error-handling
  - spring-mvc
coverImage: "/images/exception-handling.png"
draft: false
---

# Exception Handling: Production Patterns for Spring Boot

## Overview

Exception handling is one of the most critical aspects of building robust applications. In production systems, how you handle exceptions determines whether users see helpful error messages or confusing stack traces, whether operators can diagnose issues or remain in the dark, and whether security vulnerabilities are exposed or properly hidden.

Spring Boot provides powerful mechanisms for centralized exception handling, but using them incorrectly leads to inconsistent error responses and maintenance nightmares.

---

## How Spring Exception Handling Works Internally

### The Exception Resolution Chain

When an exception is thrown in a controller, Spring goes through a resolution chain:

```java
// Simplified exception handling flow
public class DispatcherServlet {
    
    protected void doDispatch(HttpServletRequest request, 
                              HttpServletResponse response) throws Exception {
        
        try {
            // Process request through handler mappings and handlers
            HandlerExecutionChain chain = getHandler(request);
            HandlerAdapter handler = getHandlerAdapter(handler);
            
            ModelAndView mv = handler.handle(request, response, handler);
            
        } catch (Exception ex) {
            // Exception resolution begins here
            processHandlerException(request, response, handler, ex);
        }
    }
    
    protected ModelAndView processHandlerException(
            HttpServletRequest request, 
            HttpServletResponse response,
            Handler handler, 
            Exception ex) throws Exception {
        
        // 1. Check for @ExceptionHandler methods in controller
        ModelAndView result = resolveException(handler, request, response, ex);
        
        // 2. If not found, check @ExceptionHandler in @ControllerAdvice
        if (result == null) {
            result = resolveException(null, request, response, ex);
        }
        
        // 3. If still not found, use default error view
        return result;
    }
}

// The actual resolver chain (simplified)
public class ExceptionHandlerExceptionResolver {
    
    public ModelAndView resolveException(HttpServletRequest request,
                                         HttpServletResponse response,
                                         Object handler,
                                         Exception ex) {
        
        // Find matching @ExceptionHandler method
        Method method = findExceptionHandler(ex);
        
        if (method != null) {
            return invokeExceptionHandler(method, handler, request, response, ex);
        }
        
        return null;
    }
}
```

### @ControllerAdvice Architecture

The `@ControllerAdvice` annotation creates a global exception handler:

```java
// Basic structure
@ControllerAdvice
public class GlobalExceptionHandler {
    
    // Handles specific exception types
    @ExceptionHandler(NullPointerException.class)
    public ResponseEntity<?> handleNPE(NullPointerException ex) {
        return ResponseEntity.badRequest().body("Something went wrong");
    }
}

// What Spring creates internally
// GlobalExceptionHandler is wrapped in a proxy that:
// 1. Scans all @ExceptionHandler methods
// 2. Builds a mapping from exception class to handler method
// 3. Caches this mapping for performance
// 4. Routes exceptions to appropriate handlers

// Method resolution order:
// 1. Exact type match
// 2. Superclass match
// 3. Check for generic parameter types
```

---

## Real-World Backend Use Cases

### Case 1: Comprehensive Global Exception Handler

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    
    // Handle validation errors from @Valid
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleValidationException(MethodArgumentNotValidException ex) {
        
        List<FieldError> fieldErrors = ex.getBindingResult().getFieldErrors();
        
        List<ValidationError> errors = fieldErrors.stream()
            .map(error -> ValidationError.builder()
                .field(error.getField())
                .message(error.getDefaultMessage())
                .rejectedValue(error.getRejectedValue())
                .build())
            .collect(Collectors.toList());
        
        return ErrorResponse.builder()
            .code("VALIDATION_ERROR")
            .message("Validation failed")
            .errors(errors)
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle constraint violations
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleConstraintViolation(ConstraintViolationException ex) {
        
        List<ValidationError> errors = ex.getConstraintViolations().stream()
            .map(violation -> ValidationError.builder()
                .field(extractFieldName(violation.getPropertyPath().toString()))
                .message(violation.getMessage())
                .rejectedValue(violation.getInvalidValue())
                .build())
            .collect(Collectors.toList());
        
        return ErrorResponse.builder()
            .code("VALIDATION_ERROR")
            .message("Constraint validation failed")
            .errors(errors)
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle not found exceptions
    @ExceptionHandler(EntityNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleNotFound(EntityNotFoundException ex) {
        
        return ErrorResponse.builder()
            .code("NOT_FOUND")
            .message(ex.getMessage())
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle business rule violations
    @ExceptionHandler(BusinessException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleBusinessException(BusinessException ex) {
        
        return ErrorResponse.builder()
            .code(ex.getCode())
            .message(ex.getMessage())
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle authentication failures
    @ExceptionHandler({AuthenticationException.class, InvalidTokenException.class})
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ErrorResponse handleAuthenticationException(Exception ex) {
        
        return ErrorResponse.builder()
            .code("UNAUTHORIZED")
            .message("Authentication required")
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle authorization failures
    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ErrorResponse handleAccessDenied(AccessDeniedException ex) {
        
        return ErrorResponse.builder()
            .code("FORBIDDEN")
            .message("Access denied")
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle database constraint violations
    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public ErrorResponse handleDataIntegrityViolation(DataIntegrityViolationException ex) {
        
        String message = "Data integrity violation";
        
        // Extract useful information from the exception
        if (ex.getCause() != null && ex.getCause().getMessage() != null) {
            if (ex.getCause().getMessage().contains("unique")) {
                message = "A duplicate entry exists";
            } else if (ex.getCause().getMessage().contains("foreign key")) {
                message = "Referenced resource does not exist";
            }
        }
        
        return ErrorResponse.builder()
            .code("DATA_INTEGRITY_VIOLATION")
            .message(message)
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle external service failures
    @ExceptionHandler({ExternalServiceException.class, FeignException.class})
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public ErrorResponse handleExternalServiceException(Exception ex) {
        
        log.error("External service error: {}", ex.getMessage(), ex);
        
        return ErrorResponse.builder()
            .code("SERVICE_UNAVAILABLE")
            .message("External service is temporarily unavailable")
            .timestamp(Instant.now())
            .build();
    }
    
    // Handle unexpected exceptions - don't expose internals
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleGenericException(Exception ex) {
        
        // Log full details for debugging
        log.error("Unexpected error occurred: ", ex);
        
        // Return generic message to client
        return ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("An unexpected error occurred. Please try again later.")
            .timestamp(Instant.now())
            .build();
    }
}

// Error response DTOs
@Data
@Builder
public class ErrorResponse {
    
    private String code;
    private String message;
    private List<ValidationError> errors;
    private Instant timestamp;
    private String traceId;
    
    public static ErrorResponseBuilder builder() {
        ErrorResponseBuilder builder = new ErrorResponseBuilder();
        // Add trace ID for debugging
        builder.traceId(UUID.randomUUID().toString());
        return builder;
    }
}

@Data
@Builder
class ValidationError {
    private String field;
    private String message;
    private Object rejectedValue;
}

// Custom exception classes
public class EntityNotFoundException extends RuntimeException {
    
    public EntityNotFoundException(String message) {
        super(message);
    }
}

public class BusinessException extends RuntimeException {
    
    private final String code;
    
    public BusinessException(String code, String message) {
        super(message);
        this.code = code;
    }
    
    public String getCode() {
        return code;
    }
}

public class ExternalServiceException extends RuntimeException {
    
    private final String serviceName;
    
    public ExternalServiceException(String serviceName, String message, Throwable cause) {
        super(message, cause);
        this.serviceName = serviceName;
    }
}
```

### Case 2: Handling Reactive Exceptions

```java
// For WebFlux applications
@ControllerAdvice
public class WebFluxExceptionHandler {
    
    @ExceptionHandler(WebExchangeBindException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Mono<ErrorResponse> handleWebExchangeBindException(WebExchangeBindException ex) {
        
        List<ValidationError> errors = ex.getFieldErrors().stream()
            .map(error -> ValidationError.builder()
                .field(error.getField())
                .message(error.getDefaultMessage())
                .build())
            .collect(Collectors.toList());
        
        return Mono.just(ErrorResponse.builder()
            .code("VALIDATION_ERROR")
            .message("Validation failed")
            .errors(errors)
            .timestamp(Instant.now())
            .build());
    }
    
    // Handle IllegalArgumentException in reactive context
    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Mono<ErrorResponse> handleIllegalArgument(IllegalArgumentException ex) {
        
        return Mono.just(ErrorResponse.builder()
            .code("BAD_REQUEST")
            .message(ex.getMessage())
            .timestamp(Instant.now())
            .build());
    }
}
```

### Case 3: Business Exception with Localization

```java
// Exception with localized messages
public class LocalizedBusinessException extends RuntimeException {
    
    private final String errorCode;
    private final Object[] args;
    private final String locale;
    
    public LocalizedBusinessException(String errorCode, Object[] args, String locale) {
        super(errorCode);
        this.errorCode = errorCode;
        this.args = args;
        this.locale = locale;
    }
    
    public String getLocalizedMessage(MessageSource messageSource) {
        return messageSource.getMessage(errorCode, args, new Locale(locale));
    }
}

@RestControllerAdvice
public class LocalizedExceptionHandler {
    
    @Autowired
    private MessageSource messageSource;
    
    @ExceptionHandler(LocalizedBusinessException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleLocalizedException(LocalizedBusinessException ex) {
        
        String localizedMessage = ex.getLocalizedMessage(messageSource);
        
        return ErrorResponse.builder()
            .code(ex.getErrorCode())
            .message(localizedMessage)
            .timestamp(Instant.now())
            .build();
    }
}
```

---

## Exception Handling Patterns

### Pattern 1: Result Wrapper

```java
// Wrapper for consistent error responses across all operations
@Data
@Builder
public class Result<T> {
    
    private boolean success;
    private T data;
    private ErrorInfo error;
    
    public static <T> Result<T> success(T data) {
        return Result.<T>builder()
            .success(true)
            .data(data)
            .build();
    }
    
    public static <T> Result<T> error(ErrorInfo error) {
        return Result.<T>builder()
            .success(false)
            .error(error)
            .build();
    }
    
    public static <T> Result<T> error(String code, String message) {
        return Result.<T>builder()
            .success(false)
            .error(ErrorInfo.builder()
                .code(code)
                .message(message)
                .timestamp(Instant.now())
                .build())
            .build();
    }
}

@Data
@Builder
class ErrorInfo {
    private String code;
    private String message;
    private String traceId;
    private Instant timestamp;
}

// Usage in service
@Service
public class ProductService {
    
    public Result<Product> getProduct(Long id) {
        try {
            Product product = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product not found"));
            return Result.success(product);
            
        } catch (EntityNotFoundException e) {
            return Result.error("NOT_FOUND", e.getMessage());
        }
    }
}

@RestController
public class ProductController {
    
    @GetMapping("/products/{id}")
    public ResponseEntity<Result<Product>> getProduct(@PathVariable Long id) {
        Result<Product> result = productService.getProduct(id);
        
        if (result.isSuccess()) {
            return ResponseEntity.ok(result);
        } else {
            return ResponseEntity.notFound().build();
        }
    }
}
```

### Pattern 2: Exception Translation

```java
// Repository exception translation
@Repository
public class UserRepositoryImpl implements UserRepositoryExtension {
    
    @PersistenceContext
    private EntityManager entityManager;
    
    @Override
    public User saveWithTranslation(User user) {
        try {
            return entityManager.merge(user);
        } catch (EntityExistsException e) {
            throw new DuplicateEntityException("User already exists", e);
        } catch (ConstraintViolationException e) {
            throw new ValidationException("Invalid user data", e);
        } catch (PersistenceException e) {
            if (e.getCause() instanceof ConstraintViolationException) {
                throw new ValidationException("Invalid user data", e.getCause());
            }
            throw new DataAccessException("Database error", e);
        }
    }
}

// Controller using exception translation
@RestController
public class UserController {
    
    @Autowired
    private UserService userService;
    
    @PostMapping("/users")
    public ResponseEntity<?> createUser(@Valid @RequestBody CreateUserRequest request) {
        try {
            User user = userService.create(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(user);
            
        } catch (DuplicateEntityException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.builder()
                    .code("DUPLICATE_ENTITY")
                    .message(e.getMessage())
                    .timestamp(Instant.now())
                    .build());
            
        } catch (ValidationException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.builder()
                    .code("VALIDATION_ERROR")
                    .message(e.getMessage())
                    .timestamp(Instant.now())
                    .build());
        }
    }
}
```

---

## Production Considerations

### 1. Trace IDs for Error Correlation

```java
// MDC setup for trace IDs
@Component
public class TraceIdFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) {
        
        String traceId = request.getHeader("X-Trace-Id");
        if (traceId == null || traceId.isEmpty()) {
            traceId = UUID.randomUUID().toString();
        }
        
        MDC.put("traceId", traceId);
        response.setHeader("X-Trace-Id", traceId);
        
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("traceId");
        }
    }
}

// Include trace ID in error responses
@RestControllerAdvice
public class TraceIdExceptionHandler {
    
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleException(Exception ex) {
        
        String traceId = MDC.get("traceId");
        
        log.error("Error processing request", ex);
        
        return ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("An error occurred")
            .traceId(traceId)
            .timestamp(Instant.now())
            .build();
    }
}

// In logback.xml, include traceId in all logs
<pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} - [%X{traceId}] - %msg%n</pattern>
```

### 2. Logging Strategy

```java
@RestControllerAdvice
public class LoggingExceptionHandler {
    
    private static final Logger log = LoggerFactory.getLogger(LoggingExceptionHandler.class);
    
    // Log warning for expected exceptions
    @ExceptionHandler(EntityNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleNotFound(EntityNotFoundException ex) {
        
        log.warn("Entity not found: {}", ex.getMessage());
        
        return ErrorResponse.builder()
            .code("NOT_FOUND")
            .message(ex.getMessage())
            .timestamp(Instant.now())
            .build();
    }
    
    // Log error with full stack trace for unexpected exceptions
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleException(Exception ex) {
        
        log.error("Unexpected exception occurred: ", ex);
        
        return ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("An unexpected error occurred")
            .timestamp(Instant.now())
            .build();
    }
    
    // Security-related logging
    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ErrorResponse handleAccessDenied(AccessDeniedException ex) {
        
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        
        log.warn("Access denied for user: {}, path: {}", 
            auth != null ? auth.getName() : "anonymous",
            org.springframework.security.web.util.WebUtils
                .getCurrentRequestUrl(org.springframework.web.context.request.RequestContextHolder
                    .getRequestAttributes().getRequest()));
        
        return ErrorResponse.builder()
            .code("FORBIDDEN")
            .message("Access denied")
            .timestamp(Instant.now())
            .build();
    }
}
```

### 3. Metrics and Monitoring

```java
@Component
public class ExceptionMetrics {
    
    private final Map<String, AtomicLong> errorCounts = new ConcurrentHashMap<>();
    
    @Autowired
    private MeterRegistry meterRegistry;
    
    @PostConstruct
    public void init() {
        // Create gauge for each exception type
        meterRegistry.gauge("exception.count", errorCounts);
    }
    
    public void recordException(String type) {
        errorCounts.computeIfAbsent(type, k -> {
            AtomicLong counter = new AtomicLong(0);
            meterRegistry.counter("exception", "type", type).increment();
            return counter;
        }).increment();
    }
}

@RestControllerAdvice
public class MetricsExceptionHandler {
    
    @Autowired
    private ExceptionMetrics exceptionMetrics;
    
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleException(Exception ex) {
        
        exceptionMetrics.recordException(ex.getClass().getSimpleName());
        
        return ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("An error occurred")
            .timestamp(Instant.now())
            .build();
    }
}
```

---

## Common Mistakes

### Mistake 1: Exposing Stack Traces to Clients

```java
// WRONG: Exposing internal details
@RestControllerAdvice
public class BadExceptionHandler {
    
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Map<String, Object> handleException(Exception ex) {
        
        Map<String, Object> response = new HashMap<>();
        response.put("message", ex.getMessage());  // Contains stack trace!
        response.put("stackTrace", ex.getStackTrace());  // NEVER do this!
        
        return response;
    }
}

// CORRECT: Generic messages
@RestControllerAdvice
public class GoodExceptionHandler {
    
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ErrorResponse handleException(Exception ex) {
        
        log.error("Unexpected error", ex);  // Log full details server-side
        
        return ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("An unexpected error occurred. Please try again later.")
            .timestamp(Instant.now())
            .build();
    }
}
```

### Mistake 2: Not Handling Specific Exceptions

```java
// WRONG: Catch-all without handling specifics
@RestControllerAdvice
public class BadHandler {
    
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleAll(Exception ex) {
        return ResponseEntity.status(500).body("Error");
    }
}

// CORRECT: Handle specific exceptions
@RestControllerAdvice
public class GoodHandler {
    
    // Handle validation
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<?> handleValidation(MethodArgumentNotValidException ex) { ... }
    
    // Handle not found
    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<?> handleNotFound(EntityNotFoundException ex) { ... }
    
    // Handle authentication
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<?> handleAuth(AuthenticationException ex) { ... }
    
    // Generic fallback
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGeneral(Exception ex) { ... }
}
```

### Mistake 3: Swallowing Exceptions

```java
// WRONG: Catching and not re-throwing or handling
@Service
public class BrokenService {
    
    public void processData(Long id) {
        try {
            doProcess(id);
        } catch (Exception e) {
            // Exception swallowed! No logging, no handling!
            log.debug("Error occurred");  // Wrong level, not logged properly
        }
    }
}

// CORRECT: Proper exception handling
@Service
public class CorrectService {
    
    private static final Logger log = LoggerFactory.getLogger(CorrectService.class);
    
    public void processData(Long id) {
        try {
            doProcess(id);
        } catch (SpecificException e) {
            // Handle specific exception
            throw new BusinessException("PROCESS_FAILED", "Processing failed: " + e.getMessage());
        } catch (Exception e) {
            // Log unexpected exceptions
            log.error("Unexpected error processing data for id: {}", id, e);
            throw new RuntimeException("Internal error", e);
        }
    }
}
```

### Mistake 4: Inconsistent Error Responses

```java
// WRONG: Different error formats
@RestController
public class InconsistentController {
    
    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        return userRepository.findById(id).orElse(null);  // Returns null - inconsistent!
    }
    
    @PostMapping("/users")
    public Map<String, Object> createUser(@RequestBody User user) {
        return Map.of("status", "created", "id", user.getId());  // Different format!
    }
}

// CORRECT: Consistent error format
@RestController
public class ConsistentController {
    
    @GetMapping("/users/{id}")
    public ResponseEntity<?> getUser(@PathVariable Long id) {
        return userRepository.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
    
    @PostMapping("/users")
    public ResponseEntity<?> createUser(@Valid @RequestBody CreateUserRequest request) {
        User created = userService.create(request);
        
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ApiResponse.success(created));
    }
}
```

### Mistake 5: Not Setting Appropriate Status Codes

```java
// WRONG: Using wrong status codes
@RestController
public class BadController {
    
    @ExceptionHandler(EntityNotFoundException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)  // Wrong! Not found should be 404
    public ErrorResponse handleNotFound(EntityNotFoundException ex) {
        return ErrorResponse.builder().message(ex.getMessage()).build();
    }
    
    @ExceptionHandler(ValidationException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)  // Wrong! Validation is 400
    public ErrorResponse handleValidation(ValidationException ex) {
        return ErrorResponse.builder().message(ex.getMessage()).build();
    }
}

// CORRECT: Proper status codes
@RestController
public class GoodController {
    
    @ExceptionHandler(EntityNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)  // 404
    public ErrorResponse handleNotFound(EntityNotFoundException ex) {
        return ErrorResponse.builder()
            .code("NOT_FOUND")
            .message(ex.getMessage())
            .build();
    }
    
    @ExceptionHandler(ValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)  // 400
    public ErrorResponse handleValidation(ValidationException ex) {
        return ErrorResponse.builder()
            .code("VALIDATION_ERROR")
            .message(ex.getMessage())
            .build();
    }
    
    @ExceptionHandler(DuplicateException.class)
    @ResponseStatus(HttpStatus.CONFLICT)  // 409
    public ErrorResponse handleDuplicate(DuplicateException ex) {
        return ErrorResponse.builder()
            .code("CONFLICT")
            .message(ex.getMessage())
            .build();
    }
}
```

---

## Summary

Exception handling in production systems requires:

1. **Global handling**: Use @ControllerAdvice for centralized management
2. **Specific handlers**: Handle specific exceptions before generic ones
3. **Security**: Never expose stack traces or internal details to clients
4. **Consistency**: Return the same error format across all endpoints
5. **Logging**: Log errors at appropriate levels with trace IDs
6. **Metrics**: Track exception types for monitoring and alerting

Good exception handling is invisible when everything works and invaluable when things go wrong.

---

## References

- [Spring MVC Exception Handling](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-exceptionhandlers)
- [Spring Boot Error Handling](https://docs.spring.io/spring-boot/docs/current/reference/html/web.html#web.servlet.spring-mvc.error-handling)
- [REST API Error Handling Best Practices](https://restfulapi.net/error-handling/)
- [Baeldung - Exception Handling in Spring](https://www.baeldung.com/exception-handling-in-spring-mvc)

---

Happy Coding 👨‍💻