#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const distPath = path.join(__dirname, '../dist/cli.js');
if (fs.existsSync(distPath)) {
  const { runCli } = require(distPath);
  runCli();
} else if (typeof Bun !== 'undefined') {
  import('../src/cli.ts').then(({ runCli }) => runCli());
} else {
  try {
    // Try requiring ts-node or similar if available, otherwise prompt build
    require('../dist/cli.js').runCli();
  } catch {
    console.error("shaleme: build bundle not found. Please run 'npm run build' or 'bun run build'.");
    process.exit(1);
  }
}
