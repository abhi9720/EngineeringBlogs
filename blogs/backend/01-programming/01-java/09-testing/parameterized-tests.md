---
title: Parameterized Tests
description: >-
  Deep dive into JUnit 5 parameterized tests: @ValueSource, @CsvSource,
  @EnumSource, @MethodSource, and custom argument providers
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - junit
  - parameterized-tests
  - testing
  - java
coverImage: /images/parameterized-tests.png
draft: false
order: 20
---

# Parameterized Tests in JUnit 5

## Overview

Parameterized tests allow running the same test method with different arguments, eliminating code duplication and ensuring thorough coverage. JUnit 5 provides several built-in sources for test data, plus support for custom providers. This guide covers all annotation sources, argument conversion, and best practices.

---

## Dependency

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter-params</artifactId>
    <version>5.10.0</version>
    <scope>test</scope>
</dependency>
```

---

## @ValueSource

The simplest source for literal values:

```java
class ValueSourceExampleTest {

    @ParameterizedTest
    @ValueSource(strings = { "racecar", "radar", "level", "madam" })
    void palindromesAreRecognized(String candidate) {
        assertTrue(PalindromeChecker.isPalindrome(candidate));
    }

    @ParameterizedTest
    @ValueSource(ints = { 2, 4, 8, 16, 32 })
    void powersOfTwoAreEven(int number) {
        assertEquals(0, number % 2);
    }

    @ParameterizedTest
    @ValueSource(longs = { 1L, 2L, 3L })
    void positiveLongs(long value) {
        assertTrue(value > 0);
    }

    @ParameterizedTest
    @ValueSource(doubles = { 1.0, 2.5, 3.14 })
    void positiveDoubles(double value) {
        assertTrue(value > 0);
    }

    @ParameterizedTest
    @ValueSource(classes = { String.class, Integer.class, List.class })
    void testWithClasses(Class<?> clazz) {
        assertNotNull(clazz);
    }
}
```

---

## @NullSource and @EmptySource

```java
class NullAndEmptySourceExampleTest {

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = { "hello", "world" })
    void nullAndValidStrings(String value) {
        if (value == null) {
            assertThrows(IllegalArgumentException.class,
                () -> Validator.validate(value));
        } else {
            assertDoesNotThrow(() -> Validator.validate(value));
        }
    }

    @ParameterizedTest
    @EmptySource
    @ValueSource(strings = { " ", "\t", "\n" })
    void emptyAndBlankStrings(String value) {
        assertTrue(value.isBlank());
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = { "valid" })
    void nullEmptyAndValid(String value) {
        // Tests null, "", and "valid"
    }
}
```

---

## @EnumSource

```java
class EnumSourceExampleTest {

    enum OrderStatus {
        NEW, PROCESSING, SHIPPED, DELIVERED, CANCELLED
    }

    @ParameterizedTest
    @EnumSource(OrderStatus.class)
    void allStatusesAreValid(OrderStatus status) {
        assertNotNull(OrderValidator.validateStatus(status));
    }

    @ParameterizedTest
    @EnumSource(value = OrderStatus.class, 
                names = { "NEW", "PROCESSING" })
    void onlyActiveOrdersCanBeModified(OrderStatus status) {
        assertTrue(OrderService.canModify(status));
    }

    @ParameterizedTest
    @EnumSource(value = OrderStatus.class, 
                mode = EnumSource.Mode.EXCLUDE,
                names = { "CANCELLED", "DELIVERED" })
    void nonFinalStatuses(OrderStatus status) {
        assertFalse(OrderService.isFinalStatus(status));
    }

    @ParameterizedTest
    @EnumSource(value = OrderStatus.class,
                mode = EnumSource.Mode.MATCH_ALL,
                names = ".*ED")  // Ends with "ED"
    void statusesEndingWithED(OrderStatus status) {
        assertTrue(status.name().endsWith("ED"));
    }
}
```

---

## @CsvSource

```java
class CsvSourceExampleTest {

    @ParameterizedTest
    @CsvSource({
        "apple,    5,  25.00",
        "banana,   3,  9.00",
        "cherry,   10, 50.00"
    })
    void calculateItemTotal(String name, int quantity, double expectedTotal) {
        CartItem item = new CartItem(name, quantity, 5.00);
        assertEquals(expectedTotal, item.getTotal(), 0.001);
    }

    @ParameterizedTest
    @CsvSource(textBlock = """
        # Comment: username, email, role
        alice,  alice@example.com,  ADMIN
        bob,    bob@example.com,    USER
        charlie,charlie@example.com,MANAGER
    """)
    void createUserFromCsv(String username, String email, String role) {
        User user = new User(username, email, Role.valueOf(role));
        assertAll(
            () -> assertEquals(username, user.getUsername()),
            () -> assertEquals(email, user.getEmail()),
            () -> assertEquals(Role.valueOf(role), user.getRole())
        );
    }

    @ParameterizedTest
    @CsvSource(value = {
        "1,  'John, Doe',   john@example.com",
        "2,  'Smith, Jane', jane@example.com"
    }, delimiter = ',', quoteCharacter = '\'')
    void testWithQuotedCsv(long id, String name, String email) {
        assertNotNull(name);
        assertTrue(name.contains(", "));
    }

    @ParameterizedTest
    @CsvSource(value = {
        "100 | USD | 100.00",
        "50  | EUR | 55.00",
        "200 | GBP | 260.00"
    }, delimiter = '|')
    void testCurrencyConversion(double amount, String currency, double expected) {
        assertEquals(expected, converter.convert(amount, Currency.getInstance(currency)), 0.01);
    }
}
```

---

## @CsvFileSource

```java
class CsvFileSourceExampleTest {

    @ParameterizedTest
    @CsvFileSource(resources = "/test-data/users.csv", numLinesToSkip = 1)
    void loadUsersFromCsvFile(String username, String email, String role) {
        User user = new User(username, email, Role.valueOf(role));
        assertNotNull(user);
    }

    @ParameterizedTest
    @CsvFileSource(resources = "/test-data/orders.csv",
                   numLinesToSkip = 1,
                   delimiterString = "|")
    void loadOrdersFromPipeDelimitedFile(
            String orderId, String customer, double amount) {

        assertFalse(orderId.isEmpty());
        assertTrue(amount > 0);
    }
}
```

**users.csv**:
```csv
username,email,role
alice,alice@example.com,ADMIN
bob,bob@example.com,USER
charlie,charlie@example.com,MANAGER
```

---

## @MethodSource

The most flexible source—returns a stream of arguments:

```java
class MethodSourceExampleTest {

    @ParameterizedTest
    @MethodSource("provideStringsForPalindromeCheck")
    void testPalindrome(String input, boolean expected) {
        assertEquals(expected, PalindromeChecker.isPalindrome(input));
    }

    static Stream<Arguments> provideStringsForPalindromeCheck() {
        return Stream.of(
            Arguments.of("racecar", true),
            Arguments.of("radar", true),
            Arguments.of("hello", false),
            Arguments.of("A man a plan a canal Panama", true)
        );
    }

    @ParameterizedTest
    @MethodSource
    void testWithExternalMethodSource(String input) {
        assertFalse(input.isEmpty());
    }

    // Method name matches test name by convention
    static Stream<String> testWithExternalMethodSource() {
        return Stream.of("apple", "banana", "cherry");
    }

    @ParameterizedTest
    @MethodSource("com.example.TestDataProviders#provideOrders")
    void testOrderProcessing(Order order, boolean expectedValid) {
        assertEquals(expectedValid, OrderValidator.isValid(order));
    }
}

// External provider class
class TestDataProviders {

    static Stream<Arguments> provideOrders() {
        return Stream.of(
            Arguments.of(new Order("customer-1", List.of()), false),
            Arguments.of(new Order("customer-2", 
                List.of(new OrderItem("item-1", 1, 10.0))), true)
        );
    }
}
```

### Multiple Parameters with MethodSource

```java
@ParameterizedTest
@MethodSource("orderProvider")
void testOrderCalculation(String customerId, 
                           List<OrderItem> items, 
                           double expectedTotal,
                           boolean shouldSucceed) {
    if (shouldSucceed) {
        Order order = new Order(customerId, items);
        assertEquals(expectedTotal, order.calculateTotal(), 0.001);
    } else {
        assertThrows(IllegalArgumentException.class,
            () -> new Order(customerId, items));
    }
}

static Stream<Arguments> orderProvider() {
    return Stream.of(
        Arguments.of("cust-1", 
            List.of(new OrderItem("item-1", 2, 10.0)), 
            20.0, true),
        Arguments.of("", 
            List.of(new OrderItem("item-1", 1, 5.0)), 
            5.0, false),  // Empty customer ID
        Arguments.of("cust-2", 
            List.of(), 
            0.0, false)  // Empty order items
    );
}
```

---

## @ArgumentsSource (Custom Provider)

For complex or reusable argument providers:

```java
class ArgumentsSourceExampleTest {

    @ParameterizedTest
    @ArgumentsSource(UserArgumentProvider.class)
    void testUserValidation(User user, boolean isValid) {
        assertEquals(isValid, UserValidator.validate(user));
    }
}

class UserArgumentProvider implements ArgumentsProvider {

    @Override
    public Stream<? extends Arguments> provideArguments(
            ExtensionContext context) {

        return Stream.of(
            Arguments.of(
                new User("alice", "alice@example.com", "Valid1!"), true),
            Arguments.of(
                new User("bob", "invalid-email", "Valid1!"), false),
            Arguments.of(
                new User("charlie", "charlie@example.com", "short"), false)
        );
    }
}
```

### Parameterized Provider

```java
class CustomArgumentProviderExampleTest {

    @ParameterizedTest
    @ArgumentsSource(OrderStatusProvider.class)
    void testStatusTransition(OrderStatus from, 
                               OrderStatus to, 
                               boolean allowed) {

        assertEquals(allowed, OrderService.canTransition(from, to));
    }
}

class OrderStatusProvider implements ArgumentsProvider {

    @Override
    public Stream<? extends Arguments> provideArguments(
            ExtensionContext context) {

        return Stream.of(
            // NEW -> PROCESSING: allowed
            Arguments.of(OrderStatus.NEW, OrderStatus.PROCESSING, true),
            // NEW -> SHIPPED: NOT allowed (must go through PROCESSING)
            Arguments.of(OrderStatus.NEW, OrderStatus.SHIPPED, false),
            // PROCESSING -> SHIPPED: allowed
            Arguments.of(OrderStatus.PROCESSING, OrderStatus.SHIPPED, true),
            // SHIPPED -> DELIVERED: allowed
            Arguments.of(OrderStatus.SHIPPED, OrderStatus.DELIVERED, true),
            // CANNOT go back after shipped
            Arguments.of(OrderStatus.SHIPPED, OrderStatus.PROCESSING, false)
        );
    }
}
```

---

## Argument Conversion

JUnit 5 automatically converts strings to common types:

```java
class ArgumentConversionExampleTest {

    // Explicit conversion
    @ParameterizedTest
    @ValueSource(strings = { "42", "100", "255" })
    void testWithIntConversion(@ConvertWith(IntConverter.class) int value) {
        assertTrue(value > 0);
    }

    // Implicit conversion (built-in)
    @ParameterizedTest
    @ValueSource(strings = {
        "java.time.LocalDate@2024-01-15",
        "java.time.LocalDate@2024-06-30"
    })
    void testWithImplicitConversion(LocalDate date) {
        assertNotNull(date);
    }

    // Custom converter
    @ParameterizedTest
    @ValueSource(strings = { "ADMIN", "USER" })
    void testEnumConversion(Role role) {
        assertNotNull(role);
    }
}

class IntConverter extends SimpleArgumentConverter {

    @Override
    protected Object convert(Object source, Class<?> targetType) {
        assertEquals(Integer.class, targetType);
        return Integer.parseInt((String) source);
    }
}
```

---

## Custom Display Names

```java
class DisplayNameExampleTest {

    @ParameterizedTest(name = "Test #{index}: {0} + {1} = {2}")
    @CsvSource({
        "1, 1, 2",
        "2, 3, 5",
        "5, 5, 10"
    })
    void testAddition(int a, int b, int expected) {
        assertEquals(expected, a + b);
    }

    @ParameterizedTest(name = "{arguments} should be positive")
    @ValueSource(ints = { 1, 2, 3 })
    void positiveNumbers(int number) {
        assertTrue(number > 0);
    }

    @ParameterizedTest(name = "{index}. User: {0}, Role: {1}")
    @CsvSource({
        "alice, ADMIN",
        "bob, USER"
    })
    void testUserRoles(String username, String role) {
        // Custom display shows index, username, and role
    }
}
```

---

## Aggregation (Multiple Fields to Object)

```java
class AggregationExampleTest {

    @ParameterizedTest
    @CsvSource({
        "alice, ADMIN,  alice@example.com",
        "bob,   USER,  bob@example.com"
    })
    void testUserAggregation(@AggregateWith(UserAggregator.class) User user) {
        assertNotNull(user.getUsername());
        assertNotNull(user.getEmail());
    }
}

class UserAggregator implements ArgumentsAggregator {

    @Override
    public Object aggregateArguments(ArgumentsAccessor accessor,
                                      ParameterContext context) {
        return new User(
            accessor.getString(0),  // username
            accessor.getString(1),  // email
            Role.valueOf(accessor.getString(2))  // role
        );
    }
}
```

---

## Common Mistakes

### Mistake 1: Too Many Test Cases

```java
// WRONG: Testing edge cases that add no value
@ParameterizedTest
@ValueSource(ints = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 })
void testPositiveIntegers(int n) {
    assertTrue(n > 0);
}

// CORRECT: Test boundary values and representative cases
@ParameterizedTest
@ValueSource(ints = { Integer.MIN_VALUE, -1, 0, 1, Integer.MAX_VALUE })
void testBoundaries(int n) {
    // More meaningful
}
```

### Mistake 2: Non-Descriptive Display Names

```java
// WRONG: Default display name shows no context
@ParameterizedTest
@CsvSource({ "a,1", "b,2" })
void test(String s, int n) { }

// CORRECT: Descriptive template
@ParameterizedTest(name = "Item {0} has quantity {1}")
@CsvSource({ "Apple,1", "Banana,2" })
void testItemQuantity(String item, int quantity) { }
```

---

## Summary

JUnit 5 parameterized tests reduce code duplication and improve coverage. Use @ValueSource for simple literals, @CsvSource for tabular data, @EnumSource for enum iteration, @MethodSource for dynamic/complex data, and @ArgumentsSource for reusable providers. Always use descriptive display names and keep test data focused on meaningful cases.

---

## References

- [JUnit 5 Parameterized Tests](https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests)
- [Baeldung - Parameterized Tests in JUnit 5](https://www.baeldung.com/parameterized-tests-junit-5)
- [JUnit 5 Argument Providers](https://junit.org/junit5/docs/current/api/org.junit.jupiter.params/org/junit/jupiter/params/provider/ArgumentsProvider.html)

Happy Coding
