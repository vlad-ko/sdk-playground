/**
 * Configuration analyzer types
 */

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface Warning {
  severity: WarningSeverity;
  message: string;
  optionKey?: string;
  fix?: string;
}

export interface Recommendation {
  title: string;
  description: string;
  optionKey?: string;
  priority: 'high' | 'medium' | 'low';
  example?: string;
}

export interface OptionAnalysis {
  key: string;
  displayName: string;
  value: any;
  rawValue: string;
  type: string;
  category: string;
  description: string;
  seGuidance?: string;
  docsUrl?: string;
  recognized: boolean;
  source?: 'dictionary' | 'introspection';
  warnings: Warning[];
}

export interface AnalysisResult {
  valid: boolean;
  sdk: string;
  summary: string;
  options: OptionAnalysis[];
  warnings: Warning[];
  recommendations: Recommendation[];
  score: number;
  parseErrors: Array<{ message: string; line?: number; column?: number }>;
}
