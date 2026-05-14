---
title: "Search in Backend Systems"
description: "A comprehensive overview of search in backend systems: full-text search, Elasticsearch, alternatives, and design considerations"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["search", "elasticsearch", "full-text-search", "overview"]
coverImage: "/images/search-in-backend-systems.png"
draft: false
---

## Overview

Search is a fundamental capability in modern backend systems. Users expect fast, relevant, and fault-tolerant search across large datasets. Backend engineers must understand search infrastructure, indexing strategies, query patterns, and the trade-offs between different search technologies.

This overview covers the search landscape from traditional full-text search engines to modern vector-based similarity search, helping you choose the right approach for your application.

## Search Technologies

### Database Built-in Search

PostgreSQL offers full-text search with tsvector and tsquery, suitable for basic search needs without additional infrastructure.

```sql
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    search_vector tsvector
);

CREATE INDEX articles_search_idx ON articles USING GIN(search_vector);

CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', NEW.title || ' ' || NEW.body);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articles_search_update
    BEFORE INSERT OR UPDATE ON articles
    FOR EACH ROW
    EXECUTE FUNCTION update_search_vector();

SELECT id, title, ts_rank(search_vector, query) AS rank
FROM articles, plainto_tsquery('english', 'backend architecture') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

### Elasticsearch

Dedicated search engine providing distributed indexing, full-text search, aggregations, and near real-time search capabilities.

```
PUT /products
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 2,
    "analysis": {
      "analyzer": {
        "product_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "stop", "synonym_filter"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "name": { "type": "text", "analyzer": "product_analyzer" },
      "description": { "type": "text", "analyzer": "product_analyzer" },
      "category": { "type": "keyword" },
      "price": { "type": "float" },
      "in_stock": { "type": "boolean" },
      "created_at": { "type": "date" }
    }
  }
}
```

### Meilisearch

Modern search engine focused on developer experience with instant typo-tolerant search, minimal configuration, and simple API.

```
curl -X POST 'http://localhost:7700/indexes/movies/documents' \
  -H 'Content-Type: application/json' \
  --data-binary '[
    {"id": 1, "title": "Inception", "genre": "Sci-Fi", "year": 2010},
    {"id": 2, "title": "The Matrix", "genre": "Sci-Fi", "year": 1999}
  ]'
```

### Vector Search (pgvector)

Semantic search using embeddings for similarity-based retrieval, crucial for modern AI applications and RAG pipelines.

```java
@Component
public class VectorSearchService {

    private final JdbcTemplate jdbcTemplate;

    public List<DocumentResult> findSimilarDocuments(float[] queryEmbedding, int limit) {
        String embeddingStr = Arrays.stream(queryEmbedding)
            .mapToObj(String::valueOf)
            .collect(Collectors.joining(","));

        String sql = """
            SELECT id, title, content,
                   1 - (embedding <=> ?::vector) AS similarity
            FROM documents
            ORDER BY embedding <=> ?::vector
            LIMIT ?
            """;

        return jdbcTemplate.query(
            sql,
            new Object[]{embeddingStr, embeddingStr, limit},
            (rs, rowNum) -> new DocumentResult(
                rs.getLong("id"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getDouble("similarity")
            )
        );
    }
}
```

## Indexing Strategies

### Full Reindexing vs Incremental

Full reindexing rebuilds the entire index, appropriate for initial setup or schema changes. Incremental indexing processes changes since the last update for ongoing synchronization.

```java
@Component
public class ProductIndexer {

    private final ProductRepository productRepository;
    private final ElasticsearchRestTemplate elasticsearchTemplate;

    @Scheduled(initialDelay = 1000, fixedRate = 60000)
    public void incrementalIndex() {
        List<Product> modifiedProducts = productRepository
            .findByModifiedAfter(lastIndexTime);
        List<IndexQuery> queries = modifiedProducts.stream()
            .map(product -> new IndexQueryBuilder()
                .withId(product.getId().toString())
                .withObject(ProductDocument.from(product))
                .build())
            .toList();
        elasticsearchTemplate.bulkIndex(queries, IndexCoordinates.of("products"));
        lastIndexTime = Instant.now();
    }

    @Scheduled(cron = "0 0 3 * * ?")
    public void fullReindex() {
        elasticsearchTemplate.indexOps(ProductDocument.class).delete();
        elasticsearchTemplate.indexOps(ProductDocument.class).create();

        List<Product> allProducts = productRepository.findAll();
        List<IndexQuery> queries = allProducts.stream()
            .map(product -> new IndexQueryBuilder()
                .withId(product.getId().toString())
                .withObject(ProductDocument.from(product))
                .build())
            .toList();
        elasticsearchTemplate.bulkIndex(queries, IndexCoordinates.of("products"));
    }
}
```

## Search Relevance

### Scoring and Ranking

Understanding relevance scoring helps tune search results. TF-IDF and BM25 are common algorithms.

```java
@Service
public class SearchService {

    private final ElasticsearchRestTemplate template;

    public SearchResponse<ProductDocument> search(String query, Pageable pageable) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders
                .functionScoreQuery(
                    QueryBuilders.multiMatchQuery(query, "title^3", "description^2", "content")
                        .type(MultiMatchQueryType.BEST_FIELDS)
                )
                .functions(new FieldValueFactorFunctionBuilder("popularity")
                    .factor(1.5f)
                    .modifier(FieldValueFactorFunction.Modifier.LOG1P))
                .boostMode(CombineFunction.MULTIPLY))
            .withPageable(pageable)
            .build();

        SearchHits<ProductDocument> hits = template
            .search(searchQuery, ProductDocument.class, IndexCoordinates.of("products"));
        return SearchResponse.from(hits);
    }
}
```

## Common Mistakes

### Ignoring Typo Tolerance

```java
// Wrong: Exact match only, fails on typos
@Service
public class SearchService {
    public List<Product> search(String query) {
        return productRepository.findByNameContaining(query);
    }
}
```

```java
// Correct: Using search engine with typo tolerance
@Service
public class SearchService {
    public List<Product> search(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.matchQuery("name", query)
                .fuzziness(Fuzziness.AUTO)
                .prefixLength(3))
            .build();

        SearchHits<ProductDocument> hits = template
            .search(searchQuery, ProductDocument.class);
        return hits.stream()
            .map(hit -> convertToProduct(hit.getContent()))
            .toList();
    }
}
```

### Over-indexing

Indexing every field without considering query patterns leads to storage bloat and slower indexing.

## Best Practices

1. **Define clear search requirements**: Understand what fields need full-text search vs exact filtering.
2. **Use appropriate analyzers**: Language-specific, custom, and edge-ngram analyzers for autocomplete.
3. **Implement index lifecycle**: Hot-warm-cold architecture for time-series data.
4. **Monitor query performance**: Track slow queries, cache hit ratios, and indexing lag.
5. **Design for eventual consistency**: Search indexes lag behind primary data stores.

## Summary

Search in backend systems ranges from simple database full-text search to distributed search engines and modern vector search. Choose Elasticsearch for complex full-text and aggregation workloads, Meilisearch or Typesense for simpler typo-tolerant search, and pgvector for semantic similarity search. Always consider indexing strategy, relevance tuning, and operational complexity.

## References

- "Elasticsearch: The Definitive Guide" by Clinton Gormley and Zachary Tong
- Elasticsearch Reference Documentation
- Meilisearch Documentation
- PostgreSQL Full Text Search Documentation

Happy Coding