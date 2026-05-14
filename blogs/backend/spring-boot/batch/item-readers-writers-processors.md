---
title: "Item Readers, Writers, and Processors in Spring Batch"
description: "Comprehensive guide to Spring Batch item processing: built-in readers/writers, custom implementations, composite processors, and multi-file processing"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - spring-boot
  - spring-batch
  - item-reader
  - item-writer
coverImage: "/images/item-readers-writers-processors.png"
draft: false
---

## Overview

ItemReader, ItemProcessor, and ItemWriter are the three core interfaces in Spring Batch's chunk-oriented processing. Spring Batch provides numerous built-in implementations for reading from and writing to various data sources. This guide covers custom implementations, composite patterns, and advanced techniques.

## ItemReader Implementations

### Custom ItemReader

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