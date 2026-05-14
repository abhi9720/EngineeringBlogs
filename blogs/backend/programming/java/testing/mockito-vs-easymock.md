---
title: "Mockito vs EasyMock"
description: "In-depth comparison of Mockito and EasyMock mocking frameworks: API differences, verification, stubbing, and best practices"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - mockito
  - easymock
  - mocking
  - testing
coverImage: "/images/mockito-vs-easymock.png"
draft: false
---

# Mockito vs EasyMock: Mocking Framework Comparison

## Overview

Mocking frameworks are essential for isolating units under test. Mockito and EasyMock are the two most popular Java mocking frameworks. While they serve the same purpose, their APIs differ significantly in philosophy: EasyMock uses expect-run-verify, while Mockito uses when-then-verify. This guide compares both frameworks with equivalent examples.

---

## Core Philosophy

### EasyMock: Expect-Run-Verify

1. **Record phase**: Set expectations for method calls
2. **Replay phase**: Execute the code under test
3. **Verify phase**: Check that all expectations were met

### Mockito: When-Then-Verify

1. **Stub phase**: Define return values (when needed)
2. **Execute phase**: Run the code under test
3. **Verify phase**: Assert interactions (when needed)

The key philosophical difference is that EasyMock requires you to set expectations *before* execution, while Mockito allows you to set them *after*. This makes Mockito tests easier to read and refactor because the "arrange" section reads more naturally: "when X is called, then return Y."

---

## Setup and Mock Creation

### EasyMock

```java
// Static import
import static org.easymock.EasyMock.*;

public class EasyMockExample {

    @Before
    public void setup() {
        // Create mocks
        userRepository = createMock(UserRepository.class);
        emailService = createMock(EmailService.class);
        auditLogger = createStrictMock(AuditLogger.class);  // Order-sensitive

        // Inject mocks
        userService = new UserService(userRepository, emailService, auditLogger);
    }

    @After
    public void tearDown() {
        verify(userRepository);  // Optional: verify all expectations were met
        verify(emailService);
    }
}
```

### Mockito

```java
import static org.mockito.Mockito.*;

public class MockitoExample {

    @Before
    public void setup() {
        // Annotations-based
        MockitoAnnotations.openMocks(this);
    }

    // Annotation-based injection
    @Mock
    private UserRepository userRepository;

    @Mock
    private EmailService emailService;

    @Spy
    private AuditLogger auditLogger = new AuditLogger();

    @InjectMocks
    private UserService userService;  // Automatically injects mocks
}
```

---

## Stubbing (Setting Return Values)

### EasyMock

```java
@Test
public void testFindUser() {
    // Record phase
    User expected = new User("alice");
    expect(userRepository.findById(1L)).andReturn(expected);
    expect(userRepository.findById(99L)).andReturn(null);
    replay(userRepository);  // Switch to replay mode

    // Execute
    User result = userService.getUser(1L);
    assertEquals("alice", result.getUsername());
    assertNull(userService.getUser(99L));
}

@Test
public void testWithExceptions() {
    expect(userRepository.findById(anyLong()))
        .andThrow(new DatabaseException("Connection failed"))
        .times(2);  // Expect this twice
    replay(userRepository);

    assertThrows(DatabaseException.class,
        () -> userService.getUser(1L));
}

@Test
public void testWithCapture() {
    Capture<Long> capturedId = newCapture();
    expect(userRepository.findById(and(anyLong(), capture(capturedId))))
        .andReturn(new User("captured"));
    replay(userRepository);

    userService.getUser(42L);
    assertEquals(42L, (long) capturedId.getValue());
}
```

### Mockito Equivalent

```java
@Test
public void testFindUser() {
    // Stub phase
    User expected = new User("alice");
    when(userRepository.findById(1L)).thenReturn(expected);
    when(userRepository.findById(99L)).thenReturn(null);

    // Execute
    User result = userService.getUser(1L);
    assertEquals("alice", result.getUsername());
    assertNull(userService.getUser(99L));
}

@Test
public void testWithExceptions() {
    when(userRepository.findById(anyLong()))
        .thenThrow(new DatabaseException("Connection failed"));

    assertThrows(DatabaseException.class,
        () -> userService.getUser(1L));
}

@Test
public void testWithCapture() {
    ArgumentCaptor<Long> captor = ArgumentCaptor.forClass(Long.class);
    when(userRepository.findById(captor.capture()))
        .thenReturn(new User("captured"));

    userService.getUser(42L);
    assertEquals(42L, captor.getValue());
}
```

---

## Verification (Checking Interactions)

### EasyMock

```java
@Test
public void testRegistrationSendsEmail() {
    // Stub the return
    expect(userRepository.save(anyObject())).andReturn(savedUser);
    replay(userRepository, emailService);

    userService.registerUser(newRegistration);

    // Verify interactions
    verify(userRepository);
    verify(emailService);
}

@Test
public void testVerificationOrder() {
    // Strict mock enforces call order
    AuditLogger strictLogger = createStrictMock(AuditLogger.class);

    strictLogger.logCreateUser("alice");
    expectLastCall().times(1);
    strictLogger.logEmailSent("alice");
    expectLastCall();
    replay(strictLogger);

    userService.registerUser(newRegistration);

    verify(strictLogger);  // Fails if calls were in wrong order
}
```

### Mockito Equivalent

```java
@Test
public void testRegistrationSendsEmail() {
    when(userRepository.save(any())).thenReturn(savedUser);

    userService.registerUser(newRegistration);

    verify(userRepository).save(any());
    verify(emailService).sendWelcomeEmail(any());
}

@Test
public void testVerificationOrder() {
    userService.registerUser(newRegistration);

    // Verify call order using InOrder
    InOrder inOrder = inOrder(auditLogger, emailService);
    inOrder.verify(auditLogger).logCreateUser("alice");
    inOrder.verify(emailService).sendWelcomeEmail("alice");
}

@Test
public void testVerificationDetails() {
    userService.registerUser(newRegistration);

    // Verify exact call count
    verify(userRepository, times(1)).save(any());
    verify(emailService, never()).sendPasswordResetEmail(any());
    verify(userRepository, atLeastOnce()).findByEmail(any());
    verify(userRepository, atMost(3)).findByEmail(any());

    // Timeout verification (for async tests)
    verify(emailService, timeout(1000)).sendWelcomeEmail(any());
}
```

---

## Partial Mocks (Spies)

### EasyMock

```java
@Test
public void testPartialMock() {
    OrderService partialMock = createMockBuilder(OrderService.class)
        .addMockedMethod("sendNotification")
        .createMock();

    expect(partialMock.sendNotification(anyObject())).andReturn(true);
    replay(partialMock);

    // Real method calculateTotal() is used
    // Mocked method sendNotification() is stubbed
    Order result = partialMock.processOrder(testOrder);
    assertNotNull(result);
}

@Test
public void testNiceMock() {
    // Nice mock returns defaults for unstubbed methods
    UserRepository niceMock = createNiceMock(UserRepository.class);
    // Returns null, 0, false for unstubbed methods
}
```

### Mockito Equivalent

```java
@Test
public void testSpy() {
    OrderService spy = spy(new OrderService());

    // Real methods are called by default, except stubbed ones
    doReturn(true).when(spy).sendNotification(any());

    Order result = spy.processOrder(testOrder);
    // processOrder() runs real code
    // sendNotification() is intercepted
    assertNotNull(result);
}

@Test
public void testLenientStub() {
    // Lenient stubs don't trigger unused stub warnings
    lenient().when(userRepository.findById(99L)).thenReturn(null);
}
```

---

## API Comparison Table

| Feature | EasyMock | Mockito |
|---------|----------|---------|
| Initial release | 2000 | 2008 |
| Mock creation | `createMock()` | `@Mock` / `mock()` |
| Stubbing | `expect(x).andReturn(y)` | `when(x).thenReturn(y)` |
| Exceptions | `andThrow(e)` | `thenThrow(e)` |
| Void methods | `expectLastCall()` | `doNothing().when()` |
| Argument matchers | `anyObject()`, `eq()` | `any()`, `eq()` |
| Argument capture | `Capture` | `ArgumentCaptor` |
| Call order | `createStrictMock()` | `InOrder` |
| Spies | `createMockBuilder()` | `spy()` |
| Verification | `verify(mock)` | `verify(mock)` |
| Partial mocking | `addMockedMethod()` | `doReturn().when()` |
| Reset | `reset(mock)` | `reset(mock)` |
| BDD style | Not built-in | `given().willReturn()` |

---

## BDD Style Example

### Mockito BDD

```java
import static org.mockito.BDDMockito.*;

class OrderServiceBddTest {

    @Test
    void shouldProcessOrderWhenInventoryAvailable() {
        // Given
        given(inventoryService.checkAvailability("item-1", 2))
            .willReturn(true);
        given(paymentService.charge(any(), eq(100.00)))
            .willReturn(new PaymentReceipt("txn-123"));

        // When
        OrderConfirmation confirmation = orderService.placeOrder(testOrder);

        // Then
        then(orderRepository).should().save(any(Order.class));
        then(notificationService).should().sendConfirmation(any());
        assertNotNull(confirmation.getOrderId());
    }
}
```

### EasyMock BDD (with mockito-like approach)

EasyMock doesn't have built-in BDD syntax, but can be used with standard pattern.

---

## Common Mistakes

### Mistake 1: Over-mocking

```java
// WRONG: Mocking value objects
User user = mock(User.class);
when(user.getUsername()).thenReturn("alice");
when(user.getEmail()).thenReturn("alice@example.com");
// Use real objects for simple data classes

// CORRECT: Use real instances
User user = new User("alice", "alice@example.com");
```

### Mistake 2: Not Verifying Interactions

```java
// WRONG: Stubbing but never verifying
when(emailService.sendEmail(any())).thenReturn(true);
userService.registerUser(user);
// Did registerUser actually call sendEmail?

// CORRECT: Verify significant interactions
verify(emailService).sendEmail(any());
```

### Mistake 3: Mocking Class Under Test

```java
// WRONG: Mocking the class you're testing
UserService userService = mock(UserService.class);
when(userService.getUser(1L)).thenReturn(user);
// Tests mock behavior, not real implementation

// CORRECT: Use real instance with injected mocks
UserService userService = new UserService(userRepository, emailService);
```

---

## Summary

Mockito is the more popular framework with a simpler API (when-then-verify), better annotation support, and BDD syntax. EasyMock has a more explicit expect-run-verify cycle that some teams prefer for its readability. Both frameworks support stubbing, verification, argument capture, spies, and partial mocking. Choose Mockito for new projects due to its larger community, cleaner annotations, and better Spring integration.

---

## References

- [Mockito Documentation](https://site.mockito.org/)
- [EasyMock Documentation](https://easymock.org/)
- [Mockito vs EasyMock: When to Use Which](https://www.baeldung.com/mockito-vs-easymock)
- [Spring Boot Testing](https://docs.spring.io/spring-boot/reference/testing/index.html)

Happy Coding
