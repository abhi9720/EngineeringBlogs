---
title: "OAuth2 Authorization Code Flow"
description: "Comprehensive guide to OAuth2 authorization code flow with PKCE, token exchange, and Spring Security implementation"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - oauth2
  - authorization
  - security
  - spring-security
coverImage: "/images/oauth2-authorization-code-flow.png"
draft: false
---

# OAuth2 Authorization Code Flow

## Overview

The OAuth2 authorization code flow is the most secure grant type for client-server applications. It involves exchanging an authorization code for tokens, ensuring the client secret and tokens are never exposed to the user agent. This guide covers the complete flow, PKCE extension, token exchange mechanics, and Spring Security implementation.

---

## Flow Diagram

```
User (Browser)    Client App (SPA)    Authorization Server    Resource Server
      |                  |                     |                     |
      |-- Login click -->|                     |                     |
      |                  |-- Redirect to Auth -|                     |
      |<-- Auth page ----|                     |                     |
      |-- Authenticate -->|-------------------->|                     |
      |                  |                     |-- Authenticate user |
      |                  |                     |-- Generate auth code|
      |                  |<-- Redirect with ---|                     |
      |<-- Code in URL --|    authorization    |                     |
      |                  |    code             |                     |
      |                  |                     |                     |
      |                  |-- POST /token ----->|                     |
      |                  |   (code +           |                     |
      |                  |    client_secret)   |-- Verify code       |
      |                  |                     |-- Generate tokens   |
      |                  |<-- access_token ----|                     |
      |                  |    refresh_token    |                     |
      |                  |    id_token         |                     |
      |                  |                     |                     |
      |                  |-- GET /api/data --->|-------------------->|
      |                  |   (Bearer token)    |                     |
      |<-- Data ---------|                     |<-- Validate token -|
```

## Authorization Request

### Step 1: Client Registration

```java
@Configuration
public class OAuth2ClientConfig {

    @Bean
    public ClientRegistrationRepository clientRegistrationRepository() {
        return new InMemoryClientRegistrationRepository(
            ClientRegistration.withRegistrationId("my-app")
                .clientId("client-123")
                .clientSecret("secret-456")
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope("openid", "profile", "email", "api:read")
                .authorizationUri("https://auth.example.com/oauth2/authorize")
                .tokenUri("https://auth.example.com/oauth2/token")
                .userInfoUri("https://auth.example.com/userinfo")
                .userNameAttributeName("sub")
                .jwkSetUri("https://auth.example.com/.well-known/jwks.json")
                .clientName("My Application")
                .build()
        );
    }
}
```

### Step 2: Building the Authorization URL

```java
@Service
public class AuthorizationRequestBuilder {

    private static final String AUTH_URL_PATTERN = 
        "%s?response_type=code&client_id=%s&redirect_uri=%s&scope=%s&state=%s";

    public String buildAuthorizationUrl(ClientRegistration registration) {
        String state = generateState();
        storeState(state);  // Save for CSRF validation

        String redirectUri = UriComponentsBuilder.fromUriString(
            registration.getRedirectUri()
        ).buildAndExpand(registration.getRegistrationId()).toString();

        return String.format(
            AUTH_URL_PATTERN,
            registration.getProviderDetails().getAuthorizationUri(),
            registration.getClientId(),
            URLEncoder.encode(redirectUri, StandardCharsets.UTF_8),
            String.join(" ", registration.getScopes()),
            state
        );
    }

    private String generateState() {
        byte[] state = new byte[32];
        new SecureRandom().nextBytes(state);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(state);
    }

    private void storeState(String state) {
        // Store in session for CSRF validation during callback
        SecurityContextHolder.getContext().getAuthentication()
            .setDetails(state);
    }
}
```

### Step 3: Token Exchange

When the authorization server redirects back with an authorization code, the client exchanges it for tokens:

```java
@Component
public class TokenExchangeService {

    private final RestTemplate restTemplate;

    public TokenExchangeService() {
        this.restTemplate = new RestTemplate();
    }

    public TokenResponse exchangeCode(String code, String state, 
                                       String expectedState, ClientRegistration reg) {
        // Validate state to prevent CSRF
        if (!state.equals(expectedState)) {
            throw new SecurityException("State parameter mismatch - possible CSRF attack");
        }

        // Build token request
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setBasicAuth(reg.getClientId(), reg.getClientSecret());

        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "authorization_code");
        body.add("code", code);
        body.add("redirect_uri", reg.getRedirectUri());

        HttpEntity<MultiValueMap<String, String>> request = 
            new HttpEntity<>(body, headers);

        // Exchange code for tokens
        ResponseEntity<TokenResponse> response = restTemplate.postForEntity(
            reg.getProviderDetails().getTokenUri(),
            request,
            TokenResponse.class
        );

        return response.getBody();
    }
}

@Data
public class TokenResponse {
    @JsonProperty("access_token")
    private String accessToken;

    @JsonProperty("token_type")
    private String tokenType;

    @JsonProperty("expires_in")
    private int expiresIn;

    @JsonProperty("refresh_token")
    private String refreshToken;

    @JsonProperty("id_token")
    private String idToken;

    private String scope;
}
```

---

## PKCE (Proof Key for Code Exchange)

PKCE protects authorization code flow for public clients (SPAs, mobile apps) that cannot securely store a client secret.

### PKCE Flow

```
Client (SPA)              Authorization Server
     |                            |
     |-- Generate code_verifier ->|  (random 43-128 char string)
     |-- Compute code_challenge ->|  (SHA256(verifier) -> Base64URL)
     |                            |
     |-- /authorize?             ->|
     |   code_challenge=SHA256... |  (challenge sent in auth request)
     |                            |
     |<-- authorization_code ----|
     |                            |
     |-- /token?                 ->|
     |   code_verifier=original   |  (verifier sent in token request)
     |                            |-- Verify: SHA256(verifier) == challenge
     |<-- tokens -----------------|
```

### PKCE Implementation

```java
@Component
public class PkceManager {

    private static final int VERIFIER_LENGTH = 64;

    public PkcePair generatePkcePair() {
        // Step 1: Generate code_verifier (random string)
        SecureRandom random = new SecureRandom();
        byte[] verifierBytes = new byte[VERIFIER_LENGTH];
        random.nextBytes(verifierBytes);
        String codeVerifier = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(verifierBytes);

        // Step 2: Compute code_challenge = Base64URL(SHA256(verifier))
        String codeChallenge = computeCodeChallenge(codeVerifier);

        return new PkcePair(codeVerifier, codeChallenge, "S256");
    }

    private String computeCodeChallenge(String verifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    public String buildAuthorizationUrlWithPkce(
            ClientRegistration reg, PkcePair pkce) {

        String state = generateState();
        storeState(state);

        return UriComponentsBuilder
            .fromUriString(reg.getProviderDetails().getAuthorizationUri())
            .queryParam("response_type", "code")
            .queryParam("client_id", reg.getClientId())
            .queryParam("redirect_uri", reg.getRedirectUri())
            .queryParam("scope", String.join(" ", reg.getScopes()))
            .queryParam("state", state)
            .queryParam("code_challenge", pkce.getCodeChallenge())
            .queryParam("code_challenge_method", pkce.getChallengeMethod())
            .build()
            .toUriString();
    }

    public TokenResponse exchangeCodeWithPkce(
            String code, String state, String expectedState,
            String codeVerifier, ClientRegistration reg) {

        if (!state.equals(expectedState)) {
            throw new SecurityException("State mismatch");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        // For public clients, no client_secret is sent

        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "authorization_code");
        body.add("code", code);
        body.add("redirect_uri", reg.getRedirectUri());
        body.add("code_verifier", codeVerifier);  // PKCE verifier
        body.add("client_id", reg.getClientId());

        // Exchange
        return restTemplate.postForEntity(
            reg.getProviderDetails().getTokenUri(),
            new HttpEntity<>(body, headers),
            TokenResponse.class
        ).getBody();
    }
}

@Data
@AllArgsConstructor
public class PkcePair {
    private String codeVerifier;
    private String codeChallenge;
    private String challengeMethod;
}
```

---

## Spring Security OAuth2 Client Configuration

### application.yml

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          github:
            client-id: ${GITHUB_CLIENT_ID}
            client-secret: ${GITHUB_CLIENT_SECRET}
            scope: user:email, read:user
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
          
          okta:
            issuer-uri: https://dev-123456.okta.com/oauth2/default
            client-id: ${OKTA_CLIENT_ID}
            client-secret: ${OKTA_CLIENT_SECRET}
            scope: openid, profile, email, offline_access
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
        
        provider:
          okta:
            authorization-uri: https://dev-123456.okta.com/oauth2/default/v1/authorize
            token-uri: https://dev-123456.okta.com/oauth2/default/v1/token
            user-info-uri: https://dev-123456.okta.com/oauth2/default/v1/userinfo
            jwk-set-uri: https://dev-123456.okta.com/oauth2/default/v1/keys
            user-name-attribute: sub
```

### Security Configuration

```java
@Configuration
@EnableWebSecurity
public class OAuth2SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/login", "/error").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2
                .loginPage("/oauth2/authorization/{registrationId}")
                .defaultSuccessUrl("/dashboard", true)
                .failureUrl("/login?error=true")
                .authorizationEndpoint(authorization -> authorization
                    .baseUri("/oauth2/authorize")
                    .authorizationRequestResolver(authorizationRequestResolver())
                )
                .tokenEndpoint(token -> token
                    .accessTokenResponseClient(accessTokenResponseClient())
                )
                .userInfoEndpoint(userInfo -> userInfo
                    .userService(oauth2UserService())
                    .oidcUserService(oidcUserService())
                )
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(Customizer.withDefaults())
            );
        
        return http.build();
    }

    @Bean
    public OAuth2AuthorizationRequestResolver authorizationRequestResolver() {
        DefaultOAuth2AuthorizationRequestResolver resolver = 
            new DefaultOAuth2AuthorizationRequestResolver(
                clientRegistrationRepository(),
                "/oauth2/authorize"
            );
        // Enable PKCE for all public clients
        resolver.setAuthorizationRequestCustomizer(customizer -> customizer
            .attributes(attrs -> {
                // PKCE is auto-enabled for clients without secret
            })
        );
        return resolver;
    }
}
```

---

## Token Validation on Resource Server

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig {

    @Bean
    public SecurityFilterChain resourceServerFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/admin/**").hasAuthority("SCOPE_admin")
                .anyRequest().hasAuthority("SCOPE_api:read")
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );
        
        return http.build();
    }

    private JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter converter = new JwtGrantedAuthoritiesConverter();
        converter.setAuthorityPrefix("SCOPE_");
        converter.setAuthoritiesClaimName("scope");

        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(converter);
        return jwtConverter;
    }
}
```

---

## Common Mistakes

### Mistake 1: Using Implicit Flow (Deprecated)

```java
// WRONG: Implicit flow exposes access token in URL fragment
// https://app.example.com/callback#access_token=eyJ...&token_type=Bearer
// Token is visible in browser history, server logs, referrer headers

// CORRECT: Authorization code flow with PKCE
// Only an authorization code is returned in the URL
// https://app.example.com/callback?code=abc123&state=xyz
// Code is exchanged server-side for tokens
```

### Mistake 2: Not Validating State Parameter

```java
// WRONG: Missing CSRF protection
@RequestMapping("/callback")
public String callback(@RequestParam("code") String code) {
    // No state validation - vulnerable to CSRF
    TokenResponse tokens = exchangeCode(code);
    return "redirect:/dashboard";
}

// CORRECT: Validate state parameter
@RequestMapping("/callback")
public String callback(@RequestParam("code") String code,
                       @RequestParam("state") String state) {
    String storedState = (String) session.getAttribute("oauth_state");
    if (!state.equals(storedState)) {
        throw new SecurityException("State mismatch - possible CSRF attack");
    }
    session.removeAttribute("oauth_state");
    TokenResponse tokens = exchangeCode(code);
    return "redirect:/dashboard";
}
```

### Mistake 3: Leaking Client Secret in Public Clients

```javascript
// WRONG: Client secret in SPA (public client)
// Attacker can extract client_secret from JavaScript bundle
fetch('/token', {
    method: 'POST',
    headers: {
        'Authorization': 'Basic ' + btoa('client-123:my-secret')
    },
    body: 'grant_type=authorization_code&code=abc&redirect_uri=...'
});

// CORRECT: Use PKCE (no client_secret needed)
// Code verifier proves possession without exposing secret
```

---

## Summary

The authorization code flow is the gold standard for OAuth2 delegation. Combine it with PKCE for public clients like SPAs and mobile apps. Always validate the state parameter for CSRF protection. Use short-lived access tokens (15 minutes) with long-lived refresh tokens (7 days) for optimal security and UX balance.

---

## References

- [RFC 6749 - OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
- [RFC 7636 - PKCE](https://tools.ietf.org/html/rfc7636)
- [OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/)
- [Spring Security OAuth2 Client](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html)
- [OAuth 2.0 Security Best Practices](https://tools.ietf.org/html/draft-ietf-oauth-security-topics)

Happy Coding