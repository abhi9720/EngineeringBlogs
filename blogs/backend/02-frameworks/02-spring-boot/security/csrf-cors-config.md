---
title: CSRF and CORS Configuration in Spring Security
description: >-
  Master CSRF protection and CORS configuration in Spring Security: when to use
  CSRF, CORS policies, preflight requests, and securing cross-origin requests
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - spring-security
  - csrf
  - cors
coverImage: /images/csrf-cors-config.png
draft: false
order: 10
---
## Overview

Cross-Site Request Forgery (CSRF) and Cross-Origin Resource Sharing (CORS) are critical security concerns for web applications. Spring Security provides comprehensive support for both. Understanding when and how to configure these protections is essential for building secure applications.

CORS is a browser mechanism, not a server security mechanism. It prevents a malicious website from making requests to your API on behalf of an authenticated user — but only in browsers. Server-to-server calls are not affected by CORS. CSRF protects against forged requests, but is unnecessary for stateless token-based APIs.

## CORS Configuration

### Understanding CORS

CORS is a browser security mechanism that controls which origins can access your API resources. It uses HTTP headers to communicate allowed origins, methods, and headers.

### Global CORS Configuration

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins(
                "https://app.example.com",
                "https://admin.example.com",
                "http://localhost:3000"
            )
            .allowedMethods("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")
            .allowedHeaders("Authorization", "Content-Type", "X-Requested-With")
            .exposedHeaders("X-Total-Count", "X-RateLimit-Remaining")
            .allowCredentials(true)
            .maxAge(3600);
    }
}
```

### CORS with Spring Security

When CORS is configured in Spring Security (rather than Spring MVC), it runs within the security filter chain. This ensures CORS headers are set before authentication checks, so preflight requests don't require authentication.

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .anyRequest().authenticated()
            );
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(List.of(
            "https://app.example.com",
            "http://localhost:3000"
        ));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Requested-With"));
        configuration.setExposedHeaders(List.of("X-Total-Count", "X-RateLimit-Remaining"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        source.registerCorsConfiguration("/actuator/**", configuration);
        return source;
    }
}
```

### Dynamic CORS Configuration

For multi-tenant applications where allowed origins vary by customer, use a dynamic `CorsConfigurationSource`. The implementation below maps URL patterns to configurations and allows adding new patterns at runtime.

```java
@Component
public class DynamicCorsConfigurationSource implements CorsConfigurationSource {
    private final Map<String, CorsConfiguration> configurations = new ConcurrentHashMap<>();
    private final List<String> allowedOrigins;

    public DynamicCorsConfigurationSource(
            @Value("${app.cors.allowed-origins}") List<String> origins) {
        this.allowedOrigins = origins;
        initializeConfigurations();
    }

    private void initializeConfigurations() {
        CorsConfiguration apiConfig = new CorsConfiguration();
        apiConfig.setAllowedOrigins(allowedOrigins);
        apiConfig.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH"));
        apiConfig.setAllowedHeaders(List.of("*"));
        apiConfig.setAllowCredentials(true);
        apiConfig.setMaxAge(3600L);
        configurations.put("/api/**", apiConfig);

        CorsConfiguration publicConfig = new CorsConfiguration();
        publicConfig.setAllowedOriginPatterns(List.of("*"));
        publicConfig.setAllowedMethods(List.of("GET"));
        publicConfig.setAllowedHeaders(List.of("Content-Type"));
        publicConfig.setMaxAge(1800L);
        configurations.put("/api/public/**", publicConfig);
    }

    @Override
    public CorsConfiguration getCorsConfiguration(HttpServletRequest request) {
        String path = request.getRequestURI();
        return configurations.entrySet().stream()
            .filter(entry -> pathMatches(entry.getKey(), path))
            .map(Map.Entry::getValue)
            .findFirst()
            .orElse(null);
    }

    private boolean pathMatches(String pattern, String path) {
        if (pattern.endsWith("/**")) {
            String base = pattern.substring(0, pattern.length() - 3);
            return path.startsWith(base);
        }
        return pattern.equals(path);
    }

    public void addConfiguration(String pathPattern, CorsConfiguration config) {
        configurations.put(pathPattern, config);
    }
}
```

### Per-Controller CORS

```java
@RestController
@RequestMapping("/api/public")
@CrossOrigin(origins = "*", maxAge = 3600)
public class PublicApiController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "UP");
    }

    @CrossOrigin(origins = "https://partner.example.com")
    @GetMapping("/partner-data")
    public PartnerData getPartnerData() {
        return partnerService.getData();
    }
}
```

## CSRF Protection

### When to Use CSRF

CSRF protection is needed when:
- The application uses cookie-based authentication (session)
- The user's browser makes state-changing requests (POST, PUT, DELETE)
- The application is accessed via a web browser

CSRF is NOT needed when:
- The API uses token-based authentication (JWT, Bearer token)
- The API is consumed by mobile apps or server-to-server
- The application uses stateless REST APIs

### CSRF Configuration

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
                .ignoringRequestMatchers(
                    "/api/webhook/**",
                    "/api/public/**"
                )
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/api/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(withDefaults());
        return http.build();
    }
}
```

### Custom CSRF Token Repository

```java
@Component
public class CustomCsrfTokenRepository implements CsrfTokenRepository {
    private final Map<String, CsrfToken> tokenStore = new ConcurrentHashMap<>();

    @Override
    public CsrfToken generateToken(HttpServletRequest request) {
        String tokenValue = UUID.randomUUID().toString();
        return new DefaultCsrfToken("X-CSRF-TOKEN", "_csrf", tokenValue);
    }

    @Override
    public void saveToken(CsrfToken token, HttpServletRequest request,
                          HttpServletResponse response) {
        String sessionId = request.getSession(true).getId();
        if (token == null) {
            tokenStore.remove(sessionId);
        } else {
            tokenStore.put(sessionId, token);
            response.setHeader("X-CSRF-TOKEN", token.getToken());
        }
    }

    @Override
    public CsrfToken loadToken(HttpServletRequest request) {
        String sessionId = request.getSession(false) != null
            ? request.getSession(false).getId() : null;
        return sessionId != null ? tokenStore.get(sessionId) : null;
    }
}
```

### CSRF with SPA Applications

For single-page applications, the Xor-encoded CSRF token pattern provides protection against BREACH attacks. The `SpaCsrfTokenRequestHandler` uses Xor-encoded tokens for header-based requests and raw tokens for parameter-based ones.

```java
@Configuration
public class SpaCsrfConfig {

    @Bean
    public SecurityFilterChain spaFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler())
            )
            .addFilterAfter(new CsrfCookieFilter(), BasicAuthenticationFilter.class)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .anyRequest().authenticated()
            );
        return http.build();
    }
}

class SpaCsrfTokenRequestHandler extends CsrfTokenRequestAttributeHandler {
    private final CsrfTokenRequestHandler delegate = new XorCsrfTokenRequestAttributeHandler();

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       Supplier<CsrfToken> deferredCsrfToken) {
        delegate.handle(request, response, deferredCsrfToken);
    }

    @Override
    public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
        if (request.getHeader(csrfToken.getHeaderName()) == null) {
            return super.resolveCsrfTokenValue(request, csrfToken);
        }
        return delegate.resolveCsrfTokenValue(request, csrfToken);
    }
}

class CsrfCookieFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        CsrfToken csrfToken = (CsrfToken) request.getAttribute("_csrf");
        if (csrfToken != null) { csrfToken.getToken(); }
        filterChain.doFilter(request, response);
    }
}
```

## Combining CORS and CSRF

```java
@Configuration
@EnableWebSecurity
public class CombinedSecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .ignoringRequestMatchers(
                    request -> "GET".equals(request.getMethod()) || isApiClient(request)))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**", "/oauth2/**").permitAll()
                .anyRequest().authenticated())
            .oauth2Login(withDefaults())
            .formLogin(withDefaults());
        return http.build();
    }

    private boolean isApiClient(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        return authHeader != null && authHeader.startsWith("Bearer ");
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(List.of("https://app.example.com"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-CSRF-TOKEN"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
```

## Best Practices

1. **Disable CSRF for stateless APIs** using Bearer token authentication
2. **Use specific allowed origins** instead of wildcard (*) in production
3. **Set allowCredentials to true carefully** - incompatible with wildcard origins
4. **Use allowedOriginPatterns** for dynamic origin matching
5. **Set appropriate maxAge** to reduce preflight request overhead
6. **Expose only necessary headers** with exposedHeaders

## Common Mistakes

### Mistake 1: Disabling CSRF Without Understanding

```java
// Wrong: Disabling CSRF without proper token auth
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
            .formLogin(withDefaults());
        return http.build();
    }
}

// Correct: Keep CSRF enabled for session-based auth
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
            .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
            .formLogin(withDefaults());
        return http.build();
    }
}
```

### Mistake 2: Using Wildcard CORS with Credentials

```java
// Wrong: Wildcard origin with credentials
@Bean
public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOriginPatterns(List.of("*"));
    config.setAllowCredentials(true);
    return new UrlBasedCorsConfigurationSource();
}

// Correct: Explicit origins or patterns
@Bean
public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOriginPatterns(List.of("https://*.example.com"));
    config.setAllowCredentials(true);
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    return new UrlBasedCorsConfigurationSource();
}
```

## Summary

CSRF and CORS are essential security mechanisms for web applications. CORS controls cross-origin access to your APIs, while CSRF protects against malicious form submissions. Configure CORS with specific origins and appropriate headers, use CSRF tokens for browser-based session authentication, and disable CSRF for stateless token-based APIs.

## References

- [Spring Security CORS](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html)
- [Spring Security CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

Happy Coding
