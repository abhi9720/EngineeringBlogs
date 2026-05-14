---
title: "OpenAPI/Swagger Documentation"
description: "Master OpenAPI 3.0 specification: API documentation, Swagger UI, SpringDoc, code generation, and documentation best practices"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - openapi
  - swagger
  - api-documentation
  - springdoc
coverImage: "/images/backend/api-design/api-security/openapi-swagger-documentation.png"
draft: false
---

# OpenAPI/Swagger Documentation

## Overview

OpenAPI Specification (formerly Swagger) is the industry standard for describing REST APIs. It provides a machine-readable format for API documentation that enables automated documentation generation, client SDK generation, API testing, and validation. SpringDoc integrates OpenAPI 3.0 seamlessly with Spring Boot.

---

## SpringDoc Configuration

SpringDoc is the standard library for integrating OpenAPI 3.0 with Spring Boot. It automatically generates OpenAPI specifications from controller annotations, reducing the effort required to keep documentation in sync with implementation. Configuration is done through a Spring `@Configuration` class that customizes the API metadata, server URLs, security schemes, and external documentation links. The generated OpenAPI spec is available at `/v3/api-docs` and is rendered as interactive documentation by Swagger UI at `/swagger-ui.html`.

### Basic Setup

```java
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("E-Commerce API")
                .description("REST API for E-Commerce platform with product management, orders, payments, and user management")
                .version("1.0.0")
                .contact(new Contact()
                    .name("API Support")
                    .email("api@example.com")
                    .url("https://example.com/support"))
                .license(new License()
                    .name("Apache 2.0")
                    .url("https://www.apache.org/licenses/LICENSE-2.0")))
            .externalDocs(new ExternalDocumentation()
                .description("Full API Documentation")
                .url("https://docs.example.com/api"))
            .servers(List.of(
                new Server().url("https://api.example.com/v1").description("Production"),
                new Server().url("https://staging-api.example.com/v1").description("Staging"),
                new Server().url("http://localhost:8080").description("Local Development")
            ));
    }
}
```

Security scheme configuration documents how clients authenticate with your API within the OpenAPI spec. SpringDoc supports all standard security schemes: HTTP bearer (JWT), API keys, OAuth 2.0 flows, OpenID Connect, and mutual TLS. Configuring security schemes in the OpenAPI spec ensures that tools like Swagger UI can include the appropriate `Authorization` headers in test requests, and code generators can include the authentication logic in generated clients.

### Security Scheme Configuration

```java
@Configuration
public class OpenApiSecurityConfig {

    @Bean
    public OpenAPI securityOpenAPI() {
        final String securitySchemeName = "bearerAuth";
        final String apiKeySchemeName = "apiKey";

        return new OpenAPI()
            .addSecurityItem(new SecurityRequirement()
                .addList(securitySchemeName)
                .addList(apiKeySchemeName))
            .components(new Components()
                .addSecuritySchemes(securitySchemeName,
                    new SecurityScheme()
                        .name(securitySchemeName)
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")
                        .description("JWT token obtained from /auth/login endpoint"))
                .addSecuritySchemes(apiKeySchemeName,
                    new SecurityScheme()
                        .name(apiKeySchemeName)
                        .type(SecurityScheme.Type.APIKEY)
                        .in(SecurityScheme.In.HEADER)
                        .name("X-API-Key")
                        .description("API key for service-to-service authentication")));
    }
}
```

---

## Documenting Controllers

SpringDoc automatically generates OpenAPI documentation from Spring MVC annotations (`@GetMapping`, `@PostMapping`, etc.), but adding explicit `@Operation`, `@ApiResponse`, and `@Parameter` annotations produces richer, more accurate documentation. These annotations let you specify response codes, error conditions, parameter constraints, and example values that automated detection cannot infer. Well-documented controllers serve both as developer reference and as input for client code generation.

### Controller Annotations

```java
@RestController
@RequestMapping("/api/v1/products")
@Tag(name = "Products", description = "Product management APIs")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @Operation(
        summary = "Get product by ID",
        description = "Retrieves a product by its unique identifier. Returns 404 if product not found.",
        tags = {"Products"},
        responses = {
            @ApiResponse(
                responseCode = "200",
                description = "Product found successfully",
                content = @Content(
                    mediaType = "application/json",
                    schema = @Schema(implementation = ProductResponse.class)
                )
            ),
            @ApiResponse(
                responseCode = "404",
                description = "Product not found",
                content = @Content(
                    mediaType = "application/json",
                    schema = @Schema(implementation = ErrorResponse.class)
                )
            ),
            @ApiResponse(
                responseCode = "401",
                description = "Authentication required"
            )
        }
    )
    @GetMapping("/{id}")
    public ResponseEntity<ProductResponse> getProduct(
            @Parameter(description = "Product ID", required = true, example = "12345")
            @PathVariable Long id) {

        Product product = productService.findById(id);
        return ResponseEntity.ok(mapToResponse(product));
    }

    @Operation(
        summary = "Search products",
        description = "Search products with pagination, sorting, and filtering"
    )
    @GetMapping
    public ResponseEntity<PageResponse<ProductResponse>> searchProducts(
            @Parameter(description = "Search query (searches name and description)")
            @RequestParam(required = false) String q,

            @Parameter(description = "Filter by category ID")
            @RequestParam(required = false) Long categoryId,

            @Parameter(description = "Minimum price filter")
            @RequestParam(required = false) @DecimalMin("0.0") BigDecimal minPrice,

            @Parameter(description = "Maximum price filter")
            @RequestParam(required = false) @DecimalMin("0.0") BigDecimal maxPrice,

            @Parameter(description = "Page number (0-indexed)", example = "0")
            @RequestParam(defaultValue = "0") @Min(0) int page,

            @Parameter(description = "Page size", example = "20")
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,

            @Parameter(description = "Sort field (e.g., name,price,createdAt)")
            @RequestParam(defaultValue = "createdAt,desc") String sort) {

        Pageable pageable = PageRequest.of(page, size, parseSort(sort));
        Page<Product> products = productService.search(q, categoryId, minPrice, maxPrice, pageable);

        return ResponseEntity.ok(PageResponse.of(products.map(this::mapToResponse)));
    }

    @Operation(
        summary = "Create a new product",
        description = "Creates a new product. Requires admin role."
    )
    @ApiResponse(
        responseCode = "201",
        description = "Product created successfully",
        headers = @Header(
            name = "Location",
            description = "URL of the created product",
            schema = @Schema(type = "string", format = "uri")
        )
    )
    @PostMapping
    public ResponseEntity<ProductResponse> createProduct(
            @RequestBody @Valid
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                description = "Product creation request",
                required = true,
                content = @Content(schema = @Schema(implementation = CreateProductRequest.class))
            )
            CreateProductRequest request) {

        Product product = productService.create(request);
        URI location = URI.create("/api/v1/products/" + product.getId());

        return ResponseEntity.created(location).body(mapToResponse(product));
    }
}
```

Documenting request and response models with `@Schema` annotations is as important as documenting the endpoints themselves. These annotations provide field-level descriptions, example values, constraints, and access modes that appear in the generated API documentation. Good model documentation helps API consumers understand the shape and constraints of data without reading separate documentation — each field's purpose, format, and validation rules are visible directly in the interactive API explorer.

### Request/Response Models

```java
@Schema(description = "Product response object")
public class ProductResponse {

    @Schema(description = "Unique product identifier", example = "12345", accessMode = Schema.AccessMode.READ_ONLY)
    private Long id;

    @Schema(description = "Product name", example = "Wireless Bluetooth Headphones")
    private String name;

    @Schema(description = "Product description", example = "High-quality wireless headphones with noise cancellation")
    private String description;

    @Schema(description = "Product price in USD", example = "99.99", minimum = "0.01")
    private BigDecimal price;

    @Schema(description = "Currency code (ISO 4217)", example = "USD", defaultValue = "USD")
    private String currency;

    @Schema(description = "Stock keeping unit", example = "WBH-001")
    private String sku;

    @Schema(description = "Available stock quantity", example = "150")
    private Integer stockQuantity;

    @Schema(description = "Product category", implementation = CategorySummary.class)
    private CategorySummary category;

    @Schema(description = "Product status", example = "ACTIVE", allowableValues = {"ACTIVE", "INACTIVE", "DISCONTINUED"})
    private String status;

    @Schema(description = "Product creation timestamp", example = "2026-05-11T10:00:00Z")
    private Instant createdAt;
}

@Schema(description = "Product creation request")
public class CreateProductRequest {

    @Schema(description = "Product name", example = "Wireless Bluetooth Headphones", required = true, minLength = 1, maxLength = 200)
    @NotBlank @Size(max = 200)
    private String name;

    @Schema(description = "Product description", example = "High-quality wireless headphones")
    @Size(max = 5000)
    private String description;

    @Schema(description = "Product price", example = "99.99", required = true, minimum = "0.01")
    @NotNull @DecimalMin("0.01")
    private BigDecimal price;

    @Schema(description = "Currency code", example = "USD", defaultValue = "USD")
    private String currency;

    @Schema(description = "Category ID", example = "5", required = true)
    @NotNull
    private Long categoryId;

    @Schema(description = "Initial stock quantity", example = "100", minimum = "0")
    @Min(0)
    private Integer stockQuantity;
}

@Schema(description = "Standard error response")
public class ErrorResponse {

    @Schema(description = "Error type URI", example = "https://api.example.com/errors/not-found")
    private String type;

    @Schema(description = "Error title", example = "Resource Not Found")
    private String title;

    @Schema(description = "HTTP status code", example = "404")
    private int status;

    @Schema(description = "Detailed error message", example = "Product with id 12345 not found")
    private String detail;

    @Schema(description = "Request URI that caused the error", example = "/api/v1/products/12345")
    private String instance;

    @Schema(description = "Error timestamp", example = "2026-05-11T10:00:00Z")
    private Instant timestamp;
}
```

---

## Grouped OpenAPI Documentation

For large applications with multiple API modules (admin, public, internal), grouping endpoints into separate OpenAPI specifications improves organization and readability. Each group can have its own title, description, security requirements, and base path. SpringDoc's `GroupedOpenApi` bean configures this partitioning declaratively. Groups can be accessed at separate URLs (e.g., `/v3/api-docs/admin`, `/v3/api-docs/public`) and shown as separate entries in Swagger UI's dropdown.

### Multi-Module API Groups

```java
@Configuration
public class OpenApiGroupConfig {

    @Bean
    public GroupedOpenApi adminApi() {
        return GroupedOpenApi.builder()
            .group("admin")
            .displayName("Admin API")
            .description("APIs for admin operations - requires admin role")
            .pathsToMatch("/api/v1/admin/**")
            .addOpenApiCustomizer(openApi -> openApi
                .info(new Info()
                    .title("Admin API")
                    .version("1.0.0")
                    .description("Internal admin APIs for platform management")))
            .build();
    }

    @Bean
    public GroupedOpenApi publicApi() {
        return GroupedOpenApi.builder()
            .group("public")
            .displayName("Public API")
            .description("Public APIs accessible without authentication")
            .pathsToMatch("/api/v1/public/**")
            .build();
    }

    @Bean
    public GroupedOpenApi productApi() {
        return GroupedOpenApi.builder()
            .group("products")
            .displayName("Product API")
            .description("Product management APIs")
            .pathsToMatch("/api/v1/products/**")
            .build();
    }

    @Bean
    public GroupedOpenApi orderApi() {
        return GroupedOpenApi.builder()
            .group("orders")
            .displayName("Order API")
            .description("Order management APIs")
            .pathsToMatch("/api/v1/orders/**")
            .build();
    }
}
```

---

## Code Generation from OpenAPI

One of the most powerful features of OpenAPI is the ability to generate client SDKs and server stubs automatically from the specification. The OpenAPI Generator Maven plugin produces type-safe API clients, request/response models, and controller interfaces in multiple languages. This eliminates manual translation between spec and code, reduces integration errors, and ensures that the client code always matches the API contract. The generated code can be used within the same project (as server stubs) or published as a library for external consumers.

### Maven Plugin Configuration

```java
@RestController
public class ProductsApiController implements ProductsApi {

    private final ProductService productService;

    @Override
    public ResponseEntity<ProductResponse> getProduct(Long id) {
        Product product = productService.findById(id);
        return ResponseEntity.ok(mapToResponse(product));
    }

    @Override
    public ResponseEntity<PageResponse> searchProducts(String q, Long categoryId,
                                                        BigDecimal minPrice, BigDecimal maxPrice,
                                                        Integer page, Integer size, String sort) {
        Pageable pageable = PageRequest.of(page, size, parseSort(sort));
        Page<Product> products = productService.search(q, categoryId, minPrice, maxPrice, pageable);
        return ResponseEntity.ok(PageResponse.of(products.map(this::mapToResponse)));
    }
}
```

---

## Best Practices

A well-maintained OpenAPI specification is the single source of truth for your API contract. It should be treated as a living document that evolves alongside your code. The following practices ensure your documentation remains accurate, useful, and valuable to API consumers.

1. **Document every endpoint**: All public endpoints need OpenAPI docs
2. **Provide examples**: Realistic examples for request/response models
3. **Document error responses**: Include 4xx and 5xx response schemas
4. **Use tags for grouping**: Organize endpoints by domain
5. **Security schemes**: Document authentication methods
6. **Version your API spec**: Keep spec in sync with API version
7. **Validate spec in CI**: Catch breaking changes early
8. **Generate client SDKs**: Auto-generate from spec
9. **Keep spec DRY**: Use $ref and components
10. **Update regularly**: Spec must stay in sync with implementation

```java
// CI validation
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiValidationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void openApiSpecIsValid() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.openapi").value("3.0.3"))
            .andExpect(jsonPath("$.info.title").isNotEmpty())
            .andExpect(jsonPath("$.paths").isNotEmpty());
    }
}
```

---

## Common Mistakes

### Mistake 1: Missing Schema Definitions

Without `@Schema` annotations on model classes, the generated OpenAPI spec lacks field descriptions, example values, and type constraints. This produces generic documentation that requires clients to guess field meanings and formats. Every public-facing model class should have `@Schema` annotations on both the class and each field, with meaningful descriptions and realistic example values. The effort invested in annotation pays dividends every time a developer uses your API documentation.

```java
// WRONG: No schema annotation on response objects
public class ProductResponse {
    private Long id;
    private String name;
    // No @Schema annotations
}

// CORRECT: Document all fields
@Schema(description = "Product response")
public class ProductResponse {
    @Schema(description = "Product ID", example = "12345")
    private Long id;
}
```

### Mistake 2: Outdated Documentation

Documentation drift — where the OpenAPI spec no longer matches the actual implementation — is the most common complaint API consumers have. This happens when developers add or change endpoints without updating the spec. The solution is to treat the spec as code: include it in version control, validate it in CI/CD, and fail the build if the generated spec differs from the committed spec. Tools like `springdoc-openapi-maven-plugin` can auto-generate the spec during the build and fail if there are discrepancies.

```java
// WRONG: Spec doesn't match implementation
// Controller accepts new field, but spec doesn't show it

// CORRECT: Keep spec in CI/CD pipeline
// Fail build if spec differs from implementation
```

### Mistake 3: Exposing Internal Details

Auto-generated documentation can inadvertently expose internal implementation details that should never be visible to API consumers. Fields like `passwordHash`, `internalNotes`, or database IDs that leak internal structure create security vulnerabilities and confuse consumers. Always use dedicated DTOs for API responses (never expose entity classes directly), and review the generated OpenAPI spec for fields that should be excluded. Use `@Schema(hidden = true)` or Jackson's `@JsonIgnore` to prevent internal fields from appearing in documentation.

```java
// WRONG: Internal fields exposed in API response
@Schema
public class UserResponse {
    private String passwordHash;  // Should not be exposed!
    private String internalNotes;
}

// CORRECT: Only expose intended fields
```

---

## Summary

1. OpenAPI 3.0 is the standard for REST API documentation
2. SpringDoc integrates OpenAPI seamlessly with Spring Boot
3. Document all endpoints, parameters, and response schemas
4. Use tags for logical grouping of endpoints
5. Configure security schemes for authentication documentation
6. Group endpoints by domain for large applications
7. Generate client SDK and server stubs from spec
8. Validate spec in CI pipeline to prevent drift
9. Provide realistic examples in all schemas
10. Keep documentation up-to-date with implementation

---

## References

- [OpenAPI Specification 3.0](https://spec.openapis.org/oas/v3.0.3)
- [SpringDoc Documentation](https://springdoc.org/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
- [OpenAPI Generator](https://openapi-generator.tech/)

Happy Coding