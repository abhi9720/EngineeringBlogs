---
title: 'Indexing, Mappings, and Analysis'
description: >-
  Deep dive into Elasticsearch index mappings, analyzers, tokenizers, and custom
  analysis pipelines
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - elasticsearch
  - indexing
  - mappings
  - analyzers
coverImage: /images/indexing-mappings-analysis.png
draft: false
order: 40
---
## Overview

Indexing in Elasticsearch determines how documents are stored, searched, and aggregated. Mappings define the schema for document fields, while analyzers control the text analysis pipeline: character filtering, tokenization, and token filtering.

A well-designed index mapping is the foundation of good search performance and relevance. This post covers mapping strategies, custom analyzers, and indexing best practices.

## Mapping Types

### Explicit Mapping

The following configuration programmatically creates an Elasticsearch index with custom settings and explicit field mappings. The `product_analyzer` uses an `edge_ngram` filter for autocomplete support — it tokenizes input into progressively longer prefixes so that "phone" matches queries for "p", "ph", "pho", etc. A separate `search_analyzer` is applied at query time (without the ngram filter) so that the user's full query term is matched against the indexed prefixes:

```java
@Configuration
public class ProductIndexMapping {

    private final ElasticsearchOperations elasticsearchOperations;

    public ProductIndexMapping(ElasticsearchOperations elasticsearchOperations) {
        this.elasticsearchOperations = elasticsearchOperations;
    }

    @PostConstruct
    public void createIndexMapping() {
        IndexOperations indexOps = elasticsearchOperations
            .indexOps(IndexCoordinates.of("products"));

        if (!indexOps.exists()) {
            indexOps.create(createIndexSettings());
            indexOps.putMapping(createMapping());
        }
    }

    private Settings createIndexSettings() {
        String settings = """
            {
                "index": {
                    "number_of_shards": 3,
                    "number_of_replicas": 2,
                    "refresh_interval": "30s",
                    "max_result_window": 10000,
                    "analysis": {
                        "filter": {
                            "product_autocomplete_filter": {
                                "type": "edge_ngram",
                                "min_gram": 1,
                                "max_gram": 20
                            },
                            "product_synonyms": {
                                "type": "synonym",
                                "synonyms_path": "analysis/synonyms.txt"
                            }
                        },
                        "analyzer": {
                            "product_analyzer": {
                                "type": "custom",
                                "tokenizer": "standard",
                                "filter": [
                                    "lowercase",
                                    "product_autocomplete_filter",
                                    "product_synonyms"
                                ]
                            },
                            "product_search_analyzer": {
                                "type": "custom",
                                "tokenizer": "standard",
                                "filter": [
                                    "lowercase",
                                    "product_synonyms"
                                ]
                            }
                        }
                    }
                }
            }
            """;

        return Settings.parseSettings(settings, false, false);
    }

    private Map<String, Object> createMapping() {
        return Map.of(
            "properties", Map.of(
                "name", Map.of(
                    "type", "text",
                    "analyzer", "product_analyzer",
                    "search_analyzer", "product_search_analyzer",
                    "fields", Map.of(
                        "keyword", Map.of(
                            "type", "keyword",
                            "ignore_above", 256
                        ),
                        "english", Map.of(
                            "type", "text",
                            "analyzer", "english"
                        )
                    )
                ),
                "description", Map.of(
                    "type", "text",
                    "analyzer", "english",
                    "term_vector", "with_positions_offsets"
                ),
                "category", Map.of(
                    "type", "keyword"
                ),
                "brand", Map.of(
                    "type", "keyword"
                ),
                "price", Map.of(
                    "type", "float",
                    "doc_values", true
                ),
                "stock_quantity", Map.of(
                    "type", "integer"
                ),
                "available", Map.of(
                    "type", "boolean"
                ),
                "tags", Map.of(
                    "type", "keyword"
                ),
                "attributes", Map.of(
                    "type", "nested",
                    "properties", Map.of(
                        "name", Map.of("type", "keyword"),
                        "value", Map.of("type", "keyword")
                    )
                ),
                "created_at", Map.of(
                    "type", "date",
                    "format", "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
                ),
                "suggest", Map.of(
                    "type", "completion"
                )
            )
        );
    }
}
```

## Custom Analyzers

### Analyzer Configuration

An analyzer is a pipeline of three stages: **char_filter** (preprocesses the raw text — stripping HTML, replacing characters), **tokenizer** (splits text into tokens), and **filter** (transforms tokens — lowercasing, stemming, stop-word removal, synonym expansion). The example below configures five analyzers for different use cases: `html_analyzer` strips HTML tags before analysis, `ngram_analyzer` generates substrings for partial matching, and `synonym_analyzer` expands terms using a synonym list:

```json
{
  "settings": {
    "analysis": {
      "char_filter": {
        "html_strip": {
          "type": "html_strip"
        },
        "custom_mapping": {
          "type": "mapping",
          "mappings": [
            "& => and",
            "| => or"
          ]
        }
      },
      "filter": {
        "english_stop": {
          "type": "stop",
          "stopwords": "_english_"
        },
        "english_stemmer": {
          "type": "stemmer",
          "language": "english"
        },
        "product_synonyms": {
          "type": "synonym",
          "synonyms": [
            "laptop, notebook",
            "cellphone, mobile, smartphone",
            "tv, television",
            "sneakers, trainers, running shoes"
          ]
        },
        "ngram_filter": {
          "type": "ngram",
          "min_gram": 2,
          "max_gram": 10
        }
      },
      "analyzer": {
        "html_analyzer": {
          "type": "custom",
          "char_filter": ["html_strip"],
          "tokenizer": "standard",
          "filter": ["lowercase", "english_stop"]
        },
        "ngram_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "ngram_filter"]
        },
        "synonym_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "product_synonyms"]
        }
      }
    }
  }
}
```

### Java Configuration for Analyzers

Elasticsearch's `_analyze` API lets you test how a specific analyzer processes text without indexing any documents. The `AnalyzerConfiguration` below provides a method to send text to this endpoint and inspect the resulting tokens — invaluable for debugging analysis chains before deploying them:

```java
@Component
public class AnalyzerConfiguration {

    public Analyzer createCustomAnalyzer() {
        return new CustomAnalyzer.Builder()
            .addCharFilter("html_strip")
            .withTokenizer("standard")
            .addTokenFilter("lowercase")
            .addTokenFilter("stop", Map.of("stopwords", "_english_"))
            .addTokenFilter("stemmer", Map.of("language", "english"))
            .build();
    }

    public String analyzeText(String text, String analyzerName) {
        try {
            RestClient restClient = elasticsearchOperations
                .getElasticsearchClient().getLowLevelClient();

            HttpEntity entity = new NStringEntity(
                "{\"analyzer\": \"" + analyzerName + "\", \"text\": \"" + text + "\"}",
                ContentType.APPLICATION_JSON);

            Response response = restClient
                .performRequest("POST", "/_analyze", Collections.emptyMap(), entity);

            return EntityUtils.toString(response.getEntity());
        } catch (IOException e) {
            throw new AnalysisException("Failed to analyze text", e);
        }
    }

    @SneakyThrows
    public void testAnalyzer() {
        String result = analyzeText(
            "I'm looking for running sneakers",
            "synonym_analyzer"
        );
        log.info("Analysis result: {}", result);
    }
}
```

## Dynamic Templates

Dynamic templates let you control how unmapped fields are handled when documents are indexed. Instead of relying on default dynamic mapping (which might infer a `text` type for a string that should be `keyword`), you define patterns. The configuration below maps all strings to `keyword` by default, treats `long` values as `integer`, and recognizes fields ending in `_at` as dates. The `path_match` pattern applies to nested fields matching `attributes.*`:

```java
@Configuration
public class DynamicTemplateMapping {

    public Map<String, Object> createDynamicTemplateMapping() {
        return Map.of(
            "dynamic_templates", List.of(
                Map.of(
                    "strings_as_keyword", Map.of(
                        "match_mapping_type", "string",
                        "mapping", Map.of(
                            "type", "keyword",
                            "ignore_above", 256
                        )
                    )
                ),
                Map.of(
                    "longs_as_integer", Map.of(
                        "match_mapping_type", "long",
                        "mapping", Map.of(
                            "type", "integer"
                        )
                    )
                ),
                Map.of(
                    "dates_as_date", Map.of(
                        "match", "*_at",
                        "mapping", Map.of(
                            "type", "date",
                            "format", "yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis"
                        )
                    )
                ),
                Map.of(
                    "attributes_mapping", Map.of(
                        "path_match", "attributes.*",
                        "mapping", Map.of(
                            "type", "keyword"
                        )
                    )
                )
            ),
            "properties", Map.of(
                "name", Map.of(
                    "type", "text",
                    "analyzer", "standard",
                    "fields", Map.of(
                        "keyword", Map.of("type", "keyword")
                    )
                )
            )
        );
    }
}
```

## Reindexing Strategies

Reindexing is required when you need to change an index's mapping or settings. The zero-downtime pattern uses an alias: the application queries the alias, not the underlying index. You create a new index with the updated mapping, reindex data into it, atomically swap the alias, then delete the old index. The pipeline variant transforms documents during reindex, useful for data migration:

```java
@Component
public class ReindexService {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public ReindexService(ElasticsearchRestTemplate elasticsearchTemplate) {
        this.elasticsearchTemplate = elasticsearchTemplate;
    }

    public void reindexWithAlias(String sourceIndex, String targetIndex) {
        // Step 1: Create target index with new mapping
        createTargetIndex(targetIndex);

        // Step 2: Reindex data
        ReindexRequest reindexRequest = new ReindexRequest(
            sourceIndex, targetIndex);
        reindexRequest.setConflicts("proceed");

        BulkByScrollResponse response = elasticsearchTemplate
            .reindex(reindexRequest);

        log.info("Reindexed {} documents", response.getCreated());

        // Step 3: Atomically swap aliases
        String aliasName = "products_alias";
        elasticsearchTemplate.execute(client -> {
            client.indices()
                .updateAliases(new IndicesAliasesRequest()
                    .addAliasAction(
                        IndicesAliasesRequest.AliasActions.remove()
                            .index(sourceIndex).alias(aliasName))
                    .addAliasAction(
                        IndicesAliasesRequest.AliasActions.add()
                            .index(targetIndex).alias(aliasName)),
                    RequestOptions.DEFAULT);
            return null;
        });

        // Step 4: Delete old index
        deleteIndex(sourceIndex);
    }

    private void createTargetIndex(String indexName) {
        IndexOperations indexOps = elasticsearchOperations
            .indexOps(IndexCoordinates.of(indexName));

        if (!indexOps.exists()) {
            indexOps.create(new Settings.Builder()
                .put("index.number_of_shards", 3)
                .put("index.number_of_replicas", 2)
                .put("index.refresh_interval", "-1")
                .build());
            indexOps.putMapping(createUpdatedMapping());
        }
    }

    public void reindexWithPipeline(String sourceIndex, String targetIndex,
                                     String pipelineId) {
        ReindexRequest request = new ReindexRequest(sourceIndex, targetIndex);
        request.setDestPipeline(pipelineId);

        BulkByScrollResponse response = elasticsearchTemplate.reindex(request);
        log.info("Pipeline reindex complete: {} documents processed",
            response.getCreated());
    }
}
```

## Index Lifecycle Management

ILM automates the management of time-series indices through four phases. **Hot** — indices are actively written and queried; rollover triggers when the index reaches 50 GB or 30 days. **Warm** — indices are read-only, shrunk to a single shard, and force-merged. **Cold** — indices are frozen to reduce memory footprint. **Delete** — indices are removed after 365 days:

```java
@Component
public class IndexLifecycleManager {

    private final ElasticsearchRestTemplate elasticsearchTemplate;

    public void configureILMPolicy() {
        String policy = """
            {
                "policy": {
                    "phases": {
                        "hot": {
                            "min_age": "0ms",
                            "actions": {
                                "rollover": {
                                    "max_size": "50GB",
                                    "max_age": "30d"
                                }
                            }
                        },
                        "warm": {
                            "min_age": "30d",
                            "actions": {
                                "shrink": {
                                    "number_of_shards": 1
                                },
                                "forcemerge": {
                                    "max_num_segments": 1
                                }
                            }
                        },
                        "cold": {
                            "min_age": "90d",
                            "actions": {
                                "freeze": {}
                            }
                        },
                        "delete": {
                            "min_age": "365d",
                            "actions": {
                                "delete": {}
                            }
                        }
                    }
                }
            }
            """;

        // Apply policy via REST API
        RestClient restClient = elasticsearchTemplate
            .getElasticsearchClient().getLowLevelClient();

        try {
            HttpEntity entity = new NStringEntity(policy,
                ContentType.APPLICATION_JSON);
            restClient.performRequest("PUT",
                "/_ilm/policy/logs_policy",
                Collections.emptyMap(), entity);
        } catch (IOException e) {
            throw new ILMConfigurationException("Failed to create ILM policy", e);
        }
    }
}
```

## Common Mistakes

### Using Text for All String Fields

A `text` field is analyzed and cannot be used for sorting, terms aggregation, or exact filtering. Fields like email, status, and category should be `keyword`:

```java
// Wrong: All strings as text
"properties": {
    "name": { "type": "text" },
    "email": { "type": "text" },  // Should be keyword
    "status": { "type": "text" }  // Should be keyword
}
```

```java
// Correct: Use keyword for exact values
"properties": {
    "name": {
        "type": "text",
        "fields": {
            "keyword": { "type": "keyword" }
        }
    },
    "email": { "type": "keyword" },
    "status": { "type": "keyword" }
}
```

### Not Using doc_values

`doc_values` is an on-disk data structure optimized for sorting and aggregations. Without it, Elasticsearch must load the field's inverted index into memory, which is inefficient for these operations:

```java
// Wrong: Missing doc_values for aggregations
"properties": {
    "price": { "type": "float" } // Cannot aggregate efficiently
}
```

```java
// Correct: Enable doc_values for aggregatable fields
"properties": {
    "price": { "type": "float", "doc_values": true }
}
```

## Best Practices

1. Define explicit mappings before indexing any data.
2. Use multi-fields for text fields that also need exact matching.
3. Choose the right analyzer for each language and use case.
4. Use `ignore_above` to prevent large keyword fields.
5. Enable `doc_values` for fields used in sorting and aggregations.
6. Use ILM for managing time-series indices.
7. Test analyzers with `_analyze` API before deploying.
8. Plan shard sizing carefully (20-40 GB per shard).

## Summary

Index mappings and analyzers are the foundation of Elasticsearch performance and relevance. Proper mapping design ensures correct field types, efficient storage, and optimal query performance. Custom analyzers enable language-specific search, autocomplete, and synonym handling. Always define explicit mappings, test analyzers, and plan index lifecycle management.

## References

- Elasticsearch Reference: "Mapping"
- Elasticsearch Reference: "Analysis"
- "Elasticsearch in Action" by Radu Gheorghe et al.

Happy Coding
