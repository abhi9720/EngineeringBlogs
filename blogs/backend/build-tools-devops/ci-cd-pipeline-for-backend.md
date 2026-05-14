---
title: "CI/CD Pipeline for Backend Applications"
description: "Design comprehensive CI/CD pipelines for backend applications: build, test, security scan, containerize, and deploy to Kubernetes"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - ci-cd
  - github-actions
  - jenkins
  - devops
  - deployment
coverImage: "/images/ci-cd-pipeline-for-backend.png"
draft: false
---

# CI/CD Pipeline for Backend Applications

## Overview

A well-designed CI/CD pipeline is critical for backend applications. It automates building, testing, security scanning, containerization, and deployment. This guide covers pipeline architecture with GitHub Actions and Jenkins, including stage design, quality gates, container builds, and deployment strategies for Kubernetes.

---

## Pipeline Architecture

### Key Stages

```yaml
# Pipeline stages overview
stages:
  1. Code Checkout
  2. Dependency Resolution
  3. Code Quality Analysis
  4. Unit Tests
  5. Integration Tests
  6. Security Scan
  7. Build Artifacts
  8. Container Build
  9. Staging Deployment
  10. Smoke Tests
  11. Production Deployment (approval gate)
  12. Post-Deployment Verification
```

### Quality Gates

```java
// Quality gate enforcement in CI
public class QualityGateValidator {

    private static final int MIN_TEST_COVERAGE = 80;
    private static final int MAX_CRITICAL_ISSUES = 0;
    private static final int MAX_MAJOR_ISSUES = 10;
    private static final int MAX_VULNERABILITIES = 0;

    public static boolean isPassing(QualityGateReport report) {
        boolean coveragePass = report.getLineCoverage() >= MIN_TEST_COVERAGE;
        boolean criticalPass = report.getCriticalIssues() <= MAX_CRITICAL_ISSUES;
        boolean majorPass = report.getMajorIssues() <= MAX_MAJOR_ISSUES;
        boolean vulnPass = report.getVulnerabilities() <= MAX_VULNERABILITIES;

        log.info("Quality Gate: Coverage={}%, Critical={}, Major={}, Vulnerabilities={}",
            report.getLineCoverage(), report.getCriticalIssues(),
            report.getMajorIssues(), report.getVulnerabilities());

        return coveragePass && criticalPass && majorPass && vulnPass;
    }
}
```

---

## GitHub Actions Pipeline

### Full CI/CD Workflow

```yaml
# .github/workflows/backend-pipeline.yml
name: Backend CI/CD Pipeline

on:
  push:
    branches: [main, develop]
    paths-ignore:
      - "**.md"
      - ".gitignore"
      - "docs/**"
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

env:
  JAVA_VERSION: "21"
  JVM_DISTRIBUTION: "temurin"
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ========== VALIDATION ==========
  validate:
    name: Code Validation
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK ${{ env.JAVA_VERSION }}
        uses: actions/setup-java@v4
        with:
          java-version: ${{ env.JAVA_VERSION }}
          distribution: ${{ env.JVM_DISTRIBUTION }}
          cache: maven

      - name: Code Style Check
        run: mvn checkstyle:check -B

      - name: Dependency Check
        run: mvn dependency:analyze -B

      - name: Build with Tests
        run: mvn verify -B

      - name: Test Report
        uses: dorny/test-reporter@v1
        if: success() || failure()
        with:
          name: Maven Tests
          path: "**/target/surefire-reports/TEST-*.xml"
          reporter: java-junit

  # ========== QUALITY ANALYSIS ==========
  quality:
    name: Code Quality
    runs-on: ubuntu-latest
    needs: [validate]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up JDK ${{ env.JAVA_VERSION }}
        uses: actions/setup-java@v4
        with:
          java-version: ${{ env.JAVA_VERSION }}
          distribution: ${{ env.JVM_DISTRIBUTION }}
          cache: maven

      - name: SonarCloud Scan
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        run: mvn sonar:sonar -B \
          -Dsonar.projectKey=${{ github.repository_owner }}_${{ github.event.repository.name }} \
          -Dsonar.organization=${{ github.repository_owner }} \
          -Dsonar.host.url=https://sonarcloud.io \
          -Dsonar.coverage.jacoco.xmlReportPaths=**/target/site/jacoco/jacoco.xml

      - name: Check Quality Gate
        run: |
          curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=${{ github.repository_owner }}_${{ github.event.repository.name }}" \
            -o quality-gate.json
          STATUS=$(jq -r '.projectStatus.status' quality-gate.json)
          if [ "$STATUS" != "OK" ]; then
            echo "Quality gate failed: $STATUS"
            exit 1
          fi
          echo "Quality gate passed!"

  # ========== SECURITY SCAN ==========
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    needs: [validate]
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK ${{ env.JAVA_VERSION }}
        uses: actions/setup-java@v4
        with:
          java-version: ${{ env.JAVA_VERSION }}
          distribution: ${{ env.JVM_DISTRIBUTION }}
          cache: maven

      - name: OWASP Dependency Check
        run: mvn org.owasp:dependency-check-maven:check -B
        continue-on-error: true

      - name: Trivy Vulnerability Scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH

      - name: Upload Trivy Results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif

      - name: Secret Scanning
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # ========== BUILD & CONTAINERIZE ==========
  build-container:
    name: Build and Containerize
    runs-on: ubuntu-latest
    needs: [validate, quality, security]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    outputs:
      image-tag: ${{ steps.image-tag.outputs.tag }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK ${{ env.JAVA_VERSION }}
        uses: actions/setup-java@v4
        with:
          java-version: ${{ env.JAVA_VERSION }}
          distribution: ${{ env.JVM_DISTRIBUTION }}
          cache: maven

      - name: Build Artifact
        run: mvn package -DskipTests -B

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Image Tag
        id: image-tag
        run: |
          SHORT_SHA=$(echo ${{ github.sha }} | cut -c1-7)
          echo "tag=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${SHORT_SHA}" >> $GITHUB_OUTPUT
          echo "tag=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest" >> $GITHUB_OUTPUT

      - name: Build and Push Docker Image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ========== DEPLOYMENT ==========
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: [build-container]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment:
      name: staging
      url: https://staging.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/setup-kubectl@v3

      - name: Set Kubernetes Context
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG_STAGING }}

      - name: Update Kubernetes Manifests
        run: |
          sed -i "s|image: .*|image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}|" k8s/staging/deployment.yaml

      - name: Deploy to Staging
        run: kubectl apply -f k8s/staging/

      - name: Verify Deployment
        run: |
          kubectl rollout status deployment/order-service -n staging --timeout=5m
          kubectl get pods -n staging -l app=order-service

  smoke-tests:
    name: Smoke Tests
    runs-on: ubuntu-latest
    needs: [deploy-staging]
    steps:
      - name: Run Smoke Tests
        run: |
          sleep 30  # Wait for service to fully start
          curl -f -s -o /dev/null -w "%{http_code}" \
            https://staging.example.com/actuator/health

      - name: API Contract Tests
        run: |
          curl -f -s https://staging.example.com/api/v1/orders \
            -H "Content-Type: application/json" \
            -d '{"productId":"test","quantity":1}'

  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: [smoke-tests]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment:
      name: production
      url: https://app.example.com
    concurrency: production
    steps:
      - name: Manual Approval Gate
        uses: trstringer/manual-approval@v1
        with:
          secret: ${{ secrets.GITHUB_TOKEN }}
          approvers: tech-lead,platform-team

      - uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/setup-kubectl@v3

      - name: Set Kubernetes Context
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG_PROD }}

      - name: Blue-Green Deployment
        run: |
          # Deploy to inactive environment
          CURRENT=$(kubectl get svc order-service -n production -o jsonpath='{.spec.selector.version}')
          if [ "$CURRENT" == "blue" ]; then
            TARGET="green"
          else
            TARGET="blue"
          fi

          sed -i "s|image: .*|image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}|" k8s/production/deployment-$TARGET.yaml
          sed -i "s|version: .*|version: $TARGET|" k8s/production/deployment-$TARGET.yaml

          kubectl apply -f k8s/production/deployment-$TARGET.yaml

          # Wait for new version to be ready
          kubectl rollout status deployment/order-service-$TARGET -n production --timeout=5m

          # Switch traffic
          kubectl patch svc order-service -n production -p "{\"spec\":{\"selector\":{\"version\":\"$TARGET\"}}}"

      - name: Post-Deployment Verification
        run: |
          # Check all endpoints
          ENDPOINTS=("actuator/health" "actuator/info" "api/v1/products?page=0&size=1")
          for endpoint in "${ENDPOINTS[@]}"; do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://app.example.com/$endpoint)
            if [ "$STATUS" -ne 200 ] && [ "$STATUS" -ne 404 ]; then
              echo "Endpoint $endpoint returned $STATUS"
              exit 1
            fi
          done

      - name: Health Check Monitoring
        run: |
          # Wait and verify stability
          sleep 120
          curl -f -s -o /dev/null https://app.example.com/actuator/health
```

---

## Jenkins Pipeline

### Jenkinsfile (Declarative Pipeline)

```groovy
// Jenkinsfile
pipeline {
    agent any

    tools {
        jdk 'jdk21'
        maven 'maven3'
    }

    environment {
        REGISTRY = 'ghcr.io'
        IMAGE_NAME = "${REGISTRY}/${JOB_NAME}"
        DOCKER_TAG = "${BUILD_NUMBER}-${GIT_COMMIT.take(7)}"
    }

    parameters {
        choice(
            name: 'DEPLOY_ENV',
            choices: ['staging', 'production'],
            description: 'Target environment'
        )
        booleanParam(
            name: 'RUN_SMOKE_TESTS',
            defaultValue: true,
            description: 'Run smoke tests after deployment'
        )
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Dependency Cache') {
            steps {
                // Cache Maven dependencies
                cache(path: "${HOME}/.m2/repository", key: "${JOB_NAME}-maven-${BRANCH_NAME}") {
                    sh 'mvn dependency:resolve-plugins -B'
                }
            }
        }

        stage('Static Analysis') {
            parallel {
                stage('Checkstyle') {
                    steps {
                        sh 'mvn checkstyle:check -B'
                    }
                }
                stage('SpotBugs') {
                    steps {
                        sh 'mvn spotbugs:check -B'
                    }
                }
                stage('PMD') {
                    steps {
                        sh 'mvn pmd:check -B'
                    }
                }
            }
        }

        stage('Unit Tests') {
            steps {
                sh 'mvn test -B'
            }
            post {
                always {
                    junit '**/target/surefire-reports/TEST-*.xml'
                    jacoco(
                        execPattern: '**/target/jacoco.exec',
                        classPattern: '**/target/classes',
                        sourcePattern: '**/src/main/java'
                    )
                }
                failure {
                    slackSend(
                        channel: '#build-alerts',
                        message: "Unit tests failed: ${JOB_NAME} ${BUILD_NUMBER}",
                        color: 'danger'
                    )
                }
            }
        }

        stage('Integration Tests') {
            when {
                branch 'main'
            }
            steps {
                sh 'mvn verify -Pintegration -B'
            }
            post {
                always {
                    junit '**/target/failsafe-reports/TEST-*.xml'
                }
            }
        }

        stage('Security Scan') {
            steps {
                script {
                    // OWASP Dependency Check
                    sh 'mvn org.owasp:dependency-check-maven:check -B'

                    // Trivy filesystem scan
                    sh 'trivy fs --exit-code 1 --severity CRITICAL,HIGH .'
                }
            }
        }

        stage('Quality Gate') {
            steps {
                withSonarQubeEnv('SonarQube') {
                    sh 'mvn sonar:sonar -B'
                }
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Build Artifacts') {
            steps {
                sh 'mvn package -DskipTests -B'
                archiveArtifacts artifacts: '**/target/*.jar', fingerprint: true
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    docker.build("${IMAGE_NAME}:${DOCKER_TAG}", ".")
                    docker.tag("${IMAGE_NAME}:${DOCKER_TAG}", "${IMAGE_NAME}:latest")
                }
            }
        }

        stage('Push Docker Image') {
            when {
                branch 'main'
            }
            steps {
                script {
                    docker.withRegistry("https://${REGISTRY}", 'docker-credentials') {
                        docker.image("${IMAGE_NAME}:${DOCKER_TAG}").push()
                        docker.image("${IMAGE_NAME}:latest").push()
                    }
                }
            }
        }

        stage('Deploy') {
            when {
                branch 'main'
                expression { params.DEPLOY_ENV == 'staging' || params.DEPLOY_ENV == 'production' }
            }
            steps {
                script {
                    def deployEnv = params.DEPLOY_ENV
                    def kubeConfig = "kube-config-${deployEnv}"

                    withKubeConfig([credentialsId: kubeConfig]) {
                        // Update image version
                        sh """
                            sed -i 's|image: .*|image: ${IMAGE_NAME}:${DOCKER_TAG}|' k8s/${deployEnv}/deployment.yaml
                            kubectl apply -f k8s/${deployEnv}/
                            kubectl rollout status deployment/order-service -n ${deployEnv} --timeout=5m
                        """
                    }
                }
            }
        }

        stage('Smoke Tests') {
            when {
                expression { params.RUN_SMOKE_TESTS }
            }
            steps {
                script {
                    def url = params.DEPLOY_ENV == 'production' ?
                        'https://app.example.com' :
                        'https://staging.example.com'

                    sh """
                        sleep 30
                        curl -f -s -o /dev/null -w "%{http_code}" ${url}/actuator/health
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                channel: '#build-success',
                message: "Build successful: ${JOB_NAME} ${BUILD_NUMBER} (${params.DEPLOY_ENV})",
                color: 'good'
            )
        }
        failure {
            slackSend(
                channel: '#build-alerts',
                message: "Build failed: ${JOB_NAME} ${BUILD_NUMBER}",
                color: 'danger'
            )
        }
        always {
            cleanWs()
        }
    }
}
```

---

## Kubernetes Manifests

### Deployment Configuration

```yaml
# k8s/staging/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: staging
  labels:
    app: order-service
    version: blue
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
        version: blue
    spec:
      containers:
        - name: order-service
          image: ghcr.io/myorg/order-service:latest
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: staging
            - name: SPRING_DATASOURCE_URL
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: url
            - name: SPRING_DATASOURCE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: username
            - name: SPRING_DATASOURCE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: password
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 20
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
---
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: staging
spec:
  selector:
    app: order-service
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

### Production with Blue-Green

```yaml
# k8s/production/deployment-blue.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-blue
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
      version: blue
  template:
    metadata:
      labels:
        app: order-service
        version: blue
    spec:
      containers:
        - name: order-service
          image: ghcr.io/myorg/order-service:latest
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: production
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 20
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: production
spec:
  selector:
    app: order-service
    version: blue  # Toggle between blue/green in CI/CD
  ports:
    - port: 80
      targetPort: 8080
  type: LoadBalancer
```

---

## Common Mistakes

### Mistake 1: Building Docker Image Inside CI Without Cache

```yaml
# WRONG: No cache for Docker builds
- name: Build Docker Image
  run: docker build -t app:latest .

# CORRECT: Use cache
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build with Cache
  uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

### Mistake 2: Skipping Tests in CI

```yaml
# WRONG: Skip all tests for speed
- run: mvn package -DskipTests

# CORRECT: Run tests as quality gate
- run: mvn verify -B
# Unit and integration tests run before deployment
```

### Mistake 3: Deploying Untagged Images

```yaml
# WRONG: Using latest tag
- run: kubectl set image deployment/order-service app=app:latest

# CORRECT: Use specific commit SHA
- run: kubectl set image deployment/order-service app=app:${{ github.sha }}
```

### Mistake 4: Not Using Environment-Specific Configurations

```yaml
# WRONG: Same config for all environments
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/db

# CORRECT: Environment-specific secrets and config
- name: Deploy to ${{ env.ENVIRONMENT }}
  run: |
    kubectl apply -f k8s/${{ env.ENVIRONMENT }}/
```

### Mistake 5: No Rollback Strategy

```yaml
# WRONG: Direct deletion without rollback capability
- run: kubectl delete deployment order-service
- run: kubectl apply -f new-deployment.yaml

# CORRECT: Use rollout and keep previous version
- run: |
    kubectl rollout status deployment/order-service --timeout=5m
    # If failed:
    # kubectl rollout undo deployment/order-service
```

---

## Summary

A production CI/CD pipeline should include:

1. **Code quality**: Static analysis, style checks, and coverage gates
2. **Security**: Dependency scanning, SAST, and secret detection
3. **Testing**: Unit tests, integration tests, and smoke tests
4. **Containerization**: Multi-stage Docker builds with layer caching
5. **Deployment**: Blue-green or rolling updates with health checks
6. **Verification**: Post-deployment smoke tests and monitoring

Automate everything but include manual approval gates for production. Always tag images with commit SHAs, not just "latest".

---

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Jenkins Pipeline Documentation](https://www.jenkins.io/doc/book/pipeline/)
- [Kubernetes Deployment Strategies](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [OWASP Dependency Check](https://owasp.org/www-project-dependency-check/)

---

Happy Coding 👨‍💻

Happy Coding