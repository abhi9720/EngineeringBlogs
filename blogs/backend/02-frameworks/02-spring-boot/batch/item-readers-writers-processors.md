---
title: 'Item Readers, Writers, and Processors in Spring Batch'
description: >-
  Comprehensive guide to Spring Batch item processing: built-in readers/writers,
  custom implementations, composite processors, and multi-file processing
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - spring-boot
  - spring-batch
  - item-reader
  - item-writer
coverImage: /images/item-readers-writers-processors.png
draft: false
order: 20
---
## Overview

ItemReader, ItemProcessor, and ItemWriter are the three core interfaces in Spring Batch's chunk-oriented processing. Spring Batch provides numerous built-in implementations for reading from and writing to various data sources. This guide covers custom implementations, composite patterns, and advanced techniques.

The contract is simple: the reader provides items one at a time (returning null when exhausted), the processor transforms each item (returning null to filter it out), and the writer receives a list of processed items to persist. Understanding how to customize each stage is essential for building production-grade batch pipelines.

## ItemReader Implementations

### Custom ItemReader

A custom reader is needed when the data source doesn't have a built-in implementation — for example, consuming a REST API with pagination. The `ApiItemReader` below handles paginated API responses, maintaining internal state for the current page and position within the page.

The reader must be thread-safe if used in a multi-threaded step. The `currentIndex` and `page` fields are mutable state; in a multi-threaded context, these should be protected with synchronization or stored in step execution context.

```java
@Component
public class ApiItemReader implements ItemReader<ApiRecord> {
    private final RestTemplate restTemplate;
    private final String apiUrl;
    private int page = 0;
    private final int pageSize = 100;
    private boolean completed = false;

    public ApiItemReader(RestTemplate restTemplate,
                        @Value("${app.api.url}") String apiUrl) {
        this.restTemplate = restTemplate;
        this.apiUrl = apiUrl;
    }

    @Override
    public ApiRecord read() throws Exception {
        if (completed) return null;

        String url = String.format("%s?page=%d&size=%d", apiUrl, page, pageSize);
        ResponseEntity<ApiResponse> response = restTemplate.getForEntity(url, ApiResponse.class);

        ApiResponse body = response.getBody();
        if (body == null || body.getRecords().isEmpty()) {
            completed = true;
            return null;
        }

        if (currentIndex >= body.getRecords().size()) {
            if (body.isLast()) {
                completed = true;
                return null;
            }
            page++;
            currentIndex = 0;
            return read();
        }

        return body.getRecords().get(currentIndex++);
    }

    private int currentIndex = 0;
}
```

### Composite ItemReader

A composite reader sequences multiple sources: read all items from the first reader, then move to the second, and so on. This is useful when loading data from multiple files or APIs that share the same target format.

The implementation below uses a `Queue` of readers. When the current reader is exhausted (returns null), the next reader in the queue takes over. When all readers are exhausted, the composite returns null, ending the chunk step.

```java
@Component
public class CompositeItemReader implements ItemReader<Object> {
    private final Queue<ItemReader<?>> readers = new LinkedList<>();

    public CompositeItemReader() {
        readers.add(new UserCsvReader());
        readers.add(new OrderXmlReader());
        readers.add(new ProductJsonReader());
    }

    private ItemReader<?> currentReader;

    @Override
    public Object read() throws Exception {
        if (currentReader == null) {
            currentReader = readers.poll();
        }

        if (currentReader == null) return null;

        Object item = currentReader.read();
        if (item == null) {
            currentReader = readers.poll();
            return read();
        }

        return item;
    }
}
```

### Multi-Resource Reader

Spring Batch's built-in `MultiResourceItemReader` processes multiple files as if they were one continuous stream. It wraps a delegate reader and feeds it resources one at a time. The `strict(true)` flag throws an exception if no resources match the pattern, which is useful for catching configuration errors early.

This is ideal for processing daily log files or batch feed files from multiple sources. Each file is processed completely before moving to the next, so the chunk boundaries don't cross file boundaries.

```java
@Component
public class MultiResourceItemReader {
    @Bean
    @StepScope
    public MultiResourceItemReader<User> multiResourceReader(
            @Value("#{jobParameters['inputDirectory']}") String directory) {
        Resource[] resources;
        try {
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            resources = resolver.getResources("file:" + directory + "/*.csv");
        } catch (IOException e) {
            throw new RuntimeException("Failed to load resources", e);
        }

        return new MultiResourceItemReaderBuilder<User>()
            .name("multiResourceReader")
            .resources(resources)
            .delegate(userCsvReader())
            .strict(true)
            .build();
    }

    private FlatFileItemReader<User> userCsvReader() {
        return new FlatFileItemReaderBuilder<User>()
            .name("userCsvReader")
            .delimited()
            .names("firstName", "lastName", "email")
            .targetType(User.class)
            .build();
    }
}
```

## ItemProcessor Patterns

### Composite ItemProcessor

A composite processor chains multiple transformations: validate, enrich, deduplicate, format. Each processor in the chain either returns a transformed item or null to filter it out. This pattern follows the Single Responsibility Principle — each processor handles one concern.

The composite iterates through all processors. If any processor returns null (indicating the item should be filtered), the composite returns null and processing stops for that item. The remaining processors in the chain are not executed.

```java
@Component
public class CompositeUserProcessor implements ItemProcessor<User, ProcessedUser> {
    private final List<ItemProcessor<User, User>> processors;

    public CompositeUserProcessor() {
        this.processors = List.of(
            new ValidationProcessor(),
            new EnrichmentProcessor(),
            new DeduplicationProcessor(),
            new FormattingProcessor()
        );
    }

    @Override
    public ProcessedUser process(User user) throws Exception {
        User processed = user;
        for (ItemProcessor<User, User> processor : processors) {
            processed = processor.process(processed);
            if (processed == null) {
                return null; // Filter out
            }
        }
        return new ProcessedUser(processed);
    }
}

class ValidationProcessor implements ItemProcessor<User, User> {
    @Override
    public User process(User user) {
        if (user.getEmail() == null || !user.getEmail().contains("@")) {
            return null;
        }
        return user;
    }
}

class EnrichmentProcessor implements ItemProcessor<User, User> {
    @Override
    public User process(User user) {
        user.setFullName(user.getFirstName() + " " + user.getLastName());
        user.setEmailDomain(user.getEmail().split("@")[1]);
        return user;
    }
}

class FormattingProcessor implements ItemProcessor<User, User> {
    @Override
    public User process(User user) {
        user.setEmail(user.getEmail().toLowerCase());
        user.setFirstName(capitalize(user.getFirstName()));
        user.setLastName(capitalize(user.getLastName()));
        return user;
    }

    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return s.substring(0, 1).toUpperCase() + s.substring(1).toLowerCase();
    }
}
```

### Conditional Processing

A conditional processor combines filtering and transformation in a single class. Returning null from `process()` tells Spring Batch to skip that item — it won't be counted in writes or passed to the writer. This is the idiomatic way to filter items in chunk-oriented processing.

The example below filters out zero-amount and cancelled orders, then enriches valid orders with a priority based on amount thresholds. The priority determination logic is separated into its own method for testability.

```java
@Component
public class ConditionalItemProcessor implements ItemProcessor<Order, Order> {
    @Override
    public Order process(Order order) {
        // Filter logic
        if (order.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
            return null; // Skip zero/negative orders
        }

        if (order.getStatus() == OrderStatus.CANCELLED) {
            return null; // Skip cancelled orders
        }

        // Transform logic
        order.setProcessedAt(LocalDateTime.now());

        if (order.getAmount().compareTo(new BigDecimal("10000")) > 0) {
            order.setRequiresApproval(true);
        }

        if (order.getPriority() == null) {
            order.setPriority(determinePriority(order));
        }

        return order;
    }

    private Priority determinePriority(Order order) {
        if (order.getAmount().compareTo(new BigDecimal("50000")) > 0) {
            return Priority.HIGH;
        } else if (order.getAmount().compareTo(new BigDecimal("10000")) > 0) {
            return Priority.MEDIUM;
        }
        return Priority.LOW;
    }
}
```

## ItemWriter Patterns

### Custom ItemWriter

A custom writer lets you send each chunk to an external system that Spring Batch doesn't support natively. The `BatchEmailWriter` below creates email messages from notification items and sends them as a batch using JavaMailSender.

The writer receives a `Chunk` which extends `List`. It iterates through the items, creates `MimeMessage` objects, and sends them all at once. The `Chunk` class also provides utility methods like `getErrors()` for tracking items that failed during writing.

```java
@Component
public class BatchEmailWriter implements ItemWriter<Notification> {
    private final JavaMailSender mailSender;
    private final List<Notification> buffer = new ArrayList<>();

    public BatchEmailWriter(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @Override
    public void write(Chunk<? extends Notification> chunk) {
        List<MimeMessage> messages = new ArrayList<>();

        for (Notification notification : chunk) {
            try {
                MimeMessage message = mailSender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, true);
                helper.setTo(notification.getEmail());
                helper.setSubject(notification.getSubject());
                helper.setText(notification.getBody(), true);
                messages.add(message);
            } catch (MessagingException e) {
                throw new RuntimeException("Failed to create email", e);
            }
        }

        mailSender.send(messages.toArray(new MimeMessage[0]));
    }
}
```

### Classifier Composite Writer

A classifier writer routes each item to a different writer based on a classifier. This is useful when a single step processes multiple record types. The classifier maps each record type to a specific writer, with a dead-letter writer for unrecognized types.

The classifier is evaluated per item, so different items in the same chunk can be written by different writers. If any writer fails, the entire chunk rolls back, including items already written to other destinations.

```java
@Component
public class ClassifierCompositeWriter implements ItemWriter<DataRecord> {
    private final Classifier<DataRecord, ItemWriter<? super DataRecord>> classifier;

    public ClassifierCompositeWriter() {
        Map<RecordType, ItemWriter<DataRecord>> writerMap = new HashMap<>();
        writerMap.put(RecordType.USER, userWriter());
        writerMap.put(RecordType.ORDER, orderWriter());
        writerMap.put(RecordType.PRODUCT, productWriter());
        writerMap.put(RecordType.UNKNOWN, deadLetterWriter());

        this.classifier = new ClassifierSupport<>(
            record -> writerMap.getOrDefault(record.getType(), writerMap.get(RecordType.UNKNOWN))
        );
    }

    @Override
    public void write(Chunk<? extends DataRecord> chunk) throws Exception {
        for (DataRecord record : chunk) {
            classifier.classify(record).write(new Chunk<>(record));
        }
    }
}
```

### Multi-Resource Writer

`MultiResourceItemWriter` splits output across multiple files, creating a new file when the current one reaches `itemCountLimitPerResource`. This is useful for generating partitioned output files that are easier to transfer or process downstream. Each file gets a sequential suffix (e.g., `users-1.csv`, `users-2.csv`).

```java
@Component
public class MultiResourceItemWriter {
    @Bean
    @StepScope
    public MultiResourceItemWriter<User> multiResourceWriter(
            @Value("#{jobParameters['outputDirectory']}") String directory) {
        return new MultiResourceItemWriterBuilder<User>()
            .name("multiResourceWriter")
            .resource(new FileSystemResource(directory))
            .itemCountLimitPerResource(1000)
            .delegate(userCsvWriter())
            .build();
    }

    private FlatFileItemWriter<User> userCsvWriter() {
        return new FlatFileItemWriterBuilder<User>()
            .name("userCsvWriter")
            .delimited()
            .names("id", "firstName", "lastName", "email")
            .build();
    }
}
```

## XML Processing

Spring Batch provides StAX-based XML readers and writers that process XML efficiently without loading the entire document into memory. The `StaxEventItemReader` uses an XStream or JAXB marshaller to unmarshal each fragment element. This streaming approach handles gigabytes-sized XML files.

The `StaxEventItemWriter` writes each item as an XML element wrapped in a root tag. Both reader and writer support namespaces and complex XML schemas through marshaller configuration.

```java
@Bean
public StaxEventItemReader<Product> xmlProductReader() {
    return new StaxEventItemReaderBuilder<Product>()
        .name("xmlProductReader")
        .resource(new ClassPathResource("data/products.xml"))
        .addFragmentRootElements("product")
        .unmarshaller(productMarshaller())
        .build();
}

@Bean
public StaxEventItemWriter<Product> xmlProductWriter() {
    return new StaxEventItemWriterBuilder<Product>()
        .name("xmlProductWriter")
        .resource(new FileSystemResource("output/products.xml"))
        .marshaller(productMarshaller())
        .rootTagName("products")
        .overwriteOutput(true)
        .build();
}

@Bean
public XStreamMarshaller productMarshaller() {
    XStreamMarshaller marshaller = new XStreamMarshaller();
    Map<String, Class<?>> aliases = new HashMap<>();
    aliases.put("product", Product.class);
    aliases.put("category", Category.class);
    marshaller.setAliases(aliases);
    return marshaller;
}
```

## JSON Processing

JSON processing follows the same streaming pattern as XML. `JsonItemReader` reads JSON arrays or newline-delimited JSON (JSON Lines), parsing each element with Jackson. `JsonFileItemWriter` writes the items as a JSON array.

For large JSON files, avoid reading the entire array into memory. `JsonItemReader` processes items one at a time, maintaining a cursor through the JSON stream. The underlying Jackson `JsonParser` is efficient for large documents.

```java
@Bean
public JsonItemReader<Event> jsonEventReader() {
    return new JsonItemReaderBuilder<Event>()
        .name("jsonEventReader")
        .resource(new ClassPathResource("data/events.json"))
        .jsonObjectReader(new JacksonJsonObjectReader<>(Event.class))
        .build();
}

@Bean
public JsonFileItemWriter<Event> jsonEventWriter() {
    return new JsonFileItemWriterBuilder<Event>()
        .name("jsonEventWriter")
        .resource(new FileSystemResource("output/events.json"))
        .jsonObjectMarshaller(new JacksonJsonObjectMarshaller<>())
        .build();
}
```

## Database Processing

### JPA ItemReader/Writer

For JPA-based processing, `JpaPagingItemReader` reads entities in pages. Each page issues a `SELECT` query with `LIMIT` and `OFFSET` (or equivalent). The page size should match the chunk size for consistency. The `JpaItemWriter` persists entities using the entity manager.

JPA readers are slower than JDBC readers because of the overhead of entity management (dirty checking, identity map resolution). For high-throughput batch processing with simple data, consider using `JdbcCursorItemReader` instead.

```java
@Bean
public JpaPagingItemReader<User> jpaUserReader(EntityManagerFactory emf) {
    return new JpaPagingItemReaderBuilder<User>()
        .name("jpaUserReader")
        .entityManagerFactory(emf)
        .queryString("SELECT u FROM User u WHERE u.status = 'PENDING'")
        .pageSize(100)
        .build();
}

@Bean
public JpaItemWriter<User> jpaUserWriter(EntityManagerFactory emf) {
    return new JpaItemWriterBuilder<User>()
        .entityManagerFactory(emf)
        .usePersist(true)
        .build();
}
```

## Testing Item Processing

Test processors in isolation before integrating with the full step. The `CompositeUserProcessor` test below verifies three behaviors: valid users are processed correctly, invalid emails result in null (filtered out), and enrichment transformations work (name capitalization, email domain extraction).

Testing at the processor level catches logic errors early, before they're buried in job executions. Use mocks for external dependencies (repositories, APIs) that the processor might call.

```java
@SpringBootTest
class UserItemProcessorTest {

    @Autowired
    private CompositeUserProcessor processor;

    @Test
    void shouldValidateUser() throws Exception {
        User user = new User("John", "Doe", "john@example.com");
        ProcessedUser result = processor.process(user);
        assertThat(result).isNotNull();
    }

    @Test
    void shouldRejectInvalidEmail() throws Exception {
        User user = new User("John", "Doe", "invalid-email");
        ProcessedUser result = processor.process(user);
        assertThat(result).isNull();
    }

    @Test
    void shouldEnrichUser() throws Exception {
        User user = new User("john", "doe", "John@Example.COM");
        ProcessedUser result = processor.process(user);

        assertThat(result.getFullName()).isEqualTo("John Doe");
        assertThat(result.getEmail()).isEqualTo("john@example.com");
        assertThat(result.getEmailDomain()).isEqualTo("example.com");
    }
}
```

## Best Practices

1. **Implement ItemStream** for readers/writers that need lifecycle management
2. **Use StepScope with @Value** for parameterized readers/writers
3. **Prefer existing implementations** over custom ones for standard formats
4. **Set appropriate buffer/page sizes** for database readers
5. **Implement skip listeners** to log skipped items
6. **Use composite patterns** for complex processing pipelines
7. **Test processors in isolation** before integrating with readers/writers

## Common Mistakes

### Mistake 1: Stateful Reader in Multi-Threaded Step

```java
// Wrong: Thread-unsafe reader state
@Component
public class UnsafeReader implements ItemReader<Record> {
    private int currentIndex = 0; // Shared mutable state
    private List<Record> records;

    @Override
    public Record read() {
        return currentIndex < records.size() ? records.get(currentIndex++) : null;
    }
}
```

In a multi-threaded step, multiple threads call `read()` concurrently on the same reader instance. The unsynchronized `currentIndex++` causes race conditions: two threads may read the same item, or items may be skipped. The `currentIndex` may also become corrupted due to non-atomic increment.

```java
// Correct: Thread-safe using synchronized or step scope
@Component
@StepScope
public class SafeReader implements ItemReader<Record> {
    private int currentIndex = 0;
    private List<Record> records;

    @PostConstruct
    public void init() {
        this.records = loadRecords();
    }

    @Override
    public synchronized Record read() {
        return currentIndex < records.size() ? records.get(currentIndex++) : null;
    }
}
```

### Mistake 2: Not Closing Resources

```java
// Wrong: Reader that doesn't close resources
@Component
public class LeakyReader implements ItemReader<Record> {
    private InputStream inputStream;

    public LeakyReader() throws IOException {
        this.inputStream = new FileInputStream("data.csv");
    }

    @Override
    public Record read() {
        // Read from stream
        return null;
    }
    // Never closes inputStream!
}
```

A reader that opens file handles, network connections, or database cursors must close them when processing completes. The `ItemStream` interface provides `open()`, `close()`, and `update()` lifecycle methods that Spring Batch calls automatically. Without proper cleanup, the application leaks file descriptors and eventually fails with "Too many open files".

```java
// Correct: Implement ItemStream for cleanup
@Component
public class CleanReader implements ItemReader<Record>, ItemStream {
    private InputStream inputStream;

    @Override
    public void open(ExecutionContext executionContext) throws ItemStreamException {
        try {
            this.inputStream = new FileInputStream("data.csv");
        } catch (IOException e) {
            throw new ItemStreamException("Failed to open stream", e);
        }
    }

    @Override
    public void close() throws ItemStreamException {
        if (inputStream != null) {
            try {
                inputStream.close();
            } catch (IOException e) {
                throw new ItemStreamException("Failed to close stream", e);
            }
        }
    }

    @Override
    public void update(ExecutionContext executionContext) {}

    @Override
    public Record read() {
        // Read from stream
        return null;
    }
}
```

## Summary

Spring Batch provides extensive built-in support for reading from and writing to various data sources including files, databases, XML, and JSON. Custom implementations via the ItemReader, ItemProcessor, and ItemWriter interfaces give full control over data transformation. Use composite patterns for complex processing and always manage resources properly with ItemStream.

## References

- [Spring Batch Readers/Writers](https://docs.spring.io/spring-batch/reference/readers-writers.html)
- [Flat File Processing](https://docs.spring.io/spring-batch/reference/readers-writers/flat-files.html)
- [XML Processing](https://docs.spring.io/spring-batch/reference/readers-writers/xml.html)
- [JSON Processing](https://docs.spring.io/spring-batch/reference/readers-writers/json.html)

Happy Coding
