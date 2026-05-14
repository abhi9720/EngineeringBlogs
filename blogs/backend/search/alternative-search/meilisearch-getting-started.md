---
title: "Meilisearch Getting Started"
description: "Getting started with Meilisearch: installation, indexing, typo-tolerant search, and filtering for modern applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["meilisearch", "search", "typo-tolerance", "getting-started"]
coverImage: "/images/meilisearch-getting-started.png"
draft: false
---

## Overview

Meilisearch is an open-source, fast, and relevant search engine designed for developer experience. It provides instant, typo-tolerant full-text search with minimal configuration. Unlike Elasticsearch, Meilisearch is opinionated and works out of the box with sensible defaults.

Key features include typo tolerance, filtering, faceted search, synonym support, and instant search (as-you-type). Meilisearch is an excellent choice for e-commerce, documentation, and application-level search where Elasticsearch would be overkill.

## Installation and Setup

### Running Meilisearch with Docker

The fastest way to get started is via Docker. The following command mounts a local volume for persistent data and sets a master key for API authentication. The container listens on port 7700, which is the default Meilisearch HTTP port:

```bash
docker run -d \
  --name meilisearch \
  -p 7700:7700 \
  -e MEILI_MASTER_KEY=masterKey \
  -v $(pwd)/meili_data:/meili_data \
  getmeili/meilisearch:v1.6
```

### Spring Boot Integration

To communicate with Meilisearch from a Java application, configure a `MeilisearchClient` bean. The host and API key are externalized via `application.properties` so they can vary between environments without code changes:

```java
@Configuration
public class MeilisearchConfiguration {

    @Bean
    public MeilisearchClient meilisearchClient(
            @Value("${meilisearch.host:http://localhost:7700}") String host,
            @Value("${meilisearch.api-key:masterKey}") String apiKey) {
        return new MeilisearchClient(host, apiKey);
    }
}
```

### Maven Dependency

Add the Meilisearch Java SDK to your `pom.xml`. The library provides a fluent API for index management, document CRUD, and search operations:

```xml
<dependency>
    <groupId>com.meilisearch.sdk</groupId>
    <artifactId>meilisearch-java</artifactId>
    <version>0.11.0</version>
</dependency>
```

## Creating an Index

Meilisearch indexes are created on first use. Before indexing documents, configure the index settings to control search behavior. The `searchableAttributes` list defines which fields are searched, `filterableAttributes` enables faceted filtering, and `sortableAttributes` allows result ordering. Custom `rankingRules` let you prioritize typo tolerance, word proximity, attribute weight, and exactness in any order.

The `TypoTolerance` configuration here sets the minimum word size for one typo to 3 characters and for two typos to 6 characters, balancing forgiveness against precision:

```java
@Component
public class MeilisearchIndexManager {

    private final MeilisearchClient client;

    public MeilisearchIndexManager(MeilisearchClient client) {
        this.client = client;
    }

    public void createProductsIndex() {
        try {
            // Create or update index
            Index index = client.index("products");

            // Update index settings
            Settings settings = new Settings();
            settings.setSearchableAttributes(List.of("name", "description", "brand", "category"));
            settings.setFilterableAttributes(List.of("category", "brand", "price", "available"));
            settings.setSortableAttributes(List.of("price", "createdAt"));
            settings.setRankingRules(List.of(
                "typo",
                "words",
                "proximity",
                "attribute",
                "sort",
                "exactness"
            ));
            settings.setTypoTolerance(new TypoTolerance()
                .setMinWordSizeForTypos(new MinWordSizeForTypos(3, 6))
                .setDisableOnWords(List.of())
                .setEnabled(true));

            index.updateSettings(settings);
            log.info("Created/updated Meilisearch index: products");
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to create index", e);
        }
    }

    public void createMovieIndex() {
        Index movieIndex = client.index("movies");

        Settings settings = new Settings();
        settings.setSearchableAttributes(List.of("title", "overview", "genres"));
        settings.setFilterableAttributes(List.of("genres", "year", "rating"));
        settings.setSortableAttributes(List.of("year", "rating", "popularity"));
        settings.setDisplayedAttributes(List.of("id", "title", "overview", "genres",
            "year", "rating", "posterUrl"));

        movieIndex.updateSettings(settings);
    }
}
```

## Indexing Documents

Meilisearch uses an asynchronous task system for document operations, meaning `addDocuments`, `deleteDocument`, and `deleteAllDocuments` return a `TaskInfo` immediately. The `waitForTask` helper polls the task status until completion (or timeout), ensuring the operation is confirmed before proceeding. This pattern is critical for integration tests and indexing workflows that depend on data visibility.

Batch indexing is significantly more efficient than one-by-one document insertion, as it reduces HTTP round-trips:

```java
@Component
public class MeilisearchIndexer {

    private final MeilisearchClient client;
    private final ObjectMapper objectMapper;

    public MeilisearchIndexer(MeilisearchClient client, ObjectMapper objectMapper) {
        this.client = client;
        this.objectMapper = objectMapper;
    }

    public void addProduct(ProductDocument product) {
        try {
            Index index = client.index("products");
            String json = objectMapper.writeValueAsString(product);
            TaskInfo task = index.addDocuments(json, "id");
            waitForTask(task);
            log.info("Indexed product: {}", product.getId());
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to index product", e);
        }
    }

    public void addProductsBatch(List<ProductDocument> products) {
        try {
            Index index = client.index("products");
            String json = objectMapper.writeValueAsString(products);
            TaskInfo task = index.addDocuments(json, "id");
            waitForTask(task);
            log.info("Indexed {} products", products.size());
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to batch index products", e);
        }
    }

    public void deleteProduct(String productId) {
        try {
            Index index = client.index("products");
            TaskInfo task = index.deleteDocument(productId);
            waitForTask(task);
            log.info("Deleted product: {}", productId);
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to delete product", e);
        }
    }

    public void clearIndex() {
        try {
            Index index = client.index("products");
            TaskInfo task = index.deleteAllDocuments();
            waitForTask(task);
            log.info("Cleared all documents from products index");
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to clear index", e);
        }
    }

    private void waitForTask(TaskInfo task) {
        try {
            client.waitForTask(task.getTaskUid(), 5000, 50);
        } catch (Exception e) {
            throw new MeilisearchOperationException("Task failed", e);
        }
    }
}
```

## Search Operations

Meilisearch's search API supports filtering, sorting, faceting, and highlighting out of the box. The following service demonstrates a production-grade search endpoint. Filters are built dynamically — category, brand, price range, and availability are composed into a filter expression using the `AND` operator. Faceted search returns aggregated counts per category and brand, enabling drill-down navigation. Highlighting wraps matched terms in `<mark>` tags so the frontend can emphasize them:

```java
@Service
public class MeilisearchSearchService {

    private final MeilisearchClient client;

    public MeilisearchSearchService(MeilisearchClient client) {
        this.client = client;
    }

    public SearchResult searchProducts(SearchRequest request) {
        try {
            Index index = client.index("products");

            SearchRequest searchRequest = new SearchRequest(request.getQuery());
            searchRequest.setLimit(request.getSize());
            searchRequest.setOffset(request.getPage() * request.getSize());

            // Apply filters
            if (hasFilters(request)) {
                searchRequest.setFilter(buildFilterExpression(request));
            }

            // Apply sorting
            if (request.getSortBy() != null) {
                searchRequest.setSort(List.of(request.getSortBy()));
            }

            // Facets
            if (request.isFacetsEnabled()) {
                searchRequest.setFacets(List.of("category", "brand"));
            }

            // Highlighting
            searchRequest.setAttributesToHighlight(List.of("name", "description"));
            searchRequest.setHighlightPreTag("<mark>");
            searchRequest.setHighlightPostTag("</mark>");

            return index.search(searchRequest);
        } catch (Exception e) {
            throw new MeilisearchOperationException("Search failed", e);
        }
    }

    public SearchResult searchWithFacets(String query, String category) {
        try {
            Index index = client.index("products");
            SearchRequest request = new SearchRequest(query);
            request.setFilter(List.of("category = " + category));
            request.setFacets(List.of("brand", "price"));
            request.setLimit(20);

            return index.search(request);
        } catch (Exception e) {
            throw new MeilisearchOperationException("Faceted search failed", e);
        }
    }

    public SearchResult autocomplete(String prefix) {
        try {
            Index index = client.index("products");
            SearchRequest request = new SearchRequest(prefix);
            request.setLimit(5);
            request.setAttributesToSearchOn(List.of("name"));

            return index.search(request);
        } catch (Exception e) {
            throw new MeilisearchOperationException("Autocomplete failed", e);
        }
    }

    private String buildFilterExpression(SearchRequest request) {
        List<String> filters = new ArrayList<>();

        if (request.getCategory() != null) {
            filters.add("category = \"" + request.getCategory() + "\"");
        }
        if (request.getBrand() != null) {
            filters.add("brand = \"" + request.getBrand() + "\"");
        }
        if (request.getMinPrice() != null || request.getMaxPrice() != null) {
            String priceFilter = "price ";
            if (request.getMinPrice() != null && request.getMaxPrice() != null) {
                priceFilter += request.getMinPrice() + " TO " + request.getMaxPrice();
            } else if (request.getMinPrice() != null) {
                priceFilter += ">= " + request.getMinPrice();
            } else {
                priceFilter += "<= " + request.getMaxPrice();
            }
            filters.add(priceFilter);
        }
        if (request.isAvailableOnly()) {
            filters.add("available = true");
        }

        return String.join(" AND ", filters);
    }

    private boolean hasFilters(SearchRequest request) {
        return request.getCategory() != null
            || request.getBrand() != null
            || request.getMinPrice() != null
            || request.getMaxPrice() != null
            || request.isAvailableOnly();
    }
}
```

## Synonym Configuration

Synonyms improve recall by mapping equivalent terms. When a user searches "laptop", Meilisearch will also match documents containing "notebook", "macbook", or "chromebook". Synonyms are configured per index and can be updated dynamically without reindexing. Use synonyms judiciously — overly broad mappings can hurt precision:

```java
@Component
public class MeilisearchSynonymManager {

    private final MeilisearchClient client;

    public void configureSynonyms() {
        try {
            Index index = client.index("products");
            Map<String, List<String>> synonyms = Map.of(
                "laptop", List.of("notebook", "macbook", "chromebook"),
                "cellphone", List.of("mobile", "smartphone", "phone"),
                "sneakers", List.of("trainers", "running shoes", "athletic shoes"),
                "tv", List.of("television", "display", "screen"),
                "sofa", List.of("couch", "settee", "loveseat"),
                "hoodie", List.of("sweatshirt", "jumper", "pullover")
            );
            index.updateSynonyms(synonyms);
            log.info("Updated synonyms for products index");
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to configure synonyms", e);
        }
    }
}
```

## Monitoring and Stats

Meilisearch exposes index statistics — document count, database size, and last update timestamp — through its stats API. A health check endpoint returns the server status and version. Wrapping these in service methods allows you to integrate Meilisearch monitoring into your existing observability stack (e.g., exposing metrics via Actuator):

```java
@Component
public class MeilisearchMonitor {

    private final MeilisearchClient client;

    public MeilisearchStats getIndexStats() {
        try {
            Index index = client.index("products");
            Map<String, Object> stats = index.getStats();

            return new MeilisearchStats(
                (int) stats.get("numberOfDocuments"),
                (String) stats.get("databaseSize"),
                (String) stats.get("lastUpdate")
            );
        } catch (Exception e) {
            throw new MeilisearchOperationException("Failed to get stats", e);
        }
    }

    public Health healthCheck() {
        try {
            Map<String, Object> health = client.health();
            return new Health(
                (String) health.get("status"),
                (String) health.get("version")
            );
        } catch (Exception e) {
            return new Health("unhealthy", null);
        }
    }

    public record MeilisearchStats(int documents, String databaseSize, String lastUpdate) {}
    public record Health(String status, String version) {}
}
```

## Common Mistakes

### Not Configuring Searchable Attributes

By default, Meilisearch searches all fields, which can return irrelevant results and degrade performance. Always restrict searchable attributes to the fields that matter:

```java
// Wrong: Default settings search all fields
// Every field is searchable, causing irrelevant results

// Correct: Configure which fields to search
settings.setSearchableAttributes(List.of("name", "description"));
```

### Missing Filterable Attributes

Filters fail silently if the attribute was not declared as `filterable` during setup. Plan your filtering requirements early to avoid reindexing:

```java
// Wrong: Cannot use filters
// Filtering by category or price fails

// Correct: Configure filterable attributes
settings.setFilterableAttributes(List.of("category", "brand", "price"));
```

## Best Practices

1. Configure searchable attributes explicitly for relevant results.
2. Set filterable attributes for faceted navigation.
3. Use synonyms to improve search relevance.
4. Configure typo tolerance settings based on your dataset.
5. Use ranking rules to tune result ordering.
6. Monitor index size and search performance.
7. Use the task system to track indexing operations.
8. Configure primary key correctly for document identification.

## Summary

Meilisearch offers an instant, developer-friendly search experience with typo tolerance, filtering, and faceted search out of the box. It is ideal for applications that need fast, relevant search without the operational complexity of Elasticsearch. With its simple API and sensible defaults, Meilisearch is an excellent choice for most web and mobile application search needs.

## References

- Meilisearch Documentation
- Meilisearch Java SDK Documentation
- Get Meilisearch (Official Site)

Happy Coding
