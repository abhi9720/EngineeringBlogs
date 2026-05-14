---
title: "pgvector Similarity Search"
description: "Building vector similarity search with PostgreSQL pgvector: embeddings, nearest neighbor, hybrid search, and RAG pipelines"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["pgvector", "postgresql", "vector-search", "embeddings", "rag"]
coverImage: "/images/pgvector-similarity-search.png"
draft: false
---

## Overview

pgvector is a PostgreSQL extension that adds vector similarity search capabilities. It enables semantic search using embeddings, where documents are searched by meaning rather than keyword matching. This is foundational for modern AI applications including Retrieval-Augmented Generation (RAG), recommendation systems, and semantic search.

Unlike dedicated vector databases, pgvector operates within PostgreSQL, eliminating the need for a separate infrastructure component while providing ACID guarantees, replication, and the full PostgreSQL ecosystem.

## Installation and Setup

### Installing pgvector

Enable the extension in your database. The `vector` extension adds the `vector` data type and the distance operators (`<=>` for cosine, `<->` for L2, `<#>` for inner product):

```sql
-- Create the extension in your database
CREATE EXTENSION vector;

-- Verify installation
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

### Table Creation

Define tables with a `vector` column sized to match your embedding model's output dimension. OpenAI's `text-embedding-ada-002` produces 1536-dimensional vectors, while Cohere or sentence-transformers models typically use 768 dimensions. The JSONB `metadata` column stores arbitrary structured data alongside each embedding:

```sql
-- Create documents table with vector support
CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    embedding vector(1536),  -- OpenAI ada-002 embedding dimension
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create articles for semantic search
CREATE TABLE articles (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT,
    category TEXT,
    tags TEXT[],
    embedding vector(768),  -- Cohere or other model dimension
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Indexing for Vector Search

pgvector offers two index types for Approximate Nearest Neighbor (ANN) search. **IVFFlat** divides the vector space into inverted file lists; it builds quickly and offers a good speed-recall trade-off with proper `lists` and `probes` tuning. **HNSW** builds a hierarchical navigable small-world graph; it provides superior recall at the cost of longer build times and higher memory usage during construction. Choose HNSW when query latency is critical and you can afford the initial build cost:

```sql
-- Create indexes for approximate nearest neighbor search

-- IVFFlat index (good default)
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- IVFFlat with L2 distance
CREATE INDEX ON articles USING ivfflat (embedding vector_l2_ops)
    WITH (lists = 100);

-- IVFFlat with inner product distance
CREATE INDEX ON products USING ivfflat (embedding vector_ip_ops)
    WITH (lists = 100);

-- HNSW index (better recall, slower build)
-- HNSW with cosine distance
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- HNSW with L2 distance
CREATE INDEX ON articles USING hnsw (embedding vector_l2_ops)
    WITH (m = 16, ef_construction = 200);
```

## Spring Boot Integration

Configure a `JdbcTemplate` bean to execute raw SQL queries against the PostgreSQL database. pgvector's query operators work directly in SQL, so no special ORM integration is needed:

```java
@Configuration
public class PgvectorConfiguration {

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }
}
```

### Document Entity

A plain Java class maps to the `documents` table. The `embedding` field is a `float[]` — pgvector accepts arrays formatted as `[x,y,z,...]` in SQL queries. The `metadata` field uses `Map<String, Object>` to store arbitrary JSON:

```java
public class Document {
    private Long id;
    private String title;
    private String content;
    private Map<String, Object> metadata;
    private float[] embedding;
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public Map<String, Object> getMetadata() { return metadata; }
    public void setMetadata(Map<String, Object> metadata) { this.metadata = metadata; }
    public float[] getEmbedding() { return embedding; }
    public void setEmbedding(float[] embedding) { this.embedding = embedding; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
```

## Embedding Generation

Embeddings transform text into dense vector representations. The following service calls OpenAI's embedding API with `text-embedding-ada-002`. It also demonstrates a local fallback using a model like `all-MiniLM-L6-v2` served via a REST endpoint. Using a local model reduces latency, eliminates API costs, and keeps data within your network — important for privacy-sensitive applications:

```java
@Component
public class EmbeddingService {

    private final RestTemplate restTemplate;

    public EmbeddingService() {
        this.restTemplate = new RestTemplate();
    }

    public float[] generateEmbedding(String text) {
        String apiKey = System.getenv("OPENAI_API_KEY");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        Map<String, Object> request = Map.of(
            "input", text,
            "model", "text-embedding-ada-002"
        );

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);

        ResponseEntity<Map> response = restTemplate.postForEntity(
            "https://api.openai.com/v1/embeddings",
            entity,
            Map.class
        );

        List<Map<String, Object>> data = (List<Map<String, Object>>) response.getBody().get("data");
        List<Double> embeddingList = (List<Double>) data.get(0).get("embedding");

        float[] embedding = new float[embeddingList.size()];
        for (int i = 0; i < embeddingList.size(); i++) {
            embedding[i] = embeddingList.get(i).floatValue();
        }

        return embedding;
    }

    public float[] generateLocalEmbedding(String text) {
        // Example using a local embedding model
        // Can use sentence-transformers via REST API
        Map<String, Object> request = Map.of(
            "texts", List.of(text),
            "model", "all-MiniLM-L6-v2"
        );

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request);

        ResponseEntity<Map> response = restTemplate.postForEntity(
            "http://localhost:8000/embeddings",
            entity,
            Map.class
        );

        List<List<Double>> embeddings = (List<List<Double>>) response.getBody().get("embeddings");
        List<Double> embeddingList = embeddings.get(0);

        float[] embedding = new float[embeddingList.size()];
        for (int i = 0; i < embeddingList.size(); i++) {
            embedding[i] = embeddingList.get(i).floatValue();
        }

        return embedding;
    }
}
```

## Vector Search Queries

### Nearest Neighbor Search

pgvector provides three distance operators: `<=>` (cosine distance), `<->` (L2/Euclidean distance), and `<#>` (inner product). Cosine distance is the most common choice for semantic search because it measures the angle between vectors, ignoring magnitude. The query below converts cosine distance to a similarity score (`1 - distance`) so results can be ordered and filtered by a 0-to-1 score:

```java
@Repository
public class DocumentRepository {

    private final JdbcTemplate jdbcTemplate;
    private final EmbeddingService embeddingService;

    public DocumentRepository(JdbcTemplate jdbcTemplate, EmbeddingService embeddingService) {
        this.jdbcTemplate = jdbcTemplate;
        this.embeddingService = embeddingService;
    }

    public List<DocumentResult> findSimilarDocuments(String query, int limit) {
        float[] queryEmbedding = embeddingService.generateEmbedding(query);
        String embeddingStr = toPostgresVector(queryEmbedding);

        String sql = """
            SELECT id, title, content, metadata,
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

    public List<DocumentResult> findSimilarWithL2(float[] queryEmbedding, int limit) {
        String embeddingStr = toPostgresVector(queryEmbedding);

        String sql = """
            SELECT id, title, content,
                   embedding <-> ?::vector AS distance
            FROM documents
            ORDER BY embedding <-> ?::vector
            LIMIT ?
            """;

        return jdbcTemplate.query(
            sql,
            new Object[]{embeddingStr, embeddingStr, limit},
            (rs, rowNum) -> new DocumentResult(
                rs.getLong("id"),
                rs.getString("title"),
                rs.getString("content"),
                1.0 / (1.0 + rs.getDouble("distance"))
            )
        );
    }

    public List<DocumentResult> findSimilarWithInnerProduct(float[] queryEmbedding, int limit) {
        String embeddingStr = toPostgresVector(queryEmbedding);

        String sql = """
            SELECT id, title, content,
                   (embedding <#> ?::vector) * -1 AS similarity
            FROM documents
            ORDER BY embedding <#> ?::vector
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

    private String toPostgresVector(float[] embedding) {
        return Arrays.stream(embedding)
            .mapToObj(String::valueOf)
            .collect(Collectors.joining(",", "[", "]"));
    }

    public record DocumentResult(Long id, String title, String content, double similarity) {}
}
```

## Hybrid Search (Vector + Full-Text)

Hybrid search combines semantic (vector) and keyword (full-text) signals for robust retrieval. The vector search catches conceptually similar results even when they share no common words, while full-text search ensures exact keyword matches are not missed. The `vectorWeight` parameter controls the balance — 0.7 favors semantic similarity, 0.3 favors keyword matching, and 0.5 weights them equally.

The CTE (Common Table Expression) approach computes vector and text scores independently, then combines them with a weighted sum. The `LIMIT ? * 2` in the vector subquery ensures enough candidates survive the join:

```java
@Service
public class HybridSearchService {

    private final JdbcTemplate jdbcTemplate;
    private final EmbeddingService embeddingService;

    public HybridSearchService(JdbcTemplate jdbcTemplate, EmbeddingService embeddingService) {
        this.jdbcTemplate = jdbcTemplate;
        this.embeddingService = embeddingService;
    }

    public List<HybridResult> hybridSearch(String query, double vectorWeight, int limit) {
        // Generate embedding for vector search
        float[] queryEmbedding = embeddingService.generateEmbedding(query);
        String embeddingStr = toPostgresVector(queryEmbedding);

        String sql = """
            WITH vector_scores AS (
                SELECT id, title, content,
                       1 - (embedding <=> ?::vector) AS vector_score
                FROM documents
                ORDER BY embedding <=> ?::vector
                LIMIT ?
            ),
            text_scores AS (
                SELECT id,
                       ts_rank(to_tsvector('english', title || ' ' || content),
                               plainto_tsquery('english', ?)) AS text_score
                FROM documents
                WHERE to_tsvector('english', title || ' ' || content)
                      @@ plainto_tsquery('english', ?)
            )
            SELECT v.id, v.title, v.content,
                   (COALESCE(v.vector_score, 0) * ? +
                    COALESCE(t.text_score, 0) * (1 - ?)) AS combined_score
            FROM vector_scores v
            LEFT JOIN text_scores t ON v.id = t.id
            ORDER BY combined_score DESC
            LIMIT ?
            """;

        return jdbcTemplate.query(
            sql,
            new Object[]{
                embeddingStr, embeddingStr, limit * 2,
                query, query,
                vectorWeight, vectorWeight,
                limit
            },
            (rs, rowNum) -> new HybridResult(
                rs.getLong("id"),
                rs.getString("title"),
                rs.getString("content"),
                rs.getDouble("combined_score")
            )
        );
    }

    public List<HybridResult> balancedHybridSearch(String query, int limit) {
        return hybridSearch(query, 0.5, limit);
    }

    public List<HybridResult> vectorWeightedSearch(String query, int limit) {
        return hybridSearch(query, 0.7, limit);
    }

    private String toPostgresVector(float[] embedding) {
        return Arrays.stream(embedding)
            .mapToObj(String::valueOf)
            .collect(Collectors.joining(",", "[", "]"));
    }

    public record HybridResult(Long id, String title, String content, double score) {}
}
```

## RAG Pipeline (Retrieval-Augmented Generation)

RAG pipelines retrieve relevant context from a knowledge base and feed it to an LLM for grounded answer generation. This addresses the two main limitations of pure LLMs: hallucination (making up facts) and knowledge cutoff (missing recent information). The pipeline below retrieves the top-3 most similar documents, concatenates them into a prompt, and sends it to GPT-4 with a system instruction to answer based strictly on the provided context:

```java
@Service
public class RagPipelineService {

    private final DocumentRepository documentRepository;
    private final RestTemplate restTemplate;

    public RagPipelineService(
            DocumentRepository documentRepository,
            RestTemplate restTemplate) {
        this.documentRepository = documentRepository;
        this.restTemplate = restTemplate;
    }

    public String answerQuestion(String question) {
        // Step 1: Retrieve relevant documents
        List<DocumentRepository.DocumentResult> relevantDocs =
            documentRepository.findSimilarDocuments(question, 3);

        // Step 2: Build context from retrieved documents
        String context = relevantDocs.stream()
            .map(doc -> doc.title() + "\n" + doc.content())
            .collect(Collectors.joining("\n\n---\n\n"));

        // Step 3: Generate answer using LLM
        String prompt = String.format("""
            Answer the question based on the provided context.
            
            Context:
            %s
            
            Question: %s
            
            Answer:
            """, context, question);

        return callLlm(prompt);
    }

    public String answerWithSources(String question) {
        List<DocumentRepository.DocumentResult> relevantDocs =
            documentRepository.findSimilarDocuments(question, 5);

        String context = relevantDocs.stream()
            .map(doc -> String.format(
                "[Source %d: %s]\n%s",
                relevantDocs.indexOf(doc) + 1,
                doc.title(),
                doc.content()
            ))
            .collect(Collectors.joining("\n\n"));

        String prompt = String.format("""
            Answer the question using the provided sources.
            Cite sources by number in your answer.
            
            %s
            
            Question: %s
            """, context, question);

        String answer = callLlm(prompt);

        return answer + "\n\n---\nSources:\n" + relevantDocs.stream()
            .map(doc -> String.format("- %s (similarity: %.2f)",
                doc.title(), doc.similarity()))
            .collect(Collectors.joining("\n"));
    }

    private String callLlm(String prompt) {
        String apiKey = System.getenv("OPENAI_API_KEY");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        Map<String, Object> request = Map.of(
            "model", "gpt-4",
            "messages", List.of(
                Map.of("role", "system", "content",
                    "You are a helpful assistant. Answer based on the provided context."),
                Map.of("role", "user", "content", prompt)
            ),
            "temperature", 0.3,
            "max_tokens", 500
        );

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);

        ResponseEntity<Map> response = restTemplate.postForEntity(
            "https://api.openai.com/v1/chat/completions",
            entity,
            Map.class
        );

        List<Map<String, Object>> choices =
            (List<Map<String, Object>>) response.getBody().get("choices");
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        return (String) message.get("content");
    }
}
```

## Performance Tuning

Index and query parameters heavily influence performance. The `ivfflat.probes` setting controls how many lists are searched during a query — more probes improve recall but increase latency. For HNSW, `hnsw.ef_search` controls the search breadth. The `EXPLAIN ANALYZE` command helps verify that the index is being used. For very large tables, partitioning by category reduces the search space per query:

```sql
-- Tune IVFFlat index probes for recall vs speed tradeoff
SET ivfflat.probes = 10;  -- More probes = better recall, slower

-- Session-level setting
BEGIN;
SET LOCAL ivfflat.probes = 20;
SELECT * FROM documents ORDER BY embedding <=> ? LIMIT 10;
COMMIT;

-- Tune HNSW index ef_search
SET hnsw.ef_search = 100;  -- Higher = better recall, slower

-- Query planning
EXPLAIN ANALYZE
SELECT id, title, 1 - (embedding <=> ?::vector) AS similarity
FROM documents
ORDER BY embedding <=> ?::vector
LIMIT 10;

-- Partition large tables by category for better performance
CREATE TABLE documents_partitioned (
    LIKE documents INCLUDING ALL
) PARTITION BY LIST (category);

CREATE TABLE docs_tech PARTITION OF documents_partitioned
    FOR VALUES IN ('technology', 'programming', 'software');

CREATE TABLE docs_science PARTITION OF documents_partitioned
    FOR VALUES IN ('science', 'research', 'academic');
```

## Common Mistakes

### Wrong Index Type

Each index type is tied to a specific distance operator. Using a L2 index for cosine queries will still return results, but the ranking will be incorrect:

```java
// Wrong: Using L2 index for cosine distance
CREATE INDEX ON documents USING ivfflat (embedding vector_l2_ops);
// Cosine distance with L2 index gives wrong results

// Correct: Use matching index for your distance function
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops);
```

### Forgetting to Normalize Embeddings

Cosine similarity computes the cosine of the angle between two vectors. If vectors are not unit-length, the result is affected by magnitude rather than just direction. Always normalize embeddings when using cosine similarity:

```java
// Wrong: Not normalizing embeddings for cosine similarity
float[] rawEmbedding = generateEmbedding(text);

// Correct: Normalize for consistent cosine similarity
float[] normalizedEmbedding = normalize(rawEmbedding);

private float[] normalize(float[] vector) {
    float norm = 0;
    for (float v : vector) {
        norm += v * v;
    }
    norm = (float) Math.sqrt(norm);
    float[] normalized = new float[vector.length];
    for (int i = 0; i < vector.length; i++) {
        normalized[i] = vector[i] / norm;
    }
    return normalized;
}
```

## Best Practices

1. Choose the right distance function: cosine for semantic similarity, L2 for magnitude-sensitive.
2. Use IVFFlat for faster indexing with good recall; use HNSW for better recall with slower indexing.
3. Tune `lists` (IVFFlat) or `m`/`ef_construction` (HNSW) based on dataset size.
4. Normalize embeddings when using cosine similarity.
5. Use hybrid search (vector + full-text) for better results.
6. Partition large tables for better query performance.
7. Set appropriate `probes` value for query-time accuracy.
8. Monitor index build time and query latency.

## Summary

pgvector brings vector similarity search to PostgreSQL, enabling semantic search and RAG pipelines without additional infrastructure. With support for cosine, L2, and inner product distances, and IVFFlat/HNSW indexing, it handles production workloads efficiently. Combined with PostgreSQL's full-text search, it enables powerful hybrid search capabilities for modern AI applications.

## References

- pgvector GitHub Documentation
- PostgreSQL Full Text Search Documentation
- "Retrieval-Augmented Generation for Large Language Models" by Gao et al.

Happy Coding
