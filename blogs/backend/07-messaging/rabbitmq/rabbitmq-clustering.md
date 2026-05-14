---
title: RabbitMQ Clustering
description: >-
  Deep dive into RabbitMQ clustering: cluster formation, quorum queues, mirrored
  queues, node discovery, network partitioning, and production deployment
  strategies
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - rabbitmq
  - clustering
  - quorum-queues
  - high-availability
coverImage: /images/rabbitmq-clustering.png
draft: false
order: 30
---
## Overview

RabbitMQ clustering enables high availability and horizontal scaling by connecting multiple nodes into a single logical broker. This article covers cluster formation, queue types for HA (mirrored and quorum queues), node discovery, network partition handling, and operational best practices.

## Cluster Formation

A RabbitMQ cluster connects nodes via Erlang distributed messaging. Nodes share metadata (exchanges, bindings, users) but not message data (unless using queues with replication). To join a new node to an existing cluster, stop the RabbitMQ app on the new node, reset its state, join the cluster, and restart. All nodes must share the same Erlang cookie, which is the secret key for inter-node authentication.

```bash
# On node2, join the cluster
rabbitmqctl stop_app
rabbitmqctl reset
rabbitmqctl join_cluster rabbit@node1
rabbitmqctl start_app

# Verify cluster status
rabbitmqctl cluster_status
```

### Docker Compose Cluster

The Docker Compose setup creates a 3-node RabbitMQ cluster with HAProxy for load balancing. Each node is configured with the same `RABBITMQ_ERLANG_COOKIE` for authentication. The `join_cluster` commands in the entrypoint scripts ensure nodes 2 and 3 join node 1 after starting. HAProxy provides a single endpoint for clients and distributes connections across the cluster.

```yaml
version: '3.8'
services:
  rabbitmq-1:
    image: rabbitmq:3.12-management
    hostname: rabbitmq-1
    environment:
      RABBITMQ_ERLANG_COOKIE: "SECRET_ERLANG_COOKIE"
      RABBITMQ_NODENAME: "rabbit@rabbitmq-1"
      RABBITMQ_USE_LONGNAME: "true"

  rabbitmq-2:
    image: rabbitmq:3.12-management
    hostname: rabbitmq-2
    environment:
      RABBITMQ_ERLANG_COOKIE: "SECRET_ERLANG_COOKIE"
      RABBITMQ_NODENAME: "rabbit@rabbitmq-2"
      RABBITMQ_USE_LONGNAME: "true"
    command: >
      sh -c "rabbitmq-server -detached
      && sleep 10
      && rabbitmqctl stop_app
      && rabbitmqctl join_cluster rabbit@rabbitmq-1
      && rabbitmqctl start_app
      && tail -f /dev/null"

  rabbitmq-3:
    image: rabbitmq:3.12-management
    hostname: rabbitmq-3
    environment:
      RABBITMQ_ERLANG_COOKIE: "SECRET_ERLANG_COOKIE"
      RABBITMQ_NODENAME: "rabbit@rabbitmq-3"
      RABBITMQ_USE_LONGNAME: "true"
    command: >
      sh -c "rabbitmq-server -detached
      && sleep 15
      && rabbitmqctl stop_app
      && rabbitmqctl join_cluster rabbit@rabbitmq-1
      && rabbitmqctl start_app
      && tail -f /dev/null"

  haproxy:
    image: haproxy:2.8
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
```

## Quorum Queues

Quorum queues are the recommended queue type for HA in RabbitMQ 3.8+. They use the Raft consensus protocol for replication, providing strong consistency and automatic leader election. Unlike mirrored queues, quorum queues ensure that once a message is acknowledged, it's durable across a majority of nodes. The `x-quorum-initial-group-size` sets the number of cluster members that participate in the Raft group (should be an odd number for quorum). `x-delivery-limit` limits redeliveries to prevent poison message loops.

```java
@Configuration
public class QuorumQueueConfig {

    @Bean
    public Queue quorumQueue() {
        Map<String, Object> args = new HashMap<>();
        args.put("x-queue-type", "quorum");
        args.put("x-quorum-initial-group-size", 3);
        args.put("x-delivery-limit", 5);
        args.put("x-overflow", "reject-publish");
        return new Queue("orders.quorum", true, false, false, args);
    }

    @Bean
    public Declarables declarables() {
        Queue quorum = QueueBuilder.durable("orders.quorum")
            .quorum()
            .build();

        Queue stream = QueueBuilder.durable("audit.stream")
            .stream()
            .build();

        return new Declarables(quorum, stream);
    }
}
```

### Quorum Queue Configuration via RabbitMQ CLI

You can also create quorum queues via the CLI or management UI. The rabbitmqadmin command declaratively creates a queue with the required arguments. Monitoring commands help you track the quorum status, leader, and member nodes in the Raft group.

```bash
# Declare a quorum queue with CLI
rabbitmqadmin declare queue name=orders.quorum \
  arguments='{"x-queue-type":"quorum","x-quorum-initial-group-size":3,"x-delivery-limit":10}'

# Monitor quorum queue status
rabbitmqadmin list queues name type quorum_online quorum_offline

# Check quorum queue leader
rabbitmqctl list_queues name quorum_leader quorum_members
```

## Mirrored Queues (Classic Queue Mirroring - Deprecated)

Mirrored queues are the legacy HA approach. They are deprecated in favor of quorum queues. Mirrored queues used asynchronous replication, which could lead to data loss during failover (if the master node died before changes were replicated to all mirrors). Always use quorum queues for new deployments.

```java
Map<String, Object> args = new HashMap<>();
args.put("x-ha-policy", "all"); // Mirror to all nodes
args.put("x-ha-nodes", "rabbit@node1,rabbit@node2,rabbit@node3");
args.put("x-queue-type", "classic");
Queue mirroredQueue = new Queue("orders.mirrored", true, false, false, args);
```

## Network Partition Handling

Configure automatic cluster recovery for network partitions. The `autoheal` mode automatically resolves partitions by winning a vote among cluster nodes — the winning side keeps its data and the losing side restarts. The `cluster_keepalive_interval` controls how often nodes ping each other to detect partitions. The client-side `ConnectionFactory` configures automatic recovery with multiple addresses, so if one node is unreachable, clients fail over to another.

```bash
# rabbitmq.conf
cluster_partition_handling = autoheal
cluster_keepalive_interval = 10000
```

```java
@Configuration
public class RabbitConnectionConfig {

    @Bean
    public ConnectionFactory connectionFactory() {
        CachingConnectionFactory factory = new CachingConnectionFactory();
        factory.setAddresses("rabbitmq-1:5672,rabbitmq-2:5672,rabbitmq-3:5672");
        factory.setUsername("admin");
        factory.setPassword("admin");
        factory.setConnectionTimeout(30000);
        factory.setRequestedHeartBeat(30);

        // Automatic recovery
        factory.setNetworkRecoveryInterval(10000);
        factory.setRecoveryListener(new RecoveryListener() {
            @Override
            public void handleRecovery(Recoverable recoverable) {
                log.info("Connection recovered");
            }

            @Override
            public void handleRecoveryStarted(Recoverable recoverable) {
                log.info("Connection recovery started");
            }
        });

        return factory;
    }
}
```

## HAProxy Configuration for RabbitMQ Cluster

HAProxy provides load balancing and failover for the RabbitMQ cluster. The TCP health check sends an AMQP protocol header and expects the AMQP response — this verifies that RabbitMQ is truly accepting connections. The `leastconn` balancing algorithm distributes connections to the node with the fewest active connections, which works well for long-lived AMQP connections.

```cfg
# haproxy.cfg
global
    log stdout format raw local0
    maxconn 4096

defaults
    log global
    mode tcp
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms

frontend rabbitmq_front
    bind *:5672
    default_backend rabbitmq_back

    # Health check port
    bind *:15672
    default_backend rabbitmq_management

backend rabbitmq_back
    balance leastconn
    option tcp-check
    tcp-check connect port 5672
    tcp-check send AMQP\r\n
    tcp-check expect string AMQP
    server rabbitmq-1 rabbitmq-1:5672 check fall 3 rise 2
    server rabbitmq-2 rabbitmq-2:5672 check fall 3 rise 2
    server rabbitmq-3 rabbitmq-3:5672 check fall 3 rise 2

backend rabbitmq_management
    balance roundrobin
    server rabbitmq-1 rabbitmq-1:15672 check fall 3 rise 2
    server rabbitmq-2 rabbitmq-2:15672 check fall 3 rise 2
    server rabbitmq-3 rabbitmq-3:15672 check fall 3 rise 2
```

## Best Practices

- Use quorum queues instead of mirrored queues for all new deployments.
- Set `x-quorum-initial-group-size` to 3 or 5 for production clusters with corresponding node counts.
- Set `x-delivery-limit` on quorum queues to handle poison messages.
- Use an odd number of cluster nodes for quorum-based decisions.
- Configure `cluster_partition_handling=autoheal` for automatic recovery.
- Never use `auto_delete` queues in production clustered environments.
- Monitor cluster status with Prometheus and Grafana using `rabbitmq-prometheus` exporter.

## Common Mistakes

### Mistake: Using mirrored queues in new deployments

Mirrored queues use asynchronous replication and are susceptible to data loss during failover. They also lack the strong consistency guarantees of quorum queues. Always use quorum queues for new deployments requiring HA.

```java
// Wrong - mirrored queues are deprecated
Map<String, Object> args = new HashMap<>();
args.put("x-ha-policy", "all");
new Queue("orders", true, false, false, args);
```

```java
// Correct - use quorum queues
Map<String, Object> args = new HashMap<>();
args.put("x-queue-type", "quorum");
args.put("x-quorum-initial-group-size", 3);
new Queue("orders", true, false, false, args);
```

### Mistake: Not configuring connection recovery in Spring Boot

A single RabbitMQ address with default recovery settings means the application can't survive node failures. Always configure multiple addresses and appropriate recovery intervals so the client automatically reconnects to healthy nodes when a node goes down.

```yaml
# Wrong - default recovery may not be sufficient
spring:
  rabbitmq:
    addresses: rabbitmq-1:5672
```

```yaml
# Correct - multiple addresses with recovery
spring:
  rabbitmq:
    addresses: rabbitmq-1:5672,rabbitmq-2:5672,rabbitmq-3:5672
    connection-timeout: 30000
    network-recovery-interval: 10000
    requested-heartbeat: 30
```

## Summary

RabbitMQ clustering with quorum queues provides a robust foundation for highly available messaging. Quorum queues use Raft consensus for data consistency, while proper load balancing and connection recovery ensure applications can withstand node failures.

## References

- [RabbitMQ Clustering Guide](https://www.rabbitmq.com/clustering.html)
- [RabbitMQ Quorum Queues](https://www.rabbitmq.com/quorum-queues.html)
- [RabbitMQ Network Partitions](https://www.rabbitmq.com/partitions.html)

Happy Coding
