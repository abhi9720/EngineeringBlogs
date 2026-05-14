---
title: "Django REST Framework"
description: "Master Django REST Framework: views, serializers, authentication, permissions, viewsets, routers, and building production-ready REST APIs with Django"
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - python
  - django
  - rest-api
  - drf
coverImage: "/images/django-rest-framework.png"
draft: false
---

## Overview

Django REST Framework (DRF) is a powerful and flexible toolkit for building Web APIs in Django. It provides serializers, authentication, permissions, viewsets, and browsable APIs out of the box.

## Setup

```python
# settings.py
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'myapp',
]

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 10,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_VERSIONING_CLASS': 'rest_framework.versioning.NamespaceVersioning',
}
```

## Serializers

### ModelSerializer

```python
from rest_framework import serializers
from .models import User, Order, Product


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    order_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = ['id', 'email', 'full_name', 'role', 'is_active',
                  'created_at', 'order_count']
        read_only_fields = ['id', 'created_at']

    def get_full_name(self, obj):
        return f"{obj.first_name} {obj.last_name}".strip()

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("Email already exists")
        return value
```

### Nested Serializers

```python
class OrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    subtotal = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True
    )

    class Meta:
        model = OrderItem
        fields = ['id', 'product', 'product_name', 'quantity',
                  'unit_price', 'subtotal']


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ['id', 'user', 'user_email', 'items', 'total',
                  'status', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_total(self, obj):
        return sum(item.subtotal for item in obj.items.all())
```

### Custom Validation

```python
class CreateOrderSerializer(serializers.Serializer):
    product_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1
    )
    quantities = serializers.ListField(
        child=serializers.IntegerField(min_value=1)
    )
    shipping_address = serializers.CharField(max_length=500)
    coupon_code = serializers.CharField(required=False, max_length=20)

    def validate(self, data):
        if len(data['product_ids']) != len(data['quantities']):
            raise serializers.ValidationError(
                "product_ids and quantities must have same length"
            )

        products = Product.objects.filter(id__in=data['product_ids'])
        if len(products) != len(data['product_ids']):
            raise serializers.ValidationError("Some products not found")

        for product, qty in zip(products, data['quantities']):
            if product.stock < qty:
                raise serializers.ValidationError(
                    f"Insufficient stock for {product.name}"
                )

        data['products'] = products
        return data
```

## Views

### Function-Based Views

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def user_list(request):
    if request.method == 'GET':
        users = User.objects.all()
        paginator = PageNumberPagination()
        result_page = paginator.paginate_queryset(users, request)
        serializer = UserSerializer(result_page, many=True)
        return paginator.get_paginated_response(serializer.data)

    elif request.method == 'POST':
        serializer = UserSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
```

### Class-Based Views

```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status


class UserDetail(APIView):
    def get_object(self, pk):
        try:
            return User.objects.get(pk=pk)
        except User.DoesNotExist:
            raise Http404

    def get(self, request, pk):
        user = self.get_object(pk)
        serializer = UserSerializer(user)
        return Response(serializer.data)

    def put(self, request, pk):
        user = self.get_object(pk)
        serializer = UserSerializer(user, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        user = self.get_object(pk)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

### Viewsets

```python
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter,
                       filters.OrderingFilter]
    filterset_fields = ['role', 'is_active']
    search_fields = ['email', 'first_name', 'last_name']
    ordering_fields = ['created_at', 'email']
    ordering = ['-created_at']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        user.is_active = False
        user.save()
        return Response({'status': 'user deactivated'})

    @action(detail=False, methods=['get'])
    def admins(self, request):
        admins = self.get_queryset().filter(role='admin')
        page = self.paginate_queryset(admins)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=['get'])
    def orders(self, request, pk=None):
        user = self.get_object()
        orders = Order.objects.filter(user=user)
        serializer = OrderSerializer(orders, many=True)
        return Response(serializer.data)
```

## Authentication and Permissions

### Custom Permission

```python
from rest_framework.permissions import BasePermission


class IsAdminOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        return request.user and request.user.is_staff


class IsOwnerOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True
        return obj.user == request.user


class IsAdminUser(BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.role == 'admin'
```

### Applying Permissions

```python
from rest_framework.permissions import IsAuthenticated


class OrderViewSet(viewsets.ModelViewSet):
    queryset = Order.objects.all()
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]

    def get_queryset(self):
        if self.request.user.is_staff:
            return Order.objects.all()
        return Order.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminUser])
def admin_dashboard(request):
    stats = {
        'total_users': User.objects.count(),
        'total_orders': Order.objects.count(),
        'revenue': Order.objects.filter(status='completed')
            .aggregate(total=Sum('total'))['total']
    }
    return Response(stats)
```

## Routing

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UserViewSet, OrderViewSet

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'orders', OrderViewSet)

urlpatterns = [
    path('api/', include(router.urls)),
    path('api/admin/', admin_dashboard),
    path('api-auth/', include('rest_framework.urls')),
]
```

## Testing

```python
from rest_framework.test import APITestCase, APIClient
from rest_framework import status
from django.contrib.auth import get_user_model


class UserAPITestCase(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            email='test@example.com',
            password='testpass123',
            first_name='Test',
            last_name='User'
        )
        self.client.force_authenticate(user=self.user)

    def test_list_users(self):
        response = self.client.get('/api/users/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data['results']), 1)

    def test_create_user(self):
        data = {
            'email': 'new@example.com',
            'password': 'newpass123',
            'first_name': 'New',
            'last_name': 'User'
        }
        response = self.client.post('/api/users/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['email'], 'new@example.com')

    def test_unauthenticated_access(self):
        self.client.force_authenticate(user=None)
        response = self.client.get('/api/users/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
```

## Best Practices

1. **Use ModelSerializer** for standard CRUD operations
2. **Use ViewSets and Routers** for consistent API structure
3. **Implement proper permissions** at view and object level
4. **Use serializers for validation** and deserialization
5. **Paginate list endpoints** for performance
6. **Use filtering, searching, and ordering** backends
7. **Write API tests** with APITestCase

## Common Mistakes

### Mistake 1: Inefficient Queries

```python
# Wrong: N+1 query problem
class OrderSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.name')

    class Meta:
        model = Order
        fields = '__all__'
        # Each order triggers a separate user query
```

```python
# Correct: Select related
class OrderViewSet(viewsets.ModelViewSet):
    queryset = Order.objects.select_related('user').all()
    serializer_class = OrderSerializer
```

### Mistake 2: Overly Permissive Permissions

```python
# Wrong: No permission check
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    # Anyone can access any endpoint
```

```python
# Correct: Proper permission configuration
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrAdmin]
```

## Summary

Django REST Framework provides a comprehensive toolkit for building Web APIs. Use serializers for validation and deserialization, viewsets for CRUD operations, and proper authentication/permission classes for security. Leverage DRF's filtering, pagination, and versioning features for production-ready APIs.

## References

- [Django REST Framework Documentation](https://www.django-rest-framework.org/)
- [DRF Serializers](https://www.django-rest-framework.org/api-guide/serializers/)
- [DRF Viewsets](https://www.django-rest-framework.org/api-guide/viewsets/)
- [DRF Permissions](https://www.django-rest-framework.org/api-guide/permissions/)

Happy Coding