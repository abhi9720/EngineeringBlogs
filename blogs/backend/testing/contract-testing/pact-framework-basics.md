---
title: "Pact Framework Basics"
description: "Getting started with Pact for contract testing: setup, DSL usage, verification, and integration with Spring Boot"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - pact
  - contract-testing
  - testing
  - spring-boot
coverImage: "/images/pact-framework-basics.png"
draft: false
---

# Pact Framework: Contract Testing for Microservices

## Overview

Pact is a consumer-driven contract testing framework that enables microservices to test their integrations without deploying to shared environments. Consumer tests generate contracts (pacts) that provider tests verify in isolation. This guide covers Pact's core concepts, setup, and Spring Boot integration.

---

## Setup

### Dependencies

```xml
<!-- Consumer side -->
<dependency>
    <groupId>au.com.dius.pact.consumer</groupId>
    <artifactId>junit5</artifactId>
    <version>4.6.0</version>
    <scope>test</scope>
</dependency>

<!-- Provider side -->
<dependency>
    <groupId>au.com.dius.pact.provider</groupId>
    <artifactId>junit5</artifactId>
    <version>4.6.0</version>
    <scope>test</scope>
</dependency>

<!-- Pact Broker (optional) -->
<dependency>
    <groupId>au.com.dius.pact.provider</groupId>
    <artifactId>maven</artifactId>
    <version>4.6.0</version>
    <scope>test</scope>
</dependency>
```

### Maven Plugin

```xml
<plugin>
    <groupId>au.com.dius.pact.provider</groupId>
    <artifactId>maven</artifactId>
    <version>4.6.0</version>
    <configuration>
        <pactBrokerUrl>${pact.broker.url}</pactBrokerUrl>
        <pactBrokerUsername>${pact.broker.username}</pactBrokerUsername>
        <pactBrokerPassword>${pact.broker.password}</pactBrokerPassword>
        <projectVersion>${project.version}</projectVersion>
        <trimDatabaseInResponses>true</trimDatabaseInResponses>
    </configuration>
</plugin>
```

---

## Consumer Side: Writing Pacts

### Basic Consumer Test

```java
@ExtendWith(PactConsumerTestExt.class)
@PactTestFor(providerName = "InventoryService", port = "8081")
class InventoryServiceConsumerTest {

    @Autowired
    private InventoryClient inventoryClient;

    @Pact(consumer = "OrderService")
    public V4Pact createGetInventoryPact(PactDslWithProvider builder) {
        return builder
            .given("Product SKU 'SKU-001' exists with stock level 100")
            .uponReceiving("A request to check inventory for SKU-001")
                .path("/api/inventory/SKU-001")
                .method("GET")
                .headers("Accept", "application/json")
            .willRespondWith()
                .status(200)
                .headers(Map.of("Content-Type", "application/json"))
                .body(new PactDslJsonBody()
                    .stringType("sku", "SKU-001")
                    .integerType("availableStock", 100)
                    .stringType("warehouse", "WAREHOUSE-A")
                )
            .toPact(V4Pact.class);
    }

    @Test
    @PactTestFor(pactMethod = "createGetInventoryPact")
    void shouldRetrieveInventoryLevels(MockServer mockServer) {
        inventoryClient.setBaseUrl(mockServer.getUrl());

        InventoryResponse response = inventoryClient.checkAvailability("SKU-001");

        assertEquals("SKU-001", response.getSku());
        assertTrue(response.getAvailableStock() >= 0);
        assertNotNull(response.getWarehouse());
    }
}
```

### POST Request Pact

```java
@ExtendWith(PactConsumerTestExt.class)
@PactTestFor(providerName = "NotificationService", port = "8082")
class NotificationServiceConsumerTest {

    @Pact(consumer = "OrderService")
    public V4Pact createNotificationPact(PactDslWithProvider builder) {
        return builder
            .given("Notification service is operational")
            .uponReceiving("A request to send order confirmation")
                .path("/api/notifications/send")
                .method("POST")
                .headers("Content-Type", "application/json")
                .body(new PactDslJsonBody()
                    .stringType("recipient", "customer@example.com")
                    .stringType("template", "order-confirmation")
                    .object("data")
                        .stringType("orderId", "ORD-001")
                        .decimalType("total", 99.99)
                    .closeObject()
                )
            .willRespondWith()
                .status(202)
                .headers(Map.of("Content-Type", "application/json"))
                .body(new PactDslJsonBody()
                    .stringType("messageId")
                    .stringType("status", "QUEUED")
                )
            .toPact(V4Pact.class);
    }

    @Test
    @PactTestFor(pactMethod = "createNotificationPact")
    void shouldSendNotification(MockServer mockServer) {
        notificationClient.setBaseUrl(mockServer.getUrl());

        var request = new NotificationRequest(
            "customer@example.com",
            "order-confirmation",
            Map.of("orderId", "ORD-001", "total", 99.99)
        );

        NotificationResponse response = notificationClient.send(request);

        assertNotNull(response.getMessageId());
        assertEquals("QUEUED", response.getStatus());
    }
}
```

---

## Provider Side: Verifying Pacts

### Basic Provider Verification

```java
@Provider("InventoryService")
@PactBroker(url = "${pact.broker.url}")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class InventoryServiceProviderTest {

    @LocalServerPort
    private int port;

    @Autowired
    private InventoryRepository inventoryRepository;

    @BeforeEach
    void setup(PactVerificationContext context) {
        context.setTarget(new HttpTestTarget("localhost", port));

        // Use our own provider config
        System.setProperty("pact.verifier.publishResults", "true");
    }

    @State("Product SKU 'SKU-001' exists with stock level 100")
    void setupInventory() {
        inventoryRepository.save(
            new InventoryItem("SKU-001", 100, "WAREHOUSE-A")
        );
    }

    @State("Product SKU 'SKU-999' does not exist")
    void setupMissingProduct() {
        // Don't create anything, it doesn't exist
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void pactVerificationTestTemplate(PactVerificationContext context) {
        context.verifyInteraction();
    }
}
```

### Verifying with Provider States

```java
@Provider("NotificationService")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class NotificationServiceProviderTest {

    @LocalServerPort
    private int port;

    @MockBean
    private NotificationSender notificationSender;

    @BeforeEach
    void setup(PactVerificationContext context) {
        context.setTarget(new HttpTestTarget("localhost", port));
    }

    @State("Notification service is operational")
    void setupOperational() {
        when(notificationSender.send(any()))
            .thenReturn(new MessageResult(UUID.randomUUID().toString(), "QUEUED"));
    }

    @State("Notification service is overloaded")
    void setupOverloaded() {
        when(notificationSender.send(any()))
            .thenThrow(new ServiceOverloadedException("Too many requests"));
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void verify(PactVerificationContext context) {
        context.verifyInteraction();
    }
}
```

---

## Pact DSL Reference

### Body DSL

```java
PactDslJsonBody body = new PactDslJsonBody()
    // Simple types
    .stringType("name")                           // Any non-null string
    .stringType("email", "user@example.com")      // Example value
    .integerType("age")                           // Any integer
    .integerType("count", 42)                     // Example integer
    .decimalType("price")                         // Any decimal
    .decimalType("total", 99.99)                  // Example decimal
    .booleanType("active")                        // Any boolean
    .uuid("id")                                   // Valid UUID
    .date("createdAt", "yyyy-MM-dd")              // Date matching
    .time("startTime", "HH:mm:ss")                // Time matching
    .timestamp("updatedAt", "yyyy-MM-dd'T'HH:mm:ss")  // Timestamp

    // Nullable values
    .nullableStringType("middleName")             // Null or string
    .nullableIntegerType("optionalCount")         // Null or integer

    // Arrays and nested objects
    .object("address")
        .stringType("street")
        .stringType("city")
        .closeObject()
    .eachLike("items")
        .stringType("sku")
        .integerType("quantity")
        .closeObject()
    .minArrayLike("tags", 1)                      // Array with min items
        .stringType()
    .closeArray()

    // Regex matching
    .stringMatcher("phone", "\\d{3}-\\d{4}")      // Regex pattern

    // From provider state
    .valueFromProviderState("customerId", "cust-\\d+", "cust-001");
```

### Request DSL

```java
PactDslRequestWithoutPath request = builder
    .given("State description")
    .uponReceiving("Interaction description")
    .method("GET")                                    // HTTP method
    .path("/api/resource/123")                        // Exact path
    .matchPath("/api/resource/\\d+")                  // Regex path
    .queryString("page=1&size=10")                    // Exact query
    .headers(Map.of("Authorization", "Bearer token")) // Headers
    .body(jsonBody);                                  // Request body
```

### Response DSL

```java
PactDslResponse response = builder
    .status(200)                                      // HTTP status
    .headers(Map.of("Content-Type", "application/json"))
    .body(jsonBody)                                   // Response body

    // Response time constraints
    .responseTime(Duration.ofMillis(500))
    
    // Multiple responses (for stateful interactions)
    .uponReceiving("Second request")
        .path("/api/resource/123")
        .method("DELETE")
    .willRespondWith()
        .status(204);
```

---

## Pact Broker Integration

### Publishing Contracts

```xml
<plugin>
    <groupId>au.com.dius.pact.provider</groupId>
    <artifactId>maven</artifactId>
    <version>4.6.0</version>
    <executions>
        <execution>
            <id>publish-pacts</id>
            <phase>verify</phase>
            <goals>
                <goal>publish</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

### Can-I-Deploy Check

```bash
# Check if the provider version can be deployed to production
pact-broker can-i-deploy \
    --pacticipant PaymentService \
    --version 1.2.3 \
    --to-environment production \
    --broker-base-url https://pact-broker.example.com

# Check if all consumers of a provider are compatible
pact-broker can-i-deploy \
    --pacticipant PaymentService \
    --version 1.2.3 \
    --to-environment staging \
    --latest
```

---

## Pact on CI/CD

### GitHub Actions

```yaml
name: Contract Testing

jobs:
  consumer-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - run: mvn test -Dtest="*Consumer*"
      - run: mvn pact:publish
        env:
          PACT_BROKER_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_USERNAME: ${{ secrets.PACT_BROKER_USERNAME }}
          PACT_BROKER_PASSWORD: ${{ secrets.PACT_BROKER_PASSWORD }}

  provider-verification:
    needs: consumer-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
      - run: mvn pact:verify
        env:
          PACT_BROKER_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_USERNAME: ${{ secrets.PACT_BROKER_USERNAME }}
          PACT_BROKER_PASSWORD: ${{ secrets.PACT_BROKER_PASSWORD }}
      - run: pact-broker can-i-deploy
          --pacticipant PaymentService
          --version ${{ github.sha }}
          --to-environment production
```

---

## Common Mistakes

### Mistake 1: Testing Too Much in One Pact

```java
// WRONG: Testing multiple interactions in one pact method
@Pact(consumer = "OrderService")
public V4Pact testManyThings(PactDslWithProvider builder) {
    // Define 10 interactions here
    // Makes debugging difficult
}

// CORRECT: One pact method per interaction
@Pact(consumer = "OrderService")
public V4Pact getProductSuccess(PactDslWithProvider builder) { }

@Pact(consumer = "OrderService")
public V4Pact getProductNotFound(PactDslWithProvider builder) { }
```

### Mistake 2: Not Using Provider States for Different Scenarios

```java
// WRONG: No state for different responses
willRespondWith()
    .status(404);  // When does 404 happen? Unclear

// CORRECT: Define the state
.given("Product does not exist")
.uponReceiving("A request for non-existent product")
...
.willRespondWith()
    .status(404);
```

---

## Summary

Pact enables reliable microservice integration testing through consumer-driven contracts. Consumers define expectations using Pact DSL, publish contracts to a Pact Broker, and providers verify these contracts in their CI pipeline. Use provider states to set up data scenarios, matching rules for flexible verification, and the Pact Broker for cross-team contract management.

---

## References

- [Pact Documentation](https://docs.pact.io/)
- [Pact JVM](https://github.com/pact-foundation/pact-jvm)
- [Pact Broker](https://docs.pact.io/pact_broker)
- [Pact Workshop](https://github.com/pact-foundation/pact-workshop)

Happy Coding