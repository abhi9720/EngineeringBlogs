---
title: "Content Negotiation and Media Types"
description: "Master content negotiation in REST APIs: media types, Accept headers, custom serialization, and versioning through content types"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - content-negotiation
  - rest-api
  - media-types
  - spring-boot
coverImage: "/images/backend/api-design/rest/content-negotiation.png"
draft: false
---

# Content Negotiation and Media Types

## Overview

Content negotiation allows REST APIs to serve different representations of resources based on client capabilities and preferences. By leveraging HTTP content negotiation headers, APIs can support multiple formats, version resources through media types, and optimise payload size for different clients.

---

## HTTP Content Negotiation Headers

Content negotiation is a core feature of HTTP that allows a single endpoint to serve multiple representations of the same resource. The client expresses its preferences through standard HTTP headers (`Accept`, `Content-Type`), and the server selects the most appropriate representation. This decouples client capability from server implementation — the server can add new formats without breaking existing clients, and clients can specify their preferred format without changing URLs.

### Request Headers

The `Accept` header tells the server which media types the client can handle, in order of preference. The server uses the `produces` attribute in `@GetMapping` to declare which formats it supports. Spring automatically selects the best match based on the client's `Accept` header and the server's declared capabilities. The example supports four media types: standard JSON, standard XML, version 1 vendor-specific JSON, and version 2 vendor-specific JSON. Vendor-specific media types (like `application/vnd.api.v1+json`) provide a clean way to version resources at the representation level without changing URLs.

```java
@RestController
@RequestMapping("/api/users")
public class ContentNegotiationController {

    // Accept header determines response format
    @GetMapping(value = "/{id}", produces = {
        MediaType.APPLICATION_JSON_VALUE,
        MediaType.APPLICATION_XML_VALUE,
        "application/vnd.api.v1+json",
        "application/vnd.api.v2+json"
    })
    public ResponseEntity<User> getUser(
            @PathVariable Long id,
            @RequestHeader("Accept") String acceptHeader) {

        User user = userService.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        return ResponseEntity.ok(user);
    }
}
```

Content negotiation configuration in Spring gives fine-grained control over how media types are resolved. The `configureContentNegotiation` method supports multiple strategies: `favorParameter(true)` allows clients to specify the format via a query parameter (`?format=json`), path extension (`.json`), or the `Accept` header. For production APIs, prefer `Accept` header-based negotiation for REST purity, but offer query parameter fallback for simpler client integration. The `defaultContentType` ensures clients that don't specify a preference still receive a valid response.

### Custom Media Types for Versioning

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
        configurer
            .favorParameter(true)
            .parameterName("format")
            .mediaType("json", MediaType.APPLICATION_JSON)
            .mediaType("xml", MediaType.APPLICATION_XML)
            .mediaType("v1", MediaType.valueOf("application/vnd.api.v1+json"))
            .mediaType("v2", MediaType.valueOf("application/vnd.api.v2+json"))
            .ignoreAcceptHeader(false)
            .defaultContentType(MediaType.APPLICATION_JSON);
    }
}
```

---

## Media Type Versioning

Versioning through media types uses custom vendor-specific MIME types to differentiate API versions. Unlike URL path versioning (which changes the resource identifier), media type versioning keeps the URL stable and varies the representation. This approach aligns with REST principles — the same resource identifier returns different representations based on content negotiation. The trade-off is reduced discoverability: clients must know which media type to request, and it's harder to test from a browser.

### Versioned Media Types

The example shows V1 and V2 endpoints for the same user resource, distinguished only by the `produces` media type. V1 returns a `UserV1` with basic fields (id, name, email), while V2 returns `UserV2` with additional fields (phone, role, department, createdAt). Both endpoints use the same URL path `/api/users/{id}` — the client selects the version by sending `Accept: application/vnd.api.v1+json` or `Accept: application/vnd.api.v2+json`. This approach scales well because each version is a separate method with its own response DTO, and old versions can be deprecated independently.

```java
@RestController
@RequestMapping("/api/users")
public class VersionedUserController {

    // V1 endpoint - returns basic user data
    @GetMapping(value = "/{id}", produces = "application/vnd.api.v1+json")
    public ResponseEntity<UserV1> getUserV1(@PathVariable Long id) {
        User user = userService.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        // V1 returns limited fields
        UserV1 response = new UserV1(user.getId(), user.getName(), user.getEmail());

        return ResponseEntity.ok(response);
    }

    // V2 endpoint - returns extended user data
    @GetMapping(value = "/{id}", produces = "application/vnd.api.v2+json")
    public ResponseEntity<UserV2> getUserV2(@PathVariable Long id) {
        User user = userService.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("User not found"));

        // V2 includes additional fields
        UserV2 response = new UserV2(
            user.getId(),
            user.getName(),
            user.getEmail(),
            user.getPhone(),
            user.getRole(),
            user.getDepartment(),
            user.getCreatedAt()
        );

        return ResponseEntity.ok(response);
    }
}

class UserV1 {
    private final Long id;
    private final String name;
    private final String email;

    UserV1(Long id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }
}

class UserV2 {
    private final Long id;
    private final String name;
    private final String email;
    private final String phone;
    private final String role;
    private final String department;
    private final LocalDateTime createdAt;

    UserV2(Long id, String name, String email, String phone,
           String role, String department, LocalDateTime createdAt) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.phone = phone;
        this.role = role;
        this.department = department;
        this.createdAt = createdAt;
    }
}
```

The `Content-Type` header on requests tells the server how the request body is encoded. By specifying `consumes` on a `@PostMapping`, the controller restricts which request formats it accepts. If the client sends an unsupported content type, Spring automatically returns 415 Unsupported Media Type. Supporting multiple input formats (JSON and XML in this example) makes your API more flexible for diverse clients while maintaining strict validation of the accepted formats.

### Request Content Type

```java
@RestController
@RequestMapping("/api/users")
public class MultiFormatUserController {

    // Accepts JSON or XML input based on Content-Type header
    @PostMapping(consumes = {
        MediaType.APPLICATION_JSON_VALUE,
        MediaType.APPLICATION_XML_VALUE
    })
    public ResponseEntity<User> createUser(@RequestBody @Valid User user) {
        User created = userService.create(user);
        return ResponseEntity.created(
            URI.create("/api/users/" + created.getId())
        ).body(created);
    }
}
```

---

## Custom Serialization with Jackson

Custom serializers give you fine-grained control over how objects are converted to JSON (or XML). While Jackson's default serialization works well for simple cases, custom serializers enable conditional field inclusion, data masking, format customization, and backward-compatible output changes. Use custom serializers sparingly — they add maintenance overhead and can make the serialization behavior harder to reason about.

### Custom Serializers

The `UserSerializer` demonstrates several advanced serialization patterns: conditional field inclusion (address only shown if present), data masking (phone number partially masked for security), and custom field naming. This level of control is useful for APIs that serve multiple client types with different data sensitivity requirements. However, consider whether a DTO-based approach (separate response classes for different contexts) would be simpler and more maintainable than custom serializers.

```java
@Component
public class UserSerializer extends JsonSerializer<User> {

    @Override
    public void serialize(User user, JsonGenerator gen, SerializerProvider provider)
            throws IOException {

        gen.writeStartObject();
        gen.writeNumberField("id", user.getId());
        gen.writeStringField("name", user.getName());
        gen.writeStringField("email", user.getEmail());
        gen.writeStringField("role", user.getRole().name());

        // Conditional field based on user presence
        if (user.getAddress() != null) {
            gen.writeObjectFieldStart("address");
            gen.writeStringField("street", user.getAddress().getStreet());
            gen.writeStringField("city", user.getAddress().getCity());
            gen.writeStringField("country", user.getAddress().getCountry());
            gen.writeEndObject();
        }

        // Mask sensitive data
        if (user.getPhone() != null) {
            String masked = user.getPhone().replaceAll(".(?=.{4})", "*");
            gen.writeStringField("phone", masked);
        }

        gen.writeEndObject();
    }
}

@JsonSerialize(using = UserSerializer.class)
public class User {
    // Fields
}
```

Custom deserializers handle the reverse direction — converting incoming data to Java objects. They are particularly useful for accepting flexible input formats from clients. The `FlexibleDateDeserializer` example accepts multiple date formats (ISO, slash-separated, date-only) and converts them to `LocalDateTime`. This graceful format handling improves client developer experience by not requiring an exact date format. However, prefer accepting a single, well-documented format for new APIs — flexible deserialization adds complexity and can mask client errors.

### Custom Deserializers

```java
@Component
public class FlexibleDateDeserializer extends JsonDeserializer<LocalDateTime> {

    private static final List<DateTimeFormatter> FORMATTERS = List.of(
        DateTimeFormatter.ISO_LOCAL_DATE_TIME,
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd")
    );

    @Override
    public LocalDateTime deserialize(JsonParser p, DeserializationContext ctx)
            throws IOException {

        String dateStr = p.getText().trim();

        for (DateTimeFormatter formatter : FORMATTERS) {
            try {
                return LocalDateTime.parse(dateStr, formatter);
            } catch (DateTimeParseException e) {
                // Try next format
            }
        }

        // Try parsing as date only
        try {
            LocalDate date = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE);
            return date.atStartOfDay();
        } catch (DateTimeParseException e) {
            throw new JsonParseException(p, "Unable to parse date: " + dateStr);
        }
    }
}

public class Event {
    @JsonDeserialize(using = FlexibleDateDeserializer.class)
    private LocalDateTime eventDate;
}
```

---

## Multiple Representation Formats

### JSON and XML Support

```java
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilder objectMapperBuilder() {
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();

        builder.featuresToDisable(
            SerializationFeature.WRITE_DATES_AS_TIMESTAMPS,
            DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES
        );

        builder.featuresToEnable(
            SerializationFeature.INDENT_OUTPUT
        );

        builder.propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        builder.serializationInclusion(JsonInclude.Include.NON_NULL);

        builder.modules(new JavaTimeModule());

        return builder;
    }
}

// Enable XML support
@Configuration
public class XmlConfig {

    @Bean
    public MappingJackson2HttpMessageConverter jsonConverter() {
        return new MappingJackson2HttpMessageConverter();
    }

    @Bean
    public MappingJackson2XmlHttpMessageConverter xmlConverter() {
        return new MappingJackson2XmlHttpMessageConverter();
    }
}
```

### Content Negotiation Strategy

```java
@Component
public class NegotiationStrategy {

    private static final Map<String, MediaType> SUPPORTED_TYPES = Map.of(
        "json", MediaType.APPLICATION_JSON,
        "xml", MediaType.APPLICATION_XML,
        "yaml", MediaType.valueOf("application/x-yaml"),
        "csv", MediaType.valueOf("text/csv")
    );

    public MediaType resolveMediaType(HttpServletRequest request) {
        // Check query parameter first
        String format = request.getParameter("format");
        if (format != null && SUPPORTED_TYPES.containsKey(format.toLowerCase())) {
            return SUPPORTED_TYPES.get(format.toLowerCase());
        }

        // Fall back to Accept header
        String acceptHeader = request.getHeader("Accept");
        if (acceptHeader != null) {
            List<MediaType> acceptedTypes = MediaType.parseMediaTypes(acceptHeader);
            for (MediaType accepted : acceptedTypes) {
                for (MediaType supported : SUPPORTED_TYPES.values()) {
                    if (accepted.includes(supported)) {
                        return supported;
                    }
                }
            }
        }

        // Default to JSON
        return MediaType.APPLICATION_JSON;
    }
}
```

---

## Best Practices

1. **Use standard media types**: Prefer IANA-registered MIME types
2. **Version through media types**: Use vendor-specific media types for API versioning
3. **Support multiple formats**: JSON primary, XML/YAML as alternatives
4. **Default to JSON**: Most clients prefer JSON
5. **Validate Accept headers**: Return 406 Not Acceptable for unsupported types
6. **Document media types**: Clearly document all supported representations
7. **Use quality factors**: Respect client quality preferences (q-value)
8. **Content-Type validation**: Validate request content types
9. **Consistent serialization**: Use same naming strategy across formats
10. **Error messages in requested format**: Return error in client's requested format

```java
// Handle unsupported media types
@ControllerAdvice
public class NegotiationExceptionHandler {

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<Void> handleNotAcceptable() {
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE).build();
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Void> handleUnsupportedMediaType() {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).build();
    }
}
```

---

## Common Mistakes

### Mistake 1: Ignoring Accept Headers

```java
// WRONG: Always returns JSON regardless of Accept header
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) {
    return userService.findById(id);
}

// CORRECT: Support content negotiation
@GetMapping(value = "/users/{id}", produces = {
    MediaType.APPLICATION_JSON_VALUE,
    MediaType.APPLICATION_XML_VALUE
})
public User getUser(@PathVariable Long id) {
    return userService.findById(id);
}
```

### Mistake 2: Inconsistent Error Response Format

```java
// WRONG: Error response always in JSON even when client wants XML
// CORRECT: Error responses use same negotiation
@ExceptionHandler(ResourceNotFoundException.class)
public ResponseEntity<ErrorResponse> handleNotFound() {
    return ResponseEntity.notFound().build();
}
```

### Mistake 3: Exposing Internal Field Names

```java
// WRONG: Java field names exposed in responses
user_name vs userName inconsistency

// CORRECT: Use consistent naming strategy
@Configuration
public class JacksonConfig {
    @Bean
    public Jackson2ObjectMapperBuilder objectMapperBuilder() {
        builder.propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        return builder;
    }
}
```

---

## Summary

1. Content negotiation enables APIs to serve multiple representations
2. Use Accept headers for response format and Content-Type for request format
3. Vendor-specific media types provide clean API versioning
4. Custom serializers allow fine-grained control over data representation
5. Support JSON as default with XML/YAML as alternatives
6. Return 406 Not Acceptable for unsupported media types
7. Consistent naming strategies improve API usability

---

## References

- [RFC 7231 - Content Negotiation](https://tools.ietf.org/html/rfc7231#section-5.3)
- [RFC 4288 - Media Type Specifications](https://tools.ietf.org/html/rfc4288)
- [Spring Content Negotiation Guide](https://www.baeldung.com/spring-content-negotiation)
- [Jackson JSON Documentation](https://github.com/FasterXML/jackson-docs)

Happy Coding