---
title: Supervised Learning
description: >-
  Master supervised learning - the most common type of ML for classification and
  regression problems
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Machine Learning
  - Supervised Learning
  - Classification
  - Regression
  - Fundamentals
coverImage: /images/supervised-learning.png
draft: false
order: 40
---
# Supervised Learning

## Overview

Supervised learning learns from labeled training data to predict outcomes for new data. Given inputs (X) and correct outputs (y), the algorithm learns the mapping function.

**Think of it as:** Learning with a teacher - you have examples with correct answers, and the algorithm learns to produce the right answers.

---

## The Supervised Learning Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Supervised Learning Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Training Phase                             │    │
│  │                                                         │    │
│  │  Features (X)        Labels (y)                        │    │
│  │  ┌───────────┐       ┌───────────┐                    │    │
│  │  │sqft=1500  │──────▶│ price=   │                    │    │
│  │  │beds=3     │       │ $400,000 │                    │    │
│  │  └───────────┘       └───────────┘                    │    │
│  │       │                   │                           │    │
│  │       └────────┬───────────┘                           │    │
│  │                ▼                                       │    │
│  │         ┌─────────────┐                               │    │
│  │         │   Learn    │                               │    │
│  │         │  f(X) = y   │                               │    │
│  │         └─────────────┘                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Prediction Phase                           │    │
│  │                                                         │    │
│  │  New Features ──▶ Trained Model ──▶ Prediction ✓        │    │
│  │  sqft=1800                     price=$420,000          │    │
│  │  beds=4                                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Two Types of Problems

### Classification (Discrete Labels)

**Question:** What category? Is this spam or not?

```python
# Examples:
# - Email: spam or not spam?
# - Image: cat, dog, or bird?
# - Customer: will buy or won't buy?
# - Disease: positive or negative?

# Output is a category (finite set of options)
```

### Regression (Continuous Values)

**Question:** How much? How many? What value?

```python
# Examples:
# - House price: $350,000
# - Temperature: 72.5°F
# - Sales next month: $50,000
# - Tomorrow's stock price: $150.25

# Output is a number (continuous range)
```

---

## Classification Algorithms

### Logistic Regression

Despite its name, it's for **classification**:

```python
from sklearn.linear_model import LogisticRegression
import numpy as np

# Data: [age, income]
X = np.array([[25, 50000], [35, 70000], [45, 90000],
              [28, 40000], [32, 55000], [50, 120000]])
# Labels: 1 = will purchase, 0 = won't purchase
y = np.array([0, 1, 1, 0, 0, 1])

# Train
model = LogisticRegression()
model.fit(X, y)

# Predict
customer = [[38, 75000]]
prediction = model.predict(customer)
print(f"Will buy: {'Yes' if prediction[0] else 'No'}")

# Probability
proba = model.predict_proba(customer)
print(f"Probability: {proba[0][1]:.2%}")
```

### Decision Tree

Splits data into branches based on features:

```python
from sklearn.tree import DecisionTreeClassifier, export_text

model = DecisionTreeClassifier(max_depth=3)
model.fit(X, y)

# Visualize rules
tree_rules = export_text(model)
print(tree_rules)

# Output:
# |--- income <= 65000
# |   |--- class: 0
# |--- income > 65000
# |   |--- class: 1
```

### Random Forest

Ensemble of decision trees (more robust):

```python
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(
    n_estimators=100,  # Number of trees
    max_depth=10,
    random_state=42
)
model.fit(X, y)

# Feature importance
importances = model.feature_importances_
print(f"Feature importances: {importances}")
```

### Support Vector Machine (SVM)

Finds optimal boundary between classes:

```python
from sklearn.svm import SVC

model = SVC(kernel='rbf', C=1.0)
model.fit(X, y)

# Predict
prediction = model.predict([[38, 75000]])
```

---

## Regression Algorithms

### Linear Regression

Best for simple relationships:

```python
from sklearn.linear_model import LinearRegression

# Data: [sqft, bedrooms, bathrooms]
X = np.array([[1500, 3, 2], [2000, 4, 2], [2500, 5, 3]])
y = np.array([300000, 400000, 500000])

model = LinearRegression()
model.fit(X, y)

# Predict
new_house = [[1800, 3, 2]]
price = model.predict(new_house)
print(f"Predicted price: ${price[0]:,.0f}")
```

### Ridge Regression (Regularized)

Prevents overfitting with L2 regularization:

```python
from sklearn.linear_model import Ridge

model = Ridge(alpha=1.0)  # Regularization strength
model.fit(X, y)
```

### Gradient Boosting

High accuracy for complex problems:

```python
from sklearn.ensemble import GradientBoostingRegressor

model = GradientBoostingRegressor(
    n_estimators=100,
    learning_rate=0.1,
    max_depth=5
)
model.fit(X, y)
```

---

## Evaluation Metrics

### For Classification

```python
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

y_true = [1, 0, 1, 1, 0, 1]
y_pred = [1, 0, 0, 1, 0, 1]

# Accuracy: Correct predictions / Total
accuracy = accuracy_score(y_true, y_pred)  # 0.83 (5/6)

# Precision: Of predicted positive, how many actually positive?
precision = precision_score(y_true, y_pred)  # 0.67 (2/3)

# Recall: Of actual positive, how many predicted positive?
recall = recall_score(y_true, y_pred)  # 0.67 (2/3)

# F1: Harmonic mean of precision and recall
f1 = f1_score(y_true, y_pred)  # 0.67

# Confusion Matrix
cm = confusion_matrix(y_true, y_pred)
print(cm)
# [[2 0]
#  [1 3]]
# TN=2, FP=0, FN=1, TP=3
```

### For Regression

```python
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

y_true = [300000, 400000, 500000, 350000]
y_pred = [310000, 390000, 510000, 360000]

# MAE: Average absolute error
mae = mean_absolute_error(y_true, y_pred)  # $10,000

# RMSE: Root mean squared error (penalizes big errors)
mse = mean_squared_error(y_true, y_pred)
rmse = np.sqrt(mse)  # ~$11,180

# R² Score: 1 is perfect, 0 is baseline prediction
r2 = r2_score(y_true, y_pred)  # 0.92
```

---

## Complete Example: Email Spam Detection

```python
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.metrics import classification_report

# Sample data
emails = [
    "win free money now",
    "meeting at 3pm tomorrow",
    "congratulations you won prize",
    "please review the document",
    "click here for free gift",
    "project update meeting",
    "urgent need your response",
    "lunch at noon?"
]
labels = [1, 0, 1, 0, 1, 0, 0, 0]  # 1=spam, 0=not spam

# Convert text to numbers
vectorizer = CountVectorizer()
X = vectorizer.fit_transform(emails)

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, labels, test_size=0.25, random_state=42
)

# Train model
model = MultinomialNB()
model.fit(X_train, y_train)

# Predict
y_pred = model.predict(X_test)

# Evaluate
print(classification_report(y_test, y_pred))
#              precision    recall  f1-score   support
#            0       1.00      1.00      1.00         1
#            1       1.00      1.00      1.00         1
#        accuracy                           1.00         2
```

---

## Best Practices

1. **Split your data properly**
   ```python
   X_train, X_test, y_train, y_test = train_test_split(
       X, y, test_size=0.2, random_state=42
   )
   ```

2. **Scale features for some algorithms**
   ```python
   from sklearn.preprocessing import StandardScaler
   
   scaler = StandardScaler()
   X_train_scaled = scaler.fit_transform(X_train)
   X_test_scaled = scaler.transform(X_test)
   ```

3. **Cross-validation for reliable results**
   ```python
   from sklearn.model_selection import cross_val_score
   
   scores = cross_val_score(model, X, y, cv=5)  # 5-fold CV
   print(f"Accuracy: {scores.mean():.2%} (+/- {scores.std()*2:.2%})")
   ```

4. **Handle class imbalance**
   ```python
   from sklearn.ensemble import RandomForestClassifier
   
   model = RandomForestClassifier(class_weight='balanced')
   ```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Train on all data** | Overfitting, unrealistic results | Always split data |
| **Wrong metric** | Optimizing wrong thing | Choose metric for problem |
| **No feature scaling** | Algorithms misbehave | Scale data |
| **Ignoring imbalance** | Misleading accuracy | Use appropriate metric |
| **Data leakage** | Train/test contamination | Keep sets separate |

---

## Summary

**Supervised learning** learns from labeled data:

| Problem Type | Algorithms | Metrics |
|-------------|------------|---------|
| **Classification** | Logistic, Decision Tree, Random Forest, SVM | Accuracy, Precision, Recall, F1 |
| **Regression** | Linear, Ridge, Gradient Boosting | MAE, RMSE, R² |

**Key steps:**
1. Collect labeled data
2. Split into train/test
3. Scale features (if needed)
4. Train model
5. Evaluate and tune

**Next:** Continue to `unsupervised-learning.md` to learn about finding patterns without labels.

---

## References

- [Scikit-learn Supervised Learning](https://scikit-learn.org/stable/supervised_learning.html)
- [Google ML Classification](https://developers.google.com/machine-learning/crash-course/classification)
- [Google ML Regression](https://developers.google.com/machine-learning/crash-course/regression)
