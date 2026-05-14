---
title: Blue-Green Deployment
description: >-
  Implement blue-green deployments for microservices: Kubernetes strategies,
  Istio traffic switching, zero-downtime deployments, database migrations, and
  rollback procedures
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - blue-green
  - deployment
  - kubernetes
  - zero-downtime
coverImage: /images/blue-green-deployment.png
draft: false
order: 10
---
## Overview

Blue-green deployment runs two identical environments (blue and green) with only one serving production traffic at a time. When deploying a new version, traffic is switched from the active environment to the new one, enabling instant rollback if issues arise.

## Kubernetes Blue-Green Deployment

### Blue Deployment (Current Version)

Blue and green are two fully independent deployments running side by side. At any given time only one (the "active" version) receives production traffic. Each deployment has its own database schema (`orders_v1` vs `orders_v2`) so schema changes for the new version don't affect the running production environment.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-blue
  labels:
    app: order-service
    version: blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
      version: blue
  template:
    metadata:
      labels:
        app: order-service
        version: blue
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
          env:
            - name: DB_SCHEMA
              value: "orders_v1"
            - name: ACTIVE_PROFILE
              value: "blue"
```

### Green Deployment (New Version)

The green deployment runs the new version (v2.0.0) with its own database schema. During the deployment, both blue and green are running simultaneously. The readiness probe ensures green only receives traffic after it passes health checks.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-green
  labels:
    app: order-service
    version: green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
      version: green
  template:
    metadata:
      labels:
        app: order-service
        version: green
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v2.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
          env:
            - name: DB_SCHEMA
              value: "orders_v2"
            - name: ACTIVE_PROFILE
              value: "green"
```

### Service for Traffic Switching

Traffic switching is done by updating the Kubernetes Service's selector label from `version: blue` to `version: green`. This is a single atomic change — until the selector is updated, all traffic continues flowing to the blue deployment, providing instant rollback capability.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
spec:
  selector:
    app: order-service
    version: blue  # Switch to 'green' when ready
  ports:
    - port: 80
      targetPort: 8080
```

## Blue-Green with Istio

### Destination Rules

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: order-service
spec:
  host: order-service
  subsets:
    - name: blue
      labels:
        version: blue
    - name: green
      labels:
        version: green
  trafficPolicy:
    tls:
      mode: ISTIO_MUTUAL
```

### VirtualService for Traffic Switch

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
    - order-service
  http:
    - route:
        - destination:
            host: order-service
            subset: blue  # Switch to green when deploying
          weight: 100
```

### Gradual Traffic Shift

```yaml
# Step 1: Deploy green, send 0% traffic
# Step 2: Test green internally
# Step 3: Shift 10% traffic to green
# Step 4: Shift 50% traffic to green
# Step 5: Shift 100% traffic to green

apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service
spec:
  hosts:
    - order-service
  http:
    - route:
        - destination:
            host: order-service
            subset: blue
          weight: 0
        - destination:
            host: order-service
            subset: green
          weight: 100
```

## Blue-Green with Spring Boot

The Spring Boot application must be deployment-aware — it uses the `ACTIVE_PROFILE` environment variable to select the correct database schema and connection pool. The scheduled health verification ensures the active database connection is functional, catching schema mismatches early.

```java
@Component
public class BlueGreenRouter {

    @Value("${deployment.active:blue}")
    private String activeDeployment;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private BlueDataSource blueDataSource;

    @Autowired
    private GreenDataSource greenDataSource;

    @Transactional
    public Order createOrder(OrderRequest request) {
        DataSource dataSource = "blue".equals(activeDeployment)
            ? blueDataSource : greenDataSource;
        
        return orderRepository.save(Order.from(request));
    }

    @Scheduled(fixedDelay = 30000)
    public void verifyDatabaseConnection() {
        try {
            DataSource dataSource = "blue".equals(activeDeployment)
                ? blueDataSource : greenDataSource;
            dataSource.getConnection().isValid(5);
            log.info("Active deployment {} database connection OK", activeDeployment);
        } catch (Exception e) {
            log.error("Active deployment {} database connection failed", activeDeployment, e);
        }
    }
}
```

## Database Migrations

Database schema changes must be backward-compatible during the transition window. The old version (blue) reads from `orders_v1` while the new version (green) writes to `orders_v2`. A data sync job copies recent records from v1 to v2 so green has fresh data after the switch. Rollback simply drops the v2 schema.

```java
@Component
public class BlueGreenMigration {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    public void migrateGreenSchema() {
        // Run migrations for green schema
        jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS orders_v2");
        jdbcTemplate.execute("SET SCHEMA 'orders_v2'");
        
        // Apply new migrations
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS orders_v2.orders (
                id VARCHAR(36) PRIMARY KEY,
                customer_id VARCHAR(36) NOT NULL,
                total_amount DECIMAL(10,2),
                status VARCHAR(20),
                created_at TIMESTAMP
            )
        """);
        
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS orders_v2.order_items (
                id VARCHAR(36) PRIMARY KEY,
                order_id VARCHAR(36) REFERENCES orders_v2.orders(id),
                product_id VARCHAR(36),
                quantity INTEGER,
                price DECIMAL(10,2)
            )
        """);
    }

    public void rollbackGreenSchema() {
        jdbcTemplate.execute("DROP SCHEMA IF EXISTS orders_v2 CASCADE");
    }

    public void syncDataToGreen() {
        jdbcTemplate.execute("""
            INSERT INTO orders_v2.orders (id, customer_id, total_amount, status, created_at)
            SELECT id, customer_id, total_amount, status, created_at
            FROM orders_v1.orders
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """);
    }
}
```

## Automation Script

```bash
#!/bin/bash
set -e

BLUE_DEPLOYMENT="order-service-blue"
GREEN_DEPLOYMENT="order-service-green"
SERVICE="order-service"

echo "=== Blue-Green Deployment ==="

# Step 1: Deploy green version
echo "Deploying green version..."
kubectl apply -f k8s/green-deployment.yaml

# Step 2: Wait for green to be ready
echo "Waiting for green deployment to be ready..."
kubectl rollout status deployment/$GREEN_DEPLOYMENT --timeout=300s

# Step 3: Run smoke tests
echo "Running smoke tests..."
GREEN_POD=$(kubectl get pods -l version=green -o jsonpath='{.items[0].metadata.name}')
kubectl exec $GREEN_POD -- curl -f http://localhost:8080/actuator/health

# Step 4: Switch traffic to green
echo "Switching traffic to green..."
kubectl patch service $SERVICE -p "{\"spec\":{\"selector\":{\"version\":\"green\"}}}"

# Step 5: Verify traffic
sleep 30
echo "Verifying traffic on green..."
kubectl exec $GREEN_POD -- curl -f http://localhost:8080/actuator/health

# Step 6: Scale down blue
echo "Scaling down blue deployment..."
kubectl scale deployment/$BLUE_DEPLOYMENT --replicas=0

echo "=== Deployment Complete ==="
```

## Rollback Procedure

```bash
#!/bin/bash
# Rollback to blue

echo "Initiating rollback to blue..."
kubectl scale deployment/order-service-green --replicas=3
kubectl patch service order-service -p '{"spec":{"selector":{"version":"blue"}}}'
echo "Waiting for blue to handle traffic..."
sleep 30
kubectl scale deployment/order-service-green --replicas=0
echo "Rollback complete"
```

## Best Practices

- Ensure green deployment is fully tested before switching traffic.
- Use database schema per environment for safe migration.
- Implement smoke tests that run automatically after switch.
- Monitor error rates and latency immediately after switching.
- Keep blue deployment running for immediate rollback.
- Use gradual traffic shifting with Istio when possible.

## Common Mistakes

### Mistake: Switching traffic before green is ready

```bash
# Wrong - switching before readiness
kubectl apply -f green-deployment.yaml
kubectl patch service order-service -p '{"spec":{"selector":{"version":"green"}}}'
```

```bash
# Correct - wait for readiness
kubectl apply -f green-deployment.yaml
kubectl rollout status deployment/order-service-green --timeout=300s
kubectl patch service order-service -p '{"spec":{"selector":{"version":"green"}}}'
```

### Mistake: No schema separation for databases

```yaml
# Wrong - same database schema
env:
  - name: SPRING_DATASOURCE_URL
    value: "jdbc:postgresql://postgres/orders"
```

```yaml
# Correct - separate schemas
env:
  - name: DB_SCHEMA
    value: "orders_v2"
  - name: SPRING_DATASOURCE_URL
    value: "jdbc:postgresql://postgres/orders?currentSchema=orders_v2"
```

## Summary

Blue-green deployment enables zero-downtime releases with instant rollback capability. Use separate deployments with a shared service for traffic switching, and run the previous version until the new version is verified. For database changes, use separate schemas per deployment.

## References

- [Martin Fowler - Blue-Green Deployment](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [Kubernetes Blue-Green Deployment](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Istio Traffic Routing](https://istio.io/latest/docs/tasks/traffic-management/request-routing/)

Happy Coding
