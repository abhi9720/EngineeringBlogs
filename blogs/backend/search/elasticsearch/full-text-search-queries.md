---
title: "Full-Text Search Queries"
description: "Master Elasticsearch full-text search: match, term, bool queries, relevance scoring, and query optimization"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["elasticsearch", "full-text-search", "queries", "relevance"]
coverImage: "/images/full-text-search-queries.png"
draft: false
---

## Overview

Full-text search is Elasticsearch's core strength. Unlike exact-match database queries, full-text search analyzes the query text, applies the same analysis pipeline used during indexing, and returns results ranked by relevance. Understanding query types, relevance scoring, and query optimization is essential for building effective search experiences.

This post covers the full-text query DSL, relevance tuning, query performance optimization, and common query patterns.

## Query Types

### Match Query

The `match` query is the go-to for full-text search. It analyzes the input text using the field's analyzer and constructs a boolean query from the resulting tokens. The `operator(AND)` variant requires all tokens to match, useful for precision. `minimumShouldMatch("75%")` ensures at least 75% of the tokens match, tolerating partial matches. `fuzziness(AUTO)` applies edit-distance corrections for typos:

```java
@Service
public class MatchQueryService {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public MatchQueryService(ElasticsearchRestTemplate elasticsearchTemplate) {
        this.elasticsearchTemplate = elasticsearchTemplate;
    }

    public SearchHits<ProductDocument> basicMatch(String query, String field) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.matchQuery(field, query))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> matchWithOptions(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.matchQuery("name", query)
                .operator(Operator.AND)
                .minimumShouldMatch("75%")
                .fuzziness(Fuzziness.AUTO)
                .prefixLength(3)
                .maxExpansions(50))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> multiMatch(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.multiMatchQuery(query,
                    "name^3", "description^2", "category", "brand")
                .type(MultiMatchQueryType.CROSS_FIELDS)
                .operator(Operator.AND)
                .tieBreaker(0.3f))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }
}
```

### Term Query (Exact Match)

Use `term` queries for structured data — keywords, enums, IDs — where you need exact matching without analysis. The `terms` variant accepts multiple values (OR logic), and `exists` checks for the presence of a field:

```java
@Service
public class TermQueryService {

    public SearchHits<ProductDocument> termQuery(String field, String value) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.termQuery(field, value))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> termsQuery(String field, List<String> values) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.termsQuery(field, values))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> existsQuery(String field) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.existsQuery(field))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }
}
```

## Bool Query (Compound Query)

The `bool` query is the Swiss Army knife of the Elasticsearch DSL. It combines four clauses: `must` (contributes to score and must match), `filter` (must match but does not affect score — cached for performance), `should` (boosts score when matched), and `must_not` (excludes documents). The example below demonstrates a complex e-commerce search with keyword search, category/price filters, brand boosting, and exclusions:

```java
@Service
public class BoolQueryService {

    public SearchHits<ProductDocument> complexBoolSearch(SearchRequest request) {
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery();

        // Must: query must match
        if (request.getQuery() != null) {
            boolQuery.must(QueryBuilders.multiMatchQuery(request.getQuery(),
                    "name^3", "description^2")
                .fuzziness(Fuzziness.AUTO));
        }

        // Filter: query must match, but does not affect score
        boolQuery.filter(QueryBuilders.termQuery("available", true));
        boolQuery.filter(QueryBuilders.termQuery("category", request.getCategory()));
        boolQuery.filter(QueryBuilders.rangeQuery("price")
            .gte(request.getMinPrice())
            .lte(request.getMaxPrice()));

        // Should: query should match (boosts score)
        if (request.getPreferredBrand() != null) {
            boolQuery.should(QueryBuilders.termQuery("brand", request.getPreferredBrand()));
        }
        boolQuery.should(QueryBuilders.termQuery("tags", "featured"));

        // Must not: exclude documents
        if (request.getExcludeCategory() != null) {
            boolQuery.mustNot(QueryBuilders.termQuery("category", request.getExcludeCategory()));
        }

        // Minimum should matches for scoring
        boolQuery.minimumShouldMatch(1);

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(boolQuery)
            .withPageable(PageRequest.of(request.getPage(), request.getSize()))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> nestedBoolSearch(String query,
                                                          Map<String, String> filters) {
        BoolQueryBuilder boolQuery = QueryBuilders.boolQuery()
            .must(QueryBuilders.matchQuery("name", query))
            .filter(QueryBuilders.termQuery("available", true));

        // Nested query for attributes
        if (filters != null && !filters.isEmpty()) {
            filters.forEach((key, value) -> {
                boolQuery.filter(QueryBuilders.nestedQuery(
                    "attributes",
                    QueryBuilders.boolQuery()
                        .must(QueryBuilders.termQuery("attributes.name", key))
                        .must(QueryBuilders.termQuery("attributes.value", value)),
                    ScoreMode.None
                ));
            });
        }

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(boolQuery)
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }
}
```

## Relevance Scoring and Boosting

The `function_score` query lets you influence relevance ranking beyond BM25. Common use cases include: boosting by popularity (more popular = higher rank), boosting by recency (newer content ranks higher), and applying business rules (featured products get a boost). The script score variant gives full control via Painless, combining text score, popularity, and profit margin into a custom ranking formula:

```java
@Service
public class RelevanceScoringService {

    public SearchHits<ProductDocument> functionScoreQuery(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.functionScoreQuery(
                QueryBuilders.multiMatchQuery(query, "name^3", "description")
                    .type(MultiMatchQueryType.BEST_FIELDS)
            )
                .functions(
                    // Boost by popularity
                    new FieldValueFactorFunctionBuilder("popularity")
                        .factor(2.0f)
                        .modifier(FieldValueFactorFunction.Modifier.LOG1P)
                        .missing(1.0),

                    // Boost by recency
                    new GaussDecayFunctionBuilder("createdAt", "now", "30d")
                        .setWeight(1.5f),

                    // Boost featured products
                    new FunctionScoreQueryBuilder.FilterFunctionBuilder(
                        QueryBuilders.termQuery("featured", true),
                        ScoreFunctionBuilders.weightFactorFunction(3.0f)
                    )
                )
                .scoreMode(CombineFunction.MULTIPLY)
                .boostMode(CombineFunction.MULTIPLY)
                .maxBoost(10.0f))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> customScoreScript(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.functionScoreQuery(
                QueryBuilders.matchQuery("name", query)
            )
                .functions(ScoreFunctionBuilders.scriptFunction(
                    new Script(ScriptType.INLINE, "painless",
                        "double popularity = doc['popularity'].value; " +
                        "double price = doc['price'].value; " +
                        "double margin = doc['margin'].value; " +
                        "return (_score * 0.5) + (popularity * 0.3) + " +
                        "((price * margin) * 0.2);",
                        Collections.emptyMap()))
                ))
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }
}
```

## Query Optimization

The `search_after` parameter enables efficient deep pagination by encoding the sort values of the last hit — the next page starts after those values, avoiding the `from`/`size` overhead. Limiting returned fields via `withFields` reduces network payload. The `highlight` builder adds `<em>` tags around matched terms. The `suggest` feature provides autocomplete based on the `completion` field type:

```java
@Component
public class QueryOptimizer {

    public SearchHits<ProductDocument> optimizedSearch(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            // Use search_after instead of deep pagination
            .withSearchAfter(List.of("last_sort_value"))

            // Limit fields returned
            .withFields("id", "name", "price", "category")

            // Use keyword fields for sorting
            .withSort(SortBuilders.fieldSort("price").order(SortOrder.ASC))

            // Add highlighting
            .withHighlightBuilder(new HighlightBuilder()
                .field("name")
                .field("description")
                .preTags("<em>")
                .postTags("</em>"))

            // Profile query execution
            .withProfile(true)

            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }

    public SearchHits<ProductDocument> searchWithSuggestions(String query) {
        // Completion suggester for autocomplete
        SuggestBuilder suggestBuilder = new SuggestBuilder();
        suggestBuilder.addSuggestion("product_suggest",
            SuggestBuilders.completionSuggestion("suggest")
                .prefix(query)
                .size(5)
                .skipDuplicates(true)
                .fuzzyOptions(new FuzzyOptions.Builder()
                    .setFuzziness(Fuzziness.ONE)
                    .build()));

        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.matchQuery("name", query))
            .withSuggestBuilder(suggestBuilder)
            .build();

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }
}
```

## Pagination with Search After

Deep pagination with `from`/`size` becomes exponentially more expensive as the page number increases — each request must scan and discard all preceding documents. `search_after` solves this by using the last document's sort values as a cursor. The `Page` wrapper captures the last sort values for the next request:

```java
@Component
public class SearchAfterPagination {

    public Page<ProductDocument> searchAfter(SearchRequest request, 
                                              List<Object> searchAfter) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(buildQuery(request))
            .withSort(SortBuilders.scoreSort().order(SortOrder.DESC))
            .withSort(SortBuilders.fieldSort("id").order(SortOrder.ASC))
            .withPageable(PageRequest.of(0, request.getSize()))
            .build();

        if (searchAfter != null && !searchAfter.isEmpty()) {
            searchQuery.setSearchAfter(searchAfter);
        }

        SearchHits<ProductDocument> hits = elasticsearchTemplate
            .search(searchQuery, ProductDocument.class, IndexCoordinates.of("products"));

        // Get last sort values for next page
        List<Object> lastSort = null;
        if (!hits.getSearchHits().isEmpty()) {
            SearchHit<ProductDocument> lastHit = hits.getSearchHits()
                .get(hits.getSearchHits().size() - 1);
            lastSort = lastHit.getSortValues();
        }

        return new Page<>(hits.stream()
            .map(SearchHit::getContent)
            .toList(),
            request.getSize(),
            lastSort
        );
    }

    // Search after using specific field values
    public SearchHits<ProductDocument> searchAfterField(SearchRequest request,
                                                          Object searchAfterValue) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(buildQuery(request))
            .withSort(SortBuilders.fieldSort("createdAt")
                .order(SortOrder.DESC))
            .withSort(SortBuilders.fieldSort("id")
                .order(SortOrder.ASC))
            .build();

        if (searchAfterValue != null) {
            searchQuery.setSearchAfter(List.of(searchAfterValue));
        }

        return elasticsearchTemplate.search(searchQuery, ProductDocument.class,
            IndexCoordinates.of("products"));
    }
}
```

## Query Validation and Debugging

Elasticsearch provides the `_explain` API to understand why a document matched (or did not match) a query and how its score was computed. The `_profile` API shows the time spent in each query phase across shards, invaluable for identifying slow components:

```java
@Component
public class QueryDebugger {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public String explainQuery(String index, String documentId, QueryBuilder query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(query)
            .build();

        ExplainResponse explain = elasticsearchTemplate.explain(
            documentId, searchQuery, IndexCoordinates.of(index));

        return explain.getExplanation().toString();
    }

    public String validateQuery(QueryBuilder query) {
        try {
            // Validate the query without executing
            String jsonQuery = query.toString();
            // Parse and validate
            ObjectMapper mapper = new ObjectMapper();
            JsonNode queryNode = mapper.readTree(jsonQuery);

            if (!queryNode.has("query")) {
                return "Query must contain a 'query' object";
            }

            return "Query valid";
        } catch (Exception e) {
            return "Invalid query: " + e.getMessage();
        }
    }

    public String getQueryProfile(String query) {
        NativeSearchQuery searchQuery = new NativeSearchQueryBuilder()
            .withQuery(QueryBuilders.matchQuery("name", query))
            .withProfile(true)
            .build();

        SearchHits<ProductDocument> hits = elasticsearchTemplate
            .search(searchQuery, ProductDocument.class, IndexCoordinates.of("products"));

        ProfileResults profileResults = hits.getProfileResults();
        List<QueryProfileShardResult> shardResults = profileResults
            .getFirst().getQueryProfileShardResults();

        return shardResults.stream()
            .map(result -> String.format(
                "Shard %s: %d queries, took %dms",
                result.getShardId(),
                result.getQueryResults().size(),
                result.getTookInMillis()
            ))
            .collect(Collectors.joining("\n"));
    }
}
```

## Common Mistakes

### Using Wildcard Queries

Leading wildcard queries (e.g., `*phone*`) force a full scan of all terms in the inverted index, bypassing the index's ability to look up terms efficiently. They should be avoided in production search:

```java
// Wrong: Leading wildcard causes full scan
QueryBuilders.wildcardQuery("name", "*phone*");
```

```java
// Correct: Use match with fuzziness or ngram
QueryBuilders.matchQuery("name", "phone")
    .fuzziness(Fuzziness.AUTO);
// Or use ngram analyzer for partial matching
```

### Deep Pagination with From/Size

Requesting page 500 with `from=10000` requires Elasticsearch to fetch, sort, and discard 10,000 documents. This consumes memory on the coordinating node and slows with every additional page:

```java
// Wrong: Deep pagination is expensive
query.setFrom(10000);
query.setSize(20);
```

```java
// Correct: Use search_after for deep pagination
query.setSearchAfter(List.of("last_value"));
query.setPageable(PageRequest.of(0, 20));
```

## Best Practices

1. Use `match` and `multi_match` for full-text search; use `term` for exact values.
2. Combine queries with `bool` for complex search logic.
3. Use `function_score` for business-relevant ranking.
4. Prefer `search_after` over `from/size` for deep pagination.
5. Use `filter` context for structured conditions that don't affect score.
6. Limit returned fields using `_source` filtering.
7. Profile slow queries to identify bottlenecks.
8. Use `minimum_should_match` for precision control.

## Summary

Elasticsearch provides a rich query DSL for full-text search. Match queries analyze text for relevance scoring, term queries provide exact matching, and bool queries combine multiple conditions. Function score queries enable business-specific ranking. Understanding these query types and their optimization is essential for building performant search applications.

## References

- Elasticsearch Reference: "Full text queries"
- Elasticsearch Reference: "Query DSL"
- "Elasticsearch in Action" by Radu Gheorghe et al.

Happy Coding
