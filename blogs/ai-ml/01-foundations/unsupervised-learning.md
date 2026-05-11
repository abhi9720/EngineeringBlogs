---
title: "Unsupervised Learning"
description: "Learn unsupervised learning - clustering, dimensionality reduction, and finding patterns without labeled data"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - Machine Learning
  - Unsupervised Learning
  - Clustering
  - Dimensionality Reduction
  - Fundamentals
coverImage: "/images/unsupervised-learning.png"
draft: false
---

# Unsupervised Learning

## Overview

Unsupervised learning discovers hidden patterns in data without any labels. The algorithm explores the data structure and finds groups, relationships, or anomalies without being told what to look for.

**Think of it as:** Learning without a teacher - the algorithm discovers patterns on its own.

---

## When to Use Unsupervised Learning

```
┌─────────────────────────────────────────────────────────────────┐
│              When to Use Unsupervised Learning                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ You have data but NO labels                                │
│  ✅ You want to discover hidden structure                      │
│  ✅ You want to segment customers/users into groups            │
│  ✅ You need to reduce data complexity                         │
│  ✅ You want to find anomalies/outliers                        │
│  ✅ You want to preprocess data for other ML tasks             │
│                                                                 │
│  ❌ You know exactly what categories exist → Use supervised   │
│  ❌ You have labeled data → Use supervised                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Use Cases by Industry

| Industry | Application |
|----------|------------|
| **Retail** | Customer segmentation, market basket analysis |
| **Finance** | Fraud detection, anomaly in transactions |
| **Healthcare** | Patient clustering, disease subtypes |
| **Security** | Network intrusion detection |
| **Marketing** | Audience segmentation, behavioral analysis |
| **Manufacturing** | Defect detection, quality control |

---

## Two Main Categories

### 1. Clustering (Group Similar Items)

```
┌─────────────────────────────────────────────────────────────────┐
│              Clustering Example                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Data Points:                        Discovered Groups:       │
│                                                                 │
│     *     *                              ● ● ●                 │
│       *     *       →               ●   ●   ●   ●              │
│         *   *                            ● ●                   │
│    *       *                                                │
│                                                                 │
│  Input: Data without labels                                     │
│  Output: Data points assigned to groups (clusters)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Dimensionality Reduction (Compress Data)

```
┌─────────────────────────────────────────────────────────────────┐
│              Dimensionality Reduction                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  High Dimensions (100 features)    Low Dimensions (2 features)  │
│  ─────────────────────────────    ───────────────────────────  │
│                                                                 │
│       x₁ ┬                              ●                        │
│       x₂ ┤                              ●                        │
│       x₃ │      Compress         ●                              │
│       .. │      + Simplify       ●  ●                           │
│       x₁₀₀┘                      ●                              │
│                                                                 │
│  Goal: Keep important information, remove noise                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Clustering: K-Means Algorithm

### How K-Means Works

```python
from sklearn.cluster import KMeans
import numpy as np

# Customer data: [age, income, spending_score]
X = np.array([
    [25, 30000, 80],   # Young, low income, high spending
    [30, 40000, 75],   # Young, medium income, high spending
    [45, 80000, 20],   # Older, high income, low spending
    [50, 90000, 15],   # Older, high income, low spending
    [22, 25000, 90],   # Young, low income, very high spending
    [48, 75000, 30],   # Older, medium income, low spending
])

# Find 2 clusters
kmeans = KMeans(n_clusters=2, random_state=42)
kmeans.fit(X)

# Get cluster labels
labels = kmeans.labels_
print(f"Cluster assignments: {labels}")

# Cluster centers
centers = kmeans.cluster_centers_
print(f"Cluster centers: {centers}")

# Predict new point
new_customer = [[30, 50000, 60]]
cluster = kmeans.predict(new_customer)
print(f"New customer belongs to cluster: {cluster[0]}")
```

### Finding Optimal Number of Clusters

```python
import matplotlib.pyplot as plt

inertias = []
K_range = range(1, 10)

for k in K_range:
    kmeans = KMeans(n_clusters=k, random_state=42)
    kmeans.fit(X)
    inertias.append(kmeans.inertia_)

plt.plot(K_range, inertias, 'bo-')
plt.xlabel('Number of Clusters (k)')
plt.ylabel('Inertia (within-cluster sum of squares)')
plt.title('Elbow Method')
plt.show()

# Look for the "elbow" - where adding more clusters
# doesn't significantly reduce inertia
```

### Practical Example: Customer Segmentation

```python
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

# Load customer data
df = pd.read_csv('customer_data.csv')
X = df[['age', 'income', 'spending_score', 'website_visits']]

# Scale features (important!)
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Find optimal k using silhouette score
from sklearn.metrics import silhouette_score

for k in [2, 3, 4, 5]:
    kmeans = KMeans(n_clusters=k, random_state=42)
    labels = kmeans.fit_predict(X_scaled)
    score = silhouette_score(X_scaled, labels)
    print(f"k={k}: Silhouette Score = {score:.3f}")

# Use best k
best_k = 4
kmeans = KMeans(n_clusters=best_k, random_state=42)
df['segment'] = kmeans.fit_predict(X_scaled)

# Analyze segments
for seg in df['segment'].unique():
    seg_data = df[df['segment'] == seg]
    print(f"\nSegment {seg}:")
    print(f"  Count: {len(seg_data)}")
    print(f"  Avg Income: ${seg_data['income'].mean():,.0f}")
    print(f"  Avg Spending: {seg_data['spending_score'].mean():.0f}")
```

---

## DBSCAN: Density-Based Clustering

### When K-Means Fails

```python
# K-Means problems:
# - Assumes spherical clusters
# - Requires specifying k beforehand
# - Sensitive to outliers

# DBSCAN advantages:
# - Finds arbitrary shaped clusters
# - Automatically finds number of clusters
# - Identifies outliers
```

### DBSCAN Implementation

```python
from sklearn.cluster import DBSCAN

# eps: Maximum distance between points in a cluster
# min_samples: Minimum points to form a cluster
dbscan = DBSCAN(eps=5000, min_samples=3)

labels = dbscan.fit_predict(X)

print(f"Cluster labels: {labels}")
# -1 means noise/outlier

# Count outliers
outliers = sum(labels == -1)
print(f"Outliers detected: {outliers}")
```

### Comparison: K-Means vs DBSCAN

| Aspect | K-Means | DBSCAN |
|--------|---------|--------|
| **Cluster shape** | Spherical | Arbitrary |
| **k required** | Yes | No |
| **Outliers** | Assigned to cluster | Labeled as -1 |
| **Scalability** | Good | Moderate |
| **Use when** | You know number of clusters | Unknown cluster count |

---

## Hierarchical Clustering

### Build a Hierarchy of Clusters

```python
from sklearn.cluster import AgglomerativeClustering
import scipy.cluster.hierarchy as hierarchy

# Create hierarchy
clustering = AgglomerativeClustering(
    n_clusters=3,
    linkage='ward'  # ward minimizes variance
)
labels = clustering.fit_predict(X)

# Visualize dendrogram
import matplotlib.pyplot as plt

Z = hierarchy.linkage(X, method='ward')
hierarchy.dendrogram(Z)
plt.title('Hierarchical Clustering Dendrogram')
plt.xlabel('Sample Index')
plt.ylabel('Distance')
plt.show()
```

---

## Dimensionality Reduction

### PCA: Principal Component Analysis

**Goal:** Reduce features while keeping variance

```python
from sklearn.decomposition import PCA

# 100 features → 10 features
pca = PCA(n_components=10)

X_reduced = pca.fit_transform(X_100_features)

# Variance retained
print(f"Variance explained: {pca.explained_variance_ratio_.sum():.2%}")

# Explained by each component
for i, var in enumerate(pca.explained_variance_ratio_):
    print(f"PC{i+1}: {var:.2%}")
```

### Choosing Number of Components

```python
import matplotlib.pyplot as plt

# Fit PCA with all components
pca = PCA()
pca.fit(X)

# Plot cumulative variance
cumulative_var = pca.explained_variance_ratio_.cumsum()
plt.plot(range(1, len(cumulative_var)+1), cumulative_var, 'bo-')
plt.xlabel('Number of Components')
plt.ylabel('Cumulative Variance Explained')
plt.axhline(y=0.95, color='r', linestyle='--', label='95% variance')
plt.legend()
plt.show()

# Find components needed for 95% variance
n_components = (cumulative_var < 0.95).sum() + 1
print(f"Components for 95% variance: {n_components}")
```

### Practical Example: Image Compression

```python
from sklearn.decomposition import PCA
from sklearn.datasets import load_sample_image
import numpy as np

# Load image (example: flower image)
image = load_sample_image('flower.jpg')
X = image.reshape(-1, 3)  # Flatten to pixels

# Reduce to 50 principal components
pca = PCA(n_components=50)
X_compressed = pca.fit_transform(X)

# Reconstruct
X_reconstructed = pca.inverse_transform(X_compressed)
image_reconstructed = X_reconstructed.reshape(image.shape)

print(f"Original size: {image.nbytes} bytes")
print(f"Compressed size: {X_compressed.nbytes} bytes")
print(f"Compression ratio: {image.nbytes / X_compressed.nbytes:.1f}x")
```

---

## t-SNE: Visualization

### Visualize High-Dimensional Data in 2D

```python
from sklearn.manifold import TSNE
from sklearn.datasets import load_digits

# Load digits dataset (8x8 images = 64 dimensions)
digits = load_digits()
X_embedded = TSNE(n_components=2, random_state=42).fit_transform(digits.data)

# Plot
import matplotlib.pyplot as plt

plt.figure(figsize=(10, 8))
scatter = plt.scatter(X_embedded[:, 0], X_embedded[:, 1],
                      c=digits.target, cmap='tab10', alpha=0.6)
plt.colorbar(scatter)
plt.title('t-SNE Visualization of Digits')
plt.show()
```

---

## Anomaly Detection

### Find Outliers in Your Data

```python
from sklearn.ensemble import IsolationForest

# Detect anomalies
iso_forest = IsolationForest(contamination=0.05)  # Expect 5% outliers

predictions = iso_forest.fit_predict(X)

# -1 = anomaly, 1 = normal
anomalies = X[predictions == -1]
normal = X[predictions == 1]

print(f"Anomalies detected: {len(anomalies)}")
print(f"Normal points: {len(normal)}")
```

### Alternative: Local Outlier Factor

```python
from sklearn.neighbors import LocalOutlierFactor

lof = LocalOutlierFactor(n_neighbors=20, contamination=0.05)
predictions = lof.fit_predict(X)

# Outliers have score < -1
outlier_scores = lof.negative_outlier_factor_
```

---

## Evaluation of Clustering

### Silhouette Score

```python
from sklearn.metrics import silhouette_score

# Range: -1 to 1
# Higher is better

for k in [2, 3, 4, 5]:
    kmeans = KMeans(n_clusters=k, random_state=42)
    labels = kmeans.fit_predict(X_scaled)
    
    score = silhouette_score(X_scaled, labels)
    print(f"k={k}: Silhouette Score = {score:.3f}")
```

### Interpretation Guide

| Score | Interpretation |
|-------|----------------|
| **> 0.7** | Strong cluster structure |
| **0.5-0.7** | Reasonable structure |
| **0.25-0.5** | Weak structure |
| **< 0.25** | No substantial structure |

---

## Best Practices

1. **Scale features before clustering**
   ```python
   from sklearn.preprocessing import StandardScaler
   scaler = StandardScaler()
   X_scaled = scaler.fit_transform(X)
   ```

2. **Try multiple algorithms** - Different algorithms find different patterns

3. **Validate business-wise** - Statistical clusters should make business sense

4. **Use visualization** - t-SNE helps understand clusters

5. **Handle outliers** - Decide if outliers are noise or important

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| **Not scaling** | Features with larger values dominate | Scale all features |
| **Ignoring outliers** | Can distort clusters | Analyze outliers separately |
| **Wrong k** | Clusters don't reflect reality | Use elbow/silhouette methods |
| **Expecting labels** | No ground truth to compare | Use business validation |
| **Too many clusters** | Overfitting, no actionable segments | Balance complexity and utility |

---

## Summary

| Technique | Purpose | Key Algorithm |
|-----------|---------|---------------|
| **Clustering** | Group similar items | K-Means, DBSCAN |
| **Dimensionality Reduction** | Compress features | PCA, t-SNE |
| **Anomaly Detection** | Find outliers | Isolation Forest |

**Key steps:**
1. Scale features
2. Choose algorithm based on data
3. Find optimal parameters
4. Validate with domain knowledge

**Next:** Continue to `ml-lifecycle.md` to understand the complete ML project lifecycle.

---

## References

- [Scikit-learn Clustering](https://scikit-learn.org/stable/modules/clustering.html)
- [Scikit-learn Decomposition](https://scikit-learn.org/stable/modules/decomposition.html)
- [K-Means Clustering Guide](https://scikit-learn.org/stable/auto_examples/cluster/plot_kmeans_digits.html)