---
title: "Secrets Management with Vault"
description: "Comprehensive guide to HashiCorp Vault for secrets management: dynamic secrets, secret rotation, and Spring Boot integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - vault
  - secrets-management
  - security
  - spring-boot
coverImage: "/images/secrets-management-vault.png"
draft: false
---

# Secrets Management with HashiCorp Vault

## Overview

Hardcoding secrets in configuration files, environment variables, or code repositories is a severe security risk. HashiCorp Vault provides a centralized solution for storing, accessing, and rotating secrets dynamically. This guide covers Vault's architecture, secret engines, dynamic secrets, and Spring Boot integration.

---

## The Problem with Traditional Secrets Management

### What's Wrong with Environment Variables?

```yaml
# application.yml - checked into git
spring:
  datasource:
    password: ${DB_PASSWORD}  # Set in .env or CI secrets
```

Problems:
- Secrets in CI/CD pipeline configuration (visible to many people)
- No audit trail for secret access
- No automatic rotation
- Secrets leaked through error messages, logs, or debugging screens
- Secrets persist forever even if compromised

### Example: Secret Leak in Logs

```java
// VULNERABLE: Secret can appear in logs
log.info("Connecting to database with password: {}", password);
// If an exception occurs during connection, the password is logged
```

---

## Vault Architecture

```
Application                     Vault Server                    Database
    |                               |                              |
    |--- Authenticate (JWT) ------->|                              |
    |<-- Token ---------------------|                              |
    |                               |                              |
    |--- Read Secret (token) ------>|                              |
    |<-- Dynamic DB credentials ----|                              |
    |                               |                              |
    |--- Connect to DB ------------|----------------------------->|
    |   with temp credentials       |                              |
    |                               |                              |
    |--- TTL expires ---------------|                              |
    |                               |-- Revoke lease ------------->|
```

### Vault Key Concepts

- **Secret Engine**: A Vault component that stores, generates, or encrypts secrets
- **Lease**: A time-limited credential with a TTL
- **Policy**: Defines which paths a token can access
- **Auth Method**: How applications authenticate (Kubernetes, JWT, AppRole, TLS)

---

## Installing and Configuring Vault

### Docker Setup

```yaml
# docker-compose.yml
version: '3.8'
services:
  vault:
    image: vault:1.15
    container_name: vault
    cap_add:
      - IPC_LOCK
    environment:
      VAULT_DEV_ROOT_TOKEN_ID: root-token
      VAULT_DEV_LISTEN_ADDRESS: 0.0.0.0:8200
    ports:
      - "8200:8200"
    volumes:
      - ./vault/config:/vault/config
      - ./vault/data:/vault/data
    command: server -dev -dev-root-token-id=root-token
```

### Production Configuration

```hcl
# vault-config.hcl
storage "raft" {
  path = "/vault/data"
  node_id = "node1"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = false
  tls_cert_file = "/vault/config/vault-cert.pem"
  tls_key_file  = "/vault/config/vault-key.pem"
}

api_addr = "https://vault.example.com:8200"
cluster_addr = "https://vault.example.com:8201"

ui = true

seal "awskms" {
  region     = "us-west-2"
  kms_key_id = "arn:aws:kms:..."
}
```

---

## Secret Engines

### KV (Key-Value) Secrets Engine

```bash
# Enable KV engine
vault secrets enable -version=2 kv

# Store static secrets
vault kv put kv/database/postgres \
    username=app_user \
    password=super-secret-password

# Store as JSON
vault kv put kv/api/keys \
    @api-keys.json

# List and read
vault kv list kv/database/
vault kv get kv/database/postgres

# Delete and destroy
vault kv metadata delete kv/database/postgres
```

### Dynamic Database Secrets Engine

```bash
# Enable database engine
vault secrets enable database

# Configure PostgreSQL connection
vault write database/config/postgres-db \
    plugin_name=postgresql-database-plugin \
    allowed_roles="app-role" \
    connection_url="postgresql://{{username}}:{{password}}@postgres:5432/mydb" \
    username="vault_admin" \
    password="vault_admin_password"

# Create a role that generates temporary credentials
vault write database/roles/app-role \
    db_name=postgres-db \
    creation_statements="CREATE USER \"{{name}}\" WITH PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
                        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"
```

### Java Client for Dynamic Secrets

```java
@Service
public class VaultDatabaseService {

    private final VaultTemplate vaultTemplate;

    public VaultDatabaseService(VaultTemplate vaultTemplate) {
        this.vaultTemplate = vaultTemplate;
    }

    public DatabaseCredentials getDatabaseCredentials() {
        VaultResponseSupport<DatabaseCredentials> response = vaultTemplate.read(
            "database/creds/app-role",
            DatabaseCredentials.class
        );

        if (response == null || response.getData() == null) {
            throw new VaultException("Failed to get database credentials");
        }

        return response.getData();
    }
}

@Data
public class DatabaseCredentials {
    private String username;
    private String password;
    private Map<String, String> leaseInfo;
}
```

---

## Spring Boot Integration with Spring Vault

### Dependency

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-vault-config</artifactId>
</dependency>

<dependency>
    <groupId>org.springframework.vault</groupId>
    <artifactId>spring-vault-core</artifactId>
</dependency>
```

### Bootstrap Configuration

```yaml
# bootstrap.yml (Bootstrap context loads before application context)
spring:
  application:
    name: my-service
  cloud:
    vault:
      host: vault.example.com
      port: 8200
      scheme: https
      authentication: APPROLE
      app-role:
        role-id: ${VAULT_ROLE_ID}
        secret-id: ${VAULT_SECRET_ID}
      kv:
        enabled: true
        default-context: my-service
        application-name: my-service
        profiles:
          - production
      database:
        enabled: true
        role: app-role
        backend: database
```

### Application Configuration Using Vault Secrets

```java
@SpringBootApplication
@RefreshScope  // Refresh secrets without restarting the application
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

@Service
@RefreshScope
public class DatabaseConfig {

    @Value("${spring.datasource.username}")
    private String dbUsername;

    @Value("${spring.datasource.password}")
    private String dbPassword;

    @Bean
    @RefreshScope
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        config.setUsername(dbUsername);
        config.setPassword(dbPassword);
        config.setMaximumPoolSize(10);

        return new HikariDataSource(config);
    }
}
```

### Using VaultTemplate Directly

```java
@Service
public class SecretService {

    private final VaultTemplate vaultTemplate;

    public SecretService(VaultTemplate vaultTemplate) {
        this.vaultTemplate = vaultTemplate;
    }

    public String getApiKey(String serviceName) {
        VaultResponseSupport<ApiKeySecret> response = vaultTemplate.read(
            "kv/api/keys/" + serviceName,
            ApiKeySecret.class
        );

        if (response == null || response.getData() == null) {
            throw new SecretNotFoundException("API key not found for: " + serviceName);
        }

        return response.getData().getApiKey();
    }

    public void rotateApiKey(String serviceName, String newKey) {
        Map<String, Object> data = new HashMap<>();
        data.put("apiKey", newKey);
        data.put("rotatedAt", Instant.now().toString());

        vaultTemplate.write("kv/api/keys/" + serviceName, data);
    }
}

@Data
public class ApiKeySecret {
    private String apiKey;
    private String rotatedAt;
}
```

---

## Vault Policies

### Policy Definition

```hcl
# policy-my-service.hcl
# Allow reading KV secrets for the service
path "kv/data/my-service/*" {
  capabilities = ["read", "list"]
}

# Allow reading database credentials
path "database/creds/app-role" {
  capabilities = ["read"]
}

# Allow renewing leases
path "sys/leases/renew" {
  capabilities = ["update"]
}

# Deny all other paths
path "*" {
  capabilities = ["deny"]
}
```

### Apply Policy

```bash
# Create the policy
vault policy write my-service policy-my-service.hcl

# Create a token with this policy
vault token create -policy=my-service

# Or associate with AppRole
vault write auth/approle/role/my-service \
    token_policies="my-service" \
    token_ttl=1h \
    token_max_ttl=24h
```

---

## Secret Rotation Strategies

### Automatic Rotation with Dynamic Secrets

```java
@Component
public class RotatingDataSource {

    private volatile DataSource currentDataSource;
    private final VaultTemplate vaultTemplate;
    private final ScheduledExecutorService scheduler;

    @PostConstruct
    public void init() {
        refreshDataSource();
        // Schedule rotation before lease expires
        scheduler.scheduleAtFixedRate(
            this::refreshDataSource,
            45,  // Refresh every 45 minutes (lease is 1 hour)
            45,
            TimeUnit.MINUTES
        );
    }

    public void refreshDataSource() {
        DatabaseCredentials creds = vaultTemplate.read(
            "database/creds/app-role",
            DatabaseCredentials.class
        ).getData();

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        config.setUsername(creds.getUsername());
        config.setPassword(creds.getPassword());
        config.setMaximumPoolSize(5);

        DataSource newDs = new HikariDataSource(config);

        DataSource old = this.currentDataSource;
        this.currentDataSource = newDs;

        // Close old data source gracefully
        if (old != null) {
            try { ((HikariDataSource) old).close(); } 
            catch (Exception e) { log.warn("Failed to close old datasource", e); }
        }
    }

    public Connection getConnection() throws SQLException {
        return currentDataSource.getConnection();
    }
}
```

### Static Secret Rotation

```java
@Component
public class StaticSecretRotator {

    private final VaultTemplate vaultTemplate;
    private final Clock clock = Clock.systemUTC();

    @Scheduled(cron = "0 0 3 * * ?")  // Daily at 3 AM
    public void rotateEncryptionKey() {
        String keyName = "encryption/master-key";
        VaultResponseSupport<Map<String, Object>> current = vaultTemplate.read(
            "kv/data/keys/" + keyName
        );

        if (current != null && current.getData() != null) {
            Map<String, Object> metadata = current.getData();
            String lastRotation = (String) metadata.get("rotatedAt");
            
            if (lastRotation != null) {
                Instant lastRot = Instant.parse(lastRotation);
                if (Duration.between(lastRot, Instant.now(clock)).toDays() < 30) {
                    log.info("Key {} was rotated recently, skipping", keyName);
                    return;
                }
            }
        }

        // Generate new key
        byte[] newKey = new byte[32];
        new SecureRandom().nextBytes(newKey);
        String encodedKey = Base64.getEncoder().encodeToString(newKey);

        // Store with versioning
        Map<String, Object> data = new HashMap<>();
        data.put("key", encodedKey);
        data.put("algorithm", "AES-256-GCM");
        data.put("rotatedAt", Instant.now(clock).toString());
        data.put("rotatedBy", "scheduler");

        vaultTemplate.write("kv/data/keys/" + keyName, data);
        log.info("Encryption key rotated successfully");
    }
}
```

---

## Common Mistakes

### Mistake 1: Hardcoding Vault Tokens

```java
// WRONG: Hardcoded token
@Bean
public VaultTemplate vaultTemplate() {
    return new VaultTemplate(
        VaultEndpoint.create("localhost", 8200),
        ClientAuthentication.fromToken("s.abc123def456")  // NEVER HARDCODE
    );
}

// CORRECT: Use AppRole or Kubernetes auth
spring.cloud.vault.authentication=APPROLE
spring.cloud.vault.app-role.role-id=${VAULT_ROLE_ID}
spring.cloud.vault.app-role.secret-id=${VAULT_SECRET_ID}
```

### Mistake 2: Not Handling Lease Renewal

```java
// WRONG: Assuming credentials never expire
@Bean
public DataSource dataSource() {
    DatabaseCredentials creds = getCredentials();
    return createDataSource(creds);  // Leases expire in 1 hour!
}

// CORRECT: Handle credential rotation
@Bean
@RefreshScope
public DataSource dataSource() {
    // Spring Cloud Vault handles lease renewal automatically
    // Use @RefreshScope to get new credentials
    return createDataSource(currentCreds);
}
```

### Mistake 3: Logging Secrets

```java
// WRONG: Logging secret values
log.info("Database username: {}", creds.getUsername());
log.info("Database password: {}", creds.getPassword());

// CORRECT: Log without secrets
log.info("Retrieved database credentials (username: {})",
    creds.getUsername().substring(0, 3) + "***");
```

---

## Summary

HashiCorp Vault provides a robust solution for secrets management with dynamic credential generation, automatic rotation, and fine-grained access policies. Spring Cloud Vault integrates seamlessly, replacing static configuration values with dynamically fetched secrets. The most secure pattern is dynamic secrets (database credentials, API keys) with automatic lease renewal, avoiding hardcoded secrets entirely.

---

## References

- [HashiCorp Vault Documentation](https://developer.hashicorp.com/vault/docs)
- [Spring Vault Reference](https://docs.spring.io/spring-vault/reference/)
- [Vault Production Hardening](https://developer.hashicorp.com/vault/tutorials/operations/production-hardening)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

Happy Coding