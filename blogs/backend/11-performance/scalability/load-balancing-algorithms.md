---
title: Load Balancing Algorithms
description: >-
  Explore load balancing algorithms: round-robin, least connections, consistent
  hashing, and weighted distribution
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - performance
  - scalability
  - load-balancing
  - algorithms
coverImage: /images/load-balancing-algorithms.png
draft: false
order: 30
---
# Load Balancing Algorithms

## Overview

Load balancing distributes incoming traffic across multiple backend servers. The choice of algorithm affects throughput, latency, and resource utilization.

### Algorithm Types

| Algorithm | Distribution | Use Case |
|-----------|-------------|----------|
| Round Robin | Even, sequential | Equal-capacity servers |
| Least Connections | Based on active connections | Variable request duration |
| IP Hash | Based on client IP | Session persistence |
| Consistent Hashing | Minimal redistribution | Cache affinity |
| Weighted | Based on capacity | Heterogeneous servers |

---

## Round Robin

### Nginx Configuration

```nginx
# Round robin (default)
upstream backend {
    server backend1:8080;
    server backend2:8080;
    server backend3:8080;
}
```

### Spring Cloud LoadBalancer

```java
@Configuration
public class LoadBalancerConfig {

    @Bean
    public ReactorLoadBalancer<ServiceInstance> roundRobinLoadBalancer(
            Environment environment,
            LoadBalancerClientFactory loadBalancerClientFactory) {

        String serviceId = environment.getProperty(
            "loadbalancer.client.name");

        return new RoundRobinLoadBalancer(
            loadBalancerClientFactory.getLazyProvider(
                serviceId, ServiceInstanceListSupplier.class),
            serviceId
        );
    }
}

@Service
public class RoundRobinClient {

    @Autowired
    private LoadBalancerClient loadBalancer;

    public void callService() {
        ServiceInstance instance = loadBalancer.choose("order-service");
        // Round-robin selects next instance

        String url = "http://" + instance.getHost() + ":" +
                     instance.getPort() + "/api/orders";
        restTemplate.getForObject(url, List.class);
    }
}
```

Round robin is the simplest and most predictable distribution: each backend gets an equal share of requests in a fixed cyclic order. Its limitation becomes apparent when request durations vary widely — a slow request to backend-1 ties up that connection while backend-2 and backend-3 are already idle and ready for new work. This is why least-connections is preferred for heterogeneous or variable-duration workloads. Round robin shines when all backends are equally sized and requests complete in roughly the same time — for example, in a fleet of identical stateless API servers serving uniform CRUD endpoints.

---

## Least Connections

### Nginx Configuration

```nginx
upstream backend {
    least_conn;
    server backend1:8080;
    server backend2:8080;
    server backend3:8080;
}
```

### Custom Implementation

```java
@Component
public class LeastConnectionsLoadBalancer implements ServiceInstanceLoadBalancer {

    private final Map<String, AtomicInteger> connectionCounts = new ConcurrentHashMap<>();

    @Override
    public Mono<Response<ServiceInstance>> choose(Request request) {
        List<ServiceInstance> instances = getInstances();

        return Mono.just(instances)
            .filter(list -> !list.isEmpty())
            .map(this::selectLeastConnections)
            .map(instance -> {
                String key = instance.getInstanceId();
                connectionCounts.computeIfAbsent(key,
                    k -> new AtomicInteger(0)).incrementAndGet();
                return Response.just(instance);
            })
            .defaultIfEmpty(Response.error());
    }

    private ServiceInstance selectLeastConnections(List<ServiceInstance> instances) {
        return instances.stream()
            .min(Comparator.comparingInt(instance ->
                connectionCounts.getOrDefault(
                    instance.getInstanceId(), new AtomicInteger(0)).get()))
            .orElseThrow();
    }

    public void releaseConnection(String instanceId) {
        AtomicInteger count = connectionCounts.get(instanceId);
        if (count != null) {
            count.decrementAndGet();
        }
    }
}
```

The implementation tracks active connections per instance using `AtomicInteger` counters. `choose()` selects the instance with the smallest count and immediately increments it before the request starts; `releaseConnection()` is called when the response completes. In production, the counter approach must handle failures — if a backend crashes, its `AtomicInteger` never gets decremented, so the balancer should periodically reset counters for instances that fail health checks. Least connections performs best when request durations are variable (e.g., mixed fast queries and slow report generation), because it naturally distributes more fast requests to the same instance that is also handling a slow one.

---

## Consistent Hashing

### Use Case: Cache Affinity

```java
@Component
public class ConsistentHashLoadBalancer {

    private final TreeMap<Integer, ServiceInstance> hashRing = new TreeMap<>();
    private final int virtualNodes = 150;

    public ConsistentHashLoadBalancer(List<ServiceInstance> instances) {
        for (ServiceInstance instance : instances) {
            addInstance(instance);
        }
    }

    public void addInstance(ServiceInstance instance) {
        for (int i = 0; i < virtualNodes; i++) {
            String key = instance.getInstanceId() + ":" + i;
            int hash = hash(key);
            hashRing.put(hash, instance);
        }
    }

    public void removeInstance(ServiceInstance instance) {
        for (int i = 0; i < virtualNodes; i++) {
            String key = instance.getInstanceId() + ":" + i;
            int hash = hash(key);
            hashRing.remove(hash);
        }
    }

    public ServiceInstance getInstance(String requestKey) {
        if (hashRing.isEmpty()) {
            throw new IllegalStateException("No instances available");
        }

        int hash = hash(requestKey);
        Map.Entry<Integer, ServiceInstance> entry = hashRing.ceilingEntry(hash);

        if (entry == null) {
            entry = hashRing.firstEntry(); // Wrap around
        }

        return entry.getValue();
    }

    private int hash(String key) {
        // Murmur3 hash for uniform distribution
        return HashUtil.murmur3_32(key.getBytes());
    }

    // This ensures the same user always hits the same backend
    // Useful for local caches or sticky sessions
    public ServiceInstance getInstanceForUser(String userId) {
        return getInstance("user:" + userId);
    }
}
```

Consistent hashing is the best choice when backend affinity matters — for example, when each server maintains an in-memory cache, and you want the same user or same resource to always hit the same server to maximize cache hits. The `virtualNodes` parameter (150 in the implementation above) controls distribution smoothness: without virtual nodes, adding or removing a server causes uneven load distribution because the hash ring has only as many points as servers. With 150 virtual nodes per server, the ring has 600+ points, and removing one server redistributes only ~1/4 of its keys to each remaining server instead of causing a full rehash.

### Nginx Consistent Hashing

```nginx
# Consistent hash based on request URI
upstream backend {
    hash $request_uri consistent;
    server backend1:8080;
    server backend2:8080;
    server backend3:8080;
}

# Hash based on client IP (sticky sessions)
upstream backend_sticky {
    hash $remote_addr consistent;
    server backend1:8080;
    server backend2:8080;
}
```

---

## Weighted Load Balancing

### Configuration

```nginx
# Weighted distribution (weight = capacity ratio)
upstream backend {
    server backend1:8080 weight=5;  # 50% capacity
    server backend2:8080 weight=3;  # 30% capacity
    server backend3:8080 weight=2;  # 20% capacity
}
```

### Implementation

```java
@Component
public class WeightedRoundRobinLoadBalancer {

    private final List<WeightedServer> servers;
    private int currentIndex = -1;
    private int currentWeight = 0;

    public WeightedRoundRobinLoadBalancer(List<WeightedServer> servers) {
        this.servers = new ArrayList<>(servers);
    }

    public WeightedServer getNextServer() {
        int totalWeight = servers.stream()
            .mapToInt(WeightedServer::getWeight).sum();

        while (true) {
            currentIndex = (currentIndex + 1) % servers.size();

            if (currentIndex == 0) {
                currentWeight = currentWeight - gcd();
                if (currentWeight <= 0) {
                    currentWeight = maxWeight();
                    if (currentWeight == 0) {
                        return null;
                    }
                }
            }

            WeightedServer server = servers.get(currentIndex);
            if (server.getWeight() >= currentWeight) {
                return server;
            }
        }
    }

    private int gcd() {
        return servers.stream()
            .mapToInt(WeightedServer::getWeight)
            .reduce(this::gcd)
            .orElse(1);
    }

    private int gcd(int a, int b) {
        return b == 0 ? a : gcd(b, a % b);
    }

    private int maxWeight() {
        return servers.stream()
            .mapToInt(WeightedServer::getWeight)
            .max()
            .orElse(1);
    }
}

class WeightedServer {
    private final String host;
    private final int port;
    private final int weight;
    // getters...
}
```

---

## Health Checks

### Passive Health Check (Nginx)

```nginx
upstream backend {
    server backend1:8080 max_fails=3 fail_timeout=30s;
    server backend2:8080 max_fails=3 fail_timeout=30s;
}
```

### Active Health Check (Spring Boot)

```java
@Component
public class HealthCheckLoadBalancer {

    @Scheduled(fixedRate = 10_000)
    public void performHealthChecks() {
        for (ServiceInstance instance : getInstances()) {
            try {
                String url = "http://" + instance.getHost() + ":" +
                             instance.getPort() + "/actuator/health";

                ResponseEntity<String> response = restTemplate
                    .getForEntity(url, String.class);

                boolean healthy = response.getStatusCode().is2xxSuccessful();

                if (!healthy) {
                    markUnhealthy(instance);
                    log.warn("Instance {} is unhealthy", instance.getInstanceId());
                }
            } catch (Exception e) {
                markUnhealthy(instance);
                log.error("Health check failed for {}", instance.getInstanceId(), e);
            }
        }
    }

    private void markUnhealthy(ServiceInstance instance) {
        // Remove from rotation
        unhealthyInstances.add(instance.getInstanceId());
    }
}
```

---

## Algorithm Selection Guide

| Requirement | Algorithm |
|------------|-----------|
| Equal capacity servers | Round Robin |
| Variable request duration | Least Connections |
| Session persistence | IP Hash |
| Cache affinity | Consistent Hashing |
| Heterogeneous servers | Weighted |
| Minimum redistribution | Consistent Hashing |

---

## Common Mistakes

### Mistake 1: Round Robin with Heterogeneous Servers

```nginx
# WRONG: Round robin with different capacity servers
upstream backend {
    server big-server:8080;  # 16 CPU, 64GB RAM
    server small-server:8080; # 2 CPU, 8GB RAM
    # Big server gets same load as small!
}

# CORRECT: Weighted distribution
upstream backend {
    server big-server:8080 weight=8;
    server small-server:8080 weight=1;
}
```

### Mistake 2: No Health Checks

```nginx
# WRONG: No health checks, traffic sent to dead servers
upstream backend {
    server backend1:8080;
    server backend2:8080;
}

# CORRECT: With health checks
upstream backend {
    server backend1:8080 max_fails=3 fail_timeout=30s;
    server backend2:8080 max_fails=3 fail_timeout=30s;
}
```

### Mistake 3: Sticky Sessions Without Fallback

```nginx
# WRONG: Sticky sessions without backup
upstream backend {
    ip_hash;
    server backend1:8080;
    server backend2:8080;
    # If backend1 fails, user loses session
}

# CORRECT: Sticky with consistent hashing
upstream backend {
    hash $remote_addr consistent;
    server backend1:8080;
    server backend2:8080;
    # Minimal redistribution on failure
}
```

---

## Summary

1. Round Robin is simplest but assumes equal capacity
2. Least Connections handles variable request durations
3. Consistent Hashing minimizes cache misses on scaling
4. Weighted algorithms handle heterogeneous servers
5. Always implement health checks
6. Choose algorithm based on workload characteristics
7. Monitor request distribution across backends

---

## References

- [Nginx Load Balancing](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/)
- [AWS Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/)
- [Spring Cloud LoadBalancer](https://spring.io/projects/spring-cloud-commons#loadbalancer)

Happy Coding
