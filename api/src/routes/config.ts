/**
 * Configuration analysis API routes
 */

import { Router, Request, Response } from 'express';
import { configDictionary } from '../config-dictionary';
import {
  JavaScriptConfigParser,
  PythonConfigParser,
  GoConfigParser,
  RustConfigParser,
  PHPConfigParser,
  RubyConfigParser,
  DotNetConfigParser,
  CocoaConfigParser,
  JavaConfigParser,
  ElixirConfigParser,
} from '../config-parsers';
import { ConfigAnalyzer } from '../config-analyzer';
import { validateConfigLive } from '../sdk-introspection/config-validator';
import { introspectSDK } from '../sdk-introspection/sdk-introspector';
import { syncDictionary } from '../sdk-introspection/dictionary-sync';
import { scaffoldDictionary } from '../sdk-introspection/scaffold';

const router = Router();

// Create parser and analyzer instances for all SDKs
const jsParser = new JavaScriptConfigParser();
const jsAnalyzer = new ConfigAnalyzer(jsParser);

const pyParser = new PythonConfigParser();
const pyAnalyzer = new ConfigAnalyzer(pyParser);

const goParser = new GoConfigParser();
const goAnalyzer = new ConfigAnalyzer(goParser);

const rustParser = new RustConfigParser();
const rustAnalyzer = new ConfigAnalyzer(rustParser);

const phpParser = new PHPConfigParser();
const phpAnalyzer = new ConfigAnalyzer(phpParser);

const rubyParser = new RubyConfigParser();
const rubyAnalyzer = new ConfigAnalyzer(rubyParser);

const dotnetParser = new DotNetConfigParser();
const dotnetAnalyzer = new ConfigAnalyzer(dotnetParser);

const cocoaParser = new CocoaConfigParser();
const cocoaAnalyzer = new ConfigAnalyzer(cocoaParser);

const javaParser = new JavaConfigParser();
const javaAnalyzer = new ConfigAnalyzer(javaParser);

const elixirParser = new ElixirConfigParser();
const elixirAnalyzer = new ConfigAnalyzer(elixirParser);

/**
 * POST /api/config/analyze
 * Analyze a configuration code string
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { configCode, sdk = 'javascript' } = req.body;

    if (!configCode) {
      return res.status(400).json({
        error: 'Missing required field: configCode',
      });
    }

    // Select the appropriate analyzer based on SDK
    let analyzer;
    switch (sdk) {
      case 'javascript':
        analyzer = jsAnalyzer;
        break;
      case 'python':
        analyzer = pyAnalyzer;
        break;
      case 'go':
        analyzer = goAnalyzer;
        break;
      case 'rust':
        analyzer = rustAnalyzer;
        break;
      case 'php':
        analyzer = phpAnalyzer;
        break;
      case 'ruby':
        analyzer = rubyAnalyzer;
        break;
      case 'dotnet':
        analyzer = dotnetAnalyzer;
        break;
      case 'cocoa':
        analyzer = cocoaAnalyzer;
        break;
      case 'java':
        analyzer = javaAnalyzer;
        break;
      case 'elixir':
        analyzer = elixirAnalyzer;
        break;
      default:
        return res.status(400).json({
          error: `SDK "${sdk}" is not yet supported. Currently supported: javascript, python, go, rust, php, ruby, dotnet, cocoa, java, elixir`,
        });
    }

    // Analyze the configuration (with introspection fallback)
    const result = await analyzer.analyze(configCode, sdk, introspectSDK);

    return res.json({
      success: true,
      data: result,
    });

  } catch (error: any) {
    console.error('Config analysis error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze configuration',
      message: error.message,
    });
  }
});

/**
 * GET /api/config/options
 * Get all available configuration options
 */
router.get('/options', (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;

    let options = configDictionary.getAllOptions();

    // Filter by category if provided
    if (category && typeof category === 'string') {
      const cat = category as 'core' | 'sampling' | 'performance' | 'integrations' | 'transport' | 'hooks' | 'filtering' | 'context' | 'debug';
      options = configDictionary.getOptionsByCategory(cat);
    }

    // Search if query provided
    if (search && typeof search === 'string') {
      options = configDictionary.searchOptions(search);
    }

    const categories = configDictionary.getCategories();

    return res.json({
      success: true,
      data: {
        options,
        categories,
        totalCount: options.length,
      },
    });

  } catch (error: any) {
    console.error('Get options error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve options',
      message: error.message,
    });
  }
});

/**
 * GET /api/config/examples
 * Get all config examples
 */
router.get('/examples', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const examplesDir = path.join(__dirname, '../../config-examples');
    const files = fs.readdirSync(examplesDir).filter((f: string) => f.endsWith('.json'));

    const examples = files.map((file: string) => {
      const content = fs.readFileSync(path.join(examplesDir, file), 'utf-8');
      return JSON.parse(content);
    });

    return res.json({
      success: true,
      examples,
    });

  } catch (error: any) {
    console.error('Get examples error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve examples',
      message: error.message,
    });
  }
});

/**
 * GET /api/config/options/:key
 * Get details for a specific configuration option
 */
router.get('/options/:key', (req: Request, res: Response) => {
  try {
    const key = typeof req.params.key === 'string' ? req.params.key : req.params.key[0];

    const option = configDictionary.getOption(key);

    if (!option) {
      return res.status(404).json({
        success: false,
        error: `Option "${key}" not found`,
      });
    }

    return res.json({
      success: true,
      data: option,
    });

  } catch (error: any) {
    console.error('Get option error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve option',
      message: error.message,
    });
  }
});

/**
 * POST /api/config/validate-live
 * Validate configuration code against the real SDK container
 */
router.post('/validate-live', async (req: Request, res: Response) => {
  try {
    const { sdk, configCode } = req.body;

    if (!configCode) {
      return res.status(400).json({
        error: 'Missing required field: configCode',
      });
    }

    if (!sdk) {
      return res.status(400).json({
        error: 'Missing required field: sdk',
      });
    }

    const result = await validateConfigLive(sdk, configCode);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Live config validation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to validate configuration',
      message: error.message,
    });
  }
});

/**
 * GET /api/config/introspect/:sdk
 * Introspect available options from a real SDK container
 */
router.get('/introspect/:sdk', async (req: Request, res: Response) => {
  try {
    const sdk = typeof req.params.sdk === 'string' ? req.params.sdk : req.params.sdk[0];

    const result = await introspectSDK(sdk);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('SDK introspection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to introspect SDK',
      message: error.message,
    });
  }
});

/**
 * GET /api/config/dictionary/sync/:sdk
 * Compare manual dictionary against live introspected data
 */
router.get('/dictionary/sync/:sdk', async (req: Request, res: Response) => {
  try {
    const sdk = typeof req.params.sdk === 'string' ? req.params.sdk : req.params.sdk[0];

    const introspection = await introspectSDK(sdk);
    const syncResult = syncDictionary(sdk, introspection);

    return res.json({
      success: true,
      data: syncResult,
    });
  } catch (error: any) {
    console.error('Dictionary sync error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to sync dictionary',
      message: error.message,
    });
  }
});

/**
 * GET /api/config/dictionary/scaffold/:sdk
 * Generate stub dictionary entries for introspected options not yet in the dictionary
 */
router.get('/dictionary/scaffold/:sdk', async (req: Request, res: Response) => {
  try {
    const sdk = typeof req.params.sdk === 'string' ? req.params.sdk : req.params.sdk[0];

    const introspection = await introspectSDK(sdk);
    const stubs = scaffoldDictionary(sdk, introspection);

    return res.json({
      success: true,
      data: {
        sdk,
        stubCount: stubs.length,
        stubs,
      },
    });
  } catch (error: any) {
    console.error('Dictionary scaffold error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to scaffold dictionary',
      message: error.message,
    });
  }
});

export default router;
