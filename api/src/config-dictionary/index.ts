/**
 * Configuration Dictionary
 *
 * Central registry of all Sentry SDK configuration options with descriptions,
 * SE guidance, and validation information.
 *
 * Options are loaded from JSON files in api/config-dictionary/ at construction time.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigOption, ConfigDictionaryData, ConfigCategory } from './types';

const categoryDescriptions: Record<ConfigCategory, { name: string; description: string }> = {
  core: {
    name: 'Core',
    description: 'Essential configuration options like DSN, environment, and release',
  },
  sampling: {
    name: 'Sampling',
    description: 'Control what percentage of events and transactions to capture',
  },
  performance: {
    name: 'Performance',
    description: 'Performance monitoring and tracing configuration',
  },
  integrations: {
    name: 'Integrations',
    description: 'SDK integrations and extensions',
  },
  transport: {
    name: 'Transport',
    description: 'Network and event delivery configuration',
  },
  hooks: {
    name: 'Hooks',
    description: 'Callbacks for modifying or filtering events',
  },
  filtering: {
    name: 'Filtering',
    description: 'Options for filtering errors and transactions',
  },
  context: {
    name: 'Context',
    description: 'User, tags, and contextual data configuration',
  },
  debug: {
    name: 'Debug',
    description: 'Debugging and diagnostic options',
  },
};

export class ConfigDictionary {
  private options: Map<string, ConfigOption>;
  private data: ConfigDictionaryData;

  constructor(dictionaryDir?: string) {
    const dir = dictionaryDir || path.join(__dirname, '../../config-dictionary');
    const allOptions = this.loadOptionsFromDir(dir);

    this.options = new Map();
    allOptions.forEach(option => {
      this.options.set(option.key, option);
    });

    this.data = {
      options: allOptions,
      categories: categoryDescriptions,
    };
  }

  /**
   * Load all ConfigOption arrays from JSON files in a directory
   */
  private loadOptionsFromDir(dir: string): ConfigOption[] {
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const allOptions: ConfigOption[] = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const options: any[] = JSON.parse(content);

      for (const opt of options) {
        // Convert null supportedSDKs to undefined (JSON has no undefined)
        if (opt.supportedSDKs === null) {
          delete opt.supportedSDKs;
        }
        allOptions.push(opt as ConfigOption);
      }
    }

    return allOptions;
  }

  /**
   * Get a specific configuration option by key
   */
  getOption(key: string): ConfigOption | undefined {
    return this.options.get(key);
  }

  /**
   * Get all configuration options
   */
  getAllOptions(): ConfigOption[] {
    return this.data.options;
  }

  /**
   * Get options by category
   */
  getOptionsByCategory(category: ConfigCategory): ConfigOption[] {
    return this.data.options.filter(opt => opt.category === category);
  }

  /**
   * Get all categories with descriptions
   */
  getCategories(): Record<ConfigCategory, { name: string; description: string }> {
    return this.data.categories;
  }

  /**
   * Check if an option exists
   */
  hasOption(key: string): boolean {
    return this.options.has(key);
  }

  /**
   * Get all required options
   */
  getRequiredOptions(): ConfigOption[] {
    return this.data.options.filter(opt => opt.required);
  }

  /**
   * Search options by keyword (searches key, display name, description)
   */
  searchOptions(keyword: string): ConfigOption[] {
    const lowerKeyword = keyword.toLowerCase();
    return this.data.options.filter(opt =>
      opt.key.toLowerCase().includes(lowerKeyword) ||
      opt.displayName.toLowerCase().includes(lowerKeyword) ||
      opt.description.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Get full dictionary data
   */
  getData(): ConfigDictionaryData {
    return this.data;
  }
}

// Export singleton instance
export const configDictionary = new ConfigDictionary();

// Re-export types
export * from './types';
