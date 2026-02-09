import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

interface ValidationRequest {
  sdk: string;
  beforeSendCode: string;
}

interface ValidationError {
  line?: number;
  column?: number;
  message: string;
}

interface ValidationResponse {
  valid: boolean;
  errors: ValidationError[];
}

// Supported SDKs for validation
const SUPPORTED_SDKS = [
  'javascript',
  'python',
  'ruby',
  'php',
  'go',
  'dotnet',
  'java',
  'android',
  'cocoa',
  'react-native',
];

// SDK container URLs
const SDK_URLS: Record<string, string> = {
  javascript: process.env.JAVASCRIPT_SDK_URL || 'http://sdk-javascript:5000',
  python: process.env.PYTHON_SDK_URL || 'http://sdk-python:5001',
  ruby: process.env.RUBY_SDK_URL || 'http://sdk-ruby:5002',
  php: process.env.PHP_SDK_URL || 'http://sdk-php:5003',
  go: process.env.GO_SDK_URL || 'http://sdk-go:5004',
  dotnet: process.env.DOTNET_SDK_URL || 'http://sdk-dotnet:5005',
  java: process.env.JAVA_SDK_URL || 'http://sdk-java:5006',
  android: process.env.ANDROID_SDK_URL || 'http://sdk-android:5007',
  cocoa: process.env.COCOA_SDK_URL || 'http://sdk-cocoa:5008',
  'react-native': process.env.JAVASCRIPT_SDK_URL || 'http://sdk-javascript:5000', // Use JS SDK for React Native
};

/**
 * Validate beforeSend code for syntax errors
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sdk, beforeSendCode } = req.body as ValidationRequest;

    // Validate input
    if (!sdk) {
      return res.status(400).json({
        error: 'Missing required parameter: sdk',
      });
    }

    if (!beforeSendCode) {
      return res.status(400).json({
        error: 'Missing required parameter: beforeSendCode',
      });
    }

    if (!SUPPORTED_SDKS.includes(sdk)) {
      return res.status(400).json({
        error: `Unsupported SDK: ${sdk}. Supported SDKs: ${SUPPORTED_SDKS.join(', ')}`,
      });
    }

    // Get SDK URL
    const sdkUrl = SDK_URLS[sdk];
    if (!sdkUrl) {
      return res.status(500).json({
        error: `SDK URL not configured for: ${sdk}`,
      });
    }

    // Call SDK container's validate endpoint
    try {
      const response = await axios.post(
        `${sdkUrl}/validate`,
        { code: beforeSendCode },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000, // 5 second timeout for validation
        }
      );

      const validationResult: ValidationResponse = response.data;
      return res.json(validationResult);
    } catch (error: any) {
      // If SDK container is not reachable or doesn't support validation yet
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || error.response?.status === 404) {
        // Fallback: return valid (no validation available)
        return res.json({
          valid: true,
          errors: [],
        });
      }

      // If SDK returned validation errors
      if (error.response?.data) {
        return res.json(error.response.data);
      }

      throw error;
    }
  } catch (error: any) {
    console.error('Validation error:', error);
    return res.status(500).json({
      error: 'Validation service error',
      details: error.message,
    });
  }
});

export default router;
