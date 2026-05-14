---
title: "Flaky Test Management"
description: "Detecting, diagnosing, and fixing flaky tests: common causes, quarantine strategies, and automated detection"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - flaky-tests
  - testing
  - quality
  - automation
coverImage: "/images/flaky-test-management.png"
draft: false
---

# Flaky Test Management

## Overview

Flaky tests are tests that non-deterministically pass and fail without code changes. They erode trust in the test suite, hide real bugs, and slow down development. Studies show that flaky tests account for 16-73% of test failures in large projects. This guide covers common causes, detection strategies, quarantine processes, and systematic fixes.

---

## The Problem

```
Commit A: All tests pass ✓
Commit B (no code change): Test XYZ fails ✗ → Re-run → Passes ✓
Commit C: Test XYZ fails again ✗ → "Must be flaky" → Ignore
```

Flaky tests lead to:
- **Ignored failures**: Developers stop trusting test results
- **Slower CI**: Retries waste time and resources
- **Real bugs missed**: Buried under noise from flaky tests
- **Reduced confidence**: Teams bypass quality gates

---

## Common Causes

### 1. Timing and Race Conditions

```java
// FLAKY: Depends on thread scheduling
@Test
void testAsyncOperation() {
    CompletableFuture<String> future = asyncService.processAsync();
    // Thread might not have completed yet
    assertTrue(future.isDone());  // Sometimes fails!
}

// FIXED: Use awaitility for async assertions
@Test
void testAsyncOperation() {
    await().atMost(5, TimeUnit.SECONDS)
        .until(() -> asyncService.processAsync().isDone());
    
    String result = asyncService.processAsync().get();
    assertEquals("completed", result);
}
```

### 2. Shared Mutable State

```java
// FLAKY: Tests modify shared static state
class SharedStateTest {

    private static int counter = 0;  // Shared across tests!

    @Test
    void testIncrement() {
        assertEquals(0, counter);  // Fails if run after other tests
        counter++;
    }

    @Test
    void testDecrement() {
        assertEquals(0, counter);  // Depends on test execution order!
        counter--;
    }
}

// FIXED: No shared mutable state
class IsolatedStateTest {

    private int counter;  // Fresh instance per test

    @BeforeEach
    void setup() {
        counter = 0;
    }

    @Test
    void testIncrement() {
        assertEquals(0, counter);
    }
}
```

### 3. External Service Dependencies

```java
// FLAKY: Depends on external service availability
@Test
void testExternalApi() {
    ResponseEntity<String> response = restTemplate
        .getForEntity("https://api.external.com/data", String.class);
    
    assertEquals(200, response.getStatusCodeValue());  // Fails if external service is down!
}

// FIXED: Mock external dependencies
@Test
void testExternalApi() {
    mockServer.expect(requestTo("https://api.external.com/data"))
        .andRespond(withSuccess("{\"data\": \"value\"}", MediaType.APPLICATION_JSON));
    
    ResponseEntity<String> response = restTemplate
        .getForEntity("https://api.external.com/data", String.class);
    
    assertEquals(200, response.getStatusCodeValue());
}
```

### 4. Non-Deterministic Data

```java
// FLAKY: Tests depend on current time or random values
@Test
void testTimestamp() {
    Order order = orderService.createOrder();
    
    // Depending on timing, this might fail
    assertEquals(LocalDate.now(), order.getCreatedDate());
}

// FIXED: Use fixed clock
@Test
void testTimestamp() {
    Clock fixedClock = Clock.fixed(
        Instant.parse("2026-05-11T10:00:00Z"), ZoneOffset.UTC
    );
    orderService.setClock(fixedClock);
    
    Order order = orderService.createOrder();
    
    assertEquals(LocalDate.of(2026, 5, 11), order.getCreatedDate());
}
```

### 5. Unordered Collections

```java
// FLAKY: Hash-based collections have no guaranteed order
@Test
void testUserList() {
    List<User> users = userService.getUsers();
    
    assertEquals("alice", users.get(0).getUsername());  // Order not guaranteed!
}

// FIXED: Don't depend on order, or use ordered collections
@Test
void testUserList() {
    List<User> users = userService.getUsersSorted();
    
    assertEquals("alice", users.get(0).getUsername());  // Now deterministic
}
```

---

## Detection Strategies

### 1. Repeated Execution

```java
// Run test N times to detect flakiness
@RepeatedTest(100)
void detectFlakiness() {
    assertDoesNotThrow(() -> potentiallyFlakyMethod());
}
```

### 2. CI-Based Detection

```yaml
name: Flaky Test Detector

jobs:
  detect-flaky:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests 10 times
        run: |
          for i in $(seq 1 10); do
            echo "=== Run $i ==="
            mvn test -Dtest="SuspectedFlakyTest" \
              -Dmaven.test.failure.ignore=true \
              -q 2>/dev/null
          done
      - name: Check for flakiness
        run: |
          FLAKY=$(grep -l "FAILURE" target/surefire-reports/*.xml | wc -l)
          if [ "$FLAKY" -gt 0 ] && [ "$FLAKY" -lt 10 ]; then
            echo "FLAKY TEST DETECTED!"
            echo "Passed: $((10 - FLAKY))/10 runs"
          fi
```

### 3. Historical Analysis

```java
public class FlakyTestAnalyzer {

    private final TestResultRepository resultRepository;

    public List<FlakyTest> findFlakyTests(int lookbackDays) {
        Map<String, List<TestResult>> results = resultRepository
            .findTestsRunInLastDays(lookbackDays);

        return results.entrySet().stream()
            .filter(entry -> isFlaky(entry.getValue()))
            .map(entry -> new FlakyTest(
                entry.getKey(),
                entry.getValue(),
                calculateFlakinessScore(entry.getValue())
            ))
            .sorted(Comparator.comparing(FlakyTest::score).reversed())
            .toList();
    }

    private boolean isFlaky(List<TestResult> results) {
        if (results.size() < 10) return false;

        // Flaky = passed at least once AND failed at least once
        long passed = results.stream().filter(TestResult::passed).count();
        long failed = results.stream().filter(r -> !r.passed()).count();

        return passed > 0 && failed > 0;
    }

    private double calculateFlakinessScore(List<TestResult> results) {
        long total = results.size();
        long passed = results.stream().filter(TestResult::passed).count();

        // Score closer to 0.5 = more flaky
        // Score closer to 0 or 1 = more deterministic
        return Math.abs(0.5 - (double) passed / total);
    }
}

record FlakyTest(String name, List<TestResult> results, double score) {}
```

---

## Quarantine Process

### Auto-Quarantine in CI

```yaml
name: Test Quarantine Process

jobs:
  test:
    steps:
      - run: mvn test
        continue-on-error: true
      
      - name: Analyze failures
        run: |
          # Check if failures are known flaky tests
          java -jar flaky-detector.jar \
            --reports target/surefire-reports/ \
            --quarantine-file flaky-tests.txt
      
      - name: Quarantine flaky tests
        if: failure()
        run: |
          FAILED=$(grep -l "FAILURE" target/surefire-reports/*.xml)
          for f in $FAILED; do
            TEST_NAME=$(basename $f .xml)
            # Check if already quarantined
            if ! grep -q "$TEST_NAME" flaky-tests.txt; then
              echo "$TEST_NAME" >> flaky-tests.txt
              echo "Quarantined: $TEST_NAME"
            fi
          done
```

### Exclude Quarantined Tests

```xml
<!-- Surefire configuration to exclude known flaky tests -->
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-surefire-plugin</artifactId>
    <configuration>
        <excludes>
            <!-- Read from quarantined list -->
            <exclude>com/example/flaky/*Test.java</exclude>
        </excludes>
    </configuration>
</plugin>
```

### Quarantine Notification

```java
@Component
public class FlakyTestNotifier {

    @Scheduled(cron = "0 0 9 * * MON")  // Every Monday
    public void notifyFlakyTests() {
        List<FlakyTest> flaky = analyzer.findFlakyTests(14);  // Last 2 weeks

        if (!flaky.isEmpty()) {
            StringBuilder message = new StringBuilder();
            message.append(":warning: **Flaky Tests Detected**\n\n");
            message.append("| Test | Score | Pass Rate |\n");
            message.append("|------|-------|-----------|\n");

            for (FlakyTest test : flaky) {
                message.append(String.format("| %s | %.2f | %d/%d |\n",
                    test.name(),
                    test.score(),
                    test.results().stream().filter(TestResult::passed).count(),
                    test.results().size()
                ));
            }

            message.append("\n**Action required:** Investigate and fix or quarantine.\n");
            slackNotifier.send(message.toString());
        }
    }
}
```

---

## Systematic Fixes

### Fix Checklist

```java
public class FlakyTestFixer {

    public FixPlan analyze(FlakyTest test) {
        // 1. Check for timing issues
        if (hasAwaitility(test)) return new FixPlan("USE_AWAITILITY");
        if (hasThreadSleep(test)) return new FixPlan("REMOVE_THREAD_SLEEP");

        // 2. Check shared state
        if (usesStaticState(test)) return new FixPlan("REMOVE_STATIC_STATE");
        if (usesSharedDatabase(test)) return new FixPlan("ISOLATE_DATABASE");

        // 3. Check external dependencies
        if (callsExternalService(test)) return new FixPlan("MOCK_EXTERNAL");

        // 4. Check non-determinism
        if (usesCurrentTime(test)) return new FixPlan("INJECT_CLOCK");
        if (usesRandom(test)) return new FixPlan("SEED_RANDOM");
        if (usesUnorderedCollections(test)) return new FixPlan("ORDERED_COLLECTION");

        // 5. Check test environment
        if (dependsOnTestOrder(test)) return new FixPlan("NOT_REORDER_TESTS");
        if (leavesStateBehind(test)) return new FixPlan("CLEANUP_STATE");

        return new FixPlan("MANUAL_INVESTIGATION");
    }

    private boolean hasAwaitility(FlakyTest test) {
        return test.source().contains("Thread.sleep");
    }

    private boolean hasThreadSleep(FlakyTest test) {
        return test.source().contains("Thread.sleep");
    }
}
```

### Common Fixes

| Issue | Fix | Example |
|-------|-----|---------|
| Thread.sleep() | Use Awaitility | `await().atMost(5, SECONDS)` |
| Shared static | Remove static state | Use instance fields |
| No cleanup | @AfterEach cleanup | `@AfterEach void cleanup()` |
| System.currentTimeMillis() | Inject Clock | `Clock.fixed()` |
| Math.random() | Use seeded Random | `new Random(42)` |
| External API | Mock | `@MockBean` |
| Unordered collections | Use TreeSet/LinkedList | `Collections.sort()` |
| Database order | Add ORDER BY | `@Query("... ORDER BY id")` |

---

## Metrics and Monitoring

```java
@Component
public class FlakyTestMetrics {

    private final MeterRegistry meterRegistry;

    @EventListener
    public void onTestFailure(TestExecutionEvent event) {
        if (isFlaky(event.getTestName())) {
            meterRegistry.counter("tests.flaky.failures",
                "test", event.getTestName(),
                "module", event.getModule()
            ).increment();
        }
    }

    @Scheduled(cron = "0 0 0 * * *")  // Daily
    public void reportFlakyMetrics() {
        double flakyRate = meterRegistry.counter("tests.flaky.failures").count()
            / meterRegistry.counter("tests.total").count();

        if (flakyRate > 0.05) {  // >5% flaky rate alert
            alertService.sendAlert(
                "Flaky test rate is %.2f%%. Target: <5%%".formatted(flakyRate * 100)
            );
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Ignoring Flaky Tests

```java
// WRONG: Just re-run until it passes
for (int i = 0; i < 5; i++) {
    try { runTest(); break; }
    catch (Exception e) { log.warn("Retrying flaky test..."); }
}

// CORRECT: Investigate and fix the root cause
// Never mask flaky tests with retries without investigation
```

### Mistake 2: Adding Flaky Tests to CI Allowlist

```yaml
# WRONG: Masking test failures
- run: mvn test || true  # Ignores all failures
- run: mvn test -Dmaven.test.failure.ignore=true  # Same

# CORRECT: Quarantine properly with notification
```

### Mistake 3: Not Cleaning Up Test Data

```java
// WRONG: Test data persists
@Test void test1() {
    repository.save(new User("user1"));
}
@Test void test2() {
    // May see user1 from previous test
    assertEquals(1, repository.count());
}

// CORRECT: Clean up
@AfterEach void cleanup() {
    repository.deleteAll();
}
```

---

## Summary

Flaky tests are a quality debt that must be actively managed. Detect flakiness through repeated execution and historical analysis. Quarantine flaky tests to prevent CI noise. Fix systematically by addressing timing issues, shared state, external dependencies, and non-determinism. Monitor flaky test rates and enforce SLAs to keep the test suite reliable.

---

## References

- [Google - Flaky Test Management](https://testing.googleblog.com/search/label/Flaky%20Tests)
- [Microsoft - Flaky Test Detection](https://docs.microsoft.com/en-us/azure/devops/learn/devops-at-microsoft/flaky-test-management)
- [JDK Project - Flaky Test Detector](https://openjdk.org/projects/flaky-test-detector/)
- [Flaky Tests at Netflix](https://netflixtechblog.com/flaky-tests-at-netflix-7e0a5a2a8f0b)

Happy Coding