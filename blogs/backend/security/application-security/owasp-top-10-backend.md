---
title: "OWASP Top 10 for Backend"
description: "Comprehensive guide to the OWASP Top 10 web application security risks from a backend perspective, with Spring Boot mitigation strategies"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - owasp
  - security
  - vulnerabilities
  - spring-boot
coverImage: "/images/owasp-top-10-backend.png"
draft: false
---

# OWASP Top 10 for Backend Applications

## Overview

The OWASP Top 10 is the most recognized list of web application security risks. This guide analyzes each risk from a backend perspective, showing how they manifest in Java/Spring Boot applications and how to prevent them.

---

## A01: Broken Access Control

### The Problem

Access control vulnerabilities occur when users can act outside their intended permissions. Common manifestations include IDOR (Insecure Direct Object References), privilege escalation, and missing authorization for administrative functions.

### In Spring Boot

```java
// VULNERABLE: IDOR - User can access any order
@GetMapping("/orders/{id}")
public Order getOrder(@PathVariable Long id) {
    // No ownership check!
    return orderRepository.findById(id)
        .orElseThrow(() -> new NotFoundException());
}

// SECURE: Verify ownership
@GetMapping("/orders/{id}")
public Order getOrder(@PathVariable Long id) {
    String userId = getCurrentUserId();
    return orderRepository.findByIdAndCustomerId(id, userId)
        .orElseThrow(() -> new AccessDeniedException());
}
```

### Prevention

```java
@Configuration
@EnableMethodSecurity
public class AccessControlConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/orders/**").authenticated()
                .anyRequest().denyAll()
            );
        return http.build();
    }
}
```

---

## A02: Cryptographic Failures

### The Problem

Weak cryptography, hardcoded keys, outdated protocols, and missing encryption for sensitive data in transit or at rest.

### In Spring Boot

```yaml
# INSECURE: Weak TLS, no encryption requirements
server:
  ssl:
    enabled: true
    protocol: TLSv1.0  # Deprecated!
    key-store: classpath:keystore.p12

# SECURE: Modern TLS configuration
server:
  ssl:
    enabled: true
    protocol: TLS
    enabled-protocols: TLSv1.3,TLSv1.2
    ciphers: TLS_AES_256_GCM_SHA384,TLS_CHACHA20_POLY1305_SHA256
```

### Prevention

```java
@Component
public class EncryptionService {

    private static final String AES_GCM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;

    public String encrypt(String plaintext, SecretKey key) throws Exception {
        byte[] iv = new byte[IV_LENGTH];
        SecureRandom.getInstanceStrong().nextBytes(iv);

        Cipher cipher = Cipher.getInstance(AES_GCM);
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));

        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] combined = ByteBuffer.allocate(iv.length + ciphertext.length)
            .put(iv)
            .put(ciphertext)
            .array();

        return Base64.getEncoder().encodeToString(combined);
    }
}
```

---

## A03: Injection

### The Problem

SQL, NoSQL, OS command, and LDAP injection occur when untrusted data is sent to an interpreter as part of a command or query.

### SQL Injection in Spring Boot

```java
// VULNERABLE: String concatenation creates SQL injection
@Query("SELECT * FROM users WHERE name = '" + name + "'")
List<User> findByName(String name);
// Input: name = "' OR '1'='1" -> SELECT * FROM users WHERE name = '' OR '1'='1'

// SECURE: Parameterized query
@Query("SELECT u FROM User u WHERE u.name = :name")
List<User> findByName(@Param("name") String name);

// SECURE: JPA repository method (automatically parameterized)
List<User> findByName(String name);
```

### Command Injection

```java
// VULNERABLE: Shell injection
Runtime.getRuntime().exec("ping " + hostname);
// Input: hostname = "8.8.8.8; rm -rf /"

// SECURE: Use API without shell
InetAddress.getByName(hostname);
```

---

## A04: Insecure Design

### The Problem

Security flaws in the application design that cannot be fixed with configuration alone. Examples include missing rate limiting, trust of external systems, and lack of security in the architecture.

### Prevention

```java
@Configuration
public class SecureDesignConfig {

    @Bean
    public Filter rateLimitingFilter() {
        return new RateLimitingFilter();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .headers(headers -> headers
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'")
                )
                .frameOptions(frame -> frame.deny())
                .xssProtection(xss -> xss
                    .block(true)
                )
                .httpStrictTransportSecurity(hsts -> hsts
                    .maxAgeInSeconds(31536000)
                    .includeSubDomains(true)
                )
            );
        return http.build();
    }
}
```

---

## A05: Security Misconfiguration

### The Problem

Default credentials, unnecessary features enabled, overly verbose error messages, improper HTTP headers.

### Common Misconfigurations

```yaml
# MISCONFIGURED: Debug endpoints exposed, default credentials
spring:
  h2:
    console:
      enabled: true  # H2 console on production!
      path: /h2-console
  jpa:
    show-sql: true  # SQL statements in logs

# SECURE: Production configuration
spring:
  h2:
    console:
      enabled: false
  jpa:
    show-sql: false
  output:
    ansi:
      enabled: never

server:
  error:
    include-stacktrace: never  # No stack traces in responses
  servlet:
    session:
      cookie:
        http-only: true
        secure: true
        same-site: strict
```

---

## A06: Vulnerable and Outdated Components

### The Problem

Using libraries with known vulnerabilities. Spring Boot applications typically have dozens of transitive dependencies.

### Prevention

```xml
<!-- Add OWASP Dependency Check plugin -->
<plugin>
    <groupId>org.owasp</groupId>
    <artifactId>dependency-check-maven</artifactId>
    <version>8.4.0</version>
    <configuration>
        <failBuildOnCVSS>7</failBuildOnCVSS>
        <formats>
            <format>HTML</format>
            <format>JSON</format>
        </formats>
        <suppressionFile>dependency-check-suppressions.xml</suppressionFile>
    </configuration>
</plugin>
```

---

## A07: Identification and Authentication Failures

### The Problem

Weak password policies, credential stuffing, session fixation, missing MFA, and flawed login mechanisms.

### Secure Authentication

```java
@Configuration
public class AuthenticationConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .formLogin(login -> login
                .authenticationFailureHandler(authenticationFailureHandler())
            )
            .sessionManagement(session -> session
                .sessionFixation().migrateSession()
                .maximumSessions(1)
                .maxSessionsPreventsLogin(true)
            );
        return http.build();
    }

    @Bean
    public AuthenticationFailureHandler authenticationFailureHandler() {
        return (request, response, exception) -> {
            // Rate limiting for failed attempts
            String ip = request.getRemoteAddr();
            failedLoginCache.increment(ip);

            response.setStatus(401);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Invalid credentials\"}");
        };
    }
}
```

---

## A08: Software and Data Integrity Failures

### The Problem

CI/CD pipeline compromises, unsigned software updates, and insecure deserialization.

### Insecure Deserialization

```java
// VULNERABLE: Java deserialization of untrusted data
@PostMapping("/import")
public void importData(@RequestBody byte[] data) throws Exception {
    try (ObjectInputStream ois = new ObjectInputStream(
            new ByteArrayInputStream(data))) {
        Object obj = ois.readObject();  // Can execute arbitrary code!
    }
}

// SECURE: Use JSON/Safe serialization
@PostMapping("/import")
public void importData(@RequestBody ImportData data) {
    // Spring automatically deserializes JSON safely
    importService.process(data);
}
```

---

## A09: Security Logging and Monitoring Failures

### The Problem

Insufficient logging of security events, missing alerts for suspicious activity, and lack of audit trails.

### Structured Security Logging

```java
@Component
public class SecurityAuditLogger {

    private static final Logger auditLog = 
        LoggerFactory.getLogger("SECURITY_AUDIT");

    public void logAuthenticationAttempt(String userId, String ip, 
                                          boolean success, String reason) {
        AuditEvent event = AuditEvent.builder()
            .timestamp(Instant.now())
            .type("AUTHENTICATION")
            .userId(userId)
            .sourceIp(ip)
            .success(success)
            .reason(reason)
            .build();

        auditLog.info(event.toJson());
    }

    public void logAuthorizationDecision(String userId, String action,
                                          String resource, boolean granted) {
        AuditEvent event = AuditEvent.builder()
            .timestamp(Instant.now())
            .type("AUTHORIZATION")
            .userId(userId)
            .action(action)
            .resource(resource)
            .success(granted)
            .build();

        auditLog.info(event.toJson());
    }
}
```

---

## A10: Server-Side Request Forgery (SSRF)

### The Problem

SSRF occurs when a server-side application fetches remote resources based on user input without validation, allowing attackers to access internal networks.

### Prevention

```java
@Service
public class SafeHttpClient {

    private static final List<String> ALLOWED_HOSTS = List.of(
        "api.trusted.com", "cdn.example.com"
    );

    private static final Pattern URL_PATTERN = 
        Pattern.compile("^https://([a-z0-9.-]+)/.*$");

    private final RestTemplate restTemplate;

    public String fetchUrl(String url) {
        // Validate URL format
        Matcher matcher = URL_PATTERN.matcher(url);
        if (!matcher.matches()) {
            throw new SecurityException("Invalid URL format");
        }

        // Validate hostname
        String host = matcher.group(1);
        if (!ALLOWED_HOSTS.contains(host)) {
            throw new SecurityException("Host not in whitelist: " + host);
        }

        // Resolve IP and verify it's not internal
        try {
            InetAddress address = InetAddress.getByName(host);
            if (address.isSiteLocalAddress() || address.isLoopbackAddress()) {
                throw new SecurityException("Internal address not allowed");
            }
        } catch (UnknownHostException e) {
            throw new SecurityException("Host resolution failed");
        }

        return restTemplate.getForObject(url, String.class);
    }
}
```

---

## Summary

The OWASP Top 10 provides a systematic way to identify and mitigate the most critical web application security risks. For each risk, Spring Boot provides built-in protections that should be configured properly. The key practices are: use parameterized queries, validate all input, enforce HTTPS, implement proper access control, keep dependencies updated, and maintain security audit logs.

---

## References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Spring Security Documentation](https://docs.spring.io/spring-security/reference/)
- [OWASP Dependency Check](https://owasp.org/www-project-dependency-check/)

Happy Coding