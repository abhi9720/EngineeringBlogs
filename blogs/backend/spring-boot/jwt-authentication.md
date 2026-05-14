---
title: "JWT Authentication"
description: "Deep dive into JWT authentication internals, real-world use cases, trade-offs, and production considerations for Spring Boot applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - security
  - jwt
  - authentication
coverImage: "/images/jwt-authentication.png"
draft: false
---

# JWT Authentication: The Complete Production Guide

## Overview

JWT (JSON Web Token) has become the de facto standard for stateless authentication in modern web applications. Unlike session-based authentication where the server maintains session state, JWTs allow you to embed all necessary authentication data within the token itself. This makes JWTs particularly powerful for microservices architectures, mobile APIs, and systems that need horizontal scaling without sticky sessions.

But JWTs come with subtle pitfalls that cause security vulnerabilities in production. This guide goes beyond surface-level definitions to teach you how JWTs actually work under the hood, when to use them (and when not to), and how to avoid common mistakes that lead to security breaches.

---

## How JWT Works Internally

### The JWT Structure

A JWT is a three-part string separated by dots. Each part is base64url-encoded (URL-safe base64 without padding). The three parts are the header, the payload, and the signature.

The **header** typically contains the token type and the signing algorithm. The **payload** contains claims — statements about the user and metadata. The **signature** is a cryptographic hash that verifies the token hasn't been tampered with.

**Header** (xxxxx): Base64URL-encoded JSON containing the algorithm type and token type. For most applications, this looks like:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload** (yyyyy): Base64URL-encoded JSON containing the claims. There are three types of claims:

- **Registered claims**: Standardized claims like `iss` (issuer), `exp` (expiration), `sub` (subject), `aud` (audience), `iat` (issued at), `nbf` (not before)
- **Public claims**: Custom claims registered in the IANA JWT Registry (e.g., `email`, `name`)
- **Private claims**: Application-specific claims you define yourself

A typical payload:

```json
{
  "sub": "1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "USER",
  "iat": 1516239022,
  "exp": 1516242622
}
```

**Signature** (zzzzz): The cryptographic signature that verifies the token wasn't tampered with.

### How Signing Works

When you create a JWT, the server signs it using one of these algorithms. The choice between symmetric (HMAC) and asymmetric (RSA/ECDSA) signing has profound implications for security architecture.

**HMAC (HS256/HS384/HS512)**: Symmetric signing where the same secret key is used for both signing and verification. This is simpler to set up but means any service that can verify tokens can also create them. This is fine when the verifier and issuer are the same service.

The signature is computed as: `HMAC-SHA256(base64UrlEncode(header) + "." + base64UrlEncode(payload), secret)`

```java
// Creating signature with HMAC-SHA256
SecretKey key = Keys.secretKeyFor(SignatureAlgorithm.HS256);
String jwt = Jwts.builder()
    .setSubject("1234567890")
    .signWith(key)
    .compact();
```

**RSA/ECDSA (RS256/ES256)**: Asymmetric signing where the server has a private key to sign, and any service can verify using the corresponding public key. This enables a clean separation of concerns: the authentication service can sign tokens, and any downstream microservice can verify them without needing access to the private key.

```java
// Server side: Sign with private key
RS256Key privateKey = loadPrivateKey();
String jwt = Jwts.builder()
    .setSubject("1234567890")
    .signWith(privateKey, RS256)
    .compact();

// Client side: Verify with public key
PublicKey publicKey = loadPublicKey();
Jwts.parserBuilder()
    .setSigningKey(publicKey)
    .build()
    .parseClaimsJws(jwt);
```

### Token Validation Flow in Spring Security

When a request arrives with a JWT in the Authorization header, a filter intercepts it and performs validation. The flow has six distinct steps. The most important detail is that the signature verification must happen before any claims are read — verifying the signature proves the token is authentic, and only then should you trust the claims inside it.

The `SecurityContextHolder` stores the authentication result, making the user's identity available to the rest of the application via `SecurityContextHolder.getContext().getAuthentication()`.

1. **Filter Interception**: `JwtAuthenticationFilter` (or `OncePerRequestFilter`) catches the request
2. **Token Extraction**: Extract the token from `Authorization: Bearer <token>` header
3. **Signature Verification**: Use the secret/public key to verify the signature
4. **Claims Validation**: Check `exp`, `nbf`, `iss`, `aud` (if configured)
5. **Authentication Object Creation**: Create a `UsernamePasswordAuthenticationToken` with the claims
6. **SecurityContext Setting**: Set the authentication in `SecurityContextHolder`

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        
        String token = jwtTokenProvider.extractToken(request);
        
        if (token != null && jwtTokenProvider.validateToken(token)) {
            // Extract claims
            Claims claims = jwtTokenProvider.getClaims(token);
            String username = claims.getSubject();
            
            // Create authentication object
            UsernamePasswordAuthenticationToken authentication = 
                new UsernamePasswordAuthenticationToken(
                    username, 
                    null, 
                    AuthorityUtils.createAuthorityList(claims.get("role", String.class))
                );
            
            // Set in SecurityContext
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }
        
        filterChain.doFilter(request, response);
    }
}
```

### SecurityContextHolder Deep Dive

Spring Security stores the authenticated principal in `SecurityContextHolder`, which by default uses a `ThreadLocal` strategy. This means each thread has its own security context.

A critical implication: in asynchronous processing (CompletableFuture, @Async, message listeners), the security context does NOT automatically propagate to the new thread. You must either use Spring's `DelegatingSecurityContextExecutor` or manually copy the context. Failure to do this results in `Authentication` being null in async handlers.

```java
// How Spring stores authentication (simplified)
public class SecurityContextHolder {
    private static final ThreadLocal<SecurityContext> contextHolder = 
        new ThreadLocal<>();
    
    public static SecurityContext getContext() {
        return contextHolder.get();
    }
}

// In your controller, you can access it:
@RestController
public class UserController {
    
    @GetMapping("/me")
    public User getCurrentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String username = auth.getName(); // This comes from JWT subject claim
        return userService.findByUsername(username);
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Stateless Authentication for Mobile APIs

When building mobile applications (iOS/Android), you need a scalable authentication system that doesn't require sticky sessions. The dual-token pattern — short-lived access token + long-lived refresh token — is the standard approach.

The access token (15-minute lifespan) is sent with every API request. Its short lifespan limits the damage if it's stolen. The refresh token (7-day lifespan) is used only at the `/auth/refresh` endpoint to obtain new access tokens. This keeps the access token window small while maintaining a good user experience.

The refresh endpoint should also rotate the refresh token: invalidating the old one and issuing a new one. This prevents replay attacks where a stolen refresh token is used multiple times.

```java
// Mobile app login flow
@PostMapping("/auth/login")
public ResponseEntity<AuthResponse> login(@RequestBody LoginRequest request) {
    User user = userService.authenticate(request.getUsername(), request.getPassword());
    
    // Generate access token (short-lived, 15 minutes)
    String accessToken = jwtTokenProvider.generateToken(user, Duration.ofMinutes(15));
    
    // Generate refresh token (long-lived, 7 days)
    String refreshToken = jwtTokenProvider.generateToken(user, Duration.ofDays(7));
    
    return ResponseEntity.ok(new AuthResponse(accessToken, refreshToken));
}

// Token refresh endpoint
@PostMapping("/auth/refresh")
public ResponseEntity<AuthResponse> refresh(@RequestBody RefreshRequest request) {
    if (jwtTokenProvider.validateToken(request.getRefreshToken())) {
        User user = userService.findById(jwtTokenProvider.getUserId(request.getRefreshToken()));
        
        String newAccessToken = jwtTokenProvider.generateToken(user, Duration.ofMinutes(15));
        // Optionally rotate refresh token
        String newRefreshToken = jwtTokenProvider.generateToken(user, Duration.ofDays(7));
        
        return ResponseEntity.ok(new AuthResponse(newAccessToken, newRefreshToken));
    }
    throw new UnauthorizedException("Invalid refresh token");
}
```

### Case 2: Service-to-Service Authentication (Microservices)

In a microservices architecture, services need to authenticate with each other without user credentials. JWTs are perfect for this because they carry the calling service's identity and can be validated without a database lookup.

The token includes the service name, a role indicating it's a service account, and a very short TTL (5 minutes) to limit the impact of token leakage. The receiving service validates the token, verifies the calling service is authorized to access the specific endpoint, and sets the security context accordingly.

```java
// Service A calling Service B
@Service
public class ServiceAClient {
    
    @Autowired
    private JwtTokenProvider tokenProvider;
    
    public Response callServiceB() {
        // Generate token with service account claims
        String serviceToken = jwtTokenProvider.generateToken(
            "service-a",  // subject = service name
            List.of("ROLE_SERVICE"), 
            Duration.ofMinutes(5)
        );
        
        return restTemplate.exchange(
            "http://service-b/api/data",
            HttpMethod.GET,
            new HttpEntity<>(createHeaders(serviceToken)),
            String.class
        );
    }
}

// Service B validating incoming service call
@Component
public class ServiceAuthenticationFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) {
        String token = extractToken(request);
        
        if (token != null && jwtTokenProvider.isServiceToken(token)) {
            Claims claims = jwtTokenProvider.getClaims(token);
            String callingService = claims.getSubject();
            
            // Verify the calling service is authorized
            if (authorizationService.isAuthorized(callingService, request.getRequestURI())) {
                // Set service identity for authorization checks
                SecurityContextHolder.getContext().setAuthentication(
                    new ServiceAuthentication(callingService)
                );
            }
        }
        
        filterChain.doFilter(request, response);
    }
}
```

### Case 3: API Gateway Token Validation

In API Gateway patterns, the gateway validates JWTs so backend services don't need to. This centralizes authentication logic and reduces duplication. The gateway extracts claims from the token and either passes them to downstream services as headers or enriches the request context.

This pattern is particularly effective with Spring Cloud Gateway, where `JwtRoutePredicateFactory` can route requests based on JWT claims — for example, routing admin users to a different backend instance than regular users.

```java
@Configuration
public class GatewayJwtFilterConfig {
    
    @Bean
    public RoutePredicateFactory<JwtRoutePredicateConfig> jwtRoutePredicate() {
        return new JwtRoutePredicateFactory();
    }
}

// Then in application.yml:
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Jwt:
                claims:
                  roles: "ROLE_USER"
                header: Authorization
                scheme: Bearer
```

---

## Trade-offs: When to Use JWT vs Opaque Tokens

### JWT Advantages

1. **Stateless validation**: No database lookup required. The token contains all information needed to verify validity.

2. **Reduced infrastructure complexity**: No need for distributed session storage (Redis, Memcached) when scaling horizontally.

3. **Cross-domain authentication**: JWTs work across different domains and subdomains without CORS complications.

4. **Rich claims**: Can include user roles, permissions, and custom data directly in the token.

### JWT Disadvantages

1. **Cannot be revoked server-side**: Once issued, a JWT is valid until expiration. You cannot invalidate a stolen token without a blacklist (which reintroduces state).

2. **Token size**: JWTs grow with claims. A token with roles, permissions, and user data can easily exceed 1KB, impacting header sizes.

3. **Security of claims**: Claims are visible to clients (base64 encoded, not encrypted). Don't put sensitive data in claims.

4. **No logout mechanism**: There's no built-in way to "log out" a JWT. You must implement short expiration or use a blocklist.

### Decision Matrix

| Scenario | Recommended Approach |
|----------|---------------------|
| User-facing web app with frequent logouts | Opaque tokens (session) with Redis storage |
| Mobile API with offline capabilities | JWT with refresh tokens |
| Microservices internal communication | JWT (short-lived, service-to-service) |
| Single-page app with backend API | JWT stored in httpOnly cookie |
| High-security application requiring immediate revocation | Opaque tokens or JWT with blocklist |

---

## Production Considerations

### 1. Token Size Management

Large JWTs impact performance because the token is sent with every request in the HTTP Authorization header. The mitigation strategy is straightforward: include only essential claims in the JWT. Reference IDs that can be used to look up details on demand are preferable to embedding entire objects.

- **HTTP header bloat**: Every request carries the token. A 2KB token adds 4KB round-trip per request.
- **Bandwidth costs**: Especially significant for high-traffic APIs.
- **Browser limits**: Some browsers and proxies have header size limits (typically 8KB).

**Mitigation**:

```java
// Don't include unnecessary claims
@Bean
public JwtAccessTokenConverter accessTokenConverter() {
    JwtAccessTokenConverter converter = new JwtAccessTokenConverter();
    converter.setSigningKey("secret");
    
    // Use a custom token enhancer to control claims
    TokenEnhancerChain chain = new TokenEnhancerChain();
    chain.setTokenEnhancers(Arrays.asList(
        new CustomTokenEnhancer(),  // Only include essential claims
        new JwtAccessTokenConverter()
    ));
    
    converter.setTokenEnhancer(chain);
    return converter;
}
```

### 2. Clock Skew Issues

The `exp` and `nbf` claims rely on server time. A few seconds of clock drift can cause valid tokens to be rejected or invalid tokens to be accepted.

The standard solution is to allow a clock skew of 60 seconds. This gives enough tolerance for typical NTP-synchronized server environments while keeping the window small enough for security. The `setAllowedClockSkewSeconds()` method on the JJWT parser builder handles this automatically.

**Solution**:

```java
@Component
public class JwtTokenProvider {
    
    // Allow 60 seconds of clock skew
    private static final int CLOCK_SKEW_SECONDS = 60;
    
    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(key)
                .setAllowedClockSkewSeconds(CLOCK_SKEW_SECONDS)  // Key configuration
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}
```

### 3. Refresh Token Rotation

To maintain security while providing good UX, implement refresh token rotation: each time a refresh token is used, invalidate it and issue a new one. This limits the window of opportunity for a stolen refresh token.

Combine rotation with fingerprints or device identifiers. If a refresh token is used with an unexpected device or IP, you can reject the request and flag the account for security review.

```java
public class RefreshTokenService {
    
    public AuthResponse refreshAccessToken(String refreshToken) {
        RefreshToken token = refreshTokenRepository.findByToken(refreshToken)
            .orElseThrow(() -> new InvalidTokenException("Token not found"));
        
        if (token.isRevoked() || token.isExpired()) {
            throw new InvalidTokenException("Token revoked or expired");
        }
        
        // Rotate: invalidate old refresh token, generate new one
        refreshTokenRepository.delete(token);
        
        User user = token.getUser();
        String newAccessToken = jwtTokenProvider.generateAccessToken(user);
        RefreshToken newRefreshToken = createRefreshToken(user);
        
        return new AuthResponse(newAccessToken, newRefreshToken.getToken());
    }
}
```

### 4. Secret Rotation Strategy

In production, you must be able to rotate signing keys without downtime. The key rotation strategy uses a key ID (`kid`) in the JWT header that identifies which signing key was used. The verifier maintains a set of valid keys — the current signing key plus a few previous ones that have not yet expired.

When rotating, generate a new key pair, add it to the key store, and start signing new tokens with it. The `kid` in the JWT header tells verifiers which key to use. Old keys are kept until all tokens signed with them have expired.

```java
@Configuration
public class JwtConfig {
    
    @Bean
    public JwtParser jwtParser() {
        // Support multiple keys for rotation
        return Jwts.parserBuilder()
            .setSigningKeyResolver(new SigningKeyResolverAdapter() {
                @Override
                public Key getKey(JwsHeader header) {
                    String kid = header.getKeyId();
                    return keyRotationService.getKey(kid);  // Fetch current or previous key
                }
            })
            .build();
    }
}
```

Store keys in a secure location (AWS Secrets Manager, HashiCorp Vault) and implement a key version in the JWT header:

```json
{
  "alg": "HS256",
  "kid": "key-version-2"
}
```

### 5. Memory and Performance

For high-traffic applications, avoid parsing the JWT multiple times per request. Cache the parsed claims in a request-scoped context — Spring's request scope is ideal for this. The `@RequestScope` annotation creates a bean instance per HTTP request, so the claims are parsed once and reused across the entire request processing chain.

Algorithm choice also affects performance: HMAC (HS256) is significantly faster than RSA (RS256) because it's a simple hash operation, not asymmetric key math. Use HMAC for single-service applications and RSA only when you need the public key to be shared.

```java
@Component
@RequestScope
public class CurrentUserProvider {
    
    @Autowired
    private JwtTokenProvider tokenProvider;
    
    private Claims cachedClaims;
    
    public Claims getClaims(HttpServletRequest request) {
        if (cachedClaims == null) {
            String token = tokenProvider.extractToken(request);
            cachedClaims = tokenProvider.getClaims(token);
        }
        return cachedClaims;
    }
}
```

---

## Common Mistakes

### Mistake 1: Storing Secrets in Code

Never hardcode secrets:

```java
// WRONG - Secrets in code
@Bean
public JwtAccessTokenConverter accessTokenConverter() {
    JwtAccessTokenConverter converter = new JwtAccessTokenConverter();
    converter.setSigningKey("my-super-secret-key");  // NEVER DO THIS
    return converter;
}
```

**Correct approach**:

```yaml
# application.yml (outside version control)
jwt:
  signing:
    key: ${JWT_SECRET:default-dev-key-change-in-prod}
```

```java
// Correct - Load from environment/config
@Value("${jwt.signing.key}")
private String signingKey;

@Bean
public JwtAccessTokenConverter accessTokenConverter() {
    JwtAccessTokenConverter converter = new JwtAccessTokenConverter();
    converter.setSigningKey(signingKey);
    return converter;
}
```

### Mistake 2: Not Validating the Signature

Many developers only check if the token exists and isn't expired, bypassing signature verification entirely. This is the most critical security vulnerability in JWT implementations — an attacker can forge tokens by crafting any header and payload, leaving the signature empty or arbitrary.

```java
// WRONG - No signature validation
public boolean validateToken(String token) {
    try {
        String[] parts = token.split("\\.");
        // Only check expiration
        String payload = new String(Base64.getDecoder().decode(parts[1]));
        // No signature verification!
        return true;  // DANGEROUS!
    } catch (Exception e) {
        return false;
    }
}
```

**Correct approach**:

```java
// Always verify signature
public boolean validateToken(String token) {
    try {
        Jwts.parserBuilder()
            .setSigningKey(secretKey)
            .build()
            .parseClaimsJws(token);
        return true;
    } catch (JwtException e) {
        log.warn("Invalid JWT: {}", e.getMessage());
        return false;
    }
}
```

### Mistake 3: Not Checking Issuer (iss) and Audience (aud)

Without issuer/audience validation, a token obtained from one service can be used against another service. For example, a token from `auth.example.com` could be used against `api.example.com` if the API doesn't check the `iss` claim. This is a common issue in microservice environments where each service independently validates JWTs.

```java
// WRONG - Missing issuer/audience validation
@Bean
public JwtDecoder jwtDecoder() {
    return NimbusJwtDecoder.withSecretKey(secretKey).build();
}

// CORRECT - Validate issuer and audience
@Bean
public JwtDecoder jwtDecoder() {
    NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(secretKey).build();
    decoder.setJwtValidator(new DelegatingJwtValidator(
        new IssuerValidator("https://auth.example.com"),
        new AudienceValidator("my-api"),
        new ExpirationValidator(),
        new SignatureValidator(secretKey)
    ));
    return decoder;
}
```

### Mistake 4: Using JWT for Sessions Where Opaque Tokens Are Better

For applications requiring immediate logout capability, JWTs are fundamentally unsuitable because they cannot be revoked server-side. A user clicking "logout" expects the session to be invalidated immediately. With JWTs, the token remains valid until expiration.

```java
// WRONG - Using JWT for session-based app
// If user clicks "Logout", there's no way to invalidate the token
// until it expires (e.g., 1 hour)

// CORRECT - Use session tokens for applications needing immediate logout
@PostMapping("/logout")
public ResponseEntity<Void> logout(HttpServletRequest request) {
    HttpSession session = request.getSession(false);
    if (session != null) {
        session.invalidate();
    }
    return ResponseEntity.ok().build();
}
```

### Mistake 5: Storing Sensitive Data in JWT Claims

```java
// WRONG - Sensitive data in token
Map<String, Object> claims = new HashMap<>();
claims.put("ssn", "123-45-6789");  // NEVER put sensitive data
claims.put("password", "secret");

String token = Jwts.builder()
    .setClaims(claims)
    .signWith(key)
    .compact();

// Anyone can decode the payload and see the SSN
// base64decode("eyJzc24iOiIxMjMtNDUtNjc4OSJ9") = {"ssn":"123-45-6789"}
```

**Correct approach**: Only include non-sensitive identifiers, store sensitive data in your database:

```java
// CORRECT - Reference sensitive data by ID, not in token
Map<String, Object> claims = new HashMap<>();
claims.put("userId", user.getId());  // Safe: just a reference ID
claims.put("role", user.getRole());

String token = Jwts.builder()
    .setClaims(claims)
    .signWith(key)
    .compact();

// When you need sensitive data, fetch from database using userId
User user = userRepository.findById(userId);
```

### Mistake 6: Not Handling Token Expiration Gracefully

```java
// WRONG - No handling of expiration
@GetMapping("/api/data")
public Response getData() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    // If token expired between requests, this fails with 500 error
    return dataService.getData();
}

// CORRECT - Handle expiration with proper error response
@GetMapping("/api/data")
public Response getData() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !auth.isAuthenticated()) {
        return ResponseEntity.status(401).body("Authentication required");
    }
    return dataService.getData();
}

// Add global exception handler
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(ExpiredJwtException.class)
    public ResponseEntity<Map<String, String>> handleExpiredJwt(ExpiredJwtException e) {
        return ResponseEntity.status(401)
            .body(Map.of("error", "Token expired", "code", "TOKEN_EXPIRED"));
    }
}
```

---

## Summary

JWT authentication is a powerful pattern for modern applications, but it requires careful implementation to be secure. Key takeaways:

1. **Understand the three parts**: Header (algorithm), Payload (claims), Signature (verification)
2. **Use appropriate algorithms**: HMAC for single-service, RSA for distributed systems
3. **Validate everything**: Signature, expiration, issuer, audience
4. **Manage token size**: Include only essential claims
5. **Implement rotation**: Both for refresh tokens and signing keys
6. **Choose the right pattern**: JWT for stateless APIs, opaque tokens for applications requiring immediate logout

Remember: JWTs are not a silver bullet. For applications requiring immediate token revocation or containing sensitive data in sessions, consider traditional session-based authentication or opaque tokens with Redis storage.

---

## References

- [RFC 7519 - JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [RFC 7515 - JSON Web Signature (JWS)](https://tools.ietf.org/html/rfc7515)
- [Spring Security JWT Documentation](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)
- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet_for_Developers.html)
- [jjwt library documentation](https://github.com/jwtk/jjwt)

Happy Coding
