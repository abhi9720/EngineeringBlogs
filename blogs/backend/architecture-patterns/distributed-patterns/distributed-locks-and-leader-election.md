---
title: "Distributed Locks and Leader Election"
description: "Implement distributed locking and leader election patterns: Redis locks, ZooKeeper, database-based coordination"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["distributed-locks", "leader-election", "redis", "zookeeper"]
coverImage: "/images/distributed-locks-and-leader-election.png"
draft: false
---

## Overview

Distributed coordination is essential when multiple services need to coordinate access to shared resources or designate a single node for exclusive work. Two fundamental patterns address these needs: distributed locks for mutual exclusion, and leader election for designating a coordinator.

This post explores implementations using Redis, ZooKeeper, and database-based approaches, with analysis of their guarantees and trade-offs.

## Distributed Locks with Redis

### Simple Redis Lock (Single Instance)

```java
@Component
public class SimpleRedisLock {

    private final StringRedisTemplate redisTemplate;
    private final Duration lockTimeout;

    public SimpleRedisLock(StringRedisTemplate redisTemplate, Duration lockTimeout) {
        this.redisTemplate = redisTemplate;
        this.lockTimeout = lockTimeout;
    }

    public Optional<Lock> acquire(String lockKey, String ownerId) {
        Boolean acquired = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, ownerId, lockTimeout);
        if (Boolean.TRUE.equals(acquired)) {
            return Optional.of(new Lock(lockKey, ownerId));
        }
        return Optional.empty();
    }

    public boolean release(Lock lock) {
        String script = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
            """;
        Long result = redisTemplate.execute(
            new DefaultRedisScript<>(script, Long.class),
            List.of(lock.key()),
            lock.ownerId()
        );
        return Long.valueOf(1).equals(result);
    }

    public record Lock(String key, String ownerId) {}
}
```

### Redlock Algorithm

For stronger guarantees across multiple Redis instances, use the Redlock algorithm:

```java
@Component
public class Redlock {

    private final List<StringRedisTemplate> redisInstances;
    private final int quorum;
    private final Duration lockTtl;

    public Redlock(List<StringRedisTemplate> redisInstances, Duration lockTtl) {
        this.redisInstances = redisInstances;
        this.quorum = (redisInstances.size() / 2) + 1;
        this.lockTtl = lockTtl;
    }

    public Optional<RedlockInstance> lock(String resource, String owner, Duration ttl) {
        long start = System.currentTimeMillis();
        int acquired = 0;

        for (StringRedisTemplate instance : redisInstances) {
            Boolean result = instance.opsForValue()
                .setIfAbsent(resource, owner, ttl);
            if (Boolean.TRUE.equals(result)) {
                acquired++;
            }
        }

        long elapsed = System.currentTimeMillis() - start;
        if (acquired >= quorum && elapsed < ttl.toMillis()) {
            long remainingTtl = ttl.toMillis() - elapsed;
            return Optional.of(new RedlockInstance(resource, owner, remainingTtl));
        }

        releaseAll(resource, owner);
        return Optional.empty();
    }

    public void unlock(RedlockInstance lock) {
        releaseAll(lock.resource(), lock.owner());
    }

    private void releaseAll(String resource, String owner) {
        String script = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
            """;
        for (StringRedisTemplate instance : redisInstances) {
            instance.execute(
                new DefaultRedisScript<>(script, Long.class),
                List.of(resource), owner);
        }
    }

    public record RedlockInstance(String resource, String owner, long ttlMillis) {}
}
```

### Using Spring Integration Lock Registry

```java
@Configuration
public class LockConfiguration {

    @Bean
    public RedisLockRegistry redisLockRegistry(RedisConnectionFactory connectionFactory) {
        return new RedisLockRegistry(connectionFactory, "app-locks");
    }
}

@Component
public class ScheduledTaskService {

    private final RedisLockRegistry lockRegistry;

    public ScheduledTaskService(RedisLockRegistry lockRegistry) {
        this.lockRegistry = lockRegistry;
    }

    @Scheduled(fixedRate = 60000)
    public void runExclusiveTask() {
        Lock lock = lockRegistry.obtain("database-cleanup");
        try {
            if (lock.tryLock(5, TimeUnit.SECONDS)) {
                try {
                    performDatabaseCleanup();
                } finally {
                    lock.unlock();
                }
            } else {
                log.info("Another instance is performing cleanup, skipping");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Lock acquisition interrupted", e);
        }
    }

    private void performDatabaseCleanup() {
        log.info("Performing database cleanup on instance: {}", 
            ManagementFactory.getRuntimeMXBean().getName());
    }
}
```

## Distributed Locks with ZooKeeper

ZooKeeper provides strong consistency guarantees through its ZAB protocol:

```java
@Component
public class ZooKeeperDistributedLock implements AutoCloseable {

    private final CuratorFramework client;
    private final String lockPath;

    public ZooKeeperDistributedLock(CuratorFramework client, String lockPath) {
        this.client = client;
        this.lockPath = lockPath;
    }

    public Optional<LockHolder> acquire(String ownerId, Duration timeout) throws Exception {
        InterProcessSemaphoreMutex lock = new InterProcessSemaphoreMutex(client, lockPath);
        boolean acquired = lock.acquire(timeout.toMillis(), TimeUnit.MILLISECONDS);
        if (acquired) {
            return Optional.of(new LockHolder(ownerId, lock));
        }
        return Optional.empty();
    }

    public record LockHolder(String ownerId, InterProcessSemaphoreMutex lock) {
        public void release() throws Exception {
            lock.release();
        }
    }

    @Override
    public void close() {
        client.close();
    }
}
```

## Leader Election

### Leader Election with ZooKeeper

```java
@Component
public class ZooKeeperLeaderElection {

    private final CuratorFramework client;
    private final String electionPath;
    private volatile boolean isLeader;
    private String participantId;

    public ZooKeeperLeaderElection(CuratorFramework client, String electionPath) {
        this.client = client;
        this.electionPath = electionPath;
        this.participantId = UUID.randomUUID().toString();
    }

    public void start() throws Exception {
        LeaderSelector leaderSelector = new LeaderSelector(client, electionPath,
            new LeaderSelectorListenerAdapter() {
                @Override
                public void takeLeadership(CuratorFramework client) throws Exception {
                    isLeader = true;
                    log.info("Instance {} became leader", participantId);
                    try {
                        onBecomeLeader();
                        while (isLeader) {
                            Thread.sleep(1000);
                        }
                    } finally {
                        log.info("Instance {} relinquished leadership", participantId);
                        isLeader = false;
                        onLeadershipLost();
                    }
                }
            });

        leaderSelector.autoRequeue();
        leaderSelector.start();
    }

    public void stop() {
        isLeader = false;
    }

    public boolean isLeader() {
        return isLeader;
    }

    private void onBecomeLeader() {
        // Start leader-specific tasks
        startHeartbeatMonitor();
        startResourceCleanupScheduler();
        registerAsLeaderInDatabase();
    }

    private void onLeadershipLost() {
        // Stop leader-specific tasks
        stopHeartbeatMonitor();
        stopResourceCleanupScheduler();
    }

    private void startHeartbeatMonitor() {
        log.info("Leader heartbeat monitor started");
    }

    private void stopHeartbeatMonitor() {
        log.info("Leader heartbeat monitor stopped");
    }

    private void startResourceCleanupScheduler() {
        log.info("Leader resource cleanup scheduler started");
    }

    private void stopResourceCleanupScheduler() {
        log.info("Leader resource cleanup scheduler stopped");
    }

    private void registerAsLeaderInDatabase() {
        jdbcTemplate.update(
            "INSERT INTO leader_election (instance_id, elected_at) VALUES (?, ?) " +
            "ON DUPLICATE KEY UPDATE elected_at = ?",
            participantId, Instant.now(), Instant.now());
    }
}
```

### Leader Election with Database

A simpler approach using a database table:

```java
@Component
public class DatabaseLeaderElection {

    private final JdbcTemplate jdbcTemplate;
    private final String instanceId;
    private final Duration leaseDuration;
    private volatile boolean isLeader;
    private ScheduledExecutorService scheduler;

    public DatabaseLeaderElection(
            JdbcTemplate jdbcTemplate,
            @Value("${instance.id}") String instanceId,
            @Value("${leader.lease.seconds:30}") int leaseSeconds) {
        this.jdbcTemplate = jdbcTemplate;
        this.instanceId = instanceId;
        this.leaseDuration = Duration.ofSeconds(leaseSeconds);
    }

    @PostConstruct
    public void start() {
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(this::tryAcquireLeadership, 0, 
            leaseDuration.toMillis() / 3, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdown();
        releaseLeadership();
    }

    private void tryAcquireLeadership() {
        try {
            Instant now = Instant.now();
            Instant leaseExpiry = now.plus(leaseDuration);

            int updated = jdbcTemplate.update("""
                UPDATE leader_election 
                SET instance_id = ?, lease_expires_at = ?
                WHERE leader_id = 1 
                  AND (instance_id IS NULL 
                       OR instance_id = ? 
                       OR lease_expires_at < ?)
                """, instanceId, leaseExpiry, instanceId, now);

            if (updated > 0) {
                if (!isLeader) {
                    isLeader = true;
                    onBecomeLeader();
                }
                renewLease();
            } else {
                if (isLeader) {
                    isLeader = false;
                    onLeadershipLost();
                }
            }
        } catch (Exception e) {
            log.error("Leader election failed", e);
        }
    }

    private void renewLease() {
        jdbcTemplate.update(
            "UPDATE leader_election SET lease_expires_at = ? WHERE instance_id = ?",
            Instant.now().plus(leaseDuration), instanceId);
    }

    private void releaseLeadership() {
        jdbcTemplate.update(
            "UPDATE leader_election SET instance_id = NULL, lease_expires_at = NULL " +
            "WHERE instance_id = ?", instanceId);
    }

    public boolean isLeader() { return isLeader; }

    private void onBecomeLeader() {
        log.info("Instance {} became leader", instanceId);
    }

    private void onLeadershipLost() {
        log.info("Instance {} lost leadership", instanceId);
    }
}
```

### Using ShedLock for Scheduled Task Coordination

```java
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT30M")
public class SchedulerConfiguration {

    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(dataSource);
    }
}

@Component
public class CoordinatedTaskService {

    @Scheduled(cron = "0 0 2 * * ?")
    @SchedulerLock(name = "dailyReportGeneration", 
                   lockAtLeastFor = "PT1H", 
                   lockAtMostFor = "PT2H")
    public void generateDailyReports() {
        log.info("Generating daily reports on this instance");
        reportService.generateDailyReports();
    }

    @Scheduled(fixedRate = 300000)
    @SchedulerLock(name = "cacheEviction", lockAtLeastFor = "PT4M")
    public void evictExpiredCacheEntries() {
        log.info("Evicting expired cache entries");
        cacheManager.evictExpiredEntries();
    }
}
```

## Common Mistakes

### Missing Lock Timeout

```java
// Wrong: Lock without timeout - can cause permanent deadlock
redisTemplate.opsForValue().setIfAbsent("lock:resource", "instance-1");
```

```java
// Correct: Lock with timeout prevents deadlock
redisTemplate.opsForValue().setIfAbsent("lock:resource", "instance-1", 
    Duration.ofSeconds(30));
```

### Non-Atomic Release Check

```java
// Wrong: Race condition in lock release
if (redisTemplate.opsForValue().get("lock").equals(ownerId)) {
    redisTemplate.delete("lock"); // Another instance may have acquired it by now
}
```

```java
// Correct: Atomic release using Lua script
String script = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    else
        return 0
    end
    """;
redisTemplate.execute(new DefaultRedisScript<>(script, Long.class), 
    List.of("lock"), ownerId);
```

### Ignoring Clock Drift

Clock drift can cause issues with time-based locks, especially in the Redlock algorithm:

```java
// Mitigation: Ensure clock synchronization and use reasonable timeouts
@Value("${redlock.clockDriftFactor:0.01}")
private double clockDriftFactor;

public boolean isValid(RedlockInstance lock, long elapsed) {
    long validity = (long) (lock.ttlMillis() * (1 - clockDriftFactor));
    return elapsed <= validity;
}
```

## Best Practices

1. Always set timeouts on distributed locks to prevent deadlocks.
2. Use atomic operations (Lua scripts) for lock acquisition and release.
3. Use ZooKeeper or etcd when strong consistency is required.
4. Use Redis when low latency and high throughput are priorities.
5. Implement lock renewal (heartbeat) for long-running critical sections.
6. Make lock release idempotent and safe to call multiple times.
7. Use leader election for designating a single coordinator, not for mutual exclusion on resources.

## Comparison of Lock Providers

| Provider | Consistency | Performance | Complexity |
|----------|-------------|-------------|------------|
| Redis (single) | Best-effort | Very high | Low |
| Redlock | Probabilistic | High | Medium |
| ZooKeeper | Strong | Medium | High |
| etcd | Strong | Medium | High |
| Database | Strong | Low | Low |

## Summary

Distributed locks and leader election are essential coordination patterns for distributed systems. Redis provides high-performance locks suitable for most use cases, ZooKeeper and etcd provide stronger consistency guarantees, and database-based approaches offer simplicity at lower performance. Choose your coordination mechanism based on your consistency requirements, latency tolerance, and operational complexity budget.

## References

- "Distributed Systems" by Maarten van Steen and Andrew S. Tanenbaum
- Redlock algorithm by Salvatore Sanfilippo
- ZooKeeper documentation
- ShedLock documentation

Happy Coding