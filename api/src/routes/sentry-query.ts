/**
 * Sentry Query Route
 *
 * API endpoints for testing and validating Sentry API queries.
 */

import { Router, Request, Response } from 'express';
import { parseQuery } from '../sentry-query/query-parser';
import { validateQuery, VALID_PROPERTIES } from '../sentry-query/query-validator';
import { querySentryAPI, SentryEndpoint } from '../sentry-query/sentry-api-client';

const router = Router();

/**
 * Example queries for the UI
 */
const EXAMPLE_QUERIES = [
  {
    name: 'Unresolved Errors',
    description: 'Find all unresolved error-level issues',
    query: 'is:unresolved level:error',
    category: 'basic',
  },
  {
    name: 'Recent Fatal Errors',
    description: 'Fatal errors from the last 24 hours',
    query: 'level:fatal age:-24h',
    category: 'basic',
  },
  {
    name: 'My Assigned Issues',
    description: 'Issues assigned to you',
    query: 'assigned:me is:unresolved',
    category: 'basic',
  },
  {
    name: 'Unassigned Issues',
    description: 'Issues that need to be assigned',
    query: 'is:unresolved assigned:none',
    category: 'basic',
  },
  {
    name: 'Exclude Internal Users',
    description: 'Errors excluding internal email domain',
    query: 'is:unresolved !user.email:*@internal.com',
    category: 'advanced',
  },
  {
    name: 'High Volume Issues',
    description: 'Issues seen more than 100 times',
    query: 'is:unresolved timesSeen:>100',
    category: 'advanced',
  },
  {
    name: 'Specific Error Type',
    description: 'Find TypeError exceptions',
    query: 'error.type:TypeError',
    category: 'advanced',
  },
  {
    name: 'Production Environment',
    description: 'Errors from production only',
    query: 'is:unresolved environment:production',
    category: 'basic',
  },
  {
    name: 'Mobile Devices',
    description: 'Errors from iPhone devices',
    query: 'device.family:iPhone',
    category: 'advanced',
  },
  {
    name: 'Specific Release',
    description: 'Errors in a specific release version',
    query: 'release:1.0.0',
    category: 'basic',
  },
  {
    name: 'API Errors',
    description: 'HTTP 500 errors in API calls',
    query: 'http.status_code:500',
    category: 'advanced',
  },
  {
    name: 'US Users Only',
    description: 'Errors from users in the United States',
    query: 'geo.country_code:US',
    category: 'advanced',
  },
  {
    name: 'Handled vs Unhandled',
    description: 'Find unhandled exceptions only',
    query: 'error.unhandled:true',
    category: 'advanced',
  },
  {
    name: 'Issues with User Context',
    description: 'Errors that have user information',
    query: 'has:user is:unresolved',
    category: 'basic',
  },
  {
    name: 'Multiple Levels',
    description: 'Find both error and warning level issues',
    query: 'level:[error, warning]',
    category: 'advanced',
  },
];

/**
 * POST /api/sentry-query/validate
 * Validate query syntax without executing it
 */
router.post('/validate', (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (query === undefined) {
      return res.status(400).json({
        error: 'Missing required parameter: query',
      });
    }

    // Parse the query
    const parsed = parseQuery(query);

    // Validate the parsed query
    const validation = validateQuery(parsed);

    return res.json({
      valid: validation.valid,
      components: validation.components,
      suggestions: validation.suggestions,
      parsed: {
        raw: parsed.raw,
        freeText: parsed.freeText,
        hasOr: parsed.hasOr,
        hasParentheses: parsed.hasParentheses,
      },
    });
  } catch (error: any) {
    console.error('Validation error:', error);
    return res.status(500).json({
      error: 'Validation failed',
      details: error.message,
    });
  }
});

/**
 * POST /api/sentry-query/test
 * Execute a query against the Sentry API
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const {
      org,
      authToken,
      endpoint = 'issues',
      query,
      environment,
      project,
      statsPeriod,
    } = req.body;

    // Validate required parameters
    if (!org) {
      return res.status(400).json({
        error: 'Missing required parameter: org',
      });
    }

    if (!authToken) {
      return res.status(400).json({
        error: 'Missing required parameter: authToken',
      });
    }

    // Execute the query
    const result = await querySentryAPI({
      org,
      authToken,
      endpoint: endpoint as SentryEndpoint,
      query,
      environment,
      project,
      statsPeriod,
    });

    return res.json(result);
  } catch (error: any) {
    console.error('Query execution error:', error);
    return res.status(500).json({
      success: false,
      error: 'Query execution failed',
      details: error.message,
    });
  }
});

/**
 * POST /api/sentry-query/parse-url
 * Extract query parameters from a Sentry UI URL
 */
router.post('/parse-url', (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'Missing required parameter: url',
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.json({
        success: false,
        error: 'Invalid URL format',
      });
    }

    // Check if it's a Sentry URL
    const hostname = parsedUrl.hostname;
    if (!hostname.includes('sentry.io')) {
      return res.json({
        success: false,
        error: 'Not a Sentry URL. Expected hostname containing sentry.io',
      });
    }

    // Extract org from subdomain or path
    let org: string | undefined;
    const hostParts = hostname.split('.');
    if (hostParts.length > 2 && hostParts[0] !== 'www' && hostParts[0] !== 'us' && hostParts[0] !== 'de') {
      org = hostParts[0];
    }

    // Determine endpoint type from path
    const path = parsedUrl.pathname;
    let endpoint: 'issues' | 'events' | 'projects' = 'issues';
    let warning: string | undefined;

    if (path.includes('/discover/')) {
      // Discover URLs use a different query format, default to issues
      endpoint = 'issues';
      warning = 'Discover URLs are not fully supported. Query will be run against the Issues endpoint.';
    } else if (path.includes('/performance/')) {
      // Performance URLs use transactions, not issues
      endpoint = 'issues';
      warning = 'Performance URLs are not fully supported. Query will be run against the Issues endpoint.';
    } else if (path.includes('/issues/')) {
      endpoint = 'issues';
    }

    // Extract query parameters
    // Strip Unicode Private Use Area characters (U+E000-U+F8FF) that Sentry UI uses for formatting
    // These characters appear in URLs like %EF%80%8D (U+F00D) and can cause display/parsing issues
    const rawQuery = parsedUrl.searchParams.get('query');
    const query = rawQuery ? rawQuery.replace(/[\uE000-\uF8FF]/g, '') : undefined;
    const environment = parsedUrl.searchParams.get('environment') || undefined;
    const project = parsedUrl.searchParams.get('project') || undefined;
    const statsPeriod = parsedUrl.searchParams.get('statsPeriod') || undefined;

    return res.json({
      success: true,
      org,
      endpoint,
      query,
      environment,
      project,
      statsPeriod,
      warning,
    });
  } catch (error: any) {
    console.error('URL parsing error:', error);
    return res.status(500).json({
      success: false,
      error: 'URL parsing failed',
      details: error.message,
    });
  }
});

/**
 * GET /api/sentry-query/properties
 * Get list of valid query properties
 */
router.get('/properties', (req: Request, res: Response) => {
  try {
    const properties = Object.entries(VALID_PROPERTIES).map(([name, def]) => ({
      name,
      type: def.type,
      values: def.values,
      description: def.description,
      supportsComparison: def.supportsComparison,
      supportsWildcard: def.supportsWildcard,
      aliases: def.aliases,
    }));

    return res.json({ properties });
  } catch (error: any) {
    console.error('Properties fetch error:', error);
    return res.status(500).json({
      error: 'Failed to fetch properties',
      details: error.message,
    });
  }
});

/**
 * GET /api/sentry-query/examples
 * Get example queries
 */
router.get('/examples', (req: Request, res: Response) => {
  try {
    return res.json({ examples: EXAMPLE_QUERIES });
  } catch (error: any) {
    console.error('Examples fetch error:', error);
    return res.status(500).json({
      error: 'Failed to fetch examples',
      details: error.message,
    });
  }
});

export default router;
