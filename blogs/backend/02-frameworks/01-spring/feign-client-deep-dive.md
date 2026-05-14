---
title: Feign Client Deep Dive
description: >-
  Master Feign configuration, interceptors, error handling, and advanced
  patterns for declarative HTTP clients in Spring Cloud
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - feign
  - spring-cloud
  - http-client
coverImage: /images/feign-client-deep-dive.png
draft: false
order: 40
---
# Feign Client Deep Dive: Advanced Configuration and Patterns

## Overview

Feign is a declarative HTTP client that simplifies service-to-service communication in microservices architectures. Instead of writing boilerplate HTTP client code, you define a Java interface with annotations, and Feign generates the implementation at runtime. When integrated with Spring Cloud, Feign adds load balancing, service discovery, circuit breakers, and metrics out of the box.

This guide covers Feign architecture, configuration options, interceptors, error handling, and advanced production patterns.

---

## How Feign Works Internally

### Request Processing Pipeline

Feign processes each request through a chain of components:

```java
// Simplified internal architecture
public class FeignClientFactory {

    public <T> T create(Class<T> apiType, Feign.Builder builder) {
        // 1. Parse annotations and build method handlers
        Contract contract = builder.getContract();
        Map<Method, MethodHandler> handlers = contract.parseAndValidate(apiType);

        // 2. Build the invocation handler
        InvocationHandler handler = new FeignInvocationHandler(apiType, handlers);

        // 3. Create proxy for the interface
        return (T) Proxy.newProxyInstance(
            apiType.getClassLoader(),
            new Class<?>[] { apiType },
            handler
        );
    }
}

class FeignInvocationHandler implements InvocationHandler {

    private final Map<Method, MethodHandler> handlers;
    private final Request.Options options;

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) {
        MethodHandler handler = handlers.get(method);

        // Build request template from annotations
        RequestTemplate template = handler.createTemplate(args);

        // Apply interceptors
        for (RequestInterceptor interceptor : interceptors) {
            interceptor.apply(template);
        }

        // Execute request through client
        Request request = template.request();
        Response response = client.execute(request, options);

        // Decode response
        return decoder.decode(response, method.getGenericReturnType());
    }
}
```

Feign uses Java's `Proxy.newProxyInstance` to generate implementations at runtime. The `Contract` parses the interface's annotations (Spring MVC or Feign-native) and builds `MethodHandler` entries for each method. When a method is called, Feign constructs an HTTP request from the annotations, runs through `RequestInterceptor` instances to add headers or modify the request, executes via the configured HTTP client, and finally decodes the response using the configured `Decoder`. This pipeline makes Feign highly extensible — each stage can be customized independently.

### Client Resolution with Load Balancing

```java
// Spring Cloud integrates Feign with Ribbon/LoadBalancer
@Configuration
public class FeignLoadBalancerConfig {

    @Bean
    @ConditionalOnMissingBean
    public Client feignClient(CachingSpringLoadBalancerFactory factory,
                               SpringClientFactory clientFactory) {
        return new LoadBalancerFeignClient(
            new DefaultFeignClient(),
            factory,
            clientFactory
        );
    }
}

// The load-balanced client resolves service names to instances
public class LoadBalancerFeignClient implements Client {

    @Override
    public Response execute(Request request, Request.Options options) {
        // Extract service name from URL
        String serviceName = extractServiceName(request.url());

        // Get load-balanced URI
        ServiceInstance instance = loadBalancer.choose(serviceName);
        String resolvedUrl = replaceServiceName(request.url(), instance.getHost(), instance.getPort());

        // Create new request with resolved URL
        Request newRequest = Request.create(
            request.httpMethod(),
            resolvedUrl,
            request.headers(),
            request.body(),
            request.charset()
        );

        // Execute with the default client
        return delegate.execute(newRequest, options);
    }
}
```

When using service discovery (Eureka, Kubernetes), Feign URLs contain logical service names like `http://user-service/api/users` instead of concrete hostnames. The `LoadBalancerFeignClient` intercepts the request, resolves the service name to an available instance via the load balancer, substitutes the host and port, and delegates execution. This integration is seamless — Feign clients simply declare the service name and Spring Cloud handles instance selection, retry on different nodes, and failure awareness.

---

## Advanced Feign Configuration

### Custom Configuration with @FeignClient

```java
@FeignClient(
    name = "order-service",
    url = "${order.service.url}",
    configuration = OrderServiceFeignConfig.class,
    fallbackFactory = OrderServiceFallbackFactory.class,
    primary = false,
    qualifier = "orderServiceClient"
)
public interface OrderServiceClient {

    @PostMapping("/orders")
    OrderResponse createOrder(@RequestBody CreateOrderRequest request);

    @GetMapping("/orders/{orderId}")
    OrderResponse getOrder(@PathVariable("orderId") String orderId);

    @PutMapping("/orders/{orderId}/status")
    OrderResponse updateOrderStatus(
        @PathVariable("orderId") String orderId,
        @RequestBody StatusUpdateRequest request);
}

public class OrderServiceFeignConfig {

    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.FULL;
    }

    @Bean
    public Request.Options requestOptions() {
        return new Request.Options(
            2000, TimeUnit.MILLISECONDS,
            5000, TimeUnit.MILLISECONDS
        );
    }

    @Bean
    public Retryer retryer() {
        return new Retryer.Default(100, 1000, 3);
    }

    @Bean
    public ErrorDecoder errorDecoder() {
        return new OrderServiceErrorDecoder();
    }

    @Bean
    public RequestInterceptor correlationIdInterceptor() {
        return template -> {
            String correlationId = MDC.get("correlationId");
            if (correlationId != null) {
                template.header("X-Correlation-Id", correlationId);
            }
        };
    }
}
```

Per-client configuration classes allow fine-tuning for each downstream service's characteristics. The `order-service` client gets aggressive timeouts (2s connect, 5s read) because order processing should fail fast rather than hang. The `correlationIdInterceptor` propagates the MDC correlation ID across service boundaries — critical for distributed tracing in microservice architectures. Note that configuration classes are instantiated by Feign and should not be annotated with `@Configuration` themselves to avoid being picked up by component scanning; instead, reference them via the `configuration` attribute of `@FeignClient`.

### Decoder and Encoder Customization

```java
@Configuration
public class FeignCodecConfig {

    @Bean
    public Decoder feignDecoder(ObjectMapper mapper) {
        return new ResponseEntityDecoder(new SpringDecoder(() -> {
            HttpMessageConverters converters = new HttpMessageConverters(
                new MappingJackson2HttpMessageConverter(mapper)
            );
            return new HttpMessageConvertersCustomizer() {
                @Override
                public void customize(HttpMessageConverters customizers) {
                    // Custom message converters
                }
            };
        }));
    }

    @Bean
    public Encoder feignEncoder(ObjectMapper mapper) {
        return new SpringEncoder(() -> {
            HttpMessageConverters converters = new HttpMessageConverters(
                new MappingJackson2HttpMessageConverter(mapper)
            );
            return new HttpMessageConvertersCustomizer() {
                @Override
                public void customize(HttpMessageConverters customizers) {
                    // Custom message converters
                }
            };
        });
    }

    @Bean
    public Contract feignContract() {
        return new SpringMvcContract();
    }
}
```

Custom decoders and encoders give full control over serialization. The `ResponseEntityDecoder` wraps another decoder and preserves HTTP response metadata (status code, headers) alongside the deserialized body — useful when callers need to inspect response headers. The `SpringMvcContract` enables the use of familiar Spring MVC annotations (`@GetMapping`, `@PostMapping`, `@PathVariable`) on Feign interfaces rather than Feign-native annotations (`@RequestLine`, `@Param`). This keeps Feign client code consistent with the rest of your Spring application.

---

## Interceptors

### Built-in Interceptor Types

```java
// Request Interceptor - modifies outgoing requests
@Component
public class CustomRequestInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // Add common headers
        template.header("X-Service-Version", "1.0");
        template.header("X-Request-Time", String.valueOf(System.currentTimeMillis()));

        // Add query parameters
        template.query("source", "backend-service");

        // Modify URI
        if (template.url().contains("legacy")) {
            template.uri("/api/v2" + template.url());
        }
    }
}

// Response Interceptor - not built-in, but can be achieved via Decoder
@Component
public class ResponseLoggingDecoder implements Decoder {

    private final Decoder delegate;
    private static final Logger log = LoggerFactory.getLogger(ResponseLoggingDecoder.class);

    public ResponseLoggingDecoder(Decoder delegate) {
        this.delegate = delegate;
    }

    @Override
    public Object decode(Response response, Type type) {
        log.info("Response: {} {} - Headers: {}",
            response.status(), response.reason(), response.headers());

        return delegate.decode(response, type);
    }
}
```

Feign's interceptor model is request-only — interceptors modify requests before they are sent. For response interception, the pattern is to decorate the `Decoder`. The `ResponseLoggingDecoder` wraps the real decoder, logs the response status and headers, then delegates deserialization. This decorator pattern is idiomatic Feign: because the request and response pipelines are separate, you compose cross-cutting behavior by wrapping `Client`, `Decoder`, or `Encoder` instances rather than using a unified interceptor chain.

### Authentication Interceptors

```java
@Component
public class OAuth2FeignInterceptor implements RequestInterceptor {

    @Autowired
    private OAuth2ClientContext oauth2ClientContext;

    @Autowired
    private OAuth2ProtectedResourceDetails resource;

    @Override
    public void apply(RequestTemplate template) {
        // Skip if authorization header already present
        if (template.headers().containsKey("Authorization")) {
            return;
        }

        String accessToken = oauth2ClientContext.getAccessToken()
            .orElseGet(this::refreshToken);

        template.header("Authorization", "Bearer " + accessToken.getValue());
    }

    private AccessToken refreshToken() {
        // Implement token refresh logic
        AccessTokenProviderChain provider = new AccessTokenProviderChain(
            List.of(new AuthorizationCodeAccessTokenProvider())
        );
        return provider.obtainAccessToken(resource, new DefaultAccessTokenRequest());
    }
}

@Component
public class ApiKeyInterceptor implements RequestInterceptor {

    @Value("${api.key}")
    private String apiKey;

    @Override
    public void apply(RequestTemplate template) {
        template.header("X-API-Key", apiKey);
        template.header("X-API-Secret", decryptApiSecret());
    }

    private String decryptApiSecret() {
        // Decrypt stored secret
        return decryptionService.decrypt(encryptedSecret);
    }
}
```

Authentication interceptors handle credential injection transparently. The `OAuth2FeignInterceptor` checks whether an Authorization header already exists (to avoid overwriting explicit credentials), falls back to the OAuth2 client context, and triggers token refresh if the access token is expired. The guard against duplicate headers is important when clients might already have a token from a parent context. The `ApiKeyInterceptor` demonstrates decrypting stored secrets at runtime — never hardcode API keys or store them in plaintext configuration files; use a secrets manager or encrypted configuration properties.

### Correlation ID Propagation

```java
@Component
public class CorrelationIdInterceptor implements RequestInterceptor {

    private static final String CORRELATION_ID_HEADER = "X-Correlation-Id";

    @Override
    public void apply(RequestTemplate template) {
        String correlationId = MDC.get(CORRELATION_ID_HEADER);

        if (correlationId == null) {
            correlationId = UUID.randomUUID().toString();
        }

        template.header(CORRELATION_ID_HEADER, correlationId);
    }
}

// Feign configuration for Sleuth/Zipkin integration
@Configuration
public class TracingFeignConfig {

    @Bean
    public RequestInterceptor tracingInterceptor(Tracer tracer) {
        return template -> {
            Span span = tracer.currentSpan();
            if (span != null) {
                template.header("X-B3-TraceId", span.context().traceIdString());
                template.header("X-B3-SpanId", span.context().spanIdString());
                template.header("X-B3-Sampled", span.context().isSampled() ? "1" : "0");
            }
        };
    }
}
```

Correlation ID propagation is essential for debugging request flows across microservices. The `CorrelationIdInterceptor` reads from SLF4J's MDC context, which is populated by a servlet filter or Spring Cloud Sleuth at the entry point. If no correlation ID exists (e.g., the request originated from a scheduled task), a new UUID is generated. The `TracingFeignConfig` demonstrates Sleuth/Zipkin B3 propagation headers, enabling end-to-end trace visualization in tools like Jaeger or Zipkin — without this, a single user request that traverses five services produces five unrelated log entries.

---

## Error Handling

### Custom ErrorDecoder

```java
public class ProductServiceErrorDecoder implements ErrorDecoder {

    private static final Logger log = LoggerFactory.getLogger(ProductServiceErrorDecoder.class);

    @Override
    public Exception decode(String methodKey, Response response) {
        String responseBody = extractResponseBody(response);

        log.error("Feign error [{}] - Method: {} - Status: {} - Body: {}",
            getErrorId(), methodKey, response.status(), responseBody);

        HttpStatus status = HttpStatus.valueOf(response.status());

        if (status.is4xxClientError()) {
            return handle4xxError(methodKey, status, responseBody);
        } else if (status.is5xxServerError()) {
            return handle5xxError(methodKey, status, responseBody);
        }

        return new ExternalServiceException(
            "Unexpected HTTP status: " + response.status());
    }

    private Exception handle4xxError(String methodKey, HttpStatus status, String body) {
        if (status == HttpStatus.NOT_FOUND) {
            return new ResourceNotFoundException(body);
        }
        if (status == HttpStatus.BAD_REQUEST) {
            return new BadRequestException(body);
        }
        if (status == HttpStatus.TOO_MANY_REQUESTS) {
            return new RateLimitException(body);
        }
        return new ClientException(status.value(), body);
    }

    private Exception handle5xxError(String methodKey, HttpStatus status, String body) {
        if (status == HttpStatus.SERVICE_UNAVAILABLE) {
            return new ServiceUnavailableException(body);
        }
        return new ServerException(status.value(), body);
    }

    private String extractResponseBody(Response response) {
        try {
            if (response.body() != null) {
                return Util.toString(response.body().asReader(StandardCharsets.UTF_8));
            }
        } catch (IOException e) {
            log.warn("Failed to read response body", e);
        }
        return "No response body";
    }

    private String getErrorId() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
```

A well-designed `ErrorDecoder` is the cornerstone of Feign error handling. This implementation groups errors by 4xx/5xx category, logs a unique error ID for correlation, and maps each status code to a specific domain exception. The `extractResponseBody` method reads the response body carefully without leaking resources — Feign's `Response` body can be consumed only once, so the method reads it into a string within a try-catch. The error ID generated via `getErrorId()` is logged and should be returned to upstream callers so they can reference it in support tickets.

### Fallback with FallbackFactory

```java
@Component
public class InventoryServiceFallbackFactory
        implements FallbackFactory<InventoryServiceClient> {

    private static final Logger log = LoggerFactory.getLogger(
        InventoryServiceFallbackFactory.class);

    @Override
    public InventoryServiceClient create(Throwable cause) {
        log.error("Fallback triggered for InventoryServiceClient", cause);

        return new InventoryServiceClient() {

            @Override
            public InventoryResponse checkStock(String sku) {
                log.warn("Fallback: checkStock({}) - cause: {}",
                    sku, cause.getMessage());
                return InventoryResponse.builder()
                    .sku(sku)
                    .available(false)
                    .estimatedRestockDays(3)
                    .build();
            }

            @Override
            public InventoryReservationResponse reserveStock(
                    ReserveStockRequest request) {
                log.warn("Fallback: reserveStock({}) - cause: {}",
                    request.getSku(), cause.getMessage());
                throw new ServiceUnavailableException(
                    "Inventory service unavailable", cause);
            }

            @Override
            public List<InventoryResponse> bulkCheckStock(List<String> skus) {
                log.warn("Fallback: bulkCheckStock - cause: {}",
                    cause.getMessage());
                return skus.stream()
                    .map(sku -> InventoryResponse.builder()
                        .sku(sku)
                        .available(false)
                        .build())
                    .toList();
            }
        };
    }
}

@FeignClient(
    name = "inventory-service",
    url = "${inventory.service.url}",
    fallbackFactory = InventoryServiceFallbackFactory.class
)
public interface InventoryServiceClient {

    @GetMapping("/inventory/{sku}")
    InventoryResponse checkStock(@PathVariable("sku") String sku);

    @PostMapping("/inventory/reserve")
    InventoryReservationResponse reserveStock(@RequestBody ReserveStockRequest request);

    @PostMapping("/inventory/bulk")
    List<InventoryResponse> bulkCheckStock(@RequestBody List<String> skus);
}
```

`FallbackFactory` is more powerful than simple `fallback` because it provides access to the triggering `Throwable`. This allows context-aware fallback logic: read operations like `checkStock` return safe defaults (unavailable, estimated restock), while write operations like `reserveStock` throw an exception to signal that the operation did not complete — the caller must handle this explicitly rather than silently accepting a no-op. The factory logs the cause for observability. Always provide sensible defaults for read operations that allow the system to degrade gracefully.

### Retry Logic

```java
// Custom Retryer with exponential backoff
public class ExponentialBackoffRetryer implements Retryer {

    private final int maxAttempts;
    private final long initialInterval;
    private final double multiplier;
    private int attempt;
    private long interval;

    public ExponentialBackoffRetryer(int maxAttempts, long initialInterval, double multiplier) {
        this.maxAttempts = maxAttempts;
        this.initialInterval = initialInterval;
        this.multiplier = multiplier;
        this.attempt = 1;
        this.interval = initialInterval;
    }

    @Override
    public void continueOrPropagate(RetryableException e) {
        if (attempt >= maxAttempts) {
            throw e;
        }

        if (!isRetryable(e)) {
            throw e;
        }

        log.info("Retry attempt {}/{} after {}ms - {}",
            attempt, maxAttempts, interval, e.getMessage());

        try {
            Thread.sleep(interval);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw e;
        }

        attempt++;
        interval = (long) (interval * multiplier);
    }

    @Override
    public Retryer clone() {
        return new ExponentialBackoffRetryer(maxAttempts, initialInterval, multiplier);
    }

    private boolean isRetryable(RetryableException e) {
        return e.status() == 503 || e.status() == 502
            || e.status() == 429 || e.getCause() instanceof IOException;
    }
}

@Configuration
public class RetryConfig {

    @Bean
    @ConditionalOnMissingBean
    public Retryer feignRetryer() {
        return new ExponentialBackoffRetryer(3, 200, 2.0);
    }
}
```

Feign's `Retryer` interface provides simple retry logic at the transport level, before response deserialization. The custom implementation above implements exponential backoff with jitter-like behavior via the multiplier — delays grow as 200ms, 400ms, 800ms. The `isRetryable` check ensures only transient errors (502, 503, 429, connection failures) trigger retries; 4xx client errors are never retried. The `clone()` method is required because Feign creates a new `Retryer` instance per client invocation, and each instance maintains its own attempt counter.

---

## Performance Optimization

### Connection Pooling

```java
@Configuration
public class FeignConnectionPoolConfig {

    @Bean
    public Client feignClient() {
        return new ApacheHttpClient(
            HttpClientBuilder.create()
                .setMaxConnTotal(200)
                .setMaxConnPerRoute(50)
                .setConnectionTimeToLive(30, TimeUnit.SECONDS)
                .evictExpiredConnections()
                .evictIdleConnections(30, TimeUnit.SECONDS)
                .setDefaultRequestConfig(RequestConfig.custom()
                    .setConnectTimeout(5000)
                    .setSocketTimeout(10000)
                    .setConnectionRequestTimeout(3000)
                    .build()
                )
                .build()
        );
    }
}

// Alternative with OkHttp
@Configuration
@ConditionalOnClass(OkHttpClient.class)
public class OkHttpFeignConfig {

    @Bean
    public Client feignClient() {
        return new OkHttpClient(
            new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .writeTimeout(5, TimeUnit.SECONDS)
                .connectionPool(new ConnectionPool(50, 30, TimeUnit.SECONDS))
                .retryOnConnectionFailure(true)
                .build()
        );
    }
}
```

Feign's default client uses `java.net.HttpURLConnection`, which has limited connection pooling and lacks timeout configurability. Replacing it with Apache HttpClient or OkHttp is essential for production deployments. The Apache configuration above sets 200 total connections with 50 per route, 30-second TTL, and idle connection eviction — matching the patterns from RestTemplate best practices. OkHttp offers a lighter alternative with built-in connection pooling and `retryOnConnectionFailure(true)` for transparent recovery from transient network issues. Choose Apache for maximum configurability or OkHttp for a leaner dependency footprint.

### Compression

```java
@Configuration
public class FeignCompressionConfig {

    @Bean
    public Feign.Builder feignBuilder() {
        return Feign.builder()
            .encoder(new GzipEncoder(new JacksonEncoder()))
            .decoder(new JacksonDecoder());
    }
}

// Application configuration
// feign.compression.request.enabled=true
// feign.compression.request.mime-types=application/json,application/xml
// feign.compression.request.min-request-size=2048
// feign.compression.response.enabled=true
```

Request and response compression reduces bandwidth usage and latency for large payloads. The `GzipEncoder` wraps the `JacksonEncoder`, compressing request bodies before sending, while Spring Cloud's `feign.compression` properties enable response decompression automatically. Setting `min-request-size=2048` avoids compressing tiny payloads where compression overhead outweighs savings. Compression is particularly beneficial when communicating with services over limited-bandwidth connections or when paying for egress in cloud environments.

### HTTP/2 Support

```java
@Configuration
public class Http2FeignConfig {

    @Bean
    public Client feignClient() {
        return new Http2Client(new DefaultFeignClient());
    }
}

// Custom HTTP/2 client
public class Http2Client implements Client {

    private final Client delegate;
    private final CloseableHttpClient http2Client;

    public Http2Client(Client delegate) {
        this.delegate = delegate;
        this.http2Client = HttpClientBuilder.create()
            .setDefaultRequestConfig(RequestConfig.custom()
                .setConnectTimeout(5000)
                .setSocketTimeout(10000)
                .build())
            .useSystemProperties()
            .build();
    }

    @Override
    public Response execute(Request request, Request.Options options) {
        // Check if HTTP/2 is supported by the server
        if (request.url().startsWith("https://")) {
            return executeWithHttp2(request, options);
        }
        return delegate.execute(request, options);
    }

    private Response executeWithHttp2(Request request, Request.Options options) {
        try {
            HttpUriRequest httpRequest = buildHttpRequest(request);
            CloseableHttpResponse httpResponse = http2Client.execute(httpRequest);
            return buildFeignResponse(request, httpResponse);
        } catch (IOException e) {
            throw new FeignException(e.getMessage(), e);
        }
    }
}
```

HTTP/2 multiplexes multiple requests over a single TCP connection, reducing connection overhead and enabling server push. The custom client delegates HTTP/1.1 requests to the default client and uses Apache HttpClient with HTTP/2 for HTTPS endpoints. In practice, HTTP/2 provides the most benefit when calling services that support it natively and when making many concurrent requests to the same server. Note that HTTP/2 requires TLS, so the optimization is only applied to `https://` URLs.

---

## Testing Feign Clients

```java
@SpringBootTest
@AutoConfigureMockMvc
class OrderServiceClientTest {

    @Autowired
    private OrderServiceClient orderServiceClient;

    @Test
    void shouldCreateOrderSuccessfully() {
        CreateOrderRequest request = CreateOrderRequest.builder()
            .productId("PROD-123")
            .quantity(2)
            .customerId("CUST-456")
            .build();

        OrderResponse response = orderServiceClient.createOrder(request);

        assertThat(response).isNotNull();
        assertThat(response.getOrderId()).isNotBlank();
        assertThat(response.getStatus()).isEqualTo("CONFIRMED");
    }

    @Test
    void shouldHandleTimeoutGracefully() {
        assertThatThrownBy(() ->
            orderServiceClient.getOrder("timeout-order")
        ).isInstanceOf(RetryableException.class);
    }
}

// WireMock testing
@SpringBootTest
@WireMockTest(httpPort = 8089)
class FeignWireMockTest {

    @Test
    void shouldReturnProductDetails() {
        ProductResponse expected = ProductResponse.builder()
            .id("PROD-001")
            .name("Test Product")
            .price(new BigDecimal("99.99"))
            .build();

        stubFor(get(urlEqualTo("/products/PROD-001"))
            .willReturn(aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("""
                    {"id":"PROD-001","name":"Test Product","price":99.99}
                """)));

        ProductResponse actual = productClient.getProduct("PROD-001");

        assertThat(actual.getId()).isEqualTo(expected.getId());
        assertThat(actual.getName()).isEqualTo(expected.getName());
    }
}
```

Integration testing with Feign requires careful setup because the client relies on Spring's dependency injection and, optionally, service discovery. The first test uses `@SpringBootTest` with the full application context, validating that autowiring and configuration work correctly. The WireMock approach is more targeted — it starts a lightweight HTTP server on a known port and stubs specific endpoints, allowing tests to verify serialization, error handling, and retry behavior without depending on an external service. WireMock also supports verifying that the expected request was made with correct headers and body, making it ideal for testing interceptor and authentication logic.

---

## Common Mistakes

### Mistake 1: Not Handling Circular References in Fallbacks

```java
// WRONG: Fallback method calls the same Feign client
@Component
public class BrokenFallback implements UserClient {

    @Autowired
    private UserClient userClient;

    @Override
    public User getUser(Long id) {
        log.warn("Fallback triggered!");
        return userClient.getUser(id);  // Infinite loop!
    }
}

// CORRECT: Return default values or throw
@Component
public class CorrectFallback implements UserClient {

    @Override
    public User getUser(Long id) {
        log.warn("Returning default user for id: {}", id);
        return new User(id, "Unknown", "UNKNOWN");
    }
}
```

A fallback that calls the same Feign client creates an infinite recursion — the call triggers the circuit breaker, which calls the fallback, which calls the client, which triggers the circuit breaker again. Feign does not detect this cycle; it simply exhausts the thread pool or stack. Fallbacks must return a value or throw an exception, never delegate back to the original client. For complex fallback logic, use `FallbackFactory` with access to the cause exception to determine the appropriate response.

### Mistake 2: Missing @RequestBody on Feign Methods

```java
// WRONG: Missing @RequestBody annotation
@FeignClient(name = "payment")
public interface BrokenPaymentClient {

    @PostMapping("/payments")
    PaymentResponse processPayment(PaymentRequest request);  // No @RequestBody!
}

// CORRECT: Always annotate request body
@FeignClient(name = "payment")
public interface CorrectPaymentClient {

    @PostMapping("/payments")
    PaymentResponse processPayment(@RequestBody PaymentRequest request);
}
```

Without `@RequestBody`, Spring MVC's `DispatcherServlet` does not know that the parameter should be serialized as the request body. Feign's `SpringMvcContract` relies on these annotations to build the `RequestTemplate`. The missing annotation causes Feign to treat the parameter as a query parameter or ignore it entirely, resulting in empty or malformed requests. As a rule, all POST, PUT, and PATCH method parameters that represent the request payload must be annotated with `@RequestBody`.

### Mistake 3: Using Spring MVC Annotations Without Spring Cloud

```java
// WRONG: Using only Feign without Spring Cloud
@FeignClient(name = "service")
public interface BrokenClient {

    @GetMapping("/data")
    Data getData(@RequestParam("id") String id);  // Spring annotations!
}

// CORRECT: Use either Feign annotations or ensure Spring Cloud is on classpath
// With Spring Cloud:
@FeignClient(name = "service")
public interface CorrectClient {

    @RequestMapping(method = RequestMethod.GET, value = "/data")
    Data getData(@RequestParam("id") String id);
}
```

The `@FeignClient` annotation and Spring MVC annotations (`@GetMapping`, `@RequestParam`) come from different libraries. `@FeignClient` is from Spring Cloud OpenFeign, while `@GetMapping` is from Spring Web. They work together only when a `SpringMvcContract` bean is registered — Spring Cloud OpenFeign provides this automatically. If you use Feign standalone (without Spring Cloud), you must use Feign-native annotations (`@RequestLine`, `@Param`). Always verify that `spring-cloud-starter-openfeign` is on the classpath when using Spring MVC annotations on Feign interfaces.

### Mistake 4: Not Setting Timeout for Each Client

```java
// WRONG: Global timeout too aggressive
@Bean
public Request.Options globalOptions() {
    return new Request.Options(500, 1000);  // Affects ALL clients!
}

// CORRECT: Per-client timeout
@FeignClient(name = "fast-service", configuration = FastServiceConfig.class)
public interface FastServiceClient { }

@FeignClient(name = "slow-service", configuration = SlowServiceConfig.class)
public interface SlowServiceClient { }

public class FastServiceConfig {
    @Bean
    public Request.Options options() {
        return new Request.Options(1000, 3000);
    }
}

public class SlowServiceConfig {
    @Bean
    public Request.Options options() {
        return new Request.Options(5000, 30000);
    }
}
```

A single global `Request.Options` bean applies to all Feign clients, forcing services with different latency profiles to share the same timeout. A fast in-memory cache service might respond in 10ms, while a legacy batch service needs 30 seconds. Using a global 1-second timeout would cause the batch service to fail constantly. Configure timeouts per client by providing a dedicated configuration class in the `@FeignClient` annotation. Each client then receives appropriate timeouts based on the downstream service's actual performance characteristics.

### Mistake 5: Ignoring Feign Exception Types

```java
// WRONG: Catching generic Exception
try {
    orderClient.createOrder(request);
} catch (Exception e) {
    log.error("Failed: {}", e.getMessage());
    // Can't determine if retryable or not
}

// CORRECT: Handle specific Feign exceptions
try {
    orderClient.createOrder(request);
} catch (FeignException.FeignClientException e) {
    log.error("Client error ({}): {}", e.status(), e.getMessage());
    throw new BusinessException("Invalid order request", e);
} catch (FeignException.FeignServerException e) {
    log.error("Server error ({}): {}", e.status(), e.getMessage());
    throw new ServiceUnavailableException("Order service unavailable", e);
} catch (RetryableException e) {
    log.error("Retry exhausted: {}", e.getMessage());
    throw new ServiceUnavailableException("Order service not responding", e);
}
```

Feign throws distinct exception types: `FeignClientException` (4xx responses), `FeignServerException` (5xx responses), and `RetryableException` (when retries are exhausted). Catching generic `Exception` loses this semantic information. The correct approach handles each type separately: client exceptions indicate caller errors that should propagate to the user, server exceptions indicate downstream failures that might trigger circuit breakers, and `RetryableException` signals that the system is truly unavailable after exhausting retries. Always handle `RetryableException` at the call boundary to provide a meaningful user experience.

---

## Summary

Feign is a powerful tool for simplifying HTTP communication in microservices. Key takeaways:

1. **Declarative clients**: Define interfaces with annotations and Feign generates the implementation via JDK dynamic proxies, eliminating boilerplate HTTP code entirely.
2. **Integration**: Deep integration with Spring Cloud, Eureka, and Resilience4j means service discovery, load balancing, and circuit breakers work with minimal configuration.
3. **Customization**: Interceptors modify requests, custom decoders/encoders control serialization, and `ErrorDecoder` maps HTTP errors to typed exceptions — each pipeline stage is independently customizable.
4. **Resilience**: `FallbackFactory` provides context-aware fallback logic, `Retryer` handles transient failures with exponential backoff, and Resilience4j annotations add circuit breaker, rate limiter, and bulkhead patterns.
5. **Performance**: Connection pooling via Apache HttpClient or OkHttp, GZip compression for large payloads, and HTTP/2 multiplexing all contribute to production-grade throughput.

When used correctly, Feign eliminates boilerplate HTTP code while maintaining flexibility for advanced use cases. The key to success is per-client configuration — each downstream service has unique latency, error, and resilience requirements that should be expressed through its own Feign configuration class.

---

## References

- [Spring Cloud OpenFeign Documentation](https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/)
- [Feign GitHub Repository](https://github.com/OpenFeign/feign)
- [Resilience4j Spring Cloud Documentation](https://resilience4j.readme.io/docs/feign)
- [Baeldung - Feign Guide](https://www.baeldung.com/spring-cloud-feign)

---

Happy Coding
