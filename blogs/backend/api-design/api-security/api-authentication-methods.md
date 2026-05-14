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

Basic Authentication is the simplest HTTP authentication mechanism. The client sends a Base64-encoded `username:password` string in the `Authorization` header. While easy to implement, it has significant security limitations: credentials are sent on every request (increasing exposure surface), Base64 is not encryption (easily decoded), and there is no built-in credential rotation or revocation mechanism. Basic Auth should only be used over HTTPS and is best suited for internal tools, testing environments, or as a fallback in legacy systems.

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

API keys provide a mid-level security mechanism popular in public APIs and SDKs. A long, random string identifies and authenticates the client. API keys are simpler than token-based systems because they don't require a login flow or token refresh. However, they have notable trade-offs: API keys are typically long-lived (making rotation essential), they don't distinguish between authentication and authorization (one key grants all permissions), and they are often sent in URLs or headers where they can be logged accidentally. Always validate API keys server-side, support key rotation, and consider scoping keys to specific permissions.

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

JSON Web Tokens (JWT) are the dominant authentication mechanism for modern web and mobile APIs. A JWT is a self-contained token that encodes user identity, claims, and expiration in a digitally signed JSON payload. The key advantage is statelessness — the server can verify the token's authenticity using a secret or public key without querying a database or session store. This makes JWTs ideal for distributed systems where authentication state must be verified across multiple services. The main trade-off is that JWTs cannot be revoked server-side before expiration (unless you maintain a blocklist or use short expiration times combined with refresh tokens).

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

The JWT authentication filter intercepts every request, extracts the Bearer token from the `Authorization` header, validates the signature and expiration, and sets the Spring Security authentication context. This filter runs once per request (via `OncePerRequestFilter`) and must handle the full lifecycle: missing tokens (allow anonymous access if the endpoint permits), expired tokens (clear context, let downstream matchers reject), and malformed tokens (log warning, clear context). Production systems should also check token issuer, audience, and not-before claims to prevent token misuse across different services.

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

OAuth 2.0 is the industry standard for delegated authorization — it allows third-party applications to access user data without exposing user credentials. OpenID Connect (OIDC) adds an authentication layer on top of OAuth 2.0, providing user identity verification. OAuth 2.0 defines four grant types (authorization code, client credentials, implicit, and resource owner password) for different client types and trust levels. Implementing OAuth 2.0 is complex but necessary for any API that serves third-party applications. The authorization code flow with PKCE is the recommended approach for public clients like single-page apps and mobile applications.

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

Mutual TLS provides the highest level of authentication security by requiring both the client and server to present X.509 certificates during the TLS handshake. Unlike other authentication methods that operate at the application layer, mTLS authenticates at the transport layer, making it immune to application-level attacks like token theft or replay. This makes mTLS the preferred choice for B2B integrations, microservice-to-microservice communication, and financial services where security requirements are extreme. The downside is operational complexity: certificate management (issuance, rotation, revocation) requires robust PKI infrastructure, and not all clients can easily handle client certificates.

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

Choosing the right authentication method depends on your threat model, client types, and operational capabilities. Regardless of the method, several universal best practices apply. HTTPS is non-negotiable for all authentication traffic — credentials sent over plain HTTP are trivially intercepted. Token-based authentication offers better security properties than shared secrets because tokens can be scoped, rotated, and revoked independently. Always implement rate limiting on authentication endpoints (login, token refresh) to mitigate brute force and credential stuffing attacks. Log all authentication attempts (successes and failures) with sufficient detail for forensic analysis, but never log credentials or tokens.

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

Storing passwords in plain text is the most severe security mistake you can make in authentication. If your database is compromised, all user credentials are exposed. Always hash passwords using a strong, adaptive hashing algorithm (bcrypt, Argon2, scrypt) with a unique salt per password. Bcrypt's cost factor should be tuned to take at least 10ms per hash — fast enough for authentication, slow enough to make brute-forcing economically infeasible. Never use MD5, SHA-1, or unsalted SHA-256 for password storage.

```java
// WRONG: Storing passwords as plain text
user.setPassword(request.getPassword());  // Security risk!

// CORRECT: Hash passwords
user.setPassword(passwordEncoder.encode(request.getPassword()));
```

### Mistake 2: Long-Lived Tokens Without Rotation

JWTs that never expire defeat the purpose of stateless authentication — a leaked token grants permanent access to your API. Even with expiration, tokens should have short lifetimes (15-60 minutes for access tokens). Use refresh tokens with longer lifetimes (days to weeks) and implement refresh token rotation: each refresh request issues a new refresh token and invalidates the old one. This limits the window of vulnerability if a refresh token is stolen and provides a natural mechanism for detecting token theft (when a used refresh token is presented again).

```java
// WRONG: Token that never expires
jwt.setExpiration(new Date(Long.MAX_VALUE));

// CORRECT: Short-lived access + refresh token rotation
accessToken: 15 minutes
refreshToken: 7 days, single use
```

### Mistake 3: Exposing Error Details

Authentication error messages that reveal whether a username exists or a password was wrong enable attackers to enumerate valid usernames and focus brute-force attacks on confirmed accounts. Always return the same generic error message for any authentication failure, regardless of the root cause. This is a security best practice known as "not revealing too much" — the trade-off is slightly reduced debuggability, which can be addressed by logging detailed errors server-side while returning generic messages to clients.

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