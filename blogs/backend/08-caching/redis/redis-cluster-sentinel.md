---
title: Redis Cluster and Sentinel
description: >-
  Configure Redis Cluster and Sentinel for high availability: replication,
  failover, sharding, and production deployment
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - caching
  - redis
  - cluster
  - sentinel
  - high-availability
coverImage: /images/redis-cluster-sentinel.png
draft: false
order: 10
---
# Redis Cluster and Sentinel

## Overview

Redis offers two high-availability solutions: **Sentinel** for automatic failover with a single master and multiple replicas, and **Cluster** for horizontal scaling with automatic sharding and distributed data. This guide covers both approaches in depth.

### When to Use Which

| Feature | Sentinel | Cluster |
|---------|----------|---------|
| Data sharding | No (all nodes have full data) | Yes (hash slots across nodes) |
| Max throughput | Single node write capacity | Linear scaling with nodes |
| Complexity | Low | Medium |
| Consistency | Eventually consistent | Eventually consistent |
| Minimum nodes | 2 (1 master + 1 replica) | 6 (3 masters + 3 replicas) |

---

## Redis Sentinel

### Architecture

Three Sentinel processes monitor the master and replicas. If the master fails, the Sentinels use a quorum-based election to promote a replica to master. The application connects through Sentinels to discover the current master.

```mermaid
graph LR
    S1["Sentinel-1"]
    S2["Sentinel-2"]
    S3["Sentinel-3"]
    M["Master"]
    R1["Replica-1"]
    R2["Replica-2"]
    APP["Application"]

    S1 --- M
    S2 --- M
    S3 --- M
    M --> R1
    M --> R2
    APP --- S1
    APP --- S2
    APP --- S3

    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff
    linkStyle default stroke:#278ea5
```

### Sentinel Configuration

The quorum of 2 in `sentinel monitor` means at least 2 Sentinels must agree that the master is down before a failover is initiated. This prevents split-brain scenarios.

```conf
# sentinel.conf
port 26379
sentinel monitor mymaster 127.0.0.1 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
sentinel auth-pass mymaster mypassword
```

### Docker Compose

The Docker Compose setup below deploys one master, two replicas, and three Sentinels. Each Sentinel has its own configuration file for independent monitoring.

```yaml
version: '3.8'
services:
  redis-master:
    image: redis:7.2
    container_name: redis-master
    command: redis-server --appendonly yes --requirepass mypassword
    ports:
      - "6379:6379"
    volumes:
      - redis-master-data:/data
    networks:
      - redis-sentinel

  redis-replica-1:
    image: redis:7.2
    container_name: redis-replica-1
    command: >
      redis-server --appendonly yes
      --replicaof redis-master 6379
      --masterauth mypassword
      --requirepass mypassword
    volumes:
      - redis-replica-1-data:/data
    depends_on:
      - redis-master
    networks:
      - redis-sentinel

  redis-replica-2:
    image: redis:7.2
    container_name: redis-replica-2
    command: >
      redis-server --appendonly yes
      --replicaof redis-master 6379
      --masterauth mypassword
      --requirepass mypassword
    volumes:
      - redis-replica-2-data:/data
    depends_on:
      - redis-master
    networks:
      - redis-sentinel

  sentinel-1:
    image: redis:7.2
    container_name: sentinel-1
    command: >
      redis-sentinel --port 26379
    volumes:
      - ./sentinel/sentinel-1.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26379:26379"
    depends_on:
      - redis-master
    networks:
      - redis-sentinel

  sentinel-2:
    image: redis:7.2
    container_name: sentinel-2
    command: >
      redis-sentinel --port 26379
    volumes:
      - ./sentinel/sentinel-2.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26380:26379"
    depends_on:
      - redis-master
    networks:
      - redis-sentinel

  sentinel-3:
    image: redis:7.2
    container_name: sentinel-3
    command: >
      redis-sentinel --port 26379
    volumes:
      - ./sentinel/sentinel-3.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26381:26379"
    depends_on:
      - redis-master
    networks:
      - redis-sentinel

volumes:
  redis-master-data:
  redis-replica-1-data:
  redis-replica-2-data:

networks:
  redis-sentinel:
    driver: bridge
```

### Spring Boot Sentinel Configuration

Spring Boot's Lettuce client connects to the Sentinels to discover the current master. The `readFrom(REPLICA_PREFERRED)` setting routes reads to replicas, offloading the master.

```yaml
spring:
  redis:
    sentinel:
      master: mymaster
      nodes:
        - sentinel-1:26379
        - sentinel-2:26379
        - sentinel-3:26379
    password: mypassword
    lettuce:
      pool:
        max-active: 32
        max-idle: 16
        min-idle: 8
```

```java
@Configuration
public class RedisSentinelConfig {

    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        RedisSentinelConfiguration sentinelConfig = new RedisSentinelConfiguration()
            .master("mymaster")
            .sentinel("sentinel-1", 26379)
            .sentinel("sentinel-2", 26379)
            .sentinel("sentinel-3", 26379);

        sentinelConfig.setPassword(RedisPassword.of("mypassword"));

        LettuceClientConfiguration clientConfig = LettuceClientConfiguration.builder()
            .readFrom(ReadFrom.REPLICA_PREFERRED) // Read from replicas
            .commandTimeout(Duration.ofSeconds(5))
            .build();

        return new LettuceConnectionFactory(sentinelConfig, clientConfig);
    }

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer());
        return template;
    }
}
```

### Failover Testing

During a failover, connections are disrupted for ~10 seconds while Sentinels detect the failure, elect a new master, and clients reconnect. The application should handle connection errors gracefully.

```java
@Service
public class SentinelFailoverTest {

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    public void testFailover() {
        // Before failover
        String currentMaster = getCurrentMaster();
        log.info("Current master: {}", currentMaster);

        // When master fails, Sentinel promotes a replica
        // After ~10 seconds, the app reconnects to new master

        // Test if Redis is still available
        try {
            redisTemplate.opsForValue().set("test-key", "value");
            String value = (String) redisTemplate.opsForValue().get("test-key");
            log.info("Test key: {}", value);
        } catch (Exception e) {
            log.error("Redis unavailable during failover: {}", e.getMessage());
        }
    }

    private String getCurrentMaster() {
        RedisConnectionFactory factory = redisTemplate.getConnectionFactory();
        if (factory instanceof LettuceConnectionFactory lettuce) {
            return lettuce.getHostName() + ":" + lettuce.getPort();
        }
        return "unknown";
    }
}
```

---

## Redis Cluster

### Architecture

Redis Cluster distributes data across shards using hash slots. The diagram below shows 3 master nodes, each with a replica, covering all 16,384 hash slots.

```mermaid
graph TB
    subgraph "Hash Slot 0-5461"
        M1["Master-1"]
        R1["Replica-1"]
    end

    subgraph "Hash Slot 5462-10923"
        M2["Master-2"]
        R2["Replica-2"]
    end

    subgraph "Hash Slot 10924-16383"
        M3["Master-3"]
        R3["Replica-3"]
    end

    M1 --- M2
    M2 --- M3
    M3 --- M1

    classDef green fill:#17b978,stroke:#333,stroke-width:2px,color:#fff
    classDef blue fill:#3d5af1,stroke:#333,stroke-width:2px,color:#fff
    classDef pink fill:#f3558e,stroke:#333,stroke-width:2px,color:#fff
    classDef yellow fill:#FFA213,stroke:#333,stroke-width:2px,color:#fff
    linkStyle default stroke:#278ea5
```

### Cluster Configuration

```conf
# redis-cluster.conf
port 7000
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 5000
appendonly yes
daemonize no
```

### Docker Compose Cluster

The Docker Compose setup creates 3 cluster nodes and an init container that runs the `redis-cli --cluster create` command to join them into a cluster.

```yaml
version: '3.8'
services:
  redis-cluster-1:
    image: redis:7.2
    container_name: redis-cluster-1
    command: redis-server --port 7000 --cluster-enabled yes
        --cluster-config-file nodes.conf --cluster-node-timeout 5000
        --appendonly yes
    ports:
      - "7000:7000"
      - "17000:17000"
    volumes:
      - cluster-node-1:/data
    networks:
      - redis-cluster

  redis-cluster-2:
    image: redis:7.2
    container_name: redis-cluster-2
    command: redis-server --port 7001 --cluster-enabled yes
        --cluster-config-file nodes.conf --cluster-node-timeout 5000
        --appendonly yes
    ports:
      - "7001:7001"
      - "17001:17001"
    volumes:
      - cluster-node-2:/data
    networks:
      - redis-cluster

  redis-cluster-3:
    image: redis:7.2
    container_name: redis-cluster-3
    command: redis-server --port 7002 --cluster-enabled yes
        --cluster-config-file nodes.conf --cluster-node-timeout 5000
        --appendonly yes
    ports:
      - "7002:7002"
      - "17002:17002"
    volumes:
      - cluster-node-3:/data
    networks:
      - redis-cluster

  redis-cluster-init:
    image: redis:7.2
    container_name: redis-cluster-init
    entrypoint: [/bin/sh, -c]
    command: |
      redis-cli --cluster create
        redis-cluster-1:7000
        redis-cluster-2:7001
        redis-cluster-3:7002
        --cluster-replicas 0
    depends_on:
      - redis-cluster-1
      - redis-cluster-2
      - redis-cluster-3
    networks:
      - redis-cluster

volumes:
  cluster-node-1:
  cluster-node-2:
  cluster-node-3:

networks:
  redis-cluster:
    driver: bridge
```

### Spring Boot Cluster Configuration

Spring Boot's Redis Cluster support automatically handles hash slot routing, redirects, and adaptive topology refresh.

```yaml
spring:
  redis:
    cluster:
      nodes:
        - redis-cluster-1:7000
        - redis-cluster-2:7001
        - redis-cluster-3:7002
      max-redirects: 3
    lettuce:
      cluster:
        refresh:
          adaptive: true
          period: 2000
      pool:
        max-active: 32
        max-idle: 16
        min-idle: 8
```

```java
@Configuration
public class RedisClusterConfig {

    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        RedisClusterConfiguration clusterConfig = new RedisClusterConfiguration()
            .clusterNode("redis-cluster-1", 7000)
            .clusterNode("redis-cluster-2", 7001)
            .clusterNode("redis-cluster-3", 7002);

        clusterConfig.setMaxRedirects(3);

        LettuceClientConfiguration clientConfig = LettuceClientConfiguration.builder()
            .readFrom(ReadFrom.REPLICA_PREFERRED)
            .commandTimeout(Duration.ofSeconds(5))
            .build();

        return new LettuceConnectionFactory(clusterConfig, clientConfig);
    }
}
```

### Hash Slot Awareness

In Cluster mode, keys with the same hash tag (`{...}`) are guaranteed to be in the same hash slot, enabling multi-key operations within that slot.

```java
@Service
public class ClusterAwareService {

    private final RedisTemplate<String, Object> redisTemplate;

    // In cluster mode, keys are distributed across slots
    // Related keys should share the same slot using hash tags

    public void storeRelatedData(String userId, String data) {
        // Keys with {userId} will be in the same hash slot
        redisTemplate.opsForValue().set("user:{userId}:profile", data);
        redisTemplate.opsForValue().set("user:{userId}:settings", moreData);
        redisTemplate.opsForValue().set("user:{userId}:preferences", preferences);
        // All three keys are on the same node
    }

    // Multi-key operations only work on same-slot keys
    public void atomicUpdate(String userId) {
        redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
            byte[] key1 = ("user:" + userId + ":profile").getBytes();
            byte[] key2 = ("user:" + userId + ":settings").getBytes();
            connection.stringCommands().get(key1);
            connection.stringCommands().get(key2);
            return null;
        });
    }
}
```

---

## Comparison

| Aspect | Sentinel | Cluster |
|--------|----------|---------|
| Data Distribution | All nodes have all data | Data sharded across nodes |
| Write Scalability | Limited to master | Scales with nodes |
| Read Scalability | Read from replicas | Read from replicas per shard |
| Failover Time | ~10-30 seconds | < 10 seconds |
| Multi-key Operations | Full support | Only within same hash slot |
| Transactions | Full support | Limited to same slot |
| Minimum Nodes | 3 Sentinel + 1 master + 1 replica | 3 masters + 3 replicas |

---

## Best Practices

### 1. Use Connection Pooling

Lettuce connection pooling manages the number of concurrent connections to Redis, preventing resource exhaustion.

```yaml
spring:
  redis:
    lettuce:
      pool:
        max-active: 32
        max-idle: 16
        min-idle: 8
        time-between-eviction-runs: 30s
```

### 2. Configure Read Preference

Routing reads to replicas offloads the master, improving overall throughput for read-heavy workloads.

```java
// Prefer replica reads for read-heavy workloads
LettuceClientConfiguration.builder()
    .readFrom(ReadFrom.REPLICA_PREFERRED)
    .build();
```

### 3. Handle Failover Gracefully

Cache disruptions during failover with a database fallback to maintain availability.

```java
@Service
public class ResilientRedisService {

    public Object getWithFallback(String key) {
        try {
            return redisTemplate.opsForValue().get(key);
        } catch (RedisException e) {
            log.warn("Redis unavailable, falling back to database");
            return loadFromDatabase(key);
        }
    }
}
```

---

## Common Mistakes

### Mistake 1: Not Enough Sentinel Nodes

A single Sentinel cannot form a quorum and creates a single point of failure for the monitoring system itself.

```conf
# WRONG: Single sentinel
sentinel monitor mymaster 127.0.0.1 6379 1

# CORRECT: Three sentinels for quorum
sentinel monitor mymaster 127.0.0.1 6379 2
```

### Mistake 2: Cross-Slot Multi-Key Operations in Cluster

Keys in different hash slots cannot be operated on atomically in Cluster mode. Use hash tags to co-locate related keys.

```java
// WRONG: Keys in different slots
redisTemplate.opsForValue().multiSet(Map.of(
    "user:1", "Alice",
    "order:1", "Details"
));

// CORRECT: Use hash tags for related keys
redisTemplate.opsForValue().multiSet(Map.of(
    "{user}:1", "Alice",
    "{user}:1:order", "Details"
));
```

---

## Summary

Choose Sentinel for simplicity and when a single master suffices. Choose Cluster for horizontal scaling needs. Both provide automatic failover with proper configuration.

---

## References

- [Redis Sentinel Documentation](https://redis.io/docs/management/sentinel/)
- [Redis Cluster Documentation](https://redis.io/docs/management/clustering/)
- [Spring Data Redis Cluster](https://docs.spring.io/spring-data/data-redis/docs/current/reference/html/#cluster)

Happy Coding
