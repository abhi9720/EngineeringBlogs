---
title: "How the Web Works"
description: "Understanding the web from URL to page render - DNS, HTTP, browsers, and the rendering pipeline."
date: "2026-05-11"
author: "Abhishek Tiwari"
tags:
  - web
  - http
  - dns
  - browser
  - frontend
coverImage: "/images/frontend/how-web-works.png"
draft: false
---

# How the Web Works: The Complete Guide

## Overview

When you type a URL in your browser and hit Enter, a complex sequence of events occurs. Understanding this pipeline helps you debug issues, optimize performance, and become a better developer.

---

## From URL to Page

### Step 1: URL Parsing

```javascript
// What happens when you type:
// https://example.com:443/blog/post?id=123#section

const url = new URL('https://example.com:443/blog/post?id=123#section');

console.log(url.protocol); // 'https:'
console.log(url.host);     // 'example.com:443'
console.log(url.port);     // '443'
console.log(url.pathname); // '/blog/post'
console.log(url.search);   // '?id=123'
console.log(url.hash);     // '#section'
```

### Step 2: DNS Lookup

```javascript
// DNS translates domain to IP address

// DNS resolution sequence:
// 1. Browser cache
// 2. OS cache
// 3. Router cache
// 4. ISP DNS server
// 5. Root DNS server (.com)
// 6. TLD DNS server (example.com)
// 7. Authoritative DNS server

// dig example.com shows:
/*
;; QUESTION
example.com.	IN	A

;; ANSWER
example.com.	86400	IN	A	93.184.216.34
*/
```

### Step 3: TCP Connection

```javascript
// TCP handshake (3-way handshake)

/*
Client                    Server
  |                         |
  |──── SYN ──────────────▶|
  |                         |
  |──── SYN-ACK ──────────▶|
  |                         |
  |──── ACK ──────────────▶|
  |                         |
  |   Connection established|
*/

// TLS/SSL handshake (for HTTPS)
if (protocol === 'https') {
  // 1. Client sends supported cipher suites
  // 2. Server picks cipher, sends certificate
  // 3. Client verifies certificate
  // 4. Generate session keys
  // 5. Encrypted connection ready
}
```

### Step 4: HTTP Request

```javascript
// HTTP/1.1 Request
const request = `GET /blog/post?id=123 HTTP/1.1
Host: example.com
User-Agent: Mozilla/5.0
Accept: text/html,application/xhtml+xml
Accept-Language: en-US,en;q=0.9
Connection: keep-alive

`;

// HTTP Methods
// GET - retrieve data
// POST - submit data
// PUT - update data
// DELETE - remove data
// PATCH - partial update
```

### Step 5: HTTP Response

```javascript
// HTTP/1.1 Response
const response = `HTTP/1.1 200 OK
Date: Mon, 27 Jul 2026 12:00:00 GMT
Content-Type: text/html; charset=UTF-8
Content-Length: 5234
Cache-Control: max-age=3600

<!DOCTYPE html>
<html>
...
</html>
```

---

## Browser Rendering Pipeline

### Step 1: Parsing HTML

```javascript
// Browser converts HTML to DOM tree
// Parser reads tags, creates nodes

// Input:
/*
<html>
  <head><title>Page</title></head>
  <body>
    <h1>Hello</h1>
  </body>
</html>
*/

// DOM Tree:
/*
DOCUMENT
 └─ HTML
     ├─ HEAD
     │   └─ TITLE → "Page"
     └─ BODY
         └─ H1 → "Hello"
*/
```

### Step 2: Parsing CSS

```javascript
// CSS Parser creates CSSOM (CSS Object Model)

// CSSOM Tree:
/*
STYLESHEET
 ├─ h1 { color: blue }
 └─ body { margin: 0 }
*/
```

### Step 3: Render Tree

```javascript
// Combine DOM + CSSOM = Render Tree

/*
Render Tree
 ├─ html (root)
 │  ├─ head
 │  │  └─ title
 │  └─ body
 │     └─ h1 (with styles: color: blue, font-size: 32px)
*/
```

### Step 4: Layout (Reflow)

```javascript
// Calculate position and size of each element

// Layout tree:
// - Each node gets x, y, width, height
// - Dependent on parent and sibling dimensions

// Reflow triggered by:
// - Initial page load
// - Window resize
// - Content changes
// - Style changes
```

### Step 5: Paint

```javascript
// Draw pixels to layers

// Paint operations:
// - Backgrounds
// - Borders  
// - Text
// - Shadows

// Layers can be:
// - Promoted (will-change, transform, opacity)
// - Composited separately
```

### Step 6: Composite

```javascript
// Combine layers for final display

/*
Layers:
1. Background layer
2. Content layer  
3. Fixed position layer

Composite combines into final image
*/
```

---

## Key Protocols

### HTTP/1.1 vs HTTP/2 vs HTTP/3

```javascript
// HTTP/1.1
// - Single connection per origin
// - Text-based
// - Head-of-line blocking (one request at a time)

// HTTP/2
// - Multiplexed (multiple streams)
// - Binary
// - Header compression
// - Server push

// HTTP/3
// - Uses QUIC (UDP-based)
// - Even faster handshake
// - Better on unreliable networks
```

### Caching

```javascript
// Cache-Control headers
response.headers = {
  'Cache-Control': 'max-age=3600',      // Cache for 1 hour
  'Cache-Control': 'no-cache',          // Always check with server
  'Cache-Control': 'no-store',          // Don't cache at all
  'Cache-Control': 'public',             // Can be cached by proxies
  'Cache-Control': 'private',            // Only browser cache
  'ETag': 'abc123',                     // Version identifier
  'Last-Modified': 'Mon, 27 Jul 2026'   // Timestamp
};
```

---

## Performance Factors

### Critical Rendering Path

```javascript
// Optimize for fast first paint:
/*
1. Minimize resources (CSS, JS)
2. Inline critical CSS
3. Defer non-critical JS
4. Preload critical assets
5. Compress resources (Gzip, Brotli)
*/
```

### Time to First Byte (TTFB)

```javascript
// Factors affecting TTFB:
// - Server processing time
// - Database queries
// - CDN proximity
// - Network latency

// Optimize:
// - Use CDN
// - Cache responses
// - Optimize database
// - Use fast hosting
```

---

## Summary

1. **URL → IP**: DNS resolution
2. **TCP/TLS**: Connection establishment
3. **HTTP**: Request/response
4. **HTML Parse**: Build DOM
5. **CSS Parse**: Build CSSOM
6. **Render Tree**: Combine DOM + CSSOM
7. **Layout**: Calculate positions
8. **Paint**: Draw pixels
9. **Composite**: Final display

Understanding this pipeline helps you optimize web performance at every level.

---

## References

- [How the Web Works - Stanford](https://web.stanford.edu/class/msande91si/www-samples04/lecture/HowTheWebWorks.pdf)
- [MDN - How the Web Works](https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/How_the_Web_works)
- [High Performance Browser Networking](https://hpbn.co/)