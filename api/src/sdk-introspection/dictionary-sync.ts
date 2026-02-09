/**
 * Dictionary Sync
 *
 * Compares the manual config dictionary against live introspected data
 * to detect drift between documentation and actual SDK capabilities.
 */

import { configDictionary } from '../config-dictionary';
import { IntrospectionResponse, DictionarySyncResult } from './types';

/**
 * Convert snake_case to camelCase for cross-SDK key normalization
 */
function snakeToCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert PascalCase to camelCase
 */
function pascalToCamelCase(str: string): string {
  if (!str || str.length === 0) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Normalize a key to camelCase (our canonical form)
 */
function normalizeKey(key: string): string {
  if (key.includes('_')) return snakeToCamelCase(key);
  if (key.length > 0 && key.charAt(0) === key.charAt(0).toUpperCase() && !key.includes('_')) {
    return pascalToCamelCase(key);
  }
  return key;
}

/**
 * Compare dictionary options against introspected SDK options
 */
export function syncDictionary(
  sdk: string,
  introspection: IntrospectionResponse
): DictionarySyncResult {
  const allDictOptions = configDictionary.getAllOptions();

  // Filter dictionary options to those supported by this SDK (or universal ones)
  const dictKeys = new Set<string>();
  for (const opt of allDictOptions) {
    if (!opt.supportedSDKs || opt.supportedSDKs.includes(sdk)) {
      dictKeys.add(opt.key);
    }
  }

  // Normalize introspected keys to camelCase for comparison
  const sdkKeyMap = new Map<string, string>(); // canonicalKey -> originalKey
  for (const opt of introspection.options) {
    const canonical = opt.canonicalKey || normalizeKey(opt.key);
    sdkKeyMap.set(canonical, opt.key);
  }

  const matched: string[] = [];
  const dictionaryOnly: string[] = [];
  const sdkOnly: string[] = [];
  const typeConflicts: Array<{ key: string; dictType: string; sdkType: string }> = [];

  // Check dictionary keys against SDK
  for (const dictKey of dictKeys) {
    if (sdkKeyMap.has(dictKey)) {
      matched.push(dictKey);

      // Check for type conflicts
      const dictOption = configDictionary.getOption(dictKey);
      const sdkOption = introspection.options.find(
        o => (o.canonicalKey || normalizeKey(o.key)) === dictKey
      );

      if (dictOption && sdkOption && dictOption.type && sdkOption.type) {
        const dictType = dictOption.type.toLowerCase();
        const sdkType = sdkOption.type.toLowerCase();
        if (dictType !== sdkType && !isCompatibleType(dictType, sdkType)) {
          typeConflicts.push({ key: dictKey, dictType, sdkType });
        }
      }
    } else {
      dictionaryOnly.push(dictKey);
    }
  }

  // Check SDK keys not in dictionary
  for (const [canonical] of sdkKeyMap) {
    if (!dictKeys.has(canonical)) {
      sdkOnly.push(canonical);
    }
  }

  const total = new Set([...dictKeys, ...sdkKeyMap.keys()]).size;
  const syncScore = total > 0 ? Math.round((matched.length / total) * 100) : 0;

  return {
    sdk,
    dictionaryCount: dictKeys.size,
    introspectedCount: sdkKeyMap.size,
    matched,
    dictionaryOnly,
    sdkOnly,
    typeConflicts,
    syncScore,
  };
}

/**
 * Check if two type strings are compatible (e.g., 'number' and 'float')
 */
function isCompatibleType(a: string, b: string): boolean {
  const numberTypes = new Set(['number', 'float', 'double', 'int', 'integer', 'decimal']);
  const stringTypes = new Set(['string', 'str']);
  const boolTypes = new Set(['boolean', 'bool']);
  const listTypes = new Set(['array', 'list', 'string[]']);
  const functionTypes = new Set(['function', 'callable', 'callback', 'func', 'closure', 'lambda']);

  const groups = [numberTypes, stringTypes, boolTypes, listTypes, functionTypes];
  for (const group of groups) {
    if (group.has(a) && group.has(b)) return true;
  }
  return false;
}
