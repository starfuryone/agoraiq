/* ═══════════════════════════════════════════════════════════════
   AgoraIQ — Shared App Helpers (app.js)
═══════════════════════════════════════════════════════════════ */

// ── Config ────────────────────────────────────────────────────
window.AGORAIQ = window.AGORAIQ || {};
const API = window.AGORAIQ_API_URL || '';

// ── API fetch wrapper ─────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (res.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return null;
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || `Request failed (${res.status})`);
    }
    return res.json();
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
    return null;
  }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  t.innerHTML = `<span style="flex-shrink:0">${icon}</span><span>${msg}</span>`;
  t.className = `show ${type}`;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.className = ''; }, 3500);
}

// ── Formatters ────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDateShort(iso);
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtPct(n) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function daysSince(iso) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return `${d} day${d !== 1 ? 's' : ''} ago`;
}

function escapeHTML(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

// ── Nav active state ──────────────────────────────────────────
function setActiveNav() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('nav a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const normalised = href.replace(/\/$/, '') || '/';
    if (path === normalised || (normalised !== '/' && path.startsWith(normalised))) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}

// ── Mobile nav toggle ─────────────────────────────────────────
function initMobileNav() {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!e.target.closest('nav') && !e.target.closest('.menu-toggle')) {
      nav.classList.remove('open');
    }
  });
}

// ── Auth user in header ───────────────────────────────────────
async function loadHeaderUser() {
  const badge = document.getElementById('username-badge');
  if (!badge) return;
  try {
    const me = await apiFetch('/api/v1/users/me');
    if (me) {
      badge.textContent = me.name || me.email?.split('@')[0] || 'User';
    }
  } catch (_) {}
}

// ── Logout ────────────────────────────────────────────────────
async function logout() {
  await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}

// ── Skeleton helpers ──────────────────────────────────────────
function skeletonLine(w = '100%', h = '12px') {
  return `<div class="skeleton" style="width:${w};height:${h};margin-bottom:6px"></div>`;
}

// ── Generic table renderer ────────────────────────────────────
function renderTablePlaceholder(tbody, cols, rows = 6) {
  tbody.innerHTML = Array(rows).fill(0).map(() =>
    `<tr>${Array(cols).fill(0).map(() =>
      `<td><div class="skeleton" style="height:12px;width:${40 + Math.random() * 40}%"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

// ── Activity bar chart ────────────────────────────────────────
function renderActivityBars(containerId, data, count = 28, startLabelId = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const arr = Array(count).fill(0);
  const slice = (data || []).slice(-count);
  slice.forEach((v, i) => { arr[arr.length - slice.length + i] = v; });
  const max = Math.max(...arr, 1);
  container.innerHTML = arr.map((v, i) => {
    const h = Math.max(Math.round((v / max) * 100), 6);
    const cls = i === count - 1 ? 'today' : v > 0 ? 'active' : '';
    return `<div class="bar ${cls}" style="height:${h}%"></div>`;
  }).join('');
  if (startLabelId) {
    const d = new Date();
    d.setDate(d.getDate() - count);
    const el = document.getElementById(startLabelId);
    if (el) el.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setActiveNav();
  initMobileNav();
});
