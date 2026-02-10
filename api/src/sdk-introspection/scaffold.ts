/**
 * Dictionary Scaffold
 *
 * Generates stub ConfigOption entries from introspection data
 * for options not yet in the dictionary. Stubs are meant for
 * human curation — they pre-fill key, type, and description,
 * but leave SE guidance, warnings, and examples empty.
 */

import { configDictionary, ConfigOption, ConfigOptionType } from '../config-dictionary';
import { IntrospectionResponse } from './types';

/**
 * Map introspection type strings to ConfigOptionType
 */
function mapType(sdkType: string): ConfigOptionType {
  const normalized = sdkType.toLowerCase();
  const numberTypes = new Set(['float', 'double', 'int', 'integer', 'decimal', 'number']);
  const boolTypes = new Set(['bool', 'boolean']);
  const stringTypes = new Set(['str', 'string']);
  const listTypes = new Set(['list', 'array', 'string[]']);
  const functionTypes = new Set(['callable', 'callback', 'func', 'closure', 'lambda', 'function']);

  if (numberTypes.has(normalized)) return 'number';
  if (boolTypes.has(normalized)) return 'boolean';
  if (stringTypes.has(normalized)) return 'string';
  if (listTypes.has(normalized)) return 'array';
  if (functionTypes.has(normalized)) return 'function';

  // Default to string for unknown types
  return 'string';
}

/**
 * Normalize a key to camelCase (our canonical form)
 */
function normalizeKey(key: string): string {
  // snake_case -> camelCase
  if (key.includes('_')) {
    return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
  // PascalCase -> camelCase
  if (key.length > 0 && key.charAt(0) === key.charAt(0).toUpperCase() && !key.includes('_')) {
    return key.charAt(0).toLowerCase() + key.slice(1);
  }
  return key;
}

/**
 * Generate stub dictionary entries for introspected options not yet in the dictionary.
 */
export function scaffoldDictionary(
  sdk: string,
  introspection: IntrospectionResponse
): ConfigOption[] {
  const stubs: ConfigOption[] = [];

  for (const opt of introspection.options) {
    const canonical = opt.canonicalKey || normalizeKey(opt.key);

    // Skip if already in dictionary
    if (configDictionary.hasOption(canonical)) {
      continue;
    }

    stubs.push({
      key: canonical,
      displayName: canonical
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim(),
      description: opt.description || `${sdk} SDK option (auto-scaffolded)`,
      type: mapType(opt.type),
      category: 'core',
      required: opt.required,
      defaultValue: opt.default,
      supportedSDKs: [sdk],
    });
  }

  return stubs;
}
