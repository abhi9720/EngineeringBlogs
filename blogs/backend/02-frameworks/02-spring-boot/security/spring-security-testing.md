---
title: Spring Security Testing
description: >-
  Master security testing in Spring Boot applications: @WithMockUser,
  @WithUserDetails, security test annotations, and testing OAuth2 and method
  security
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - spring-security
  - testing
  - security-testing
coverImage: /images/spring-security-testing.png
draft: false
order: 40
---
## Overview

Testing security concerns is critical for any application. Spring Security provides powerful test annotations and utilities to test authentication, authorization, CSRF protection, and method-level security without needing to mock complex security contexts.

Security tests should cover three scenarios: authenticated access (the user has the right permissions), unauthenticated access (no user), and unauthorized access (the user lacks required permissions). Testing all three ensures your security configuration is correct.

## Dependencies

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
```

## @WithMockUser

### Basic Usage

`@WithMockUser` creates a `SecurityContext` with a mock `UsernamePasswordAuthenticationToken`. It's the fastest way to test security because it doesn't load any `UserDetails` or call any services. The `roles` attribute is automatically prefixed with `ROLE_`.

```java
@WebMvcTest(UserController.class)
class UserControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    @WithMockUser(roles = "USER")
    void shouldReturnUserForAuthenticatedUser() throws Exception {
        when(userService.findById(1L)).thenReturn(Optional.of(
            new User(1L, "john@example.com", "John")));
        mockMvc.perform(get("/api/users/1")).andExpect(status().isOk());
    }

    @Test
    void shouldReturn401ForUnauthenticatedUser() throws Exception {
        mockMvc.perform(get("/api/users/1")).andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(username = "manager", roles = "MANAGER")
    void managerCanAccessAdminEndpoints() throws Exception {
        mockMvc.perform(get("/api/admin/reports")).andExpect(status().isOk());
    }

    @Test
    @WithMockUser(username = "user", roles = "USER")
    void userCannotAccessAdminEndpoints() throws Exception {
        mockMvc.perform(get("/api/admin/reports")).andExpect(status().isForbidden());
    }
}
```

### Custom User Details

Create reusable meta-annotations to reduce boilerplate. The `@WithAdminUser` and `@WithStandardUser` annotations encapsulate the mock user configuration.

```java
@Retention(RetentionPolicy.RUNTIME)
@WithMockUser(username = "admin", roles = {"ADMIN", "USER"})
public @interface WithAdminUser {}

@Retention(RetentionPolicy.RUNTIME)
@WithMockUser(username = "john", roles = "USER")
public @interface WithStandardUser {}

@WebMvcTest(AdminController.class)
class AdminControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithAdminUser
    void adminCanDeleteUsers() throws Exception {
        mockMvc.perform(delete("/api/admin/users/1")).andExpect(status().isNoContent());
    }

    @Test
    @WithStandardUser
    void standardUserCannotDeleteUsers() throws Exception {
        mockMvc.perform(delete("/api/admin/users/1")).andExpect(status().isForbidden());
    }
}
```

## @WithUserDetails

### Using Custom UserDetailsService

`@WithUserDetails` loads the user from a `UserDetailsService`. This is useful when your method security expressions reference specific user properties (name, email, department). The user is fully loaded with all attributes and authorities.

```java
@Service
public class TestUserDetailsService implements UserDetailsService {
    @Override
    public UserDetails loadUserByUsername(String username) {
        return switch (username) {
            case "admin" -> User.withUsername("admin").password("password").roles("ADMIN", "USER").build();
            case "user" -> User.withUsername("user").password("password").roles("USER").build();
            case "premium" -> User.withUsername("premium").password("password").roles("PREMIUM_USER").build();
            default -> throw new UsernameNotFoundException("User not found");
        };
    }
}

@WebMvcTest(SubscriptionController.class)
@Import(TestUserDetailsService.class)
class SubscriptionControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithUserDetails("admin")
    void adminCanAccessAllSubscriptions() throws Exception {
        mockMvc.perform(get("/api/subscriptions")).andExpect(status().isOk());
    }

    @Test
    @WithUserDetails("premium")
    void premiumUserCanAccessPremiumFeatures() throws Exception {
        mockMvc.perform(get("/api/subscriptions/premium")).andExpect(status().isOk());
    }

    @Test
    @WithUserDetails("user")
    void standardUserCannotAccessPremiumFeatures() throws Exception {
        mockMvc.perform(get("/api/subscriptions/premium")).andExpect(status().isForbidden());
    }
}
```

## Testing CSRF

Spring Security Test's `.with(csrf())` request post processor adds a valid CSRF token to the request. Test with and without the token to verify CSRF protection works.

```java
@WebMvcTest(UserController.class)
class CsrfTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldRejectPostWithoutCsrfToken() throws Exception {
        mockMvc.perform(post("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"test\"}"))
            .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser
    void shouldAcceptPostWithCsrfToken() throws Exception {
        mockMvc.perform(post("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"test\"}")
                .with(csrf()))
            .andExpect(status().isCreated());
    }

    @Test
    @WithMockUser
    void shouldRejectPutWithInvalidCsrfToken() throws Exception {
        mockMvc.perform(put("/api/users/1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"updated\"}")
                .with(csrf().useInvalidToken()))
            .andExpect(status().isForbidden());
    }
}
```

## Testing OAuth2

### OAuth2 Resource Server Testing

Use `.with(jwt())` to simulate authenticated requests with a JWT token. The `.jwt()` callback lets you customize claims, subject, and scope.

```java
@WebMvcTest(OrderController.class)
class OAuth2ResourceServerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldAllowAccessWithValidToken() throws Exception {
        mockMvc.perform(get("/api/orders")
                .with(jwt().jwt(jwt -> jwt.subject("user123").claim("scope", "read:orders"))))
            .andExpect(status().isOk());
    }

    @Test
    void shouldRejectAccessWithoutToken() throws Exception {
        mockMvc.perform(get("/api/orders")).andExpect(status().isUnauthorized());
    }

    @Test
    void shouldRejectAccessWithInsufficientScope() throws Exception {
        mockMvc.perform(get("/api/orders")
                .with(jwt().jwt(jwt -> jwt.subject("user123").claim("scope", "read:users"))))
            .andExpect(status().isForbidden());
    }

    @Test
    void shouldAllowAdminAccess() throws Exception {
        mockMvc.perform(get("/api/admin/orders")
                .with(jwt().jwt(jwt -> jwt.subject("admin").claim("scope", "admin")
                    .claim("realm_access", Map.of("roles", List.of("ADMIN"))))))
            .andExpect(status().isOk());
    }
}
```

### Custom OAuth2 Test Annotations

```java
@Retention(RetentionPolicy.RUNTIME)
@WithMockUser(authorities = "SCOPE_read:orders")
public @interface WithReadOrdersScope {}

@Retention(RetentionPolicy.RUNTIME)
@WithMockUser(authorities = {"SCOPE_admin", "ROLE_ADMIN"})
public @interface WithAdminScope {}

@WebMvcTest(InventoryController.class)
class InventoryControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithReadOrdersScope
    void shouldAccessWithReadScope() throws Exception {
        mockMvc.perform(get("/api/inventory")).andExpect(status().isOk());
    }

    @Test
    @WithAdminScope
    void adminCanManageInventory() throws Exception {
        mockMvc.perform(post("/api/inventory/items")
                .contentType(MediaType.APPLICATION_JSON).with(csrf())
                .content("{\"name\":\"New Item\",\"quantity\":10}"))
            .andExpect(status().isCreated());
    }

    @Test
    @WithAnonymousUser
    void anonymousCannotAccessInventory() throws Exception {
        mockMvc.perform(get("/api/inventory")).andExpect(status().isUnauthorized());
    }
}
```

## Testing Method Security

```java
@SpringBootTest
@AutoConfigureMockMvc
class DocumentServiceSecurityTest {
    @Autowired
    private DocumentService documentService;

    @MockBean
    private DocumentRepository documentRepository;

    @Test
    @WithMockUser(username = "owner", roles = "USER")
    void userCanReadOwnDocument() {
        Document doc = new Document(1L, "My Doc", "owner", false);
        when(documentRepository.findById(1L)).thenReturn(Optional.of(doc));
        Document result = documentService.getDocument(1L);
        assertThat(result).isNotNull();
    }

    @Test
    @WithMockUser(username = "other", roles = "USER")
    void userCannotReadOthersPrivateDocument() {
        Document doc = new Document(1L, "Private Doc", "owner", false);
        when(documentRepository.findById(1L)).thenReturn(Optional.of(doc));
        assertThrows(AccessDeniedException.class, () -> documentService.getDocument(1L));
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void adminCanReadAnyDocument() {
        Document doc = new Document(1L, "Private Doc", "owner", false);
        when(documentRepository.findById(1L)).thenReturn(Optional.of(doc));
        Document result = documentService.getDocument(1L);
        assertThat(result).isNotNull();
    }
}
```

## Testing Security Headers

```java
@WebMvcTest(HomeController.class)
class SecurityHeadersTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldIncludeSecurityHeaders() throws Exception {
        mockMvc.perform(get("/"))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().string("X-Frame-Options", "DENY"))
            .andExpect(header().string("X-XSS-Protection", "0"))
            .andExpect(header().string("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate"));
    }

    @Test
    void shouldIncludeStrictTransportSecurityHeader() throws Exception {
        mockMvc.perform(get("/").secure(true))
            .andExpect(header().string("Strict-Transport-Security",
                "max-age=31536000; includeSubDomains"));
    }
}
```

## Security Test Utilities

```java
@Component
public class SecurityTestUtils {

    public static Authentication createAuthentication(String username, String... roles) {
        return new UsernamePasswordAuthenticationToken(username, "password",
            Arrays.stream(roles).map(role -> new SimpleGrantedAuthority("ROLE_" + role)).toList());
    }

    public static void runAs(String username, String... roles) {
        SecurityContextHolder.getContext().setAuthentication(createAuthentication(username, roles));
    }

    public static void runAsAnonymous() {
        SecurityContextHolder.getContext().setAuthentication(
            new AnonymousAuthenticationToken("key", "anonymous",
                List.of(new SimpleGrantedAuthority("ROLE_ANONYMOUS"))));
    }

    public static void clearContext() { SecurityContextHolder.clearContext(); }
}
```

## Best Practices

1. **Use @WithMockUser for role-based tests** - simplest and fastest
2. **Use @WithUserDetails for custom UserDetails** when you need specific user data
3. **Always test both authenticated and unauthenticated** scenarios
4. **Test CSRF protection** for state-changing HTTP methods
5. **Use custom meta-annotations** to reduce test boilerplate
6. **Test OAuth2 scopes and authorities separately** from roles

## Common Mistakes

### Mistake 1: Testing Without Security Context

```java
// Wrong: Direct service call without security context
@SpringBootTest
class DocumentServiceTest {
    @Autowired
    private DocumentService documentService;

    @Test
    void testMethodSecurity() {
        documentService.getDocument(1L); // Will fail - no authentication
    }
}

// Correct: Set up security context
@SpringBootTest
class DocumentServiceTest {
    @Autowired
    private DocumentService documentService;

    @Test
    @WithMockUser(roles = "USER")
    void testMethodSecurity() {
        documentService.getDocument(1L);
    }
}
```

### Mistake 2: Not Testing Negative Cases

```java
// Wrong: Only testing authorized access
@WebMvcTest(AdminController.class)
class AdminControllerTest {
    @Test
    @WithMockUser(roles = "ADMIN")
    void adminCanAccess() throws Exception {
        mockMvc.perform(get("/api/admin")).andExpect(status().isOk());
    }
}

// Correct: Test both positive and negative cases
@WebMvcTest(AdminController.class)
class AdminControllerTest {
    @Test
    @WithMockUser(roles = "ADMIN")
    void adminCanAccess() throws Exception {
        mockMvc.perform(get("/api/admin")).andExpect(status().isOk());
    }

    @Test
    @WithMockUser(roles = "USER")
    void userCannotAccess() throws Exception {
        mockMvc.perform(get("/api/admin")).andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedUserCannotAccess() throws Exception {
        mockMvc.perform(get("/api/admin")).andExpect(status().isUnauthorized());
    }
}
```

## Summary

Spring Security Test provides powerful annotations and utilities for testing authentication and authorization. Use @WithMockUser for simple role tests, @WithUserDetails for custom user scenarios, and .with(csrf()) for state-changing operations. Always test both authorized and unauthorized access to ensure your security configuration works correctly.

## References

- [Spring Security Testing Guide](https://docs.spring.io/spring-security/reference/servlet/test/index.html)
- [Testing Method Security](https://docs.spring.io/spring-security/reference/servlet/test/method.html)
- [Testing OAuth2](https://docs.spring.io/spring-security/reference/servlet/test/oauth2.html)
- [MockMVC with CSRF](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/test/web/servlet/request/CsrfRequestPostProcessor.html)

Happy Coding
