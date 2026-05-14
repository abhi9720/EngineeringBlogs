---
title: "Elasticsearch Basics"
description: "Introduction to Elasticsearch: indexing, mappings, queries, aggregations, and building search applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["elasticsearch", "indexing", "mappings", "search"]
coverImage: "/images/elasticsearch-basics.png"
draft: false
---

## Overview

Elasticsearch is a distributed, RESTful search and analytics engine built on Apache Lucene. It provides near real-time search capabilities, powerful full-text search, structured queries, aggregations, and scalable distributed architecture.

Elasticsearch is the most widely used search engine for backend applications, powering search for e-commerce, logging (ELK stack), observability, and content management systems. This post covers fundamental concepts, indexing, and search operations.

## Core Concepts

### Index

An index is a collection of documents that share similar characteristics. Think of it as a database in the relational world.

### Document

A document is a JSON object stored in an index. It is the basic unit of information.

### Mapping

Mapping defines how documents and their fields are stored and indexed.

### Shard

An index is divided into shards for distributed storage and parallel processing.

## Setting Up Spring Data Elasticsearch

```java
@Configuration
@EnableElasticsearchRepositories(basePackages = "com.example.search.repository")
public class ElasticsearchConfiguration {

    @Bean
    public ElasticsearchOperations elasticsearchTemplate() {
        ClientConfiguration clientConfiguration = ClientConfiguration.builder()
            .connectedTo("localhost:9200")
            .withConnectTimeout(Duration.ofSeconds(5))
            .withSocketTimeout(Duration.ofSeconds(30))
            .build();

        return new ElasticsearchRestTemplate(
            RestClients.create(clientConfiguration).rest());
    }
}
```

## Defining Documents

```java
@Document(indexName = "products")
@Setting(settingPath = "elasticsearch/product-settings.json")
public class ProductDocument {

    @Id
    private String id;

    @Field(type = FieldType.Text, analyzer = "standard")
    private String name;

    @Field(type = FieldType.Text, analyzer = "english")
    private String description;

    @Field(type = FieldType.Keyword)
    private String category;

    @Field(type = FieldType.Keyword)
    private String brand;

    @Field(type = FieldType.Double)
    private BigDecimal price;

    @Field(type = FieldType.Integer)
    private int stockQuantity;

    @Field(type = FieldType.Boolean)
    private boolean available;

    @Field(type = FieldType.Date, format = DateFormat.date_hour_minute_second_millis)
    private Instant createdAt;

    @Field(type = FieldType.Nested)
    private List<ProductAttribute> attributes;

    @Field(type = FieldType.Completion)
    private String suggest;

    public ProductDocument() {}

    public ProductDocument(String id, String name, String description,
                          String category, String brand, BigDecimal price,
                          int stockQuantity, boolean available, Instant createdAt,
                          List<ProductAttribute> attributes) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.category = category;
        this.brand = brand;
        this.price = price;
        this.stockQuantity = stockQuantity;
        this.available = available;
        this.createdAt = createdAt;
        this.attributes = attributes;
        this.suggest = name;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getBrand() { return brand; }
    public void setBrand(String brand) { this.brand = brand; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public int getStockQuantity() { return stockQuantity; }
    public void setStockQuantity(int stockQuantity) { this.stockQuantity = stockQuantity; }
    public boolean isAvailable() { return available; }
    public void setAvailable(boolean available) { this.available = available; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public List<ProductAttribute> getAttributes() { return attributes; }
    public void setAttributes(List<ProductAttribute> attributes) { this.attributes = attributes; }
    public String getSuggest() { return suggest; }
    public void setSuggest(String suggest) { this.suggest = suggest; }
}

@Field(type = FieldType.Nested)
public class ProductAttribute {
    @Field(type = FieldType.Keyword)
    private String name;

    @Field(type = FieldType.Keyword)
    private String value;

    public ProductAttribute() {}

    public ProductAttribute(String name, String value) {
        this.name = name;
        this.value = value;
    }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getValue() { return value; }
    public void setValue(String value) { this.value = value; }
}
```

## Indexing Documents

```java
@Component
public class ProductIndexer {

    private final ElasticsearchOperations elasticsearchOperations;
    private final ObjectMapper objectMapper;

    public ProductIndexer(ElasticsearchOperations elasticsearchOperations,
                         ObjectMapper objectMapper) {
        this.elasticsearchOperations = elasticsearchOperations;
        this.objectMapper = objectMapper;
    }

    public void indexProduct(Product product) {
        ProductDocument document = convertToDocument(product);
        IndexQuery indexQuery = new IndexQueryBuilder()
            .withId(document.getId())
            .withObject(document)
            .build();

        String indexId = elasticsearchOperations
            .index(indexQuery, IndexCoordinates.of("products"));
        log.info("Indexed product {} with index ID: {}", product.getId(), indexId);
    }

    public void bulkIndexProducts(List<Product> products) {
        List<IndexQuery> queries = products.stream()
            .map(product -> new IndexQueryBuilder()
                .withId(product.getId())
                .withObject(convertToDocument(product))
                .build())
            .toList();

        elasticsearchOperations
            .bulkIndex(queries, IndexCoordinates.of("products"));
        log.info("Bulk indexed {} products", products.size());
    }

    public void deleteProduct(String id) {
        String deleteResult = elasticsearchOperations
            .delete(id, IndexCoordinates.of("products"));
        log.info("Deleted product {}: {}", id, deleteResult);
    }

    public boolean indexExists() {
        IndexOperations indexOps = elasticsearchOperations
            .indexOps(IndexCoordinates.of("products"));
        return indexOps.exists();
    }

    public boolean createIndex() {
        IndexOperations indexOps = elasticsearchOperations
            .indexOps(ProductDocument.class);
        return indexOps.create();
    }

    private ProductDocument convertToDocument(Product product) {
        return new ProductDocument(
            product.getId(),
            product.getName(),
            product.getDescription(),
            product.getCategory(),
            product.getBrand(),
            product.getPrice(),
            product.getStockQuantity(),
            product.isAvailable(),
            product.getCreatedAt(),
            product.getAttributes().stream()
                .map(attr -> new ProductAttribute(attr.getName(), attr.getValue()))
                .toList()
        );
    }
}
```

## Basic Search Operations

```java
@Repository
public interface ProductSearchRepository
        extends ElasticsearchRepository<ProductDocument, String> {

    List<ProductDocument> findByName(String name);

    List<ProductDocument> findByCategory(String category);

    List<ProductDocument> findByBrandAndAvailable(String brand, boolean available);

    Page<ProductDocument> findByPriceBetween(BigDecimal min, BigDecimal max, Pageable pageable);

    List<ProductDocument> findByNameContainingIgnoreCase(String name);
}

@Service
public class ProductSearchService {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public ProductSearchService(ElasticsearchRestTemplate elasticsearchTemplate) {
        this.elasticsearchTemplate = elasticsearchTemplate;
    }

    public SearchResponse<ProductDocument> search(SearchRequest request) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(buildQuery(request))
            .withFilter(buildFilter(request))
            .withPageable(PageRequest.of(request.getPage(), request.getSize()))
            .withSort(buildSort(request))
            .build();

        SearchHits<ProductDocument> searchHits = elasticsearchTemplate
            .search(searchQuery, ProductDocument.class, IndexCoordinates.of("products"));

        return SearchResponse.from(searchHits);
    }

    private QueryBuilder buildQuery(SearchRequest request) {
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return QueryBuilders.matchAllQuery();
        }

        return QueryBuilders.multiMatchQuery(request.getQuery(),
                "name^3", "description^2", "category", "brand")
            .type(MultiMatchQueryType.BEST_FIELDS)
            .fuzziness(Fuzziness.AUTO)
            .prefixLength(3);
    }

    private QueryBuilder buildFilter(SearchRequest request) {
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery();

        if (request.getCategory() != null) {
            boolQuery.filter(QueryBuilders.termQuery("category", request.getCategory()));
        }

        if (request.getBrand() != null) {
            boolQuery.filter(QueryBuilders.termQuery("brand", request.getBrand()));
        }

        if (request.getMinPrice() != null || request.getMaxPrice() != null) {
            boolQuery.filter(QueryBuilders.rangeQuery("price")
                .gte(request.getMinPrice())
                .lte(request.getMaxPrice()));
        }

        if (request.isAvailableOnly()) {
            boolQuery.filter(QueryBuilders.termQuery("available", true));
        }

        return boolQuery;
    }

    private List<SortBuilder<?>> buildSort(SearchRequest request) {
        return switch (request.getSortBy()) {
            case "price_asc" -> List.of(SortBuilders.fieldSort("price").order(SortOrder.ASC));
            case "price_desc" -> List.of(SortBuilders.fieldSort("price").order(SortOrder.DESC));
            case "newest" -> List.of(SortBuilders.fieldSort("createdAt").order(SortOrder.DESC));
            case "relevance" -> List.of(SortBuilders.scoreSort().order(SortOrder.DESC));
            default -> List.of(SortBuilders.scoreSort().order(SortOrder.DESC));
        };
    }
}
```

## Aggregations

```java
@Service
public class ProductAggregationService {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public ProductAggregationService(ElasticsearchRestTemplate elasticsearchTemplate) {
        this.elasticsearchTemplate = elasticsearchTemplate;
    }

    public CategoryAggregationResult getCategoryAggregations() {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .addAggregation(AggregationBuilders.terms("by_category")
                .field("category")
                .subAggregation(AggregationBuilders.avg("avg_price")
                    .field("price"))
                .subAggregation(AggregationBuilders.stats("price_stats")
                    .field("price"))
                .subAggregation(AggregationBuilders.terms("by_brand")
                    .field("brand")))
            .addAggregation(AggregationBuilders.range("price_ranges")
                .field("price")
                .addUnboundedTo(10)
                .addRange(10, 50)
                .addRange(50, 100)
                .addUnboundedFrom(100))
            .withQuery(QueryBuilders.matchAllQuery())
            .withPageable(PageRequest.of(0, 0))
            .build();

        SearchHits<ProductDocument> searchHits = elasticsearchTemplate
            .search(searchQuery, ProductDocument.class, IndexCoordinates.of("products"));

        return buildAggregationResult(searchHits);
    }

    private CategoryAggregationResult buildAggregationResult(
            SearchHits<ProductDocument> searchHits) {
        Aggregations aggregations = searchHits.getAggregations();

        Terms categoryTerms = aggregations.get("by_category");
        List<CategoryBucket> categories = categoryTerms.getBuckets().stream()
            .map(bucket -> {
                Avg avgPrice = bucket.getAggregations().get("avg_price");
                Stats priceStats = bucket.getAggregations().get("price_stats");
                Terms brandTerms = bucket.getAggregations().get("by_brand");
                List<BrandBucket> brands = brandTerms.getBuckets().stream()
                    .map(b -> new BrandBucket(b.getKeyAsString(), b.getDocCount()))
                    .toList();
                return new CategoryBucket(
                    bucket.getKeyAsString(),
                    bucket.getDocCount(),
                    avgPrice.getValue(),
                    priceStats,
                    brands
                );
            })
            .toList();

        Range priceRanges = aggregations.get("price_ranges");
        List<PriceRangeBucket> ranges = priceRanges.getBuckets().stream()
            .map(bucket -> new PriceRangeBucket(
                bucket.getKeyAsString(), bucket.getDocCount()))
            .toList();

        return new CategoryAggregationResult(categories, ranges);
    }
}
```

## Common Mistakes

### Indexing Without Mapping

```java
// Wrong: Dynamic mapping leads to unexpected field types
PUT /products
{
  "title": "Product Name",
  "price": "29.99" // mapped as text instead of float!
}
```

```java
// Correct: Explicit mapping defines field types
PUT /products
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "price": { "type": "float" },
      "created_at": { "type": "date" }
    }
  }
}
```

### Over-Sharding

```java
// Wrong: Too many shards for small index
PUT /products
{
  "settings": {
    "number_of_shards": 50,
    "number_of_replicas": 2
  }
}

// Correct: Right-shard your index based on size
PUT /products
{
  "settings": {
    "number_of_shards": 5,
    "number_of_replicas": 1
  }
}
```

## Best Practices

1. Define explicit mappings before indexing data.
2. Use appropriate analyzer for each text field.
3. Right-shard your indices (20-40 GB per shard).
4. Use aliases for zero-downtime reindexing.
5. Implement index lifecycle management (ILM) for time-series data.
6. Monitor cluster health and shard allocation.
7. Use query profiling to identify slow queries.
8. Set replica counts based on availability requirements.

## Summary

Elasticsearch is a powerful distributed search engine that excels at full-text search, structured queries, and real-time analytics. Understanding its core concepts of indices, mappings, analyzers, and its distributed architecture is essential for building effective search applications. Use explicit mappings, right-size your shards, and leverage aggregations for faceted navigation.

## References

- "Elasticsearch: The Definitive Guide" by Clinton Gormley and Zachary Tong
- Elasticsearch Reference Documentation
- Spring Data Elasticsearch Documentation

Happy Coding