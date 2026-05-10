---
title: "Transactions and Propagation"
description: "Deep dive into Spring transaction management, propagation levels, isolation, and real-world patterns for reliable data consistency"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - transactions
  - database
  - jpa
coverImage: "/images/transactions-and-propagation.png"
draft: false
---

# Transactions and Propagation: The Complete Guide

## Overview

Transaction management is the cornerstone of data consistency in any enterprise application. Spring provides a powerful abstraction over database transactions, allowing you to focus on business logic while the framework handles the complex work of ensuring ACID (Atomicity, Consistency, Isolation, Durability) properties.

Understanding transaction propagation and isolation levels is critical for building correct, performant applications. Misunderstanding these concepts leads to subtle bugs like lost updates, dirty reads, and inconsistent state that are extremely difficult to diagnose in production.

---

## How Spring Transaction Management Works Internally

### The Transaction Abstraction Architecture

Spring's transaction abstraction consists of three layers:

1. **PlatformTransactionManager interface**: The core abstraction defining transaction operations
2. **TransactionDefinition**: Defines transaction properties (propagation, isolation, timeout, read-only)
3. **TransactionStatus**: Represents the current state of a transaction

```java
// PlatformTransactionManager interface - the core abstraction
public interface PlatformTransactionManager {
    
    TransactionStatus getTransaction(TransactionDefinition definition) 
        throws TransactionException;
    
    void commit(TransactionStatus status) throws TransactionException;
    
    void rollback(TransactionStatus status) throws TransactionException;
}

// TransactionDefinition - defines how a transaction should behave
public interface TransactionDefinition {
    
    // Propagation behavior
    int getPropagationBehavior();
    
    // Isolation level
    int getIsolationLevel();
    
    // Timeout in seconds
    int getTimeout();
    
    // Is read-only?
    boolean isReadOnly();
    
    // Transaction name
    String getName();
}

// Common propagation behaviors
public abstract class TransactionDefinition {
    public static final int PROPAGATION_REQUIRED = 0;    // Default
    public static final int PROPAGATION_SUPPORTS = 1;
    public static final int PROPAGATION_MANDATORY = 2;
    public static final int PROPAGATION_REQUIRES_NEW = 3;
    public static final int PROPAGATION_NOT_SUPPORTED = 4;
    public static final int PROPAGATION_NEVER = 5;
    public static final int PROPAGATION_NESTED = 6;
}
```

### How @Transactional Works Under the Hood

When you annotate a method with `@Transactional`, Spring creates a proxy that wraps your method with transaction management code:

```java
// What Spring generates (simplified)
public class TransactionInterceptor implements MethodInterceptor {
    
    @Autowired
    private PlatformTransactionManager transactionManager;
    
    public Object invoke(MethodInvocation invocation) {
        
        // Get transaction attributes
        TransactionAttribute attr = getTransactionAttribute(invocation);
        
        // Get or create transaction based on propagation
        TransactionStatus status = transactionManager.getTransaction(attr);
        
        try {
            // Execute the actual method
            Object result = invocation.proceed();
            
            // Commit if everything succeeded
            transactionManager.commit(status);
            return result;
            
        } catch (RuntimeException ex) {
            // Rollback on runtime exceptions
            transactionManager.rollback(status);
            throw ex;
        }
    }
}

// Auto-proxy creation
@Configuration
@EnableTransactionManagement
public class TransactionConfig {
    
    @Bean
    public BeanNameAutoProxyCreator transactionProxy() {
        BeanNameAutoProxyCreator creator = new BeanNameAutoProxyCreator();
        creator.setProxyTargetClass(true);
        creator.setBeanNames("*Service", "*Dao");
        creator.setInterceptorNames("transactionInterceptor");
        return creator;
    }
}
```

### The Proxy Chain

When a transactional method calls another transactional method within the same class, the proxy is bypassed (this is a common source of bugs):

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        // This call goes directly to the method (no proxy!)
        // So @Transactional on placeOrder is NOT applied!
        placeOrder(order);  // WRONG: No new transaction created
        
        // CORRECT: Call through the proxy
        ((OrderService) AopContext.currentProxy()).placeOrder(order);
    }
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void placeOrder(Order order) {
        // This runs in a NEW transaction (if called through proxy)
        orderRepository.save(order);
    }
}

// Correct approach: Self-injection
@Service
public class OrderService implements ApplicationContextAware {
    
    private ApplicationContext context;
    
    @Transactional
    public void createOrder(Order order) {
        // Get proxy to call method with its own transaction
        OrderService proxy = context.getBean(OrderService.class);
        proxy.placeOrder(order);  // Runs in new transaction
    }
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void placeOrder(Order order) {
        orderRepository.save(order);
    }
}
```

---

## Transaction Propagation Explained

### Propagation Types and Their Behavior

```java
@Service
public class TransferService {
    
    @Autowired
    private AccountRepository accountRepository;
    
    // REQUIRED: Joins existing transaction or creates new one
    // Most commonly used for standard business operations
    @Transactional(propagation = Propagation.REQUIRED)
    public void transfer(Long fromId, Long toId, BigDecimal amount) {
        // If called without existing transaction, creates new one
        // If called within existing transaction, uses that transaction
        Account from = accountRepository.findById(fromId);
        from.withdraw(amount);
        accountRepository.save(from);
        
        // Call other transactional method
        deposit(toId, amount);  // Uses same transaction
    }
    
    // REQUIRES_NEW: Always creates new transaction
    // Used for logging, auditing that must commit even if parent fails
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void deposit(Long accountId, BigDecimal amount) {
        // ALWAYS runs in a separate transaction
        // If parent rolls back, this transaction still commits
        Account to = accountRepository.findById(accountId);
        to.deposit(amount);
        accountRepository.save(to);
    }
    
    // NESTED: Uses savepoint if transaction exists
    // Only works with JDBC (not JPA), uses Spring's savepoint
    @Transactional(propagation = Propagation.NESTED)
    public void processWithFallback(Long id) {
        // If transaction exists, uses savepoint - can rollback to savepoint
        // If no transaction, behaves like REQUIRED
        try {
            processPrimary(id);
        } catch (Exception e) {
            // Can recover to savepoint
            log.warn("Primary processing failed, trying fallback");
            processFallback(id);
        }
    }
    
    // SUPPORTS: Joins if transaction exists, runs non-transactional otherwise
    @Transactional(propagation = Propagation.SUPPORTS)
    public void updateStatistics() {
        // If called within transaction: uses it
        // If called without transaction: runs without transaction (autocommit)
        statsService.updateStats();
    }
    
    // MANDATORY: Must be called within existing transaction
    @Transactional(propagation = Propagation.MANDATORY)
    public void executeInTransaction() {
        // Throws IllegalTransactionStateException if no transaction exists
    }
    
    // NOT_SUPPORTED: Suspends existing transaction, runs non-transactional
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void sendExternalNotification(String message) {
        // Suspends any existing transaction
        // If called within transaction, that transaction is suspended
        externalService.send(message);
    }
    
    // NEVER: Throws exception if called within transaction
    @Transactional(propagation = Propagation.NEVER)
    public void executeOutsideTransaction() {
        // Throws IllegalTransactionStateException if called within transaction
    }
}
```

### Visual Representation of Propagation

```
Scenario 1: REQUIRED (default)
┌─────────────────────────────────────────────┐
│  Transaction A                               │
│  ┌───────────────────────────────────────┐  │
│  │  method1() @Transactional            │  │
│  │  ┌─────────────────────────────┐     │  │
│  │  │  method2() @Transactional  │     │  │
│  │  │  (same transaction)        │     │  │
│  │  └─────────────────────────────┘     │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘

Scenario 2: REQUIRES_NEW
┌─────────────────────────────────────────────┐
│  Transaction A                               │
│  ┌───────────────────────────────────────┐  │
│  │  method1() @Transactional            │  │
│  └───────────────────────────────────────┘  │
│         │                                     │
└─────────┼─────────────────────────────────────┘
          │ (suspends A)
┌─────────┼─────────────────────────────────────┐
│  Transaction B (new)                         │
│  ┌───────────────────────────────────────┐  │
│  │  method2() @Transactional(REQUIRES_NEW)│  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## Transaction Isolation Levels

Isolation levels control how transactions interact with each other. Understanding these is crucial for preventing concurrency issues:

```java
// Isolation levels
public abstract class TransactionDefinition {
    public static final int ISOLATION_DEFAULT = -1;           // Use DB default
    public static final int ISOLATION_READ_UNCOMMITTED = 1;   // Dirty reads possible
    public static final int ISOLATION_READ_COMMITTED = 2;     // Prevents dirty reads
    public static final int ISOLATION_REPEATABLE_READ = 4;    // Prevents non-repeatable reads
    public static final int ISOLATION_SERIALIZABLE = 8;        // Full isolation
}

// Configuration
@Configuration
public class TransactionConfig {
    
    @Bean
    public DataSourceTransactionManager transactionManager(DataSource ds) {
        DataSourceTransactionManager tm = new DataSourceTransactionManager(ds);
        // Set default isolation level
        tm.setDefaultIsolation(TransactionDefinition.ISOLATION_READ_COMMITTED);
        return tm;
    }
}

// Per-method isolation
@Service
public class ReportingService {
    
    // Serializable for strict consistency (but slower)
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public MonthlyReport generateMonthlyReport() {
        // Full isolation - no other transactions can read/modify
        return reportGenerator.generate();
    }
    
    // Default (usually READ_COMMITTED) for normal operations
    @Transactional
    public void updateUser(User user) {
        userRepository.save(user);
    }
    
    // Read-only with READ_COMMITTED for queries
    @Transactional(readOnly = true, isolation = Isolation.READ_COMMITTED)
    public List<User> getAllUsers() {
        return userRepository.findAll();
    }
}
```

### Understanding Isolation Problems

```java
// Dirty Read: Transaction A reads uncommitted changes from Transaction B
// ISOLATION_READ_UNCOMMITTED allows this

// Example of dirty read problem
@Service
public class AccountService {
    
    @Transactional(isolation = Isolation.READ_UNCOMMITTED)
    public BigDecimal getBalanceRisky(Long accountId) {
        // Can read another uncommitted transaction's changes
        Account account = accountRepository.findById(accountId);
        return account.getBalance();
    }
    
    // Non-repeatable read: Same query returns different results within transaction
    // ISOLATION_READ_COMMITTED allows this
    
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void processWithInconsistentReads(Long orderId) {
        Order order1 = orderRepository.findById(orderId);  // status = PENDING
        processOrder(order1);
        
        // Another transaction might have changed the status
        Order order2 = orderRepository.findById(orderId);  // status = CANCELLED
        // order1 and order2 have different data!
    }
    
    // Phantom read: Same query with different result set
    // ISOLATION_REPEATABLE_READ allows this for rows, but not for new rows
    
    // Serializable prevents all these issues but severely impacts performance
}
```

---

## Real-World Backend Use Cases

### Case 1: Bank Money Transfer

The classic example requiring atomicity:

```java
@Service
public class TransferService {
    
    @Autowired
    private AccountRepository accountRepository;
    
    @Transactional
    public void transfer(Long fromAccountId, Long toAccountId, BigDecimal amount) {
        // Check sufficient balance
        Account from = accountRepository.findById(fromAccountId)
            .orElseThrow(() -> new AccountNotFoundException(fromAccountId));
        
        if (from.getBalance().compareTo(amount) < 0) {
            throw new InsufficientFundsException("Insufficient balance");
        }
        
        // Debit from account
        from.setBalance(from.getBalance().subtract(amount));
        accountRepository.save(from);
        
        // Credit to account
        Account to = accountRepository.findById(toAccountId)
            .orElseThrow(() -> new AccountNotFoundException(toAccountId));
        
        to.setBalance(to.getBalance().add(amount));
        accountRepository.save(to);
        
        // If any operation fails, entire transaction rolls back
    }
}

// Controller with proper error handling
@RestController
public class TransferController {
    
    @PostMapping("/transfer")
    public ResponseEntity<Void> transfer(@RequestBody TransferRequest request) {
        try {
            transferService.transfer(
                request.getFromAccount(),
                request.getToAccount(),
                request.getAmount()
            );
            return ResponseEntity.ok().build();
        } catch (InsufficientFundsException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}
```

### Case 2: Saga Pattern for Distributed Transactions

When services need to coordinate across multiple microservices:

```java
// Saga orchestration
@Service
public class OrderSagaService {
    
    @Autowired
    private OrderService orderService;
    
    @Autowired
    private PaymentService paymentService;
    
    @Autowired
    private InventoryService inventoryService;
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)  // Each step in new transaction
    public OrderResult placeOrderSaga(OrderRequest request) {
        
        try {
            // Step 1: Reserve inventory
            ReservationResult reservation = inventoryService.reserve(
                request.getItems()
            );
            if (!reservation.isSuccess()) {
                throw new SagaStepException("Inventory reservation failed");
            }
            
            // Step 2: Process payment
            PaymentResult payment = paymentService.process(
                request.getUserId(),
                request.getAmount()
            );
            if (!payment.isSuccess()) {
                // Compensate: release inventory
                inventoryService.release(reservation.getReservationId());
                throw new SagaStepException("Payment failed");
            }
            
            // Step 3: Create order
            Order order = orderService.createOrder(request);
            
            return OrderResult.success(order);
            
        } catch (SagaStepException e) {
            // All compensation actions are handled by the saga orchestrator
            throw e;
        }
    }
}

// Compensation actions (rollback)
@Service
public class SagaCompensationService {
    
    @Transactional
    public void compensateOrder(Long orderId) {
        Order order = orderRepository.findById(orderId);
        order.setStatus("CANCELLED");
        orderRepository.save(order);
    }
    
    @Transactional
    public void compensatePayment(String paymentId) {
        paymentService.refund(paymentId);
    }
    
    @Transactional
    public void compensateInventory(String reservationId) {
        inventoryService.release(reservationId);
    }
}
```

### Case 3: Optimistic Locking for Concurrent Updates

Prevent lost updates in high-concurrency scenarios:

```java
@Entity
public class Product {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String name;
    
    private Integer quantity;
    
    @Version  // Optimistic locking - auto-incremented on each update
    private Long version;
}

// Repository
public interface ProductRepository extends JpaRepository<Product, Long> {
}

// Service with version checking
@Service
public class InventoryService {
    
    @Transactional
    public void updateQuantity(Long productId, int delta, Long expectedVersion) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
        
        // Manual version check
        if (!product.getVersion().equals(expectedVersion)) {
            throw new ConcurrentModificationException(
                "Product was modified by another transaction");
        }
        
        product.setQuantity(product.getQuantity() + delta);
        productRepository.save(product);
        
        // If version changed, JPA throws OptimisticLockException
        // (with @Version annotation, this is automatic)
    }
    
    // Alternative: Rely on automatic optimistic locking
    @Transactional
    public void updateQuantityAuto(Long productId, int delta) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
        
        product.setQuantity(product.getQuantity() + delta);
        productRepository.save(product);
        
        // If another transaction updated this product,
        // JPA automatically throws OptimisticLockException
    }
}

// Controller
@RestController
public class InventoryController {
    
    @PutMapping("/products/{id}/quantity")
    public ResponseEntity<?> updateQuantity(
            @PathVariable Long id,
            @RequestBody UpdateQuantityRequest request) {
        
        try {
            // Pass expected version for optimistic locking
            inventoryService.updateQuantity(
                id, 
                request.getDelta(), 
                request.getVersion()
            );
            return ResponseEntity.ok().build();
        } catch (ConcurrentModificationException e) {
            // Client should refresh and retry
            return ResponseEntity.status(409)
                .body("Product was modified. Please refresh and retry.");
        }
    }
}
```

### Case 4: Read-Only Transaction Optimization

Use read-only transactions for query performance:

```java
@Configuration
@EnableJpaRepositories
public class JpaConfig {
    
    @Bean
    public JpaTransactionManager transactionManager(EntityManagerFactory emf) {
        JpaTransactionManager tm = new JpaTransactionManager(emf);
        
        // Enable read-only optimization
        tm.setReadOnly(true);
        
        return tm;
    }
}

// Service with read-only transactions
@Service
public class ReportService {
    
    // Read-only for better performance (no dirty checking)
    @Transactional(readOnly = true)
    public MonthlyReport generateReport(int year, int month) {
        List<Order> orders = orderRepository.findByYearAndMonth(year, month);
        
        // Process without tracking changes
        return buildReport(orders);
    }
    
    // Set specific timeout for long-running queries
    @Transactional(readOnly = true, timeout = 60)
    public BigDataSet queryLargeDataset() {
        return largeDataRepository.findAll();
    }
}
```

---

## Trade-offs: Transaction Settings

### Isolation Level Trade-offs

| Isolation Level | Dirty Reads | Non-Repeatable Reads | Phantom Reads | Performance |
|-----------------|-------------|----------------------|---------------|-------------|
| READ_UNCOMMITTED | Possible | Possible | Possible | Best |
| READ_COMMITTED | Prevented | Possible | Possible | Good |
| REPEATABLE_READ | Prevented | Prevented | Possible | Moderate |
| SERIALIZABLE | Prevented | Prevented | Prevented | Poor |

### When to Use Each

```java
@Service
public class TransactionDecisionService {
    
    // READ_COMMITTED (default for most databases)
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void typicalBusinessOperation() {
        // Standard CRUD - balance between consistency and performance
    }
    
    // REPEATABLE_READ
    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public void financialCalculation() {
        // When reading same data multiple times in transaction
        // e.g., balance check then update
    }
    
    // SERIALIZABLE
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public void criticalFinancialOperation() {
        // When absolute consistency is critical
        // e.g., inventory management, bank transfers
        // WARNING: Can cause deadlocks and severe performance issues
    }
}
```

---

## Production Considerations

### 1. Handling Deadlocks

```java
@Configuration
public class TransactionConfiguration {
    
    @Bean
    public DataSourceTransactionManager transactionManager(DataSource ds) {
        DataSourceTransactionManager tm = new DataSourceTransactionManager(ds);
        
        // Set deadlock timeout
        tm.setDefaultTimeout(30);
        
        return tm;
    }
}

@Service
public class SafeTransactionService {
    
    // Prevent deadlocks by consistent ordering of table access
    @Transactional
    public void safeTransfer(Long fromId, Long toId, BigDecimal amount) {
        // Always access accounts in consistent order (by ID)
        Long firstId = fromId.compareTo(toId) < 0 ? fromId : toId;
        Long secondId = fromId.compareTo(toId) < 0 ? toId : fromId;
        
        Account first = accountRepository.findById(firstId);
        Account second = accountRepository.findById(secondId);
        
        // Update in consistent order
        if (firstId.equals(fromId)) {
            first.withdraw(amount);
            second.deposit(amount);
        } else {
            second.deposit(amount);
            first.withdraw(amount);
        }
        
        accountRepository.save(first);
        accountRepository.save(second);
    }
    
    // Retry template for transient failures
    @Retryable(deadlockMaxAttempts = 3, deadlockDelay = 100)
    @Transactional
    public void transferWithRetry(Long fromId, Long toId, BigDecimal amount) {
        transfer(fromId, toId, amount);
    }
}
```

### 2. Programmatic Transaction Management

For complex scenarios where declarative transactions don't work:

```java
@Service
public class ProgrammaticTransactionService {
    
    @Autowired
    private PlatformTransactionManager transactionManager;
    
    public void complexOperation() {
        
        // Define transaction
        DefaultTransactionDefinition definition = new DefaultTransactionDefinition();
        definition.setName("ComplexOperation");
        definition.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        definition.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        definition.setTimeout(30);
        
        // Get transaction status
        TransactionStatus status = transactionManager.getTransaction(definition);
        
        try {
            // Do work
            processStep1();
            processStep2();
            
            // Commit
            transactionManager.commit(status);
            
        } catch (Exception e) {
            // Rollback
            transactionManager.rollback(status);
            throw e;
        }
    }
    
    // Use TransactionTemplate for cleaner code
    @Autowired
    private TransactionTemplate transactionTemplate;
    
    public void usingTemplate() {
        transactionTemplate.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transactionTemplate.setTimeout(30);
        
        String result = transactionTemplate.execute(status -> {
            // Transactional work
            return processData();
        });
    }
}
```

### 3. Testing Transactions

```java
@SpringBootTest
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:testdb"
})
class TransactionTest {
    
    @Autowired
    private TransferService transferService;
    
    @Autowired
    private AccountRepository accountRepository;
    
    @Test
    @Transactional  // Rolls back after test
    void testTransfer() {
        // Setup
        Account from = new Account();
        from.setBalance(new BigDecimal("1000"));
        from = accountRepository.save(from);
        
        Account to = new Account();
        to.setBalance(new BigDecimal("500"));
        to = accountRepository.save(to);
        
        // Execute
        transferService.transfer(from.getId(), to.getId(), new BigDecimal("100"));
        
        // Assert
        Account fromResult = accountRepository.findById(from.getId()).get();
        Account toResult = accountRepository.findById(to.getId()).get();
        
        assertEquals(new BigDecimal("900"), fromResult.getBalance());
        assertEquals(new BigDecimal("600"), toResult.getBalance());
    }
    
    @Test
    @Rollback(false)  // Don't rollback - verify actual database state
    @Commit
    void testRealTransfer() {
        // Actual database operation
    }
}
```

### 4. Monitoring Transactions

```java
@Configuration
public class TransactionMetrics {
    
    @Bean
    public MeterBinder transactionMetrics(PlatformTransactionManager tm) {
        return registry -> {
            // Export transaction metrics
            if (tm instanceof JpaTransactionManager) {
                // Export JPA-specific metrics
            }
        };
    }
}

// AOP for transaction timing
@Aspect
@Component
public class TransactionTimingAspect {
    
    @Around("@annotation(Transactional)")
    public Object measureTransactionTime(ProceedingJoinPoint joinPoint) 
            throws Throwable {
        
        long start = System.currentTimeMillis();
        try {
            return joinPoint.proceed();
        } finally {
            long duration = System.currentTimeMillis() - start;
            
            if (duration > 1000) {
                log.warn("Slow transaction: {}.{} took {}ms",
                    joinPoint.getTarget().getClass().getSimpleName(),
                    joinPoint.getSignature().getName(),
                    duration
                );
            }
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Forgetting @Transactional

```java
// WRONG: No transaction - each statement auto-commits
@Service
public class BrokenUserService {
    
    public void createUserWithRoles(User user, List<Role> roles) {
        userRepository.save(user);  // Auto-commits immediately
        
        // If this fails, user was already saved!
        for (Role role : roles) {
            role.setUserId(user.getId());
            roleRepository.save(role);
        }
    }
}

// CORRECT: Wrap in transaction
@Service
public class CorrectUserService {
    
    @Transactional
    public void createUserWithRoles(User user, List<Role> roles) {
        userRepository.save(user);
        
        for (Role role : roles) {
            role.setUserId(user.getId());
            roleRepository.save(role);
        }
        
        // All or nothing - either all save or none
    }
}
```

### Mistake 2: Checked Exceptions Not Triggering Rollback

```java
// WRONG: By default, only RuntimeException triggers rollback
@Service
public class BrokenPaymentService {
    
    @Transactional
    public void processPayment(Payment payment) throws PaymentException {
        // PaymentException is checked, so transaction WON'T rollback!
        if (!paymentService.validate(payment)) {
            throw new PaymentException("Invalid payment");
        }
        
        paymentService.charge(payment);
    }
}

// CORRECT: Explicitly specify rollback
@Service
public class CorrectPaymentService {
    
    @Transactional(rollbackFor = PaymentException.class)
    public void processPayment(Payment payment) throws PaymentException {
        if (!paymentService.validate(payment)) {
            throw new PaymentException("Invalid payment");
        }
        
        paymentService.charge(payment);
    }
    
    // Or rollback for all exceptions
    @Transactional(rollbackFor = Exception.class)
    public void processAnything() throws Exception {
        // Rolls back for any exception
    }
}
```

### Mistake 3: Transaction in Loop

```java
// WRONG: Each save in separate transaction
@Service
public class BrokenImportService {
    
    @Transactional  // Won't help here!
    public void importUsers(List<User> users) {
        for (User user : users) {
            // Each iteration might create separate transaction
            userRepository.save(user);  // N transactions
        }
    }
}

// CORRECT: Batch all saves
@Service
public class CorrectImportService {
    
    @Transactional
    public void importUsers(List<User> users) {
        userRepository.saveAll(users);  // Single transaction
    }
    
    // Or use batch with proper flush
    @Transactional
    public void importLargeDataset(List<User> users) {
        int batchSize = 100;
        
        for (int i = 0; i < users.size(); i++) {
            userRepository.save(users.get(i));
            
            if (i % batchSize == 0) {
                entityManager.flush();
                entityManager.clear();  // Clear persistence context
            }
        }
    }
}
```

### Mistake 4: Catching Exception Without Re-throwing

```java
// WRONG: Swallowing exception prevents rollback
@Service
public class BrokenOrderService {
    
    @Transactional
    public void createOrder(Order order) {
        try {
            validateOrder(order);
            orderRepository.save(order);
            sendConfirmation(order);
        } catch (ValidationException e) {
            // Exception swallowed! Transaction commits anyway!
            log.warn("Validation failed", e);
        }
    }
}

// CORRECT: Either re-throw or handle properly
@Service
public class CorrectOrderService {
    
    @Transactional
    public void createOrder(Order order) {
        validateOrder(order);  // Throws - transaction rolls back
        
        orderRepository.save(order);
        sendConfirmation(order);  // If this fails, transaction rolls back
    }
    
    @Transactional
    public void createOrderWithCleanup(Order order) {
        try {
            validateOrder(order);
            orderRepository.save(order);
            sendConfirmation(order);
        } catch (ValidationException e) {
            // If we want to handle gracefully, must explicitly rollback
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
            throw new OrderValidationException("Invalid order", e);
        }
    }
}
```

### Mistake 5: Overly Broad Transactions

```java
// WRONG: Too much in one transaction
@Service
public class BrokenReportService {
    
    @Transactional  // Single transaction for entire operation
    public Report generateReport() {
        // This could take minutes, holding locks the entire time!
        List<User> users = userRepository.findAll();
        List<Order> orders = orderRepository.findAll();
        List<Product> products = productRepository.findAll();
        
        return buildReport(users, orders, products);
    }
}

// CORRECT: Break into smaller transactions
@Service
public class CorrectReportService {
    
    @Transactional(readOnly = true)
    public List<UserSummary> getUserSummaries() {
        return userRepository.findUserSummaries();  // Fast query
    }
    
    @Transactional(readOnly = true)
    public List<OrderSummary> getOrderSummaries() {
        return orderRepository.findOrderSummaries();
    }
    
    // Generate report in smaller chunks
    public Report generateReport() {
        return Report.builder()
            .users(getUserSummaries())
            .orders(getOrderSummaries())
            .build();
    }
}
```

---

## Summary

Transaction management is fundamental to building correct, reliable applications. Key takeaways:

1. **Propagation determines behavior**: REQUIRED joins existing, REQUIRES_NEW creates new
2. **Isolation affects consistency**: Higher isolation = more consistent but slower
3. **Rollback is not automatic**: Only RuntimeException triggers rollback by default
4. **Keep transactions short**: Long transactions hold locks and hurt performance
5. **Test transactions**: Use @Transactional in tests but verify actual behavior

Understanding these concepts and their implications allows you to build applications that maintain data consistency under any concurrency scenario.

---

## References

- [Spring Transaction Management](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction)
- [Spring @Transactional Explained](https://www.baeldung.com/spring-transactional-propagation-isolation)
- [Hibernate Transaction Management](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#transactions)
- [Database Isolation Levels](https://en.wikipedia.org/wiki/Isolation_(database_systems))