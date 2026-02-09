#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find OpenAPI spec in common locations
const possiblePaths = [
  path.join(__dirname, '..', '..', 'AI-BOSS-API', 'generated', 'openapi.json'),
  path.join(__dirname, '..', '..', 'AI-BOSS-API', 'generated', 'openapi.json'),
  path.join(process.cwd(), '..', 'AI-BOSS-API', 'generated', 'openapi.json'),
  path.join(process.cwd(), 'AI-BOSS-API', 'generated', 'openapi.json'),
];

let openAPIPath = null;
for (const possiblePath of possiblePaths) {
  if (fs.existsSync(possiblePath)) {
    openAPIPath = possiblePath;
    break;
  }
}

if (!openAPIPath) {
  console.error('❌ OpenAPI spec not found. Please ensure AI-BOSS-API/generated/openapi.json exists.');
  console.error('Searched in:');
  possiblePaths.forEach(p => console.error(`  - ${p}`));
  process.exit(1);
}

// Copy to project root
const destPath = path.join(__dirname, '..', 'openapi.json');
fs.copyFileSync(openAPIPath, destPath);

console.log(`✅ Copied OpenAPI spec from ${openAPIPath} to ${destPath}`);

