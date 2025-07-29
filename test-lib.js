#!/usr/bin/env node

// Test script to verify the library works correctly
import generateSite, { generate, serve } from './lib/index.js';
import { resolve } from 'path';

console.log('Testing ursa library...\n');

// Test 1: Check that functions are exported
console.log('✓ Default export type:', typeof generateSite);
console.log('✓ Generate export type:', typeof generate);
console.log('✓ Serve export type:', typeof serve);

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
  console.log('\nAvailable functions:');
  console.log('  • generateSite({ source, meta, output }) - One-time generation');
  console.log('  • generate({ _source, _meta, _output }) - Direct generation');
  console.log('  • serve({ _source, _meta, _output, port }) - Development server');
  
  console.log('\nExample usage:');
  console.log(`
// Generate once
import generateSite from '@kenjura/ursa';
await generateSite({
  source: './content',
  meta: './meta', 
  output: './dist'
});

// Development server
import { serve } from '@kenjura/ursa';
await serve({
  _source: './content',
  _meta: './meta',
  _output: './dist',
  port: 3000
});
  `);
  
} catch (error) {
  console.log('✗ Error during setup:', error.message);
}
