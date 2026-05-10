---
title: "Service Discovery with Eureka"
description: "Master service discovery in microservices using Netflix Eureka: client-side discovery, registration, health checks, and production patterns"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - microservices
  - eureka
  - service-discovery
  - spring-cloud
coverImage: "/images/service-discovery-eureka.png"
draft: false
---

# Service Discovery with Netflix Eureka

## Overview

In a microservices architecture, services need to communicate with each other, but the network locations of services change dynamically as instances are scaled, deployed, and replaced. Service discovery solves this problem by maintaining a registry of available service instances and their network locations.

Eureka, developed by Netflix and integrated with Spring Cloud, is the most widely used service discovery solution for Java-based microservices. This guide covers how Eureka works internally and how to use it effectively in production.

---

## How Service Discovery Works Internally

### The Eureka Architecture

Eureka consists of two main components:

1. **Eureka Server**: The service registry where services register themselves
2. **Eureka Client**: Embedded in each service to register and discover other services

```
┌─────────────────────────────────────────────────────────────────┐
│                      Eureka Server (Registry)                    │
│  ┌───────────────┬───────────────┬───────────────┐             │
│  │ user-service  │ order-service │ product-service│             │
│  │ 192.168.1.10  │ 192.168.1.11  │ 192.168.1.12  │             │
│  │ 192.168.1.20  │               │ 192.168.1.22  │             │
│  └───────────────┴───────────────┴───────────────┘             │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ Heartbeat          │ Heartbeat          │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ User Service    │  │ Order Service   │  │ Product Service │
│ (Eureka Client) │  │ (Eureka Client) │  │ (Eureka Client)  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Registration Process

```java
// Eureka Server configuration (simplified)
@EnableEurekaServer
@SpringBootApplication
public class EurekaServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(EurekaServerApplication.class, args);
    }
}

// application.yml for Eureka Server
spring:
  application:
    name: eureka-server
  profiles:
    active: default

server:
  port: 8761

eureka:
  instance:
    hostname: localhost
  client:
    register-with-eureka: false
    fetch-registry: false
  server:
    enable-self-preservation: true
    eviction-interval-ms: 60000

// Eureka client registration (embedded in each microservice)
@SpringBootApplication
@EnableDiscoveryClient  // Enables Eureka client
public class UserServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(UserServiceApplication.class, args);
    }
}

// application.yml for Eureka Client
spring:
  application:
    name: user-service

eureka:
  client:
    service-url:
      defaultZone: http://localhost:8761/eureka/
    registry-fetch-interval-seconds: 30
    heartbeat-interval-seconds: 30
  instance:
    lease-renewal-interval-in-seconds: 30
    lease-expiration-duration-in-seconds: 90
    prefer-ip-address: true
    metadata:
      # Add metadata for custom routing
      tier: critical
      version: v1
```

### Service Registration and Discovery Flow

```java
// What happens when a service starts (simplified)
public class EurekaClientAutoConfiguration {
    
    @Bean
    public DiscoveryClient discoveryClient(EurekaClientConfig config) {
        return new DiscoveryClient(config, new NetflixConfiguration());
    }
}

// When service starts, it registers itself
// 1. Sends POST to /eureka/apps/{app-name}
// 2. Includes instance metadata (IP, port, health URL)
// 3. Server returns 204 No Content on success

// Discovery client code
@Service
public class ServiceDiscovery {
    
    @Autowired
    private DiscoveryClient discoveryClient;
    
    // Get all instances of a service
    public List<ServiceInstance> getInstances(String serviceId) {
        return discoveryClient.getInstances(serviceId);
    }
    
    // Get one random instance (client-side load balancing)
    public ServiceInstance getInstance(String serviceId) {
        List<ServiceInstance> instances = discoveryClient.getInstances(serviceId);
        
        if (instances.isEmpty()) {
            throw new ServiceUnavailableException(serviceId);
        }
        
        // Simple round-robin or random
        return instances.get(new Random().nextInt(instances.size()));
    }
}

// Using discovery in REST calls
@Service
public class OrderService {
    
    @Autowired
    private DiscoveryClient discoveryClient;
    
    public User getUserDetails(Long userId) {
        // Look up user-service instances
        List<ServiceInstance> instances = discoveryClient.getInstances("user-service");
        
        if (instances.isEmpty()) {
            throw new ServiceUnavailableException("user-service");
        }
        
        // Choose an instance
        ServiceInstance instance = instances.get(0);
        
        // Make the call
        String url = instance.getUri() + "/api/users/" + userId;
        return restTemplate.getForObject(url, User.class);
    }
}
```

---

## Real-World Backend Use Cases

### Case 1: Using Feign Client for Service Calls

```java
// Declare a Feign client - automatic service discovery
@FeignClient(name = "user-service")
public interface UserServiceClient {
    
    @GetMapping("/api/users/{id}")
    User getUser(@PathVariable("id") Long id);
    
    @GetMapping("/api/users")
    List<User> getUsersByIds(@RequestParam("ids") List<Long> ids);
    
    @PostMapping("/api/users")
    User createUser(@RequestBody CreateUserRequest request);
}

// Usage in another service
@Service
public class OrderService {
    
    @Autowired
    private UserServiceClient userServiceClient;
    
    public Order createOrder(CreateOrderRequest request) {
        // Feign resolves "user-service" to actual instances via Eureka
        User user = userServiceClient.getUser(request.getUserId());
        
        // Create order...
        return order;
    }
}

// Feign client with fallback
@FeignClient(name = "user-service", fallback = UserServiceFallback.class)
public interface UserServiceClientWithFallback {
    
    @GetMapping("/api/users/{id}")
    User getUser(@PathVariable("id") Long id);
}

@Component
public class UserServiceFallback implements UserServiceClientWithFallback {
    
    @Override
    public User getUser(Long id) {
        // Return fallback data when user-service is unavailable
        return User.builder()
            .id(id)
            .name("Unknown User")
            .build();
    }
}
```

### Case 2: Load Balancing with Ribbon

```java
// Ribbon is integrated with Feign for client-side load balancing
@Configuration
public class RibbonConfig {
    
    @Bean
    public IRule roundRobinRule() {
        return new RoundRobinRule();  // Default
    }
    
    @Bean
    public IRule weightedResponseTimeRule() {
        return new WeightedResponseTimeRule();  // Better for varying response times
    }
}

// Configuration in application.yml
user-service:
  ribbon:
    NFLoadBalancerRuleClassName: com.netflix.loadbalancer.WeightedResponseTimeRule
    ConnectTimeout: 2000
    ReadTimeout: 5000
    MaxAutoRetries: 2
    MaxAutoRetriesNextServer: 3
    OkToRetryOnAllOperations: false
```

### Case 3: Registering Metadata for Custom Routing

```java
// Service instance metadata
spring:
  application:
    name: product-service
  cloud:
    inetutils:
      preferred-networks:
        - 192.168

eureka:
  instance:
    metadata-map:
      version: v1
      environment: production
      tier: compute
    health-check-url-path: /actuator/health

// Using metadata for routing decisions
@Service
public class MetadataBasedRouting {
    
    @Autowired
    private DiscoveryClient discoveryClient;
    
    public List<ServiceInstance> getInstancesByVersion(String version) {
        return discoveryClient.getInstances("product-service").stream()
            .filter(instance -> version.equals(instance.getMetadata().get("version")))
            .collect(Collectors.toList());
    }
}
```

### Case 4: Health Checks and Service Status

```java
// Custom health indicator for Eureka
@Component
public class EurekaHealthIndicator implements ReactiveHealthIndicator {
    
    @Autowired
    private EurekaClient eurekaClient;
    
    @Override
    public Mono<Health> health() {
        return Mono.fromCallable(() -> {
            Applications apps = eurekaClient.getApplications();
            
            int registeredCount = apps.getAppsByName().values().stream()
                .mapToInt(Application::getInstances.size())
                .sum();
            
            Health health = Health.up()
                .withDetail("registered", registeredCount)
                .build();
            
            if (registeredCount == 0) {
                health = Health.down()
                    .withDetail("reason", "No services registered")
                    .build();
            }
            
            return health;
        });
    }
}

// Service implementing health endpoint
@RestController
public class HealthController {
    
    @GetMapping("/actuator/health")
    public Health status() {
        // Check service's internal health
        Health health = Health.up()
            .withDetail("database", "UP")
            .build();
        
        if (!databaseConnected) {
            health = Health.down()
                .withDetail("database", "DOWN")
                .build();
        }
        
        return health;
    }
}
```

### Case 5: Self-Registration Pattern

```java
// Each service can handle its own registration
@Configuration
public class EurekaRegistrationConfig {
    
    @Autowired
    private DiscoveryManager discoveryManager;
    
    @PostConstruct
    public void init() {
        // Custom registration logic if needed
    }
    
    @PreDestroy
    public void shutdown() {
        // Deregister on shutdown
        discoveryManager.shutdownComponent();
    }
}
```

---

## Production Considerations

### 1. Eureka Server High Availability

```yaml
# application.yml for Eureka Server (3-node cluster)
# Server 1
server:
  port: 8761
eureka:
  instance:
    hostname: eureka1.example.com
  client:
    register-with-eureka: true
    fetch-registry: true
    service-url:
      defaultZone: http://eureka2.example.com:8762/eureka/,http://eureka3.example.com:8763/eureka/
  server:
    enable-self-preservation: true
    eviction-interval-ms: 60000

# Client configuration pointing to all servers
eureka:
  client:
    service-url:
      defaultZone: http://eureka1:8761/eureka/,http://eureka2:8762/eureka/,http://eureka3:8763/eureka/
    initial-instance-info-fetch-interval-seconds: 30
  instance:
    lease-renewal-interval-in-seconds: 30
    lease-expiration-duration-in-seconds: 90
```

### 2. Zone-Aware Routing

```java
// Configure availability zones
spring:
  cloud:
    loadbalancer:
      availability-zone-preference: us-east-1a

eureka:
  instance:
    metadata-map:
      availability-zone: us-east-1a

// Client will prefer instances in same zone
// Falls back to other zones if none available
```

### 3. Monitoring Eureka

```java
// Expose Eureka metrics
@Configuration
public class EurekaMetricsConfig {
    
    @Bean
    public MeterRegistryCustomizer<MeterRegistry> metrics() {
        return registry -> {
            // Eureka metrics exposed via actuator
            // Enable them in application.yml
        };
    }
}

// application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,eureka
  metrics:
    enable:
      eureka: true
```

### 4. Handling Expired Instances

```java
// Eureka cleans up expired instances
// Configure cleanup behavior
eureka:
  server:
    eviction-interval-ms: 60000          # Run every 60 seconds
    enable-self-preservation: true        # Disable in dev
    renewal-percent-threshold: 0.85       # Self-preservation threshold
    wait-time-in-ms-when-sync-empty: 0    # Wait before first sync

// Instance expiration settings per client
eureka:
  instance:
    lease-renewal-interval-in-seconds: 30  # Heartbeat every 30 sec
    lease-expiration-duration-in-seconds: 90  # Mark down after 90 sec (3 missed heartbeats)
```

---

## Trade-offs: Client-Side vs Server-Side Discovery

### Client-Side Discovery (Eureka)

| Pros | Cons |
|------|------|
| No single point of failure | Client must implement load balancing |
| Each client chooses its own strategy | Coupling between client and service registry |
| Less network hops | Complex client logic |

### Server-Side Discovery (e.g., Kubernetes)

| Pros | Cons |
|------|------|
| Simpler clients | Additional infrastructure component |
| Built-in load balancing | Network hop to router |
| Language-agnostic | May have single point of failure |

### Decision Matrix

| Scenario | Recommended Approach |
|----------|----------------------|
| Spring Cloud ecosystem | Eureka (client-side) |
| Kubernetes environment | Kubernetes service (server-side) |
| Multi-cloud deployment | Eureka with external load balancer |
| Lambda/serverless | API Gateway with built-in discovery |

---

## Common Mistakes

### Mistake 1: Not Configuring Health Checks

```java
// WRONG: Using default health check
// Eureka doesn't know if service is actually healthy

// CORRECT: Configure proper health checks
eureka:
  instance:
    health-check-url-path: /actuator/health
    status-page-url-path: /actuator/info

management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      show-details: always
```

### Mistake 2: Too Long Lease Duration

```java
// WRONG: Long lease duration delays failure detection
eureka:
  instance:
    lease-renewal-interval-in-seconds: 30
    lease-expiration-duration-in-seconds: 300  # 5 minutes!

// CORRECT: Faster failure detection
eureka:
  instance:
    lease-renewal-interval-in-seconds: 30
    lease-expiration-duration-in-seconds: 90  # 90 seconds
```

### Mistake 3: Not Handling Unavailable Services

```java
// WRONG: No handling when service not available
@Service
public class BrokenOrderService {
    
    public void processOrder(Long userId) {
        // If user-service is down, this throws exception
        User user = userServiceClient.getUser(userId);
        
        // No fallback
    }
}

// CORRECT: Add fallback
@FeignClient(name = "user-service", fallback = UserServiceFallback.class)
public interface UserServiceClient {
    @GetMapping("/api/users/{id}")
    User getUser(@PathVariable("id") Long id);
}

@Component
class UserServiceFallback implements UserServiceClient {
    
    @Override
    public User getUser(Long id) {
        throw new ServiceUnavailableException("User service unavailable");
    }
}
```

### Mistake 4: Hardcoding Eureka URL

```java
// WRONG: Not using environment variable
eureka:
  client:
    service-url:
      defaultZone: http://localhost:8761/eureka/  # Hardcoded!

// CORRECT: Use environment variable
eureka:
  client:
    service-url:
      defaultZone: ${EUREKA_SERVER_URL:http://localhost:8761/eureka/}
```

### Mistake 5: Not Deregistering on Shutdown

```java
// WRONG: Service not deregistered on shutdown
// Leaves "dead" instances in Eureka

// CORRECT: Ensure proper deregistration
eureka:
  instance:
    instance-id: ${spring.application.name}:${server.port}
    # Use graceful shutdown
    prefer-ip-address: true

// For Kubernetes, add preStop hook
# pod.yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

---

## Summary

Eureka provides robust client-side service discovery for Spring Cloud microservices:

1. **Self-registration**: Services automatically register with Eureka server.

2. **Heartbeat mechanism**: Services send heartbeats to maintain registration.

3. **Client-side load balancing**: Ribbon integration provides flexible load balancing.

4. **Fallback support**: Feign clients can fall back when services are unavailable.

5. **Zone-aware routing**: Support for multi-zone deployments.

Key considerations for production:
- Run Eureka in high-availability mode (3+ nodes)
- Configure appropriate lease duration for your needs
- Enable health checks so Eureka knows actual service health
- Monitor registration and heartbeat metrics

---

## References

- [Netflix Eureka GitHub](https://github.com/Netflix/eureka)
- [Spring Cloud Netflix Documentation](https://spring.io/projects/spring-cloud-netflix)
- [Baeldung - Service Discovery with Eureka](https://www.baeldung.com/spring-cloud-eureka)
- [Eureka Wiki](https://github.com/Netflix/eureka/wiki)