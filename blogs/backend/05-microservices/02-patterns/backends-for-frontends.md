---
title: Backends for Frontends (BFF) Pattern
description: >-
  Implement the Backends for Frontends pattern: separate API gateways for each
  client type, mobile BFF, web BFF, GraphQL BFF, and Spring Cloud Gateway
  configuration
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - bff
  - api-gateway
  - microservices
  - frontend
coverImage: /images/backends-for-frontends.png
draft: false
order: 10
---
## Overview

The Backends for Frontends (BFF) pattern creates separate backend services for each client type (web, mobile, IoT). Each BFF is tailored to the specific needs of its client, optimizing payload size, data format, and API surface area.

## Why BFF?

Mobile clients need lightweight payloads (thumbnails, not full-resolution images) and optimized endpoints for battery life and bandwidth. Web clients need richer data for SEO, structured data, and complex UI rendering. A single API serving both results in either over-fetching (bad for mobile) or under-fetching (bad for web).

```java
// Web client needs full product details
@GetMapping("/api/web/products/{id}")
public WebProductResponse getProduct(@PathVariable String id) {
    Product product = productService.getProduct(id);
    return WebProductResponse.builder()
        .id(product.getId())
        .name(product.getName())
        .description(product.getDescription())
        .images(product.getHighResImages())
        .specifications(product.getSpecifications())
        .reviews(product.getReviews())
        .relatedProducts(product.getRelatedProducts())
        .build();
}

// Mobile client needs minimal payload
@GetMapping("/api/mobile/products/{id}")
public MobileProductResponse getProduct(@PathVariable String id) {
    Product product = productService.getProduct(id);
    return MobileProductResponse.builder()
        .id(product.getId())
        .name(product.getName())
        .thumbnail(product.getThumbnail())
        .price(product.getPrice())
        .build();
}
```

## BFF Gateway Configuration

### Web BFF

The Web BFF route configuration rewrites paths (`/api/web/products/**` → `/products/**`) and adds a `X-BFF-Type: web` header so downstream services can tailor responses if needed. Rate limiting is configured independently per BFF — web clients may have higher limits than mobile clients.

```java
@Configuration
public class WebBffConfig {

    @Bean
    public RouteLocator webBffRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("web-products", r -> r
                .path("/api/web/products/**")
                .filters(f -> f
                    .rewritePath("/api/web/(?<segment>.*)", "/${segment}")
                    .addResponseHeader("X-BFF-Type", "web")
                    .requestRateLimiter(c -> c
                        .setReplenishRate(100)
                        .setBurstCapacity(200)))
                .uri("lb://web-bff"))
            .route("web-users", r -> r
                .path("/api/web/users/**")
                .filters(f -> f
                    .rewritePath("/api/web/(?<segment>.*)", "/${segment}"))
                .uri("lb://web-bff"))
            .build();
    }
}
```

### Mobile BFF

The Mobile BFF doubles the rate limit compared to web BFF (200 replenish rate vs 100), reflecting the higher request volume typical of mobile clients polling for updates. The `Content-Type` header is explicitly set to ensure consistent response formatting across mobile OS versions.

```java
@Configuration
public class MobileBffConfig {

    @Bean
    public RouteLocator mobileBffRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("mobile-products", r -> r
                .path("/api/mobile/products/**")
                .filters(f -> f
                    .rewritePath("/api/mobile/(?<segment>.*)", "/${segment}")
                    .addResponseHeader("X-BFF-Type", "mobile")
                    .setResponseHeader("Content-Type", "application/json")
                    .requestRateLimiter(c -> c
                        .setReplenishRate(200)
                        .setBurstCapacity(400)))
                .uri("lb://mobile-bff"))
            .route("mobile-cart", r -> r
                .path("/api/mobile/cart/**")
                .filters(f -> f
                    .rewritePath("/api/mobile/(?<segment>.*)", "/${segment}"))
                .uri("lb://mobile-bff"))
            .build();
    }
}
```

## Mobile BFF Implementation

The Mobile BFF controller aggregates data from multiple downstream services into a mobile-optimized response. It fetches product, inventory, and pricing data in parallel (`Mono.zip`), then constructs a minimal payload — only thumbnail, price, stock status, and delivery estimate. The `X-Client-Version` header enables version-specific formatting.

```java
@RestController
@RequestMapping("/api/mobile")
public class MobileBffController {

    @Autowired
    private ProductServiceClient productClient;

    @Autowired
    private InventoryServiceClient inventoryClient;

    @Autowired
    private PricingServiceClient pricingClient;

    @GetMapping("/products/{id}")
    public Mono<MobileProductResponse> getProduct(@PathVariable String id,
                                                    @RequestHeader("X-Client-Version") String version) {
        Mono<Product> productMono = productClient.getProduct(id);
        Mono<Inventory> inventoryMono = inventoryClient.getInventory(id);
        Mono<Price> priceMono = pricingClient.getPrice(id);

        return Mono.zip(productMono, inventoryMono, priceMono)
            .map(tuple -> {
                Product product = tuple.getT1();
                Inventory inventory = tuple.getT2();
                Price price = tuple.getT3();

                MobileProductResponse response = new MobileProductResponse();
                response.setId(product.getId());
                response.setName(product.getName());
                response.setThumbnail(product.getThumbnails().get(0));
                response.setPrice(formatPrice(price, version));
                response.setInStock(inventory.getAvailableQuantity() > 0);
                response.setEstimatedDelivery(calculateDelivery(inventory));

                return response;
            });
    }

    @GetMapping("/feed")
    public Flux<MobileFeedItem> getFeed(@RequestParam int page, @RequestParam int size) {
        return productClient.getFeaturedProducts(page, size)
            .map(product -> {
                MobileFeedItem item = new MobileFeedItem();
                item.setId(product.getId());
                item.setTitle(product.getName());
                item.setImageUrl(product.getThumbnails().get(0));
                item.setPrice(product.getPrice().toString());
                item.setDiscount(product.getDiscountPercent());
                return item;
            });
    }
}
```

## Web BFF Implementation

The Web BFF returns a richer response — reviews, SEO metadata, related products, breadcrumbs, and structured data for search engines. Parallel execution (`CompletableFuture.allOf`) ensures all upstream calls happen concurrently, keeping response latency as low as possible despite the larger payload.

```java
@RestController
@RequestMapping("/api/web")
public class WebBffController {

    @GetMapping("/products/{id}")
    public WebProductResponse getProductDetails(@PathVariable String id) {
        CompletableFuture<Product> productFuture = productClient.getProductAsync(id);
        CompletableFuture<List<Review>> reviewsFuture = reviewClient.getReviewsAsync(id, 0, 20);
        CompletableFuture<SEOData> seoFuture = seoClient.getSEODataAsync(id);
        CompletableFuture<List<Product>> relatedFuture = relatedClient.getRelatedAsync(id, 6);

        CompletableFuture.allOf(productFuture, reviewsFuture, seoFuture, relatedFuture).join();

        WebProductResponse response = new WebProductResponse();
        response.setProduct(productFuture.join());
        response.setReviews(reviewsFuture.join());
        response.setSeo(seoFuture.join());
        response.setRelatedProducts(relatedFuture.join());
        response.setBreadcrumbs(generateBreadcrumbs(productFuture.join()));
        response.setStructuredData(generateStructuredData(productFuture.join()));

        return response;
    }

    @PostMapping("/checkout")
    public WebCheckoutResponse checkout(@RequestBody @Valid CheckoutRequest request) {
        // Web BFF handles session management, CSRF, and multi-step checkout
        Cart cart = cartService.getCart(request.getSessionId());
        List<Price> prices = pricingService.getPrices(cart.getItemIds());
        ShippingOptions shipping = shippingService.getOptions(cart.getTotalWeight());
        TaxCalculation tax = taxService.calculate(cart.getTotal(), request.getZipCode());

        WebCheckoutResponse response = new WebCheckoutResponse();
        response.setCartSummary(new CartSummary(cart, prices));
        response.setShippingOptions(shipping.getOptions());
        response.setTaxEstimate(tax.getAmount());
        response.setTotal(cart.getTotal() + tax.getAmount() + shipping.getSelected().getCost());
        response.setSslEnabled(true);

        return response;
    }
}
```

## GraphQL BFF

A GraphQL BFF combines the flexibility of client-driven queries with the BFF pattern's optimization layer. The resolver customizes response fields based on `clientType` — mobile clients get truncated descriptions and thumbnails, while web clients receive full data. This avoids maintaining separate REST endpoints per client type.

```java
@Component
public class ProductGraphQLFetcher implements GraphQLQueryResolver {

    @Autowired
    private ProductService productService;

    @Autowired
    private ReviewService reviewService;

    @Autowired
    private InventoryService inventoryService;

    public CompletableFuture<Product> product(String id, String clientType) {
        return CompletableFuture.supplyAsync(() -> {
            Product product = productService.getProduct(id);

            if ("mobile".equals(clientType)) {
                product.setDescription(truncate(product.getDescription(), 200));
                product.setImages(product.getThumbnails());
            }

            return product;
        });
    }

    public CompletableFuture<Page<Review>> reviews(String productId, int page, int size) {
        return reviewService.getReviews(productId, page, size);
    }

    public CompletableFuture<Inventory> inventory(String productId) {
        return inventoryService.getInventory(productId);
    }
}
```

## BFF Security

Each BFF requires a different security configuration. The web BFF uses OAuth2 login with session-based CSRF protection (cookies). The mobile BFF uses stateless JWT bearer tokens with CSRF disabled (mobile apps cannot store CSRF tokens securely). Separating security per BFF avoids compromising one client type's security model for another's convenience.

```java
@Component
public class BffSecurityConfig {

    @Bean
    public SecurityWebFilterChain webBffSecurity(ServerHttpSecurity http) {
        return http
            .securityMatcher(new PathPatternParserServerWebExchangeMatcher("/api/web/**"))
            .authorizeExchange(exchanges -> exchanges
                .pathMatchers("/api/web/public/**").permitAll()
                .anyExchange().authenticated()
            )
            .oauth2Login(Customizer.withDefaults())
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieServerCsrfTokenRepository.withHttpOnlyFalse()))
            .build();
    }

    @Bean
    public SecurityWebFilterChain mobileBffSecurity(ServerHttpSecurity http) {
        return http
            .securityMatcher(new PathPatternParserServerWebExchangeMatcher("/api/mobile/**"))
            .authorizeExchange(exchanges -> exchanges
                .pathMatchers(HttpMethod.GET, "/api/mobile/products/**").permitAll()
                .anyExchange().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(Customizer.withDefaults()))
            .csrf(csrf -> csrf.disable())
            .build();
    }
}
```

## Best Practices

- Create a separate BFF for each distinct client type (web, iOS, Android, IoT).
- Keep BFFs focused on client-specific composition, not business logic.
- Use GraphQL for BFFs that need flexible data fetching.
- Implement client-specific caching, rate limiting, and authentication.
- Monitor BFF performance separately for each client type.

## Common Mistakes

### Mistake: Shared BFF for all clients

```java
// Wrong - single backend serving all clients
// Hard to optimize for each client, breaking changes affect all clients
```

```java
// Correct - separate BFF per client type
// @RestController("api/mobile") and @RestController("api/web")
```

### Mistake: BFF contains business logic

```java
// Wrong - business logic in BFF
@GetMapping("/api/mobile/check-discount")
public BigDecimal checkDiscount(String userId, String productId) {
    return complexDiscountCalculation(userId, productId); // Should be in discount service
}
```

```java
// Correct - BFF only composes responses
@GetMapping("/api/mobile/products/{id}")
public MobileProductResponse getProduct(String id) {
    return productClient.getMobileProduct(id); // Delegates to downstream service
}
```

## Summary

The BFF pattern creates client-optimized backends that improve performance and developer experience. Each BFF is tailored to its client's specific needs, reducing payload sizes, simplifying client code, and enabling independent evolution of client-facing APIs.

## References

- [Sam Newman - Backends for Frontends](https://samnewman.io/patterns/architectural/bff/)
- [Microsoft - BFF Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends)
- [ThoughtWorks - BFF](https://www.thoughtworks.com/insights/blog/bff-pattern)

Happy Coding
