---
title: ACID Transactions
description: >-
  Master ACID properties in database transactions: atomicity, consistency,
  isolation, durability, transaction management in Spring, and rollback
  strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - acid
  - transactions
  - database
  - spring-transactions
coverImage: /images/backend/data-access/relational/acid-transactions.png
draft: false
order: 10
---
# ACID Transactions

## Overview

ACID (Atomicity, Consistency, Isolation, Durability) properties define the fundamental guarantees of database transactions. Understanding ACID is essential for building reliable data-intensive applications, especially when dealing with concurrent access, system failures, and complex business operations.

---

## ACID Properties

### Atomicity

Atomicity guarantees that a transaction is treated as a single, indivisible unit. In the `transfer()` method below, either all operations succeed (debit from source, credit to target, log the transaction) or none do. If the `transactionRepository.save(log)` fails, the balance changes are rolled back—the money is neither lost nor created. Spring's `@Transactional` annotation declaratively manages this atomicity.

```java
@Service
public class TransferService {

    private final AccountRepository accountRepository;
    private final TransactionRepository transactionRepository;

    @Transactional
    public void transfer(Long fromId, Long toId, BigDecimal amount) {
        // All operations succeed or all fail (atomic)
        Account from = accountRepository.findById(fromId)
            .orElseThrow(() -> new ResourceNotFoundException("Source account not found"));

        Account to = accountRepository.findById(toId)
            .orElseThrow(() -> new ResourceNotFoundException("Target account not found"));

        if (from.getBalance().compareTo(amount) < 0) {
            throw new InsufficientBalanceException("Insufficient balance");
        }

        from.setBalance(from.getBalance().subtract(amount));
        to.setBalance(to.getBalance().add(amount));

        accountRepository.save(from);
        accountRepository.save(to);

        // If any save fails, all changes are rolled back
        TransactionLog log = new TransactionLog();
        log.setFromAccount(fromId);
        log.setToAccount(toId);
        log.setAmount(amount);
        log.setStatus("COMPLETED");
        transactionRepository.save(log);
    }
}
```

### Consistency

Consistency ensures that a transaction brings the database from one valid state to another, preserving all defined rules. Below, the `@Min(0)` constraint on `balance` enforces a business rule: account balances cannot go negative. The `@Version` field enables optimistic locking, preventing two concurrent transactions from overwriting each other's changes. If a concurrent update is detected, an `OptimisticLockException` is thrown, and the client can retry.

```java
@Entity
@Table(name = "accounts")
public class Account {

    @Id
    @GeneratedValue
    private Long id;

    @Column(nullable = false)
    private String owner;

    @Column(nullable = false)
    @Min(0)  // Business rule: balance cannot be negative
    private BigDecimal balance;

    @Version
    private Long version;  // Optimistic locking for consistency
}

@ControllerAdvice
public class TransactionConsistencyHandler {

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ProblemDetail> handleConstraintViolation(
            DataIntegrityViolationException ex) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Consistency Violation");
        problem.setDetail("Operation would violate data consistency rules");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }

    @ExceptionHandler(OptimisticLockException.class)
    public ResponseEntity<ProblemDetail> handleOptimisticLock(
            OptimisticLockException ex) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Concurrent Modification");
        problem.setDetail("Resource was modified by another transaction. Retry.");
        problem.setProperty("retryable", true);
        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

### Isolation

Isolation controls how transaction changes are visible to other concurrent transactions. `REPEATABLE_READ` guarantees that all reads within the transaction see a consistent snapshot, even if another transaction modifies and commits changes to the same rows. `SERIALIZABLE` provides the strictest isolation—transactions execute as if they were serialized one after another. The trade-off is performance: higher isolation levels hold locks longer and increase the chance of deadlocks.

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public BigDecimal calculateTotalBalance(Long userId) {
    // REPEATABLE READ ensures consistent view during transaction
    List<Account> accounts = accountRepository.findByUserId(userId);

    BigDecimal total = BigDecimal.ZERO;
    for (Account account : accounts) {
        // All reads see the same snapshot despite concurrent modifications
        total = total.add(account.getBalance());
    }

    // Perform some business logic
    performValidation(total);

    return total;
}

@Transactional(isolation = Isolation.SERIALIZABLE)
public void processBatchPayments(List<PaymentInstruction> payments) {
    // SERIALIZABLE ensures complete isolation
    // Transactions execute as if they were sequential
    for (PaymentInstruction payment : payments) {
        processPayment(payment);
    }
}
```

### Durability

Durability guarantees that once a transaction commits, the changes survive system failures. This is achieved through the database's Write-Ahead Log (WAL). In PostgreSQL, `wal_level = replica` and `synchronous_commit = on` ensure that the WAL is flushed to disk before the commit returns to the client. Spring's `DataSourceTransactionManager` delegates to the underlying database's durability mechanisms.

```java
@Configuration
public class DurabilityConfig {

    @Bean
    public PlatformTransactionManager transactionManager(DataSource dataSource) {
        DataSourceTransactionManager manager = new DataSourceTransactionManager(dataSource);

        // Ensure WAL (Write-Ahead Log) is properly configured
        manager.setNestedTransactionAllowed(true);

        return manager;
    }
}

// PostgreSQL WAL configuration
// wal_level = replica
// synchronous_commit = on
// full_page_writes = on
```

---

## Spring Transaction Management

### Declarative Transactions

Spring's `@Transactional` is the primary tool for declarative transaction management. The example below uses `Propagation.REQUIRED` (the default, joining the existing transaction or creating a new one) for the outer `createOrder` method, and `Propagation.REQUIRES_NEW` for `processPayment`, ensuring that payment processing commits independently even if the order creation fails. This is useful when you want to audit payment attempts regardless of the overall order outcome.

```java
@Service
public class OrderService {

    @Transactional(propagation = Propagation.REQUIRED, isolation = Isolation.READ_COMMITTED)
    public Order createOrder(CreateOrderRequest request) {
        // 1. Validate inventory
        validateInventory(request.getItems());

        // 2. Reserve stock (nested transaction)
        reserveStock(request.getItems());

        // 3. Create order
        Order order = new Order();
        order.setUserId(request.getUserId());
        order.setItems(mapItems(request.getItems()));
        order.setTotal(calculateTotal(request.getItems()));
        order.setStatus(OrderStatus.PENDING);
        order = orderRepository.save(order);

        // 4. Process payment (separate transaction)
        processPayment(order);

        return order;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void processPayment(Order order) {
        // Separate transaction - commits/rollbacks independently
        Payment payment = paymentService.charge(
            order.getUserId(), order.getTotal());
        order.setPaymentId(payment.getId());
        orderRepository.save(order);
    }
}
```

### Transaction Propagation Levels

Spring supports seven propagation behaviors. **REQUIRED** (default) joins the current transaction or creates a new one. **REQUIRES_NEW** suspends the current transaction and creates a new one, allowing independent commit/rollback. **NESTED** uses a savepoint within the current transaction for partial rollback. **MANDATORY** throws an exception if no transaction exists. **SUPPORTS** joins if one exists, runs non-transactionally otherwise. **NOT_SUPPORTED** suspends the current transaction. **NEVER** throws if a transaction exists.

```java
@Service
public class PropagationDemoService {

    @Autowired
    private PropagationDemoService self;  // Self-injection for proxy

    @Transactional(propagation = Propagation.REQUIRED)
    public void requiredExample() {
        // Joins existing transaction or creates new one
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void requiresNewExample() {
        // Always creates new transaction, suspends existing
    }

    @Transactional(propagation = Propagation.NESTED)
    public void nestedExample() {
        // Savepoint within existing transaction
        // Partial rollback possible
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void mandatoryExample() {
        // Must be called within existing transaction
        // Throws if no transaction exists
    }

    @Transactional(propagation = Propagation.SUPPORTS)
    public void supportsExample() {
        // Joins transaction if exists, otherwise runs non-transactional
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void notSupportedExample() {
        // Runs non-transactional, suspends existing if any
    }

    @Transactional(propagation = Propagation.NEVER)
    public void neverExample() {
        // Must run non-transactional
        // Throws if transaction exists
    }

    public void demonstrateNestedRollback() {
        try {
            // Outer transaction
            self.outerMethod();
        } catch (Exception e) {
            // Outer rollback doesn't affect inner completed transaction
        }
    }

    @Transactional
    public void outerMethod() {
        innerMethod();  // Nested - can rollback independently

        // If this fails, innerMethod changes are preserved
        throw new RuntimeException("Outer failure");
    }

    @Transactional(propagation = Propagation.NESTED)
    public void innerMethod() {
        // This transaction can rollback independently
        repository.save(new Entity("inner data"));

        // Exception causes nested rollback but doesn't affect outer
        throw new RuntimeException("Inner failure");
    }
}
```

---

## Rollback Strategies

### Declarative Rollback

By default, Spring rolls back the transaction for unchecked exceptions (`RuntimeException` and `Error`) but not for checked exceptions. The `rollbackFor` and `noRollbackFor` attributes override this. Below, `BusinessValidationException` and `EmailSendException` are excluded from rollback, allowing the order to be created even if the confirmation email fails.

```java
@Service
@Transactional(rollbackFor = Exception.class, noRollbackFor = {BusinessValidationException.class, EmailSendException.class})
public class RollbackStrategyService {

    public Order processOrder(OrderRequest request) {
        // All exceptions trigger rollback EXCEPT BusinessValidationException

        validateOrder(request);  // May throw BusinessValidationException

        Order order = createOrder(request);

        try {
            sendConfirmationEmail(order);
        } catch (EmailSendException e) {
            // Logged but transaction continues
            log.warn("Failed to send confirmation email for order {}", order.getId());
        }

        return order;
    }

    @Transactional(noRollbackFor = InsufficientInventoryException.class)
    public Order placeOrderWithPartialInventory(OrderRequest request) {
        try {
            return createOrder(request);
        } catch (InsufficientInventoryException e) {
            // Log partial order and continue
            log.info("Partial order placed: {}", e.getAvailableItems());
            return createPartialOrder(request, e.getAvailableItems());
        }
    }
}
```

### Programmatic Rollback

For complex business logic, you can trigger a rollback programmatically using `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()`. This is useful when the decision to rollback depends on computed business rules rather than exceptions.

```java
@Service
public class ProgrammaticRollbackService {

    @Transactional
    public void processWithManualRollback() {
        try {
            // Complex business logic
            step1();
            step2();

            if (!validateBusinessRules()) {
                // Trigger rollback programmatically
                TransactionAspectSupport.currentTransactionStatus()
                    .setRollbackOnly();
                return;
            }

            step3();

        } catch (Exception e) {
            TransactionAspectSupport.currentTransactionStatus()
                .setRollbackOnly();
            throw e;
        }
    }
}
```

---

## Best Practices

1. **Keep transactions short**: Minimize lock duration
2. **Use READ_COMMITTED default**: Balance consistency and performance
3. **Declare rollback policies**: Explicit rollbackFor/noRollbackFor
4. **Avoid long-running transactions**: Extract I/O outside transaction
5. **Use REQUIRES_NEW sparingly**: Each creates new connection
6. **Handle optimistic lock exceptions**: Retry on version conflicts
7. **Test transaction boundaries**: Integration tests for rollback scenarios
8. **Monitor transaction metrics**: Track duration, rollback rates
9. **Use read-only hint**: `@Transactional(readOnly = true)` for queries
10. **Avoid `this` method calls**: Spring proxy won't apply transaction

Marking a transaction as `readOnly = true` tells Hibernate to skip dirty checking for all entities loaded within the transaction, reducing memory and CPU overhead. It is safe for any operation that only reads data.

```java
// Read-only transaction optimization
@Transactional(readOnly = true)
public List<Product> searchProducts(String query) {
    // JPA optimizes read-only transactions
    // Hibernate may skip dirty checking
    return productRepository.search(query);
}
```

---

## Common Mistakes

### Mistake 1: Self-Invocation Without Proxy

Calling `this.createOrder()` from within the same class bypasses the Spring AOP proxy, so the `@Transactional` annotation is never processed. The fix is to inject the service as a self-reference, ensuring the method call goes through the proxy.

```java
// WRONG: this.method() bypasses transaction proxy
@Service
public class OrderService {
    @Transactional
    public void createOrder(OrderRequest request) {
        validateStock(request);
        // ...
    }

    public void processOrder(OrderRequest request) {
        this.createOrder(request);  // NO TRANSACTION!
    }
}

// CORRECT: Self-injection
@Service
public class OrderService {
    @Autowired
    private OrderService self;

    public void processOrder(OrderRequest request) {
        self.createOrder(request);  // Transaction applied via proxy
    }
}
```

### Mistake 2: Catching and Swallowing Exceptions

If a `@Transactional` method catches an exception without rethrowing it, Spring assumes the transaction completed successfully and commits—even if the logic errored. Let exceptions propagate to trigger the rollback.

```java
// WRONG: Transaction won't rollback
@Transactional
public void createOrder(OrderRequest request) {
    try {
        orderRepository.save(order);
    } catch (Exception e) {
        log.error("Error", e);
        // Transaction commits despite error!
    }
}

// CORRECT: Let Spring handle rollback
@Transactional
public void createOrder(OrderRequest request) {
    orderRepository.save(order);
}
```

### Mistake 3: Long Transactions with External API Calls

Holding a database connection and transaction open while making an external HTTP call wastes a connection for the duration of the network request and risks transaction timeout. Extract external calls outside the transaction boundary.

```java
// WRONG: External API call inside transaction
@Transactional
public void processOrder(OrderRequest request) {
    orderRepository.save(order);
    restClient.postForEntity("https://external.com/api", order);  // Holds DB connection!
}

// CORRECT: Extract external calls
public void processOrder(OrderRequest request) {
    Order order = createOrderInTransaction(request);
    notifyExternalSystem(order);
}
```

---

## Summary

1. ACID ensures reliable transaction processing
2. Atomicity: All or nothing execution
3. Consistency: Data integrity constraints maintained
4. Isolation: Concurrent transactions don't interfere
5. Durability: Committed changes survive failures
6. Spring @Transactional provides declarative transaction management
7. Choose propagation and isolation levels carefully
8. Keep transactions short and don't swallow exceptions
9. Use read-only hints for query optimization
10. Monitor and test transaction behavior

---

## References

- [Spring Transaction Management](https://docs.spring.io/spring-framework/reference/data-access/transaction.html)
- [ACID Properties - Wikipedia](https://en.wikipedia.org/wiki/ACID)
- [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [JPA Transaction Guidelines](https://www.baeldung.com/spring-transactional-propagation-isolation)

Happy Coding
