---
title: "REST API Best Practices"
description: "Design production-ready REST APIs with proper error handling, versioning, documentation, and security practices"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - rest-api
  - best-practices
  - web-services
coverImage: "/images/rest-api-best-practices.png"
draft: false
---

# REST API Best Practices: Production Implementation Guide

## Overview

Building a REST API is straightforward, but building a production-quality API that is secure, performant, maintainable, and developer-friendly requires careful attention to design decisions. This guide covers everything from URL design and HTTP method usage to error handling, versioning, and documentation.

These practices come from real-world production systems handling millions of requests. They represent the consensus of what works at scale.

---

## API Design Fundamentals

### Resource Naming

Use nouns for resources, not verbs. Resources should be collections or elements:

```java
// WRONG: Using verbs in URLs
@RestController
@RequestMapping("/api")
public class BrokenUserController {
    
    @GetMapping("/getUsers")           // Verb in URL
    @GetMapping("/getUserById/{id}")    // Verb in URL
    @PostMapping("/createUser")         // Verb in URL
    @PutMapping("/updateUser")          // Verb in URL
    @DeleteMapping("/deleteUser")       // Verb in URL
}

// CORRECT: Using nouns and HTTP methods
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping          // GET /api/users - list users
    @PostMapping        // POST /api/users - create user
    @GetMapping("/{id}") // GET /api/users/123 - get specific user
    @PutMapping("/{id}") // PUT /api/users/123 - update user
    @DeleteMapping("/{id}") // DELETE /api/users/123 - delete user
}
```

### HTTP Methods Usage

Each HTTP method has specific semantics:

```java
// GET: Retrieve resources - idempotent, no side effects
@RestController
public class ProductController {
    
    @GetMapping("/products")
    public List<Product> listProducts(
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        return productService.findByCategory(category, page, size);
    }
    
    @GetMapping("/products/{id}")
    public Product getProduct(@PathVariable Long id) {
        return productService.findById(id)
            .orElseThrow(() -> new ProductNotFoundException(id));
    }
}

// POST: Create resources - not idempotent
@RestController
public class OrderController {
    
    @PostMapping("/orders")
    @ResponseStatus(HttpStatus.CREATED)
    public Order createOrder(@Valid @RequestBody CreateOrderRequest request) {
        return orderService.createOrder(request);
    }
}

// PUT: Replace entire resource - idempotent
@RestController
public class UserController {
    
    @PutMapping("/users/{id}")
    public User updateUser(@PathVariable Long id, 
                           @Valid @RequestBody UpdateUserRequest request) {
        return userService.updateUser(id, request);
    }
}

// PATCH: Partial update - idempotent
@PatchMapping("/users/{id}")
public User patchUser(@PathVariable Long id, 
                      @RequestBody Map<String, Object> updates) {
    return userService.partialUpdate(id, updates);
}

// DELETE: Remove resources - idempotent
@DeleteMapping("/users/{id}")
@ResponseStatus(HttpStatus.NO_CONTENT)
public void deleteUser(@PathVariable Long id) {
    userService.delete(id);
}
```

### Response Structure

Use consistent response structures across your API:

```java
// Generic response wrapper
public class ApiResponse<T> {
    
    private T data;
    private List<ApiError> errors;
    private ApiMetadata metadata;
    private Instant timestamp;
    
    public static <T> ApiResponse<T> success(T data) {
        ApiResponse<T> response = new ApiResponse<>();
        response.data = data;
        response.timestamp = Instant.now();
        return response;
    }
    
    public static <T> ApiResponse<T> error(List<ApiError> errors) {
        ApiResponse<T> response = new ApiResponse<>();
        response.errors = errors;
        response.timestamp = Instant.now();
        return response;
    }
    
    // Getters and setters
}

public class ApiError {
    private String code;
    private String message;
    private String field;
    private Object rejectedValue;
}

// Paginated response
public class PagedResponse<T> {
    private List<T> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private boolean first;
    private boolean last;
    
    public static <T> PagedResponse<T> of(Page<T> page) {
        PagedResponse<T> response = new PagedResponse<>();
        response.content = page.getContent();
        response.page = page.getNumber();
        response.size = page.getSize();
        response.totalElements = page.getTotalElements();
        response.totalPages = page.getTotalPages();
        response.first = page.isFirst();
        response.last = page.isLast();
        return response;
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Complete CRUD API

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {
    
    @Autowired
    private ProductService productService;
    
    @GetMapping
    public PagedResponse<Product> list(
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "id") String sortBy) {
        
        Page<Product> products = productService.findAll(category, page, size, sortBy);
        return PagedResponse.of(products);
    }
    
    @GetMapping("/{id}")
    public ApiResponse<Product> get(@PathVariable Long id) {
        return ApiResponse.success(
            productService.findById(id)
                .orElseThrow(() -> new ProductNotFoundException(id))
        );
    }
    
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<Product> create(@Valid @RequestBody CreateProductRequest request) {
        Product product = productService.create(request);
        return ApiResponse.success(product);
    }
    
    @PutMapping("/{id}")
    public ApiResponse<Product> update(@PathVariable Long id,
                                        @Valid @RequestBody UpdateProductRequest request) {
        return ApiResponse.success(productService.update(id, request));
    }
    
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        productService.delete(id);
    }
}

// Request/Response DTOs
public class CreateProductRequest {
    @NotBlank
    private String name;
    
    @NotNull
    @Positive
    private BigDecimal price;
    
    @NotNull
    private String category;
    
    private String description;
    
    // Getters and setters
}

public class UpdateProductRequest {
    private String name;
    
    @Positive
    private BigDecimal price;
    
    private String category;
    
    private String description;
    
    // Getters and setters
}
```

### Case 2: Filtering and Search API

```java
@RestController
@RequestMapping("/api/products")
public class ProductSearchController {
    
    @Autowired
    private ProductSearchService searchService;
    
    @GetMapping("/search")
    public PagedResponse<Product> search(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) List<String> brands,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        ProductSearchCriteria criteria = ProductSearchCriteria.builder()
            .query(q)
            .category(category)
            .minPrice(minPrice)
            .maxPrice(maxPrice)
            .brands(brands)
            .page(page)
            .size(size)
            .build();
        
        return PagedResponse.of(searchService.search(criteria));
    }
    
    // Advanced: Faceted search
    @GetMapping("/search/facets")
    public SearchFacetsResponse searchWithFacets(@RequestParam String q) {
        return searchService.searchWithFacets(q);
    }
}

public class SearchFacetsResponse {
    private List<Product> products;
    private Map<String, List<FacetValue>> facets;
    private long totalResults;
}

public class ProductSearchCriteria {
    private String query;
    private String category;
    private BigDecimal minPrice;
    private BigDecimal maxPrice;
    private List<String> brands;
    private int page;
    private int size;
    private String sortBy;
}
```

### Case 3: Bulk Operations

```java
@RestController
@RequestMapping("/api/products")
public class BulkProductController {
    
    @Autowired
    private ProductService productService;
    
    // Bulk create
    @PostMapping("/bulk")
    public BulkResponse<Product> bulkCreate(@Valid @RequestBody BulkCreateRequest request) {
        
        List<Product> created = new ArrayList<>();
        List<BulkError> errors = new ArrayList<>();
        
        for (int i = 0; i < request.getProducts().size(); i++) {
            try {
                Product product = productService.create(request.getProducts().get(i));
                created.add(product);
            } catch (Exception e) {
                errors.add(new BulkError(i, e.getMessage()));
            }
        }
        
        return BulkResponse.<Product>builder()
            .successful(created.size())
            .failed(errors.size())
            .results(created)
            .errors(errors)
            .build();
    }
    
    // Bulk update
    @PutMapping("/bulk")
    public BulkResponse<Product> bulkUpdate(@Valid @RequestBody BulkUpdateRequest request) {
        
        List<Product> updated = new ArrayList<>();
        List<BulkError> errors = new ArrayList<>();
        
        for (BulkUpdateRequest.UpdateItem item : request.getItems()) {
            try {
                Product product = productService.update(item.getId(), item.getData());
                updated.add(product);
            } catch (Exception e) {
                errors.add(new BulkError(item.getIndex(), e.getMessage()));
            }
        }
        
        return BulkResponse.<Product>builder()
            .successful(updated.size())
            .failed(errors.size())
            .results(updated)
            .errors(errors)
            .build();
    }
}
```

### Case 4: Async Operations

For long-running operations, use async processing:

```java
@RestController
@RequestMapping("/api/reports")
public class ReportController {
    
    @Autowired
    private ReportService reportService;
    
    // Start async operation
    @PostMapping("/generate")
    public ApiResponse<JobStatus> startReportGeneration(
            @Valid @RequestBody GenerateReportRequest request) {
        
        String jobId = reportService.startGeneration(request);
        
        return ApiResponse.success(JobStatus.builder()
            .jobId(jobId)
            .status("PROCESSING")
            .build());
    }
    
    // Check status
    @GetMapping("/jobs/{jobId}")
    public ApiResponse<JobStatus> getJobStatus(@PathVariable String jobId) {
        
        JobStatus status = reportService.getStatus(jobId);
        
        if (status == null) {
            throw new JobNotFoundException(jobId);
        }
        
        return ApiResponse.success(status);
    }
    
    // Get result when complete
    @GetMapping("/jobs/{jobId}/result")
    public ResponseEntity<byte[]> getReportResult(@PathVariable String jobId) {
        
        JobStatus status = reportService.getStatus(jobId);
        
        if (status.getStatus().equals("PROCESSING")) {
            return ResponseEntity.status(423)  // Locked
                .body("Report is still generating".getBytes());
        }
        
        byte[] report = reportService.getResult(jobId);
        
        return ResponseEntity.ok()
            .header("Content-Type", "application/pdf")
            .header("Content-Disposition", "attachment; filename=report.pdf")
            .body(report);
    }
}
```

---

## Error Handling

### Centralized Exception Handling

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    
    // Handle validation errors
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<?> handleValidationError(MethodArgumentNotValidException ex) {
        
        List<ApiError> errors = ex.getBindingResult().getFieldErrors().stream()
            .map(error -> ApiError.builder()
                .code("VALIDATION_ERROR")
                .message(error.getDefaultMessage())
                .field(error.getField())
                .rejectedValue(error.getRejectedValue())
                .build())
            .collect(Collectors.toList());
        
        return ApiResponse.error(errors);
    }
    
    // Handle resource not found
    @ExceptionHandler(EntityNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<?> handleNotFound(EntityNotFoundException ex) {
        
        return ApiResponse.error(List.of(
            ApiError.builder()
                .code("NOT_FOUND")
                .message(ex.getMessage())
                .build()
        ));
    }
    
    // Handle business exceptions
    @ExceptionHandler(BusinessException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<?> handleBusinessError(BusinessException ex) {
        
        return ApiResponse.error(List.of(
            ApiError.builder()
                .code(ex.getCode())
                .message(ex.getMessage())
                .build()
        ));
    }
    
    // Handle authentication errors
    @ExceptionHandler(AuthenticationException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ApiResponse<?> handleAuthError(AuthenticationException ex) {
        
        return ApiResponse.error(List.of(
            ApiError.builder()
                .code("UNAUTHORIZED")
                .message("Authentication required")
                .build()
        ));
    }
    
    // Handle authorization errors
    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ApiResponse<?> handleAccessDenied(AccessDeniedException ex) {
        
        return ApiResponse.error(List.of(
            ApiError.builder()
                .code("FORBIDDEN")
                .message("Access denied")
                .build()
        ));
    }
    
    // Handle all other exceptions
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<?> handleGenericError(Exception ex) {
        
        log.error("Unhandled exception", ex);
        
        return ApiResponse.error(List.of(
            ApiError.builder()
                .code("INTERNAL_ERROR")
                .message("An unexpected error occurred")
                .build()
        ));
    }
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
```

### HTTP Status Codes

Use appropriate status codes for different scenarios:

```java
// 2xx - Success
@PostMapping
@ResponseStatus(HttpStatus.CREATED)  // 201 - Resource created
public Product create(@RequestBody Product product) { ... }

@GetMapping
@ResponseStatus(HttpStatus.OK)  // 200 - Success
public List<Product> list() { ... }

@DeleteMapping("/{id}")
@ResponseStatus(HttpStatus.NO_CONTENT)  // 204 - Successful, no content
public void delete(@PathVariable Long id) { ... }

// 4xx - Client errors
@PostMapping
@ResponseStatus(HttpStatus.BAD_REQUEST)  // 400 - Invalid request
public void create(@RequestBody @Valid Product product) { ... }

@GetMapping("/{id}")
@ResponseStatus(HttpStatus.NOT_FOUND)  // 404 - Resource not found
public Product get(@PathVariable Long id) { ... }

@GetMapping
@ResponseStatus(HttpStatus.UNAUTHORIZED)  // 401 - Authentication required
public void list() { ... }

@GetMapping
@ResponseStatus(HttpStatus.FORBIDDEN)  // 403 - Authorization failed
public void list() { ... }

// 409 - Conflict (e.g., duplicate resource)
@PostMapping
@ResponseStatus(HttpStatus.CONFLICT)
public void create(@RequestBody Product product) { ... }

// 422 - Unprocessable entity (validation failed but format is correct)
@PostMapping
@ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
public void create(@RequestBody @Valid Product product) { ... }

// 429 - Too many requests (rate limiting)
@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
public void handleRateLimit() { ... }
```

---

## API Versioning

### URL-Based Versioning

```java
@RestController
@RequestMapping("/api/v1")
public class V1ProductController {
    
    @GetMapping("/products")
    public List<Product> list() { ... }
}

@RestController
@RequestMapping("/api/v2")
public class V2ProductController {
    
    @GetMapping("/products")
    public List<ProductV2> list(
            @RequestParam(required = false) boolean includeDetails) { ... }
}

// Request mapping with version
@Configuration
public class VersionConfig {
    
    @Bean
    public RequestMappingHandlerMapping versionHandlerMapping() {
        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        mapping.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return mapping;
    }
}
```

### Version Negotiation

```java
@Configuration
public class VersionNegotiationConfig implements WebMvcConfigurer {
    
    @Override
    public void configureContentNegotiation(
            ContentNegotiationConfigurer configurer) {
        
        configurer
            .parameterName("version")
            .defaultContentType(MediaType.APPLICATION_JSON)
            .mediaType("vnd", MediaType.APPLICATION_JSON)
            .favorParameter(true);
    }
}

// Using header-based versioning
@RestController
public class VersionedController {
    
    @GetMapping(value = "/products", headers = "X-API-Version=1")
    public List<ProductV1> listV1() { ... }
    
    @GetMapping(value = "/products", headers = "X-API-Version=2")
    public List<ProductV2> listV2() { ... }
}
```

---

## Documentation with OpenAPI

```java
@Configuration
@EnableOpenApi
public class OpenApiConfig {
    
    @Bean
    public OpenAPI customOpenAPI() {
        
        return new OpenAPI()
            .info(new Info()
                .title("Product API")
                .version("v1")
                .description("API for managing products")
                .contact(new Contact()
                    .name("API Support")
                    .email("support@example.com"))
                .license(new License()
                    .name("Apache 2.0")
                    .url("https://www.apache.org/licenses/LICENSE-2.0.html")))
            .addServersItem(new Server()
                .url("https://api.example.com")
                .description("Production server"))
            .addServersItem(new Server()
                .url("http://localhost:8080")
                .description("Development server"))
            .components(new Components()
                .addSecuritySchemes("bearerAuth", 
                    new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT"))
                .addSchemas("Product", 
                    new Schema<Product>()
                        .type("object")
                        .addProperties("id", new Schema<>().type("integer"))
                        .addProperties("name", new Schema<>().type("string"))
                        .addProperties("price", new Schema<>().type("number").format("decimal"))));
    }
}

// Annotate controllers for documentation
@RestController
@RequestMapping("/api/products")
@Tag(name = "Products", description = "Product management APIs")
public class ProductController {
    
    @Operation(summary = "List all products", 
               description = "Returns a paginated list of products")
    @ApiResponse(responseCode = "200", 
                 description = "Successfully retrieved list",
                 content = @Content(array = @ArraySchema(schema = @Schema(implementation = Product.class))))
    @ApiResponse(responseCode = "401", description = "Unauthorized")
    @ApiResponse(responseCode = "500", description = "Internal server error")
    @GetMapping
    public PagedResponse<Product> list(
            @Parameter(description = "Page number (0-based)") 
            @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size") 
            @RequestParam(defaultValue = "20") int size) {
        return productService.findAll(page, size);
    }
}
```

---

## Security Best Practices

### Rate Limiting

```java
@Configuration
public class RateLimitingConfig {
    
    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilter(
            RateLimiter rateLimiter) {
        
        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new RateLimitFilter(rateLimiter));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(1);
        
        return registration;
    }
}

@Component
public class RateLimitFilter extends OncePerRequestFilter {
    
    @Autowired
    private RateLimiter rateLimiter;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain chain) {
        
        String clientId = getClientId(request);
        
        if (!rateLimiter.tryAcquire(clientId)) {
            response.setStatus(429);
            response.setContentType("application/json");
            response.getWriter().write(
                "{\"error\": \"Rate limit exceeded\", \"retryAfter\": 60}"
            );
            return;
        }
        
        chain.doFilter(request, response);
    }
}
```

### CORS Configuration

```java
@Configuration
public class CorsConfig {
    
    @Bean
    public CorsWebFilter corsWebFilter() {
        
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.asList(
            "https://example.com",
            "https://www.example.com"
        ));
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(Arrays.asList("Authorization", "Content-Type", "X-Requested-With"));
        config.setExposedHeaders(Arrays.asList("X-Total-Count", "X-Page-Number"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        
        return new CorsWebFilter(source);
    }
}
```

---

## Common Mistakes

### Mistake 1: Inconsistent Response Format

```java
// WRONG: Different response formats
@GetMapping("/users")
public List<User> getUsers() { return users; }  // Returns array directly

@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) { 
    return user;  // Returns object directly
}

@PostMapping("/users")
public User createUser(@RequestBody User user) { 
    return user;  // Returns created object
}

// CORRECT: Consistent wrapper
@GetMapping("/users")
public ApiResponse<List<User>> getUsers() { 
    return ApiResponse.success(users); 
}

@GetMapping("/users/{id}")
public ApiResponse<User> getUser(@PathVariable Long id) { 
    return ApiResponse.success(user);
}
```

### Mistake 2: Missing Input Validation

```java
// WRONG: No validation on input
@PostMapping("/users")
public User createUser(@RequestBody Map<String, String> request) {
    String name = request.get("name");  // Could be null!
    String email = request.get("email");  // Could be anything!
    
    User user = new User();
    user.setName(name);  // No validation
    return userRepository.save(user);
}

// CORRECT: Proper validation with DTOs
public class CreateUserRequest {
    
    @NotBlank(message = "Name is required")
    @Size(min = 2, max = 100, message = "Name must be between 2 and 100 characters")
    private String name;
    
    @NotBlank(message = "Email is required")
    @Email(message = "Invalid email format")
    private String email;
    
    @NotNull(message = "Age is required")
    @Min(value = 18, message = "Age must be at least 18")
    private Integer age;
    
    // Getters and setters
}

@PostMapping("/users")
public ApiResponse<User> createUser(@Valid @RequestBody CreateUserRequest request) {
    User user = mapper.map(request);
    return ApiResponse.success(userRepository.save(user));
}
```

### Mistake 3: Missing Pagination on Large Endpoints

```java
// WRONG: No pagination - returns all records
@GetMapping("/products")
public List<Product> getAllProducts() {
    return productRepository.findAll();  // Could be millions of rows!
}

// CORRECT: Always paginate potentially large results
@GetMapping("/products")
public PagedResponse<Product> getProducts(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size) {
    
    size = Math.min(size, 100);  // Cap maximum page size
    
    Page<Product> result = productRepository.findAll(PageRequest.of(page, size));
    return PagedResponse.of(result);
}
```

### Mistake 4: Exposing Internal IDs

```java
// WRONG: Exposing database IDs
@Entity
public class Product {
    @Id
    private Long id;  // Exposed as "id": 123
}

@RestController
public class ProductController {
    @GetMapping("/products/{id}")
    public Product getProduct(@PathVariable Long id) { ... }
}

// CORRECT: Use business keys or UUIDs
@Entity
public class Product {
    
    @Id
    private Long id;
    
    @Column(unique = true)
    private String publicId;  // UUID or business key
    
    public String getPublicId() {
        return publicId;
    }
}

@RestController
public class ProductController {
    @GetMapping("/products/{publicId}")
    public Product getProduct(@PathVariable String publicId) {
        return productRepository.findByPublicId(publicId);
    }
}
```

### Mistake 5: Not Using HTTP Methods Correctly

```java
// WRONG: Using GET for mutations
@GetMapping("/users/create")
public User createUser(@RequestParam String name) {  // Semantic misuse
    return userService.create(name);
}

// Using POST for everything
@PostMapping("/users/get")
public User getUser(@RequestBody GetUserRequest request) {  // Unnecessary
    return userRepository.findById(request.getId());
}

// CORRECT: Use correct HTTP methods
@PostMapping("/users")         // Create
public User createUser(@RequestBody CreateUserRequest request) { ... }

@GetMapping("/users/{id}")      // Read
public User getUser(@PathVariable Long id) { ... }

@PutMapping("/users/{id}")     // Full update
public User updateUser(@PathVariable Long id, @RequestBody UpdateUserRequest request) { ... }

@PatchMapping("/users/{id}")   // Partial update
public User patchUser(@PathVariable Long id, @RequestBody Map<String, Object> updates) { ... }

@DeleteMapping("/users/{id}")  // Delete
public void deleteUser(@PathVariable Long id) { ... }
```

---

## Summary

Building production-quality REST APIs requires attention to:

1. **Consistent design**: Use nouns, proper HTTP methods, and standardized responses
2. **Error handling**: Centralized exception handling with appropriate status codes
3. **Versioning**: Choose a strategy and document it clearly
4. **Documentation**: OpenAPI/Swagger integration for interactive docs
5. **Security**: Authentication, authorization, rate limiting, CORS

API design is a contract with your consumers. Design it carefully, version it properly, and maintain backward compatibility.

---

## References

- [REST API Design Best Practices](https://restfulapi.net/)
- [RFC 7231 - HTTP/1.1 Semantics and Content](https://tools.ietf.org/html/rfc7231)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Spring REST Docs](https://spring.io/projects/spring-restdocs)
- [Microsoft API Design Guide](https://docs.microsoft.com/en-us/azure/architecture/best-practices/api-design)