/**
 * Tests for dictionary scaffold generation
 */

import { scaffoldDictionary } from '../../src/sdk-introspection/scaffold';
import { IntrospectionResponse } from '../../src/sdk-introspection/types';

describe('scaffoldDictionary', () => {
  const mockIntrospection: IntrospectionResponse = {
    sdk: 'cocoa',
    sdkVersion: '8.0.0',
    sdkPackage: 'Sentry',
    source: 'manifest',
    options: [
      // This one IS in the dictionary — should be skipped
      { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: 'Data Source Name' },
      // These are NOT in the dictionary — should be scaffolded
      { key: 'brandNewOption', canonicalKey: 'brandNewOption', type: 'boolean', required: false, default: false, description: 'A brand new SDK option' },
      { key: 'experimentalFloat', canonicalKey: 'experimentalFloat', type: 'float', required: false, default: 0.5, description: 'Experimental float option' },
      { key: 'myCallback', canonicalKey: 'myCallback', type: 'callable', required: false, default: null, description: 'A callback option' },
      { key: 'someList', canonicalKey: 'someList', type: 'list', required: false, default: null, description: 'A list option' },
    ],
    timestamp: '2024-01-01T00:00:00Z',
  };

  it('should skip options already in the dictionary', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const dsnStub = stubs.find(s => s.key === 'dsn');
    expect(dsnStub).toBeUndefined();
  });

  it('should scaffold options not in the dictionary', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    expect(stubs.length).toBe(4);
    const keys = stubs.map(s => s.key);
    expect(keys).toContain('brandNewOption');
    expect(keys).toContain('experimentalFloat');
    expect(keys).toContain('myCallback');
    expect(keys).toContain('someList');
  });

  it('should map float type to number', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const floatOpt = stubs.find(s => s.key === 'experimentalFloat');
    expect(floatOpt?.type).toBe('number');
  });

  it('should map callable type to function', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const callbackOpt = stubs.find(s => s.key === 'myCallback');
    expect(callbackOpt?.type).toBe('function');
  });

  it('should map list type to array', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const listOpt = stubs.find(s => s.key === 'someList');
    expect(listOpt?.type).toBe('array');
  });

  it('should map boolean type correctly', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const boolOpt = stubs.find(s => s.key === 'brandNewOption');
    expect(boolOpt?.type).toBe('boolean');
  });

  it('should set supportedSDKs to the current SDK', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    stubs.forEach(stub => {
      expect(stub.supportedSDKs).toEqual(['cocoa']);
    });
  });

  it('should preserve default values from introspection', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const floatOpt = stubs.find(s => s.key === 'experimentalFloat');
    expect(floatOpt?.defaultValue).toBe(0.5);

    const boolOpt = stubs.find(s => s.key === 'brandNewOption');
    expect(boolOpt?.defaultValue).toBe(false);
  });

  it('should use introspection description', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const opt = stubs.find(s => s.key === 'brandNewOption');
    expect(opt?.description).toBe('A brand new SDK option');
  });

  it('should generate displayName from camelCase key', () => {
    const stubs = scaffoldDictionary('cocoa', mockIntrospection);
    const opt = stubs.find(s => s.key === 'brandNewOption');
    expect(opt?.displayName).toBe('Brand New Option');
  });

  it('should return empty array when all options are in dictionary', () => {
    const introspection: IntrospectionResponse = {
      sdk: 'javascript',
      sdkVersion: '8.0.0',
      sdkPackage: '@sentry/browser',
      source: 'reflection',
      options: [
        { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
        { key: 'debug', canonicalKey: 'debug', type: 'boolean', required: false, default: false, description: '' },
      ],
      timestamp: '2024-01-01T00:00:00Z',
    };

    const stubs = scaffoldDictionary('javascript', introspection);
    expect(stubs).toHaveLength(0);
  });

  it('should use canonicalKey for dictionary lookup', () => {
    const introspection: IntrospectionResponse = {
      sdk: 'python',
      sdkVersion: '2.0.0',
      sdkPackage: 'sentry-sdk',
      source: 'reflection',
      options: [
        // SDK reports snake_case but canonicalKey is camelCase
        { key: 'traces_sample_rate', canonicalKey: 'tracesSampleRate', type: 'float', required: false, default: null, description: '' },
        { key: 'brand_new_thing', canonicalKey: 'brandNewThing', type: 'string', required: false, default: null, description: 'New' },
      ],
      timestamp: '2024-01-01T00:00:00Z',
    };

    const stubs = scaffoldDictionary('python', introspection);
    // tracesSampleRate is in dictionary, should be skipped
    expect(stubs.find(s => s.key === 'tracesSampleRate')).toBeUndefined();
    // brandNewThing is NOT in dictionary, should be scaffolded
    expect(stubs.find(s => s.key === 'brandNewThing')).toBeDefined();
  });
});
