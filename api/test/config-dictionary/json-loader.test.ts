/**
 * Tests for JSON-based ConfigDictionary loading
 */

import { ConfigDictionary } from '../../src/config-dictionary';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ConfigDictionary JSON loader', () => {
  describe('loading from default directory', () => {
    let dictionary: ConfigDictionary;

    beforeEach(() => {
      dictionary = new ConfigDictionary();
    });

    it('should load all options from JSON files', () => {
      const options = dictionary.getAllOptions();
      expect(options.length).toBeGreaterThan(50);
    });

    it('should load core options including dsn', () => {
      const dsn = dictionary.getOption('dsn');
      expect(dsn).toBeDefined();
      expect(dsn?.type).toBe('string');
      expect(dsn?.required).toBe(true);
      expect(dsn?.category).toBe('core');
    });

    it('should handle null supportedSDKs as universal (all SDKs)', () => {
      const dsn = dictionary.getOption('dsn');
      expect(dsn?.supportedSDKs).toBeUndefined();

      const shutdownTimeout = dictionary.getOption('shutdownTimeout');
      expect(shutdownTimeout?.supportedSDKs).toEqual(['javascript', 'python', 'go']);
    });

    it('should filter options by category', () => {
      const coreOptions = dictionary.getOptionsByCategory('core');
      expect(coreOptions.length).toBeGreaterThan(0);
      coreOptions.forEach(opt => {
        expect(opt.category).toBe('core');
      });
    });

    it('should search options by keyword', () => {
      const results = dictionary.searchOptions('sample');
      expect(results.length).toBeGreaterThan(0);
      const keys = results.map(r => r.key);
      expect(keys).toContain('sampleRate');
      expect(keys).toContain('tracesSampleRate');
    });

    it('should return required options', () => {
      const required = dictionary.getRequiredOptions();
      expect(required.length).toBeGreaterThan(0);
      expect(required.some(o => o.key === 'dsn')).toBe(true);
    });

    it('should check option existence', () => {
      expect(dictionary.hasOption('dsn')).toBe(true);
      expect(dictionary.hasOption('nonexistentOption')).toBe(false);
    });

    it('should include Cocoa-specific options', () => {
      expect(dictionary.hasOption('appHangTimeoutInterval')).toBe(true);
      expect(dictionary.hasOption('enableCoreDataTracing')).toBe(true);

      const appHang = dictionary.getOption('appHangTimeoutInterval');
      expect(appHang?.supportedSDKs).toEqual(['cocoa']);
    });

    it('should include cocoa in profilesSampleRate supportedSDKs', () => {
      const profiles = dictionary.getOption('profilesSampleRate');
      expect(profiles?.supportedSDKs).toContain('cocoa');
    });

    it('should return all categories', () => {
      const categories = dictionary.getCategories();
      expect(categories.core).toBeDefined();
      expect(categories.sampling).toBeDefined();
      expect(categories.performance).toBeDefined();
    });

    it('should return full dictionary data', () => {
      const data = dictionary.getData();
      expect(data.options.length).toBeGreaterThan(0);
      expect(data.categories).toBeDefined();
    });
  });

  describe('loading from custom directory', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-dict-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should load options from a custom directory', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify([
          {
            key: 'testOption',
            displayName: 'Test Option',
            description: 'A test option',
            type: 'string',
            category: 'core',
            required: false,
            supportedSDKs: null,
          },
        ])
      );

      const dictionary = new ConfigDictionary(tmpDir);
      expect(dictionary.hasOption('testOption')).toBe(true);
      expect(dictionary.getAllOptions()).toHaveLength(1);
    });

    it('should handle empty directory gracefully', () => {
      const dictionary = new ConfigDictionary(tmpDir);
      expect(dictionary.getAllOptions()).toHaveLength(0);
    });

    it('should skip non-JSON files', () => {
      fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not json');
      fs.writeFileSync(
        path.join(tmpDir, 'valid.json'),
        JSON.stringify([
          {
            key: 'validOption',
            displayName: 'Valid',
            description: 'valid',
            type: 'string',
            category: 'core',
            required: false,
            supportedSDKs: null,
          },
        ])
      );

      const dictionary = new ConfigDictionary(tmpDir);
      expect(dictionary.getAllOptions()).toHaveLength(1);
    });

    it('should convert null supportedSDKs to undefined', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'test.json'),
        JSON.stringify([
          {
            key: 'universalOption',
            displayName: 'Universal',
            description: 'available everywhere',
            type: 'boolean',
            category: 'core',
            required: false,
            supportedSDKs: null,
          },
          {
            key: 'limitedOption',
            displayName: 'Limited',
            description: 'only some SDKs',
            type: 'boolean',
            category: 'core',
            required: false,
            supportedSDKs: ['python', 'javascript'],
          },
        ])
      );

      const dictionary = new ConfigDictionary(tmpDir);
      const universal = dictionary.getOption('universalOption');
      const limited = dictionary.getOption('limitedOption');

      expect(universal?.supportedSDKs).toBeUndefined();
      expect(limited?.supportedSDKs).toEqual(['python', 'javascript']);
    });
  });
});
