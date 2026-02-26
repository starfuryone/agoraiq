// ═══════════════════════════════════════════════════════════════
// @agoraiq/web — Static Web Server
//
// Serves the web dashboard (HTML/CSS/JS) and the public proof page.
// In production, this sits behind Nginx/Caddy which also proxies
// /api/* to the API server.
//
// This server ONLY serves static assets and HTML pages.
// All data comes from the API via fetch() from the browser.
// ═══════════════════════════════════════════════════════════════

import express from 'express';
import path from 'path';
import { createLogger } from '@agoraiq/db';

const log = createLogger('web-server');
const PORT = parseInt(process.env.WEB_PORT || '3000', 10);

const app = express();

// ── Resolve public/ directory ─────────────────────────────────
// Dev (tsx src/server.ts):  __dirname = src/   → ../public/ ✓
// Prod (node dist/server.js): __dirname = dist/ → ./public/ (copied by build.js)
// Fallback to ../public/ for running from package root
import fs from 'fs';
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')        // dist/public/ (production build)
  : path.join(__dirname, '..', 'public'); // ../public/ (dev or package root)

log.info({ publicDir: PUBLIC_DIR }, 'Resolved public directory');

// Serve static assets
app.use('/static', express.static(path.join(PUBLIC_DIR, 'static')));

// ── Public Proof Page ─────────────────────────────────────────
app.get('/proof', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'proof.html'));
});

// ── Dashboard Pages (SPA-style) ──────────────────────────────
app.get('/dashboard*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

// ── Auth Pages ────────────────────────────────────────────────
app.get('/login', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/signup', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'signup.html'));
});

// ── Pricing Page ─────────────────────────────────────────────
app.get('/pricing', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pricing.html'));
});

// ── About Pages ─────────────────────────────────────────────
app.get('/about', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'about.html'));
});

app.get('/careers', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'careers.html'));
});

app.get('/announcements', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'announcements.html'));
});

app.get('/news', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'news.html'));
});

app.get('/press', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'press.html'));
});

// ── Resource Pages ──────────────────────────────────────────
app.get('/blog', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'blog.html'));
});

app.get('/community', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'community.html'));
});

app.get('/risk-warning', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'risk-warning.html'));
});

app.get('/notices', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'notices.html'));
});

// ── Legal Pages ──────────────────────────────────────────────
app.get('/trust', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'trust.html'));
});

// ── Legal Pages ──────────────────────────────────────────────
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

app.get('/terms', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'terms.html'));
});

app.get('/cookies', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'cookies.html'));
});

app.get('/disclaimer', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'disclaimer.html'));
});

// ── Root → Proof ──────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.redirect('/proof');
});

app.listen(PORT, () => {
  log.info({ port: PORT }, '🌐 Web server running');
});
