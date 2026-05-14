---
title: "JWT Deep Dive"
description: "Comprehensive deep dive into JWT structure, signing algorithms, token validation, and production security considerations"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - jwt
  - authentication
  - security
  - tokens
coverImage: "/images/jwt-deep-dive.png"
draft: false
---

# JWT Deep Dive: Structure, Algorithms, and Validation

## Overview

JSON Web Tokens (JWT) are the backbone of modern stateless authentication. Understanding their internals—from raw byte structure to cryptographic signing—is essential for building secure authentication systems. This guide covers JWT structure at the byte level, the mechanics of different signing algorithms, and the complete token validation pipeline.

---

## JWT Wire Format: The Raw Structure

A JWT is a URL-safe string composed of three Base64URL-encoded segments separated by dots:

```
<Base64URL(Header)>.<Base64URL(Payload)>.<Signature>
```

Each segment serves a distinct purpose in the token's security model.

### Decoding a Real JWT

Consider this actual token:

```
eyJhbGciOiJSUzI1NiIsImtpZCI6InYyIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFiaGlzaGVrIFRpd2FyaSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjo5OTk5OTk5OTk5fQ.pA3JnFVFGNsL_diX2Q9p3kzCLaRc3vVLoLL9mUZqT1k
```

**Header** (first segment, decoded):

```json
{
  "alg": "RS256",
  "kid": "v2"
}
```

The `kid` (Key ID) tells the validator which signing key was used, enabling key rotation without downtime.

**Payload** (second segment, decoded):

```json
{
  "sub": "1234567890",
  "name": "Abhishek Tiwari",
  "iat": 1516239022,
  "exp": 9999999999
}
```

The `sub` claim identifies the principal. `iat` and `exp` establish the token's temporal validity window.

### Base64URL Encoding Details

JWT uses Base64URL, not standard Base64. The difference matters:

```java
public class Base64UrlExample {
    
    public static void main(String[] args) {
        String json = "{\"alg\":\"HS256\"}";
        
        // Standard Base64 uses + and /
        String standard = Base64.getEncoder().encodeToString(json.getBytes());
        // JmV5SjBhV0ZzY0dsamJtRnRaU0JvZEhSd2N6b3ZMM
        System.out.println("Base64:  " + standard);
        
        // Base64URL replaces + with - and / with _, removes trailing =
        String base64url = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(json.getBytes());
        // JmV5SjBhV0ZzY0dsamJtRnRaU0JvZEhSd2N6b3ZMM
        System.out.println("Base64URL: " + base64url);
    }
}
```

Base64URL is URL-safe because `-` and `_` don't require percent-encoding in URLs.

---

## Signing Algorithm Mechanics

### HMAC with SHA-2 (HS256, HS384, HS512)

HMAC is a symmetric algorithm: the same secret both signs and verifies tokens.

**Signing process**:

```
Signature = HMAC-SHA256(
    secret,
    base64url(header) + "." + base64url(payload)
)
```

Java implementation:

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

public class HmacSigner {
    
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    
    public String sign(String header, String payload, byte[] secret) throws Exception {
        String message = header + "." + payload;
        
        Mac mac = Mac.getInstance(HMAC_ALGORITHM);
        SecretKeySpec keySpec = new SecretKeySpec(secret, HMAC_ALGORITHM);
        mac.init(keySpec);
        
        byte[] signature = mac.doFinal(message.getBytes("UTF-8"));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
    }
    
    public boolean verify(String header, String payload, byte[] secret, String signature) throws Exception {
        String expectedSignature = sign(header, payload, secret);
        // Constant-time comparison to prevent timing attacks
        return MessageDigest.isEqual(
            expectedSignature.getBytes(),
            signature.getBytes()
        );
    }
}
```

**Security characteristics**:
- Single shared secret, no key distribution
- Fast computation
- Not suitable for distributed systems where multiple services need to verify
- Secret must be rotated if compromised

### RSA PKCS#1 v1.5 with SHA-2 (RS256, RS384, RS512)

RSA is asymmetric: a private key signs, a public key verifies.

**Signing process**:

```
Signature = RSA-Sign(
    SHA256(base64url(header) + "." + base64url(payload)),
    privateKey
)
```

Java implementation:

```java
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

public class RsaSigner {
    
    private static final String SIGNATURE_ALGORITHM = "SHA256withRSA";
    
    public String sign(String header, String payload, PrivateKey privateKey) 
            throws Exception {
        String message = header + "." + payload;
        
        Signature signature = Signature.getInstance(SIGNATURE_ALGORITHM);
        signature.initSign(privateKey);
        signature.update(message.getBytes("UTF-8"));
        
        byte[] signatureBytes = signature.sign();
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signatureBytes);
    }
    
    public boolean verify(String header, String payload, 
                          PublicKey publicKey, String signatureBase64) throws Exception {
        String message = header + "." + payload;
        
        Signature signature = Signature.getInstance(SIGNATURE_ALGORITHM);
        signature.initVerify(publicKey);
        signature.update(message.getBytes("UTF-8"));
        
        byte[] signatureBytes = Base64.getUrlDecoder().decode(signatureBase64);
        return signature.verify(signatureBytes);
    }
    
    // Key generation
    public KeyPair generateKeyPair() throws NoSuchAlgorithmException {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);  // Minimum 2048 bits
        return generator.generateKeyPair();
    }
}
```

**Security characteristics**:
- Private key stays on the signing server
- Any service with the public key can verify
- Larger signatures (256 bytes for 2048-bit RSA)
- Slower than HMAC

### ECDSA with P-256 (ES256)

ECDSA uses elliptic curve cryptography for smaller signatures with equivalent security.

**Signing process**:

```
Signature = ECDSA-Sign(
    SHA256(base64url(header) + "." + base64url(payload)),
    privateKey (EC)
)

// Signature is DER-encoded by default, but JWT uses raw R||S format
```

Java implementation:

```java
public class EcdsaSigner {
    
    private static final String SIGNATURE_ALGORITHM = "SHA256withECDSA";
    
    public String sign(String header, String payload, PrivateKey privateKey) 
            throws Exception {
        String message = header + "." + payload;
        
        Signature signature = Signature.getInstance(SIGNATURE_ALGORITHM);
        signature.initSign(privateKey);
        signature.update(message.getBytes());
        
        // Java returns DER-encoded signature, needs conversion to R||S format
        byte[] derSignature = signature.sign();
        byte[] rawSignature = derToRaw(derSignature, 32);  // 32 bytes for P-256
        
        return Base64.getUrlEncoder().withoutPadding().encodeToString(rawSignature);
    }
    
    private byte[] derToRaw(byte[] derSignature, int keySizeBytes) throws Exception {
        // Convert DER-encoded ECDSA signature to raw R||S format
        // DER format: 30 <len> 02 <rlen> <r> 02 <slen> <s>
        if (derSignature[0] != 0x30) {
            throw new IllegalArgumentException("Invalid DER signature");
        }
        
        int offset = 2;
        int rLen = derSignature[offset + 1];
        offset += 2;
        byte[] r = extractBytes(derSignature, offset, rLen, keySizeBytes);
        offset += rLen;
        
        int sLen = derSignature[offset + 1];
        offset += 2;
        byte[] s = extractBytes(derSignature, offset, sLen, keySizeBytes);
        
        byte[] rawSignature = new byte[keySizeBytes * 2];
        System.arraycopy(r, 0, rawSignature, 0, keySizeBytes);
        System.arraycopy(s, 0, rawSignature, keySizeBytes, keySizeBytes);
        
        return rawSignature;
    }
    
    private byte[] extractBytes(byte[] data, int offset, int len, int keySize) {
        if (len == keySize + 1 && data[offset] == 0x00) {
            // Strip leading zero
            byte[] result = new byte[keySize];
            System.arraycopy(data, offset + 1, result, 0, keySize);
            return result;
        }
        if (len < keySize) {
            // Pad with leading zeros
            byte[] result = new byte[keySize];
            System.arraycopy(data, offset, result, keySize - len, len);
            return result;
        }
        byte[] result = new byte[keySize];
        System.arraycopy(data, offset, result, 0, keySize);
        return result;
    }
}
```

**Security characteristics**:
- Much smaller signatures than RSA (64 bytes for P-256 vs 256 bytes for 2048-bit RSA)
- Equivalent security to RSA with smaller key sizes
- More complex to implement correctly (nonce generation is critical)
- Faster verification than RSA

### Algorithm Comparison

| Metric | HS256 | RS256 | ES256 |
|--------|-------|-------|-------|
| Key type | Symmetric | Asymmetric | Asymmetric |
| Signature size | 32 bytes | 256 bytes | 64 bytes |
| Sign speed | Fast | Slow | Medium |
| Verify speed | Fast | Medium | Fast |
| Key rotation | Difficult | Easy | Easy |
| Distributed use | No | Yes | Yes |
| Min key size | 256 bits | 2048 bits | 256 bits |

---

## Complete Token Validation Pipeline

A robust JWT validator performs these checks in order:

```java
@Component
public class JwtValidator {
    
    private static final Logger log = LoggerFactory.getLogger(JwtValidator.class);
    
    private final KeyStore keyStore;
    private final JwtConfig config;
    
    public JwtValidator(KeyStore keyStore, JwtConfig config) {
        this.keyStore = keyStore;
        this.config = config;
    }
    
    public ValidationResult validateToken(String token) {
        try {
            // Step 1: Parse the token into its parts
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                return ValidationResult.invalid("Malformed token: expected 3 parts");
            }
            
            String headerB64 = parts[0];
            String payloadB64 = parts[1];
            String signatureB64 = parts[2];
            
            // Step 2: Decode and validate header
            JwtHeader header = decodeHeader(headerB64);
            ValidationResult headerResult = validateHeader(header);
            if (!headerResult.isValid()) {
                return headerResult;
            }
            
            // Step 3: Decode payload
            JwtPayload payload = decodePayload(payloadB64);
            
            // Step 4: Validate signature using the algorithm from header
            ValidationResult sigResult = validateSignature(
                headerB64, payloadB64, signatureB64, header
            );
            if (!sigResult.isValid()) {
                return sigResult;
            }
            
            // Step 5: Validate temporal claims
            ValidationResult temporalResult = validateTemporalClaims(payload);
            if (!temporalResult.isValid()) {
                return temporalResult;
            }
            
            // Step 6: Validate issuer and audience
            ValidationResult claimsResult = validateIssuerAndAudience(payload);
            if (!claimsResult.isValid()) {
                return claimsResult;
            }
            
            return ValidationResult.valid(payload);
            
        } catch (Exception e) {
            log.warn("JWT validation failed: {}", e.getMessage());
            return ValidationResult.invalid("Token validation error: " + e.getMessage());
        }
    }
    
    private ValidationResult validateHeader(JwtHeader header) {
        // Reject "none" algorithm
        if ("none".equals(header.getAlg())) {
            return ValidationResult.invalid("Algorithm 'none' is not allowed");
        }
        
        // Verify algorithm is in whitelist
        if (!config.getAllowedAlgorithms().contains(header.getAlg())) {
            return ValidationResult.invalid(
                "Algorithm " + header.getAlg() + " is not in allowed list"
            );
        }
        
        // Verify algorithm matches expected type
        if (!header.getAlg().matches("^(HS|RS|ES)(256|384|512)$")) {
            return ValidationResult.invalid("Unsupported algorithm: " + header.getAlg());
        }
        
        return ValidationResult.valid();
    }
    
    private ValidationResult validateSignature(
            String headerB64, String payloadB64, 
            String signatureB64, JwtHeader header) {
        
        try {
            String message = headerB64 + "." + payloadB64;
            byte[] signature = Base64.getUrlDecoder().decode(signatureB64);
            
            // Resolve key using kid from header
            String kid = header.getKid();
            Key signingKey = keyStore.getSigningKey(kid, header.getAlg());
            
            if (signingKey == null) {
                return ValidationResult.invalid("No signing key found for kid: " + kid);
            }
            
            boolean verified = verifyWithAlgorithm(
                message, signature, signingKey, header.getAlg()
            );
            
            if (!verified) {
                return ValidationResult.invalid("Signature verification failed");
            }
            
            return ValidationResult.valid();
            
        } catch (Exception e) {
            return ValidationResult.invalid("Signature verification error: " + e.getMessage());
        }
    }
    
    private boolean verifyWithAlgorithm(
            String message, byte[] signature, 
            Key key, String algorithm) throws Exception {
        
        switch (algorithm) {
            case "HS256":
            case "HS384":
            case "HS512":
                return verifyHmac(message, signature, key, algorithm);
            case "RS256":
            case "RS384":
            case "RS512":
                return verifyRsa(message, signature, key, algorithm);
            case "ES256":
            case "ES384":
            case "ES512":
                return verifyEcdsa(message, signature, key, algorithm);
            default:
                throw new IllegalArgumentException("Unsupported algorithm: " + algorithm);
        }
    }
    
    private boolean verifyRsa(String message, byte[] signature, 
                              Key key, String algorithm) throws Exception {
        String jcaAlgorithm = algorithm.replace("RS", "SHA") + "withRSA";
        Signature sig = Signature.getInstance(jcaAlgorithm);
        sig.initVerify((PublicKey) key);
        sig.update(message.getBytes(StandardCharsets.UTF_8));
        return sig.verify(signature);
    }
    
    private ValidationResult validateTemporalClaims(JwtPayload payload) {
        Instant now = Instant.now();
        
        // Check expiration
        if (payload.getExp() != null) {
            Instant exp = Instant.ofEpochSecond(payload.getExp());
            if (now.isAfter(exp.plusSeconds(config.getAllowedClockSkewSeconds()))) {
                return ValidationResult.invalid("Token expired at " + exp);
            }
        }
        
        // Check not-before
        if (payload.getNbf() != null) {
            Instant nbf = Instant.ofEpochSecond(payload.getNbf());
            if (now.isBefore(nbf.minusSeconds(config.getAllowedClockSkewSeconds()))) {
                return ValidationResult.invalid("Token not yet valid until " + nbf);
            }
        }
        
        // Check issued-at
        if (payload.getIat() != null) {
            Instant iat = Instant.ofEpochSecond(payload.getIat());
            if (now.isBefore(iat.minusSeconds(config.getAllowedClockSkewSeconds()))) {
                return ValidationResult.invalid("Token issued in the future");
            }
        }
        
        return ValidationResult.valid();
    }
    
    private ValidationResult validateIssuerAndAudience(JwtPayload payload) {
        // Validate issuer
        if (config.getExpectedIssuer() != null && payload.getIss() != null) {
            if (!config.getExpectedIssuer().equals(payload.getIss())) {
                return ValidationResult.invalid(
                    "Expected issuer " + config.getExpectedIssuer() + 
                    " but got " + payload.getIss()
                );
            }
        }
        
        // Validate audience
        if (config.getExpectedAudience() != null && payload.getAud() != null) {
            List<String> audiences = payload.getAud();
            if (!audiences.contains(config.getExpectedAudience())) {
                return ValidationResult.invalid(
                    "Token audience does not include " + config.getExpectedAudience()
                );
            }
        }
        
        return ValidationResult.valid();
    }
    
    private JwtHeader decodeHeader(String base64Url) {
        byte[] decoded = Base64.getUrlDecoder().decode(base64Url);
        String json = new String(decoded, StandardCharsets.UTF_8);
        return objectMapper.readValue(json, JwtHeader.class);
    }
    
    private JwtPayload decodePayload(String base64Url) {
        byte[] decoded = Base64.getUrlDecoder().decode(base64Url);
        String json = new String(decoded, StandardCharsets.UTF_8);
        return objectMapper.readValue(json, JwtPayload.class);
    }
}
```

### Validation Order Matters

Each validation step catches different attacks:

1. **Structural parse**: Rejects garbage input early
2. **Header validation**: Prevents algorithm confusion attacks ("none" algorithm, alg-to-key mismatch)
3. **Signature verification**: Ensures token integrity, must happen before reading claims
4. **Temporal claims**: Checks expiration, not-before, and clock skew
5. **Issuer/audience**: Confirms the token was issued by a trusted authority for this service

---

## Algorithm Confusion Attack

The most dangerous JWT vulnerability occurs when an attacker changes the algorithm from RS256 to HS256. Since HS256 uses the same key for signing and verification:

```java
// VULNERABLE: Using the same object for both key types
@Bean
public JwtDecoder jwtDecoder() {
    // If the server stores an RSA public key but accepts HS256 tokens:
    return NimbusJwtDecoder.withSecretKey(publicKey.getEncoded()).build();
    // The attacker can:
    // 1. Create an HMAC-SHA256 signature using the RSA public key (which is public)
    // 2. Set alg to "HS256"
    // 3. Server treats the public key as an HMAC secret and verifies!
}
```

**Prevention**: Enforce algorithm whitelisting:

```java
@Bean
public JwtDecoder jwtDecoder() {
    NimbusJwtDecoder decoder = NimbusJwtDecoder
        .withPublicKey(publicKey)
        .signatureAlgorithm(SignatureAlgorithm.RS256)
        .build();
    
    // This prevents the "alg" field from switching to HS256
    decoder.setJwtValidator(new JwtValidators.createDefaultWithIssuer(issuer));
    return decoder;
}
```

---

## Token Revocation Strategies

JWT revocation is inherently difficult. Implement one of these patterns:

### Strategy 1: Short-Lived Tokens with Refresh Token Rotation

```java
public class TokenRotationService {
    
    private static final Duration ACCESS_TOKEN_TTL = Duration.ofMinutes(15);
    private static final Duration REFRESH_TOKEN_TTL = Duration.ofDays(7);
    
    private final RefreshTokenRepository refreshTokenRepo;
    private final JwtTokenProvider tokenProvider;
    
    public AuthResponse issueTokens(User user) {
        String accessToken = tokenProvider.generateAccessToken(user, ACCESS_TOKEN_TTL);
        RefreshToken refreshToken = createRefreshToken(user);
        
        return new AuthResponse(accessToken, refreshToken.getToken());
    }
    
    public AuthResponse rotateRefreshToken(String currentRefreshToken) {
        RefreshToken stored = refreshTokenRepo.findByTokenHash(hash(currentRefreshToken))
            .orElseThrow(() -> new InvalidTokenException("Refresh token not found"));
        
        if (stored.isRevoked() || stored.isExpired()) {
            // Potential token theft: revoke all tokens for this user
            refreshTokenRepo.revokeAllForUser(stored.getUserId());
            throw new InvalidTokenException("Refresh token compromised");
        }
        
        // Revoke current token (rotation)
        stored.setRevoked(true);
        refreshTokenRepo.save(stored);
        
        // Issue new pair
        return issueTokens(stored.getUser());
    }
    
    private RefreshToken createRefreshToken(User user) {
        String token = generateSecureRandomToken();
        return refreshTokenRepo.save(RefreshToken.builder()
            .userId(user.getId())
            .tokenHash(hash(token))
            .expiresAt(Instant.now().plus(REFRESH_TOKEN_TTL))
            .revoked(false)
            .build()
        );
    }
    
    private String generateSecureRandomToken() {
        byte[] randomBytes = new byte[32];
        new SecureRandom().nextBytes(randomBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    }
    
    private String hash(String token) {
        return Hashing.sha256().hashString(token, StandardCharsets.UTF_8).toString();
    }
}
```

### Strategy 2: Token Blocklist

```java
@Component
public class JwtBlocklist {
    
    private final RedisTemplate<String, String> redis;
    
    public void blockToken(String jti, Instant exp) {
        Duration ttl = Duration.between(Instant.now(), exp);
        if (!ttl.isNegative()) {
            redis.opsForValue().set(
                "blocklist:" + jti,
                "revoked",
                ttl.getSeconds(),
                TimeUnit.SECONDS
            );
        }
    }
    
    public boolean isBlocked(String jti) {
        return Boolean.TRUE.equals(redis.hasKey("blocklist:" + jti));
    }
}
```

---

## Best Practices

1. **Use asymmetric algorithms (RS256/ES256) for distributed systems** where multiple services verify tokens
2. **Set explicit expiration** on all tokens, never omit `exp`
3. **Include a unique jti (JWT ID) claim** for revocation tracking
4. **Validate all claims**—never skip signature verification
5. **Use key rotation** with `kid` header parameter
6. **Keep payload small**—JWTs are included in every request
7. **Never store secrets or sensitive data** in claims (they are only base64-encoded)
8. **Use constant-time comparison** for HMAC signature verification

---

## Common Mistakes

### Mistake 1: Accepting Algorithm "none"

```java
// WRONG: Vulnerable to alg:none attack
String[] parts = token.split("\\.");
String header = new String(Base64.getDecoder().decode(parts[0]));
// Attacker sets {"alg":"none"} and sends no signature
// Server accepts without verification

// CORRECT: Reject "none" algorithm explicitly
Jwt jwt = Jwts.parserBuilder()
    .requireAlgorithm("RS256")  // Require specific algorithm
    .setSigningKey(publicKey)
    .build()
    .parseClaimsJws(token);
```

### Mistake 2: Using Wrong Key Type for Algorithm

```java
// WRONG: Using public key bytes as HMAC secret
byte[] publicKeyBytes = publicKey.getEncoded();
NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(publicKeyBytes).build();

// CORRECT: Use appropriate decoder for algorithm
NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(publicKey)
    .signatureAlgorithm(SignatureAlgorithm.RS256)
    .build();
```

### Mistake 3: Not Validating Token Before Claims Extraction

```java
// WRONG: Parsing without validation
Claims claims = Jwts.parser()
    .parseClaimsJwt(token)  // Unsecured JWT parser!
    .getBody();

// CORRECT: Use signed parser
Claims claims = Jwts.parserBuilder()
    .setSigningKey(key)
    .build()
    .parseClaimsJws(token)  // Secured JWS parser
    .getBody();
```

---

## Summary

JWT is a powerful but nuanced authentication mechanism. The three-part structure (header, payload, signature) enables stateless verification, but each component must be carefully validated. Choose HS256 for simple single-service setups, RS256 for multi-service architectures, and ES256 when signature size matters. Always validate the algorithm, signature, expiration, and audience in that order.

---

## References

- [RFC 7519 - JSON Web Token](https://tools.ietf.org/html/rfc7519)
- [RFC 7515 - JSON Web Signature](https://tools.ietf.org/html/rfc7515)
- [RFC 7518 - JSON Web Algorithms](https://tools.ietf.org/html/rfc7518)
- [JWT.io - JWT Debugger](https://jwt.io)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet_for_Developers.html)
- [NIST SP 800-56B - RSA Key Size Recommendations](https://csrc.nist.gov/publications/detail/sp/800-56b/rev-2/final)

Happy Coding