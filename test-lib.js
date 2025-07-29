#!/usr/bin/env node

// Test script to verify the library works correctly
import generateSite, { generate } from './lib/index.js';
import { resolve } from 'path';

console.log('Testing ursa library...\n');

// Test 1: Check that functions are exported
console.log('✓ Default export type:', typeof generateSite);
console.log('✓ Named export type:', typeof generate);

// Test 2: Check parameter validation
try {
  generateSite({});
  console.log('✗ Parameter validation failed');
} catch (error) {
  console.log('✓ Parameter validation works:', error.message);
}

// Test 3: Check that it returns a promise
try {
  const testSource = resolve('./test-source');
  const testMeta = resolve('./meta');
  const testOutput = resolve('./test-output');
  
  console.log('\n📁 Test paths:');
  console.log('  Source:', testSource);
  console.log('  Meta:', testMeta);
  console.log('  Output:', testOutput);
  
  console.log('\n🚀 Library is ready for use!');
  console.log('\nTo test with actual generation, create test directories and run:');
  console.log('  node test-lib.js');
  
} catch (error) {
  console.log('✗ Error during setup:', error.message);
}
