# Sentry SDK Playground

> A multi-mode testing platform for Sentry SDK features across 12 languages

## Overview

**Learn by doing.** The SDK Playground is a comprehensive testing platform for Sentry SDK features. Test event transformation callbacks, sampling strategies, filter patterns, webhook integrations, and configuration analysis—all in a safe sandbox environment. With **9 specialized testing modes**, **50+ pre-built examples**, and support for **12 SDK languages**, you can master Sentry integration patterns before touching production.

**Key Capabilities:**
- **9 Testing Modes** - Before Send, Fingerprinting, Before Send Transaction, Before Breadcrumb, Traces Sampler, Pattern Tester, Config Analyzer, API Query Tester, Webhooks
- **12 SDK Languages** - JavaScript, Python, Ruby, PHP, Go, .NET, Java, Android, Cocoa, React Native, Rust, Elixir
- **50+ Example Templates** - Real-world patterns for PII scrubbing, sampling, filtering, and more
- **Visual Diff Viewer** - Side-by-side comparison of original vs transformed data
- **Real-time Validation** - Catch syntax errors before execution
- **Secure Sharing** - Share configurations with automatic PII scrubbing

## Quick Start

**Requirements:** Docker & Docker Compose (that's it!)

```bash
# 1. Clone and navigate to the repository
cd sdk-playground

# 2. Build and start all services
docker-compose up -d

# 3. Open the playground
open http://localhost:3000
```

The playground will be available at **http://localhost:3000**

### Choose Your Mode

| Mode | Purpose | Use When |
|------|---------|----------|
| **Before Send** | Transform error events | Scrubbing PII, adding tags, filtering errors |
| **Fingerprinting** | Control issue grouping | Normalizing dynamic data, custom grouping rules |
| **Before Send Transaction** | Transform performance data | Filtering health checks, adding context |
| **Before Breadcrumb** | Filter navigation/console logs | Reducing noise, scrubbing URLs |
| **Traces Sampler** | Dynamic sampling rates | Cost optimization, critical endpoint prioritization |
| **Pattern Tester** | Test filter patterns | Validating ignoreErrors/denyUrls |
| **Config Analyzer** | Validate SDK configuration | Reviewing Sentry.init() setup |
| **API Query Tester** | Test search queries | Building API integrations |
| **Webhooks** | Test webhook integrations | Debugging signature verification |

## Mode Overview

### Before Send Mode

Transform error events before they are sent to Sentry. Use it to:
- Scrub PII (emails, IPs, tokens)
- Add custom tags and context
- Filter noisy errors
- Modify exception values

**Example:**
```javascript
(event, hint) => {
  // Redact sensitive user data
  if (event.user?.email) {
    event.user.email = '[REDACTED]';
  }
  return event;
}
```

### Fingerprinting Mode

Control how Sentry groups errors into issues. This is a convenience mode for testing fingerprinting via beforeSend. Use it to:
- Normalize dynamic data (user IDs, database instances)
- Group similar errors together
- Split overly-broad groupings by context

**Example:**
```javascript
(event, hint) => {
  // Group all database errors together regardless of instance
  if (event.message?.includes('Database connection failed')) {
    event.fingerprint = ['database-connection-error'];
  }
  return event;
}
```

### Before Send Transaction Mode

Transform transaction events before sending. Use it to:
- Drop health check transactions
- Add business context
- Modify transaction names
- Filter by endpoint

**Example:**
```javascript
(transaction, hint) => {
  // Drop health check transactions
  if (transaction.transaction === 'GET /health') {
    return null;
  }
  return transaction;
}
```

### Before Breadcrumb Mode

Filter and modify breadcrumbs before they're added to events. Use it to:
- Drop noisy console logs
- Scrub tokens from URLs
- Categorize breadcrumbs
- Reduce breadcrumb volume

**Example:**
```javascript
(breadcrumb, hint) => {
  // Drop console breadcrumbs
  if (breadcrumb.category === 'console') {
    return null;
  }
  // Scrub tokens from navigation URLs
  if (breadcrumb.data?.to) {
    breadcrumb.data.to = breadcrumb.data.to.replace(/token=[^&]+/, 'token=[REDACTED]');
  }
  return breadcrumb;
}
```

### Traces Sampler Mode

Implement dynamic sampling strategies for performance monitoring. Use it to:
- Sample critical endpoints at higher rates
- Drop health checks entirely
- Implement user-based sampling
- Optimize tracing costs

**Example:**
```javascript
(samplingContext) => {
  const name = samplingContext.transactionContext.name;

  // Always sample payment endpoints
  if (name.includes('/payment')) {
    return 1.0; // 100%
  }

  // Never sample health checks
  if (name === 'GET /health') {
    return 0.0; // 0%
  }

  return 0.1; // 10% default
}
```

**Output:** Visual sampling rate indicator showing the percentage and what portion of transactions will be sent vs dropped.

### Webhooks Mode

Test Sentry webhook payloads with HMAC-SHA256 signature generation and verification. Use it to:
- Debug webhook integrations
- Test signature verification code
- Inspect webhook payload structures
- Demonstrate webhook security to customers

**Available Templates:**
- Issue Alert - Created/Resolved/Assigned
- Metric Alert
- Error Event
- Comment Created

### Config Analyzer Mode

Analyze and validate Sentry.init() configurations. Use it to:
- Validate configuration syntax
- Understand what each option does
- Get SE-focused recommendations
- Identify potential issues

**Supported SDKs:** JavaScript, Python, Ruby, PHP, Go, .NET, Java, Android, Cocoa

### API Query Tester Mode

Test and validate Sentry API search queries. Use it to:
- Validate query syntax in real-time
- Get property suggestions for typos
- Execute queries against real data
- Generate ready-to-use cURL commands

**Example Queries:**
```
is:unresolved level:error
assigned:me
level:fatal age:-24h
!user.email:*@internal.com
```

### Pattern Tester Mode

Test ignoreErrors, denyUrls, and allowUrls filter patterns. Use it to:
- Validate regex patterns before deployment
- Test patterns against sample inputs
- Generate Sentry.init() configuration code
- Understand pattern matching behavior

**Pattern Types:**
- **ignoreErrors** - String/regex patterns for error messages
- **denyUrls** - URL patterns to exclude from error reporting
- **allowUrls** - URL patterns to include (whitelist mode)

## Supported SDKs

| SDK | Language | Real-time Validation | Compilation |
|-----|----------|---------------------|-------------|
| JavaScript | javascript | ✅ ESLint | - |
| Python | python | ✅ ast.parse() | - |
| Ruby | ruby | ✅ ruby -c | - |
| PHP | php | ✅ php -l | - |
| Go | go | ✅ go build | ✅ |
| .NET | csharp | ✅ dotnet build | ✅ |
| Java | java | - | - |
| Android | kotlin | - | - |
| Cocoa | swift | - | - |
| React Native | javascript | ✅ ESLint | - |
| Rust | rust | ✅ cargo check | ✅ |
| Elixir | elixir | - | - |

## Example Templates

The playground includes **50+ pre-built examples** organized by mode:

### Before Send Examples
- PII Scrubbing (JavaScript, Python, .NET, Ruby, Rust)
- Conditional Event Dropping (JavaScript, PHP, Go, Rust)
- Service Metadata Enrichment (Go, Rust)
- Custom Tags & Context (JavaScript, Java, Cocoa)
- Unity Metadata Cleanup (Android)

### Fingerprinting Examples
- Custom Fingerprinting (JavaScript)
- Normalize Database Errors (JavaScript)
- Normalize API URL Errors (JavaScript)
- Split by User Type (JavaScript)

### Before Send Transaction Examples
- Drop Health Checks (JavaScript, Python, Go)
- Add Custom Tags (JavaScript)
- Filter Slow Spans (JavaScript)
- Scrub Sensitive URLs (JavaScript)

### Before Breadcrumb Examples
- Filter Console Breadcrumbs (JavaScript)
- Scrub PII from URLs (JavaScript, Python)
- Drop HTTP Noise (JavaScript)
- Categorize Breadcrumbs (JavaScript)

### Traces Sampler Examples
- Critical Endpoints Sampling (JavaScript)
- Health Check Filtering (JavaScript)
- User-Based Sampling (JavaScript)
- Environment-Based Sampling (Python)

See **[Examples Library](docs/examples.md)** for the complete catalog.

## Sharing Configurations

Share your configurations securely with colleagues or customers:

1. Configure your event/code in any mode
2. Click the **Share** button
3. Copy the generated URL (expires after 30 days)

**Security:** Event values are automatically scrubbed before sharing. Only the structure (field names and types) is preserved, along with your code.

## Documentation

### Getting Started
- **[Examples Library](docs/examples.md)** - Complete catalog of 50+ templates
- **[Choosing a Mode](docs/choosing-a-mode.md)** - Decision guide for mode selection
- **[SDK Support](docs/sdk-support.md)** - Available SDKs and versions

### Mode Guides
- **[Before Send Guide](docs/modes/beforeSend.md)** - Error event transformation
- **[Fingerprinting Guide](docs/modes/fingerprinting.md)** - Custom issue grouping
- **[Before Send Transaction Guide](docs/modes/beforeSendTransaction.md)** - Transaction filtering
- **[Before Breadcrumb Guide](docs/modes/beforeBreadcrumb.md)** - Breadcrumb filtering
- **[Traces Sampler Guide](docs/modes/tracesSampler.md)** - Dynamic sampling strategies
- **[Pattern Tester Guide](docs/modes/pattern-tester.md)** - Filter pattern testing
- **[Config Analyzer Guide](docs/config-analyzer/README.md)** - Configuration analysis
- **[API Query Tester Guide](docs/api-query-tester/README.md)** - Query testing
- **[Webhooks Guide](docs/modes/webhooks.md)** - Webhook testing

### Architecture
- **[Architecture Overview](docs/architecture.md)** - System design and structure
- **[Architecture Deep Dive](docs/architecture-deep-dive.md)** - Detailed technical docs with visual diagrams
  - [System Architecture Diagram](docs/diagrams/system-architecture.png) - 3-tier Docker microservices layout
  - [Request Flow Diagram](docs/diagrams/request-flow.png) - Sequence diagrams for transform, config analysis, and query validation
  - [Health Score Algorithm](docs/diagrams/health-score.png) - Flowchart of the scoring and recommendation engine

### Reference
- **[API Reference](docs/api-reference.md)** - API endpoints and usage
- **[Development Guide](docs/development.md)** - Contributing, testing, TDD workflow
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

## Requirements

- **Docker & Docker Compose** (required)
- That's it! Everything runs in Docker.

## Stop Services

```bash
docker-compose down
```

## Support

This tool is maintained by Sentry's Solutions Engineering team for customer support and internal testing.

For questions or issues, reach out to the SE team or file an issue in the repository.

## License

MIT
