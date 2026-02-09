/**
 * SDK Introspector
 *
 * Calls SDK containers' GET /introspect endpoint to discover available
 * options via reflection or manifest. Caches results with configurable TTL.
 */

import axios from 'axios';
import { IntrospectionResponse, CachedIntrospection } from './types';

const SDK_URLS: Record<string, string> = {
  javascript: process.env.JAVASCRIPT_SDK_URL || 'http://sdk-javascript:5000',
  python: process.env.PYTHON_SDK_URL || 'http://sdk-python:5001',
  dotnet: process.env.DOTNET_SDK_URL || 'http://sdk-dotnet:5002',
  ruby: process.env.RUBY_SDK_URL || 'http://sdk-ruby:5004',
  php: process.env.PHP_SDK_URL || 'http://sdk-php:5005',
  go: process.env.GO_SDK_URL || 'http://sdk-go:5006',
  java: process.env.JAVA_SDK_URL || 'http://sdk-java:5007',
  android: process.env.ANDROID_SDK_URL || 'http://sdk-android:5008',
  cocoa: process.env.COCOA_SDK_URL || 'http://sdk-cocoa:5009',
  rust: process.env.RUST_SDK_URL || 'http://sdk-rust:5010',
  elixir: process.env.ELIXIR_SDK_URL || 'http://sdk-elixir:5011',
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TIMEOUT_MS = 10000;

const cache = new Map<string, CachedIntrospection>();

export function clearCache(): void {
  cache.clear();
}

export function getCacheSize(): number {
  return cache.size;
}

export async function introspectSDK(
  sdk: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<IntrospectionResponse> {
  // Check cache first
  const cached = cache.get(sdk);
  if (cached && Date.now() - cached.cachedAt < ttlMs) {
    return cached.data;
  }

  const baseUrl = SDK_URLS[sdk];

  if (!baseUrl) {
    throw new Error(`SDK "${sdk}" is not supported for introspection`);
  }

  try {
    const response = await axios.get<IntrospectionResponse>(
      `${baseUrl}/introspect`,
      { timeout: TIMEOUT_MS }
    );

    // Cache the result
    cache.set(sdk, {
      data: response.data,
      cachedAt: Date.now(),
    });

    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw new Error(`Introspection failed for ${sdk}: ${error.response.data?.error || error.message}`);
    }
    throw new Error(`Failed to connect to ${sdk} SDK service: ${error.message}`);
  }
}
