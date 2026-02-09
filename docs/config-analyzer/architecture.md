# Architecture Overview

The Configuration Analyzer uses an **introspection-first** architecture where live SDK containers are the source of truth for option existence, while a JSON dictionary provides supplementary metadata (SE guidance, warnings, examples).

## Component Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Config Parser  │────▶│  Config         │────▶│  Analysis       │
│  (per SDK)      │     │  Analyzer       │     │  Result         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │    │
                   ┌──────────┘    └──────────┐
                   ▼                          ▼
            ┌─────────────────┐     ┌─────────────────┐
            │  JSON           │     │  SDK Container   │
            │  Dictionary     │     │  (introspect)    │
            │  (metadata)     │     │  (existence)     │
            └─────────────────┘     └─────────────────┘
```

### Two-Source Resolution

1. **Dictionary** (JSON files) — rich metadata: SE guidance, warnings, examples, docs URLs
2. **Introspection** (live SDK) — source of truth for whether an option exists in the SDK

Options found in the dictionary are marked `source: 'dictionary'`. Options not in the dictionary but confirmed by SDK introspection are marked `source: 'introspection'`. Only options absent from **both** sources trigger "Unknown option" warnings.

## File Structure

```
api/
├── config-dictionary/           # JSON data files (outside src/)
│   ├── core.json                # dsn, environment, release, etc.
│   ├── sampling.json            # tracesSampleRate, sampleRate, etc.
│   ├── hooks.json               # beforeSend, beforeBreadcrumb, etc.
│   ├── filtering.json           # ignoreErrors, denyUrls, etc.
│   ├── integrations.json        # integrations, auto-instrumentation
│   ├── transport.json           # tunnel, transport, etc.
│   ├── performance.json         # tracing, appHangTimeoutInterval
│   ├── context.json             # tags, user context
│   └── replay.json              # Session Replay options
│
├── src/
│   ├── config-parsers/          # SDK-specific parsers
│   │   ├── types.ts             # Shared types (IConfigParser, ParsedConfig)
│   │   ├── index.ts             # Parser exports
│   │   ├── javascript.ts
│   │   ├── python.ts
│   │   ├── go.ts
│   │   ├── ruby.ts
│   │   ├── php.ts
│   │   ├── dotnet.ts
│   │   ├── java.ts
│   │   ├── cocoa.ts
│   │   ├── rust.ts
│   │   └── elixir.ts
│   │
│   ├── config-dictionary/       # Dictionary loader & types
│   │   ├── types.ts             # ConfigOption type definition
│   │   └── index.ts             # ConfigDictionary class (loads JSON)
│   │
│   ├── config-analyzer/         # Analysis logic
│   │   ├── types.ts             # AnalysisResult, OptionAnalysis types
│   │   ├── index.ts             # Exports
│   │   ├── analyzer.ts          # Main ConfigAnalyzer class (async)
│   │   └── sdk-config.ts        # SDK-specific formatting config
│   │
│   ├── sdk-introspection/       # Live SDK introspection
│   │   ├── types.ts             # IntrospectionResponse types
│   │   ├── sdk-introspector.ts  # HTTP client for /introspect endpoints
│   │   ├── config-validator.ts  # Live config validation
│   │   ├── dictionary-sync.ts   # Compare dictionary vs introspection
│   │   └── scaffold.ts          # Generate stub entries from introspection
│   │
│   └── routes/
│       └── config.ts            # /api/config/* endpoints
│
└── test/
    ├── config-dictionary/
    │   └── json-loader.test.ts  # JSON loading tests
    ├── config-analyzer/
    │   └── analyzer.test.ts     # Analyzer + introspection fallback tests
    └── sdk-introspection/
        └── scaffold.test.ts     # Scaffold generation tests
```

## Data Flow

### 1. Request Handling (`routes/config.ts`)

```typescript
// Route receives SDK name and config code
app.post('/api/config/analyze', async (req, res) => {
  const { sdk, configCode } = req.body;

  // Select appropriate parser-based analyzer
  const analyzer = getAnalyzerForSdk(sdk);

  // Analyze with introspection fallback
  const result = await analyzer.analyze(configCode, sdk, introspectSDK);
  res.json({ success: true, data: result });
});
```

### 2. Parsing (`config-parsers/*.ts`)

Each parser implements `IConfigParser` interface:

```typescript
interface IConfigParser {
  parse(configCode: string): ParsedConfig;
  validate(configCode: string): { valid: boolean; errors: ParseError[] };
}

interface ParsedConfig {
  sdk: string;
  valid: boolean;
  options: Map<string, ParsedOption>;
  rawCode: string;
  parseErrors: ParseError[];
}
```

Parsers handle:
- Extracting the initialization block (regex patterns)
- Removing comments while preserving strings
- Splitting statements at proper boundaries
- Parsing key-value pairs with type inference

### 3. Analysis (`config-analyzer/analyzer.ts`)

```typescript
class ConfigAnalyzer {
  async analyze(
    configCode: string,
    sdk: string,
    introspectFn?: IntrospectFn
  ): Promise<AnalysisResult> {
    // 1. Parse the code
    const parsed = this.parser.parse(configCode);

    // 2. First pass: analyze each option against dictionary
    for (const [key, option] of parsed.options) {
      const normalizedKey = this.normalizeKey(key);
      const dictOption = configDictionary.getOption(normalizedKey);
      // Build analysis with source='dictionary' if found
    }

    // 3. Second pass: introspection fallback for unknowns
    const unknowns = optionAnalyses.filter(a => !a.recognized);
    if (unknowns.length > 0 && introspectFn) {
      const introspection = await introspectFn(sdk); // fetched ONCE
      for (const unknown of unknowns) {
        // Re-analyze against introspection data
        // If found: source='introspection', recognized=true
      }
    }

    // 4. Check for missing required options
    // 5. Generate recommendations
    // 6. Calculate health score

    return result;
  }
}
```

### 4. Dictionary Lookup (`config-dictionary/index.ts`)

```typescript
class ConfigDictionary {
  constructor(dictionaryDir?: string) {
    // Load all .json files from the dictionary directory
    const dir = dictionaryDir || path.join(__dirname, '../../config-dictionary');
    const allOptions = this.loadOptionsFromDir(dir);
    // Build lookup maps
  }

  getOption(key: string): ConfigOption | undefined;
  hasOption(key: string): boolean;
  getAllOptions(): ConfigOption[];
  getOptionsByCategory(category: string): ConfigOption[];
}
```

### 5. Introspection Fallback (`sdk-introspection/sdk-introspector.ts`)

```typescript
// Called only when dictionary lookup fails for some options
async function introspectSDK(sdk: string): Promise<IntrospectionResponse> {
  // HTTP GET to SDK container's /introspect endpoint
  // Returns: { sdk, sdkVersion, options: [...], source, timestamp }
}
```

## Key Normalization

Different SDKs use different naming conventions:

| SDK | Code Style | Normalized Key |
|-----|------------|----------------|
| Python | `traces_sample_rate` | `tracesSampleRate` |
| JavaScript | `tracesSampleRate` | `tracesSampleRate` |
| Go | `TracesSampleRate` | `tracesSampleRate` |
| Cocoa | `tracesSampleRate` | `tracesSampleRate` |

The analyzer normalizes all keys to camelCase for dictionary lookup:

```typescript
private normalizeKey(key: string): string {
  // Convert snake_case to camelCase
  if (key.includes('_')) {
    return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
  // Convert PascalCase to camelCase
  return key.charAt(0).toLowerCase() + key.slice(1);
}
```

## Score Calculation

```typescript
private calculateScore(parsed, warnings, recommendations): number {
  let score = 100;

  // Deductions
  score -= errors.length * 15;           // Errors are severe
  score -= warnings.length * 5;          // Warnings are moderate
  score -= highPriorityRecs.length * 10; // Missing best practices
  score -= mediumPriorityRecs.length * 5;

  // Bonuses for good practices
  if (hasOption('environment')) score += 5;
  if (hasOption('release')) score += 5;
  if (hasOption('beforeSend')) score += 5;

  return Math.max(0, Math.min(100, score));
}
```
