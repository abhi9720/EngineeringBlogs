---
title: "MongoDB with Spring Data"
description: "Master Spring Data MongoDB: documents, repositories, aggregations, indexing, transactions, and production best practices for MongoDB in Java"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - mongodb
  - spring-data
  - nosql
  - database
coverImage: "/images/backend/data-access/nosql/mongodb-with-spring-data.png"
draft: false
---

# MongoDB with Spring Data

## Overview

MongoDB is a document-oriented NoSQL database that stores data in flexible, JSON-like documents. Spring Data MongoDB provides familiar repository patterns, template-based access, and seamless integration with Spring Boot, making it easy to build MongoDB-backed applications in Java.

---

## Document Mapping

### Entity Design

```java
@Document(collection = "orders")
@CompoundIndexes({
    @CompoundIndex(name = "user_status_idx", def = "{'userId': 1, 'status': 1}"),
    @CompoundIndex(name = "created_at_idx", def = "{'createdAt': -1}"),
    @CompoundIndex(name = "order_number_idx", def = "{'orderNumber': 1}", unique = true)
})
public class OrderDocument {

    @Id
    private String id;

    @Field("order_number")
    private String orderNumber;

    @Field("user_id")
    private String userId;

    @Field("items")
    private List<OrderItem> items = new ArrayList<>();

    @Field("shipping_address")
    private Address shippingAddress;

    @Field("total_amount")
    private BigDecimal totalAmount;

    @Field("status")
    @Enum(STRING)
    private OrderStatus status;

    @Field("payment")
    private PaymentInfo payment;

    @CreatedDate
    private Instant createdAt;

    @LastModifiedDate
    private Instant updatedAt;

    @Version
    private Long version;
}

@Document
public class OrderItem {

    @Field("product_id")
    private String productId;

    @Field("product_name")
    private String productName;

    @Field("quantity")
    private int quantity;

    @Field("unit_price")
    private BigDecimal unitPrice;

    @Field("subtotal")
    private BigDecimal subtotal;
}

@Document
public class Address {

    @Field("street")
    private String street;

    @Field("city")
    private String city;

    @Field("state")
    private String state;

    @Field("zip")
    private String zip;

    @Field("country")
    private String country;
}
```

---

## Repositories

### MongoDB Repository

```java
@Repository
public interface OrderRepository extends MongoRepository<OrderDocument, String> {

    // Derived queries
    List<OrderDocument> findByUserId(String userId);

    List<OrderDocument> findByStatus(OrderStatus status);

    List<OrderDocument> findByUserIdAndStatus(String userId, OrderStatus status);

    // Sorting
    List<OrderDocument> findByUserIdOrderByCreatedAtDesc(String userId);

    // Pagination
    Page<OrderDocument> findByStatus(OrderStatus status, Pageable pageable);

    // Field existence
    List<OrderDocument> findByPaymentNotNull();

    // Array/collection queries
    List<OrderDocument> findByItemsProductId(String productId);

    // Date range queries
    List<OrderDocument> findByCreatedAtBetween(Instant start, Instant end);

    // Count
    long countByStatus(OrderStatus status);

    // Delete
    void deleteByUserId(String userId);

    // Exists
    boolean existsByOrderNumber(String orderNumber);
}
```

### Custom Queries with @Query

```java
@Repository
public interface ProductRepository extends MongoRepository<ProductDocument, String> {

    @Query("{ 'category': ?0, 'price': { $gte: ?1, $lte: ?2 } }")
    List<ProductDocument> findByCategoryAndPriceRange(
        String category, BigDecimal minPrice, BigDecimal maxPrice);

    @Query(value = "{ 'tags': { $in: ?0 } }", fields = "{ 'name': 1, 'price': 1, 'tags': 1 }")
    List<ProductDocument> findByTagsWithProjection(List<String> tags);

    @Query("{ 'attributes.?0': ?1 }")  // Dynamic field
    List<ProductDocument> findByAttribute(String attributeName, String value);

    @Query("{ 'stock': { $lt: ?0 } }")
    List<ProductDocument> findLowStockProducts(int threshold);

    @Query(value = "{ 'status': 'ACTIVE' }", sort = "{ 'salesCount': -1 }")
    List<ProductDocument> findTopSelling();

    @Query("{ '$text': { '$search': ?0 } }")
    List<ProductDocument> searchByText(String searchTerm);

    @Query(value = "{ 'reviews.rating': { $gte: ?0 } }", count = true)
    int countByMinRating(double minRating);
}
```

---

## MongoDBTemplate

### Template Usage

```java
@Service
public class ProductTemplateService {

    private final MongoTemplate mongoTemplate;

    public ProductTemplateService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public List<ProductDocument> findProductsWithCustomCriteria() {
        Query query = new Query();

        // Criteria building
        query.addCriteria(Criteria.where("status").is("ACTIVE"));
        query.addCriteria(Criteria.where("price").gte(10).lte(100));
        query.addCriteria(Criteria.where("stock").gt(0));

        // Text search
        query.addCriteria(Criteria.where("name").regex("^[A-Z]", "i"));

        // Field projection - exclude large fields
        query.fields().include("name", "price", "stock");
        query.fields().exclude("description");

        // Sort and pagination
        query.with(Sort.by(Sort.Direction.DESC, "salesCount"));
        query.with(PageRequest.of(0, 20));

        return mongoTemplate.find(query, ProductDocument.class);
    }

    public List<ProductDocument> findProductsNearLocation(
            double longitude, double latitude, double maxDistanceKm) {

        Query query = new Query();

        // Geospatial query
        query.addCriteria(Criteria.where("location")
            .nearSphere(new Point(longitude, latitude))
            .maxDistance(maxDistanceKm / 6378.1)); // Convert km to radians

        return mongoTemplate.find(query, ProductDocument.class);
    }

    public ProductDocument updateProductPrice(String productId, BigDecimal newPrice) {
        Query query = new Query(Criteria.where("id").is(productId));
        Update update = new Update()
            .set("price", newPrice)
            .set("updatedAt", Instant.now())
            .inc("priceUpdateCount", 1);

        FindAndModifyOptions options = new FindAndModifyOptions()
            .returnNew(true);

        return mongoTemplate.findAndModify(query, update, options, ProductDocument.class);
    }

    public void bulkUpdateCategoryDiscount(String category, BigDecimal discountPercent) {
        Query query = new Query(Criteria.where("category").is(category));
        Update update = new Update()
            .mul("price", BigDecimal.ONE.subtract(
                discountPercent.divide(BigDecimal.valueOf(100))))
            .set("onSale", true);

        mongoTemplate.updateMulti(query, update, ProductDocument.class);
    }

    public List<Map> runAggregation() {
        Aggregation aggregation = Aggregation.newAggregation(
            Aggregation.match(Criteria.where("status").is("COMPLETED")),
            Aggregation.group("userId")
                .count().as("orderCount")
                .sum("totalAmount").as("totalSpent")
                .avg("totalAmount").as("averageOrderValue"),
            Aggregation.sort(Sort.by(Sort.Direction.DESC, "totalSpent")),
            Aggregation.limit(10),
            Aggregation.project()
                .andExpression("_id").as("userId")
                .andInclude("orderCount", "totalSpent", "averageOrderValue")
        );

        return mongoTemplate.aggregate(aggregation, "orders", Map.class)
            .getMappedResults();
    }
}
```

---

## Transactions

### MongoDB Transactions

```java
@Service
public class OrderTransactionService {

    private final MongoTemplate mongoTemplate;

    @Transactional
    public OrderDocument createOrderWithTransaction(OrderDocument order) {
        // MongoDB requires replica set for transactions

        // Validate and save order
        order.setStatus(OrderStatus.PENDING);
        order.setCreatedAt(Instant.now());
        OrderDocument saved = mongoTemplate.save(order);

        // Update inventory within same transaction
        for (OrderItem item : order.getItems()) {
            Query inventoryQuery = new Query(
                Criteria.where("productId").is(item.getProductId())
                    .and("stock").gte(item.getQuantity()));

            Update inventoryUpdate = new Update()
                .inc("stock", -item.getQuantity());

            UpdateResult result = mongoTemplate.updateFirst(
                inventoryQuery, inventoryUpdate, "inventory");

            if (result.getModifiedCount() == 0) {
                throw new InsufficientStockException(
                    "Insufficient stock for product: " + item.getProductId());
            }
        }

        return saved;
    }
}
```

---

## Best Practices

1. **Design documents for access patterns**: Embed related data, reference when needed
2. **Use compound indexes**: Indexes for common query patterns
3. **Enable profiling**: Identify slow queries in production
4. **Limit array growth**: Embedded arrays should not grow unbounded
5. **Use projections**: Fetch only required fields
6. **Prefer $set for updates**: Replace full documents only when necessary
7. **Use write concerns**: Configure durability requirements
8. **Implement connection pooling**: Use MongoDB driver's pool settings
9. **Monitor query performance**: Use MongoDB Atlas or Ops Manager
10. **Use MongoDB transactions for multi-document atomicity**

```java
// MongoDB connection configuration
spring.data.mongodb.uri=mongodb://user:pass@host:27017/dbname
spring.data.mongodb.auto-index-creation=true
```

---

## Common Mistakes

### Mistake 1: Deeply Nested Documents

```java
// WRONG: Deep nesting makes queries complex and indexing hard
// CORRECT: Limit to 2-3 levels, use references for deeper hierarchies
```

### Mistake 2: Missing Indexes for Query Patterns

```java
// WRONG: No index for common query
db.orders.find({ userId: "123", status: "PENDING" })
// Full collection scan!

// CORRECT: Compound index
@CompoundIndex(name = "user_status_idx", def = "{'userId': 1, 'status': 1}")
```

### Mistake 3: Unbounded Arrays

```java
// WRONG: Embedded array grows indefinitely
order.items.push(newItem);  // Array grows without limit

// CORRECT: Limit array size or use separate collection
// MongoDB document size limit is 16MB
```

---

## Summary

1. MongoDB stores data as flexible BSON documents
2. Spring Data MongoDB provides repository and template patterns
3. Design documents for your application's access patterns
4. Use compound indexes to support common queries
5. Aggregation pipeline handles complex data processing
6. Transactions provide multi-document atomicity (replica sets)
7. Limit document nesting and array growth
8. Monitor and profile query performance

---

## References

- [MongoDB Documentation](https://www.mongodb.com/docs/)
- [Spring Data MongoDB Reference](https://docs.spring.io/spring-data/mongodb/reference/)
- [MongoDB Aggregation Pipeline](https://www.mongodb.com/docs/manual/aggregation-pipeline/)
- [MongoDB Indexing Strategies](https://www.mongodb.com/docs/manual/indexes/)

Happy Coding