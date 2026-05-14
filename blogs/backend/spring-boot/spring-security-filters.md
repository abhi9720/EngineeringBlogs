---
title: "Spring Security Filters"
description: "Deep dive into Spring Security filter chain, custom filters, and how authentication flows through the pipeline"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - spring-security
  - filters
  - authentication
coverImage: "/images/spring-security-filters.png"
draft: false
---

# Spring Security Filters: Understanding the Request Pipeline

## Overview

Every request passing through a Spring Security application goes through a chain of filters. Understanding this filter chain is essential for building custom authentication mechanisms, debugging security issues, and implementing features like JWT authentication, CSRF protection, and request rate limiting.

Spring Security uses a delegation pattern where `FilterChainProxy` (a single filter registered with the servlet container) delegates to multiple security filters based on URL patterns and configuration. This architecture allows you to customize security behavior at each stage of the request lifecycle.

---

## How the Filter Chain Works Internally

### The Security Filter Chain Architecture

When you annotate a class with `@EnableWebSecurity`, Spring creates a `SecurityFilterChain` bean that contains all security filters in a specific order. The `FilterChainProxy` matches incoming requests against registered filter chains by URL pattern and executes the first matching chain.

Each filter in the chain has a single responsibility. The ordering is critical: authentication filters must run before authorization filters, and exception translation must happen late so that earlier filters can add their own behavior. The diagram below shows the flow from request to controller through the filter chain.

```mermaid
flowchart LR
    Request[HTTP Request] --> FCP[FilterChainProxy]
    FCP --> F1[ChannelProcessingFilter]
    F1 --> F2[SecurityContextPersistenceFilter]
    F2 --> F3[CorsFilter]
    F3 --> F4[LogoutFilter]
    F4 --> F5[UsernamePasswordAuthFilter]
    F5 --> F6[ConcurrentSessionFilter]
    F6 --> F7[JwtAuthFilter<br/>custom]
    F7 --> F8[RequestCacheAwareFilter]
    F8 --> F9[SecurityContextHolderAwareFilter]
    F9 --> F10[AnonymousAuthFilter]
    F10 --> F11[SessionManagementFilter]
    F11 --> F12[ExceptionTranslationFilter]
    F12 --> F13[FilterSecurityInterceptor]
    F13 --> Controller

    linkStyle default stroke:#278ea5

    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff

    class F1,F2,F3,F4,F5,F6,F8,F9,F10,F11,F12,F13 blue
    class F7 pink
    class Controller green
```

The default filter chain (in order) includes:

1. **ChannelProcessingFilter** - Redirects HTTP to HTTPS
2. **SecurityContextPersistenceFilter** - Loads/saves SecurityContext from session
3. **CorsFilter** - Handles Cross-Origin Resource Sharing
4. **LogoutFilter** - Processes logout requests
5. **UsernamePasswordAuthenticationFilter** - Handles form login
6. **ConcurrentSessionFilter** - Manages session concurrency
7. **JwtAuthenticationFilter** (custom) - Validates JWT tokens
8. **RequestCacheAwareFilter** - Saves requests for after login
9. **SecurityContextHolderAwareRequestFilter** - Wraps HttpServletRequest
10. **AnonymousAuthenticationFilter** - Provides anonymous authentication if none exists
11. **SessionManagementFilter** - Handles session fixation protection
12. **ExceptionTranslationFilter** - Translates security exceptions to HTTP responses
13. **FilterSecurityInterceptor** - Final authorization decision

### Filter Registration and Order

In modern Spring Security (Spring Boot 2.7+ / Spring Security 5.7+), you configure the filter chain without extending `WebSecurityConfigurerAdapter`. The lambda DSL provides a more readable configuration. Use `addFilterBefore` and `addFilterAfter` to position custom filters relative to existing ones.

The position of your custom filter matters: placing it before `UsernamePasswordAuthenticationFilter` means it runs before form login processing, which is appropriate for a JWT filter. Placing it before `FilterSecurityInterceptor` would mean authentication hasn't happened when your filter runs, which is likely wrong.

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter(), UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(customAuditFilter(), JwtAuthenticationFilter.class)
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            );
        
        return http.build();
    }
    
    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter();
    }
    
    @Bean
    public CustomAuditFilter customAuditFilter() {
        return new CustomAuditFilter();
    }
}
```

### The SecurityContextHolder Deep Dive

The `SecurityContextHolder` is where Spring Security stores the authenticated user information. It uses a strategy pattern that defaults to `ThreadLocal` storage.

The three strategies serve different deployment scenarios. `MODE_THREADLOCAL` is the default and works for standard servlet containers where each request is handled by a single thread. `MODE_INHERITABLETHREADLOCAL` is needed when child threads are spawned and should inherit the parent's security context. `MODE_GLOBAL` is rarely used and is only appropriate for standalone applications that don't handle multiple concurrent users.

```java
// Three strategies for storing security context
public class SecurityContextHolder {
    
    // Strategy 1: ThreadLocal (default) - each thread has its own context
    public static void setStrategyName("MODE_THREADLOCAL");
    
    // Strategy 2: InheritableThreadLocal - child threads inherit context
    public static void setStrategyName("MODE_INHERITABLETHREADLOCAL");
    
    // Strategy 3: Global - single static reference (rarely used)
    public static void setStrategyName("MODE_GLOBAL");
    
    public static SecurityContext getContext() {
        return strategy.getContext();
    }
}

// What's actually stored in the context
public class SecurityContextImpl implements SecurityContext {
    private Authentication authentication;
    
    public Authentication getAuthentication() {
        return this.authentication;
    }
    
    public void setAuthentication(Authentication authentication) {
        this.authentication = authentication;
    }
}

// The Authentication interface
public interface Authentication extends Serializable {
    Collection<? extends GrantedAuthority> getAuthorities();
    Object getCredentials();
    Object getDetails();
    Object getPrincipal();
    boolean isAuthenticated();
    void setAuthenticated(boolean isAuthenticated) throws IllegalArgumentException;
}
```

### How Filters Chain Together

When a request arrives, here's the exact sequence. `FilterChainProxy` iterates through its registered `SecurityFilterChain` instances, matching each against the request URL. The first match wins, and its list of filters is executed via `VirtualFilterChain`.

`VirtualFilterChain` is an inner class that maintains an index into the filter list. Each filter's `doFilter` method either handles the request completely (short-circuiting the chain) or calls `chain.doFilter()` to pass control to the next filter. The last filter in the chain calls the original servlet container filter chain, which eventually reaches the DispatcherServlet and your controller.

```java
// Simplified flow in FilterChainProxy
public class FilterChainProxy extends GenericFilterBean {
    
    private List<SecurityFilterChain> filterChains;
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, 
                         FilterChain chain) {
        
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        
        // Find matching filter chain for this URL
        for (SecurityFilterChain filterChain : filterChains) {
            if (filterChain.matches(httpRequest)) {
                // Execute the chain
                doFilterInternal(httpRequest, httpResponse, filterChain);
                return;
            }
        }
        
        chain.doFilter(request, response);
    }
    
    private void doFilterInternal(HttpServletRequest request, 
                                  HttpServletResponse response,
                                  SecurityFilterChain chain) {
        
        // Get the list of filters in this chain
        List<Filter> filters = chain.getFilters();
        
        // Chain them together
        VirtualFilterChain virtualChain = new VirtualFilterChain(
            request, response, chain, filters
        );
        virtualChain.doFilter(request, response);
    }
}

// The VirtualFilterChain executes each filter in sequence
private static class VirtualFilterChain implements FilterChain {
    
    private int currentPosition = 0;
    private List<Filter> filters;
    
    public void doFilter(ServletRequest request, ServletResponse response) 
            throws IOException, ServletException {
        
        if (currentPosition == filters.size()) {
            // All filters executed, call the actual endpoint
            originalChain.doFilter(request, response);
            return;
        }
        
        // Execute next filter
        Filter nextFilter = filters.get(currentPosition++);
        nextFilter.doFilter(request, response, this);
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Custom JWT Authentication Filter

Implementing a production-grade JWT filter that handles token validation, user loading, and proper error handling. The filter extracts the Bearer token from the Authorization header, validates it (signature + expiration + issuer), and loads the `UserDetails` from database/cache to get the full set of granted authorities.

Note the use of `WebAuthenticationDetailsSource` to attach request metadata (IP address, session ID) to the authentication object. This metadata can be used for audit logging or risk-based authentication downstream.

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    
    @Autowired
    private JwtTokenProvider jwtTokenProvider;
    
    @Autowired
    private UserDetailsService userDetailsService;
    
    @Autowired
    private SecurityProperties securityProperties;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        try {
            String token = extractTokenFromRequest(request);
            
            if (StringUtils.hasText(token) && jwtTokenProvider.validateToken(token)) {
                
                String username = jwtTokenProvider.getUsernameFromToken(token);
                
                // Load user details to get authorities
                UserDetails userDetails = userDetailsService.loadUserByUsername(username);
                
                // Create authenticated token
                UsernamePasswordAuthenticationToken authentication = 
                    new UsernamePasswordAuthenticationToken(
                        userDetails, 
                        null, 
                        userDetails.getAuthorities()
                    );
                
                // Set details with request information
                authentication.setDetails(
                    new WebAuthenticationDetailsSource().buildDetails(request)
                );
                
                // Store in SecurityContext
                SecurityContextHolder.getContext().setAuthentication(authentication);
                
                log.debug("Set security context for user: {}", username);
            }
        } catch (Exception ex) {
            log.error("Could not set user authentication in security context", ex);
        }
        
        filterChain.doFilter(request, response);
    }
    
    private String extractTokenFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}
```

### Case 2: Rate Limiting Filter

Implementing a token bucket algorithm for API rate limiting. The filter tracks per-client token usage using a `ConcurrentHashMap`. Each client has a token bucket with a maximum capacity and a refill rate (tokens per second).

The token bucket algorithm is preferred over a simple counter because it handles burst traffic gracefully — a client can use up its entire capacity in a short burst and then must wait for refill. The `X-RateLimit-Remaining` header lets clients manage their consumption proactively.

```java
@Component
public class RateLimitingFilter extends OncePerRequestFilter {
    
    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();
    
    private final int capacity = 100;  // Max tokens
    private final int refillRate = 10; // Tokens per second
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        String clientId = getClientIdentifier(request);
        TokenBucket bucket = buckets.computeIfAbsent(clientId, 
            k -> new TokenBucket(capacity, refillRate));
        
        if (!bucket.consume()) {
            response.setStatus(429);  // Too Many Requests
            response.setContentType("application/json");
            response.getWriter().write(
                "{\"error\": \"Rate limit exceeded\", \"retryAfter\": " + 
                bucket.timeUntilNextToken() + "}"
            );
            return;
        }
        
        // Add rate limit headers
        response.setHeader("X-RateLimit-Remaining", 
            String.valueOf(bucket.availableTokens()));
        
        filterChain.doFilter(request, response);
    }
    
    private String getClientIdentifier(HttpServletRequest request) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated()) {
            return auth.getName();
        }
        return request.getRemoteAddr();
    }
}

// Token bucket implementation
public class TokenBucket {
    private final int capacity;
    private final double refillRate;
    private double tokens;
    private long lastRefillTime;
    
    public TokenBucket(int capacity, int refillRate) {
        this.capacity = capacity;
        this.refillRate = refillRate;
        this.tokens = capacity;
        this.lastRefillTime = System.nanoTime();
    }
    
    public synchronized boolean consume() {
        refill();
        if (tokens >= 1) {
            tokens -= 1;
            return true;
        }
        return false;
    }
    
    private void refill() {
        long now = System.nanoTime();
        double elapsed = (now - lastRefillTime) / 1_000_000_000.0;
        tokens = Math.min(capacity, tokens + elapsed * refillRate);
        lastRefillTime = now;
    }
    
    public int availableTokens() {
        return (int) tokens;
    }
    
    public long timeUntilNextToken() {
        return tokens < 1 ? (long) ((1 - tokens) / refillRate * 1000) : 0;
    }
}
```

### Case 3: Request/Response Logging and Audit Filter

For compliance and debugging, log all API access. The filter below wraps the response to capture the status code after the controller executes, then logs the complete request/response pair with timing information. The request ID is generated early and attached as a request attribute, making it available to the rest of the application.

The `ContentCachingResponseWrapper` is essential: it buffers the response body so the filter can read the status code and content length without consuming the output stream. Without this wrapper, the filter would see no response data because the original response stream is already committed.

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AuditLoggingFilter extends OncePerRequestFilter {
    
    private static final Logger log = LoggerFactory.getLogger(AuditLoggingFilter.class);
    
    @Autowired
    private AuditService auditService;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        long startTime = System.currentTimeMillis();
        String requestId = UUID.randomUUID().toString();
        request.setAttribute("requestId", requestId);
        
        // Pre-request logging
        log.info("[{}] {} {} from {}",
            requestId, 
            request.getMethod(), 
            request.getRequestURI(),
            request.getRemoteAddr()
        );
        
        // Wrap response to capture status code
        ContentCachingResponseWrapper wrappedResponse = 
            new ContentCachingResponseWrapper(response);
        
        try {
            filterChain.doFilter(request, wrappedResponse);
        } finally {
            // Post-request logging
            long duration = System.currentTimeMillis() - startTime;
            log.info("[{}] Status: {} Duration: {}ms",
                requestId,
                wrappedResponse.getStatus(),
                duration
            );
            
            // Save audit record
            saveAuditRecord(request, response, duration, requestId);
            
            // Copy response to actual response
            wrappedResponse.copyBodyToResponse();
        }
    }
    
    private void saveAuditRecord(HttpServletRequest request, 
                                  HttpServletResponse response, 
                                  long duration,
                                  String requestId) {
        
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String username = (auth != null) ? auth.getName() : "anonymous";
        
        AuditRecord record = AuditRecord.builder()
            .requestId(requestId)
            .username(username)
            .method(request.getMethod())
            .uri(request.getRequestURI())
            .statusCode(response.getStatus())
            .durationMs(duration)
            .timestamp(Instant.now())
            .build();
        
        auditService.save(record);
    }
}
```

### Case 4: CSRF Token Validation Filter

If you're using stateless authentication with JWT but need CSRF protection, a custom filter can skip CSRF for API requests (which are protected by the Bearer token). The filter checks whether the request targets an API endpoint — if so, it bypasses CSRF validation because JWT tokens are immune to CSRF attacks (browsers don't automatically attach Authorization headers on cross-origin form submissions).

For non-API requests (HTML form posts), the filter lets Spring Security's `CsrfFilter` handle validation normally. The `_csrf` request attribute is populated by the `CsrfFilter` earlier in the chain.

```java
@Component
public class CsrfTokenValidationFilter extends OncePerRequestFilter {
    
    @Autowired
    private CsrfTokenRepository csrfTokenRepository;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        // Skip for stateless API endpoints that use JWT
        if (isApiRequest(request)) {
            filterChain.doFilter(request, response);
            return;
        }
        
        // For other requests, let Spring Security's CsrfFilter handle it
        CsrfToken csrfToken = request.getAttribute("_csrf");
        if (csrfToken != null) {
            response.setHeader("X-CSRF-TOKEN", csrfToken.getToken());
        }
        
        filterChain.doFilter(request, response);
    }
    
    private boolean isApiRequest(HttpServletRequest request) {
        String accept = request.getHeader("Accept");
        return accept != null && accept.contains("application/json");
    }
}
```

---

## Trade-offs: When to Use Custom Filters vs Built-in Features

### Custom Filter Advantages

1. **Full control**: You control exactly what happens at each stage
2. **Complex logic**: Implement custom authentication schemes
3. **Integration**: Hook into external authentication services
4. **Monitoring**: Add custom metrics and logging

### Built-in Features Advantages

1. **Tested**: Well-tested by thousands of projects
2. **Maintained**: Security patches applied automatically
3. **Integrated**: Works seamlessly with Spring Security ecosystem

### Decision Matrix

| Scenario | Recommended Approach |
|----------|---------------------|
| JWT authentication | Custom JwtAuthenticationFilter |
| Form login with database | Built-in UsernamePasswordAuthenticationFilter |
| OAuth2/OIDC | Built-in OAuth2LoginAuthenticationFilter |
| API rate limiting | Custom RateLimitingFilter |
| Session fixation protection | Built-in SessionManagementFilter |
| CSRF protection | Built-in CsrfFilter (or custom for APIs) |
| Request validation | Custom validation filter or annotations |

---

## Production Considerations

### 1. Filter Order and Performance

Filter order significantly impacts behavior and performance. A misordered filter can create security vulnerabilities: if your authentication filter runs after the authorization filter, unauthenticated requests might be authorized incorrectly. Conversely, if a heavy logging filter runs before authentication, you'll log requests from unauthenticated users unnecessarily.

The general rule is: CORS first (needed for browsers to even make the request), then authentication, then session management, then authorization, then exception handling.

```java
@Configuration
public class SecurityFilterOrder {
    
    // The order matters! Filters execute in this sequence:
    
    // 1. First - CORS (must be early for cross-origin requests)
    // 2. Session management (must be early for session-based auth)
    // 3. Authentication (must happen before authorization)
    // 4. Authorization (must be late to make final decision)
    // 5. Exception handling (must be near the end)
    
    // WRONG ORDER - causes security vulnerabilities
    http
        .addFilterBefore(myAuthFilter(), ExceptionTranslationFilter.class)  // Too late!
        .addFilterAfter(authorizationFilter(), SecurityContextPersistenceFilter.class);  // Too early!
    
    // CORRECT ORDER
    http
        .addFilterBefore(corsFilter(), SecurityContextPersistenceFilter.class)
        .addFilterAfter(jwtFilter(), SecurityContextPersistenceFilter.class)
        .addFilterAfter(sessionFilter(), JwtAuthenticationFilter.class)
        .addFilterAfter(rateLimitFilter(), AuthorizationFilter.class);
}
```

### 2. SecurityContext and Thread Safety

In async scenarios, SecurityContext isn't automatically propagated. When a controller method returns a `CompletableFuture` or `DeferredResult`, the processing continues on a different thread — one that doesn't have the SecurityContext from the original request thread.

Spring provides `DelegatingSecurityContextExecutor` and `DelegatingSecurityContextRunnable` to explicitly propagate the context. For `@Async` methods, configure a custom Executor bean that wraps the task executor with security context propagation.

```java
// WRONG - Context not propagated to async thread
@GetMapping("/api/data")
public DeferredResult<Data> getData() {
    DeferredResult<Data> result = new DeferredResult<>();
    
    // New thread - SecurityContext is null here!
    asyncService.loadData().thenAccept(data -> {
        // Authentication is null!
        result.setResult(data);
    });
    
    return result;
}

// CORRECT - Explicitly propagate context
@GetMapping("/api/data")
public DeferredResult<Data> getData() {
    DeferredResult<Data> result = new DeferredResult<>();
    
    // Capture current context
    SecurityContext context = SecurityContextHolder.getContext();
    
    asyncService.loadData().thenAccept(data -> {
        // Restore context in new thread
        SecurityContextHolder.setContext(context);
        result.setResult(data);
    });
    
    return result;
}

// BETTER - Use Spring's security executor
@Configuration
public class SecurityAsyncConfig {
    
    @Bean
    public Executor taskExecutor() {
        return new DelegatingSecurityContextExecutor(
            Executors.newFixedThreadPool(10)
        );
    }
}

@RestController
public class DataController {
    
    @Autowired
    private TaskExecutor taskExecutor;  // Auto-wrapped with security context
    
    @GetMapping("/api/data")
    public CompletableFuture<Data> getData() {
        return CompletableFuture.supplyAsync(() -> {
            // SecurityContext is automatically propagated!
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            return dataService.loadData(auth.getName());
        }, taskExecutor);
    }
}
```

### 3. Error Handling in Filters

Filters must handle exceptions properly to avoid leaking information. An uncaught exception in a filter propagates to the servlet container, which typically returns a generic error page or HTML error — not a structured JSON response.

The pattern below catches specific authentication exceptions and returns structured JSON with appropriate status codes. The catch-all for `Exception.class` logs the full details server-side but returns only a generic error message to the client, preventing information leakage.

```java
@Component
public class SecureAuthenticationFilter extends OncePerRequestFilter {
    
    private static final Logger log = LoggerFactory.getLogger(SecureAuthenticationFilter.class);
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) {
        
        try {
            // Authentication logic
            processAuthentication(request);
        } catch (BadCredentialsException e) {
            // Don't expose internal details
            log.warn("Authentication failed for IP: {}", request.getRemoteAddr());
            sendErrorResponse(response, HttpServletResponse.SC_UNAUTHORIZED, 
                "Invalid credentials");
            return;
        } catch (AccountLockedException e) {
            log.warn("Account locked: {}", request.getRemoteAddr());
            sendErrorResponse(response, 423, "Account locked");
            return;
        } catch (Exception e) {
            // Never expose stack traces in production
            log.error("Unexpected error in authentication filter", e);
            sendErrorResponse(response, HttpServletResponse.SC_INTERNAL_SERVER_ERROR, 
                "Internal server error");
            return;
        }
        
        filterChain.doFilter(request, response);
    }
    
    private void sendErrorResponse(HttpServletResponse response, 
                                    int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(
            String.format("{\"error\": \"%s\", \"timestamp\": \"%s\"}", 
                message, Instant.now())
        );
    }
}
```

### 4. Session Management Configuration

For stateless APIs, configure session management appropriately. JWT-based authentication should never create HTTP sessions — the token itself is the session. Setting `SessionCreationPolicy.STATELESS` prevents Spring Security from creating or using sessions.

If you need to disable sessions entirely (even for other purposes), the `StatelessSessionFilter` shown below sets an empty session repository, preventing any session creation anywhere in the application.

```java
@Configuration
@EnableWebSecurity
public class StatelessSecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // For JWT, we don't need session management
            .sessionManagement(session -> 
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            // If using CSRF with stateless, use cookie-based token
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            )
            // Add custom session strategy if needed
            .addFilterBefore(new StatelessSessionFilter(), 
                SecurityContextPersistenceFilter.class);
        
        return http.build();
    }
}

// Custom stateless session filter
public class StatelessSessionFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) {
        
        // Don't create sessions for API requests
        request.setAttribute(SessionRepositoryFilter.SESSION_REPO_ATTR, 
            new EmptySessionRepository());
        
        filterChain.doFilter(request, response);
    }
}

// Empty session repository for truly stateless apps
public class EmptySessionRepository implements HttpSessionRepository<Session> {
    
    @Override
    public Session createSession() {
        return null;  // No session created
    }
    
    @Override
    public void save(Session session) {
        // No-op
    }
    
    @Override
    public Session getSession(String id) {
        return null;
    }
    
    @Override
    public void delete(String id) {
        // No-op
    }
}
```

### 5. Testing Filter Security

Comprehensive testing is essential for security filters. Test each filter with valid tokens, expired tokens, invalid signatures, missing tokens, and tokens with insufficient scope. The `@WithMockUser` annotation provides a convenient way to set up the security context for positive tests.

For negative tests (invalid tokens), make requests without setting up the security context. The filter chain should reject these requests with 401 or 403 status codes. Use `MockMvc` for servlet-based testing and `WebTestClient` for reactive testing.

```java
@SpringBootTest
@AutoConfigureMockMvc
class JwtAuthenticationFilterTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Test
    void validToken_shouldAuthenticate() throws Exception {
        String token = generateValidToken("user", "ROLE_USER");
        
        mockMvc.perform(get("/api/protected")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }
    
    @Test
    void expiredToken_shouldReturn401() throws Exception {
        String token = generateExpiredToken();
        
        mockMvc.perform(get("/api/protected")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Token expired"));
    }
    
    @Test
    void invalidSignature_shouldReturn401() throws Exception {
        String token = generateTokenWithWrongSignature();
        
        mockMvc.perform(get("/api/protected")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isUnauthorized());
    }
    
    @Test
    void missingToken_shouldReturn401() throws Exception {
        mockMvc.perform(get("/api/protected"))
            .andExpect(status().isUnauthorized());
    }
    
    @Test
    void tokenWithoutRequiredRole_shouldReturn403() throws Exception {
        String token = generateValidToken("user", "ROLE_GUEST");
        
        mockMvc.perform(get("/api/admin")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isForbidden());
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Extending OncePerRequestFilter

```java
// WRONG - This filter might run multiple times per request
public class MyFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, 
                         FilterChain chain) {
        // Could be called twice for forwarded requests
    }
}

// CORRECT - Extend OncePerRequestFilter for guaranteed single execution
public class MyFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain chain) {
        // Guaranteed to run only once per request
    }
}
```

### Mistake 2: Forgetting to Call filterChain.doFilter()

```java
// WRONG - Breaking the filter chain
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    if (someCondition) {
        // Processing but forgot to continue chain!
        return;  // Request dies here
    }
    
    filterChain.doFilter(request, response);
}

// CORRECT - Always continue the chain
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    try {
        if (someCondition) {
            // Handle condition
            log.debug("Condition met, continuing...");
        }
    } finally {
        // ALWAYS continue the chain
        filterChain.doFilter(request, response);
    }
}
```

### Mistake 3: Modifying the Response After Chain Execution

```java
// WRONG - Modifying response after chain
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    filterChain.doFilter(request, response);  // Controller executed
    
    // Too late - response is committed!
    response.setHeader("X-Custom", "value");  // May have no effect
    
    // WRONG - Trying to set status after
    response.setStatus(200);  // No effect, headers already sent
}

// CORRECT - Modify response BEFORE continuing chain
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    // Add headers before chain execution
    response.setHeader("X-Request-Id", UUID.randomUUID().toString());
    response.setContentType("application/json;charset=UTF-8");
    
    filterChain.doFilter(request, response);
}
```

### Mistake 4: Not Handling Async Requests

```java
// WRONG - Not handling async servlet requests
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    // For async requests, the filter is called again with AsyncListener events
    // Not checking for these causes duplicate processing
    
    filterChain.doFilter(request, response);
}

// CORRECT - Handle async correctly
@Override
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    // Check if this is an async dispatch
    if (request.isAsyncStarted() && 
        request.getAttribute("__ASYNC__") != null) {
        // Async in progress, let the async filter handle it
        filterChain.doFilter(request, response);
        return;
    }
    
    // Normal request processing
    filterChain.doFilter(request, response);
}

@Override
protected boolean shouldNotFilter(HttpServletRequest request) {
    // Skip filter for async dispatches to avoid double processing
    return request.isAsyncStarted();
}
```

### Mistake 5: Logging Sensitive Data

```java
// WRONG - Logging sensitive authentication data
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    String token = request.getHeader("Authorization");
    
    log.debug("Token: {}", token);  // DANGEROUS - logs actual credentials!
    log.debug("Password: {}", request.getParameter("password"));  // SECURITY BREACH!
    
    filterChain.doFilter(request, response);
}

// CORRECT - Never log sensitive data
protected void doFilterInternal(HttpServletRequest request, 
                                HttpServletResponse response, 
                                FilterChain filterChain) {
    
    String token = request.getHeader("Authorization");
    
    // Log presence but not content
    log.debug("Authorization header present: {}", token != null);
    
    // If needed for debugging, mask the token
    if (token != null && token.length() > 20) {
        log.debug("Token prefix: {}", token.substring(0, 20) + "...");
    }
    
    filterChain.doFilter(request, response);
}
```

### Mistake 6: Not Using SecurityProperties for Configuration

```java
// WRONG - Hardcoding values
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/v1/**").permitAll()  // Hardcoded version
            .requestMatchers("/admin/**").hasRole("ADMIN")  // Hardcoded role
        );
    
    return http.build();
}

// CORRECT - Use configurable properties
@ConfigurationProperties(prefix = "security")
public class SecurityProperties {
    
    private List<String> publicEndpoints = new ArrayList<>();
    private String adminRole = "ROLE_ADMIN";
    private Map<String, String> apiVersions = new HashMap<>();
    
    // Getters and setters
}

@Configuration
@EnableConfigurationProperties(SecurityProperties.class)
public class SecurityConfig {
    
    @Autowired
    private SecurityProperties securityProperties;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> {
                securityProperties.getPublicEndpoints().forEach(
                    endpoint -> auth.requestMatchers(endpoint).permitAll()
                );
                auth.requestMatchers("/admin/**")
                    .hasRole(securityProperties.getAdminRole());
                auth.anyRequest().authenticated();
            });
        
        return http.build();
    }
}

// application.yml
security:
  public-endpoints:
    - /api/public/**
    - /health
  admin-role: ROLE_ADMIN
  api-versions:
    current: v2
    deprecated: v1
```

---

## Summary

Spring Security's filter chain is the backbone of request-level security in Spring applications. Key takeaways:

1. **Understand the order**: Filters execute in a specific sequence; incorrect order causes bugs
2. **Extend OncePerRequestFilter**: Guarantees single execution per request
3. **Handle async properly**: Use `shouldNotFilter()` for async dispatches
4. **Never break the chain**: Always call `filterChain.doFilter()` unless you're fully handling the response
5. **Secure your filters**: Don't log sensitive data, handle exceptions properly, don't expose internal details

The filter chain is your interface to Spring Security's request processing. Master it, and you can implement any authentication or authorization pattern your application needs.

---

## References

- [Spring Security Reference - Servlet Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Spring Security Reference - Filter Chain](https://docs.spring.io/spring-security/reference/servlet/configuration/java.html)
- [Understanding Security Filter Chain in Spring](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter)
- [Baeldung - Spring Security Filters](https://www.baeldung.com/spring-security-custom-filter)

Happy Coding
