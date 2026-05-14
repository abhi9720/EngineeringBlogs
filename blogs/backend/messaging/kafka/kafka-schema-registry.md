---
title: "Kafka Schema Registry"
description: "Implement Schema Registry with Avro schemas: schema evolution, compatibility modes, serializers, and integration with Kafka producers and consumers"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - kafka
  - schema-registry
  - avro
  - schema-evolution
coverImage: "/images/kafka-schema-registry.png"
draft: false
---

## Overview

Schema Registry provides a centralized repository for managing and enforcing message schemas in Kafka. It ensures data compatibility between producers and consumers, enabling safe schema evolution. This article covers Avro schema definition, serializer configuration, compatibility modes, and integration patterns.

## Setting Up Schema Registry

Schema Registry is deployed as a REST service alongside Kafka brokers.

```yaml
# docker-compose.yml
version: '3'
services:
  schema-registry:
    image: confluentinc/cp-schema-registry:7.5.0
    ports:
      - "8081:8081"
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: PLAINTEXT://kafka:9092
      SCHEMA_REGISTRY_LISTENERS: http://0.0.0.0:8081
```

## Defining Avro Schemas

Avro schemas are defined in JSON format. They describe the structure of your messages.

```json
{
  "type": "record",
  "name": "OrderEvent",
  "namespace": "com.example.orders",
  "fields": [
    { "name": "orderId", "type": "string" },
    { "name": "customerId", "type": "string" },
    { "name": "amount", "type": "double" },
    { "name": "items", "type": { "type": "array", "items": "string" } },
    { "name": "status", "type": { "type": "enum", "name": "OrderStatus", "symbols": ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"] } },
    { "name": "createdAt", "type": { "type": "long", "logicalType": "timestamp-millis" } }
  ]
}
```

Generate Java classes from Avro schema using Maven:

```xml
<plugin>
    <groupId>org.apache.avro</groupId>
    <artifactId>avro-maven-plugin</artifactId>
    <version>1.11.3</version>
    <executions>
        <execution>
            <phase>generate-sources</phase>
            <goals>
                <goal>schema</goal>
            </goals>
            <configuration>
                <sourceDirectory>${project.basedir}/src/main/resources/avro</sourceDirectory>
                <outputDirectory>${project.basedir}/src/main/java</outputDirectory>
            </configuration>
        </execution>
    </executions>
</plugin>
```

## Producer with Schema Registry

```java
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.ACKS_CONFIG, "all");

props.put(AbstractKafkaSchemaSerDeConfig.SCHEMA_REGISTRY_URL_CONFIG, "http://localhost:8081");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class.getName());
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, KafkaAvroSerializer.class.getName());

KafkaProducer<String, OrderEvent> producer = new KafkaProducer<>(props);

OrderEvent order = OrderEvent.newBuilder()
    .setOrderId("ORD-12345")
    .setCustomerId("CUST-678")
    .setAmount(299.99)
    .setItems(Arrays.asList("Widget A", "Widget B"))
    .setStatus(OrderStatus.PENDING)
    .setCreatedAt(System.currentTimeMillis())
    .build();

ProducerRecord<String, OrderEvent> record = new ProducerRecord<>("orders", order.getOrderId(), order);
producer.send(record, (metadata, exception) -> {
    if (exception == null) {
        System.out.println("Sent to partition " + metadata.partition() + " offset " + metadata.offset());
    }
});
producer.flush();
producer.close();
```

## Consumer with Schema Registry

```java
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-processor");
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

props.put(AbstractKafkaSchemaSerDeConfig.SCHEMA_REGISTRY_URL_CONFIG, "http://localhost:8081");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, KafkaAvroDeserializer.class.getName());
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, KafkaAvroDeserializer.class.getName());
props.put(KafkaAvroDeserializerConfig.SPECIFIC_AVRO_READER_CONFIG, true);

KafkaConsumer<String, OrderEvent> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("orders"));

while (true) {
    ConsumerRecords<String, OrderEvent> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, OrderEvent> record : records) {
        OrderEvent order = record.value();
        System.out.println("Processing order: " + order.getOrderId() + " amount: " + order.getAmount());
        processOrder(order);
    }
}
```

## Schema Evolution and Compatibility

Schema Registry supports several compatibility modes:

- **BACKWARD** (default): New schema can read data written with the previous schema. Consumers using the new schema can read data produced by the old schema.
- **FORWARD**: Old schema can read data written with the new schema. Consumers using the old schema can read data produced by the new schema.
- **FULL**: Both backward and forward compatible.
- **NONE**: No compatibility checking.
- **BACKWARD_TRANSITIVE**: Backward compatible with all previous schemas.
- **FORWARD_TRANSITIVE**: Forward compatible with all previous schemas.
- **FULL_TRANSITIVE**: Fully compatible with all previous schemas.

```java
// Set compatibility via REST API
POST /config/orders-value
{
  "compatibility": "BACKWARD"
}

POST /config/orders-value
{
  "compatibility": "BACKWARD_TRANSITIVE"
}
```

### Adding an Optional Field (Backward Compatible)

When adding a new field, provide a default value to maintain backward compatibility.

```json
{
  "type": "record",
  "name": "OrderEvent",
  "namespace": "com.example.orders",
  "fields": [
    { "name": "orderId", "type": "string" },
    { "name": "customerId", "type": "string" },
    { "name": "amount", "type": "double" },
    { "name": "items", "type": { "type": "array", "items": "string" } },
    { "name": "status", "type": "OrderStatus" },
    { "name": "createdAt", "type": { "type": "long", "logicalType": "timestamp-millis" } },
    { "name": "discountCode", "type": ["null", "string"], "default": null }
  ]
}
```

### Removing a Field (Forward Compatible)

Use the `FULL` compatibility mode to safely remove fields by making them optional first.

```json
{
  "type": "record",
  "name": "OrderEvent",
  "fields": [
    { "name": "orderId", "type": "string" },
    { "name": "customerId", "type": "string" },
    { "name": "amount", "type": "double" },
    { "name": "status", "type": "OrderStatus" },
    { "name": "createdAt", "type": { "type": "long", "logicalType": "timestamp-millis" } }
    // items field removed
  ]
}
```

## REST API Integration

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @Autowired
    private KafkaTemplate<String, OrderEvent> kafkaTemplate;

    @PostMapping
    public ResponseEntity<String> createOrder(@RequestBody OrderRequest request) {
        OrderEvent event = OrderEvent.newBuilder()
            .setOrderId(UUID.randomUUID().toString())
            .setCustomerId(request.customerId())
            .setAmount(request.amount())
            .setItems(request.items())
            .setStatus(OrderStatus.PENDING)
            .setCreatedAt(System.currentTimeMillis())
            .build();

        kafkaTemplate.send("orders", event.getOrderId(), event);
        return ResponseEntity.accepted().body(event.getOrderId());
    }
}
```

## Best Practices

- Use `BACKWARD_TRANSITIVE` for production schemas to ensure all consumers can read new data.
- Always provide defaults for new fields to avoid breaking existing consumers.
- Use union types (`["null", "type"]`) for optional fields.
- Never delete a field immediately; deprecate it first over multiple schema versions.
- Set `specific.avro.reader=true` on consumers for strongly-typed deserialization.
- Monitor schema registry metrics for request latency and schema count.

## Common Mistakes

### Mistake: Adding a required field without default

```json
// Wrong - breaks existing consumers
{ "name": "discountCode", "type": "string" }
```

```json
// Correct - optional field with default
{ "name": "discountCode", "type": ["null", "string"], "default": null }
```

### Mistake: Not setting specific.avro.reader on consumer

```java
// Wrong - returns GenericRecord
props.put(KafkaAvroDeserializerConfig.SPECIFIC_AVRO_READER_CONFIG, false);
```

```java
// Correct - returns specific OrderEvent type
props.put(KafkaAvroDeserializerConfig.SPECIFIC_AVRO_READER_CONFIG, true);
```

## Summary

Schema Registry is essential for managing data contracts in Kafka-based systems. By leveraging Avro schemas with appropriate compatibility modes, teams can evolve their data models safely without breaking existing producers or consumers.

## References

- [Confluent Schema Registry Documentation](https://docs.confluent.io/platform/current/schema-registry/index.html)
- [Apache Avro Specification](https://avro.apache.org/docs/current/spec.html)
- [Schema Evolution Guide](https://docs.confluent.io/platform/current/schema-registry/avro.html)

Happy Coding