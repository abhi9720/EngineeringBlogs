---
title: Model Evaluation Metrics
description: >-
  Learn how to evaluate ML models with the right metrics for classification,
  regression, and ranking problems
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Machine Learning
  - Model Evaluation
  - Metrics
  - Accuracy
  - Precision
  - Recall
  - Fundamentals
coverImage: /images/model-evaluation-metrics.png
draft: false
order: 30
---
# Model Evaluation Metrics

## Overview

Choosing the right metrics is crucial for understanding how well your model performs. The wrong metric leads to the wrong model being chosen and bad business decisions.

**Think of it as:** You can't improve what you don't measure. Measure the wrong thing, and you'll optimize the wrong behavior.

---

## The Metric Selection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Choosing the Right Metric                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Problem Type?                                                  │
│       │                                                         │
│       ├── Classification                                         │
│       │      └── Binary vs Multi-class vs Multi-label          │
│       │                                                         │
│       ├── Regression                                            │
│       │      └── Continuous value prediction                   │
│       │                                                         │
│       └── Ranking                                               │
│              └── Order matters, not absolute values            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Classification Metrics

### Confusion Matrix

The foundation of classification evaluation:

```python
from sklearn.metrics import confusion_matrix
import numpy as np

y_true = [1, 0, 1, 1, 0, 1, 0, 0, 1, 0]
y_pred = [1, 0, 0, 1, 0, 1, 1, 0, 1, 0]

cm = confusion_matrix(y_true, y_pred)
print(cm)

# Output:
# [[TN  FP]     → Predicted: 0
#  [FN  TP]]    → Predicted: 1
#
# TN = 4, FP = 1
# FN = 1, TP = 4
```

### Key Terms

```python
TERMINOLOGY = {
    "TP": "True Positive - Correctly predicted positive",
    "TN": "True Negative - Correctly predicted negative",
    "FP": "False Positive - Predicted positive, actually negative",
    "FN": "False Negative - Predicted negative, actually positive",
}
```

### Accuracy

**Correct predictions / Total predictions**

```python
from sklearn.metrics import accuracy_score

accuracy = accuracy_score(y_true, y_pred)
print(f"Accuracy: {accuracy:.3f}")  # 0.80 (8/10 correct)

# Problem: Doesn't work well for imbalanced classes
# If 95% are positive, predicting all positive gives 95% accuracy!
```

### Precision

**Of predicted positive, how many actually positive?**

```python
from sklearn.metrics import precision_score

precision = precision_score(y_true, y_pred)
print(f"Precision: {precision:.3f}")  # 0.80

# "When we predict positive, we're right 80% of the time"
# High precision = Few false alarms
```

### Recall (Sensitivity)

**Of actual positive, how many predicted positive?**

```python
from sklearn.metrics import recall_score

recall = recall_score(y_true, y_pred)
print(f"Recall: {recall:.3f}")  # 0.80

# "We catch 80% of all actual positives"
# High recall = Few missed cases
```

### F1 Score

**Harmonic mean of precision and recall**

```python
from sklearn.metrics import f1_score

f1 = f1_score(y_true, y_pred)
print(f"F1 Score: {f1:.3f}")

# Formula: 2 * (Precision * Recall) / (Precision + Recall)
# Balances precision and recall
```

---

## When to Use Which Metric

```
┌─────────────────────────────────────────────────────────────────┐
│              Metric Selection Guide                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Medical Diagnosis (Cancer detection):                          │
│  → Use RECALL                                                   │
│  → Better to have false alarm than miss cancer                 │
│                                                                 │
│  Spam Detection:                                               │
│  → Use PRECISION                                                │
│  → Don't want good emails marked as spam                       │
│                                                                 │
│  General Classification:                                        │
│  → Use F1 SCORE                                                 │
│  → Balances precision and recall                               │
│                                                                 │
│  Balanced Classes:                                             │
│  → Use ACCURACY                                                 │
│  → Classes are roughly equal, accuracy works                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Imbalanced Classes

### The Problem

```python
# 99% of data is negative, 1% is positive
y_true = [0] * 990 + [1] * 10

# Model that predicts all zeros
y_pred = [0] * 1000

accuracy_score(y_true, y_pred)  # 0.99 - amazing!
# But it never catches the positives!
```

### Solutions

```python
# 1. Use appropriate metrics
from sklearn.metrics import classification_report

print(classification_report(y_true, y_pred))
# Shows precision, recall, f1 for each class

# 2. Confusion matrix analysis
# Focus on minority class metrics

# 3. Class weights
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(class_weight='balanced')
# Automatically adjusts for imbalanced classes
```

### ROC-AUC

**Handles imbalanced data well**

```python
from sklearn.metrics import roc_auc_score, roc_curve
import matplotlib.pyplot as plt

# Get probability predictions (not just labels)
y_proba = model.predict_proba(X_test)[:, 1]

# AUC: Area under ROC curve
# 1.0 = perfect, 0.5 = random
auc = roc_auc_score(y_test, y_proba)
print(f"ROC-AUC: {auc:.3f}")

# Plot ROC curve
fpr, tpr, thresholds = roc_curve(y_test, y_proba)
plt.plot(fpr, tpr, label=f'AUC = {auc:.3f}')
plt.plot([0, 1], [0, 1], 'k--')
plt.xlabel('False Positive Rate')
plt.ylabel('True Positive Rate')
plt.legend()
plt.show()
```

---

## Regression Metrics

### Mean Absolute Error (MAE)

**Average absolute difference between predicted and actual**

```python
from sklearn.metrics import mean_absolute_error

y_true = [300, 400, 500, 350, 450]
y_pred = [310, 390, 510, 360, 440]

mae = mean_absolute_error(y_true, y_pred)
print(f"MAE: {mae:.2f}")  # 12.0

# Average prediction is off by 12 units
# Easy to interpret, but doesn't penalize large errors
```

### Mean Squared Error (MSE)

**Average squared difference (penalizes large errors more)**

```python
from sklearn.metrics import mean_squared_error

mse = mean_squared_error(y_true, y_pred)
print(f"MSE: {mse:.2f}")  # 180

# RMSE (Root Mean Squared Error)
rmse = np.sqrt(mse)
print(f"RMSE: {rmse:.2f}")  # 13.42

# Interpretation: "Predictions are off by ~13 on average"
# More sensitive to outliers than MAE
```

### R² Score

**How much variance does the model explain?**

```python
from sklearn.metrics import r2_score

r2 = r2_score(y_true, y_pred)
print(f"R² Score: {r2:.3f}")  # 0.92

# Interpretation:
# 0.0 = Model explains none of the variance
# 1.0 = Model explains all the variance
# Negative = Model is worse than predicting the mean
```

### Comparison Table

```python
METRICS_COMPARISON = {
    "MAE": {
        "strengths": "Robust to outliers, interpretable",
        "weaknesses": "Doesn't differentiate small vs large errors",
        "best_for": "When all errors matter equally"
    },
    "MSE": {
        "strengths": "Penalizes large errors more",
        "weaknesses": "Sensitive to outliers",
        "best_for": "When large errors are much worse"
    },
    "R²": {
        "strengths": "Scale-independent, easy to interpret",
        "weaknesses": "Can be misleading with non-linear data",
        "best_for": "General model quality assessment"
    },
}
```

---

## Practical Example: Complete Evaluation

```python
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, classification_report, confusion_matrix,
    roc_auc_score
)

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Train model
model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

# Predictions
y_pred = model.predict(X_test)
y_proba = model.predict_proba(X_test)[:, 1]

# Comprehensive evaluation
print("=" * 50)
print("MODEL EVALUATION REPORT")
print("=" * 50)

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, y_pred))

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

print("\nKey Metrics:")
print(f"Accuracy:  {accuracy_score(y_test, y_pred):.3f}")
print(f"Precision:  {precision_score(y_test, y_pred):.3f}")
print(f"Recall:     {recall_score(y_test, y_pred):.3f}")
print(f"F1 Score:   {f1_score(y_test, y_pred):.3f}")
print(f"ROC-AUC:    {roc_auc_score(y_test, y_proba):.3f}")
```

---

## Cross-Validation for Robust Evaluation

```python
from sklearn.model_selection import cross_val_score, cross_validate

# Single metric
scores = cross_val_score(model, X, y, cv=5, scoring='f1')
print(f"F1: {scores.mean():.3f} (+/- {scores.std()*2:.3f})")

# Multiple metrics
results = cross_validate(
    model, X, y,
    cv=5,
    scoring=['accuracy', 'f1', 'roc_auc'],
    return_train_score=True
)

print(f"Test Accuracy: {results['test_accuracy'].mean():.3f}")
print(f"Test F1:       {results['test_f1'].mean():.3f}")
print(f"Test ROC-AUC:  {results['test_roc_auc'].mean():.3f}")
```

---

## Business Metric Alignment

```python
# The REAL metric should align with business goals

def align_metrics(problem_type, business_context):
    """
    Choose metrics based on business impact
    """
    
    if problem_type == "fraud_detection":
        return {
            "primary": "recall",  # Catch as many frauds as possible
            "secondary": "f1",    # Balance false alarms
            "threshold": "min 95% recall"
        }
    
    elif problem_type == "spam_filter":
        return {
            "primary": "precision",  # Don't mark good emails as spam
            "secondary": "f1",
            "threshold": "max 1% false positive"
        }
    
    elif problem_type == "medical_diagnosis":
        return {
            "primary": "recall",  # Don't miss any disease
            "secondary": "specificity",
            "threshold": "min 99% recall"
        }
    
    elif problem_type == "customer_churn":
        return {
            "primary": "f1",  # Balance catching churners and not bothering customers
            "secondary": "precision",
            "threshold": "min 80% f1"
        }
    
    return {"primary": "accuracy", "secondary": "f1"}
```

---

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| **Using accuracy for imbalanced data** | Misleading results | Use F1, precision, recall, AUC |
| **Optimizing wrong metric** | Wrong model chosen | Align with business goal |
| **No baseline comparison** | Don't know if model is good | Compare with simple baseline |
| **No validation set** | Overfitting indicators hidden | Always split data |
| **Ignoring business cost** | Technical metric ≠ business value | Map to business impact |

---

## Summary

| Problem Type | Primary Metric | Secondary Metrics |
|-------------|----------------|-------------------|
| **Balanced classification** | Accuracy | Precision, Recall, F1 |
| **Imbalanced classification** | F1, ROC-AUC | Precision, Recall |
| **Medical/detection** | Recall (Sensitivity) | Specificity |
| **Spam/contamination** | Precision | F1 |
| **Regression** | RMSE, MAE | R² |
| **Ranking** | MAP, NDCG | Precision@K |

**Key insight:** The right metric depends on:
1. Problem type
2. Class balance
3. Business costs of errors

**Next:** Move to `02-deep-learning-core/neural-networks-basics.md` to learn about deep learning.

---

## References

- [Scikit-learn Metrics](https://scikit-learn.org/stable/modules/model_evaluation.html)
- [ML Metrics Guide](https://developers.google.com/machine-learning/crash-course/classification)
