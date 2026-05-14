---
title: Search in Backend Systems
description: >-
  A comprehensive overview of search in backend systems: full-text search,
  Elasticsearch, alternatives, and design considerations
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - search
  - elasticsearch
  - full-text-search
  - overview
coverImage: /images/search-in-backend-systems.png
draft: false
order: 10
---
## Overview

Search is a fundamental capability in modern backend systems. Users expect fast, relevant, and fault-tolerant search across large datasets. Backend engineers must understand search infrastructure, indexing strategies, query patterns, and the trade-offs between different search technologies.

This overview covers the search landscape from traditional full-text search engines to modern vector-based similarity search, helping you choose the right approach for your application.

## Search Technologies

### Database Built-in Search

PostgreSQL offers full-text search with tsvector and tsquery, suitable for basic search needs without additional infrastructure. The database-native approach eliminates the operational overhead of maintaining a separate search cluster, making it ideal for applications where search is a supporting feature rather than the primary interface.

The following SQL demonstrates setting up a PostgreSQL full-text search pipeline. A generated column `search_vector` of type `tsvector` stores the lexeme-preprocessed text, a GIN index accelerates ranked lookups, and a trigger function keeps the vector in sync on every insert or update. The final query uses `ts_rank` to order results by relevance:

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

Dedicated search engine providing distributed indexing, full-text search, aggregations, and near real-time search capabilities. When your search requirements outgrow what a relational database can offer — paginated faceted navigation, fuzzy matching, or real-time analytics — Elasticsearch fills the gap with a horizontally scalable architecture built on Apache Lucene.

This index creation request configures three primary shards and two replicas for fault tolerance, defines a custom analyzer that chains lowercase normalization, stop-word removal, and synonym expansion, and declares explicit field mappings so that text fields are analyzed while keyword, numeric, and date fields are indexed for exact filtering and sorting:

```json
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

Modern search engine focused on developer experience with instant typo-tolerant search, minimal configuration, and simple API. Where Elasticsearch demands careful schema design and tuning, Meilisearch ships with sensible defaults that work well out of the box. Documents are indexed via a straightforward HTTP API, and typo tolerance, faceting, and ranking are configured through intuitive settings rather than complex DSL queries:

```bash
curl -X POST 'http://localhost:7700/indexes/movies/documents' \
  -H 'Content-Type: application/json' \
  --data-binary '[
    {"id": 1, "title": "Inception", "genre": "Sci-Fi", "year": 2010},
    {"id": 2, "title": "The Matrix", "genre": "Sci-Fi", "year": 1999}
  ]'
```

### Vector Search (pgvector)

Semantic search using embeddings for similarity-based retrieval, crucial for modern AI applications and RAG pipelines. Unlike keyword search, which matches literal terms, vector search operates on the semantic meaning of text by comparing dense embedding vectors. pgvector brings this capability directly into PostgreSQL, eliminating the need for a separate vector database while preserving ACID transactions, replication, and the entire Postgres ecosystem.

The Java service below accepts a query string, generates an embedding vector via an external model (e.g., OpenAI's `text-embedding-ada-002`), and executes a nearest-neighbor search using the cosine-distance operator (`<=>`). Results are ordered by similarity, and the distance is converted into a normalized score:

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

Full reindexing rebuilds the entire index, appropriate for initial setup or schema changes. Incremental indexing processes changes since the last update for ongoing synchronization. The choice between them is a trade-off between consistency and cost: full reindexing guarantees a clean state but is I/O intensive, while incremental indexing is lightweight but can drift if errors go unnoticed.

The following Spring Boot indexer demonstrates both strategies. An `incrementalIndex()` method runs every 60 seconds, fetching only records modified since the last run and bulk-indexing them into Elasticsearch. A separate `fullReindex()` method runs nightly at 3 AM, deleting and recreating the index before reindexing every record from the source database:

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

Understanding relevance scoring helps tune search results. TF-IDF and BM25 are common algorithms. Elasticsearch uses BM25 by default, which balances term frequency saturation and document length normalization. However, business requirements — such as boosting popular products or newer content — often demand custom scoring that goes beyond pure text relevance.

The `function_score` query in this example wraps a `multi_match` that boosts the `title` field by 3x and `description` by 2x. A `FieldValueFactorFunction` multiplies the score by a log-scaled popularity metric, ensuring that a highly popular product with a moderately relevant title can outrank a perfectly relevant but obscure one:

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

A common pitfall in search implementation is treating user queries as exact values. A standard `LIKE` or `contains` query will miss results when the user misspells even a single character. The wrong approach below performs a simple substring match — it returns nothing for "teh" when the product is named "The Phone":

```java
// Wrong: Exact match only, fails on typos
@Service
public class SearchService {
    public List<Product> search(String query) {
        return productRepository.findByNameContaining(query);
    }
}
```

The corrected implementation uses Elasticsearch's `match` query with `Fuzziness.AUTO`, which automatically applies edit-distance-based matching. The `prefixLength` parameter requires the first three characters to match exactly, reducing the number of candidate expansions and improving performance:

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
