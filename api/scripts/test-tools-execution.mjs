#!/usr/bin/env node
// Pre-deploy tool execution test
// Tests that tools can be executed (module paths, imports work correctly)
// AWS credential errors are OK - they're expected locally

import { getAgent } from '../dist/mastra/index.js';
import { setCurrentProjectId, listSourceFilesTool } from '../dist/mastra/tools/source-code.js';

const errors = [];

console.log('=== Tool Execution Tests ===\n');

// Test 1: Agent tools registration
console.log('[1/3] Checking agent tools registration...');
try {
  const agent = getAgent('unsonMana');
  if (!agent) {
    throw new Error('unsonMana agent not found');
  }
  const tools = await agent.listTools();
  const requiredTools = ['list_source_files', 'read_source_file', 'search_source_code'];
  const missingTools = requiredTools.filter(t => !tools[t]);
  if (missingTools.length > 0) {
    throw new Error(`Missing tools: ${missingTools.join(', ')}`);
  }
  console.log('      ✓ All source-code tools registered');
} catch (e) {
  console.log(`      ✗ ${e.message}`);
  errors.push(e.message);
}

// Test 2: Source code tool execution (will fail on AWS credentials, but should not fail on module paths)
console.log('[2/3] Testing source-code tool execution...');
try {
  setCurrentProjectId('proj_test');
  const result = await listSourceFilesTool.execute({ path: 'test/' });

  // Check if it failed due to path/module issues (bad) vs AWS credentials (expected)
  if (!result.success) {
    const error = result.error || '';
    if (error.includes('Cannot find module') || error.includes('ERR_MODULE_NOT_FOUND')) {
      throw new Error(`Module path error: ${error}`);
    }
    if (error.includes('credentials') || error.includes('Missing credentials')) {
      console.log('      ✓ Tool executed (AWS credentials error is expected locally)');
    } else if (error.includes('Project not found')) {
      console.log('      ✓ Tool executed (project not found is expected for test project)');
    } else {
      console.log(`      ✓ Tool executed with expected error: ${error.substring(0, 50)}...`);
    }
  } else {
    console.log('      ✓ Tool executed successfully');
  }
} catch (e) {
  // Catch actual JS errors (not tool result errors)
  if (e.message.includes('Cannot find module') || e.message.includes('ERR_MODULE_NOT_FOUND')) {
    console.log(`      ✗ Module path error: ${e.message}`);
    errors.push(e.message);
  } else {
    console.log(`      ✓ Tool execution attempted (error: ${e.message.substring(0, 50)}...)`);
  }
}

// Test 3: Bridge setCurrentProjectId import
console.log('[3/3] Testing bridge integration...');
try {
  const bridge = await import('../dist/mastra/bridge.js');
  if (typeof bridge.askMana !== 'function') {
    throw new Error('askMana not exported from bridge');
  }
  console.log('      ✓ Bridge module OK');
} catch (e) {
  console.log(`      ✗ ${e.message}`);
  errors.push(e.message);
}

// Summary
console.log('\n=== Summary ===');
if (errors.length > 0) {
  console.log(`\n❌ ${errors.length} error(s) found:`);
  errors.forEach(e => console.log(`   - ${e}`));
  process.exit(1);
} else {
  console.log('\n✅ All tests passed');
  process.exit(0);
}
