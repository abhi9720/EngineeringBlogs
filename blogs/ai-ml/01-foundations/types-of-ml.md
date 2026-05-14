---
title: Types of Machine Learning
description: >-
  Understand the three main types of machine learning - supervised,
  unsupervised, and reinforcement learning
date: '2026-05-11'
author: Abhishek Tiwari
tags:
  - Machine Learning
  - Types of ML
  - Supervised
  - Unsupervised
  - Reinforcement
  - Fundamentals
coverImage: /images/types-of-ml.png
draft: false
order: 50
---
# Types of Machine Learning

## Overview

Machine learning is categorized into three main types based on how the learning happens. Understanding these types helps you choose the right approach for your problem.

**The three types:**
1. **Supervised Learning** - Learning from labeled data
2. **Unsupervised Learning** - Finding patterns without labels
3. **Reinforcement Learning** - Learning from interactions

---

## Overview Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│              Types of Machine Learning                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Supervised              Unsupervised          Reinforcement  │
│  ┌─────────────┐        ┌─────────────┐        ┌─────────────┐ │
│  │   Input X   │        │   Input X   │        │    Agent    │ │
│  │      ↓      │        │      ↓      │        │     ↓       │ │
│  │ Label (y)   │        │   (no label)│        │   Action    │ │
│  │      ↓      │        │      ↓      │        │     ↓       │ │
│  │  Predict    │        │   Discover  │        │   Reward    │ │
│  │   Label     │        │   Pattern   │        │     ↓       │ │
│  └─────────────┘        └─────────────┘        │   Learn     │ │
│                                                 └─────────────┘ │
│  "Tell me the                 "Find hidden                    │
│   right answer"               structure"                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Supervised Learning

### The Concept

**Supervised learning** learns from examples where both the input and the correct output are known. It's like a student learning with a teacher's answers.

```
┌─────────────────────────────────────────────────────────────────┐
│              Supervised Learning Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Training Data:                                                 │
│  ┌─────────────────┬─────────────────────┐                    │
│  │     Input       │      Label          │                    │
│  │   (Features)    │   (Correct Answer)  │                    │
│  ├─────────────────┼─────────────────────┤                    │
│  │  Email text     │  spam / not_spam    │                    │
│  │  House size     │  $300,000           │                    │
│  │  Image          │  cat / dog / bird   │                    │
│  └─────────────────┴─────────────────────┘                    │
│          │                    │                               │
│          └────────┬───────────┘                               │
│                   ↓                                            │
│            ┌────────────┐                                      │
│            │    Learn   │                                      │
│            │   mapping  │                                      │
│            │    X → Y   │                                      │
│            └────────────┘                                      │
│                   ↓                                            │
│         ┌─────────────────┐                                    │
│         │  Trained Model  │                                    │
│         └─────────────────┘                                    │
│                   ↓                                            │
│  New Email ──▶ Model ──▶ "spam" ✓                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Two Types of Problems

#### Classification (Discrete Labels)

```python
# Predicting categories
# "Is this spam or not spam?"

from sklearn.linear_model import LogisticRegression

# Training data: [spam_features]
# Labels: 1=spam, 0=not_spam
X_train = [[1, 0, 1], [0, 0, 0], [1, 1, 1]]  # Features
y_train = [1, 0, 1]  # Labels

model = LogisticRegression()
model.fit(X_train, y_train)

# Predict: Is this spam?
model.predict([[1, 0, 1]])  # → [1] (spam)
```

**Classification examples:**
- Email spam detection (spam/not spam)
- Image classification (cat/dog/bird)
- Medical diagnosis (disease/no disease)
- Sentiment analysis (positive/negative/neutral)

#### Regression (Continuous Values)

```python
# Predicting numbers
# "What will be the house price?"

from sklearn.linear_model import LinearRegression

# Training data: [sqft, bedrooms]
X_train = [[1500, 3], [2000, 4], [2500, 5]]
y_train = [300000, 400000, 500000]

model = LinearRegression()
model.fit(X_train, y_train)

# Predict: Price for 1800 sqft, 3 bedrooms
model.predict([[1800, 3]])  # → [360000]
```

**Regression examples:**
- House price prediction
- Stock price forecasting
- Temperature prediction
- Sales forecasting

### Common Algorithms

```python
ALGORITHMS = {
    # Classification
    "Logistic Regression": "Binary classification, interpretable",
    "Decision Tree": "Simple rules, visualizable",
    "Random Forest": "Ensemble of trees, robust",
    "SVM": "Good for high-dimensional data",
    "Naive Bayes": "Fast, works well with text",
    
    # Regression
    "Linear Regression": "Simple baseline",
    "Ridge/Lasso": "Regularized linear",
    "Random Forest": "Handles non-linearity",
    "Gradient Boosting": "XGBoost, high accuracy",
}
```

---

## 2. Unsupervised Learning

### The Concept

**Unsupervised learning** finds hidden patterns in data without any labels. The algorithm discovers structure on its own.

```
┌─────────────────────────────────────────────────────────────────┐
│              Unsupervised Learning Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Data:                                                          │
│  ┌─────────────────┐                                          │
│  │     Input       │                                          │
│  │   (No Labels!)  │                                          │
│  ├─────────────────┤                                          │
│  │  Customer data  │                                          │
│  │  (age, income)  │                                          │
│  │  (no segment)  │                                          │
│  └─────────────────┘                                          │
│          │                                                    │
│          ↓                                                    │
│      ┌────────────┐                                           │
│      │  Discover  │                                           │
│      │   Hidden   │                                           │
│      │  Structure │                                           │
│      └────────────┘                                           │
│          │                                                    │
│  Discovered Groups:                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                       │
│  │Group A │  │Group B │  │Group C │                       │
│  │ Young  │  │Middle  │  │ Senior  │                       │
│  │ Savers │  │Spenders │  │Investors│                       │
│  └─────────┘  └─────────┘  └─────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Types of Unsupervised Learning

#### Clustering (Group Similar Items)

```python
# Group customers by behavior
from sklearn.cluster import KMeans

customers = [
    [25, 30000],  # Young, low income
    [35, 80000],  # Middle, high income
    [55, 120000], # Older, high income
    [28, 40000],  # Young, medium income
    [45, 90000],  # Older, medium income
]

kmeans = KMeans(n_clusters=3, random_state=42)
segments = kmeans.fit_predict(customers)

# Result: Each customer assigned to a group
# Customer 0 → Group 0, Customer 1 → Group 1, etc.
```

**Clustering use cases:**
- Customer segmentation
- Document grouping
- Anomaly detection
- Image compression

#### Dimensionality Reduction (Compress Data)

```python
# Reduce features while keeping information
from sklearn.decomposition import PCA

# 100 features → 10 features
X_reduced = PCA(n_components=10).fit_transform(X_100_features)

# This helps with:
# - Faster training
# - Less storage
# - Better generalization
```

**Dimensionality reduction use cases:**
- Visualization (reduce to 2D for plotting)
- Speed up ML pipelines
- Remove noise
- Compress images

#### Association (Find Rules)

```python
# "People who buy X also buy Y"
# "If customer likes A, they probably like B"

# Classic example: Market basket analysis
# "If you buy bread, you're likely to buy butter"
# → Put bread and butter near each other in store
```

---

## 3. Reinforcement Learning

### The Concept

**Reinforcement learning** learns through trial and error, receiving rewards or penalties for actions. An agent learns the best strategy to maximize rewards.

```
┌─────────────────────────────────────────────────────────────────┐
│              Reinforcement Learning Loop                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                   ┌─────────┐                                   │
│                   │  Agent  │                                   │
│                   │ (Brain) │                                   │
│                   └────┬────┘                                   │
│                        │                                        │
│                   ┌────┴────┐                                   │
│                   │ Action  │                                   │
│                   └────┬────┘                                   │
│                        │                                        │
│                   ┌────┴────┐                                   │
│                   │   Env   │                                   │
│                   │(World)  │                                   │
│                   └────┬────┘                                   │
│                        │                                        │
│                   ┌────┴────┐                                   │
│                   │ Reward  │←────────── Positive/negative      │
│                   └────┬────┘    feedback                      │
│                        │                                        │
│                   ┌────┴────┐                                   │
│                   │  State  │                                   │
│                   │ (Observe)│◀────────── Current situation    │
│                   └─────────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

```python
# Simple RL example: Learning to play a game

class RLAgent:
    def __init__(self):
        self.policy = {}  # State → Action mapping
    
    def learn(self, episodes):
        for episode in episodes:
            state = episode.start_state
            
            while not episode.ended:
                # Choose action based on current policy + exploration
                action = self.choose_action(state)
                
                # Take action, observe result
                reward, next_state = episode.step(action)
                
                # Update policy based on reward
                self.update_policy(state, action, reward)
                
                state = next_state

# The agent learns:
# - Which actions lead to higher rewards
# - Which situations require which actions
# - The optimal strategy for the environment
```

### RL Terminology

```python
TERMINOLOGY = {
    "agent": "The learner/decision maker",
    "environment": "The world the agent interacts with",
    "state": "Current situation of the agent",
    "action": "What the agent does",
    "reward": "Feedback from environment (+ or -)",
    "policy": "Strategy the agent uses to choose actions",
    "episode": "One complete run from start to end",
    "value": "Expected future reward from a state",
    "Q-value": "Expected reward for action in state",
}
```

### Real-World RL Examples

| Application | How RL is Used |
|------------|---------------|
| **Game Playing** | AlphaGo, chess bots, video game AIs |
| **Robotics** | Robot locomotion, manipulation |
| **Autonomous Vehicles** | Driving policy learning |
| **Recommendation Systems** | Optimizing user engagement |
| **Resource Management** | Data center cooling optimization |
| **Trading** | Portfolio management strategies |

---

## Comparison Table

| Aspect | Supervised | Unsupervised | Reinforcement |
|--------|------------|--------------|---------------|
| **Data** | Labeled data | Unlabeled data | No fixed dataset |
| **Goal** | Predict labels | Find patterns | Maximize rewards |
| **Feedback** | Direct (correct answer) | Indirect (no answer) | Delayed (rewards) |
| **Complexity** | Easier to evaluate | Harder to evaluate | Very complex |
| **Examples** | Classification, regression | Clustering, dimensionality | Games, robotics |
| **Training** | From labeled examples | From data patterns | From experience |

---

## Choosing the Right Type

```python
def choose_ml_type(problem):
    """Which ML type should you use?"""
    
    # Do you have labels?
    if problem.has_labels:
        if problem.output_type == "category":
            return "Supervised: Classification"
        else:
            return "Supervised: Regression"
    
    # Do you want to find hidden structure?
    if problem.want_groups:
        return "Unsupervised: Clustering"
    
    # Do you learn from interaction?
    if problem.interactive:
        return "Reinforcement Learning"
    
    # Default to supervised if you can label data
    return "Start with supervised if possible"
```

### Decision Guide

```
Is your output a category or number?
         │
         ▼
    ┌────────┐         ┌─────────┐
    │ Number │────────▶│Regression│
    └────────┘         └─────────┘
         │
    Is there a label?
         │
         ▼
    ┌────────┐         ┌─────────┐
    │  Yes   │────────▶│Supervised│
    └────────┘         └─────────┘
         │
         ▼
    ┌────────┐         ┌─────────┐
    │   No   │────────▶│Unsupervised│
    └────────┘         └─────────┘

Is the agent learning from interaction?
         │
         ▼
    ┌────────┐         ┌─────────┐
    │  Yes   │────────▶│Reinforcement│
    └────────┘         └─────────┘
```

---

## Practical Example: All Three Types

```python
# Scenario: Building a recommendation system

# SUPERVISED: Predict user rating
# "Given user's past ratings, predict their rating for this item"
from sklearn.ensemble import GradientBoostingRegressor
model = GradientBoostingRegressor()
model.fit(X_user_history, y_ratings)
predicted_rating = model.predict([user_features])

# UNSUPERVISED: Segment users
# "Find groups of similar users"
from sklearn.cluster import KMeans
user_segments = KMeans(n_clusters=5).fit_predict(user_features)
# Found: "Gamers", "Shoppers", "Readers", etc.

# REINFORCEMENT: Optimize recommendations
# "Learn which items to recommend to maximize engagement"
class RecommenderAgent:
    def get_recommendation(self, user_state):
        # Explore: Try new items
        # Exploit: Recommend known favorites
        # Learn from user feedback (click/no-click)
```

---

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| **Using supervised when you need RL** | Wrong approach for interactive problems | Use RL for agent-based learning |
| **Expecting labels in unsupervised** | Unsupervised doesn't have answers | Evaluate by business metrics |
| **Choosing wrong problem type** | Classification vs regression confusion | Define output clearly first |
| **Ignoring data requirements** | RL needs lots of interaction | Consider if RL is feasible |

---

## Summary

| Type | Input | Output | Examples |
|------|-------|--------|----------|
| **Supervised** | Data + Labels | Predictions | Spam detection, price prediction |
| **Unsupervised** | Data only | Discover patterns | Customer segments, anomalies |
| **Reinforcement** | Agent + Environment | Learned policy | Games, robotics, trading |

**Key insight:** Choose your type based on:
1. Do you have labels? → Supervised
2. Do you want to find structure? → Unsupervised
3. Do you learn from interaction? → Reinforcement

**Next:** Continue to `supervised-learning.md` to deep dive into supervised learning.

---

## References

- [Scikit-learn Supervised](https://scikit-learn.org/stable/supervised_learning.html)
- [Scikit-learn Unsupervised](https://scikit-learn.org/stable/unsupervised_learning.html)
- [OpenAI Spinning Up - RL](https://spinningup.openai.com/)
- [Reinforcement Learning Book](http://incompleteideas.net/book/the-book.html)
