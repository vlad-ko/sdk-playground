# Options Dictionary

The options dictionary is a **supplementary metadata store** that enriches recognized SDK options with SE guidance, warnings, examples, and documentation links. It is stored as JSON files, separate from code.

> **Important:** The dictionary is no longer the sole gatekeeper for option recognition. Options not found in the dictionary are checked against live SDK introspection before being marked "Unknown". See [architecture.md](architecture.md) for the full flow.

## Location

Dictionary data lives as JSON files outside of `src/`, making them editable without TypeScript knowledge and diffable in code review:

```
api/config-dictionary/           # JSON data files
├── core.json                    # Essential: dsn, environment, release
├── sampling.json                # Sample rates
├── hooks.json                   # beforeSend, beforeBreadcrumb, etc.
├── filtering.json               # ignoreErrors, denyUrls, allowUrls
├── integrations.json            # SDK integrations, auto-instrumentation
├── transport.json               # Network/transport
├── performance.json             # Tracing, appHangTimeoutInterval
├── context.json                 # Tags, user context
└── replay.json                  # Session Replay

api/src/config-dictionary/       # TypeScript loader
├── index.ts                     # ConfigDictionary class (loads JSON at startup)
└── types.ts                     # TypeScript interfaces
```

### Why JSON?

- **Data/code separation** — option definitions are data, not logic
- **No TypeScript rebuild** — edit JSON, rebuild Docker container, done
- **Clean diffs** — JSON changes are easy to review
- **Testable** — `ConfigDictionary` accepts a custom directory for unit tests
- **Volume-mountable** — JSON files can be mounted into Docker without a full rebuild

### Path Resolution

The loader uses `path.join(__dirname, '../../config-dictionary')` which resolves correctly from both development (`src/`) and production (`dist/`) paths:

- `src/config-dictionary/index.ts` → `../../config-dictionary` → `api/config-dictionary/`
- `dist/config-dictionary/index.js` → `../../config-dictionary` → `api/config-dictionary/`

## ConfigOption Interface

Each option in the dictionary follows this structure:

```typescript
interface ConfigOption {
  // Required fields
  key: string;              // Canonical key (camelCase)
  displayName: string;      // Human-readable name
  description: string;      // What this option does
  type: 'string' | 'number' | 'boolean' | 'array' | 'function' | 'object';
  category: ConfigCategory; // Grouping for UI

  // Optional fields
  required?: boolean;       // Is this option mandatory?
  defaultValue?: any;       // SDK default if not specified
  examples?: string[];      // Example values
  docsUrl?: string;         // Link to Sentry documentation
  seGuidance?: string;      // Solutions Engineering advice
  warnings?: string[];      // Cautions to display
  relatedOptions?: string[]; // Related option keys
  supportedSDKs?: string[]; // If not all SDKs support this (null/omitted = all)
}
```

### JSON Conventions

In JSON files, optional fields use `null` instead of `undefined`:

```json
{
  "key": "dsn",
  "displayName": "DSN",
  "supportedSDKs": null
}
```

At load time, `null` values for `supportedSDKs` are converted to `undefined`, meaning "all SDKs supported".

## Categories

Options are grouped into categories for organization:

| Category | Description |
|----------|-------------|
| `core` | Essential: dsn, environment, release |
| `sampling` | Sample rates for events/transactions |
| `performance` | Tracing and performance monitoring |
| `integrations` | SDK plugins and extensions |
| `transport` | Network and event delivery |
| `hooks` | Callbacks: beforeSend, beforeBreadcrumb |
| `filtering` | Error filtering: ignoreErrors, denyUrls |
| `context` | User context, tags |
| `debug` | Debugging options |

## Example Option Definition

```json
{
  "key": "dsn",
  "displayName": "DSN",
  "description": "The Data Source Name tells the SDK where to send events.",
  "type": "string",
  "category": "core",
  "required": true,
  "examples": [
    "https://examplePublicKey@o0.ingest.sentry.io/0"
  ],
  "docsUrl": "https://docs.sentry.io/product/sentry-basics/dsn-explainer/",
  "seGuidance": "The DSN is unique per project. Always use HTTPS. Keep DSNs secure.",
  "warnings": [
    "Never commit DSNs to public repositories",
    "Use environment variables to store DSNs"
  ],
  "relatedOptions": ["tunnel", "transport"],
  "supportedSDKs": null
}
```

## SDK-Specific Options

Some options only apply to certain SDKs. Use `supportedSDKs` to restrict:

```json
{
  "key": "appHangTimeoutInterval",
  "displayName": "App Hang Timeout Interval",
  "description": "Duration in seconds that the app must be unresponsive before an app hang event is created.",
  "type": "number",
  "category": "performance",
  "supportedSDKs": ["cocoa"]
}
```

When an option has `supportedSDKs` defined:
- The option is recognized for those SDKs
- A warning is shown if used with an unsupported SDK

## Key Normalization

The dictionary uses **camelCase** keys internally. SDKs that use different conventions are normalized:

| SDK Convention | Example | Normalized |
|----------------|---------|------------|
| snake_case (Python, Ruby, PHP, Rust, Elixir) | `traces_sample_rate` | `tracesSampleRate` |
| PascalCase (Go, .NET) | `TracesSampleRate` | `tracesSampleRate` |
| camelCase (JavaScript, Java, Cocoa) | `tracesSampleRate` | `tracesSampleRate` |

The analyzer handles normalization automatically:

```typescript
// In analyzer.ts
private normalizeKey(key: string): string {
  if (key.includes('_')) {
    return this.snakeToCamelCase(key);
  }
  return key;
}
```

## Using the Dictionary

```typescript
import { configDictionary } from '../config-dictionary';

// Get a specific option
const dsnOption = configDictionary.getOption('dsn');

// Get all options
const allOptions = configDictionary.getAllOptions();

// Get options by category
const coreOptions = configDictionary.getOptionsByCategory('core');

// Check if option exists
const exists = configDictionary.hasOption('tracesSampleRate');

// Get required options
const required = configDictionary.getRequiredOptions();

// Search by keyword
const results = configDictionary.searchOptions('sample');
```

## Current Option Count

The dictionary currently contains **66 options** across all categories:

| Category | Count |
|----------|-------|
| Core | 7 |
| Sampling | 5 |
| Hooks | 5 |
| Filtering | 4 |
| Integrations | 16 |
| Transport | 10 |
| Performance | 7 |
| Context | 6 |
| Replay | 6 |

## Validation Rules

Some options have built-in validation in the analyzer:

### Sample Rates
```typescript
if (key === 'tracesSampleRate' || key === 'sampleRate') {
  if (value < 0 || value > 1) {
    // Error: must be between 0.0 and 1.0
  }
  if (value === 1.0) {
    // Warning: 100% sampling may exhaust quota
  }
}
```

### DSN Format
```typescript
if (key === 'dsn') {
  if (!value.startsWith('https://')) {
    // Error: should use HTTPS
  }
  if (!value.includes('@') || !value.includes('.ingest')) {
    // Warning: format may be invalid
  }
}
```

### Debug Mode
```typescript
if (key === 'debug' && value === true) {
  // Warning: should be disabled in production
}
```
