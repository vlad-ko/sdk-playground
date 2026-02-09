/**
 * Config Validator
 *
 * Calls SDK containers' POST /validate-config endpoint to perform
 * live validation of Sentry.init() configuration code against real SDKs.
 */

import axios from 'axios';
import { ConfigValidationResponse } from './types';

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

const TIMEOUT_MS = 15000;

export async function validateConfigLive(
  sdk: string,
  configCode: string
): Promise<ConfigValidationResponse> {
  const baseUrl = SDK_URLS[sdk];

  if (!baseUrl) {
    return {
      success: false,
      sdk,
      sdkVersion: '',
      initSucceeded: false,
      error: `SDK "${sdk}" is not supported for live validation`,
      warnings: [],
      resolvedOptions: {},
      recognizedKeys: [],
      ignoredKeys: [],
    };
  }

  try {
    const response = await axios.post<ConfigValidationResponse>(
      `${baseUrl}/validate-config`,
      { configCode },
      {
        timeout: TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.response) {
      return error.response.data;
    }

    return {
      success: false,
      sdk,
      sdkVersion: '',
      initSucceeded: false,
      error: `Failed to connect to ${sdk} SDK service: ${error.message}`,
      warnings: [],
      resolvedOptions: {},
      recognizedKeys: [],
      ignoredKeys: [],
    };
  }
}
