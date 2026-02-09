/**
 * SDK Introspection & Live Config Validation Types
 *
 * Shared type definitions for live config validation against real SDK containers,
 * option introspection via reflection/manifests, and dictionary sync.
 */

/**
 * Response from POST /validate-config on SDK containers
 */
export interface ConfigValidationResponse {
  success: boolean;
  sdk: string;
  sdkVersion: string;
  initSucceeded: boolean;
  error?: string;
  warnings: string[];
  resolvedOptions: Record<string, any>;
  recognizedKeys: string[];
  ignoredKeys: string[];
}

/**
 * A single introspected SDK option
 */
export interface IntrospectedOption {
  key: string;
  canonicalKey: string;
  type: string;
  required: boolean;
  default: any;
  description: string;
}

/**
 * Response from GET /introspect on SDK containers
 */
export interface IntrospectionResponse {
  sdk: string;
  sdkVersion: string;
  sdkPackage: string;
  source: 'reflection' | 'manifest';
  options: IntrospectedOption[];
  timestamp: string;
}

/**
 * Result of comparing manual dictionary vs live introspected data
 */
export interface DictionarySyncResult {
  sdk: string;
  dictionaryCount: number;
  introspectedCount: number;
  matched: string[];
  dictionaryOnly: string[];
  sdkOnly: string[];
  typeConflicts: Array<{ key: string; dictType: string; sdkType: string }>;
  syncScore: number;
}

/**
 * Request body for the API gateway validate-live endpoint
 */
export interface ValidateLiveRequest {
  sdk: string;
  configCode: string;
}

/**
 * Cached introspection entry
 */
export interface CachedIntrospection {
  data: IntrospectionResponse;
  cachedAt: number;
}
