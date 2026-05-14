---
title: "API Authentication Methods"
description: "Compare API authentication methods: Basic Auth, API Keys, JWT, OAuth 2.0, OpenID Connect, and implementation patterns in Spring Boot"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - authentication
  - jwt
  - oauth2
  - api-security
coverImage: "/images/backend/api-design/api-security/api-authentication-methods.png"
draft: false
---

# API Authentication Methods

## Overview

API authentication verifies the identity of clients accessing your API. Choosing the right authentication method depends on security requirements, client type, and operational constraints. This guide covers the most common authentication mechanisms and their appropriate use cases.

---

## Authentication Methods Comparison

```
Method              | Security Level | Complexity | Use Case
--------------------|----------------|------------|--------------------------
Basic Auth          | Low            | Minimal    | Internal tools, testing
API Keys            | Medium         | Low        | Public APIs, SDKs
JWT (Bearer Token)  | High           | Medium     | Web apps, mobile apps
OAuth 2.0           | Very High      | High       | Third-party access
OpenID Connect      | Very High      | High       | Single sign-on
Mutual TLS          | Very High      | High       | B2B, microservices
```

---

## 1. Basic Authentication

### Spring Boot Security Configuration

```java
@Configuration
@EnableWebSecurity
public class BasicAuthConfig {

    @Bean
    public SecurityFilterChain basicAuthFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/basic/**")
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated())
            .httpBasic(Customizer.withDefaults())
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS));

        return http.build();
    }

    @Bean
    public UserDetailsService userDetailsService() {
        UserDetails user = User.builder()
            .username("api-client")
            .password(passwordEncoder().encode("secret-password"))
            .roles("API_USER")
            .build();

        return new InMemoryUserDetailsManager(user);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### Client Implementation

```java
// Client: Authorization header with Base64 encoded credentials
byte[] credentials = "api-client:secret-password".getBytes(StandardCharsets.UTF_8);
String encoded = Base64.getEncoder().encodeToString(credentials);

HttpRequest request = HttpRequest.newBuilder()
    .header("Authorization", "Basic " + encoded)
    .uri(URI.create("https://api.example.com/api/basic/data"))
    .GET()
    .build();
```

---

## 2. API Keys

### API Key Authentication Filter

```java
@Component
public class ApiKeyAuthenticationFilter extends OncePerRequestFilter {

    private static final String API_KEY_HEADER = "X-API-Key";
    private static final String API_KEY_PARAM = "api_key";

    private final ApiKeyService apiKeyService;

    public ApiKeyAuthenticationFilter(ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String apiKey = extractApiKey(request);

        if (apiKey == null || apiKey.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.getWriter().write("{\"error\":\"Missing API key\"}");
            return;
        }

        Optional<ClientApplication> client = apiKeyService.validateKey(apiKey);

        if (client.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.getWriter().write("{\"error\":\"Invalid API key\"}");
            return;
        }

        // Set authentication in security context
        ApiKeyAuthenticationToken authentication =
            new ApiKeyAuthenticationToken(client.get());
        SecurityContextHolder.getContext().setAuthentication(authentication);

        filterChain.doFilter(request, response);
    }

    private String extractApiKey(HttpServletRequest request) {
        // Check header first, then query parameter
        String apiKey = request.getHeader(API_KEY_HEADER);
        if (apiKey == null || apiKey.isEmpty()) {
            apiKey = request.getParameter(API_KEY_PARAM);
        }
        return apiKey;
    }
}

public class ApiKeyAuthenticationToken extends AbstractAuthenticationToken {

    private final ClientApplication client;

    public ApiKeyAuthenticationToken(ClientApplication client) {
        super(client.getRoles().stream()
            .map(SimpleGrantedAuthority::new)
            .toList());
        this.client = client;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return client.getApiKey();
    }

    @Override
    public Object getPrincipal() {
        return client;
    }
}
```

---

## 3. JWT (Bearer Token)

### JWT Token Service

```java
@Component
public class JwtTokenService {

    private final SecretKey secretKey;
    private final long accessTokenExpiration = 3600000; // 1 hour
    private final long refreshTokenExpiration = 604800000; // 7 days

    public JwtTokenService(@Value("${jwt.secret}") String secret) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public String generateAccessToken(User user) {
        return Jwts.builder()
            .subject(user.getId().toString())
            .claim("email", user.getEmail())
            .claim("roles", user.getRoles())
            .issuedAt(new Date())
            .expiration(new Date(System.currentTimeMillis() + accessTokenExpiration))
            .signWith(secretKey)
            .compact();
    }

    public String generateRefreshToken(User user) {
        return Jwts.builder()
            .subject(user.getId().toString())
            .claim("type", "refresh")
            .issuedAt(new Date())
            .expiration(new Date(System.currentTimeMillis() + refreshTokenExpiration))
            .signWith(secretKey)
            .compact();
    }

    public Claims validateToken(String token) {
        return Jwts.parser()
            .verifyWith(secretKey)
            .build()
            .parseSignedClaims(token)
            .getPayload();
    }

    public boolean isTokenExpired(Claims claims) {
        return claims.getExpiration().before(new Date());
    }
}
```

### JWT Authentication Filter

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenService jwtTokenService;
    private final UserService userService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);

            try {
                Claims claims = jwtTokenService.validateToken(token);

                if (!jwtTokenService.isTokenExpired(claims)) {
                    Long userId = Long.parseLong(claims.getSubject());
                    User user = userService.findById(userId);

                    UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(
                            user, null, user.getRoles().stream()
                                .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                                .toList());

                    authentication.setDetails(
                        new WebAuthenticationDetailsSource().buildDetails(request));

                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } catch (JwtException | IllegalArgumentException e) {
                SecurityContextHolder.clearContext();
            }
        }

        filterChain.doFilter(request, response);
    }
}
```

---

## 4. OAuth 2.0 and OpenID Connect

### Spring Security OAuth 2.0 Configuration

```java
@Configuration
@EnableWebSecurity
public class OAuth2ResourceServerConfig {

    @Bean
    public SecurityFilterChain oauth2FilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/oauth2/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/oauth2/public").permitAll()
                .requestMatchers("/api/oauth2/admin").hasAuthority("SCOPE_admin")
                .requestMatchers("/api/oauth2/user").hasAuthority("SCOPE_read")
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())))
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS));

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

@RestController
@RequestMapping("/api/oauth2")
public class OAuth2ResourceController {

    @GetMapping("/public")
    public Map<String, String> publicEndpoint() {
        return Map.of("message", "This is public");
    }

    @GetMapping("/user")
    public Map<String, Object> userEndpoint(@AuthenticationPrincipal Jwt jwt) {
        return Map.of(
            "user", jwt.getSubject(),
            "claims", jwt.getClaims()
        );
    }

    @GetMapping("/admin")
    public Map<String, String> adminEndpoint() {
        return Map.of("message", "Admin access granted");
    }
}
```

### OAuth 2.0 Client Credentials Flow

```java
@Service
public class OAuth2ClientCredentialsService {

    private final WebClient webClient;

    public OAuth2ClientCredentialsService() {
        this.webClient = WebClient.builder()
            .baseUrl("https://auth.example.com")
            .build();
    }

    public String getAccessToken(String clientId, String clientSecret) {
        Map<String, String> body = Map.of(
            "grant_type", "client_credentials",
            "client_id", clientId,
            "client_secret", clientSecret,
            "scope", "read write"
        );

        OAuth2TokenResponse response = webClient.post()
            .uri("/oauth2/token")
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .bodyValue(body)
            .retrieve()
            .bodyToMono(OAuth2TokenResponse.class)
            .block();

        return response.getAccessToken();
    }
}
```

---

## 5. Mutual TLS (mTLS)

### mTLS Configuration

```java
@Configuration
public class MutualTlsConfig {

    @Bean
    public SecurityFilterChain mtlsFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/mtls/**")
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated())
            .x509(x509 -> x509
                .subjectPrincipalRegex("CN=(.*?),")
                .userDetailsService(mtlsUserDetailsService()))
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS));

        return http.build();
    }

    @Bean
    public UserDetailsService mtlsUserDetailsService() {
        return username -> {
            // Look up client certificate CN in registry
            ClientCertificate client = certificateRegistry.findByCN(username);
            return User.builder()
                .username(username)
                .password("")  // No password - certificate based
                .authorities(client.getRoles().toArray(new String[0]))
                .build();
        };
    }
}
```

---

## Best Practices

1. **Use HTTPS always**: Encrypt all authentication credentials in transit
2. **Prefer token-based auth**: Stateless, scoped, revocable
3. **Implement token rotation**: Short-lived access tokens with refresh tokens
4. **Use OAuth 2.0 for third-party access**: Delegate authorization
5. **Rate limit authentication endpoints**: Prevent brute force
6. **Log authentication attempts**: Monitor for suspicious activity
7. **Implement credential rotation**: Regular key rotation
8. **Use secure storage**: Hash passwords, encrypt tokens
9. **Validate all tokens**: Check signature, expiry, issuer
10. **Implement CORS properly**: Restrict allowed origins

```java
// Rate limiting for auth endpoints
@Bean
public SecurityFilterChain rateLimitedAuthChain(HttpSecurity http) {
    http
        .securityMatcher("/api/auth/login", "/api/auth/register")
        .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
        .addFilterBefore(new RateLimitFilter(5, Duration.ofMinutes(1)),
            UsernamePasswordAuthenticationFilter.class);
    return http.build();
}
```

---

## Common Mistakes

### Mistake 1: Storing Passwords in Plain Text

```java
// WRONG: Storing passwords as plain text
user.setPassword(request.getPassword());  // Security risk!

// CORRECT: Hash passwords
user.setPassword(passwordEncoder.encode(request.getPassword()));
```

### Mistake 2: Long-Lived Tokens Without Rotation

```java
// WRONG: Token that never expires
jwt.setExpiration(new Date(Long.MAX_VALUE));

// CORRECT: Short-lived access + refresh token rotation
accessToken: 15 minutes
refreshToken: 7 days, single use
```

### Mistake 3: Exposing Error Details

```java
// WRONG: Revealing why authentication failed
"User 'admin' not found"  // Reveals username exists
"Invalid password for user 'admin'"  // Confirms username

// CORRECT: Generic error messages
"Invalid credentials"
"Authentication failed"
```

---

## Summary

1. Basic Auth: Simple but limited to internal use
2. API Keys: Good for service-to-service and public APIs
3. JWT: Stateless tokens for web and mobile apps
4. OAuth 2.0: Industry standard for third-party authorization
5. OpenID Connect: Authentication layer on OAuth 2.0
6. mTLS: Highest security for B2B communication
7. Always use HTTPS and hash credentials
8. Implement token rotation and rate limiting

---

## References

- [JWT Specification (RFC 7519)](https://tools.ietf.org/html/rfc7519)
- [OAuth 2.0 Framework (RFC 6749)](https://tools.ietf.org/html/rfc6749)
- [OpenID Connect Specification](https://openid.net/specs/openid-connect-core-1_0.html)
- [Spring Security Authentication](https://docs.spring.io/spring-security/reference/servlet/authentication/index.html)

Happy Coding