---
title: "Consumer-Driven Contracts"
description: "Comprehensive guide to consumer-driven contract testing: Pact, contract definition, verification, and CI/CD integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - contract-testing
  - pact
  - microservices
  - testing
coverImage: "/images/consumer-driven-contracts.png"
draft: false
---

# Consumer-Driven Contract Testing

## Overview

Consumer-driven contract (CDC) testing is a pattern where consumer microservices define their expectations of provider APIs in executable contracts. These contracts are then verified against the provider, ensuring backward compatibility without end-to-end tests. This guide covers the CDC workflow, Pact framework, and integration into CI/CD.

---

## The Problem: Microservice Integration

```
Consumer (Order Service)     Provider (Payment Service)
         |                              |
         |---- API call --------------->|
         |                              |  Provider changes field names
         |<--- response (changed) ------|  Consumer breaks!
         |                              |
         |    No one knows until        |
         |    production deployment     |
```

CDC solves this by testing the contract in every build:

```
Consumer                       Provider
   |                              |
   |-- Writes contract ---------->|  (consumer expectation)
   |                              |
   |                              |-- Verifies contract in CI
   |                              |  (provider must satisfy it)
   |                              |
   |    Both can deploy safely    |
```

---

## The Three Phases of CDC

### Phase 1: Consumer Writes Contract

The consumer defines what it expects from the provider:

```java
// Consumer side: Order Service test
@ExtendWith(PactConsumerTestExt.class)
@PactTestFor(providerName = "PaymentService", port = "8080")
class OrderServiceConsumerPactTest {

    @Autowired
    private OrderService orderService;

    @Pact(consumer = "OrderService")
    public V4Pact createPaymentProcessingPact(PactDslWithProvider builder) {
        return builder
            .given("A payment method exists for customer")
            .uponReceiving("A request to process payment")
                .path("/api/payments/charge")
                .method("POST")
                .headers("Content-Type", "application/json")
                .body(new PactDslJsonBody()
                    .stringType("customerId", "cust-123")
                    .decimalType("amount", 100.50)
                    .stringType("currency", "USD")
                )
            .willRespondWith()
                .status(201)
                .headers(Map.of("Content-Type", "application/json"))
                .body(new PactDslJsonBody()
                    .stringType("transactionId")
                    .stringType("status", "COMPLETED")
                    .stringType("message", "Payment processed successfully")
                )
            .toPact(V4Pact.class);
    }

    @Test
    @PactTestFor(pactMethod = "createPaymentProcessingPact")
    void shouldProcessPaymentSuccessfully(MockServer mockServer) {
        // Point the service to the mock server
        paymentClient.setBaseUrl(mockServer.getUrl());

        PaymentResult result = orderService.processPayment(
            "cust-123", 100.50, "USD");

        assertNotNull(result.transactionId());
        assertEquals("COMPLETED", result.status());
    }
}
```

### Phase 2: Contract Published

The generated contract (JSON) is published to a Pact Broker:

```json
{
  "consumer": { "name": "OrderService" },
  "provider": { "name": "PaymentService" },
  "interactions": [
    {
      "description": "A request to process payment",
      "providerStates": [
        { "name": "A payment method exists for customer" }
      ],
      "request": {
        "method": "POST",
        "path": "/api/payments/charge",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "customerId": "cust-123",
          "amount": 100.50,
          "currency": "USD"
        }
      },
      "response": {
        "status": 201,
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "transactionId": "a-transaction-id",
          "status": "COMPLETED",
          "message": "Payment processed successfully"
        },
        "matchingRules": {
          "$.body.transactionId": {
            "match": "type"
          }
        }
      }
    }
  ]
}
```

### Phase 3: Provider Verifies Contract

```java
// Provider side: Payment Service test
@Provider("PaymentService")
@PactBroker(url = "${pact.broker.url}")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PaymentServiceProviderPactTest {

    @LocalServerPort
    private int port;

    @BeforeEach
    void setup(PactVerificationContext context) {
        context.setTarget(new HttpTestTarget("localhost", port));
    }

    @State("A payment method exists for customer")
    void setupPaymentMethod() {
        // Set up provider state
        paymentMethodRepository.save(
            new PaymentMethod("cust-123", "CREDIT_CARD", "****4242")
        );
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void pactVerificationTestTemplate(PactVerificationContext context) {
        context.verifyInteraction();
    }
}
```

---

## Pact Broker

The Pact Broker is a central repository for sharing contracts between consumers and providers:

```yaml
# docker-compose.yml for Pact Broker
version: '3.8'
services:
  pact-broker:
    image: pactfoundation/pact-broker:latest
    ports:
      - "9292:9292"
    environment:
      PACT_BROKER_DATABASE_URL: "postgres://pact:pact@postgres/pact"
      PACT_BROKER_BASIC_AUTH_USERNAME: pact
      PACT_BROKER_BASIC_AUTH_PASSWORD: pact

  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: pact
      POSTGRES_PASSWORD: pact
      POSTGRES_DB: pact
```

### CI/CD Integration

```yaml
# Consumer CI: Generate and publish contract
jobs:
  consumer-test:
    steps:
      - uses: actions/checkout@v4
      - name: Run consumer tests
        run: mvn test -pl order-service
      - name: Pact Publish
        run: |
          mvn pact:publish \
            -Dpact.broker.url=https://pact-broker.example.com \
            -Dpact.broker.username=${{ secrets.PACT_USERNAME }} \
            -Dpact.broker.password=${{ secrets.PACT_PASSWORD }}

# Provider CI: Verify against all published contracts
jobs:
  provider-verify:
    steps:
      - uses: actions/checkout@v4
      - name: Verify Pacts
        run: |
          mvn pact:verify \
            -Dpact.broker.url=https://pact-broker.example.com \
            -Dpact.broker.username=${{ secrets.PACT_USERNAME }} \
            -Dpact.broker.password=${{ secrets.PACT_PASSWORD }}
      - name: Can I Deploy?
        run: |
          pact-broker can-i-deploy \
            --pacticipant PaymentService \
            --version ${{ github.sha }} \
            --to-environment production
```

---

## Matching Rules

Pact uses matching rules to define flexible expectations:

```java
class MatchingRulesExample {

    @Pact(consumer = "OrderService")
    public V4Pact createPact(PactDslWithProvider builder) {
        return builder
            .given("Products exist")
            .uponReceiving("A request for product list")
                .path("/api/products")
                .method("GET")
            .willRespondWith()
                .status(200)
                .body(new PactDslJsonBody()
                    .eachLike("products")
                        .stringType("id")         // Any string, non-null
                        .stringType("name", "Widget")  // Example value
                        .decimalType("price")     // Any decimal
                        .booleanType("inStock")   // Any boolean
                        .nullableStringType("description")  // Null or string
                    .closeObject()
                )
            .toPact(V4Pact.class);
    }
}
```

### Available Matchers

| Matcher | Description | Example |
|---------|-------------|---------|
| `stringType()` | Any non-null string | `"hello"` |
| `integerType()` | Any integer | `42` |
| `decimalType()` | Any decimal | `3.14` |
| `booleanType()` | Any boolean | `true` |
| `eachLike()` | Array of objects | `[...]` |
| `arrayContaining()` | Exact array items | `[1, 2, 3]` |
| `term()` | Regex match | `\\d{3}-\\d{4}` |
| `fromProviderState()` | Value from provider state | `{ "id": fromProviderState("${id}") }` |

---

## Provider States

Provider states set up specific data scenarios before verification:

```java
@Provider("PaymentService")
class PaymentProviderTest {

    @State("A payment method exists for customer")
    void statePaymentMethodExists(Map<String, Object> params) {
        String customerId = (String) params.get("customerId");
        paymentMethodRepository.save(
            new PaymentMethod(customerId, "CREDIT_CARD", "****4242")
        );
    }

    @State("Customer has insufficient funds")
    void stateInsufficientFunds(Map<String, Object> params) {
        String customerId = (String) params.get("customerId");
        accountService.setBalance(customerId, BigDecimal.ZERO);
    }

    @State("Payment service is unavailable")
    void stateServiceUnavailable() {
        // Simulate database connection failure
        databaseContainer.stop();
    }
}
```

---

## Contract Testing vs End-to-End Tests

| Aspect | Contract Tests | E2E Tests |
|--------|---------------|-----------|
| Scope | One interaction | Full workflow |
| Speed | Milliseconds | Minutes |
| Isolation | Consumer/provider test independently | All services deployed |
| Debugging | Exact interaction failure | Difficult to pinpoint |
| Maintenance | Consumer-driven changes | Brittle |
| Confidence | High for API compatibility | High for workflow correctness |

---

## Common Mistakes

### Mistake 1: Testing UI/Visual Contracts

```java
// WRONG: Using Pact for UI testing
@Pact(consumer = "WebApp")
public V4Pact createUiPact(PactDslWithProvider builder) {
    // Contract testing is for API contracts, not UI behavior
}

// CORRECT: Use Pact for API contracts between services
@Pact(consumer = "OrderService")
public V4Pact createApiPact(PactDslWithProvider builder) {
    // Test the API contract
}
```

### Mistake 2: Overly Rigid Matching

```java
// WRONG: Exact value matching (brittle)
.body(new PactDslJsonBody()
    .stringValue("transactionId", "txn-123")  // Exact match required
)

// CORRECT: Type matching
.body(new PactDslJsonBody()
    .stringType("transactionId")  // Any non-null string is fine
)
```

### Mistake 3: Not Using Provider States

```java
// WRONG: Missing state setup - tests may fail due to missing data
@State("")  // Empty state
void noSetup() { }

// CORRECT: Define meaningful provider states
@State("A product exists with ID 'prod-1'")
void setupProduct() {
    productRepository.save(new Product("prod-1", "Widget", 25.00));
}
```

---

## Summary

CDC testing with Pact ensures that microservice APIs remain backward compatible. Consumers write contracts defining their expectations. The Pact Broker shares contracts between teams. Providers verify all consumer contracts in CI before deployment. Use type matching for flexible contracts, provider states for data setup, and integrate with Pact Broker for cross-team coordination.

---

## References

- [Pact Documentation](https://docs.pact.io/)
- [Pact JVM Implementation](https://github.com/pact-foundation/pact-jvm)
- [Consumer-Driven Contracts: A Service Evolution Pattern](https://martinfowler.com/articles/consumerDrivenContracts.html)
- [Pact Broker Documentation](https://docs.pact.io/pact_broker)

Happy Coding