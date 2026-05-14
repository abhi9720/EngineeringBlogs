---
title: "JMeter Basics"
description: "Getting started with Apache JMeter: test plans, thread groups, samplers, assertions, listeners, and backend integration"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - jmeter
  - performance-testing
  - load-testing
  - testing
coverImage: "/images/jmeter-basics.png"
draft: false
---

# Apache JMeter: Performance Testing

## Overview

Apache JMeter is an open-source performance testing tool for measuring and analyzing system behavior under load. It supports HTTP, JDBC, JMS, and many other protocols. This guide covers creating test plans, defining thread groups, using samplers and assertions, and integrating with CI/CD.

---

## Core Concepts

```
Test Plan
 └── Thread Group (User Simulation)
      ├── Config Elements (Defaults, Auth, Headers)
      ├── Pre-Processors
      ├── Samplers (HTTP Request, JDBC, etc.)
      ├── Post-Processors (Extractors)
      ├── Assertions (Response Validation)
      └── Listeners (Results, Reports)
```

---

## Creating a Basic Test Plan

### 1. Thread Group

Configuration for simulating virtual users:

```xml
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="API Load Test">
    <intProp name="ThreadGroup.num_threads">100</intProp>        <!-- 100 users -->
    <intProp name="ThreadGroup.ramp_time">30</intProp>          <!-- 30s ramp-up -->
    <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
    <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
    <elementProp name="ThreadGroup.main_controller" elementType="LoopController">
        <intProp name="LoopController.loops">10</intProp>       <!-- 10 iterations -->
        <boolProp name="LoopController.forever">false</boolProp>
    </elementProp>
</ThreadGroup>
```

### 2. HTTP Request Defaults

```xml
<ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement">
    <stringProp name="HTTPSampler.domain">api.example.com</stringProp>
    <stringProp name="HTTPSampler.port">443</stringProp>
    <stringProp name="HTTPSampler.protocol">https</stringProp>
    <stringProp name="HTTPSampler.contentEncoding">UTF-8</stringProp>
    <stringProp name="HTTPSampler.path">/api/v1</stringProp>
</ConfigTestElement>
```

### 3. HTTP Request Sampler

```xml
<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy"
    testname="GET /api/users">
    <stringProp name="HTTPSampler.domain"></stringProp>           <!-- Uses defaults -->
    <stringProp name="HTTPSampler.path">/users/123</stringProp>
    <stringProp name="HTTPSampler.method">GET</stringProp>
    <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
        <collectionProp name="Arguments.arguments">
            <elementProp name="Authorization" elementType="HTTPArgument">
                <stringProp name="Argument.value">Bearer ${accessToken}</stringProp>
                <stringProp name="Argument.meta">=</stringProp>
            </elementProp>
        </collectionProp>
    </elementProp>
</HTTPSamplerProxy>
```

### 4. JSON Extractor (Post-Processor)

Extract values from response for chaining:

```xml
<PostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor"
    testname="Extract User ID">
    <stringProp name="JSONPostProcessor.referenceNames">userId</stringProp>
    <stringProp name="JSONPostProcessor.jsonPathExprs">$.id</stringProp>
    <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
</PostProcessor>

<!-- Usage in subsequent request: ${userId} -->
```

### 5. Response Assertion

```xml
<Assertion guiclass="AssertionGui" testclass="ResponseAssertion"
    testname="Validate Response">
    <collectionProp name="Asserion.test_strings">
        <stringProp name="-1773966551">"status": "SUCCESS"</stringProp>
    </collectionProp>
    <stringProp name="Assertion.test_field">ASSERTION_TEXT_RESPONSE</stringProp>
    <intProp name="Assertion.assume_success">false</intProp>
</Assertion>

<!-- Also check HTTP status -->
<Assertion guiclass="AssertionGui" testclass="ResponseAssertion"
    testname="Validate Status Code">
    <collectionProp name="Asserion.test_strings">
        <stringProp name="-1773966551">200</stringProp>
        <stringProp name="-1773966551">201</stringProp>
    </collectionProp>
    <stringProp name="Assertion.test_field">ASSERTION_RESPONSE_CODE</stringProp>
</Assertion>
```

---

## JMeter Test Plan in Java (using JMeter API)

```java
public class JMeterTestPlanGenerator {

    public static void main(String[] args) {
        // Create Test Plan
        TestPlan testPlan = new TestPlan("Order Service Load Test");
        testPlan.setProperty(TestElement.TEST_CLASS, TestPlan.class.getName());
        testPlan.setProperty(TestElement.GUI_CLASS, TestPlanGui.class.getName());

        // Create Thread Group
        ThreadGroup threadGroup = new ThreadGroup();
        threadGroup.setName("Order API Users");
        threadGroup.setNumThreads(50);
        threadGroup.setRampUp(20);
        threadGroup.setProperty(ThreadGroup.LOOP_CONTROLLER,
            new LoopController() {{
                setLoops(5);
                setContinueForever(false);
            }}
        );

        // HTTP Request Defaults
        Arguments defaults = new Arguments();
        defaults.addArgument("HTTPSampler.domain", "localhost");
        defaults.addArgument("HTTPSampler.port", "8080");
        defaults.addArgument("HTTPSampler.protocol", "http");

        // HTTP Request to create order
        HTTPSamplerProxy createOrder = new HTTPSamplerProxy();
        createOrder.setName("POST /api/orders");
        createOrder.setMethod("POST");
        createOrder.setPath("/api/orders");
        createOrder.addArgument("Content-Type", "application/json");
        createOrder.setPostBodyRaw(true);
        createOrder.addNonEncodedArgument("",
            """
            {
                "customerId": "cust-${__threadNum}",
                "items": [
                    {"sku": "ITEM-001", "quantity": 2, "price": 25.00}
                ]
            }
            """, "");

        // JSON Extractor for orderId
        JSONPostProcessor jsonExtractor = new JSONPostProcessor();
        jsonExtractor.setReferenceNames("orderId");
        jsonExtractor.setJsonPathExpressions("$.orderId");
        jsonExtractor.setMatchNumbers(1);

        // Response Assertion
        ResponseAssertion assertion = new ResponseAssertion();
        assertion.setTestFieldResponseCode();
        assertion.addTestString("201");

        // Summary Report
        Summariser summariser = new Summariser();
        SummaryReport report = new SummaryReport();

        // Assemble test plan elements into tree
        SetupThreadGroup setup = new SetupThreadGroup();
        setup.setName("Setup");
        setup.setNumThreads(1);
        setup.setRampUp(1);
        setup.setLoops(1);

        HashTree testPlanTree = new HashTree();
        testPlanTree.add(testPlan);
        HashTree threadGroupHash = testPlanTree.add(testPlan, threadGroup);
        threadGroupHash.add(defaults);
        threadGroupHash.add(createOrder);
        threadGroupHash.add(jsonExtractor);
        threadGroupHash.add(assertion);
        threadGroupHash.add(report);
        threadGroupHash.add(summariser);

        // Run the test
        StandardJMeterEngine engine = new StandardJMeterEngine();
        engine.configure(testPlanTree);

        System.out.println("Starting load test...");
        engine.run();
        System.out.println("Load test completed.");
    }
}
```

---

## JMeter Command Line Execution

```bash
# Run test in non-GUI mode (must faster)
jmeter -n -t order-service-test.jmx -l results.jtl

# Run with test parameters
jmeter -n -t test-plan.jmx \
    -Jusers=100 \
    -Jrampup=30 \
    -Jduration=300 \
    -Jhost=api.example.com \
    -Jport=443 \
    -l results.jtl \
    -e -o /reports/html/

# Generate HTML report from saved results
jmeter -g results.jtl -o /reports/html/
```

### Parameterized Test Plan

```xml
<!-- Use __P() function to parameterize -->
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Load Test">
    <intProp name="ThreadGroup.num_threads">${__P(users,100)}</intProp>
    <intProp name="ThreadGroup.ramp_time">${__P(rampup,30)}</intProp>
</ThreadGroup>

<DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion"
    testname="Response Time Assertion">
    <stringProp name="DurationAssertion.duration">${__P(maxResponseTime,2000)}</stringProp>
</DurationAssertion>
```

---

## Assertions

```java
// Response Assertion - check response body contains string
ResponseAssertion bodyAssertion = new ResponseAssertion();
bodyAssertion.setTestFieldResponseDataAsString();
bodyAssertion.addTestString("transactionId");
bodyAssertion.setAssumeSuccess(false);

// Duration Assertion - fail if response takes too long
DurationAssertion durationAssertion = new DurationAssertion();
durationAssertion.setAllowedDuration(2000L);  // 2 seconds max

// Size Assertion - verify response size
SizeAssertion sizeAssertion = new SizeAssertion();
sizeAssertion.setAllowedSize(1024);
sizeAssertion.setSizeField(SizeAssertion.SizeField.RESPONSE_SIZE);
sizeAssertion.setOperator(SizeAssertion.Operator.LESS_THAN);

// JSON Assertion - validate JSON structure
JSONAssertion jsonAssertion = new JSONAssertion();
jsonAssertion.setJsonPath("$.status");
jsonAssertion.setExpectedValue("COMPLETED");
jsonAssertion.setJsonValidationBool(true);
```

---

## Listeners

```xml
<!-- Aggregate Report -->
<ResultCollector guiclass="StatGraphVisualizer" testclass="SummaryReport" ...>
</ResultCollector>

<!-- Graph Results -->
<ResultCollector guiclass="GraphVisualizer" testclass="GraphResultCollector" ...>
</ResultCollector>

<!-- Save Responses to File (for debugging) -->
<ResultCollector guiclass="SaveGraphVisualizer" testclass="SaveResponses" ...>
    <stringProp name="FileExtension">json</stringProp>
</ResultCollector>

<!-- Backend Listener (send results to InfluxDB) -->
<BackendListener guiclass="BackendListenerGui" testclass="BackendListener">
    <elementProp name="arguments" elementType="Arguments">
        <stringProp name="influxdbMetricsSender">org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient</stringProp>
        <stringProp name="influxdbUrl">http://localhost:8086/write?db=jmeter</stringProp>
        <stringProp name="application">order-service</stringProp>
        <stringProp name="measurement">jmeter</stringProp>
        <stringProp name="summaryOnly">false</stringProp>
    </elementProp>
</BackendListener>
```

---

## Best Practices

1. **Run in non-GUI mode** for actual load tests (GUI mode is for test development)
2. **Use CSV Data Set Config** for parameterized test data
3. **Add think time** with `Test Action` sampler to simulate real user behavior
4. **Enable assertion** to validate responses under load
5. **Avoid listeners during load tests** (they consume memory)
6. **Use distributed testing** for high load tests
7. **Monitor server metrics** alongside JMeter metrics (CPU, memory, DB connections)

---

## Common Mistakes

### Mistake 1: Running Large Tests in GUI Mode

```
# WRONG: GUI mode consumes significant resources
jmeter -t test-plan.jmx  # GUI mode

# CORRECT: Use non-GUI mode for actual tests
jmeter -n -t test-plan.jmx -l results.jtl
```

### Mistake 2: Too Few Assertions

```
# WRONG: No assertions - test passes even if API returns errors
# 100% success rate even with 500 errors!

# CORRECT: Assert both status code and response body
- Response Assertion: 200/201 status
- JSON Assertion: validate response structure
- Duration Assertion: max response time
```

### Mistake 3: Not Closing Connections

```java
// WRONG: Not managing connections
HTTPClient httpClient = new HTTPClient();
// No connection pooling or reuse

// CORRECT: Use HTTP Request Defaults with connection config
ConfigTestElement defaults = new ConfigTestElement();
defaults.setProperty("HTTPSampler.connect_timeout", "5000");
defaults.setProperty("HTTPSampler.response_timeout", "30000");
```

---

## Summary

JMeter provides a comprehensive platform for performance testing. Create test plans with Thread Groups for user simulation, Samplers for API calls, Assertions for response validation, and Listeners for results collection. Run in non-GUI mode for actual load tests, use parameterization for flexibility, and integrate with CI/CD for continuous performance testing.

---

## References

- [Apache JMeter Documentation](https://jmeter.apache.org/usermanual/index.html)
- [JMeter Best Practices](https://jmeter.apache.org/usermanual/best-practices.html)
- [JMeter Component Reference](https://jmeter.apache.org/usermanual/component_reference.html)
- [Baeldung - JMeter Guide](https://www.baeldung.com/jmeter)

Happy Coding