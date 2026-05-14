---
title: "Standardized Error Handling (RFC 7807)"
description: "Implement RFC 7807 Problem Details for error responses: structured errors, Spring ErrorAttributes, and consistent API error handling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - error-handling
  - rfc-7807
  - problem-details
  - rest-api
coverImage: "/images/backend/api-design/rest/error-handling-standards.png"
draft: false
---

# Standardized Error Handling (RFC 7807)

## Overview

RFC 7807 defines a standard format for HTTP API error responses called "Problem Details." It provides a structured way to communicate errors with fields like `type`, `title`, `status`, `detail`, and `instance`. Adopting this standard improves client error handling, API consistency, and developer experience.

---

## RFC 7807 Problem Details Structure

RFC 7807 defines a standard format for HTTP API error responses called "Problem Details." The structure includes five standard fields: `type` (a URI identifying the error type), `title` (a short, human-readable summary), `status` (the HTTP status code), `detail` (a human-readable explanation), and `instance` (a URI identifying the specific occurrence). Additional domain-specific fields can be added as extensions. Adopting this standard ensures that all errors across your API follow a consistent, machine-parseable format that clients can handle programmatically.

### Standard Fields

```java
public class ProblemDetail {
    private URI type = URI.create("about:blank");
    private String title;
    private int status;
    private String detail;
    private URI instance;
    private Map<String, Object> extensions = new HashMap<>();

    public ProblemDetail(String title, int status, String detail) {
        this.title = title;
        this.status = status;
        this.detail = detail;
    }

    public void setType(URI type) { this.type = type; }
    public void setInstance(URI instance) { this.instance = instance; }
    public void addExtension(String key, Object value) {
        this.extensions.put(key, value);
    }
}
```

The JSON representation shows a complete Problem Details response. The `type` field points to documentation that clients can use to understand the error and how to handle it. The `detail` field provides enough context for developers to diagnose the issue without exposing internal implementation details. The `instance` field identifies exactly which request caused the error, making it easy to correlate errors with server logs. Extension fields like `balance` and `accounts` provide domain-specific context that helps clients handle the error appropriately — in this case, the client can inform the user that they need more credit.

### JSON Representation

```json
{
    "type": "https://api.example.com/errors/out-of-credit",
    "title": "You do not have sufficient credit.",
    "status": 403,
    "detail": "Your current balance is 30, but that costs 50.",
    "instance": "/api/orders/123",
    "balance": 30,
    "accounts": ["/api/accounts/1", "/api/accounts/2"]
}
```

---

## Spring Boot Implementation

Spring 6 introduced built-in support for RFC 7807 through the `ProblemDetail` class. Using `@RestControllerAdvice` with `@ExceptionHandler` methods that return `ProblemDetail` centralizes error handling in one place while producing standard-compliant responses. This approach eliminates the need for custom error response DTOs and ensures all endpoints produce consistent error formats automatically.

### Using Spring 6 ProblemDetail

The `GlobalExceptionHandler` demonstrates handling different exception types with appropriate Problem Details. Each handler sets the HTTP status, title, detail, and type URI specific to the error category. For validation errors, the handler extracts field-level errors from the binding result and adds them as an extension property. This provides rich, actionable error information that clients can use to highlight specific form fields or validation failures — far more useful than a generic "validation failed" message.

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ProblemDetail handleResourceNotFound(ResourceNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setTitle("Resource Not Found");
        problem.setDetail(ex.getMessage());
        problem.setType(URI.create("https://api.example.com/errors/not-found"));
        problem.setInstance(URI.create("/api" + ex.getResourcePath()));
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Validation Failed");
        problem.setDetail("Request validation failed");

        Map<String, List<String>> errors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .collect(Collectors.groupingBy(
                FieldError::getField,
                Collectors.mapping(FieldError::getDefaultMessage, Collectors.toList())
            ));

        problem.setProperty("field_errors", errors);
        problem.setType(URI.create("https://api.example.com/errors/validation"));

        return problem;
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail handleAccessDenied(AccessDeniedException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setTitle("Access Denied");
        problem.setDetail("You do not have permission to perform this action");
        problem.setType(URI.create("https://api.example.com/errors/forbidden"));
        return problem;
    }
}
```

A custom error catalog centralizes error type definitions, ensuring consistency across all error responses. Each error type has a unique URI (which can link to documentation) and a standard title. Using an enum prevents typos and makes error types discoverable through IDE autocompletion. The error types should be documented publicly so API consumers can write error-handling code against known, stable error identifications. Consider versioning your error catalog URIs to allow evolving error documentation without breaking existing client code.

### Custom Error Catalog

```java
public enum ErrorType {

    VALIDATION_ERROR(
        "https://api.example.com/errors/validation",
        "Validation Failed"
    ),
    RESOURCE_NOT_FOUND(
        "https://api.example.com/errors/not-found",
        "Resource Not Found"
    ),
    CONFLICT(
        "https://api.example.com/errors/conflict",
        "Resource Conflict"
    ),
    RATE_LIMITED(
        "https://api.example.com/errors/rate-limited",
        "Rate Limit Exceeded"
    ),
    INTERNAL_ERROR(
        "https://api.example.com/errors/internal",
        "Internal Server Error"
    ),
    UNAUTHORIZED(
        "https://api.example.com/errors/unauthorized",
        "Authentication Required"
    ),
    FORBIDDEN(
        "https://api.example.com/errors/forbidden",
        "Access Denied"
    ),
    DEPENDENCY_FAILURE(
        "https://api.example.com/errors/dependency-failure",
        "External Dependency Failed"
    );

    private final URI type;
    private final String title;

    ErrorType(String typeUri, String title) {
        this.type = URI.create(typeUri);
        this.title = title;
    }

    public URI getType() { return type; }
    public String getTitle() { return title; }
}
```

---

## Comprehensive Error Handler

While the basic ProblemDetail approach works for simple cases, a domain exception hierarchy provides richer error context and cleaner separation of concerns. Each domain exception extends `ApiException` and carries metadata specific to its error type — `ResourceNotFoundException` includes the `resourcePath` for the instance URI, `ValidationFailedException` carries `fieldErrors` for detailed validation feedback, and `RateLimitException` includes `retryAfterSeconds` for the Retry-After header. This structured approach makes exception handling more expressive and testable.

### Domain Exception Hierarchy

```java
public abstract class ApiException extends RuntimeException {
    private final ErrorType errorType;
    private final HttpStatus httpStatus;

    protected ApiException(ErrorType errorType, HttpStatus httpStatus, String message) {
        super(message);
        this.errorType = errorType;
        this.httpStatus = httpStatus;
    }

    public ErrorType getErrorType() { return errorType; }
    public HttpStatus getHttpStatus() { return httpStatus; }
}

public class ResourceNotFoundException extends ApiException {
    private final String resourcePath;

    public ResourceNotFoundException(String resource, Long id) {
        super(ErrorType.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND,
            resource + " with id " + id + " not found");
        this.resourcePath = "/" + resource + "/" + id;
    }

    public String getResourcePath() { return resourcePath; }
}

public class ValidationFailedException extends ApiException {
    private final Map<String, List<String>> fieldErrors;

    public ValidationFailedException(Map<String, List<String>> fieldErrors) {
        super(ErrorType.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, "Validation failed");
        this.fieldErrors = fieldErrors;
    }

    public Map<String, List<String>> getFieldErrors() { return fieldErrors; }
}

public class ConflictException extends ApiException {
    public ConflictException(String message) {
        super(ErrorType.CONFLICT, HttpStatus.CONFLICT, message);
    }
}

public class RateLimitException extends ApiException {
    private final int retryAfterSeconds;

    public RateLimitException(int retryAfterSeconds) {
        super(ErrorType.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS,
            "Rate limit exceeded. Try again in " + retryAfterSeconds + " seconds");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public int getRetryAfterSeconds() { return retryAfterSeconds; }
}
```

### Unified Exception Handler

```java
@RestControllerAdvice
public class UnifiedExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(UnifiedExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> handleApiException(
            ApiException ex, WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(ex.getHttpStatus());
        problem.setTitle(ex.getErrorType().getTitle());
        problem.setDetail(ex.getMessage());
        problem.setType(ex.getErrorType().getType());

        String path = extractPath(request);
        problem.setInstance(URI.create(path));

        if (ex instanceof ValidationFailedException vfe) {
            problem.setProperty("field_errors", vfe.getFieldErrors());
        }

        if (ex instanceof RateLimitException rle) {
            problem.setProperty("retry_after_seconds", rle.getRetryAfterSeconds());
        }

        return ResponseEntity.status(ex.getHttpStatus())
            .header("Content-Type", "application/problem+json")
            .body(problem);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleValidation(
            MethodArgumentNotValidException ex, WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle(ErrorType.VALIDATION_ERROR.getTitle());
        problem.setType(ErrorType.VALIDATION_ERROR.getType());
        problem.setDetail("Request body validation failed");
        problem.setInstance(URI.create(extractPath(request)));

        Map<String, List<String>> errors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .collect(Collectors.groupingBy(
                FieldError::getField,
                Collectors.mapping(FieldError::getDefaultMessage, Collectors.toList())
            ));

        problem.setProperty("field_errors", errors);

        return ResponseEntity.badRequest()
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ProblemDetail> handleConstraintViolation(
            ConstraintViolationException ex, WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle(ErrorType.VALIDATION_ERROR.getTitle());
        problem.setType(ErrorType.VALIDATION_ERROR.getType());
        problem.setDetail("Parameter validation failed");
        problem.setInstance(URI.create(extractPath(request)));

        Map<String, String> errors = ex.getConstraintViolations().stream()
            .collect(Collectors.toMap(
                v -> v.getPropertyPath().toString(),
                ConstraintViolation::getMessage,
                (a, b) -> a + "; " + b
            ));

        problem.setProperty("constraint_errors", errors);

        return ResponseEntity.badRequest()
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> handleMalformedBody(
            HttpMessageNotReadableException ex, WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Malformed Request Body");
        problem.setType(URI.create("https://api.example.com/errors/malformed-body"));
        problem.setDetail("The request body could not be read. Check JSON syntax.");
        problem.setInstance(URI.create(extractPath(request)));

        return ResponseEntity.badRequest()
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ProblemDetail> handleMissingParam(
            MissingServletRequestParameterException ex, WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Missing Required Parameter");
        problem.setType(URI.create("https://api.example.com/errors/missing-parameter"));
        problem.setDetail("Required parameter '" + ex.getParameterName() + "' is missing");
        problem.setInstance(URI.create(extractPath(request)));

        problem.setProperty("missing_parameter", ex.getParameterName());

        return ResponseEntity.badRequest()
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnhandled(
            Exception ex, WebRequest request) {

        log.error("Unhandled exception", ex);

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        problem.setTitle(ErrorType.INTERNAL_ERROR.getTitle());
        problem.setType(ErrorType.INTERNAL_ERROR.getType());
        problem.setDetail("An unexpected error occurred. Please try again later.");
        problem.setInstance(URI.create(extractPath(request)));

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
    }

    private String extractPath(WebRequest request) {
        if (request instanceof ServletWebRequest swr) {
            return swr.getRequest().getRequestURI();
        }
        return request.getContextPath();
    }
}
```

---

## Error Response Customization

### Adding Trace and Request IDs

```java
@Component
public class ErrorResponseCustomizer {

    private static final String CORRELATION_ID_HEADER = "X-Correlation-ID";
    private static final String REQUEST_ID_HEADER = "X-Request-ID";

    public void customize(ProblemDetail problem, HttpServletRequest request) {
        String correlationId = request.getHeader(CORRELATION_ID_HEADER);
        if (correlationId != null) {
            problem.setProperty("correlation_id", correlationId);
        }

        String requestId = request.getHeader(REQUEST_ID_HEADER);
        if (requestId != null) {
            problem.setProperty("request_id", requestId);
        }

        problem.setProperty("timestamp", Instant.now().toString());

        // Add help URL
        problem.setProperty("help", "https://docs.api.example.com/errors#" +
            problem.getType().toString().replaceAll(".*/", ""));
    }
}
```

### Security-Focused Error Handling

```java
@RestControllerAdvice
public class SecurityExceptionHandler {

    // Avoid revealing user existence
    @ExceptionHandler(AuthenticationException.class)
    public ProblemDetail handleAuthentication() {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNAUTHORIZED);
        problem.setTitle(ErrorType.UNAUTHORIZED.getTitle());
        problem.setType(ErrorType.UNAUTHORIZED.getType());
        problem.setDetail("Authentication is required to access this resource");
        return problem;
    }

    // Avoid revealing specific permissions
    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail handleAuthorization() {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setTitle(ErrorType.FORBIDDEN.getTitle());
        problem.setType(ErrorType.FORBIDDEN.getType());
        problem.setDetail("You do not have permission to access this resource");
        return problem;
    }

    // Rate limiting
    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<ProblemDetail> handleRateLimit(RateLimitException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.TOO_MANY_REQUESTS);
        problem.setTitle(ErrorType.RATE_LIMITED.getTitle());
        problem.setType(ErrorType.RATE_LIMITED.getType());
        problem.setDetail(ex.getMessage());

        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .header("Retry-After", String.valueOf(ex.getRetryAfterSeconds()))
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
    }
}
```

---

## Best Practices

1. **Always use RFC 7807 format**: Standardize error responses across all endpoints
2. **Provide actionable detail**: Error detail should help clients fix the issue
3. **Include trace identifiers**: Correlation IDs for debugging
4. **Use problem type URIs**: Documented, resolvable error type documentation
5. **Don't leak internals**: Avoid stack traces, SQL details in production
6. **Consistent field names**: Use snake_case or camelCase consistently
7. **Include validation errors**: Field-level error details for 400 responses
8. **Rate limiting headers**: Include Retry-After for 429 responses
9. **Security through obscurity**: Don't reveal user existence in auth errors
10. **Log server errors**: Always log 5xx with full stack traces internally

```java
// Custom ErrorAttributes for Spring Boot
@Component
public class CustomErrorAttributes extends DefaultErrorAttributes {

    @Override
    public Map<String, Object> getErrorAttributes(
            WebRequest webRequest, ErrorAttributeOptions options) {

        Map<String, Object> attributes = super.getErrorAttributes(webRequest, options);

        ProblemDetail problem = ProblemDetail.forStatus(
            (Integer) attributes.get("status"));

        problem.setTitle((String) attributes.get("error"));
        problem.setDetail((String) attributes.get("message"));
        problem.setType(URI.create("https://api.example.com/errors/" +
            attributes.get("error").toString().toLowerCase().replace(" ", "-")));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", problem.getType().toString());
        result.put("title", problem.getTitle());
        result.put("status", problem.getStatus());
        result.put("detail", problem.getDetail());
        result.put("instance", webRequest.getDescription(false));

        return result;
    }
}
```

---

## Common Mistakes

### Mistake 1: Inconsistent Error Structure

```java
// WRONG: Different error structures across endpoints
// Endpoint A returns: { "error": "Not found", "code": 404 }
// Endpoint B returns: { "message": "User not found", "status": "NOT_FOUND" }

// CORRECT: Unified RFC 7807 format everywhere
```

### Mistake 2: Exposing Stack Traces

```java
// WRONG: Returning stack traces in production
@ExceptionHandler(Exception.class)
public Map<String, Object> handleError(Exception ex) {
    return Map.of(
        "error", ex.getMessage(),
        "trace", ex.getStackTrace()  // Security risk!
    );
}

// CORRECT: Generic messages for 5xx, detailed logs only
@ExceptionHandler(Exception.class)
public ProblemDetail handleError(Exception ex) {
    log.error("Unhandled exception", ex);
    return ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
}
```

### Mistake 3: Wrong Status Code Usage

```java
// WRONG: Returning 500 for validation errors
@ExceptionHandler(ValidationException.class)
@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
public ProblemDetail handleValidation(ValidationException ex) {
    return ProblemDetail.forStatus(500);
}

// CORRECT: 400 for client errors
@ExceptionHandler(ValidationException.class)
@ResponseStatus(HttpStatus.BAD_REQUEST)
public ProblemDetail handleValidation(ValidationException ex) {
    return ProblemDetail.forStatus(400);
}
```

---

## Summary

1. RFC 7807 provides a standard format for API error responses
2. Use ProblemDetail for consistent, structured error reporting
3. Include error type, title, status, detail, and instance fields
4. Add domain-specific extensions for additional context
5. Never expose internal details like stack traces
6. Use appropriate HTTP status codes matching error semantics
7. Log errors comprehensively internally while returning sanitized responses

---

## References

- [RFC 7807 - Problem Details for HTTP APIs](https://tools.ietf.org/html/rfc7807)
- [Spring ProblemDetail Support](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/server/ProblemDetail.html)
- [Error Handling in REST API](https://www.baeldung.com/rest-api-error-handling-best-practices)

Happy Coding