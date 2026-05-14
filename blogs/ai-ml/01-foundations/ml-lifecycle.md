---
title: ML Lifecycle
description: >-
  Learn the complete machine learning lifecycle - from problem definition to
  deployment and monitoring
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Machine Learning
  - ML Lifecycle
  - ML Pipeline
  - Data Science
  - Fundamentals
coverImage: /images/ml-lifecycle.png
draft: false
order: 20
---
# ML Lifecycle

## Overview

The ML lifecycle covers the complete journey of a machine learning project - from understanding the problem to deploying and monitoring the model in production.

**Think of it as:** A recipe for building ML systems that work reliably in the real world.

---

## The Complete ML Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    ML Lifecycle                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐                                              │
│   │  1. Define  │  Understand problem, goals, success metrics  │
│   │  Problem   │                                              │
│   └──────┬──────┘                                              │
│          │                                                     │
│          ▼                                                     │
│   ┌─────────────┐                                              │
│   │  2. Data    │  Collect, explore, clean, prepare           │
│   │  Collection │                                              │
│   └──────┬──────┘                                              │
│          │                                                     │
│          ▼                                                     │
│   ┌─────────────┐                                              │
│   │  3. Feature │  Engineer features, transform data          │
│   │  Engineering│                                              │
│   └──────┬──────┘                                              │
│          │                                                     │
│          ▼                                                     │
│   ┌─────────────┐                                              │
│   │  4. Model   │  Train, evaluate, tune hyperparameters      │
│   │  Training   │                                              │
│   └──────┬──────┘                                              │
│          │                                                     │
│          ▼                                                     │
│   ┌─────────────┐                                              │
│   │  5. Evaluate│  Test on held-out data, validate metrics    │
│   │  & Select   │                                              │
│   └──────┬──────┘                                              │
│          │                                                     │
│          ▼                                                     │
│   ┌─────────────┐                                              │
│   │  6. Deploy  │  Put model into production                  │
│   │             │                                              │
│   └──────┬──────┘                                              │
│          │                                                     │
│          ▼                                                     │
│   ┌─────────────┐                                              │
│   │  7. Monitor │  Track performance, detect drift            │
│   │  & Maintain │                                              │
│   └─────────────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Problem Definition

### Define the Business Problem

```python
PROBLEM_DEFINITION = {
    "what": "What problem are we solving?",
    "why": "Why does this problem matter?",
    "success": "How do we measure success?",
    "constraints": "What limitations exist?",
}
```

### Types of ML Problems

```python
# Classification: Predict category
problem_type = "classification"
# Example: Will customer churn or not?

# Regression: Predict number
problem_type = "regression"
# Example: What will be the house price?

# Recommendation: Suggest items
problem_type = "recommendation"
# Example: What products to recommend?

# Time series: Predict future values
problem_type = "time_series"
# Example: What will sales be next month?

# Clustering: Group similar items
problem_type = "clustering"
# Example: Segment customers into groups
```

### Stakeholder Questions to Answer

```
Before starting, clarify:

1. What business decision will this model support?
2. Who will use the model's predictions?
3. What happens if the model is wrong?
4. How fast do we need predictions?
5. What data do we have access to?
6. What's the cost of false positives vs false negatives?
7. How will we measure model success?
```

---

## Phase 2: Data Collection

### Data Sources

```python
DATA_SOURCES = {
    "internal": ["Database", "Logs", "APIs", "Files"],
    "external": ["APIs", "Web scraping", "Public datasets"],
    "synthetic": ["Data augmentation", "Simulation"],
}
```

### Data Exploration (EDA)

```python
import pandas as pd
import numpy as np

# Load data
df = pd.read_csv('your_data.csv')

# Basic info
print(df.info())
print(df.describe())

# Check target distribution
print(df['target'].value_counts())

# Missing values
print(df.isnull().sum())

# Feature correlations
print(df.corr()['target'].sort_values())
```

### Data Quality Checks

```python
def check_data_quality(df):
    issues = {}
    
    # Missing values
    if df.isnull().sum().sum() > 0:
        issues['missing_values'] = df.isnull().sum()
    
    # Duplicates
    n_duplicates = df.duplicated().sum()
    if n_duplicates > 0:
        issues['duplicates'] = n_duplicates
    
    # Outliers (using IQR)
    for col in df.select_dtypes(include=[np.number]):
        Q1 = df[col].quantile(0.25)
        Q3 = df[col].quantile(0.75)
        IQR = Q3 - Q1
        outliers = ((df[col] < Q1 - 1.5*IQR) | (df[col] > Q3 + 1.5*IQR)).sum()
        if outliers > 0:
            issues[f'{col}_outliers'] = outliers
    
    return issues
```

---

## Phase 3: Feature Engineering

### Feature Types

```
┌─────────────────────────────────────────────────────────────────┐
│              Feature Types                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Numerical Features:                                            │
│  - Age, price, temperature, counts                             │
│  - Can be continuous or discrete                               │
│                                                                 │
│  Categorical Features:                                          │
│  - Color: red, green, blue                                      │
│  - City: NY, LA, SF                                            │
│  - Ordinal: low, medium, high                                  │
│                                                                 │
│  Text Features:                                                 │
│  - Comments, reviews, descriptions                              │
│  - Requires text processing                                     │
│                                                                 │
│  Date/Time Features:                                            │
│  - Day of week, hour, month                                     │
│  - Time since event                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Feature Engineering Techniques

```python
# Create new features from existing ones
df['total_spend'] = df['quantity'] * df['price']
df['profit_margin'] = (df['revenue'] - df['cost']) / df['revenue']

# Extract from dates
df['hour'] = df['timestamp'].dt.hour
df['day_of_week'] = df['timestamp'].dt.dayofweek
df['is_weekend'] = df['day_of_week'].isin([5, 6])

# Encode categorical variables
from sklearn.preprocessing import LabelEncoder, OneHotEncoder

# Label encoding (for ordinal)
le = LabelEncoder()
df['color_encoded'] = le.fit_transform(df['color'])

# One-hot encoding (for nominal)
df = pd.get_dummies(df, columns=['city'], prefix='city')
```

### Feature Scaling

```python
from sklearn.preprocessing import StandardScaler, MinMaxScaler

# StandardScaler: mean=0, std=1
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# MinMaxScaler: range 0-1
scaler = MinMaxScaler()
X_normalized = scaler.fit_transform(X)
```

---

## Phase 4: Model Training

### Train/Validation/Test Split

```python
from sklearn.model_selection import train_test_split

# Split: 70% train, 15% validation, 15% test
X_train, X_temp, y_train, y_temp = train_test_split(
    X, y, test_size=0.3, random_state=42
)

X_val, X_test, y_val, y_test = train_test_split(
    X_temp, y_temp, test_size=0.5, random_state=42
)

print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
```

### Cross-Validation

```python
from sklearn.model_selection import cross_val_score

# 5-fold cross-validation
scores = cross_val_score(
    model, X, y,
    cv=5,
    scoring='accuracy'
)

print(f"CV Accuracy: {scores.mean():.3f} (+/- {scores.std()*2:.3f})")
```

### Train Multiple Models

```python
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier

models = {
    'Logistic Regression': LogisticRegression(),
    'Decision Tree': DecisionTreeClassifier(max_depth=5),
    'Random Forest': RandomForestClassifier(n_estimators=100),
    'Gradient Boosting': GradientBoostingClassifier(n_estimators=100),
}

results = {}
for name, model in models.items():
    model.fit(X_train, y_train)
    train_score = model.score(X_train, y_train)
    val_score = model.score(X_val, y_val)
    results[name] = {'train': train_score, 'val': val_score}
    print(f"{name}: Train={train_score:.3f}, Val={val_score:.3f}")

# Select best model based on validation score
best_model_name = max(results, key=lambda x: results[x]['val'])
print(f"\nBest model: {best_model_name}")
```

---

## Phase 5: Model Evaluation

### Classification Metrics

```python
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, classification_report
)

y_pred = model.predict(X_test)

# Basic metrics
print(f"Accuracy: {accuracy_score(y_test, y_pred):.3f}")
print(f"Precision: {precision_score(y_test, y_pred):.3f}")
print(f"Recall: {recall_score(y_test, y_pred):.3f}")
print(f"F1: {f1_score(y_test, y_pred):.3f}")

# Full report
print(classification_report(y_test, y_pred))

# Confusion matrix
cm = confusion_matrix(y_test, y_pred)
print(f"Confusion Matrix:\n{cm}")
```

### Regression Metrics

```python
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score
)

y_pred = model.predict(X_test)

print(f"MAE: ${mean_absolute_error(y_test, y_pred):,.0f}")
print(f"RMSE: ${np.sqrt(mean_squared_error(y_test, y_pred)):,.0f}")
print(f"R²: {r2_score(y_test, y_pred):.3f}")
```

---

## Phase 6: Model Deployment

### Save and Load Model

```python
import joblib

# Save model
joblib.dump(model, 'model_v1.pkl')

# Load model
model = joblib.load('model_v1.pkl')

# Make predictions
predictions = model.predict(new_data)
```

### Simple API with FastAPI

```python
from fastapi import FastAPI
import joblib

app = FastAPI()
model = joblib.load('model_v1.pkl')

@app.post("/predict")
async def predict(data: dict):
    X = preprocess(data)
    prediction = model.predict(X)
    return {"prediction": prediction.tolist()}
```

### Batch Prediction

```python
# Process large datasets in batches
def predict_batch(data, batch_size=1000):
    predictions = []
    
    for i in range(0, len(data), batch_size):
        batch = data[i:i+batch_size]
        predictions.extend(model.predict(batch))
    
    return predictions
```

---

## Phase 7: Monitoring and Maintenance

### Track Performance Metrics

```python
import time
from datetime import datetime

class ModelMonitor:
    def __init__(self):
        self.metrics = []
    
    def log_prediction(self, features, prediction, actual=None):
        self.metrics.append({
            'timestamp': datetime.now(),
            'prediction': prediction,
            'actual': actual,
            'latency_ms': time.time()  # Track prediction time
        })
    
    def get_accuracy(self):
        # Calculate accuracy on recent predictions
        recent = [m for m in self.metrics if m['actual'] is not None]
        if not recent:
            return None
        
        correct = sum(p == a for p, a in zip(
            [m['prediction'] for m in recent],
            [m['actual'] for m in recent]
        ))
        return correct / len(recent)
    
    def get_latency_p99(self):
        # 99th percentile latency
        latencies = [m['latency_ms'] for m in self.metrics]
        return sorted(latencies)[int(len(latencies) * 0.99)]
```

### Detect Data Drift

```python
class DriftDetector:
    def __init__(self, baseline_data):
        self.baseline_mean = baseline_data.mean()
        self.baseline_std = baseline_data.std()
        self.threshold = 0.1
    
    def detect_drift(self, new_data):
        drift = abs(new_data.mean() - self.baseline_mean) / self.baseline_std
        
        if drift > self.threshold:
            return True, f"Drift detected: {drift:.3f}"
        return False, "No drift"
    
    def alert(self, new_data):
        has_drift, message = self.detect_drift(new_data)
        if has_drift:
            # Send alert - retrain recommended
            print(f"ALERT: {message}")
```

---

## Lifecycle Diagrams

```
┌─────────────────────────────────────────────────────────────────┐
│          Typical Time Distribution in ML Projects              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Problem Definition:     ████░░░░░░░░░░░░ 10%                 │
│  Data Collection:        ████████████░░░░ 30%                 │
│  Feature Engineering:    ██████████░░░░░░ 25%                 │
│  Model Training:          ████░░░░░░░░░░░░ 10%                 │
│  Evaluation:              ████░░░░░░░░░░░░ 10%                 │
│  Deployment:               ████░░░░░░░░░░░░ 10%                 │
│  Monitoring:               ███░░░░░░░░░░░░░ 5% (ongoing)        │
│                                                                 │
│  Key insight: Data & features take ~55% of project time!      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Best Practices

1. **Start simple, iterate**
   ```python
   # First: baseline model (logistic regression, simple rules)
   # Then: complex models if baseline isn't good enough
   ```

2. **Document everything**
   ```python
   # Track: what data, what preprocessing, what model, what results
   experiment_log = {
       'date': '2024-01-01',
       'data_version': 'v2.3',
       'features': ['age', 'income', 'spending'],
       'model': 'RandomForest',
       'accuracy': 0.92
   }
   ```

3. **Version control data and models**
   ```python
   # Use DVC for data versioning
   # Use MLflow for model tracking
   ```

4. **Automate pipeline**
   ```python
   # Use sklearn pipelines
   from sklearn.pipeline import Pipeline
   
   pipeline = Pipeline([
       ('scaler', StandardScaler()),
       ('model', RandomForestClassifier())
   ])
   ```

---

## Common Pitfalls

| Pitfall | Problem | Prevention |
|---------|---------|-------------|
| **Skip EDA** | Data issues caught late | Always explore first |
| **Data leakage** | Unrealistic performance | Strict train/test split |
| **Overfitting** | Poor real-world performance | Use validation set, cross-validation |
| **Feature engineering neglect** | Model not reaching potential | Spend time on features |
| **Ignore monitoring** | Model degrades silently | Set up monitoring from day 1 |

---

## Summary

The ML lifecycle has 7 phases:

| Phase | Key Activities |
|-------|---------------|
| **1. Problem Definition** | Understand goal, success metrics |
| **2. Data Collection** | Gather, explore, validate data |
| **3. Feature Engineering** | Create, transform, scale features |
| **4. Model Training** | Train, evaluate, tune models |
| **5. Evaluation** | Validate on test data |
| **6. Deployment** | Put model into production |
| **7. Monitoring** | Track performance, detect drift |

**Key insight:** 55%+ of time is spent on data and features, not modeling!

**Next:** Continue to `bias-variance-tradeoff.md` to understand model performance deeply.

---

## References

- [Google ML Guide](https://developers.google.com/machine-learning)
- [ML Pipeline Best Practices](https://ml-ops.org/)
- [MLflow](https://mlflow.org/)
