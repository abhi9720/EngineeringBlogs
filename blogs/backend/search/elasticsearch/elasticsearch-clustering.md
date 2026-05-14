---
title: "Elasticsearch Clustering"
description: "Elasticsearch cluster architecture: sharding, replication, node roles, discovery, and production deployment"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["elasticsearch", "clustering", "sharding", "production"]
coverImage: "/images/elasticsearch-clustering.png"
draft: false
---

## Overview

Elasticsearch's distributed nature is its greatest strength. A cluster of nodes automatically manages shard allocation, replication, failover, and scaling. Understanding cluster architecture is essential for operating Elasticsearch in production.

This post covers cluster topology, node roles, sharding strategies, discovery, and production deployment best practices.

## Cluster Architecture

### Node Roles

```yaml
# elasticsearch.yml

# Master-eligible node (cluster management)
node.roles: [master]

# Data node (stores data, executes queries)
node.roles: [data]

# Ingest node (pre-processes documents)
node.roles: [ingest]

# Machine learning node
node.roles: [ml]

# Coordinating only node (routes requests, aggregates results)
node.roles: []

# All roles (default for small clusters)
node.roles: [master, data, ingest]

# Production: dedicated master nodes
node.roles: [master]
node.attr.role: master

# Production: dedicated data nodes
node.roles: [data, ingest]
node.attr.role: data

# Production: coordinating nodes for high query volume
node.roles: []
node.attr.role: coordinating
```

### Cluster Configuration

```yaml
# Cluster settings
cluster.name: production-logs
cluster.initial_master_nodes: ["master-1", "master-2", "master-3"]

# Discovery
discovery.seed_hosts:
  - master-1:9300
  - master-2:9300
  - master-3:9300

# Network
network.host: 0.0.0.0
http.port: 9200
transport.port: 9300

# Paths
path.data: /var/lib/elasticsearch/data
path.logs: /var/log/elasticsearch

# Memory
bootstrap.memory_lock: true

# Recovery
gateway.recover_after_nodes: 3
gateway.expected_nodes: 5
gateway.recover_after_time: 5m

# Shard allocation
cluster.routing.allocation.node_concurrent_recoveries: 2
cluster.routing.allocation.node_initial_primaries_recoveries: 4
indices.recovery.max_bytes_per_sec: 100mb
```

## Sharding and Replication

```java
@Component
public class IndexShardManager {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public void configureSharding(String indexName) {
        UpdateSettingsRequest request = new UpdateSettingsRequest(indexName);
        request.settings(Settings.builder()
            .put("index.number_of_replicas", 1)
            .put("index.routing.allocation.total_shards_per_node", 2)
            .put("index.unassigned.node_left.delayed_timeout", "5m")
            .build());

        elasticsearchTemplate.execute(client ->
            client.indices().putSettings(request, RequestOptions.DEFAULT));
    }

    public ShardInfo getShardInfo(String indexName) {
        try {
            GetSettingsRequest request = new GetSettingsRequest()
                .indices(indexName)
                .includeDefaults(true);

            GetSettingsResponse response = elasticsearchTemplate
                .getElasticsearchClient()
                .getLowLevelClient()
                .performRequest(request);

            return extractShardInfo(response);
        } catch (IOException e) {
            throw new ClusterOperationException("Failed to get shard info", e);
        }
    }

    public void rebalanceShards(String indexName) {
        elasticsearchTemplate.execute(client -> {
            client.cluster().putSettings(
                new ClusterUpdateSettingsRequest()
                    .transientSettings(Settings.builder()
                        .put("cluster.routing.rebalance.enable", "all")
                        .build()),
                RequestOptions.DEFAULT);
            return null;
        });
    }

    public void rerouteShard(String indexName, int shardId,
                              String fromNode, String toNode) {
        elasticsearchTemplate.execute(client -> {
            client.cluster().reroute(
                new ClusterRerouteRequest()
                    .add(new MoveAllocationStep(
                        new ShardRouting(indexName, shardId,
                            fromNode, true),
                        toNode)),
                RequestOptions.DEFAULT);
            return null;
        });
    }

    public record ShardInfo(
        int totalShards,
        int successfulShards,
        int failedShards,
        int totalShardsPerNode,
        int activePrimaryShards,
        int activeShards,
        int relocatingShards,
        int initializingShards,
        int unassignedShards
    ) {}

    private ShardInfo extractShardInfo(GetSettingsResponse response) {
        // Extract shard information from response
        return new ShardInfo(0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
}
```

## Cluster Health Monitoring

```java
@Component
public class ClusterHealthMonitor {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public ClusterHealthResponse getClusterHealth() {
        try {
            return elasticsearchTemplate.execute(client ->
                client.cluster().health(
                    new ClusterHealthRequest(),
                    RequestOptions.DEFAULT));
        } catch (IOException e) {
            throw new ClusterOperationException("Failed to get cluster health", e);
        }
    }

    public ClusterHealthStatus getClusterStatus() {
        ClusterHealthResponse health = getClusterHealth();
        return health.getStatus();
    }

    public boolean isClusterHealthy() {
        ClusterHealthResponse health = getClusterHealth();
        return health.getStatus() != ClusterHealthStatus.RED
            && health.getUnassignedShards() == 0
            && health.getRelocatingShards() == 0
            && health.getInitializingShards() == 0;
    }

    @Scheduled(fixedRate = 30000)
    public void logClusterHealth() {
        ClusterHealthResponse health = getClusterHealth();

        log.info("Cluster: {} | Status: {} | Nodes: {} | " +
                 "Active: {}/{} | Unassigned: {} | Relocating: {}",
            health.getClusterName(),
            health.getStatus(),
            health.getNumberOfNodes(),
            health.getActiveShards(),
            health.getActivePrimaryShards() + health.getActiveShards(),
            health.getUnassignedShards(),
            health.getRelocatingShards()
        );

        if (health.getStatus() == ClusterHealthStatus.RED) {
            log.error("Cluster health is RED! Unassigned shards: {}",
                health.getUnassignedShards());
            alertService.critical("Elasticsearch cluster is RED",
                Map.of("unassigned_shards", health.getUnassignedShards()));
        } else if (health.getStatus() == ClusterHealthStatus.YELLOW) {
            log.warn("Cluster health is YELLOW. Unassigned replicas detected");
        }
    }

    public Map<String, Object> getDetailedClusterInfo() {
        ClusterHealthResponse health = getClusterHealth();
        return Map.of(
            "clusterName", health.getClusterName(),
            "status", health.getStatus().name(),
            "nodes", health.getNumberOfNodes(),
            "dataNodes", health.getNumberOfDataNodes(),
            "activePrimaryShards", health.getActivePrimaryShards(),
            "activeShards", health.getActiveShards(),
            "relocatingShards", health.getRelocatingShards(),
            "initializingShards", health.getInitializingShards(),
            "unassignedShards", health.getUnassignedShards(),
            "delayedUnassignedShards", health.getDelayedUnassignedShards(),
            "timedOut", health.isTimedOut()
        );
    }
}
```

## Node Discovery and Fault Tolerance

```java
@Component
public class NodeDiscoveryManager {

    public NodesResponse listClusterNodes() {
        try {
            RestClient restClient = elasticsearchTemplate
                .getElasticsearchClient().getLowLevelClient();

            Response response = restClient
                .performRequest("GET", "/_nodes");

            String body = EntityUtils.toString(response.getEntity());
            return parseNodesResponse(body);
        } catch (IOException e) {
            throw new ClusterOperationException("Failed to list nodes", e);
        }
    }

    public void addNodeToCluster(String host, int port) {
        try {
            // Add node via voting configuration
            elasticsearchTemplate.execute(client -> {
                client.cluster().postVotingConfigExclusions(
                    new PostVotingConfigExclusionsRequest()
                        .setNodeNames(host),
                    RequestOptions.DEFAULT);
                return null;
            });
        } catch (IOException e) {
            throw new ClusterOperationException("Failed to add node", e);
        }
    }

    public boolean isNodeConnected(String nodeId) {
        NodesResponse nodes = listClusterNodes();
        return nodes.getNodes().containsKey(nodeId)
            && nodes.getNodes().get(nodeId).getStatus().equals("online");
    }

    public void handleNodeFailure(String failedNodeId) {
        log.warn("Handling node failure: {}", failedNodeId);

        // Check cluster state
        ClusterHealthResponse health = getClusterHealth();

        if (health.getUnassignedShards() > 0) {
            log.info("Reassigning {} unassigned shards", health.getUnassignedShards());
            elasticsearchTemplate.execute(client -> {
                client.cluster().reroute(
                    new ClusterRerouteRequest()
                        .add(new RetryFailedAllocation()),
                    RequestOptions.DEFAULT);
                return null;
            });
        }

        // If master node failed, wait for new master election
        if (health.getNumberOfNodes() < expectedNodeCount) {
            log.warn("Node count dropped to {} (expected {})",
                health.getNumberOfNodes(), expectedNodeCount);
            alertService.warning("Elasticsearch node failure",
                Map.of("failedNode", failedNodeId, "remainingNodes",
                    health.getNumberOfNodes()));
        }
    }
}
```

## Cluster Scaling

```java
@Component
public class ClusterScaler {

    public void scaleCluster(int targetNodes) {
        int currentNodeCount = getNodeCount();
        int nodesToAdd = targetNodes - currentNodeCount;

        if (nodesToAdd > 0) {
            log.info("Scaling up cluster from {} to {} nodes", currentNodeCount, targetNodes);
            provisionNodes(nodesToAdd);
            waitForNodeJoin(targetNodes);
            rebalanceShards();
        } else if (nodesToAdd < 0) {
            log.info("Scaling down cluster from {} to {} nodes", currentNodeCount, targetNodes);
            decommissionNodes(Math.abs(nodesToAdd));
        }
    }

    public void rebalanceShards() {
        elasticsearchTemplate.execute(client -> {
            client.cluster().putSettings(
                new ClusterUpdateSettingsRequest()
                    .transientSettings(Settings.builder()
                        .put("cluster.routing.allocation.balance.shard", 0.6f)
                        .put("cluster.routing.allocation.balance.index", 0.5f)
                        .put("cluster.routing.allocation.balance.primary", 0.3f)
                        .build()),
                RequestOptions.DEFAULT);
            return null;
        });
    }

    public void excludeNode(String nodeName) {
        elasticsearchTemplate.execute(client -> {
            client.cluster().putSettings(
                new ClusterUpdateSettingsRequest()
                    .transientSettings(Settings.builder()
                        .put("cluster.routing.allocation.exclude._name", nodeName)
                        .build()),
                RequestOptions.DEFAULT);
            return null;
        });
    }

    public void includeNode(String nodeName) {
        elasticsearchTemplate.execute(client -> {
            client.cluster().putSettings(
                new ClusterUpdateSettingsRequest()
                    .transientSettings(Settings.builder()
                        .putNull("cluster.routing.allocation.exclude._name")
                        .build()),
                RequestOptions.DEFAULT);
            return null;
        });
    }
}
```

## Hot-Warm-Cold Architecture

```yaml
# Data node configuration with tier attributes
node.attr.data_tier: hot
# node.attr.data_tier: warm
# node.attr.data_tier: cold

# Index allocation to specific tiers
PUT /_template/logs_template
{
  "index_patterns": ["logs-*"],
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "routing.allocation.require.data_tier": "hot",
    "index.routing.allocation.include._tier_preference": "data_hot"
  }
}

# Move old indices to warm tier
PUT /logs-2026.04.01/_settings
{
  "index.routing.allocation.require.data_tier": "warm",
  "index.routing.allocation.include._tier_preference": "data_warm"
}

# Force merge in warm tier
POST /logs-2026.04.01/_forcemerge?max_num_segments=1
```

## Common Mistakes

### Insufficient Heap Size

```java
// Wrong: Default heap is too small
// ES_JAVA_OPTS="-Xms1g -Xmx1g" // 1GB for production

// Correct: Set heap to 50% of available RAM (up to 32GB)
// ES_JAVA_OPTS="-Xms16g -Xmx16g"
```

### Not Enabling Memory Locking

```yaml
# Wrong: Heap can be swapped to disk
# bootstrap.memory_lock not set

# Correct: Lock heap to prevent swapping
bootstrap.memory_lock: true
```

### Over-Allocating Shards

```java
// Wrong: Too many shards
PUT /products
{
  "settings": {
    "number_of_shards": 50, // 500GB index, ~10GB per shard
    "number_of_replicas": 2
  }
}

// Correct: Right-size shards (20-40GB per shard)
PUT /products
{
  "settings": {
    "number_of_shards": 15, // 500GB index, ~33GB per shard
    "number_of_replicas": 1
  }
}
```

## Best Practices

1. Use dedicated master nodes (3 minimum) for cluster stability.
2. Right-size shards between 20-40 GB for optimal performance.
3. Enable `bootstrap.memory_lock` to prevent swapping.
4. Set heap to 50% of available RAM, max 32 GB.
5. Use hot-warm-cold architecture for time-series data.
6. Monitor cluster health and set up automated alerts for RED/YELLOW status.
7. Plan for node failures with appropriate replica counts.
8. Use ILM for automatic index lifecycle management.

## Summary

Elasticsearch clustering provides automatic shard distribution, replication, failover, and scaling. A well-designed cluster with appropriate node roles, sized shards, and proper configuration is essential for production reliability. Monitor cluster health, plan for node failures, and use tiered architectures for cost-effective data management.

## References

- Elasticsearch Reference: "Cluster"
- Elasticsearch Reference: "Important Elasticsearch Configuration"
- "Elasticsearch: The Definitive Guide" by Clinton Gormley and Zachary Tong

Happy Coding