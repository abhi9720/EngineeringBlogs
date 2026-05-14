---
title: "Password Hashing and Storage"
description: "Deep dive into password hashing algorithms (bcrypt, Argon2, PBKDF2), salting strategies, and secure storage patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - password-hashing
  - bcrypt
  - argon2
  - security
coverImage: "/images/password-hashing-storage.png"
draft: false
---

# Password Hashing and Storage

## Overview

Password storage is the most critical security concern for any application with user accounts. Hashing is not encryption—it is a one-way function designed specifically to resist brute-force and precomputation attacks. This guide covers the mechanics of modern password hashing algorithms (bcrypt, Argon2, scrypt), salting strategies, and secure storage patterns.

---

## Why Passwords Must Be Hashed

When a database is compromised, hashed passwords must be computationally expensive to crack. The difference between encryption and hashing:

- **Encryption**: Two-way. If the encryption key is stolen, all passwords are immediately readable.
- **Hashing**: One-way. Even with the full database, attackers must brute-force each password individually.

---

## Salting: Preventing Precomputation Attacks

A salt is a unique, random value added to each password before hashing:

```
hash = hashFunction(password + salt)
```

### Without Salt

```
User      Password    Hash
alice     pass123     d74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1
bob       pass123     d74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1
```

Identical passwords produce identical hashes. An attacker who cracks one knows all users with the same password. Rainbow table attacks work because precomputed hash chains map to common passwords.

### With Salt

```
User      Salt       Password    Hash
alice     a1b2c3     pass123     hash("pass123" + "a1b2c3") = abcd...
bob       d4e5f6     pass123     hash("pass123" + "d4e5f6") = efgh...
```

Every identical password produces a different hash. Rainbow tables become useless because the attacker would need a separate table for each possible salt.

### Salt Generation

```java
@Component
public class SaltGenerator {

    private static final int SALT_LENGTH = 16;  // 128 bits minimum

    public byte[] generateSalt() {
        SecureRandom random = new SecureRandom();
        byte[] salt = new byte[SALT_LENGTH];
        random.nextBytes(salt);
        return salt;
    }

    public String generateSaltBase64() {
        byte[] salt = generateSalt();
        return Base64.getEncoder().encodeToString(salt);
    }
}
```

### Salt Storage Pattern

The salt is stored alongside the hash—it is not a secret. Its purpose is to make each password hash unique, not to be confidential:

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    username VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255),
    salt VARCHAR(64),      -- Stored in plaintext
    hash_algorithm VARCHAR(10),  -- e.g., "bcrypt", "argon2"
    created_at TIMESTAMP
);
```

---

## Algorithm Deep Dive

### bcrypt

bcrypt is designed to be slow. It uses the Blowfish cipher with a configurable cost factor:

```
bcrypt(cost, salt, password) = hash

cost = 2^cost iterations
salt = 16-byte random value
output = 60-byte string: $2b$10$[22-char-salt][31-char-hash]
```

#### Implementation

```java
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

@Service
public class PasswordService {

    // Cost factor 12 = 2^12 = 4096 iterations
    // Higher cost = more secure but slower
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

    public String hashPassword(String rawPassword) {
        // BCrypt generates its own salt automatically
        // Result format: $2b$12$salt.hash
        return encoder.encode(rawPassword);
    }

    public boolean verifyPassword(String rawPassword, String encodedHash) {
        return encoder.matches(rawPassword, encodedHash);
    }
}
```

#### Cost Factor Scaling

| Cost | Iterations | Time (approx) | Security Level |
|------|------------|---------------|----------------|
| 10   | 1024       | 80ms          | Minimum acceptable |
| 11   | 2048       | 160ms         | Good |
| 12   | 4096       | 320ms         | Strong (recommended) |
| 13   | 8192       | 640ms         | Very strong |
| 14   | 16384      | 1280ms        | Paranoia |

#### How bcrypt Works Internally

```java
// Simplified bcrypt inner workings
public class BcryptInternals {

    // bcrypt uses Blowfish's key schedule, making it expensive
    // The cost factor exponentially increases the number of key expansion rounds

    public String hash(String password, byte[] salt, int cost) {
        int iterations = 1 << cost;  // 2^cost

        // Initialize Blowfish state
        BlowfishState state = initializeState();

        // Expand key (password + salt) - THIS IS THE EXPENSIVE PART
        for (int i = 0; i < iterations; i++) {
            state = expandKey(state, password, salt);
            state = expandKey(state, salt, password);
        }

        // Encrypt the string "OrpheanBeholderScryDoubt" 64 times
        byte[] output = encryptString(state, "OrpheanBeholderScryDoubt");

        return formatBcryptOutput(cost, salt, output);
    }
}
```

### Argon2 (Argon2id)

Argon2 is the winner of the 2015 PHC competition and is the most modern password hashing algorithm. It has three variants:

- **Argon2d**: Resists GPU attacks (uses data-dependent memory access)
- **Argon2i**: Resists side-channel attacks (uses data-independent access)
- **Argon2id**: Hybrid of both (recommended for password hashing)

#### Implementation

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-crypto</artifactId>
</dependency>
```

If Spring Security doesn't include Argon2 directly, use Bouncy Castle:

```xml
<dependency>
    <groupId>org.bouncycastle</groupId>
    <artifactId>bcprov-jdk15on</artifactId>
    <version>1.70</version>
</dependency>
```

```java
import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;

@Component
public class Argon2PasswordHasher {

    private static final int SALT_LENGTH = 16;
    private static final int HASH_LENGTH = 32;
    private static final int MEMORY_COST = 65536;   // 64 MB
    private static final int TIME_COST = 3;           // 3 iterations
    private static final int PARALLELISM = 4;         // 4 threads

    public String hash(String password) {
        byte[] salt = generateSalt();
        byte[] hash = new byte[HASH_LENGTH];

        Argon2Parameters params = new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withSalt(salt)
            .withMemoryAsKB(MEMORY_COST)
            .withIterations(TIME_COST)
            .withParallelism(PARALLELISM)
            .build();

        Argon2BytesGenerator generator = new Argon2BytesGenerator();
        generator.init(params);
        generator.generateBytes(password.toCharArray(), hash);

        // Format: $argon2id$v=19$m=65536,t=3,p=4$salt$hash
        return formatArgon2Output(params, salt, hash);
    }

    public boolean verify(String password, String encodedHash) {
        Argon2Hash parsed = parseArgon2Hash(encodedHash);

        byte[] testHash = new byte[parsed.getHashLength()];
        Argon2BytesGenerator generator = new Argon2BytesGenerator();

        Argon2Parameters params = new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withSalt(parsed.getSalt())
            .withMemoryAsKB(parsed.getMemory())
            .withIterations(parsed.getIterations())
            .withParallelism(parsed.getParallelism())
            .build();

        generator.init(params);
        generator.generateBytes(password.toCharArray(), testHash);

        return constantTimeEquals(testHash, parsed.getHash());
    }

    private byte[] generateSalt() {
        byte[] salt = new byte[SALT_LENGTH];
        new SecureRandom().nextBytes(salt);
        return salt;
    }

    private boolean constantTimeEquals(byte[] a, byte[] b) {
        if (a.length != b.length) {
            return false;
        }
        int result = 0;
        for (int i = 0; i < a.length; i++) {
            result |= a[i] ^ b[i];
        }
        return result == 0;
    }

    private String formatArgon2Output(Argon2Parameters params, byte[] salt, byte[] hash) {
        return "$argon2id$v=19$m=" + params.getMemory() +
            ",t=" + params.getIterations() +
            ",p=" + params.getLanes() + "$" +
            Base64.getEncoder().encodeToString(salt) + "$" +
            Base64.getEncoder().encodeToString(hash);
    }

    private Argon2Hash parseArgon2Hash(String encoded) {
        String[] parts = encoded.split("\\$");
        // parts: ["", "argon2id", "v=19", "m=65536,t=3,p=4", "salt", "hash"]
        String[] params = parts[4].split(",");
        int memory = Integer.parseInt(params[0].split("=")[1]);
        int iterations = Integer.parseInt(params[1].split("=")[1]);
        int parallelism = Integer.parseInt(params[2].split("=")[1]);

        return new Argon2Hash(
            Base64.getDecoder().decode(parts[5]),
            Base64.getDecoder().decode(parts[6]),
            memory, iterations, parallelism
        );
    }
}
```

### Algorithm Comparison

| Factor | bcrypt | Argon2id | scrypt | PBKDF2 |
|--------|--------|----------|--------|--------|
| Memory hard | No | Yes | Yes | No |
| GPU resistant | Weak | Strong | Strong | Weak |
| ASIC resistant | Weak | Strong | Strong | Very weak |
| Configurable cost | Iterations | Memory, time, parallelism | Memory, iterations | Iterations |
| Output size | 184 bits | Variable | Variable | Variable |
| Recommended for | Established codebases | New implementations | Legacy crypto | Compliance (FIPS) |

---

## Spring Security Password Encoding

### Configuring Bcrypt

```java
@Configuration
public class PasswordEncoderConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // Default strength: 10
        return new BCryptPasswordEncoder(12);
    }
}
```

### Delegating Password Encoder (for migrating algorithms)

```java
@Bean
public PasswordEncoder passwordEncoder() {
    // Supports multiple encoding schemes for gradual migration
    Map<String, PasswordEncoder> encoders = new HashMap<>();
    encoders.put("bcrypt", new BCryptPasswordEncoder(12));
    encoders.put("argon2", Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8());
    encoders.put("pbkdf2", Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8());

    return new DelegatingPasswordEncoder("bcrypt", encoders);
    // Format: {bcrypt}$2b$12$hash...
}
```

### Usage in User Creation

```java
@Service
public class UserRegistrationService {

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private UserRepository userRepository;

    @Transactional
    public User registerUser(RegistrationRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new DuplicateEmailException("Email already registered");
        }

        User user = new User();
        user.setEmail(request.getEmail());
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        user.setCreatedAt(Instant.now());

        // Enforce minimum password strength
        validatePasswordStrength(request.getPassword());

        return userRepository.save(user);
    }

    private void validatePasswordStrength(String password) {
        // Use passay library for comprehensive password validation
        PasswordValidator validator = new PasswordValidator(
            new LengthRule(8, 128),
            new UppercaseCharacterRule(1),
            new LowercaseCharacterRule(1),
            new DigitCharacterRule(1),
            new SpecialCharacterRule(1)
        );

        RuleResult result = validator.validate(new PasswordData(password));
        if (!result.isValid()) {
            throw new WeakPasswordException("Password does not meet requirements");
        }
    }
}
```

---

## Secure Authentication

```java
@Service
public class AuthenticationService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    // Constant-time authentication to prevent user enumeration
    public Optional<User> authenticate(String email, String rawPassword) {
        Optional<User> user = userRepository.findByEmail(email);

        if (user.isEmpty()) {
            // Use a dummy hash to prevent timing attacks
            // This ensures hash computation time is consistent regardless of user existence
            passwordEncoder.matches(rawPassword, "dummy_hash");
            return Optional.empty();
        }

        if (passwordEncoder.matches(rawPassword, user.get().getPasswordHash())) {
            return user;
        }

        return Optional.empty();
    }
}
```

---

## Common Mistakes

### Mistake 1: Using Fast Hash Functions (MD5, SHA-256)

```java
// WRONG: Fast hash functions are designed for speed
// A modern GPU can compute billions of SHA-256 hashes per second
MessageDigest md = MessageDigest.getInstance("SHA-256");
byte[] hash = md.digest(password.getBytes(StandardCharsets.UTF_8));
// With an RTX 4090: ~10 billion SHA-256 hashes/second
// This password would be cracked in microseconds

// CORRECT: Use a slow, memory-hard function
BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);
String hash = encoder.encode(password);
// With cost 12: ~3000 hashes/second
```

### Mistake 2: Using a Static Salt

```java
// WRONG: Hardcoded salt
private static final String GLOBAL_SALT = "MyStaticSalt123";
String hash = hashPassword(password + GLOBAL_SALT);
// One rainbow table cracks all users

// CORRECT: Unique random salt per user
@Service
public class UserService {
    public User createUser(String username, String password) {
        String salt = generateRandomSalt();  // Unique per user
        String hash = hashPassword(password, salt);
        return userRepository.save(new User(username, hash, salt));
    }
}
```

### Mistake 3: Truncating or Modifying Hashes

```java
// WRONG: Truncating bcrypt output
BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
String hash = encoder.encode(password);
String truncated = hash.substring(0, 20);  // BREAKS the hash
// Result is no longer valid

// CORRECT: Store the full hash
// bcrypt output format: $2b$12$salt31-char-hash (60 characters total)
String fullHash = encoder.encode(password);
user.setPasswordHash(fullHash);  // Store all 60 characters
```

### Mistake 4: Not Rehashing on Algorithm Upgrade

```java
// WRONG: Stuck on old algorithm forever
if ("SHA-256".equals(user.getHashAlgorithm())) {
    // Never upgraded
}

// CORRECT: Rehash on login with DelegatingPasswordEncoder
@Service
public class RehashOnLoginService {

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private UserRepository userRepository;

    public User authenticateAndRehash(String username, String rawPassword) {
        User user = userRepository.findByUsername(username)
            .orElseThrow(() -> new AuthenticationException("User not found"));

        if (passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            // Check if password needs rehashing
            if (passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
                // Rehash with current algorithm
                user.setPasswordHash(passwordEncoder.encode(rawPassword));
                userRepository.save(user);
            }
            return user;
        }

        throw new AuthenticationException("Invalid password");
    }
}
```

---

## Summary

Password hashing is a non-negotiable security requirement. Use bcrypt with cost factor 12 for existing projects and Argon2id for new implementations. Always use unique, random salts per password. Never use fast hash functions (MD5, SHA-256) for password storage. Implement algorithm migration using DelegatingPasswordEncoder so you can upgrade hash strength without invalidating existing passwords.

---

## References

- [bcrypt paper by Provos and Mazières](https://www.usenix.org/legacy/publications/library/proceedings/usenix99/full_papers/provos/provos.pdf)
- [Argon2: The PHC Winner](https://github.com/P-H-C/phc-winner-argon2)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [NIST SP 800-63B - Password Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [Spring Security Password Encoding](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html)

Happy Coding