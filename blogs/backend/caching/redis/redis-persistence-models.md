---
title: "Redis Persistence Models"
description: "Compare Redis persistence models: RDB snapshots, AOF logs, and hybrid persistence for data durability"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - caching
  - redis
  - persistence
  - rdb
  - aof
coverImage: "/images/redis-persistence-models.png"
draft: false
---

# Redis Persistence Models

## Overview

Redis offers two persistence models: **RDB** (Redis Database) snapshots and **AOF** (Append-Only File) logs. Each has different performance, durability, and recovery characteristics. Redis 7.0+ also supports a hybrid approach combining both.

### Why Persistence Matters

| Scenario | Without Persistence | With Persistence |
|----------|-------------------|-----------------|
| Server crash | All data lost | Data recovered on restart |
| Power failure | Complete data loss | Data from last save point |
| Maintenance restart | Cache miss storm | Warm cache immediately |
| Data integrity | No recovery possible | Predictable recovery |

---

## RDB (Redis Database) Snapshots

### How RDB Works

RDB creates point-in-time snapshots of the entire dataset:

```conf
# redis.conf - RDB Configuration
# Save conditions (save <seconds> <changes>)
save 900 1       # Save if at least 1 key changed in 900 seconds
save 300 10      # Save if at least 10 keys changed in 300 seconds
save 60 10000    # Save if at least 10000 keys changed in 60 seconds

# RDB file configuration
dbfilename dump.rdb
dir /data

# Compression (default: yes)
rdbcompression yes

# Checksum (default: yes)
rdbchecksum yes

# Stop writes on BGSAVE error
stop-writes-on-bgsave-error yes
```

### Manual Snapshots

```bash
# Save synchronously (blocks Redis)
redis-cli SAVE

# Save asynchronously (forks, non-blocking)
redis-cli BGSAVE

# Check last save time
redis-cli LASTSAVE
```

### RDB Internals

```java
// RDB creates a fork of the Redis process
// The child process writes the snapshot while parent continues serving

@Service
public class RdbManager {

    private final RedisTemplate<String, Object> redisTemplate;

    public void triggerBackup() {
        RedisConnection connection = redisTemplate.getConnectionFactory()
            .getConnection();
        try {
            // Trigger BGSAVE
            connection.bgSave();
            log.info("RDB snapshot triggered");

            // Monitor progress
            while (true) {
                String info = getInfo("persistence");
                if (info.contains("rdb_bgsave_in_progress:0")) {
                    log.info("RDB snapshot completed");
                    break;
                }
                Thread.sleep(1000);
            }
        } catch (Exception e) {
            log.error("RDB snapshot failed", e);
        } finally {
            connection.close();
        }
    }

    private String getInfo(String section) {
        return redisTemplate.execute(
            (RedisCallback<String>) connection ->
                new String(connection.info(section))
        );
    }
}
```

---

## AOF (Append-Only File)

### How AOF Works

AOF logs every write operation to a file:

```conf
# redis.conf - AOF Configuration
# Enable AOF
appendonly yes

# AOF filename
appendfilename "appendonly.aof"

# fsync policy:
# always: fsync after every write (safest, slowest)
# everysec: fsync once per second (recommended)
# no: let OS decide (fastest, least safe)
appendfsync everysec

# AOF rewrite trigger
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# No fsync during rewrite (prevents I/O storms)
no-appendfsync-on-rewrite no

# Load truncated AOF on startup
aof-load-truncated yes

# Use RDB preamble (Redis 5+)
aof-use-rdb-preamble yes
```

### AOF Rewrite

```java
@Service
public class AofManager {

    private final RedisTemplate<String, Object> redisTemplate;

    // AOF logs grow over time
    // Example AOF entries for incrementing a key 1000 times:
    //
    // Without rewrite: 1000 SET operations
    // After rewrite: 1 SET operation (final value)
    //
    // This is what BGREWRITEAOF does

    public void triggerRewrite() {
        RedisConnection connection = redisTemplate.getConnectionFactory()
            .getConnection();
        try {
            connection.bgRewriteAof();
            log.info("AOF rewrite triggered");

            // Monitor rewrite progress
            waitForRewrite();
        } finally {
            connection.close();
        }
    }

    public void analyzeAof() {
        // Show AOF stats
        String info = getInfo("persistence");
        log.info("AOF info: {}", info);

        // Check current AOF size
        Properties props = parseInfo(info);
        String aofSize = props.getProperty("aof_current_size", "0");
        String baseSize = props.getProperty("aof_base_size", "0");
        log.info("AOF current: {}MB, base: {}MB",
            Long.parseLong(aofSize) / 1024 / 1024,
            Long.parseLong(baseSize) / 1024 / 1024);
    }

    private void waitForRewrite() {
        // Poll until rewrite completes
    }

    private String getInfo(String section) {
        return redisTemplate.execute(
            (RedisCallback<String>) connection ->
                new String(connection.info(section))
        );
    }

    private Properties parseInfo(String info) {
        Properties props = new Properties();
        for (String line : info.split("\n")) {
            if (line.contains(":")) {
                String[] parts = line.split(":", 2);
                props.setProperty(parts[0].trim(), parts[1].trim());
            }
        }
        return props;
    }
}
```

---

## RDB vs AOF Comparison

### Performance Characteristics

| Aspect | RDB | AOF |
|--------|-----|-----|
| File Size | Smaller (compressed) | Larger (append log) |
| Save Performance | Periodic (fork) | Continuous (append) |
| Load Performance | Very fast | Slower (replay) |
| Data Loss | Last snapshot | 1 second (everysec) / 0 (always) |

### Durability Trade-offs

```conf
# Maximum data loss scenarios:

# RDB (save 900 1):
# At most 15 minutes of data loss

# AOF (appendfsync everysec):
# At most 1 second of data loss

# AOF (appendfsync always):
# Zero data loss (but slow writes)

# RDB + AOF (hybrid):
# AOF file contains RDB preamble for fast load
# Plus incremental AOF for recent changes
```

### Memory and CPU Impact

```java
// RDB: Fork impact for large datasets
// A 10GB Redis dataset creates ~10GB copy-on-write memory during BGSAVE
// Ensure system has enough memory for COW

// AOF: Write amplification
// Each write command is logged (can be reduced with RDB preamble)
// AOF rewrite also requires fork (like RDB)

// Hybrid (RDB + AOF):
// AOF rewrite generates RDB preamble + incremental AOF
// Faster rewrite and load compared to full AOF
```

---

## Hybrid Persistence

### Configuration

```conf
# redis.conf - Hybrid persistence (Redis 5+)
appendonly yes
aof-use-rdb-preamble yes

# RDB conditions (for hybrid)
save 900 1
save 300 10
save 60 10000

# AOF settings
appendfsync everysec
no-appendfsync-on-rewrite yes
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

### How Hybrid Works

```
AOF file structure with RDB preamble:

┌─────────────────────────────┐
│    RDB binary data          │  ← Full snapshot (fast load)
│    (all keys up to point)   │
├─────────────────────────────┤
│    AOF incremental data     │  ← Recent commands
│    (changes after snapshot) │  ← Small size
│                             │
└─────────────────────────────┘

On restart:
1. Load RDB preamble (fast, like RDB)
2. Apply AOF increments (fast, small log)
```

---

## Persistence Monitoring

### Monitoring Scripts

```java
@Component
public class PersistenceMonitor {

    private final RedisTemplate<String, Object> redisTemplate;

    @Scheduled(fixedRate = 60_000)
    public void monitorPersistence() {
        String info = getInfo("persistence");

        Map<String, String> metrics = parseInfo(info);

        // Check RDB status
        String rdbStatus = metrics.get("rdb_last_bgsave_status");
        if (!"ok".equals(rdbStatus)) {
            log.error("Last RDB save failed: {}", rdbStatus);
        }

        // Check AOF status
        String aofStatus = metrics.get("aof_last_bgrewrite_status");
        if (!"ok".equals(aofStatus)) {
            log.error("Last AOF rewrite failed: {}", aofStatus);
        }

        // Check last save time
        long lastSave = Long.parseLong(metrics.getOrDefault(
            "rdb_last_save_time", "0"));
        long ageMinutes = (System.currentTimeMillis() / 1000 - lastSave) / 60;

        if (ageMinutes > 60) {
            log.warn("Last RDB save was {} minutes ago", ageMinutes);
        }

        // Log persistence metrics
        log.info("Persistence status - RDB: {}, AOF: {}, last save: {}m ago",
            rdbStatus, aofStatus, ageMinutes);
    }

    private String getInfo(String section) {
        return redisTemplate.execute(
            (RedisCallback<String>) connection ->
                new String(connection.info(section))
        );
    }
}
```

### Prometheus Metrics

```yaml
# Prometheus Redis exporter exposes persistence metrics
redis_rdb_last_save_timestamp_seconds
redis_rdb_bgsave_in_progress
redis_rdb_last_bgsave_status
redis_aof_enabled
redis_aof_rewrite_in_progress
redis_aof_last_rewrite_status
redis_aof_current_size_bytes
```

---

## Backup Strategy

### Automated Backups

```bash
#!/bin/bash
# redis-backup.sh

BACKUP_DIR="/backups/redis"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REDIS_DATA="/data/redis"

# Trigger BGSAVE
redis-cli BGSAVE

# Wait for save to complete
while [ "$(redis-cli INFO persistence | grep rdb_bgsave_in_progress:1)" != "" ]; do
    sleep 1
done

# Copy RDB file
cp "$REDIS_DATA/dump.rdb" "$BACKUP_DIR/redis_$TIMESTAMP.rdb"

# Copy AOF file
cp "$REDIS_DATA/appendonly.aof" "$BACKUP_DIR/redis_aof_$TIMESTAMP.aof"

# Compress
gzip "$BACKUP_DIR/redis_$TIMESTAMP.rdb"
gzip "$BACKUP_DIR/redis_aof_$TIMESTAMP.aof"

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "redis_*.gz" -mtime +30 -delete

echo "Backup completed: redis_$TIMESTAMP.rdb.gz"
```

---

## Best Practices

### 1. Production Recommendation

```conf
# Production persistence configuration
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
save 900 1
save 300 10
save 60 10000
```

### 2. Monitor Disk Space

```java
// AOF files can grow significantly between rewrites
// Monitor and alert on AOF size growth

public boolean checkAofDiskAvailable() {
    String aofSize = getInfoValue("aof_current_size");
    long sizeBytes = Long.parseLong(aofSize);
    long maxSize = 1024L * 1024 * 1024; // 1GB

    if (sizeBytes > maxSize) {
        log.warn("AOF file too large: {}MB", sizeBytes / 1024 / 1024);
        triggerRewrite();
        return false;
    }
    return true;
}
```

---

## Common Mistakes

### Mistake 1: Disabling Persistence in Production

```conf
# WRONG: No persistence in production
# save ""
# appendonly no

# CORRECT: Enable persistence
appendonly yes
save 60 10000
```

### Mistake 2: Incompatible AOF fsync Settings

```conf
# WRONG: appendfsync always with high write throughput
# FSync after every write kills performance

# CORRECT: appendfsync everysec for most use cases
appendfsync everysec
```

### Mistake 3: Not Configuring Rewrite Limits

```conf
# WRONG: Never rewriting AOF
auto-aof-rewrite-percentage 0  # Disables rewrite
# AOF grows unbounded!

# CORRECT: Configure reasonable rewrite limits
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

---

## Summary

| Aspect | RDB | AOF | Hybrid |
|--------|-----|-----|--------|
| Data Loss Window | Last snapshot | 0-1 sec | 0-1 sec |
| Load Time | Very fast | Slow | Fast |
| File Size | Small | Large | Medium |
| Write Performance | Excellent | Good | Good |
| Complexity | Low | Medium | Medium |

For production, use hybrid persistence (AOF with RDB preamble) for the best balance of durability, load time, and file size.

---

## References

- [Redis Persistence Documentation](https://redis.io/docs/management/persistence/)
- [Redis RDB Format](https://github.com/sripathikrishnan/redis-rdb-tools)
- [AOF Rewrite](https://redis.io/commands/bgrewriteaof/)

Happy Coding