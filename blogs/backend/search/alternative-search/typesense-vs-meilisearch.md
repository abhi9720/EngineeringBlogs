---
title: "Typesense vs Meilisearch"
description: "Compare Typesense and Meilisearch: performance, features, typo tolerance, filtering, and deployment considerations"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["typesense", "meilisearch", "comparison", "search-engine"]
coverImage: "/images/typesense-vs-meilisearch.png"
draft: false
---

## Overview

Typesense and Meilisearch are both modern, open-source search engines designed as alternatives to Elasticsearch. They prioritize developer experience, speed, and simplicity. Both support typo-tolerant full-text search, faceted filtering, and instant search, but they differ in architecture, query capabilities, and deployment model.

This comparison helps you choose between them based on your specific requirements.

## Typesense Architecture

Typesense is written in C++ for performance. It stores the entire index in RAM for ultra-fast search.

```java
@Configuration
public class TypesenseConfiguration {

    @Bean
    public TypesenseClient typesenseClient() {
        Configuration configuration = new Configuration();
        configuration.setNodes(List.of(
            new Node("http", "localhost", "8108")
        ));
        configuration.setApiKey("typesense-api-key");
        configuration.setConnectionTimeout(3);
        configuration.setRetryIntervalThreshold(2);
        configuration.setHealthCheckInterval(5);

        return new Client(configuration);
    }
}
```

### Typesense Indexing

```java
@Component
public class TypesenseIndexer {

    private final TypesenseClient client;

    public TypesenseIndexer(TypesenseClient client) {
        this.client = client;
    }

    public void createCollection() {
        try {
            Map<String, Object> schema = new HashMap<>();
            schema.put("name", "products");
            schema.put("fields", List.of(
                Map.of("name", "id", "type", "string"),
                Map.of("name", "name", "type", "string"),
                Map.of("name", "description", "type", "string"),
                Map.of("name", "category", "type", "string", "facet", true),
                Map.of("name", "brand", "type", "string", "facet", true),
                Map.of("name", "price", "type", "float"),
                Map.of("name", "available", "type", "bool"),
                Map.of("name", "createdAt", "type", "int64"),
                Map.of("name", "tags", "type", "string[]", "facet", true),
                Map.of("name", "rating", "type", "float")
            ));
            schema.put("token_separators", List.of("-", "/"));
            schema.put("symbols_to_index", List.of("+", "#"));

            client.collections().create(schema);
            log.info("Created Typesense collection: products");
        } catch (Exception e) {
            throw new TypesenseOperationException("Failed to create collection", e);
        }
    }

    public void indexDocuments(List<Map<String, Object>> documents) {
        try {
            ReturnedObjects result = client.collections("products")
                .documents()
                .import_(documents);

            log.info("Indexed {} documents to Typesense", documents.size());
        } catch (Exception e) {
            throw new TypesenseOperationException("Failed to index documents", e);
        }
    }

    public void upsertDocument(Map<String, Object> document) {
        try {
            client.collections("products")
                .documents()
                .upsert(document);

            log.info("Upserted document: {}", document.get("id"));
        } catch (Exception e) {
            throw new TypesenseOperationException("Failed to upsert document", e);
        }
    }
}
```

### Typesense Search

```java
@Service
public class TypesenseSearchService {

    private final TypesenseClient client;

    public TypesenseSearchService(TypesenseClient client) {
        this.client = client;
    }

    public SearchResult searchProducts(String query, Map<String, String> filterParams) {
        try {
            SearchParameters searchParameters = new SearchParameters();
            searchParameters.q(query);
            searchParameters.queryBy("name,description,brand,category");
            searchParameters.perPage(20);

            // Build filter string
            List<String> filters = new ArrayList<>();
            if (filterParams.containsKey("category")) {
                filters.add("category:=" + filterParams.get("category"));
            }
            if (filterParams.containsKey("brand")) {
                filters.add("brand:=" + filterParams.get("brand"));
            }
            if (filterParams.containsKey("minPrice")) {
                filters.add("price:>=" + filterParams.get("minPrice"));
            }
            if (filterParams.containsKey("maxPrice")) {
                filters.add("price:<=" + filterParams.get("maxPrice"));
            }
            if (!filters.isEmpty()) {
                searchParameters.filterBy(String.join(" && ", filters));
            }

            // Faceting
            searchParameters.facetBy("category,brand,tags");

            // Sort by
            if (filterParams.containsKey("sortBy")) {
                searchParameters.sortBy(filterParams.get("sortBy"));
            }

            // Typo tolerance
            searchParameters.numTypos(2);
            searchParameters.minLen1typo(3);
            searchParameters.minLen2typo(7);

            return client.collections("products")
                .documents()
                .search(searchParameters);
        } catch (Exception e) {
            throw new TypesenseOperationException("Search failed", e);
        }
    }

    public SearchResult autocomplete(String prefix) {
        try {
            SearchParameters params = new SearchParameters();
            params.q(prefix);
            params.queryBy("name");
            params.prefix(true);
            params.perPage(5);
            params.numTypos(1);

            return client.collections("products")
                .documents()
                .search(params);
        } catch (Exception e) {
            throw new TypesenseOperationException("Autocomplete failed", e);
        }
    }
}
```

## Meilisearch Implementation

```java
// (See meilisearch-getting-started.md for detailed Meilisearch implementation)
// Key differences:

@Service
public class MeilisearchComparisonSearchService {

    private final MeilisearchClient meiliClient;

    public SearchResult searchWithMeilisearch(String query, Map<String, String> filters) {
        SearchRequest request = new SearchRequest(query);
        request.setLimit(20);

        // Meilisearch filter syntax: "category = Electronics AND brand = Apple"
        List<String> filterExpressions = new ArrayList<>();
        filters.forEach((key, value) -> {
            filterExpressions.add(key + " = \"" + value + "\"");
        });
        request.setFilter(List.of(String.join(" AND ", filterExpressions)));
        request.setFacets(List.of("category", "brand"));

        return meiliClient.index("products").search(request);
    }
}
```

## Comparison Table

| Feature | Typesense | Meilisearch |
|---------|-----------|-------------|
| Language | C++ | Rust |
| Storage | In-memory (RAM) | Disk-based |
| Performance | Ultra-fast (RAM) | Very fast |
| Typo tolerance | Configurable (numTypos) | Auto (minWordSizeForTypos) |
| Filter syntax | `field:=value` | `field = "value"` |
| Faceting | `facetBy` parameter | `facets` parameter |
| Sorting | `sortBy` parameter | `sort` parameter |
| Geo search | Built-in | No |
| Grouping | Built-in | No |
| Vector search | No | No |
| API key auth | Multiple keys | Single key |
| Configuration | Schema required | Schema optional |
| Cluster mode | Native clustering | Single node + Proxy |
| Community | Growing | Large, fast-growing |
| Documentation | Good | Excellent |

## Performance Characteristics

### Typesense

```java
// Typesense: Sub-millisecond search for in-memory data
// Best for: High-throughput, low-latency search
// Memory requirement: Entire index must fit in RAM
// Scaling: Add nodes to increase RAM capacity

@Service
public class TypesensePerformanceService {

    public SearchResult fastSearch(String query) {
        long start = System.nanoTime();

        SearchParameters params = new SearchParameters();
        params.q(query);
        params.queryBy("name");
        params.perPage(10);
        params.numTypos(1);

        SearchResult result = client.collections("products")
            .documents()
            .search(params);

        long duration = (System.nanoTime() - start) / 1_000_000;
        log.info("Typesense search took {}ms, found {} results",
            duration, result.getFound());

        return result;
    }
}
```

### Meilisearch

```java
// Meilisearch: Fast disk-based search
// Best for: General-purpose search, ease of use
// Memory requirement: Moderate (index is on disk, cache in memory)
// Scaling: Vertical scaling, or proxy-based horizontal scaling

@Service
public class MeilisearchPerformanceService {

    public SearchResult fastSearch(String query) {
        long start = System.nanoTime();

        SearchRequest request = new SearchRequest(query);
        request.setLimit(10);
        SearchResult result = client.index("products").search(request);

        long duration = (System.nanoTime() - start) / 1_000_000;
        log.info("Meilisearch search took {}ms, found {} results",
            duration, result.getHits().size());

        return result;
    }
}
```

## Decision Criteria

### Choose Typesense When

```java
// When to use Typesense
public class TypesenseDecisionGuide {

    public boolean shouldUseTypesense(Requirements req) {
        return req.isUltraLowLatency()     // <10ms search required
            || req.hasGeoSearch()           // Geo-spatial queries needed
            || req.hasGrouping()            // Group results by field
            || req.getDatasetSizeInGb() < 100 // Fits in RAM
            || req.isHighThroughput();      // Thousands of queries/sec
    }
}

// Typesense is used by: e-commerce platforms, real-time search apps
// Typesense strengths: Geo-search, grouping, extremely low latency
```

### Choose Meilisearch When

```java
// When to use Meilisearch
public class MeilisearchDecisionGuide {

    public boolean shouldUseMeilisearch(Requirements req) {
        return req.isQuickSetup()            // Minutes to get started
            || req.isDeveloperExperience()   // Simple, intuitive API
            || req.getDatasetSize() > 100    // More than 100GB
            || req.isTypoToleranceEnabled()  // Auto typo tolerance
            || req.hasLimitedOpsTeam();      // Minimal operations
    }
}

// Meilisearch is used by: docs, blogs, small-medium e-commerce
// Meilisearch strengths: Ease of use, auto typo tolerance, community
```

## Common Mistakes

### Expecting Same Features

```java
// Wrong: Expecting Typesense geo features in Meilisearch
// Typesense has geo-search built-in, Meilisearch does not (yet)

// Correct: Check feature matrix before choosing
```

### Ignoring Memory Requirements

```java
// Wrong: Choosing Typesense for 1TB dataset without enough RAM
// Typesense requires entire index in RAM

// Correct: Choose Meilisearch for large datasets, Typesense for smaller ones
```

## Best Practices

1. Choose Typesense for ultra-low latency and geo-search requirements.
2. Choose Meilisearch for ease of use and larger datasets.
3. Evaluate memory requirements before choosing Typesense.
4. Consider community size and ecosystem maturity.
5. Test both with your specific data and query patterns.
6. Consider long-term maintenance and operational costs.
7. Both are excellent choices for modern search applications.

## Summary

Typesense and Meilisearch are both excellent modern search engines that prioritize developer experience and performance over the complexity of Elasticsearch. Typesense offers ultra-low latency with in-memory indexing, geo-search, and grouping. Meilisearch offers easier setup, auto typo tolerance, and disk-based storage for larger datasets. Choose based on your latency requirements, dataset size, and feature needs.

## References

- Typesense Documentation
- Meilisearch Documentation
- "Typesense vs Meilisearch" Blog Comparisons

Happy Coding