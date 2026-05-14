---
title: Java Interview Questions and Answers
description: >-
  Curated Java interview questions covering core Java, concurrency, collections,
  JVM, memory management, and design patterns for senior engineering roles
date: '2026-05-14'
author: Abhishek Tiwari
tags:
  - java
  - interview
  - preparation
  - senior-engineer
coverImage: /images/java-interview.png
draft: false
order: 10
---
# Java Interview Questions and Answers

## Overview

This guide covers 20 Java interview questions organized by topic. Each question includes what the interviewer is actually testing, why it matters in production, and a detailed answer. These are the questions senior engineers at top tech companies ask.

---

## Core Java

### 1. String Pool and String Immutability

**Question**: Explain the String Pool. Why are Strings immutable in Java?

**Why this matters in production**: String deduplication via the pool saves memory — a typical web app has millions of Strings. Immutability makes Strings safe for HashMap keys, caching, and multi-threading. If Strings were mutable, a key's hashCode could change after being inserted into a HashMap, making it permanently lost.

**Answer**:

```java
String s1 = "hello";          // String literal → String Pool
String s2 = "hello";          // Same reference from pool
String s3 = new String("hello"); // Heap object (avoid this)
String s4 = s3.intern();       // Returns pool reference

System.out.println(s1 == s2);  // true (same pool reference)
System.out.println(s1 == s3);  // false (heap vs pool)
System.out.println(s1 == s4);  // true (interned)
```

The String Pool lives in the heap (moved from PermGen in Java 7). When you use a literal, JVM checks the pool. If present, reuses reference. `new String("hello")` bypasses the pool — always creates a new heap object.

**Immutability benefits**:
- **Caching**: String hashCode is cached on first computation (the `hash` field). Immutability guarantees the hash never changes.
- **Security**: Class loading, network connections, file paths all use Strings. Mutation would create security holes.
- **Thread safety**: Immutable = inherently thread-safe. No synchronization needed.
- **String Pool**: Only possible because Strings can't be mutated — otherwise one reference's change would affect all.

### 2. equals() and hashCode() Contract

**Question**: What is the contract between `equals()` and `hashCode()`? What happens if you violate it?

**Why this matters in production**: Every HashMap, HashSet, and HashTable depends on this contract. Violating it causes "missing" entries — the collection appears to not contain objects you know you inserted. This is a notoriously hard bug to debug.

**Answer**:

The contract (from `Object` javadoc):
1. If `a.equals(b)` then `a.hashCode() == b.hashCode()` (must)
2. If `a.hashCode() == b.hashCode()`, `a.equals(b)` may be true or false (not required)
3. `hashCode()` must be consistent across invocations on the same object (no field changes)

```java
// Correct implementation
public record User(String email, String name) {
    // Records automatically generate equals() and hashCode()
    // based on ALL components — the safest approach
}

// Manual approach — what records do for you
public class User {
    private final String email;
    private final String name;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User other)) return false;
        return email.equals(other.email) && name.equals(other.name);
    }

    @Override
    public int hashCode() {
        return Objects.hash(email, name);
    }
}
```

**Violation consequences**: Insert `User("a@x.com", "Alice")` into a HashSet. Later modify `name`. The hash code changes, but the bucket index doesn't recompute. Now `contains()` checks the wrong bucket. The object is "lost" in the set — allocated but unreachable by normal means. This is a memory leak.

### 3. try-with-resources

**Question**: How does try-with-resources work? What interface must a resource implement?

**Why this matters in production**: Resource leaks (unclosed DB connections, file handles, sockets) are the #1 cause of connection pool exhaustion in production. try-with-resources makes correct cleanup automatic.

**Answer**:

```java
// Before Java 7 — error-prone
BufferedReader br = null;
try {
    br = new BufferedReader(new FileReader("file.txt"));
    return br.readLine();
} finally {
    if (br != null) br.close(); // What if close() also throws?
}

// Java 7+ — safe and clean
try (var reader = new BufferedReader(new FileReader("file.txt"))) {
    return reader.readLine();
}
// reader.close() called automatically, even if exceptions occur
```

Resources must implement `AutoCloseable` (single `close()` throws `Exception`) or `Closeable` (`close()` throws `IOException`).

**Suppressed exceptions**: If both the try block and `close()` throw, the try exception is propagated and the `close()` exception is attached as "suppressed" — available via `Throwable.getSuppressed()`. Before try-with-resources, the second exception would silently replace the first.

### 4. Marker Interfaces

**Question**: What are marker interfaces? Is `Serializable` still relevant in modern Java?

**Why this matters in production**: Serialization attacks (deserialization of crafted byte streams) are a real OWASP vulnerability. Understanding marker interfaces helps you make security-conscious decisions.

**Answer**:

Marker interfaces are interfaces with no methods — they signal metadata to the JVM or frameworks. Examples:
- `Serializable`: JVM allows serialization/deserialization
- `Cloneable`: JVM allows `Object.clone()` without throwing `CloneNotSupportedException`
- `Remote`: RMI remote objects

```java
public class Order implements Serializable {
    private static final long serialVersionUID = 1L;
    private String id;
    private transient BigDecimal amount; // Not serialized
}
```

**Production reality**: Avoid Java serialization. Use JSON (Jackson, Gson), Protocol Buffers, or Avro. Java serialization is slow, fragile (serialVersionUID mismatch), and insecure (deserialization gadgets like `InvokerTransformer` in Commons Collections).

`Serializable` as a marker is essentially legacy. Annotations, records, and external serialization formats have replaced the pattern.

---

## OOP and Design

### 5. SOLID Principles

**Question**: Explain the SOLID principles with Java examples. Which one is most violated in production code?

**Why this matters in production**: SOLID violations directly lead to the maintenance nightmare where changing one thing breaks three unrelated things. The Open/Closed Principle violation is the most common.

**Answer**:

**Single Responsibility**: A class should have one reason to change.

```java
// Violation: OrderService handles persistence, email, and logging
class OrderService {
    void process(Order o) {
        save(o);          // Persistence responsibility
        sendEmail(o);     // Notification responsibility
        log(o);           // Logging responsibility
    }
}

// Fixed: Separate concerns
class OrderService {
    private final OrderRepository repo;
    private final NotificationService notifier;
    private final AuditService auditor;

    void process(Order o) {
        repo.save(o);
        notifier.sendConfirmation(o);
        auditor.log("order_processed", o.id());
    }
}
```

**Open/Closed**: Open for extension, closed for modification.

```java
// Violation: Adding a new payment type requires modifying this method
void processPayment(String type) {
    if (type.equals("CREDIT_CARD")) { ... }
    else if (type.equals("UPI")) { ... }
    // Every new type = new else-if
}

// Fixed: Strategy pattern with sealed interface
sealed interface PaymentStrategy permits CreditCard, UPI, Wallet {}
record CreditCard(String number) implements PaymentStrategy {
    void pay(BigDecimal amount) { ... }
}
record UPI(String vpa) implements PaymentStrategy {
    void pay(BigDecimal amount) { ... }
}
```

**Liskov Substitution**: Subtypes must be substitutable for their base types. Classic violation: `Rectangle` → `Square`.

**Interface Segregation**: Don't force clients to depend on methods they don't use. Split large interfaces into smaller ones.

**Dependency Inversion**: Depend on abstractions, not concretions. This is the "D" in Dependency Injection.

### 6. Composition vs Inheritance

**Question**: When do you choose composition over inheritance? Give a real example.

**Why this matters in production**: Inheritance creates tight coupling. A change in the parent class can break all subclasses — the fragile base class problem. This is a top-3 source of cascading production bugs.

**Answer**:

```java
// Inheritance — fragile
class Bird {
    void fly() { System.out.println("flying"); }
}
class Penguin extends Bird {
    @Override
    void fly() { throw new UnsupportedOperationException(); }
}
// Penguin breaks LSP! Not all birds fly.

// Composition — flexible
interface FlyBehavior { void fly(); }
class CanFly implements FlyBehavior {
    public void fly() { System.out.println("flying"); }
}
class CannotFly implements FlyBehavior {
    public void fly() { /* no-op */ }
}

class Bird {
    private final FlyBehavior flyBehavior;
    Bird(FlyBehavior fb) { this.flyBehavior = fb; }
    void fly() { flyBehavior.fly(); }
}
```

**Rule of thumb**: Use inheritance for "is-a" relationships where the subclass IS a true specialization (no behavior is inappropriate). Use composition for "has-a" or "uses-a" relationships. In practice, prefer composition unless you have a clear is-a hierarchy with no behavioral overrides that break LSP.

---

## Collections

### 7. HashMap Internal Working

**Question**: Explain how HashMap works internally. What happens during a collision? When does treeification happen?

**Why this matters in production**: Each year, teams ship production bugs caused by `HashMap` misuse — usually concurrency or poor hashCode. Understanding internals prevents O(n) degradation and data loss.

**Answer**:

```java
Map<String, Order> map = new HashMap<>();
map.put("ORD-001", order);
```

1. **hashCode()**: `"ORD-001".hashCode()` → int (e.g., 12345678).
2. **Bit spread**: `h = key.hashCode() ^ (h >>> 16)` — shifts high bits to lower bits for better distribution.
3. **Bucket index**: `index = (n - 1) & hash` where `n` is array size (power of 2). `n-1` is all 1s in binary → modulo via bitwise AND.
4. **Insertion**: If bucket is empty, create `Node`. If occupied, check `equals()` — if same key, replace value. If different (collision), append to list or tree.
5. **Treeification**: When a bucket has ≥ 8 nodes AND total array ≥ 64, the list converts to a Red-Black tree (O(log n) instead of O(n)).
6. **Resizing**: When `size > capacity * loadFactor` (default 0.75), array doubles to 2x. All entries rehash (stay or move by oldCap).

**Why load factor 0.75?** Space-time tradeoff. Lower (0.5) = fewer collisions but more memory. Higher (0.9) = less memory but more collisions. 0.75 is empirically optimal.

### 8. ConcurrentHashMap Internals

**Question**: How does ConcurrentHashMap achieve thread safety without locking every read?

**Why this matters in production**: `Collections.synchronizedMap()` serializes all access, killing throughput. `ConcurrentHashMap` is the standard for multi-threaded maps in production.

**Answer**:

**Java 7**: Segmented lock — 16 segments, each independently locked. Reads are lock-free for most segments. Writes lock only the affected segment.

**Java 8+**: Finer granularity. No segments. Uses:
- **volatile reads**: `get()` reads the value from a `volatile` variable — no lock.
- **CAS (Compare-And-Swap)**: For atomic operations like `putIfAbsent`.
- **synchronized on individual bins**: Only locks the specific bucket during writes.

```java
// Lock-free read
public V get(Object key) {
    Node<K,V>[] tab; Node<K,V> e, p;
    int n, eh; K ek;
    int h = spread(key.hashCode());
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (e = tabAt(tab, (n - 1) & h)) != null) {
        if ((eh = e.hash) == h) {
            if ((ek = e.key) == key || (ek != null && key.equals(ek)))
                return e.val; // volatile read
        }
    }
    return null;
}
```

**Key methods for atomicity**:
- `computeIfAbsent(key, fn)`: Atomically compute and insert if absent. Avoids double-check pattern.
- `merge(key, value, remappingFunction)`: Atomically merge values.
- `replace(key, oldValue, newValue)`: CAS-style conditional update.

### 9. Comparable vs Comparator

**Question**: When would you implement Comparable vs provide a Comparator?

**Why this matters in production**: Natural ordering (Comparable) vs situational ordering (Comparator). Using the wrong one means either polluting your domain class with sorting logic or writing duplicate comparators.

**Answer**:

```java
// Comparable: Natural ordering — "this object's default sort order"
public class Order implements Comparable<Order> {
    private final Instant createdAt;

    @Override
    public int compareTo(Order other) {
        return this.createdAt.compareTo(other.createdAt);
    }
}
// Now Collections.sort(orders) works automatically

// Comparator: Situational ordering — external sorting strategy
Comparator<Order> byAmount = Comparator
    .comparing(Order::amount)
    .reversed();

Comparator<Order> byStatusThenDate = Comparator
    .comparing(Order::status)
    .thenComparing(Order::createdAt);

// Usage
orders.sort(byAmount);
TreeSet<Order> sorted = new TreeSet<>(byStatusThenDate);
```

**When to use Comparable**: The class has an obvious natural ordering (dates, IDs, alphabetical names). Violates Open/Closed if you need different orderings later.

**When to use Comparator**: Multiple ordering requirements exist. External strategy — doesn't modify the class. Prefer Comparator in most cases.

---

## Concurrency

### 10. synchronized vs Lock

**Question**: Compare `synchronized` blocks vs `java.util.concurrent.locks.Lock`. When is Lock preferable?

**Why this matters in production**: Using `synchronized` everywhere is safe but limits throughput in read-heavy scenarios. Choosing the wrong lock mechanism causes unnecessary contention.

**Answer**:

```java
// synchronized — simple, automatic, but limited
public synchronized Data getData() { return data; }

// Lock — flexible, manual
Lock lock = new ReentrantLock();
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

| Feature | synchronized | Lock |
|---------|-------------|------|
| Syntax | Block/method | Explicit lock/unlock |
| Unlock | Automatic | Must be in finally |
| tryLock | Not available | Yes (non-blocking attempt) |
| Fairness | Not fair | Configurable |
| Interruptible | No | lockInterruptibly() |
| Condition | wait/notify | Condition.await/signal |
| Read/Write split | Not possible | ReadWriteLock, StampedLock |
| Performance | Optimized (biased locks) | Similar today |

**When Lock is preferable**:
- Need `tryLock()` with timeout (prevent deadlock)
- Need interruptible locking
- Need ReadWriteLock for read-heavy workloads
- Multiple condition queues per lock

**When synchronized is fine**:
- Simple mutual exclusion
- Short critical sections
- Legacy code, simpler readability

### 11. volatile Keyword

**Question**: What does volatile guarantee? What doesn't it guarantee?

**Why this matters in production**: Volatile misuse is common. Engineers use it for compound actions (`count++`) expecting atomicity, then wonder why counts are wrong at high concurrency.

**Answer**:

`volatile` guarantees:
- **Visibility**: Any thread reading a volatile field always sees the latest write by any thread.
- **Ordering**: Compiler/JVM cannot reorder volatile accesses with other volatile accesses.

`volatile` does NOT guarantee:
- **Atomicity**: `volatile int count; count++` is NOT atomic. It's a read-modify-write. Two threads can interleave.

```java
// Broken — volatile doesn't make this safe
volatile int counter = 0;

// Thread A:                Thread B:
// read counter (0)         read counter (0)
// increment (1)            increment (1)
// write counter (1)        write counter (1)
// Result: 1, expected 2

// Fix 1: synchronized
synchronized void increment() { counter++; }

// Fix 2: AtomicInteger
AtomicInteger counter = new AtomicInteger(0);
counter.incrementAndGet(); // CAS-based, no lock
```

**When to use volatile**: Status flags (`running = false`), double-checked locking (the instance field), completion markers. Not for counters or accumulators.

### 12. Thread Pool Sizing

**Question**: How do you calculate the optimal thread pool size for a service?

**Why this matters in production**: Wrong sizing causes either CPU underutilization (too few threads) or thrashing (too many threads = context switching overhead).

**Answer**:

```
For CPU-bound:
  threads = N_CPU + 1

For I/O-bound:
  threads = N_CPU * (1 + wait_time / service_time)
```

```java
int cores = Runtime.getRuntime().availableProcessors();

// CPU-bound: image processing, encryption
int cpuThreads = cores + 1;

// I/O-bound: HTTP calls, DB queries
// If each request is 10ms CPU + 90ms I/O:
int ioThreads = cores * (1 + 90 / 10); // 10x cores
```

**Production nuances**:
- Measure, don't calculate. Use metrics (P99 latency, CPU utilization) to tune.
- Add a bounded queue. Unbounded queues hide backpressure until OOM.
- Platform threads (1:1 OS): ~1000 threads max. Virtual threads (Java 21+): millions.
- For virtual threads, `Executors.newVirtualThreadPerTaskExecutor()` — no pool sizing needed.

### 13. CompletableFuture

**Question**: How does `CompletableFuture` differ from a regular `Future`? Give a real async pipeline example.

**Why this matters in production**: Regular `Future.get()` blocks. In a reactive/async architecture, blocking kills throughput. CompletableFuture chains operations without blocking.

**Answer**:

```java
// Future — blocks
Future<Payment> future = executor.submit(callable);
Payment result = future.get(); // Blocks this thread!

// CompletableFuture — non-blocking chain
CompletableFuture
    .supplyAsync(() -> paymentGateway.charge(order))
    .thenApply(result -> enrichWithFraudCheck(result))
    .thenAccept(finalResult -> notifyUser(finalResult))
    .exceptionally(ex -> {
        log.error("Payment failed", ex);
        return fallbackResult;
    });
```

**Key methods**:
- `supplyAsync()`: Runs in common ForkJoinPool (or custom executor)
- `thenApply()`: Transform result (sync)
- `thenCompose()`: Chain another async operation (flatten)
- `thenCombine()`: Merge two independent futures
- `allOf()`: Wait for all (returns `CompletableFuture<Void>`)
- `anyOf()`: First completion wins
- `exceptionally()`: Recover from error
- `completeOnTimeout()`: Default value if slow

```java
// Realistic e-commerce pipeline
CompletableFuture<OrderConfirmation> pipeline =
    CompletableFuture.supplyAsync(() -> validate(request))
        .thenCompose(validated ->
            CompletableFuture.supplyAsync(() -> inventoryService.reserve(validated)))
        .thenCombine(
            CompletableFuture.supplyAsync(() -> paymentService.charge(request)),
            (reserved, payment) -> shippingService.schedule(reserved, payment)
        )
        .thenApply(shipment -> new OrderConfirmation(request.orderId(), "OK"))
        .exceptionally(ex -> {
            log.error("Order {} failed", request.orderId(), ex);
            return new OrderConfirmation(request.orderId(), "FAILED");
        })
        .orTimeout(5, TimeUnit.SECONDS) // Global timeout
        .handle((result, ex) -> {       // Always called (success or failure)
            auditService.log(request.orderId(), result);
            return result;
        });
```

---

## JVM and Memory

### 14. JVM Classloading

**Question**: Explain the classloading mechanism in JVM. What is a classloader leak?

**Why this matters in production**: Classloader leaks are the #1 cause of Metaspace `OutOfMemoryError` during redeploys in application servers and Spring Boot devtools.

**Answer**:

Three built-in classloaders:
1. **Bootstrap**: Loads `rt.jar`, `java.*` classes. Written in native code. No parent.
2. **Extension/Platform**: Loads `jre/lib/ext/*`. Parent: Bootstrap.
3. **Application/System**: Loads classpath. Parent: Extension.

**Delegation model**: A classloader asks its parent before loading. This prevents loading duplicate standard library classes. If parent can't find, current loader tries.

```java
// Application ClassLoader → Extension → Bootstrap
// If Bootstrap doesn't find → Extension tries
// If Extension doesn't find → Application tries
```

**Classloader leak**: When a webapp is redeployed, the old classloader should be GC'd. But if some long-lived object (cache in a shared classloader) holds a reference to a class loaded by the old webapp's classloader, the entire classloader + all its classes remain in Metaspace forever.

```java
// This creates a classloader leak
static Map<String, Object> CACHE = new HashMap<>();

// Inside webapp
CACHE.put("bean", new SomeWebAppClass()); // Holds reference to webapp's classloader
// After redeploy: webapp's classloader can't be GC'd
// → Metaspace grows with each redeploy
```

**Fix**: Never store webapp-specific objects in static collections owned by shared classloaders. Use weak references or clear caches on shutdown.

### 15. Garbage Collection Tuning

**Question**: How would you tune GC for a low-latency trading system vs a batch analytics pipeline?

**Why this matters in production**: Wrong GC = multi-second pauses during peak traffic. Financial systems require <10ms pauses. Analytics systems care about throughput.

**Answer**:

```bash
# Low-latency (trading system): ZGC or Shenandoah
java -XX:+UseZGC \
     -Xms4g -Xmx4g \
     -XX:MaxGCPauseMillis=1 \
     -XX:ZAllocationSpikeTolerance=2.0 \
     -jar trading-system.jar

# High-throughput (batch analytics): Parallel GC
java -XX:+UseParallelGC \
     -Xms32g -Xmx32g \
     -XX:ParallelGCThreads=8 \
     -XX:MaxGCPauseMillis=100 \
     -jar analytics-job.jar
```

**Tuning process**:
1. **Set heap**: Min = Max. 4GB for typical service.
2. **Measure**: Enable GC logs (`-Xlog:gc*`). Use GCeasy or GCViewer.
3. **Check allocation rate**: High allocation → tune Young Gen size, reduce object creation.
4. **Check promotion rate**: Objects moving to Old Gen too fast → increase Young Gen.
5. **Check pause time**: Too high → switch GC (G1→ZGC) or reduce target.

**Golden rule**: GC tuning should fix ONE problem with a measured input. Never tune GC without metrics.

### 16. Memory Leak Detection

**Question**: How do you find the root cause of a memory leak in production without restarting?

**Why this matters in production**: Every hour of outage costs money. The ability to diagnose a live JVM without restarting (which clears the evidence) is a critical skill.

**Answer**:

```bash
# Step 1: Enable GC logging (should always be on)
- Xlog:gc*:file=gc.log:time,level,tags

# Step 2: Take heap dump (without restart)
jmap -dump:live,format=b,file=heap.hprof <pid>

# Step 3: Analyze with Eclipse MAT
# - Open heap dump in MAT
# - Run "Leak Suspects Report"
# - Check "Dominator Tree" for biggest objects
# - Path to GC Roots → what references the leaking objects
```

**Without heap dump (production)**: Use `jcmd` or `jstat`:
```bash
# Live analysis
jstat -gcutil <pid> 1000  # GC stats per second
jcmd <pid> GC.heap_info   # Heap region breakdown
jcmd <pid> Thread.print   # Thread stacks with lock info
```

**Common leak patterns in heap dumps**:
- `java.lang.ref.Finalizer` queue growing → many objects with `finalize()`
- `ThreadLocal` with no `remove()`
- Static `HashMap`/`ArrayList` growing unbounded
- Classloader references after redeploy

---

## Design Patterns

### 17. Singleton in Modern Java

**Question**: Implement a thread-safe Singleton. Is the Singleton pattern still relevant?

**Why this matters in production**: Singletons are common (config, thread pools, connection factories). But misuse creates global state that makes testing impossible and introduces hidden coupling.

**Answer**:

```java
// Modern Singleton: Enum — inherently serialization-safe and thread-safe
public enum Config {
    INSTANCE;

    private final Properties props;

    Config() {
        props = new Properties();
        try (var in = getClass().getResourceAsStream("/config.properties")) {
            props.load(in);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    public String get(String key) { return props.getProperty(key); }
}

// Usage
String url = Config.INSTANCE.get("db.url");
```

**Why enum**:
- Serialization is safe (enum instances are singletons by JVM spec)
- Reflection can't create additional instances
- Thread-safe initialization (JVM guarantees enum construction is synchronized)
- Concise

**Is Singleton still relevant?** Yes, but sparingly. Use for:
- Shared infrastructure (config, metrics registry, thread pools)
- Stateless utility beans managed by DI framework

Avoid for:
- Business logic (makes unit testing hard)
- Stateful services (hidden global state)

Modern alternative: Let your DI framework (Spring) manage singletons via `@Singleton` scoped beans.

### 18. Factory Pattern

**Question**: When would you use a Factory pattern instead of a constructor?

**Why this matters in production**: Direct instantiation couples callers to concrete types. Factories enable polymorphism, centralized configuration, and conditional creation.

**Answer**:

```java
// Without Factory — caller knows too much
Payment payment;
if (type.equals("CARD")) {
    payment = new CreditCardPayment(number, cvv);
} else if (type.equals("UPI")) {
    payment = new UpiPayment(vpa);
}

// With Factory — caller is decoupled
public sealed interface Payment permits CreditCard, Upi, Wallet {}
public record CreditCard(String number, String cvv) implements Payment {}
public record Upi(String vpa) implements Payment {}

public class PaymentFactory {
    public Payment create(String type, PaymentRequest request) {
        return switch (type) {
            case "CARD" -> new CreditCard(request.number(), request.cvv());
            case "UPI" -> new Upi(request.vpa());
            default -> throw new IllegalArgumentException("Unknown: " + type);
        };
    }
}

// Usage
Payment payment = factory.create(type, request);
// Caller has no idea about concrete types
```

**When to use Factory**:
- Creation logic is complex (conditional, config-based)
- You want to decouple callers from implementations
- Framework/DI context (Spring `@Bean` methods are essentially factories)

### 19. Builder Pattern

**Question**: Implement a Builder pattern. When is it appropriate?

**Why this matters in production**: Objects with many parameters (especially optional ones) create telescoping constructor anti-pattern or confusion from positional parameters.

**Answer**:

```java
// Java 17+ — often a record with builder is overkill, use record + withX()
// But for complex construction, Builder is clean:

public class SearchRequest {
    private final String query;
    private final int page;
    private final int size;
    private final List<String> sortBy;
    private final Map<String, String> filters;
    private final boolean includeMetadata;

    private SearchRequest(Builder builder) {
        this.query = builder.query;
        this.page = builder.page;
        this.size = builder.size;
        this.sortBy = List.copyOf(builder.sortBy);
        this.filters = Map.copyOf(builder.filters);
        this.includeMetadata = builder.includeMetadata;
    }

    public static Builder builder(String query) {
        return new Builder(query);
    }

    public static class Builder {
        private final String query;
        private int page = 0;
        private int size = 20;
        private List<String> sortBy = List.of();
        private Map<String, String> filters = Map.of();
        private boolean includeMetadata = false;

        private Builder(String query) { this.query = query; }

        public Builder page(int page) { this.page = page; return this; }
        public Builder size(int size) { this.size = size; return this; }
        public Builder sortBy(String... fields) {
            this.sortBy = List.of(fields); return this;
        }
        public Builder filter(String key, String value) {
            var mutable = new HashMap<>(this.filters);
            mutable.put(key, value);
            this.filters = Collections.unmodifiableMap(mutable);
            return this;
        }
        public Builder includeMetadata(boolean v) {
            this.includeMetadata = v; return this;
        }
        public SearchRequest build() {
            return new SearchRequest(this);
        }
    }
}

// Usage
SearchRequest request = SearchRequest.builder("java")
    .page(1)
    .size(50)
    .sortBy("relevance", "date")
    .filter("category", "programming")
    .build();
```

**When to use Builder**:
- 4+ constructor parameters
- Many optional parameters
- Object is immutable (setters not possible)
- Complex validation during construction

**Records + withers** (Java 17) are often simpler for moderate cases:
```java
record SearchRequest(String query, int page, int size) {
    SearchRequest { // Compact constructor — validation
        if (page < 0) throw new IllegalArgumentException();
    }
    public SearchRequest withPage(int page) {
        return new SearchRequest(this.query, page, this.size);
    }
}
```

---

## Java 8+ Features

### 20. Streams vs Loops

**Question**: When should you use streams instead of traditional loops? What about performance?

**Why this matters in production**: Streams are more expressive but can introduce allocation overhead and harder-to-debug performance issues. The wrong choice leads to either unreadable loop-spaghetti or unnecessarily slow stream pipelines.

**Answer**:

```java
// Loop — explicit, mutable
List<String> result = new ArrayList<>();
for (Order o : orders) {
    if (o.amount() > 100) {
        result.add(o.customerName().toUpperCase());
    }
}

// Stream — declarative, immutable
List<String> result = orders.stream()
    .filter(o -> o.amount() > 100)
    .map(o -> o.customerName().toUpperCase())
    .toList();
```

**When streams win**:
- Readability: Pipeline of operations is clear
- Immutability: No mutable accumulator
- Parallelism: `.parallel()` (but measure — overhead can dominate for small datasets)
- Lazy evaluation: Short-circuit operations (`findFirst()`, `anyMatch()`)

**When loops win**:
- Performance-critical hot paths (streams create multiple objects: Spliterator, pipeline stages)
- Complex flow control (break, continue, early return, exceptions)
- Primitive collections (use `IntStream`, `LongStream`, `DoubleStream` for primitive perf)
- Very small collections (overhead > benefit)

**Performance caveat**: Stream overhead matters at millions of iterations. For 99% of backend code (collections of tens/hundreds), streams are fine. Profile before optimizing.

---

## Conclusion

These 20 questions cover the knowledge gap between a "Java developer who can write code" and an "engineer who understands what the JVM does with that code." The best interview answers connect theory to production experience: not just "HashMap uses hashCode and equals" but "We had a production incident where poor hashCode caused O(n) HashMap degradation during Black Friday."

Study the internals. Write production code. Measure everything. The rest follows.

Happy Coding
