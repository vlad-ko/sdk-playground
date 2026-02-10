/**
 * Configuration Analyzer
 *
 * Analyzes Sentry SDK configurations and provides:
 * - Validation of options
 * - Warnings for misconfigurations
 * - Recommendations for best practices
 * - Health score calculation
 *
 * Uses introspection as fallback for options not in the dictionary.
 */

import { configDictionary } from '../config-dictionary';
import { IConfigParser, ParsedConfig, ParsedOption } from '../config-parsers/types';
import { AnalysisResult, OptionAnalysis, Warning, Recommendation, WarningSeverity } from './types';
import { getSDKConfig, formatKeyForSDK, formatExample, getLambdaExample, usesSnakeCase } from './sdk-config';
import { IntrospectionResponse, IntrospectedOption } from '../sdk-introspection/types';

export type IntrospectFn = (sdk: string) => Promise<IntrospectionResponse>;

export class ConfigAnalyzer {
  private parser: IConfigParser;

  constructor(parser: IConfigParser) {
    this.parser = parser;
  }

  /**
   * Convert snake_case to camelCase
   * Used to normalize Python option names (traces_sample_rate -> tracesSampleRate)
   */
  private snakeToCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Convert PascalCase to camelCase
   * Used to normalize .NET/Go option names (TracesSampleRate -> tracesSampleRate, Dsn -> dsn)
   */
  private pascalToCamelCase(str: string): string {
    if (!str || str.length === 0) return str;
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * Check if a string is PascalCase (starts with uppercase, no underscores)
   */
  private isPascalCase(str: string): boolean {
    return str.length > 0 &&
           str.charAt(0) === str.charAt(0).toUpperCase() &&
           !str.includes('_');
  }

  /**
   * Normalize option key to camelCase for dictionary lookup
   * Handles: snake_case (Python/Ruby/PHP), PascalCase (.NET/Go), camelCase (JS)
   */
  private normalizeKey(key: string): string {
    // snake_case -> camelCase
    if (key.includes('_')) {
      return this.snakeToCamelCase(key);
    }
    // PascalCase -> camelCase
    if (this.isPascalCase(key)) {
      return this.pascalToCamelCase(key);
    }
    // Already camelCase
    return key;
  }

  /**
   * Convert camelCase to snake_case
   * Used to check Python options (tracesSampleRate -> traces_sample_rate)
   */
  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  /**
   * Convert camelCase to PascalCase
   * Used to check .NET/Go options (tracesSampleRate -> TracesSampleRate)
   */
  private camelToPascalCase(str: string): string {
    if (!str || str.length === 0) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Check if parsed options contain a key (handles snake_case, PascalCase, and camelCase)
   */
  private parsedOptionsHas(options: Map<string, ParsedOption>, key: string): boolean {
    // Check the key as-is first
    if (options.has(key)) {
      return true;
    }
    // Try snake_case version for Python configs
    const snakeKey = this.camelToSnakeCase(key);
    if (options.has(snakeKey)) {
      return true;
    }
    // Try PascalCase version for .NET/Go configs
    const pascalKey = this.camelToPascalCase(key);
    if (options.has(pascalKey)) {
      return true;
    }
    return false;
  }

  /**
   * Find an option in introspection data by normalized key
   */
  private findInIntrospection(normalizedKey: string, introspection: IntrospectionResponse): IntrospectedOption | undefined {
    return introspection.options.find(opt => {
      const canonical = opt.canonicalKey || this.normalizeKey(opt.key);
      return canonical === normalizedKey;
    });
  }

  /**
   * Analyze a configuration code string
   * Optionally accepts an introspection function for fallback option recognition.
   */
  async analyze(configCode: string, sdk: string, introspectFn?: IntrospectFn): Promise<AnalysisResult> {
    // Parse the configuration
    const parsed = this.parser.parse(configCode);

    // Initialize result
    const result: AnalysisResult = {
      valid: parsed.valid,
      sdk,
      summary: '',
      options: [],
      warnings: [],
      recommendations: [],
      score: 0,
      parseErrors: parsed.parseErrors,
    };

    if (!parsed.valid) {
      result.summary = 'Configuration contains parse errors';
      result.warnings.push({
        severity: 'error',
        message: 'Failed to parse configuration',
      });
      return result;
    }

    // First pass: analyze each option (dictionary only)
    const optionAnalyses: OptionAnalysis[] = [];
    const warnings: Warning[] = [];

    for (const [key, parsedOption] of parsed.options.entries()) {
      const analysis = this.analyzeOption(parsedOption, sdk, null);
      optionAnalyses.push(analysis);
    }

    // If there are unrecognized options and an introspect function is provided,
    // fetch introspection data once and re-analyze those options
    const unknowns = optionAnalyses.filter(a => !a.recognized);
    if (unknowns.length > 0 && introspectFn) {
      let introspection: IntrospectionResponse | null = null;
      try {
        introspection = await introspectFn(sdk);
      } catch {
        // Graceful degradation: introspection failure is non-fatal
      }

      if (introspection) {
        // Re-analyze unknown options with introspection data
        for (let i = 0; i < optionAnalyses.length; i++) {
          if (!optionAnalyses[i].recognized) {
            const parsedOption = parsed.options.get(optionAnalyses[i].key);
            if (parsedOption) {
              optionAnalyses[i] = this.analyzeOption(parsedOption, sdk, introspection);
            }
          }
        }
      }
    }

    // Collect warnings from all option analyses
    for (const analysis of optionAnalyses) {
      warnings.push(...analysis.warnings);
    }

    result.options = optionAnalyses;

    // Check for missing required options
    const missingRequired = this.checkMissingRequired(parsed, sdk);
    warnings.push(...missingRequired);

    result.warnings = warnings;

    // Generate recommendations
    result.recommendations = this.generateRecommendations(parsed, sdk);

    // Calculate health score
    result.score = this.calculateScore(parsed, warnings, result.recommendations);

    // Generate summary
    result.summary = this.generateSummary(result);

    return result;
  }

  /**
   * Analyze a single configuration option
   */
  private analyzeOption(parsedOption: ParsedOption, sdk: string, introspection: IntrospectionResponse | null): OptionAnalysis {
    // Normalize key for dictionary lookup (handles Python snake_case -> camelCase)
    const normalizedKey = this.normalizeKey(parsedOption.key);
    const dictOption = configDictionary.getOption(normalizedKey);

    const analysis: OptionAnalysis = {
      key: parsedOption.key,
      displayName: dictOption?.displayName || parsedOption.key,
      value: parsedOption.value,
      rawValue: parsedOption.rawValue,
      type: parsedOption.type,
      category: dictOption?.category || 'unknown',
      description: dictOption?.description || 'Unknown configuration option',
      seGuidance: dictOption?.seGuidance,
      docsUrl: dictOption?.docsUrl,
      recognized: !!dictOption,
      source: dictOption ? 'dictionary' : undefined,
      warnings: [],
    };

    // Check if option is recognized via dictionary
    if (dictOption) {
      // Check SDK compatibility
      if (dictOption.supportedSDKs && !dictOption.supportedSDKs.includes(sdk)) {
        analysis.warnings.push({
          severity: 'warning',
          message: `Option "${parsedOption.key}" may not be supported in ${sdk} SDK`,
          optionKey: parsedOption.key,
        });
      }

      // Add option-specific warnings from dictionary
      if (dictOption.warnings) {
        dictOption.warnings.forEach(warningMsg => {
          analysis.warnings.push({
            severity: 'info',
            message: warningMsg,
            optionKey: parsedOption.key,
          });
        });
      }

      // Value-specific validation
      const valueWarnings = this.validateOptionValue(parsedOption, dictOption);
      analysis.warnings.push(...valueWarnings);

      return analysis;
    }

    // Not in dictionary — try introspection fallback
    if (introspection) {
      const introspectedOpt = this.findInIntrospection(normalizedKey, introspection);
      if (introspectedOpt) {
        analysis.recognized = true;
        analysis.source = 'introspection';
        analysis.description = introspectedOpt.description || `SDK option recognized via introspection`;
        analysis.warnings.push({
          severity: 'info',
          message: `Option "${parsedOption.key}" recognized via SDK introspection (not yet in dictionary)`,
          optionKey: parsedOption.key,
        });
        return analysis;
      }
    }

    // Not found in dictionary or introspection
    analysis.warnings.push({
      severity: 'warning',
      message: `Unknown option "${parsedOption.key}" - may be deprecated or SDK-specific`,
      optionKey: parsedOption.key,
    });
    return analysis;
  }

  /**
   * Validate option value
   */
  private validateOptionValue(parsedOption: ParsedOption, dictOption: any): Warning[] {
    const warnings: Warning[] = [];
    // Normalize key for comparisons (handles Python snake_case)
    const normalizedKey = this.normalizeKey(parsedOption.key);

    // Check DSN format
    if (normalizedKey === 'dsn') {
      if (typeof parsedOption.value === 'string') {
        if (!parsedOption.value.startsWith('https://')) {
          warnings.push({
            severity: 'error',
            message: 'DSN should use HTTPS protocol',
            optionKey: 'dsn',
            fix: 'Use a DSN starting with https://',
          });
        }
        if (!parsedOption.value.includes('@') || !parsedOption.value.includes('.ingest')) {
          warnings.push({
            severity: 'warning',
            message: 'DSN format may be invalid - expected format: https://key@org.ingest.sentry.io/project',
            optionKey: 'dsn',
          });
        }
      }
    }

    // Check sample rates
    if (normalizedKey === 'sampleRate' || normalizedKey === 'tracesSampleRate' || normalizedKey === 'profilesSampleRate') {
      if (parsedOption.type === 'number') {
        const rate = parsedOption.value;
        if (rate < 0 || rate > 1) {
          warnings.push({
            severity: 'error',
            message: `${parsedOption.key} must be between 0.0 and 1.0`,
            optionKey: parsedOption.key,
            fix: 'Set a value between 0.0 and 1.0',
          });
        }

        // Warn about 100% sampling in production
        if (normalizedKey === 'tracesSampleRate' && rate === 1.0) {
          warnings.push({
            severity: 'warning',
            message: '100% transaction sampling may quickly exhaust quota in production',
            optionKey: parsedOption.key,
            fix: 'Consider reducing to 0.1 (10%) or lower for production',
          });
        }
      }
    }

    // Check debug mode
    if (normalizedKey === 'debug' && parsedOption.value === true) {
      warnings.push({
        severity: 'warning',
        message: 'Debug mode should be disabled in production',
        optionKey: parsedOption.key,
        fix: 'Set debug: false for production environments',
      });
    }

    // Check sendDefaultPii
    if (normalizedKey === 'sendDefaultPii' && parsedOption.value === true) {
      warnings.push({
        severity: 'warning',
        message: 'Sending default PII may violate privacy regulations',
        optionKey: parsedOption.key,
        fix: 'Consider using beforeSend for fine-grained PII control',
      });
    }

    // Check environment
    if (normalizedKey === 'environment') {
      if (typeof parsedOption.value === 'string' && parsedOption.value === 'production') {
        // This is fine, but note it
      }
    }

    return warnings;
  }

  /**
   * Check for missing required options
   */
  private checkMissingRequired(parsed: ParsedConfig, sdk: string): Warning[] {
    const warnings: Warning[] = [];
    const requiredOptions = configDictionary.getRequiredOptions();

    for (const required of requiredOptions) {
      if (!this.parsedOptionsHas(parsed.options, required.key)) {
        warnings.push({
          severity: 'error',
          message: `Missing required option: ${required.key}`,
          optionKey: required.key,
          fix: `Add ${required.key} to your configuration`,
        });
      }
    }

    return warnings;
  }

  /**
   * Generate recommendations based on configuration
   */
  private generateRecommendations(parsed: ParsedConfig, sdk: string): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const sdkConfig = getSDKConfig(sdk);
    const isSnakeCase = usesSnakeCase(sdk);

    // Check if environment is set
    if (!this.parsedOptionsHas(parsed.options, 'environment')) {
      recommendations.push({
        title: 'Set environment',
        description: 'Setting the environment helps separate events from different deployment stages',
        optionKey: 'environment',
        priority: 'high',
        example: formatExample('environment', 'production', sdk),
      });
    }

    // Check if release is set
    if (!this.parsedOptionsHas(parsed.options, 'release')) {
      recommendations.push({
        title: 'Set release version',
        description: 'Setting release enables features like suspect commits and release health tracking',
        optionKey: 'release',
        priority: 'high',
        example: formatExample('release', 'my-app@1.0.0', sdk),
      });
    }

    // Check for tracesSampleRate if not set
    if (!this.parsedOptionsHas(parsed.options, 'tracesSampleRate') && !this.parsedOptionsHas(parsed.options, 'enableTracing')) {
      const displayKey = formatKeyForSDK('tracesSampleRate', sdk);
      recommendations.push({
        title: 'Enable performance monitoring',
        description: `Add ${displayKey} to enable performance monitoring and track application performance`,
        optionKey: 'tracesSampleRate', // Canonical key for lookups
        priority: 'medium',
        example: formatExample('tracesSampleRate', '0.1', sdk, 'Sample 10% of transactions'),
      });
    }

    // Recommend beforeSend for PII scrubbing
    if (!this.parsedOptionsHas(parsed.options, 'beforeSend')) {
      const displayKey = formatKeyForSDK('beforeSend', sdk);
      recommendations.push({
        title: `Add ${displayKey} for PII scrubbing`,
        description: `Use ${displayKey} to remove sensitive data before events are sent to Sentry`,
        optionKey: 'beforeSend', // Canonical key for lookups
        priority: 'medium',
        example: `${displayKey}${sdkConfig.assignmentOperator}${getLambdaExample(sdk)}`,
      });
    }

    // Check for ignoreErrors
    if (!this.parsedOptionsHas(parsed.options, 'ignoreErrors')) {
      const displayKey = formatKeyForSDK('ignoreErrors', sdk);
      recommendations.push({
        title: `Filter known errors with ${displayKey}`,
        description: isSnakeCase
          ? `Use ${displayKey} to filter out known exceptions and reduce noise`
          : `Use ${displayKey} to filter out browser quirks and third-party errors`,
        optionKey: 'ignoreErrors', // Canonical key for lookups
        priority: 'low',
        example: formatExample('ignoreErrors', '["ConnectionError", "TimeoutError"]', sdk),
      });
    }

    return recommendations;
  }

  /**
   * Calculate health score (0-100)
   */
  private calculateScore(parsed: ParsedConfig, warnings: Warning[], recommendations: Recommendation[]): number {
    let score = 100;

    // Deduct for errors
    const errors = warnings.filter(w => w.severity === 'error');
    score -= errors.length * 15;

    // Deduct for warnings
    const warningCount = warnings.filter(w => w.severity === 'warning');
    score -= warningCount.length * 5;

    // Deduct for missing best practices
    const highPriorityRecs = recommendations.filter(r => r.priority === 'high');
    score -= highPriorityRecs.length * 10;

    const mediumPriorityRecs = recommendations.filter(r => r.priority === 'medium');
    score -= mediumPriorityRecs.length * 5;

    // Bonus for having good options
    if (this.parsedOptionsHas(parsed.options, 'environment')) score += 5;
    if (this.parsedOptionsHas(parsed.options, 'release')) score += 5;
    if (this.parsedOptionsHas(parsed.options, 'beforeSend')) score += 5;

    // Ensure score is within bounds
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate summary text
   */
  private generateSummary(result: AnalysisResult): string {
    const errors = result.warnings.filter(w => w.severity === 'error').length;
    const warnings = result.warnings.filter(w => w.severity === 'warning').length;
    const optionsCount = result.options.length;

    if (errors > 0) {
      return `Found ${errors} error(s) and ${warnings} warning(s) in ${optionsCount} configuration options`;
    }

    if (warnings > 0) {
      return `Found ${warnings} warning(s) in ${optionsCount} configuration options`;
    }

    if (result.score >= 90) {
      return `Excellent configuration with ${optionsCount} options`;
    }

    if (result.score >= 70) {
      return `Good configuration with ${optionsCount} options, some improvements recommended`;
    }

    return `Configuration needs improvement - ${optionsCount} options analyzed`;
  }
}
