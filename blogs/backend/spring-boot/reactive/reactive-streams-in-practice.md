---
title: "Reactive Streams in Practice"
description: "Master Reactive Streams and backpressure in Spring: Project Reactor operators, error handling, backpressure strategies, and building resilient reactive pipelines"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - reactive
  - reactive-streams
  - backpressure
coverImage: "/images/reactive-streams-in-practice.png"
draft: false
---

## Overview

Reactive Streams is a specification for asynchronous stream processing with non-blocking backpressure. Project Reactor implements this specification with Mono (0-1 element) and Flux (0-N elements). This guide covers practical patterns for building reactive pipelines in production.

## Reactive Streams Specification

### The Four Interfaces

```java
// Publisher: Produces data
public interface Publisher<T> {
    void subscribe(Subscriber<? super T> subscriber);
}

// Subscriber: Consumes data
public interface Subscriber<T> {
    void onSubscribe(Subscription s);
    void onNext(T t);
    void onError(Throwable t);
    void onComplete();
}

// Subscription: Controls demand
public interface Subscription {
    void request(long n);
    void cancel();
}

// Processor: Both publisher and subscriber
public interface Processor<T, R> extends Subscriber<T>, Publisher<R> {}
```

## Project Reactor Core Types

### Mono Operations

```java
@Service
public class UserDetailService {
    private final UserRepository userRepository;
    private final OrderRepository orderRepository;
    private final ExternalApiClient externalApi;

    public UserDetailService(UserRepository userRepository,
                            OrderRepository orderRepository,
                            ExternalApiClient externalApi) {
        this.userRepository = userRepository;
        this.orderRepository = orderRepository;
        this.externalApi = externalApi;
    }

    public Mono<UserDetail> getUserDetail(Long userId) {
        return userRepository.findById(userId)
            .switchIfEmpty(Mono.error(new UserNotFoundException(userId)))
            .flatMap(user ->
                Mono.zip(
                    orderRepository.findByUserId(userId).collectList(),
                    externalApi.getUserPreferences(userId).onErrorReturn(new UserPreferences()),
                    Mono.just(user)
                )
            )
            .map(tuple -> new UserDetail(tuple.getT3(), tuple.getT1(), tuple.getT2()))
            .timeout(Duration.ofSeconds(10))
            .doOnError(error -> log.error("Failed to get user detail", error))
            .onErrorResume(ApiException.class, e -> fallbackUserDetail(userId));
    }

    private Mono<UserDetail> fallbackUserDetail(Long userId) {
        return userRepository.findById(userId)
            .map(user -> new UserDetail(user, List.of(), new UserPreferences()));
    }
}
```

### Flux Operations

```java
@Service
public class DataProcessingService {

    public Flux<ProcessedRecord> processLargeDataset(Flux<RawRecord> source) {
        return source
            .buffer(100)
            .flatMap(this::processBatch, 5)
            .onBackpressureBuffer(1000,
                dropped -> log.warn("Dropped {} records", dropped.size()))
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                .filter(throwable -> throwable instanceof TransientException))
            .doOnComplete(() -> log.info("Processing completed"));
    }

    private Mono<List<ProcessedRecord>> processBatch(List<RawRecord> batch) {
        return Flux.fromIterable(batch)
            .flatMap(this::enrichRecord, 10)
            .collectList()
            .timeout(Duration.ofSeconds(30));
    }

    private Mono<ProcessedRecord> enrichRecord(RawRecord record) {
        return Mono.fromCallable(() -> {
            // CPU-bound enrichment
            return new ProcessedRecord(record.getId(), transform(record.getData()));
        }).subscribeOn(Schedulers.parallel());
    }
}
```

## Backpressure Strategies

### onBackpressureBuffer

```java
public Flux<Event> eventStream() {
    return Flux.create(sink -> {
        messageListener.onEvent(sink::next);
    }, FluxSink.OverflowStrategy.BUFFER)
    .onBackpressureBuffer(500,
        dropped -> log.warn("Dropped {} events", dropped.size()))
    .doOnNext(event -> processEvent(event));
}
```

### onBackpressureDrop

```java
@Bean
public Flux<Metric> metricStream() {
    return Flux.interval(Duration.ofMillis(100))
        .map(i -> new Metric("counter", i))
        .onBackpressureDrop(metric ->
            log.warn("Dropping metric: {}", metric))
        .sample(Duration.ofSeconds(1));
}
```

### onBackpressureLatest

```java
public Flux<PriceUpdate> priceStream() {
    return Flux.create(sink -> {
        priceFeed.onPrice(price -> sink.next(price));
    }, FluxSink.OverflowStrategy.LATEST)
    .onBackpressureLatest()
    .subscribeOn(Schedulers.parallel());
}
```

### onBackpressureError

```java
public Flux<Command> commandStream() {
    return Flux.create(sink -> {
        commandQueue.onCommand(sink::next);
    }, FluxSink.OverflowStrategy.ERROR)
    .onBackpressureError();
}
```

## Error Handling Patterns

### Retry Strategies

```java
@Service
public class ResilientService {

    public Mono<Data> fetchWithRetry(String id) {
        return externalClient.fetchData(id)
            .retryWhen(Retry.backoff(3, Duration.ofMillis(500))
                .maxBackoff(Duration.ofSeconds(5))
                .jitter(0.5)
                .filter(throwable -> throwable instanceof TransientException)
                .onRetryExhaustedThrow((spec, signal) ->
                    new ExternalServiceException("Retry exhausted", signal.failure()))
            );
    }

    public Flux<Record> processWithRetry(Flux<Record> records) {
        return records
            .flatMap(record ->
                processRecord(record)
                    .retryWhen(Retry.fixedDelay(2, Duration.ofSeconds(1))
                        .filter(throwable -> throwable instanceof TimeoutException)
                    )
                    .onErrorResume(e -> {
                        log.error("Failed to process record {}: {}", record.getId(), e.getMessage());
                        return Mono.empty();
                    })
            );
    }
}
```

### Fallback Patterns

```java
@Service
public class FallbackService {

    public Mono<Response> getData(String key) {
        return cacheService.get(key)
            .switchIfEmpty(
                databaseService.find(key)
                    .flatMap(data -> cacheService.put(key, data).thenReturn(data))
            )
            .onErrorResume(CacheException.class, e ->
                databaseService.find(key)
            )
            .onErrorResume(DatabaseException.class, e ->
                fallbackService.get(key)
            )
            .timeout(Duration.ofMillis(500))
            .onErrorResume(TimeoutException.class, e ->
                Mono.just(Response.stale(defaultData(key)))
            );
    }
}
```

## Combining Reactive Streams

### Zip and Combine

```java
@Service
public class AggregationService {

    public Mono<Dashboard> getDashboard(String userId) {
        return Mono.zip(
            userService.getProfile(userId),
            orderService.getRecentOrders(userId),
            notificationService.getUnreadCount(userId),
            analyticsService.getUserStats(userId)
        ).map(tuple -> new Dashboard(
            tuple.getT1(),
            tuple.getT2(),
            tuple.getT3(),
            tuple.getT4()
        ));
    }

    public Flux<CombinedEvent> mergeStreams() {
        return Flux.merge(
            eventStreamA(),
            eventStreamB(),
            eventStreamC()
        ).transform(this::deduplicate)
         .transform(this::sortByTimestamp);
    }

    private Flux<CombinedEvent> deduplicate(Flux<CombinedEvent> source) {
        return source
            .groupBy(CombinedEvent::getId)
            .flatMap(group -> group.take(1));
    }

    private Flux<CombinedEvent> sortByTimestamp(Flux<CombinedEvent> source) {
        return source
            .buffer(Duration.ofSeconds(1))
            .flatMap(list -> Flux.fromIterable(
                list.stream()
                    .sorted(Comparator.comparing(CombinedEvent::getTimestamp))
                    .toList()
            ));
    }
}
```

## Schedulers

```java
@Service
public class SchedulerDemo {

    public Flux<Integer> demonstrateSchedulers() {
        return Flux.range(1, 10)
            .log("source")
            .map(i -> {
                System.out.println("Map on: " + Thread.currentThread().getName());
                return i * 2;
            })
            .subscribeOn(Schedulers.boundedElastic())
            .publishOn(Schedulers.parallel())
            .map(i -> {
                System.out.println("PublishOn map: " + Thread.currentThread().getName());
                return i + 1;
            });
    }

    public Flux<String> parallelProcessing() {
        return Flux.range(1, 100)
            .parallel(4)
            .runOn(Schedulers.parallel())
            .map(this::heavyComputation)
            .sequential();
    }

    private String heavyComputation(int input) {
        // CPU-intensive work
        return "Result-" + input;
    }
}
```

## Hot vs Cold Publishers

```java
@Service
public class PublisherTypes {

    // Cold Publisher: Each subscriber gets its own stream
    public Flux<Long> coldInterval() {
        return Flux.interval(Duration.ofSeconds(1))
            .take(5);
    }

    // Hot Publisher: All subscribers share the stream
    public ConnectableFlux<Long> hotInterval() {
        return Flux.interval(Duration.ofSeconds(1))
            .take(5)
            .publish();
    }

    // Auto-connect after first subscriber
    public Flux<Long> autoConnectInterval() {
        return Flux.interval(Duration.ofSeconds(1))
            .take(5)
            .publish()
            .autoConnect(1);
    }

    // Cache for replaying to late subscribers
    public Flux<Long> cachedInterval() {
        return Flux.interval(Duration.ofSeconds(1))
            .take(5)
            .cache(2); // Cache last 2 values
    }
}
```

## Testing Reactive Streams

```java
class ReactiveStreamsTest {
    private final StepVerifier stepVerifier = StepVerifier.create(mock);

    @Test
    void shouldStreamWithBackpressure() {
        Flux<Integer> source = Flux.range(1, 1000);

        StepVerifier.create(source, 0)
            .expectSubscription()
            .thenRequest(5)
            .expectNext(1, 2, 3, 4, 5)
            .thenRequest(3)
            .expectNext(6, 7, 8)
            .thenCancel()
            .verify();
    }

    @Test
    void shouldHandleErrors() {
        Flux<Integer> source = Flux.range(1, 5)
            .map(i -> {
                if (i == 3) throw new RuntimeException("Error at 3");
                return i;
            });

        StepVerifier.create(source)
            .expectNext(1, 2)
            .expectError(RuntimeException.class)
            .verify();
    }

    @Test
    void shouldTimeout() {
        StepVerifier.create(
                Mono.delay(Duration.ofSeconds(10))
                    .timeout(Duration.ofSeconds(1))
            )
            .expectError(TimeoutException.class)
            .verify();
    }

    @Test
    void shouldTestWithVirtualTime() {
        StepVerifier.withVirtualTime(() ->
                Flux.interval(Duration.ofHours(1)).take(3)
            )
            .expectSubscription()
            .thenAwait(Duration.ofHours(3))
            .expectNext(0L, 1L, 2L)
            .verifyComplete();
    }
}
```

## Best Practices

1. **Use backpressure-aware operators** to control data flow
2. **Choose appropriate backpressure strategy** based on use case
3. **Handle errors at the right level** - retry transient failures, fail fast on permanent ones
4. **Use appropriate schedulers** - parallel for CPU, boundedElastic for blocking I/O
5. **Avoid blocking operators** (block(), toIterable()) in reactive pipelines
6. **Test with StepVerifier** and virtual time for time-based operations
7. **Monitor reactive pipelines** with Reactor's metrics and Hooks.onOperatorDebug()

## Common Mistakes

### Mistake 1: Unbounded FlatMap

```java
// Wrong: Unbounded concurrency can overwhelm downstream
public Flux<ProcessedItem> processItems(Flux<Item> items) {
    return items.flatMap(this::processItem); // No concurrency limit
}
```

```java
// Correct: Limit concurrency
public Flux<ProcessedItem> processItems(Flux<Item> items) {
    return items.flatMap(this::processItem, 10); // Max 10 concurrent
}
```

### Mistake 2: Ignoring Backpressure

```java
// Wrong: Creates unbounded queue
public Flux<Event> processEvents() {
    return eventStream()
        .doOnNext(this::process); // No backpressure handling
}
```

```java
// Correct: Handle backpressure explicitly
public Flux<Event> processEvents() {
    return eventStream()
        .onBackpressureBuffer(1000,
            dropped -> log.warn("Buffer full, dropping {} events", dropped.size()))
        .doOnNext(this::process);
}
```

## Summary

Reactive Streams with Project Reactor provides powerful abstractions for asynchronous data processing. Understanding backpressure strategies, error handling patterns, schedulers, and hot vs cold publishers is essential for building resilient reactive applications. Test reactive pipelines thoroughly with StepVerifier and virtual time support.

## References

- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [Project Reactor Documentation](https://projectreactor.io/docs/core/release/reference/)
- [Reactor Core Operators](https://projectreactor.io/docs/core/release/reference/#which-operator)
- [Reactor Testing](https://projectreactor.io/docs/core/release/reference/#testing)

Happy Coding