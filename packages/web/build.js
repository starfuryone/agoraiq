#!/usr/bin/env node
/**
 * @agoraiq/web build script
 *
 * tsc compiles src/ → dist/, but public/ (HTML, static assets)
 * must be copied alongside the compiled server so that
 *   path.join(__dirname, '../public/...')
 * resolves correctly from dist/server.js.
 *
 * Layout after build:
 *   dist/
 *     server.js          ← compiled from src/server.ts
 *   public/
 *     *.html, static/    ← copied verbatim
 */

const fs = require('fs');
const path = require('path');

const SRC_PUBLIC = path.join(__dirname, 'public');
const DEST_PUBLIC = path.join(__dirname, 'dist', '..', 'public');
// public/ sits next to dist/, not inside it, because server.ts
// references path.join(__dirname, '../public/...')

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory not found: ${src}`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }

  return count;
}

// ── Main ──────────────────────────────────────────────────────

console.log('Copying public/ assets...');

// Since server.ts already references '../public/' relative to __dirname
// (which is dist/ after compile), public/ should be at the same level.
// But to be safe we also copy into dist/../public which is just ./public
// — effectively a no-op when running from the package root.
// The real value is when the build runs in a container or CI where dist/
// is the only output directory.

const distPublic = path.join(__dirname, 'dist', 'public');
const fileCount = copyDirSync(SRC_PUBLIC, distPublic);

console.log(`Copied ${fileCount} files to dist/public/`);
console.log('Build complete.');
