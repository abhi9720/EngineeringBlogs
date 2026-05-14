---
title: Event Sourcing Fundamentals
description: >-
  Learn event sourcing fundamentals: append-only event store, aggregate
  reconstruction, event versioning, snapshots, CQRS integration, and
  implementation with Axon Framework and Spring Boot
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - event-sourcing
  - cqrs
  - axon
  - events
coverImage: /images/event-sourcing-basics.png
draft: false
order: 10
---
## Overview

Event sourcing is a pattern where state changes are stored as a sequence of events rather than the current state. The current state is derived by replaying events. This provides a complete audit trail, enables temporal queries, and improves system resilience.

## Core Concepts

Instead of storing the current balance of an account, event sourcing stores every transaction as an event. The traditional approach stores only the final state — if you want to know what the balance was a week ago, you'd need separate audit logging. Event sourcing makes this trivial: replay events up to any point in time to see the state at that moment.

```java
// Traditional approach - store current state
@Entity
public class BankAccount {
    @Id
    private String accountId;
    private String customerId;
    private BigDecimal balance;
    private String status;
}

// Event sourcing - store state changes
// AccountCreatedEvent, MoneyDepositedEvent, MoneyWithdrawnEvent, AccountClosedEvent
// Current balance = replay all events
```

## Event Store

The event store is the append-only database of all events. The `JdbcEventStore` implementation stores events in a relational table with the aggregate ID as the grouping key. Events are ordered by version and never mutated. The `load()` method retrieves all events for an aggregate in order, while `loadSince()` enables snapshot-based optimization by loading only events after a given version. The `loadByType()` method supports queries across aggregates by event type and time range.

```java
public interface EventStore {
    void save(List<Object> events);
    List<Object> load(String aggregateId);
    List<Object> loadSince(String aggregateId, long version);
    List<DomainEvent> loadByType(String eventType, Instant from, Instant to);
}

@Component
public class JdbcEventStore implements EventStore {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Override
    @Transactional
    public void save(List<Object> events) {
        for (Object event : events) {
            DomainEvent domainEvent = (DomainEvent) event;
            jdbcTemplate.update(
                "INSERT INTO event_store (event_id, aggregate_id, aggregate_type, " +
                "event_type, event_data, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                domainEvent.getEventId(),
                domainEvent.getAggregateId(),
                domainEvent.getAggregateType(),
                domainEvent.getEventType(),
                toJson(domainEvent.getEventData()),
                domainEvent.getVersion(),
                domainEvent.getCreatedAt()
            );
        }
    }

    @Override
    public List<Object> load(String aggregateId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
            "SELECT * FROM event_store WHERE aggregate_id = ? ORDER BY version ASC",
            aggregateId
        );
        return rows.stream()
            .map(this::toDomainEvent)
            .collect(Collectors.toList());
    }

    @Override
    public List<Object> loadSince(String aggregateId, long version) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
            "SELECT * FROM event_store WHERE aggregate_id = ? AND version > ? ORDER BY version ASC",
            aggregateId, version
        );
        return rows.stream()
            .map(this::toDomainEvent)
            .collect(Collectors.toList());
    }

    private DomainEvent toDomainEvent(Map<String, Object> row) {
        try {
            return new DomainEvent(
                (String) row.get("event_id"),
                (String) row.get("aggregate_id"),
                (String) row.get("aggregate_type"),
                (String) row.get("event_type"),
                objectMapper.readTree((String) row.get("event_data")),
                ((Number) row.get("version")).longValue(),
                ((Timestamp) row.get("created_at")).toInstant()
            );
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to deserialize event", e);
        }
    }

    private String toJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize event", e);
        }
    }
}
```

## Aggregate Root

The aggregate root is the transactional boundary in event sourcing. `BankAccountAggregate` maintains an in-memory list of `uncommittedEvents` that are new since the last save. The `apply()` method both mutates the aggregate state and records the event. `loadFromHistory()` replays stored events to reconstruct the aggregate's current state without calling `applyChange()` (which would add events to the uncommitted list). The version field enables optimistic concurrency — when saving, the database checks that no concurrent write has occurred.

```java
public class BankAccountAggregate {

    private String accountId;
    private String customerId;
    private BigDecimal balance;
    private AccountStatus status;
    private long version;

    private final List<Object> uncommittedEvents = new ArrayList<>();

    public BankAccountAggregate() {}

    public static BankAccountAggregate create(String accountId, String customerId,
                                                BigDecimal initialDeposit) {
        BankAccountAggregate aggregate = new BankAccountAggregate();
        aggregate.applyChange(new AccountCreatedEvent(accountId, customerId, initialDeposit));
        return aggregate;
    }

    public void deposit(BigDecimal amount) {
        if (status != AccountStatus.ACTIVE) {
            throw new IllegalStateException("Account is not active");
        }
        applyChange(new MoneyDepositedEvent(accountId, amount));
    }

    public void withdraw(BigDecimal amount) {
        if (status != AccountStatus.ACTIVE) {
            throw new IllegalStateException("Account is not active");
        }
        if (balance.compareTo(amount) < 0) {
            throw new InsufficientFundsException("Insufficient funds");
        }
        applyChange(new MoneyWithdrawnEvent(accountId, amount));
    }

    public void close(String reason) {
        if (status == AccountStatus.CLOSED) {
            throw new IllegalStateException("Account already closed");
        }
        applyChange(new AccountClosedEvent(accountId, reason));
    }

    public List<Object> getUncommittedEvents() {
        return Collections.unmodifiableList(uncommittedEvents);
    }

    public void markCommitted() {
        uncommittedEvents.clear();
    }

    private void applyChange(Object event) {
        apply(event);
        uncommittedEvents.add(event);
    }

    private void apply(Object event) {
        if (event instanceof AccountCreatedEvent) {
            AccountCreatedEvent e = (AccountCreatedEvent) event;
            this.accountId = e.getAccountId();
            this.customerId = e.getCustomerId();
            this.balance = e.getInitialDeposit();
            this.status = AccountStatus.ACTIVE;
        } else if (event instanceof MoneyDepositedEvent) {
            MoneyDepositedEvent e = (MoneyDepositedEvent) event;
            this.balance = this.balance.add(e.getAmount());
        } else if (event instanceof MoneyWithdrawnEvent) {
            MoneyWithdrawnEvent e = (MoneyWithdrawnEvent) event;
            this.balance = this.balance.subtract(e.getAmount());
        } else if (event instanceof AccountClosedEvent) {
            this.status = AccountStatus.CLOSED;
        }
        this.version++;
    }

    public void loadFromHistory(List<Object> history) {
        for (Object event : history) {
            apply(event);
        }
    }

    public String getAccountId() { return accountId; }
    public BigDecimal getBalance() { return balance; }
    public AccountStatus getStatus() { return status; }
    public long getVersion() { return version; }
}
```

## Event Definitions

Each event class captures a specific domain change. Events are immutable — they represent facts that have already happened. The `eventId` is a UUID for deduplication, `aggregateId` ties the event to a specific aggregate instance, and `version` enables optimistic concurrency. Events should be named in the past tense (AccountCreated, MoneyDeposited) to emphasize that they represent historical facts, not commands to be executed.

```java
public class AccountCreatedEvent {
    private String eventId = UUID.randomUUID().toString();
    private String aggregateId;
    private String aggregateType = "BankAccount";
    private String eventType = "ACCOUNT_CREATED";
    private long version;
    private Instant createdAt = Instant.now();

    private String accountId;
    private String customerId;
    private BigDecimal initialDeposit;
    private String currency = "USD";

    public AccountCreatedEvent(String accountId, String customerId, BigDecimal initialDeposit) {
        this.accountId = accountId;
        this.customerId = customerId;
        this.initialDeposit = initialDeposit;
    }
}

public class MoneyDepositedEvent {
    private String eventId = UUID.randomUUID().toString();
    private String aggregateId;
    private String eventType = "MONEY_DEPOSITED";
    private long version;
    private Instant createdAt = Instant.now();

    private String accountId;
    private BigDecimal amount;
    private String transactionId;
    private String description;

    public MoneyDepositedEvent(String accountId, BigDecimal amount) {
        this.accountId = accountId;
        this.amount = amount;
        this.transactionId = UUID.randomUUID().toString();
    }
}

public class AccountClosedEvent {
    private String eventId = UUID.randomUUID().toString();
    private String aggregateId;
    private String eventType = "ACCOUNT_CLOSED";
    private long version;
    private Instant createdAt = Instant.now();

    private String accountId;
    private String reason;

    public AccountClosedEvent(String accountId, String reason) {
        this.accountId = accountId;
        this.reason = reason;
    }
}
```

## Snapshots

Replaying hundreds or thousands of events to load an aggregate is expensive. Snapshots store the aggregate's full state at a given version, so you only need to replay events since the snapshot. The `SnapshotService` takes a snapshot every 100 events (configurable via `SNAPSHOT_THRESHOLD`). On load, you fetch the latest snapshot, then replay only the events that occurred after it. This drastically reduces load time for long-lived aggregates.

```java
@Component
public class SnapshotService {

    private static final int SNAPSHOT_THRESHOLD = 100;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    public void takeSnapshotIfNeeded(String aggregateId, BankAccountAggregate aggregate) {
        if (aggregate.getVersion() % SNAPSHOT_THRESHOLD == 0) {
            jdbcTemplate.update(
                "INSERT INTO snapshots (aggregate_id, aggregate_type, snapshot_data, " +
                "version, created_at) VALUES (?, 'BankAccount', ?, ?, NOW()) " +
                "ON CONFLICT (aggregate_id, version) DO NOTHING",
                aggregateId,
                serializeSnapshot(aggregate),
                aggregate.getVersion()
            );
        }
    }

    public Optional<Snapshot> loadLatestSnapshot(String aggregateId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
            "SELECT * FROM snapshots WHERE aggregate_id = ? " +
            "ORDER BY version DESC LIMIT 1",
            aggregateId
        );
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(deserializeSnapshot(rows.get(0)));
    }

    private String serializeSnapshot(BankAccountAggregate aggregate) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("accountId", aggregate.getAccountId());
            data.put("balance", aggregate.getBalance());
            data.put("status", aggregate.getStatus());
            data.put("version", aggregate.getVersion());
            return objectMapper.writeValueAsString(data);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    private Snapshot deserializeSnapshot(Map<String, Object> row) {
        try {
            JsonNode data = objectMapper.readTree((String) row.get("snapshot_data"));
            return new Snapshot(
                (String) row.get("aggregate_id"),
                data.get("accountId").asText(),
                new BigDecimal(data.get("balance").asText()),
                AccountStatus.valueOf(data.get("status").asText()),
                data.get("version").asLong()
            );
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }
}
```

## Projections (Read Side)

Projections build read-optimized views from the event stream. The `BankAccountProjection` listens for each event type and updates a relational summary table accordingly. This is the "Q" in CQRS — the read side is a denormalized projection of the event stream, optimized for querying rather than writing. Different projections can serve different query patterns: account summaries, transaction history, monthly statements — each built from the same event stream.

```java
@Component
public class BankAccountProjection {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @EventListener
    public void on(AccountCreatedEvent event) {
        jdbcTemplate.update(
            "INSERT INTO account_summary (account_id, customer_id, balance, status, version) " +
            "VALUES (?, ?, ?, 'ACTIVE', 1)",
            event.getAccountId(), event.getCustomerId(), event.getInitialDeposit()
        );
    }

    @EventListener
    public void on(MoneyDepositedEvent event) {
        jdbcTemplate.update(
            "UPDATE account_summary SET balance = balance + ?, version = version + 1 " +
            "WHERE account_id = ?",
            event.getAmount(), event.getAccountId()
        );

        jdbcTemplate.update(
            "INSERT INTO transactions (transaction_id, account_id, type, amount, description) " +
            "VALUES (?, ?, 'DEPOSIT', ?, ?)",
            event.getTransactionId(), event.getAccountId(), event.getAmount(), event.getDescription()
        );
    }

    @EventListener
    public void on(AccountClosedEvent event) {
        jdbcTemplate.update(
            "UPDATE account_summary SET status = 'CLOSED', version = version + 1 " +
            "WHERE account_id = ?",
            event.getAccountId()
        );
    }
}
```

## Best Practices

- Use event versioning to support schema evolution over time.
- Implement snapshotting for aggregates with long event streams (threshold of 100-200 events).
- Keep events small and focused on specific domain changes.
- Use CQRS to separate the write model (event store) from read models (projections).
- Store metadata (correlation ID, causation ID) with each event for traceability.
- Never modify or delete events once stored.

## Common Mistakes

### Mistake: Storing too much data in a single event

Coarse-grained events that dump the entire aggregate state defeat the purpose of event sourcing — you lose the ability to reason about what specifically changed. Instead, emit fine-grained events (OrderItemAddedEvent, OrderItemRemovedEvent, OrderStatusChangedEvent) that capture exactly what happened. This makes the event log a true audit trail rather than a snapshot history.

```java
// Wrong - coarse event with too much data
public class OrderChangedEvent {
    private String orderId;
    private String fullOrderState; // Entire order state duplicated
}
```

```java
// Correct - fine-grained events
public class OrderItemAddedEvent {
    private String orderId;
    private String productId;
    private int quantity;
    private BigDecimal price;
}
```

### Mistake: Not using snapshots for long-lived aggregates

Without snapshots, loading an aggregate with thousands of events means replaying every event from the beginning — this can take seconds and waste I/O. Always use snapshots for aggregates that may accumulate many events. The snapshot gives you a known state at version N, and you only replay events after N.

```java
// Wrong - replaying thousands of events on every load
List<Object> allEvents = eventStore.load(aggregateId);
aggregate.loadFromHistory(allEvents);
```

```java
// Correct - load from snapshot and replay remaining events
Optional<Snapshot> snapshot = snapshotService.loadLatestSnapshot(aggregateId);
BankAccountAggregate aggregate = new BankAccountAggregate();
if (snapshot.isPresent()) {
    aggregate.restoreFromSnapshot(snapshot.get());
    List<Object> newEvents = eventStore.loadSince(aggregateId, snapshot.get().getVersion());
    aggregate.loadFromHistory(newEvents);
} else {
    List<Object> allEvents = eventStore.load(aggregateId);
    aggregate.loadFromHistory(allEvents);
}
```

## Summary

Event sourcing provides a complete audit trail and enables temporal queries by storing state changes as events. Combined with CQRS, it enables flexible read models optimized for different query patterns. While event sourcing adds complexity, it provides powerful capabilities for systems requiring full auditability and complex event-driven processing.

## References

- [Martin Fowler - Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Axon Framework Documentation](https://docs.axoniq.io/reference-guide/)
- [Greg Young - Event Sourcing](https://www.youtube.com/watch?v=JHGkaShoyNs)

Happy Coding
