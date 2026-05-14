---
title: API Key Management
description: >-
  Implement API key management: generation, validation, rotation, revocation,
  hashing strategies, and secure storage patterns
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - api-keys
  - security
  - key-management
  - authentication
coverImage: /images/backend/api-design/api-security/api-key-management.png
draft: false
order: 20
---
# API Key Management

## Overview

API keys are a simple yet effective authentication mechanism for machine-to-machine communication. Proper API key management involves secure generation, storage, distribution, rotation, and revocation. Poor key management leads to security breaches and unauthorized access.

---

## API Key Generation

### Secure Key Generation

API keys must be cryptographically random and unpredictable. Using `SecureRandom` (not `Random`) ensures the keys have sufficient entropy to resist brute-force attacks. A common pattern is the `prefix.secret` format: a short, identifiable prefix (like `sk_live_abc123`) that allows the server to identify the key type and client without exposing the full secret, followed by a high-entropy secret (at least 32 bytes / 256 bits). The prefix is stored in plain text for lookup, while the secret portion is hashed with SHA-256 before storage — the raw secret is never persisted.

```java
@Component
public class ApiKeyGenerator {

    private static final SecureRandom secureRandom = new SecureRandom();

    public ApiKey generateApiKey() {
        // Generate two parts: prefix for identification, secret for authentication
        String prefix = generatePrefix();
        String secret = generateSecret();

        return ApiKey.builder()
            .prefix(prefix)
            .secret(secret)
            .rawKey(prefix + "." + secret)
            .hashedKey(hashKey(secret))
            .build();
    }

    private String generatePrefix() {
        // Short prefix for identification (e.g., sk_live_ or pk_test_)
        byte[] randomBytes = new byte[4];
        secureRandom.nextBytes(randomBytes);
        return "sk_" + Base64.getUrlEncoder().withoutPadding()
            .encodeToString(randomBytes);
    }

    private String generateSecret() {
        // 32 bytes of random data -> 43 character base64 string
        byte[] secretBytes = new byte[32];
        secureRandom.nextBytes(secretBytes);
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(secretBytes);
    }

    public static String hashKey(String secret) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(secret.getBytes(StandardCharsets.UTF_8));
            return Bytes.toHexString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}

@Builder
class ApiKey {
    private String prefix;    // sk_abc123
    private String secret;    // 43-char random string
    private String rawKey;    // sk_abc123.43-char-secret
    private String hashedKey; // SHA-256 of secret
}
```

The key service manages the full lifecycle of API keys — creation, validation, and caching. On creation, the raw key is returned exactly once to the client with a warning to store it securely. The service validates incoming requests by extracting the prefix for lookup, hashing the secret, and comparing with the stored hash. Caching validated keys (using Redis or Caffeine) dramatically reduces database load on frequently-used keys — but must be invalidated immediately when a key is revoked or rotated. Notice that the validation logic never stores or returns the raw key; it only compares hashes.

### Key Service

```java
@Service
public class ApiKeyService {

    private final ApiKeyRepository apiKeyRepository;
    private final ApiKeyGenerator keyGenerator;
    private final CacheManager cacheManager;

    public ApiKeyService(ApiKeyRepository apiKeyRepository,
                         ApiKeyGenerator keyGenerator,
                         CacheManager cacheManager) {
        this.apiKeyRepository = apiKeyRepository;
        this.keyGenerator = keyGenerator;
        this.cacheManager = cacheManager;
    }

    @Transactional
    public CreatedApiKey createKey(String clientId, String label, List<String> permissions) {
        ApiKey generated = keyGenerator.generateApiKey();

        KeyEntity entity = new KeyEntity();
        entity.setPrefix(generated.getPrefix());
        entity.setKeyHash(generated.getHashedKey());
        entity.setLabel(label);
        entity.setClientId(clientId);
        entity.setPermissions(permissions);
        entity.setActive(true);
        entity.setCreatedAt(Instant.now());
        entity.setLastUsedAt(null);

        apiKeyRepository.save(entity);

        // Return raw key ONCE - it cannot be retrieved again
        return CreatedApiKey.builder()
            .id(entity.getId())
            .prefix(entity.getPrefix())
            .rawKey(generated.getRawKey())
            .label(label)
            .permissions(permissions)
            .createdAt(entity.getCreatedAt())
            .warning("Store this key securely. It will not be shown again.")
            .build();
    }

    public Optional<KeyEntity> validateKey(String rawKey) {
        // Parse prefix.secret format
        int dotIndex = rawKey.indexOf('.');
        if (dotIndex == -1) return Optional.empty();

        String prefix = rawKey.substring(0, dotIndex);
        String secret = rawKey.substring(dotIndex + 1);

        String hashedSecret = ApiKeyGenerator.hashKey(secret);

        // Check cache first
        String cacheKey = "apikey:" + prefix;
        KeyEntity cached = cacheManager.getCache("apiKeys")
            .get(cacheKey, KeyEntity.class);

        if (cached != null && cached.getKeyHash().equals(hashedSecret)) {
            return Optional.of(cached);
        }

        // Look up by prefix and hash
        Optional<KeyEntity> entity = apiKeyRepository
            .findByPrefixAndKeyHash(prefix, hashedSecret);

        entity.ifPresent(e -> {
            if (e.isActive()) {
                // Cache the result
                cacheManager.getCache("apiKeys")
                    .put(cacheKey, e);

                // Update last used timestamp
                apiKeyRepository.updateLastUsed(e.getId(), Instant.now());
            }
        });

        return entity.filter(KeyEntity::isActive);
    }
}
```

---

## Key Rotation

Key rotation is the practice of periodically replacing API keys to limit the window of exposure if a key is compromised. Automated rotation ensures that keys do not live beyond their useful lifespan without manual intervention. A 90-day rotation interval is standard for most systems, though high-security environments may require more frequent rotation (30 days or less). The rotation process should include a grace period where both old and new keys are accepted, allowing clients to update their configuration without service disruption.

### Automatic Key Rotation

```java
@Service
public class KeyRotationService {

    private final ApiKeyRepository keyRepository;

    private static final Duration ROTATION_INTERVAL = Duration.ofDays(90);

    @Scheduled(cron = "0 0 3 * * ?") // Daily at 3 AM
    @Transactional
    public void rotateExpiringKeys() {
        Instant rotationThreshold = Instant.now().minus(ROTATION_INTERVAL);

        List<KeyEntity> keysToRotate = keyRepository
            .findKeysCreatedBefore(rotationThreshold);

        for (KeyEntity oldKey : keysToRotate) {
            try {
                rotateKey(oldKey);
            } catch (Exception e) {
                log.error("Failed to rotate key {}", oldKey.getId(), e);
            }
        }
    }

    @Transactional
    public RotatedKey rotateKey(KeyEntity oldKey) {
        // Deactivate old key
        oldKey.setActive(false);
        keyRepository.save(oldKey);

        // Create new key for same client
        ApiKey generated = keyGenerator.generateApiKey();

        KeyEntity newKey = new KeyEntity();
        newKey.setPrefix(generated.getPrefix());
        newKey.setKeyHash(generated.getHashedKey());
        newKey.setLabel(oldKey.getLabel() + " (rotated)");
        newKey.setClientId(oldKey.getClientId());
        newKey.setPermissions(oldKey.getPermissions());
        newKey.setActive(true);
        newKey.setCreatedAt(Instant.now());
        newKey.setRotatedFromKeyId(oldKey.getId());

        keyRepository.save(newKey);

        // Invalidate cache for old key
        cacheManager.getCache("apiKeys")
            .evict("apikey:" + oldKey.getPrefix());

        return RotatedKey.builder()
            .newKeyId(newKey.getId())
            .rawKey(generated.getRawKey())
            .oldKeyId(oldKey.getId())
            .build();
    }

    // Grace period: allow old key for 24 hours after rotation
    public boolean isWithinGracePeriod(KeyEntity key) {
        if (key.getRotatedFromKeyId() == null) return false;
        return Duration.between(key.getUpdatedAt(), Instant.now())
            .compareTo(Duration.ofHours(24)) < 0;
    }
}
```

---

## Key Revocation

Immediate key revocation is critical when a key is suspected to be compromised — whether through a security incident, employee departure, or exposed credentials. The revocation service marks keys as inactive in the database, evicts them from all caches to prevent stale validations, and publishes revocation events so that distributed services can update their local deny lists. In a microservice architecture, revocation events should propagate quickly (within seconds) through a message queue or pub/sub system to prevent authorization gaps.

### Revocation Service

```java
@Service
public class KeyRevocationService {

    private final ApiKeyRepository keyRepository;
    private final CacheManager cacheManager;
    private final RevocationListPublisher revocationPublisher;

    @Transactional
    public void revokeKey(Long keyId, String reason) {
        KeyEntity key = keyRepository.findById(keyId)
            .orElseThrow(() -> new ResourceNotFoundException("Key not found"));

        key.setActive(false);
        key.setRevokedAt(Instant.now());
        key.setRevocationReason(reason);
        keyRepository.save(key);

        // Evict from cache
        cacheManager.getCache("apiKeys")
            .evict("apikey:" + key.getPrefix());

        // Publish revocation event for distributed systems
        revocationPublisher.publishRevocation(KeyRevokedEvent.builder()
            .keyId(key.getId())
            .prefix(key.getPrefix())
            .clientId(key.getClientId())
            .revokedAt(key.getRevokedAt())
            .reason(reason)
            .build());
    }

    @Transactional
    public void revokeAllKeysForClient(String clientId, String reason) {
        List<KeyEntity> activeKeys = keyRepository
            .findActiveKeysByClientId(clientId);

        activeKeys.forEach(key -> revokeKey(key.getId(), reason));
    }
}
```

---

## Audit Logging

Comprehensive audit logging is essential for security compliance and incident response. Every key-related event — creation, validation, revocation, rotation — should be logged with sufficient detail to reconstruct the timeline of an incident. Log entries should include the key prefix (never the full key or secret), the client identifier, the action performed, the source IP address, and the timestamp. For security-sensitive environments like financial services or healthcare, audit logs must be immutable and stored separately from application logs to prevent tampering.

### Key Usage Audit

```java
@Component
public class ApiKeyAuditLogger {

    private final AuditLogRepository auditLogRepository;

    public void logKeyUsage(KeyEntity key, String action, HttpServletRequest request) {
        AuditLog log = new AuditLog();
        log.setKeyId(key.getId());
        log.setPrefix(key.getPrefix());
        log.setClientId(key.getClientId());
        log.setAction(action);
        log.setIpAddress(request.getRemoteAddr());
        log.setUserAgent(request.getHeader("User-Agent"));
        log.setEndpoint(request.getRequestURI());
        log.setMethod(request.getMethod());
        log.setTimestamp(Instant.now());

        auditLogRepository.save(log);
    }

    public void logKeyEvent(KeyEntity key, KeyEventType eventType, String details) {
        KeyEventLog event = new KeyEventLog();
        event.setKeyId(key.getId());
        event.setPrefix(key.getPrefix());
        event.setEventType(eventType);
        event.setDetails(details);
        event.setTimestamp(Instant.now());

        auditLogRepository.saveEvent(event);
    }
}

enum KeyEventType {
    CREATED,
    VALIDATED,
    REVOKED,
    ROTATED,
    EXPIRED,
    COMPROMISED
}
```

---

## Best Practices

Effective API key management combines secure generation, safe storage, regular rotation, and comprehensive monitoring. The following practices form a defense-in-depth strategy that protects against common attack vectors including key leakage, brute-force guessing, and compromised credentials.

1. **Use prefix.secret format**: Easy to identify key type without exposing secret
2. **Hash the secret part**: Never store raw keys in database
3. **Show key once**: Return raw key only at creation time
4. **Implement key rotation**: Automatic 90-day rotation
5. **Grace period on rotation**: Allow old key briefly during transition
6. **Granular permissions**: Assign specific scopes to each key
7. **Rate limit by key**: Different limits per key tier
8. **Monitor key usage**: Alert on unusual patterns
9. **Revocation list**: Distributed revocation for multi-service
10. **Audit all key events**: Full audit trail for compliance

```java
// Permission validation
public boolean hasPermission(KeyEntity key, String requiredPermission) {
    return key.getPermissions().contains("admin")
        || key.getPermissions().contains(requiredPermission);
}
```

---

## Common Mistakes

### Mistake 1: Storing Keys in Plain Text

Storing raw API keys in the database is equivalent to storing passwords in plain text. If the database is breached, every API key is immediately usable. Always hash the secret portion of the key using a cryptographic hash function (SHA-256 is standard) before storage. The prefix can be stored in plain text because it only identifies the key owner and type — it cannot be used for authentication without the secret.

```java
// WRONG: Raw key stored in database
keyEntity.setRawKey("sk_live_abc...xyz");  // Security risk!

// CORRECT: Store only hashed key
keyEntity.setKeyHash(ApiKeyGenerator.hashKey(secret));
```

### Mistake 2: Keys That Never Expire

API keys that never expire are a significant security liability. A key embedded in a mobile app, committed to a public repository, or leaked through logs remains usable indefinitely. Regular rotation forces key renewal and limits the damage from undiscovered leaks. Implement automatic rotation with a configurable interval (90 days is standard) and a grace period during which both old and new keys are accepted. Notify key owners before rotation so they can update their systems.

```java
// WRONG: No expiration on keys
// Keys remain valid forever

// CORRECT: Implement key rotation
@Scheduled(cron = "0 0 3 * * ?")
public void rotateOldKeys() {
    // Rotate keys older than 90 days
}
```

### Mistake 3: Showing Key After Creation

Never return full API keys in list responses, logs, or error messages. The raw key should be displayed exactly once — at creation time — with a prominent warning to store it securely. Subsequent API responses should only include the prefix, which identifies the key without compromising security. If a user loses their key, they must rotate it (generate a new key) rather than retrieve the old one.

```java
// WRONG: Key visible in list responses
GET /api/keys -> returns raw keys

// CORRECT: Show only prefix
{
  "id": 123,
  "prefix": "sk_live_abc123",
  "label": "Production API Key",
  "createdAt": "2026-05-11T10:00:00Z"
}
```

---

## Summary

1. Generate API keys with prefix.secret format using secure random
2. Hash the secret part with SHA-256 before storage
3. Return raw key exactly once at creation time
4. Implement automatic 90-day key rotation
5. Support immediate revocation when keys are compromised
6. Cache validated keys for performance
7. Granular permissions limit blast radius
8. Full audit logging for all key-related events

---

## References

- [Stripe API Keys Documentation](https://stripe.com/docs/keys)
- [Twilio API Key Security](https://www.twilio.com/docs/iam/api-keys)
- [OWASP API Key Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [AWS API Key Management](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-key-source.html)

Happy Coding
