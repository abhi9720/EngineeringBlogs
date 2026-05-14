---
title: "Camunda BPMN Workflow Engine"
description: "Business process automation with Camunda: BPMN 2.0, decision tables, process orchestration, and Spring integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags: ["camunda", "bpmn", "workflows", "process-automation"]
coverImage: "/images/camunda-bpmn.png"
draft: false
---

## Overview

Camunda is an open-source workflow and decision automation platform based on BPMN 2.0 (Business Process Model and Notation). It allows developers and business analysts to design, execute, and monitor business processes using a graphical notation that is both human-readable and machine-executable.

Camunda integrates tightly with Spring Boot, supports human tasks, decision tables (DMN), and complex process orchestration patterns. Unlike Temporal or state machines, Camunda's BPMN models are visual and can be modified by non-developers through the Modeler tool.

## Core Concepts

### BPMN Process

A BPMN diagram defines the flow of activities, events, and gateways in a business process.

### Process Engine

The engine executes BPMN models, manages process instances, and maintains state.

### Service Task

A task that calls a service or application logic.

### User Task

A task assigned to a human user.

### Gateway

Controls the flow of execution (exclusive, parallel, inclusive).

## Setting Up Camunda

### Dependencies

```xml
<dependency>
    <groupId>org.camunda.bpm.springboot</groupId>
    <artifactId>camunda-bpm-spring-boot-starter</artifactId>
    <version>7.19.0</version>
</dependency>
<dependency>
    <groupId>org.camunda.bpm.springboot</groupId>
    <artifactId>camunda-bpm-spring-boot-starter-rest</artifactId>
    <version>7.19.0</version>
</dependency>
<dependency>
    <groupId>org.camunda.bpm.springboot</groupId>
    <artifactId>camunda-bpm-spring-boot-starter-webapp</artifactId>
    <version>7.19.0</version>
</dependency>
```

### Configuration

```yaml
camunda:
  bpm:
    database:
      type: postgres
      schema-update: true
    history-level: full
    auto-deployment-enabled: true
    deployment-resource-pattern:
      - classpath:processes/*.bpmn
    admin-user:
      id: admin
      password: admin
      first-name: Admin
    filter:
      create: All tasks
```

## Defining a Process in Code (Java Delegate)

### Service Task Delegate

```java
// Java Delegate implementation
@Component
public class ValidateOrderDelegate implements JavaDelegate {

    private final OrderValidationService validationService;

    public ValidateOrderDelegate(OrderValidationService validationService) {
        this.validationService = validationService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String orderId = (String) execution.getVariable("orderId");
        log.info("Validating order: {}", orderId);

        ValidationResult result = validationService.validate(orderId);
        execution.setVariable("orderValid", result.isValid());
        execution.setVariable("validationError", result.getErrorMessage());

        if (!result.isValid()) {
            log.warn("Order validation failed: {}", result.getErrorMessage());
        }
    }
}

@Component
public class ProcessPaymentDelegate implements JavaDelegate {

    private final PaymentService paymentService;

    public ProcessPaymentDelegate(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String orderId = (String) execution.getVariable("orderId");
        Double amount = (Double) execution.getVariable("totalAmount");
        String customerId = (String) execution.getVariable("customerId");

        log.info("Processing payment for order {}: {}", orderId, amount);
        PaymentResult result = paymentService.charge(customerId, amount);

        execution.setVariable("paymentSuccess", result.isSuccess());
        execution.setVariable("transactionId", result.getTransactionId());

        if (!result.isSuccess()) {
            throw new BpmnError("PAYMENT_FAILED", "Payment processing failed");
        }
    }
}

@Component
public class ReserveInventoryDelegate implements JavaDelegate {

    private final InventoryService inventoryService;

    public ReserveInventoryDelegate(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String orderId = (String) execution.getVariable("orderId");
        log.info("Reserving inventory for order: {}", orderId);

        inventoryService.reserve(orderId);
        execution.setVariable("inventoryReserved", true);
    }
}

@Component
public class ReleaseInventoryDelegate implements JavaDelegate {

    private final InventoryService inventoryService;

    public ReleaseInventoryDelegate(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String orderId = (String) execution.getVariable("orderId");
        log.info("Releasing inventory for order: {}", orderId);

        inventoryService.release(orderId);
        execution.setVariable("inventoryReleased", true);
    }
}
```

### Delegate with Process Variables

```java
@Component
public class SendNotificationDelegate implements JavaDelegate {

    private final NotificationService notificationService;

    public SendNotificationDelegate(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String orderId = (String) execution.getVariable("orderId");
        String customerEmail = (String) execution.getVariable("customerEmail");
        boolean orderValid = (Boolean) execution.getVariable("orderValid");
        boolean paymentSuccess = (Boolean) execution.getVariable("paymentSuccess");

        String notificationType;
        if (paymentSuccess) {
            notificationType = "CONFIRMATION";
        } else if (!orderValid) {
            notificationType = "REJECTION";
        } else {
            notificationType = "FAILURE";
        }

        notificationService.send(customerEmail, notificationType, Map.of(
            "orderId", orderId,
            "status", notificationType
        ));

        execution.setVariable("notificationSent", true);
    }
}
```

## Expression-Based Service Tasks

### Using Spring Beans in BPMN

```java
@Component("orderExpressionService")
public class OrderExpressionService {

    public boolean isHighValueOrder(DelegateExecution execution) {
        Double amount = (Double) execution.getVariable("totalAmount");
        return amount != null && amount > 10000;
    }

    public boolean isInternationalOrder(DelegateExecution execution) {
        String country = (String) execution.getVariable("shippingCountry");
        return country != null && !"US".equals(country);
    }

    public String determineShippingMethod(DelegateExecution execution) {
        if (isHighValueOrder(execution) || isInternationalOrder(execution)) {
            return "EXPRESS";
        }
        return "STANDARD";
    }
}
```

### DMN Decision Table

```java
@Component
public class DMNService {

    private final DecisionEngine decisionEngine;

    public DMNService(DecisionEngine decisionEngine) {
        this.decisionEngine = decisionEngine;
    }

    public String evaluatePricing(DmnDecision decision, Map<String, Object> variables) {
        DmnDecisionResult result = decisionEngine.evaluateDecision(decision, variables);
        return result.getSingleResult().getSingleEntry().toString();
    }
}
```

## Starting Process Instances

```java
@Component
public class ProcessStarter {

    private final RuntimeService runtimeService;

    public ProcessStarter(RuntimeService runtimeService) {
        this.runtimeService = runtimeService;
    }

    public void startOrderProcess(OrderRequest request) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("orderId", request.getOrderId());
        variables.put("customerId", request.getCustomerId());
        variables.put("customerEmail", request.getCustomerEmail());
        variables.put("totalAmount", request.getTotalAmount());
        variables.put("items", request.getItems());
        variables.put("shippingAddress", request.getShippingAddress());
        variables.put("shippingCountry", request.getShippingCountry());
        variables.put("orderValid", null);
        variables.put("paymentSuccess", null);
        variables.put("inventoryReserved", false);

        ProcessInstance processInstance = runtimeService
            .startProcessInstanceByKey("orderProcess", variables);

        log.info("Started process instance: {} for order: {}",
            processInstance.getId(), request.getOrderId());
    }
}
```

## Human Tasks (User Tasks)

```java
@Component
public class HumanTaskService {

    private final TaskService taskService;

    public HumanTaskService(TaskService taskService) {
        this.taskService = taskService;
    }

    public List<TaskDto> getPendingTasks(String assignee) {
        return taskService.createTaskQuery()
            .taskAssignee(assignee)
            .active()
            .list()
            .stream()
            .map(this::toDto)
            .toList();
    }

    public void claimTask(String taskId, String userId) {
        taskService.claim(taskId, userId);
    }

    public void completeTask(String taskId, Map<String, Object> variables) {
        taskService.complete(taskId, variables);
        log.info("Task {} completed with variables: {}", taskId, variables);
    }

    public void completeApprovalTask(String taskId, boolean approved, String reviewer) {
        Map<String, Object> variables = Map.of(
            "approved", approved,
            "reviewer", reviewer,
            "reviewedAt", Instant.now().toString()
        );
        taskService.complete(taskId, variables);
        log.info("Approval task {} completed by {}: approved={}",
            taskId, reviewer, approved);
    }

    private TaskDto toDto(Task task) {
        return new TaskDto(
            task.getId(),
            task.getName(),
            task.getAssignee(),
            task.getCreateTime().toInstant(),
            task.getProcessInstanceId(),
            taskService.getVariables(task.getId())
        );
    }
}
```

## Process Monitoring

```java
@Component
public class ProcessMonitor {

    private final RuntimeService runtimeService;
    private final HistoryService historyService;
    private final ManagementService managementService;

    public ProcessMonitor(
            RuntimeService runtimeService,
            HistoryService historyService,
            ManagementService managementService) {
        this.runtimeService = runtimeService;
        this.historyService = historyService;
        this.managementService = managementService;
    }

    public ProcessStats getProcessStats() {
        long runningInstances = runtimeService.createProcessInstanceQuery()
            .active()
            .count();

        long completedInstances = historyService.createHistoricProcessInstanceQuery()
            .finished()
            .count();

        long failedInstances = historyService.createHistoricProcessInstanceQuery()
            .finished()
            .withFailure()
            .count();

        List<Incident> incidents = runtimeService.createIncidentQuery()
            .list();

        return new ProcessStats(runningInstances, completedInstances,
            failedInstances, incidents.size());
    }

    public List<ProcessInstanceDto> getRunningProcesses() {
        return runtimeService.createProcessInstanceQuery()
            .active()
            .list()
            .stream()
            .map(pi -> new ProcessInstanceDto(
                pi.getId(),
                pi.getProcessDefinitionId(),
                pi.getBusinessKey(),
                runtimeService.getVariables(pi.getId())
            ))
            .toList();
    }

    public void handleIncident(String incidentId) {
        Incident incident = runtimeService.createIncidentQuery()
            .incidentId(incidentId)
            .singleResult();

        if (incident != null) {
            log.warn("Handling incident {} for process {}: {}",
                incidentId, incident.getProcessInstanceId(), incident.getIncidentMessage());
            managementService.setJobRetries(incident.getConfiguration(), 3);
        }
    }

    public record ProcessStats(
        long running, long completed, long failed, long incidents) {}

    public record ProcessInstanceDto(
        String id, String processDefinitionId, String businessKey,
        Map<String, Object> variables) {}
}
```

## Common Mistakes

### Mixing Business Logic in BPMN Expressions

```java
// Wrong: Complex logic in BPMN expression
// In Modeler: ${orderService.processPayment(customerId, amount) and 
//            orderService.updateInventory(orderId) and 
//            orderService.sendNotification(email)}

// Correct: Delegate handles complexity
@Component
public class ProcessOrderDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        // All complex logic here
        String orderId = (String) execution.getVariable("orderId");
        processOrder(orderId);
    }
}
```

### Not Handling Process Errors

```java
// Wrong: Unhandled exception in delegate
@Component
public class PaymentDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
        paymentService.charge(execution.getVariable("orderId"));
        // If this throws, process instance fails without cleanup
    }
}
```

```java
// Correct: Error handling with BPMN error boundary events
@Component
public class PaymentDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) throws BpmnError {
        try {
            paymentService.charge(execution.getVariable("orderId"));
        } catch (PaymentException e) {
            throw new BpmnError("PAYMENT_FAILED", e.getMessage());
        }
    }
}
```

## Best Practices

1. Keep Java Delegates simple and focused on a single task.
2. Use process variables for data flow between tasks.
3. Implement compensation handlers for rollback scenarios.
4. Use BPMN error events for expected failure scenarios.
5. Monitor process instance states and incidents.
6. Version BPMN diagrams for backward compatibility.
7. Use DMN for complex business rules that may change frequently.
8. Configure appropriate history levels for auditing.

## Summary

Camunda provides a complete workflow automation platform based on BPMN 2.0. Its visual modeling, human task support, and DMN integration make it suitable for business process automation where non-developers need to understand and modify process flows. Camunda's Spring Boot integration makes it straightforward to embed the process engine in Java applications.

## References

- Camunda BPMN 2.0 Reference
- "Camunda BPMN: Workflow Automation" by Camunda Docs
- BPMN 2.0 Specification by OMG

Happy Coding