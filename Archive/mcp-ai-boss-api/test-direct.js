import { ToolGenerator } from './dist/tools/generator.js';

const specPath = '../AI-BOSS-API/generated/openapi.json';
console.log('Testing with spec path:', specPath);

try {
  const generator = new ToolGenerator(specPath);
  const tools = generator.generateAllTools();
  console.log('✅ Success! Generated', tools.length, 'tools');
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
}
