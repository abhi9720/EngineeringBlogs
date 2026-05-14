---
title: "OAuth2 with Spring Security"
description: "Implement OAuth2 authentication and authorization with Spring Security: authorization server, resource server, client registration, and JWT token handling"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - oauth2
  - spring-security
  - authentication
coverImage: "/images/oauth2-with-spring-security.png"
draft: false
---

## Overview

OAuth2 is the industry-standard protocol for authorization. Spring Security provides comprehensive support for OAuth2, including authorization server, resource server, and client configurations. This guide covers implementing OAuth2 with JWT tokens, securing APIs, and integrating with identity providers.

OAuth2 separates three roles: the resource owner (user), the client (application), and the authorization server (identity provider). The client obtains an access token from the authorization server and presents it to the resource server (your API) to access protected resources. This delegation eliminates the need for your API to handle passwords directly.

## OAuth2 Architecture

The flow below shows the standard authorization code flow. The user authenticates with the authorization server, which issues an access token (JWT). The client presents this token to the resource server, which validates it and returns the requested data. The resource server never sees the user's credentials.

`mermaid
flowchart LR
    User[User Browser] --> AS[Authorization Server<br/>Keycloak/Auth0]
    Client[Client App] --> AS
    AS --> Client
    AS --> RS[Resource Server<br/>Your API]
    Client --> RS

    User -.->|1. Auth Request| AS
    AS -.->|2. Access Token JWT| Client
    Client -.->|3. API Request + JWT| RS
    RS -.->|4. Protected Data| Client

    linkStyle default stroke:#278ea5

    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff

    class User,Client yellow
    class AS blue
    class RS green
`

## Dependencies

`xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
`

## Resource Server Configuration

### JWT Configuration

The resource server configuration begins with the issuer URI. Spring Security uses this URI to discover the authorization server's public keys via the JWK Set URI (JWKS) endpoint. It downloads the keys, caches them, and uses them to verify incoming JWT signatures.

The issuer-uri is used for both key discovery and token validation. Spring Security automatically constructs the JWKS URI by appending /protocol/openid-connect/certs for Keycloak or using the standard OIDC discovery endpoint. You can override this with jwk-set-uri for non-standard providers.

`yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.example.com/realms/my-realm
          jwk-set-uri: https://auth.example.com/realms/my-realm/protocol/openid-connect/certs
`

### Security Configuration

The security configuration secures specific URL patterns with different scopes. The jwtAuthenticationConverter maps JWT claims to Spring Security authorities. By default, the scope claim is used; the converter maps each scope to an authority prefixed with SCOPE_.

The configuration below enforces scopes for specific endpoints: GET /api/users/** requires SCOPE_read:users, while POST /api/users/** requires SCOPE_write:users. The /api/admin/** endpoints use role-based access (ROLE_ADMIN).

`java
@Configuration
@EnableWebSecurity
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class ResourceServerConfig {

    @Bean
    public SecurityFilterChain resourceServerFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/users/**").hasAuthority("SCOPE_read:users")
                .requestMatchers(HttpMethod.POST, "/api/users/**").hasAuthority("SCOPE_write:users")
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            )
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .csrf(csrf -> csrf.disable());
        return http.build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter grantedAuthorities = new JwtGrantedAuthoritiesConverter();
        grantedAuthorities.setAuthorityPrefix("SCOPE_");
        grantedAuthorities.setAuthoritiesClaimName("scope");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(grantedAuthorities);
        return converter;
    }
}
`

### Custom JWT Authentication

For identity providers like Keycloak, roles are embedded in custom claims (ealm_access.roles and esource_access.*.roles). The custom converter below extracts these and maps them to ROLE_ prefixed authorities. This lets you use hasRole('ADMIN') in security expressions.

The converter first extracts standard scopes, then parses the ealm_access claim for realm-level roles, and finally parses esource_access for client-specific roles. Each role is prefixed with the resource name to prevent collisions between different clients.

`java
@Component
public class CustomJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {
    private final JwtGrantedAuthoritiesConverter defaultConverter = new JwtGrantedAuthoritiesConverter();

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        Collection<GrantedAuthority> authorities = new ArrayList<>();

        // Extract standard scope authorities
        authorities.addAll(defaultConverter.convert(jwt));

        // Extract realm roles from JWT
        Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
        if (realmAccess != null) {
            List<String> roles = (List<String>) realmAccess.get("roles");
            if (roles != null) {
                roles.forEach(role -> authorities.add(
                    new SimpleGrantedAuthority("ROLE_" + role.toUpperCase())
                ));
            }
        }

        // Extract resource roles
        Map<String, Object> resourceAccess = jwt.getClaimAsMap("resource_access");
        if (resourceAccess != null) {
            resourceAccess.forEach((resource, access) -> {
                Map<String, Object> accessMap = (Map<String, Object>) access;
                List<String> roles = (List<String>) accessMap.get("roles");
                if (roles != null) {
                    roles.forEach(role -> authorities.add(
                        new SimpleGrantedAuthority(resource + "_" + role.toUpperCase())
                    ));
                }
            });
        }

        return new JwtAuthenticationToken(jwt, authorities);
    }
}
`

### Custom JWT Validator

Beyond signature validation, you should validate JWT claims at the application level. The AudienceValidator below checks that the token contains the expected audience. Without this, a token issued for one API could be used against another API using the same authorization server.

`java
@Component
public class AudienceValidator implements ReactiveJwtClaimsValidator {
    private final String expectedAudience;

    public AudienceValidator(@Value("") String audience) {
        this.expectedAudience = audience;
    }

    @Override
    public Mono<Void> validate(Jwt jwt) {
        List<String> audiences = jwt.getAudience();
        if (audiences == null || audiences.isEmpty()) {
            return Mono.error(new JwtValidationException("Missing audience", List.of(
                new OAuth2Error("invalid_token", "Token has no audience", null)
            )));
        }
        if (!audiences.contains(expectedAudience)) {
            return Mono.error(new JwtValidationException("Invalid audience", List.of(
                new OAuth2Error("invalid_token", "Token audience does not match", null)
            )));
        }
        return Mono.empty();
    }
}
`

## OAuth2 Client Configuration

### Social Login (Google/GitHub)

Spring Security's OAuth2 client support makes social login straightforward. Register each provider with its client ID and secret. The provider metadata (authorization URI, token URI, user info URI) is usually auto-configured for well-known providers like Google and GitHub.

For custom providers, specify all URIs explicitly under provider.*. The user-name-attribute maps to the claim that uniquely identifies the user (typically sub or email).

`yaml
spring:
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: 
            client-secret: 
            scope:
              - email
              - profile
          github:
            client-id: 
            client-secret: 
            scope:
              - user:email
              - read:user
        provider:
          google:
            authorization-uri: https://accounts.google.com/o/oauth2/v2/auth
            token-uri: https://oauth2.googleapis.com/token
            user-info-uri: https://www.googleapis.com/oauth2/v3/userinfo
            user-name-attribute: sub
`

### Client Controller

`java
@RestController
public class OAuth2LoginController {

    @GetMapping("/login/oauth2")
    public Map<String, String> loginProviders() {
        return Map.of(
            "google", "/oauth2/authorization/google",
            "github", "/oauth2/authorization/github"
        );
    }

    @GetMapping("/user/me")
    public Map<String, Object> currentUser(@AuthenticationPrincipal OAuth2User principal) {
        if (principal == null) {
            return Map.of("error", "Not authenticated");
        }
        return Map.of(
            "name", principal.getAttribute("name"),
            "email", principal.getAttribute("email"),
            "provider", principal.getAttribute("sub")
        );
    }
}
`

### Custom User Registration

When a user logs in via OAuth2 for the first time, you need to register them in your local database. Override DefaultOAuth2UserService.loadUser() to add custom registration logic. The service below creates a new User entity if the email doesn't exist in the local database, linking the OAuth2 identity to an internal user record.

`java
@Service
public class OAuth2UserService extends DefaultOAuth2UserService {
    private final UserRepository userRepository;

    public OAuth2UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) {
        OAuth2User oauth2User = super.loadUser(userRequest);
        String registrationId = userRequest.getClientRegistration().getRegistrationId();

        String email = oauth2User.getAttribute("email");
        String name = oauth2User.getAttribute("name");

        User user = userRepository.findByEmail(email)
            .orElseGet(() -> registerNewUser(email, name, registrationId));

        Map<String, Object> attributes = new HashMap<>(oauth2User.getAttributes());
        attributes.put("internalUserId", user.getId());

        return new DefaultOAuth2User(
            List.of(new SimpleGrantedAuthority("ROLE_USER")),
            attributes,
            "email"
        );
    }

    private User registerNewUser(String email, String name, String provider) {
        User user = new User();
        user.setEmail(email);
        user.setName(name);
        user.setProvider(provider);
        user.setRole(UserRole.USER);
        user.setEmailVerified(true);
        return userRepository.save(user);
    }
}
`

## JWT Token Customization

### Custom Token Claims

`java
@Component
public class CustomTokenEnhancer implements TokenEnhancer {
    @Override
    public OAuth2AccessToken enhance(OAuth2AccessToken accessToken,
                                     OAuth2Authentication authentication) {
        Map<String, Object> additionalInfo = new HashMap<>();
        UserDetails user = (UserDetails) authentication.getPrincipal();

        additionalInfo.put("organization", user.getOrganization());
        additionalInfo.put("department", user.getDepartment());
        additionalInfo.put("roles", user.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .toList());

        ((DefaultOAuth2AccessToken) accessToken)
            .setAdditionalInformation(additionalInfo);
        return accessToken;
    }
}
`

### JWT with Custom Claims

`java
@Service
public class TokenService {
    private final JwtEncoder jwtEncoder;

    public TokenService(JwtEncoder jwtEncoder) {
        this.jwtEncoder = jwtEncoder;
    }

    public String generateToken(Authentication authentication) {
        Instant now = Instant.now();
        String scope = authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.joining(" "));

        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("self")
            .issuedAt(now)
            .expiresAt(now.plus(1, ChronoUnit.HOURS))
            .subject(authentication.getName())
            .claim("scope", scope)
            .claim("department", extractDepartment(authentication))
            .claim("organization_id", extractOrganizationId(authentication))
            .build();

        return jwtEncoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }

    private String extractDepartment(Authentication authentication) {
        if (authentication.getPrincipal() instanceof UserDetails user) {
            return user.getDepartment();
        }
        return "unknown";
    }

    private String extractOrganizationId(Authentication authentication) {
        if (authentication.getPrincipal() instanceof UserDetails user) {
            return user.getOrganizationId();
        }
        return "unknown";
    }
}
`

## Multi-Tenant OAuth2

Multi-tenant OAuth2 support requires a dynamic JwtDecoder that selects the correct issuer and validation rules based on the token's iss claim. The MultiTenantJwtIssuerConfig caches decoders per issuer URI. The TenantAwareAuthenticationConverter reads the issuer from the JWT, selects the decoder, and validates the token.

Each tenant gets its own issuer URI, JWKS endpoint, audience validator, and issuer validator. This enables a single resource server to handle tokens from multiple identity providers.

`java
@Component
public class MultiTenantJwtIssuerConfig {
    private final Map<String, JwtDecoder> jwtDecoders = new ConcurrentHashMap<>();

    public JwtDecoder getDecoder(String issuer) {
        return jwtDecoders.computeIfAbsent(issuer, this::createDecoder);
    }

    private JwtDecoder createDecoder(String issuerUri) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder
            .withJwkSetUri(issuerUri + "/protocol/openid-connect/certs")
            .build();

        OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
            new JwtTimestampValidator(),
            new JwtIssuerValidator(issuerUri),
            new AudienceValidator("my-api")
        );
        decoder.setJwtValidator(validator);
        return decoder;
    }
}

@Component
public class TenantAwareAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {
    private final MultiTenantJwtIssuerConfig tenantConfig;

    public TenantAwareAuthenticationConverter(MultiTenantJwtIssuerConfig tenantConfig) {
        this.tenantConfig = tenantConfig;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        String issuer = jwt.getClaimAsString("iss");
        JwtDecoder decoder = tenantConfig.getDecoder(issuer);

        Jwt validated = decoder.decode(jwt.getTokenValue());
        // Proceed with validated token
        return new JwtAuthenticationToken(validated, extractAuthorities(jwt));
    }
}
`

## Testing OAuth2

`java
@WebMvcTest(UserController.class)
class UserControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    void shouldReturnUserWithValidToken() throws Exception {
        String token = createTestToken("read:users");

        mockMvc.perform(get("/api/users/1")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }

    @Test
    void shouldRejectRequestWithoutToken() throws Exception {
        mockMvc.perform(get("/api/users/1"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void shouldRejectRequestWithInvalidScope() throws Exception {
        String token = createTestToken("read:orders"); // Wrong scope

        mockMvc.perform(get("/api/users/1")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isForbidden());
    }

    private String createTestToken(String scope) {
        return "test-jwt-token"; // Use JWT test utilities in real tests
    }
}
`

## Best Practices

1. **Use asymmetric keys (RS256/RS384)** for JWT signing in production
2. **Keep token lifetimes short** (15-60 minutes for access tokens)
3. **Use refresh tokens** for long-lived sessions
4. **Validate all JWT claims** (iss, aud, exp, nbf, iat)
5. **Rotate signing keys periodically**
6. **Use opaque tokens for server-to-server** communication when revocation is needed
7. **Implement token revocation** via blacklist or introspection endpoint

## Common Mistakes

### Mistake 1: Storing Secrets in Code

`java
// Wrong: Secret hardcoded in configuration
@Bean
public JwtDecoder jwtDecoder() {
    return NimbusJwtDecoder.withSecretKey(
        new SecretKeySpec("my-secret-key-123".getBytes(), "HmacSHA256")
    ).build();
}
`

`java
// Correct: Use asymmetric keys with proper key management
@Bean
public JwtDecoder jwtDecoder(@Value("") RSAPublicKey publicKey) {
    return NimbusJwtDecoder.withPublicKey(publicKey).build();
}

// application.yml
jwt:
  public-key-location: classpath:keys/public.pem
`

### Mistake 2: Not Validating Token Claims

`java
// Wrong: Accepting any valid JWT without audience validation
@Bean
public JwtDecoder jwtDecoder(@Value("") String jwkUri) {
    return NimbusJwtDecoder.withJwkSetUri(jwkUri).build();
}
`

`java
// Correct: Validate all relevant claims
@Bean
public JwtDecoder jwtDecoder(@Value("") String jwkUri) {
    NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwkUri).build();

    OAuth2TokenValidator<Jwt> validator = new DelegatingOAuth2TokenValidator<>(
        new JwtTimestampValidator(),
        new JwtIssuerValidator("https://auth.example.com/realms/my-realm"),
        new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains("my-api"))
    );
    decoder.setJwtValidator(validator);
    return decoder;
}
`

### Mistake 3: Using Stateful Sessions with JWT

`java
// Wrong: Mixing JWT with session-based state
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(withDefaults()))
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.ALWAYS) // Creates sessions
            );
        return http.build();
    }
}
`

`java
// Correct: Stateless JWT authentication
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(withDefaults()))
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .csrf(csrf -> csrf.disable());
        return http.build();
    }
}
`

## Summary

Spring Security's OAuth2 support provides robust authentication and authorization for modern applications. By configuring a resource server with JWT validation, implementing proper token handling, and validating all claims, you can build secure, stateless APIs. Use asymmetric keys, keep tokens short-lived, and implement proper CORS and CSRF protection.

## References

- [Spring Security OAuth2](https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html)
- [OAuth2 Resource Server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html)
- [OAuth2 Client](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html)
- [JWT Specification](https://datatracker.ietf.org/doc/html/rfc7519)

Happy Coding
