---
title: "Factory Pattern with DI"
description: "Combining Factory pattern with dependency injection for flexible object creation in Spring Boot applications"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["factory-pattern", "dependency-injection", "spring-boot", "design-patterns"]
coverImage: "/images/factory-pattern-di.png"
draft: false
---

## Overview

The Factory pattern provides an interface for creating objects without specifying their concrete classes. When combined with Dependency Injection, factories become powerful tools for managing object creation in complex scenarios where constructor injection alone is insufficient.

This post explores how to implement factories that leverage Spring's DI container, handle dynamic object creation, and maintain clean separation of concerns.

## Simple Factory with Spring

### Without Factory

```java
@Service
public class NotificationService {

    public void send(Notification notification) {
        if ("EMAIL".equals(notification.channel())) {
            EmailSender sender = new EmailSender(
                smtpHost, smtpPort, username, password);
            sender.send(notification);
        } else if ("SMS".equals(notification.channel())) {
            SmsSender sender = new SmsSender(
                apiKey, apiSecret, fromNumber);
            sender.send(notification);
        } else if ("PUSH".equals(notification.channel())) {
            PushSender sender = new PushSender(
                firebaseApiKey, appId);
            sender.send(notification);
        }
    }
}
```

The "without factory" approach has multiple problems. First, `NotificationService` must know how to construct every sender type, including their configuration details. Second, the senders are not managed by Spring — they are created with `new` and bypass DI, so their dependencies (like database connections or API clients) must be constructed inline. Third, adding a new channel requires modifying `NotificationService`.

### Simple Factory

```java
@Component
public class NotificationSenderFactory {

    private final EmailSender emailSender;
    private final SmsSender smsSender;
    private final PushSender pushSender;

    public NotificationSenderFactory(
            EmailSender emailSender,
            SmsSender smsSender,
            PushSender pushSender) {
        this.emailSender = emailSender;
        this.smsSender = smsSender;
        this.pushSender = pushSender;
    }

    public NotificationSender getSender(NotificationChannel channel) {
        return switch (channel) {
            case EMAIL -> emailSender;
            case SMS -> smsSender;
            case PUSH -> pushSender;
        };
    }
}

public interface NotificationSender {
    NotificationChannel supportedChannel();
    void send(Notification notification);
}

@Component
public class EmailSender implements NotificationSender {
    private final JavaMailSender mailSender;

    public EmailSender(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @Override
    public NotificationChannel supportedChannel() {
        return NotificationChannel.EMAIL;
    }

    @Override
    public void send(Notification notification) {
        MimeMessage message = mailSender.createMimeMessage();
        try {
            MimeMessageHelper helper = new MimeMessageHelper(message, true);
            helper.setTo(notification.recipient());
            helper.setSubject(notification.subject());
            helper.setText(notification.body(), true);
            mailSender.send(message);
        } catch (MessagingException e) {
            throw new NotificationException("Failed to send email", e);
        }
    }
}

@Component
public class SmsSender implements NotificationSender {
    private final TwilioApiClient twilioClient;

    public SmsSender(TwilioApiClient twilioClient) {
        this.twilioClient = twilioClient;
    }

    @Override
    public NotificationChannel supportedChannel() {
        return NotificationChannel.SMS;
    }

    @Override
    public void send(Notification notification) {
        twilioClient.sendSms(notification.recipient(), notification.body());
    }
}
```

With the factory, each sender is a Spring-managed `@Component` that receives its dependencies through constructor injection. The `NotificationSenderFactory` is injected with all sender instances and delegates selection to a `switch` expression. `NotificationService` now only depends on the factory — it has no idea how senders are created or which implementations exist. Adding a new channel means creating a new `@Component` class and updating the factory's switch.

## Factory Method Pattern

When each factory method creates related families of objects:

```java
public interface DocumentExporter {
    byte[] export(Document document);
    String getFormat();
}

@Component
public class PdfExporter implements DocumentExporter {
    @Override
    public byte[] export(Document document) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            PdfWriter writer = new PdfWriter(baos);
            PdfDocument pdf = new PdfDocument(writer);
            Document pdfDoc = new Document(pdf);
            pdfDoc.add(new Paragraph(document.getTitle()));
            pdfDoc.add(new Paragraph(document.getContent()));
            pdfDoc.close();
            return baos.toByteArray();
        } catch (Exception e) {
            throw new ExportException("PDF export failed", e);
        }
    }

    @Override
    public String getFormat() { return "PDF"; }
}

@Component
public class CsvExporter implements DocumentExporter {
    @Override
    public byte[] export(Document document) {
        StringBuilder sb = new StringBuilder();
        sb.append("Title,Content\n");
        sb.append(escapeCsv(document.getTitle())).append(",");
        sb.append(escapeCsv(document.getContent())).append("\n");
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public String getFormat() { return "CSV"; }

    private String escapeCsv(String value) {
        if (value.contains(",") || value.contains("\"")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}

@Component
public class DocumentExportFactory {

    private final Map<String, DocumentExporter> exporterMap;

    public DocumentExportFactory(List<DocumentExporter> exporters) {
        this.exporterMap = exporters.stream()
            .collect(Collectors.toMap(
                DocumentExporter::getFormat,
                Function.identity()
            ));
    }

    public DocumentExporter getExporter(String format) {
        DocumentExporter exporter = exporterMap.get(format.toUpperCase());
        if (exporter == null) {
            throw new UnsupportedExportFormatException("Unsupported format: " + format);
        }
        return exporter;
    }

    public byte[] export(Document document, String format) {
        return getExporter(format).export(document);
    }

    public Set<String> getSupportedFormats() {
        return exporterMap.keySet();
    }
}
```

The `DocumentExportFactory` uses Spring's auto-collection feature — it injects a `List<DocumentExporter>` containing all beans that implement the interface. The factory builds a `Map<String, DocumentExporter>` from the list, keyed by format name. This is automatically extensible: adding a new `@Component` that implements `DocumentExporter` with a new format is enough — the factory doesn't change.

## Abstract Factory Pattern

For creating families of related objects:

```java
public interface UIFactory {
    Button createButton();
    Dialog createDialog();
    Form createForm();
}

@Component
@ConditionalOnProperty(name = "app.theme", havingValue = "modern")
public class ModernUIFactory implements UIFactory {
    @Override
    public Button createButton() {
        return new ModernButton();
    }

    @Override
    public Dialog createDialog() {
        return new ModernDialog();
    }

    @Override
    public Form createForm() {
        return new ModernForm();
    }
}

@Component
@ConditionalOnProperty(name = "app.theme", havingValue = "classic", matchIfMissing = true)
public class ClassicUIFactory implements UIFactory {
    @Override
    public Button createButton() {
        return new ClassicButton();
    }

    @Override
    public Dialog createDialog() {
        return new ClassicDialog();
    }

    @Override
    public Form createForm() {
        return new ClassicForm();
    }
}
```

The abstract factory uses `@ConditionalOnProperty` to select the active implementation at startup based on a configuration property. Only one factory is instantiated, and all UI components are guaranteed to be consistent — you won't get a modern button with a classic dialog. This is the key benefit of the Abstract Factory pattern: ensuring families of related objects are used together.

## Factory with Prototype Scope

When each created object needs its own state:

```java
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
public class ReportGenerator {
    private final ReportRepository reportRepository;
    private final String reportId;
    private ReportStatus status;

    public ReportGenerator(ReportRepository reportRepository) {
        this.reportRepository = reportRepository;
        this.reportId = UUID.randomUUID().toString();
        this.status = ReportStatus.PENDING;
    }

    public Report generate(ReportRequest request) {
        status = ReportStatus.RUNNING;
        try {
            ReportData data = reportRepository.fetchData(request);
            Report report = new Report(reportId, request.name(), data, Instant.now());
            status = ReportStatus.COMPLETED;
            return report;
        } catch (Exception e) {
            status = ReportStatus.FAILED;
            throw new ReportGenerationException("Report generation failed", e);
        }
    }

    public String getReportId() { return reportId; }
    public ReportStatus getStatus() { return status; }
}

@Component
public class ReportGeneratorFactory {

    @Autowired
    private ApplicationContext applicationContext;

    public ReportGenerator createGenerator() {
        return applicationContext.getBean(ReportGenerator.class);
    }
}

@Service
public class ReportService {

    private final ReportGeneratorFactory factory;

    public ReportService(ReportGeneratorFactory factory) {
        this.factory = factory;
    }

    public Report generateReport(ReportRequest request) {
        ReportGenerator generator = factory.createGenerator();
        return generator.generate(request);
    }
}
```

Singleton beans share state across all callers, which is dangerous for `ReportGenerator` since it maintains per-request state (report ID, status). Marking it as `@Scope("prototype")` ensures each `getBean()` call returns a new instance. The factory uses `ApplicationContext.getBean()` because Spring cannot inject prototype beans directly into singletons — the factory mediates this by calling the application context each time.

## Factory with Dynamic Implementation Selection

```java
@Component
public class DataSourceFactory {

    private final Map<String, DataSourceProvider> providerMap;

    public DataSourceFactory(List<DataSourceProvider> providers) {
        this.providerMap = providers.stream()
            .collect(Collectors.toMap(
                DataSourceProvider::getType,
                Function.identity()
            ));
    }

    public DataSource createDataSource(DataSourceConfig config) {
        DataSourceProvider provider = providerMap.get(config.type());
        if (provider == null) {
            throw new IllegalArgumentException("Unknown data source type: " + config.type());
        }
        return provider.createDataSource(config);
    }
}

public interface DataSourceProvider {
    String getType();
    DataSource createDataSource(DataSourceConfig config);
}

@Component
public class PostgresDataSourceProvider implements DataSourceProvider {
    @Override
    public String getType() { return "POSTGRES"; }

    @Override
    public DataSource createDataSource(DataSourceConfig config) {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(config.url());
        ds.setUser(config.username());
        ds.setPassword(config.password());
        ds.setPoolSize(config.poolSize());
        return ds;
    }
}

@Component
public class MySqlDataSourceProvider implements DataSourceProvider {
    @Override
    public String getType() { return "MYSQL"; }

    @Override
    public DataSource createDataSource(DataSourceConfig config) {
        MysqlDataSource ds = new MysqlDataSource();
        ds.setUrl(config.url());
        ds.setUser(config.username());
        ds.setPassword(config.password());
        return ds;
    }
}

@Component
public class H2DataSourceProvider implements DataSourceProvider {
    @Override
    public String getType() { return "H2"; }

    @Override
    public DataSource createDataSource(DataSourceConfig config) {
        return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2)
            .setName(config.databaseName())
            .build();
    }
}
```

The `DataSourceFactory` dynamically selects the database provider based on configuration. Each `DataSourceProvider` handles the nuances of its specific database — Postgres uses `PGSimpleDataSource`, MySQL uses `MysqlDataSource`, H2 uses Spring's `EmbeddedDatabaseBuilder`. Adding support for a new database (e.g., Oracle) requires only a new `@Component` class.

## Testing Factory Pattern

```java
@SpringBootTest
class NotificationSenderFactoryTest {

    @Autowired
    private NotificationSenderFactory factory;

    @Test
    void shouldReturnEmailSenderForEmailChannel() {
        NotificationSender sender = factory.getSender(NotificationChannel.EMAIL);
        assertThat(sender).isInstanceOf(EmailSender.class);
    }

    @Test
    void shouldReturnSmsSenderForSmsChannel() {
        NotificationSender sender = factory.getSender(NotificationChannel.SMS);
        assertThat(sender).isInstanceOf(SmsSender.class);
    }

    @Test
    void shouldSendEmailNotification() {
        NotificationSender sender = factory.getSender(NotificationChannel.EMAIL);
        Notification notification = new Notification(
            "test@example.com", "Subject", "Body", NotificationChannel.EMAIL);
        assertThatCode(() -> sender.send(notification))
            .doesNotThrowAnyException();
    }
}
```

Testing the factory validates both the selection logic and that all expected implementations are registered. The `@SpringBootTest` loads the full context and verifies that Spring correctly discovers and wires all `NotificationSender` beans.

## Common Mistakes

### Factory Creating New Instances in Singleton

```java
// Wrong: Creating new instances manually defeats DI
@Component
public class BadFactory {
    public NotificationSender create(NotificationChannel channel) {
        return switch (channel) {
            case EMAIL -> new EmailSender(new JavaMailSenderImpl()); // Not managed by Spring
            case SMS -> new SmsSender(new TwilioApiClient()); // Not managed by Spring
        };
    }
}
```

```java
// Correct: Using injected beans or ApplicationContext
@Component
public class GoodFactory {
    private final Map<NotificationChannel, NotificationSender> senders;

    public GoodFactory(List<NotificationSender> senderList) {
        this.senders = senderList.stream()
            .collect(Collectors.toMap(
                NotificationSender::supportedChannel,
                Function.identity()
            ));
    }
}
```

Using `new` inside a factory defeats DI because the created objects are not managed by Spring. Their dependencies (like `JavaMailSenderImpl`, `TwilioApiClient`) won't be injected, and features like AOP, `@Transactional`, and `@Async` won't work. The fix is to inject existing Spring beans rather than creating new instances.

### Complex Factory Logic in Business Code

```java
// Wrong: Factory selection logic scattered in services
@Service
public class OrderService {
    public void processOrder(Order order) {
        NotificationSender sender;
        if (order.isUrgent()) {
            sender = new SmsSender(...);
        } else if (order.isInternational()) {
            sender = new EmailSender(...);
        } else {
            sender = new PushSender(...);
        }
        sender.send(new Notification(order));
    }
}
```

## Best Practices

1. Use factory pattern when construction logic is complex or needs to be centralized.
2. Let Spring manage the lifecycle of created objects where possible.
3. Use `ApplicationContext.getBean()` for prototype-scoped beans.
4. Keep factory interfaces simple with a single creation method.
5. Register implementations automatically through component scanning.
6. Combine Factory with Strategy when selection criteria are complex.
7. Test factory selection logic independently of the created objects.

## Summary

The Factory pattern and Dependency Injection complement each other in Spring Boot. Factories handle complex or dynamic object creation, while DI manages dependencies and lifecycle. Use simple factory for straightforward selection, factory method for related product families, and abstract factory for creating families of related objects.

## References

- Gamma, E. et al. "Design Patterns: Elements of Reusable Object-Oriented Software"
- Spring Framework Documentation: "Bean Scopes"
- Fowler, M. "Inversion of Control Containers and the Dependency Injection pattern"

Happy Coding
