# Adding New Options

This guide explains the two ways options become recognized by the Config Analyzer: dictionary entries and SDK introspection.

## How Options Are Recognized

The Config Analyzer uses a **two-source resolution** strategy:

1. **Dictionary** (JSON files) — for curated metadata: SE guidance, warnings, examples
2. **SDK Introspection** (live container) — automatic recognition of any option the SDK reports

An option only triggers "Unknown" if it's absent from **both** sources. This means:
- New SDK options are recognized immediately via introspection (no dictionary update needed)
- Dictionary entries add rich metadata that introspection alone can't provide

## Adding to the Dictionary

Add dictionary entries when you want to provide **curated metadata** — SE guidance, warnings, examples, docs URLs — beyond simple recognition.

### Step 1: Identify the Category

Options are organized by category in JSON files:

| Category | File | Use For |
|----------|------|---------|
| `core` | `api/config-dictionary/core.json` | dsn, environment, release, enabled |
| `sampling` | `api/config-dictionary/sampling.json` | Sample rates, sampling functions |
| `hooks` | `api/config-dictionary/hooks.json` | beforeSend, beforeBreadcrumb, etc. |
| `filtering` | `api/config-dictionary/filtering.json` | ignoreErrors, denyUrls, allowUrls |
| `integrations` | `api/config-dictionary/integrations.json` | SDK integrations, auto-instrumentation |
| `transport` | `api/config-dictionary/transport.json` | Network, tunneling, offline |
| `performance` | `api/config-dictionary/performance.json` | Tracing configuration |
| `context` | `api/config-dictionary/context.json` | Tags, user context |
| `replay` | `api/config-dictionary/replay.json` | Session Replay options |

### Step 2: Write the Test First (TDD)

Add a test in `api/test/config-analyzer/analyzer.test.ts`:

```typescript
it('should recognize myNewOption from dictionary', async () => {
  const config = `Sentry.init({
    dsn: "https://test@o0.ingest.sentry.io/0",
    myNewOption: true
  });`;

  const result = await analyzer.analyze(config, 'javascript');

  const option = result.options.find(o => o.key === 'myNewOption');
  expect(option).toBeDefined();
  expect(option?.recognized).toBe(true);
  expect(option?.source).toBe('dictionary');
});
```

Run the test to verify it fails:
```bash
docker-compose build api
docker run --rm sdk-playground-api npm test -- --testPathPattern="analyzer"
```

### Step 3: Add the Option to JSON

Open the appropriate JSON file and add an entry:

```json
{
  "key": "myNewOption",
  "displayName": "My New Option",
  "description": "What this option does and when to use it.",
  "type": "boolean",
  "category": "core",
  "required": false,
  "defaultValue": false,
  "examples": ["true", "false"],
  "docsUrl": "https://docs.sentry.io/...",
  "seGuidance": "SE advice for customers asking about this option.",
  "warnings": ["Any important cautions"],
  "relatedOptions": ["otherOption"],
  "supportedSDKs": null
}
```

**Field notes:**
- `key`: camelCase, canonical name
- `supportedSDKs`: use `null` for all SDKs, or `["cocoa", "python"]` to restrict
- `defaultValue`: use `null` for no default

### Step 4: Run Tests

```bash
docker-compose build api
docker run --rm sdk-playground-api npm test
```

## Using the Scaffold Tool

When an SDK has options not yet in the dictionary, the **scaffold endpoint** generates stub entries for you:

```bash
# See what options are in the SDK but not in the dictionary
curl http://localhost:4000/api/config/dictionary/scaffold/cocoa | python3 -m json.tool
```

This returns pre-filled stubs with:
- `key`, `type`, `description` from introspection
- `supportedSDKs` set to the current SDK
- Empty `seGuidance`, `warnings`, `examples` for human curation

You can copy these stubs into the appropriate JSON file and fill in the curated fields.

### Scaffold Type Mapping

The scaffold maps SDK-reported types to dictionary types:

| Introspection Type | Dictionary Type |
|-------------------|-----------------|
| `float`, `double`, `int`, `integer` | `number` |
| `bool`, `boolean` | `boolean` |
| `str`, `string` | `string` |
| `list`, `array`, `string[]` | `array` |
| `callable`, `callback`, `func`, `closure` | `function` |

## Adding SDK-Specific Options

For options that only apply to certain SDKs:

```json
{
  "key": "appHangTimeoutInterval",
  "displayName": "App Hang Timeout Interval",
  "description": "Duration in seconds that the app must be unresponsive before an app hang event is created.",
  "type": "number",
  "category": "performance",
  "supportedSDKs": ["cocoa"],
  "defaultValue": 2.0,
  "seGuidance": "Cocoa-specific. Increase if false-positive app-hangs are reported."
}
```

When `supportedSDKs` is specified:
- Option is recognized only for listed SDKs
- Warning shown if used with an unsupported SDK

## Updating Cocoa Manifest

The Cocoa SDK uses a **manifest-based** introspection (no runtime reflection in Swift). To add options to introspection:

Edit `sdks/cocoa/Sources/App/routes.swift` and add entries to the `options` array in the `/introspect` endpoint:

```swift
["key": AnyCodable("newOption"), "canonicalKey": AnyCodable("newOption"),
 "type": AnyCodable("boolean"), "required": AnyCodable(false),
 "default": AnyCodable(false), "description": AnyCodable("Description here")],
```

Then rebuild the Cocoa container:
```bash
docker-compose build sdk-cocoa
```

## Dictionary Sync

To check how well the dictionary covers an SDK's options:

```bash
# Compare dictionary vs live introspection
curl http://localhost:4000/api/config/dictionary/sync/python | python3 -m json.tool
```

Returns:
- `matched` — options in both dictionary and SDK
- `dictionaryOnly` — in dictionary but not reported by SDK
- `sdkOnly` — in SDK but not in dictionary (candidates for scaffolding)
- `syncScore` — coverage percentage

## Naming Conventions

Use **camelCase** for the `key` field. This is the canonical name used internally.

SDKs with different conventions are normalized by the parser:
- Python `traces_sample_rate` → `tracesSampleRate`
- Go `TracesSampleRate` → `tracesSampleRate`
- .NET `TracesSampleRate` → `tracesSampleRate`

## Adding Validation Rules

For options requiring special validation, add logic to `analyzer.ts`:

```typescript
// In validateOptionValue method
if (normalizedKey === 'myNewOption') {
  if (someCondition) {
    warnings.push({
      severity: 'warning',
      message: 'Warning message',
      optionKey: parsedOption.key,
      fix: 'How to fix this issue',
    });
  }
}
```

## Checklist

- [ ] Test written first (TDD)
- [ ] Option added to correct JSON category file
- [ ] All required fields filled in
- [ ] `docsUrl` points to valid documentation
- [ ] `seGuidance` provides helpful SE advice
- [ ] `supportedSDKs` specified if not universal (use `null` for all)
- [ ] Tests pass in Docker
- [ ] Container rebuilt
