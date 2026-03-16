/* ═══════════════════════════════════════════════════════════════
   Provider IQ — Page Logic
   Requires: /assets/app.js (apiFetch, getToken, clearToken, toast)

   API endpoints:
     GET /api/v1/providers/iq         → { data: [...], total: N }
     GET /api/v1/providers/iq/:id     → { data: {...}, monthly_iq, pairs, badges }
     GET /api/v1/auth/me              → { userId, email, plan, ... }
     POST /api/v1/ai/provider-iq      → { text: "..." }

   Tier model:
     Provider IQ = ELITE feature
     Leaderboard visible to all (marketing surface)
     Detail + AI = ELITE only
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────
let providers = [];
let currentTab = 'leaderboard';
let currentDetail = null;   // provider ID shown in detail view
let userPlan = 'FREE';      // updated from /auth/me
let aiLoading = null;       // provider ID currently loading AI

// ── Init ──────────────────────────────────────────────────────
async function pageInit() {
  // Load user session for entitlement
  try {
    const me = await apiFetch('/api/v1/auth/me');
    if (!me) return; // 401 handled by apiFetch
    userPlan = (me.plan || me.subscription?.tier || 'FREE').toUpperCase();
    document.getElementById('user-email').textContent = me.email || '';
    renderPlanBadge();
  } catch (e) {
    userPlan = 'FREE';
  }

  // Check URL for detail view
  const params = new URLSearchParams(window.location.search);
  const detailId = params.get('id');

  if (detailId) {
    await loadProvider(detailId);
  } else {
    await loadProviders();
  }
}

// ── Entitlement ───────────────────────────────────────────────
function isElite() { return userPlan === 'ELITE'; }

function renderPlanBadge() {
  const el = document.getElementById('plan-name');
  if (el) el.textContent = userPlan;
}

function renderUpgradeCTA() {
  return '<a href="/pricing" class="piq-upgrade-cta">🔒 Upgrade to Elite to unlock</a>';
}

function renderEliteGate(feature) {
  return `
    <div class="piq-gate piq-fade">
      <div class="piq-gate-icon">🔒</div>
      <div class="piq-gate-title">${esc(feature)}</div>
      <div class="piq-gate-desc">
        This feature is available on the Elite plan.
        Upgrade to unlock Provider IQ detail, AI insights, and advanced analytics.
      </div>
      <a href="/pricing" class="piq-gate-btn">View Plans</a>
    </div>`;
}

// ── Load Providers (list) ─────────────────────────────────────
async function loadProviders() {
  currentDetail = null;
  const content = document.getElementById('piq-content');
  content.innerHTML = '<div class="piq-loading">Loading providers…</div>';
  updateBreadcrumb('Leaderboard');
  updateURL('/providers');

  try {
    const res = await apiFetch('/api/v1/providers/iq?sort=iq_desc');
    if (!res) return;
    providers = res.data || [];
    renderList();
  } catch (e) {
    content.innerHTML = `<div class="piq-error">Failed to load providers: ${esc(e.message)}</div>`;
  }
}

// ── Load Provider (detail) ────────────────────────────────────
async function loadProvider(id) {
  // Elite gate — detail is Elite only
  if (!isElite()) {
    currentDetail = id;
    const content = document.getElementById('piq-content');
    content.innerHTML = `
      <button class="piq-back" onclick="loadProviders()">← Back to Leaderboard</button>
      ${renderEliteGate('Provider IQ Detail')}`;
    updateBreadcrumb('Provider Detail');
    updateURL('/providers?id=' + id);
    return;
  }

  currentDetail = id;
  const content = document.getElementById('piq-content');
  content.innerHTML = '<div class="piq-loading">Loading provider…</div>';
  updateBreadcrumb('Provider Detail');
  updateURL('/providers?id=' + id);

  try {
    const res = await apiFetch('/api/v1/providers/iq/' + encodeURIComponent(id));
    if (!res) return;
    renderDetail(res);
  } catch (e) {
    content.innerHTML = `
      <button class="piq-back" onclick="loadProviders()">← Back to Leaderboard</button>
      <div class="piq-error">Provider not found: ${esc(e.message)}</div>`;
  }
}

// ── Render: List View ─────────────────────────────────────────
function renderList() {
  const content = document.getElementById('piq-content');
  content.innerHTML = `
    <div class="piq-tabs">
      <button class="piq-tab ${currentTab === 'leaderboard' ? 'active' : ''}" onclick="switchTab('leaderboard')">Leaderboard</button>
      <button class="piq-tab ${currentTab === 'compare' ? 'active' : ''}" onclick="switchTab('compare')">Compare</button>
    </div>
    <div id="piq-tab-content" class="piq-fade"></div>`;
  renderTabContent();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.piq-tab').forEach(t => t.classList.toggle('active', t.textContent.toLowerCase().trim() === tab));
  renderTabContent();
}

function renderTabContent() {
  const el = document.getElementById('piq-tab-content');
  if (currentTab === 'leaderboard') {
    renderLeaderboard(el);
  } else {
    renderCompareTable(el);
  }
}

function renderLeaderboard(container) {
  if (providers.length === 0) {
    container.innerHTML = '<div class="piq-empty">No ranked providers yet. Providers need ≥20 trades with computed stats.</div>';
    return;
  }
  container.innerHTML = providers.map(p => renderProviderCard(p)).join('');
}

function renderProviderCard(p) {
  const sc = scoreColor(p.iq_score);
  const wr = num(p.win_rate).toFixed(1);
  const er = num(p.expectancy_r).toFixed(2);
  const delta = num(p.delta_7d);
  const deltaHtml = delta !== 0
    ? `<span style="font-size:10px;color:${delta > 0 ? 'var(--green)' : 'var(--red)'};font-family:'DM Mono',monospace">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span>`
    : '';

  const aiSection = isElite()
    ? `<button class="piq-ai-btn" onclick="event.stopPropagation();requestAiInsight('${esc(p.id)}')" ${aiLoading === p.id ? 'disabled' : ''}>
         ${aiLoading === p.id ? 'Analyzing…' : '⚡ AI Insight'}
       </button>
       <span class="piq-ai-text" id="ai-${esc(p.id)}"></span>`
    : renderUpgradeCTA();

  const conf = p.sample_confidence && p.sample_confidence !== 'unreliable'
    ? ` · ${num(p.trade_count)} trades · ${esc(p.sample_confidence)} confidence` : '';

  return `
    <div class="piq-card" onclick="handleCardClick('${esc(p.id)}')">
      <div class="piq-card-head">
        <div class="piq-rank">#${p.rank}</div>
        <div class="piq-info">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="piq-name">${esc(p.name)}</span>
            ${pill(sc, p.iq_score + ' IQ')}
            ${pill('var(--muted)', p.marketplace_tier)}
            ${deltaHtml}
          </div>
          <div class="piq-meta">${esc(p.trading_style || p.market_type || p.channel_type || '')}${conf}</div>
        </div>
        <div class="piq-stats">
          <div><span class="lbl">WR</span> ${wr}%</div>
          <div><span class="lbl">E(R)</span> ${er}</div>
          <div><span class="lbl">Trades</span> ${num(p.trade_count)}</div>
        </div>
      </div>
      <div class="piq-ai-row">${aiSection}</div>
    </div>`;
}

function handleCardClick(id) {
  if (isElite()) {
    loadProvider(id);
  } else {
    window.location.href = '/pricing';
  }
}

// ── Render: Compare Table ─────────────────────────────────────
function renderCompareTable(container) {
  if (providers.length === 0) {
    container.innerHTML = '<div class="piq-empty">No providers to compare.</div>';
    return;
  }
  const rows = providers.map(p => {
    const sc = scoreColor(p.iq_score);
    const cherry = num(p.cherry_pick_score);
    return `<tr onclick="handleCardClick('${esc(p.id)}')">
      <td style="color:var(--muted)">${p.rank}</td>
      <td class="provider-name">${esc(p.name)}</td>
      <td style="color:${sc}">${p.iq_score}</td>
      <td>${num(p.win_rate).toFixed(1)}%</td>
      <td style="color:${num(p.expectancy_r) > 0 ? 'var(--green)' : 'var(--red)'}">${num(p.expectancy_r).toFixed(2)}</td>
      <td style="color:var(--red)">${num(p.max_drawdown_pct).toFixed(1)}%</td>
      <td>${num(p.trade_count)}</td>
      <td style="color:${cherry > 0.35 ? 'var(--red)' : 'var(--green)'}">${(cherry * 100).toFixed(0)}%</td>
      <td>${esc(p.sample_confidence || '—')}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="piq-section">
      <div class="piq-section-label">Side-by-Side Compare</div>
      <div style="overflow-x:auto">
        <table class="piq-table">
          <thead><tr>
            <th>#</th><th>Provider</th><th>IQ</th><th>Win%</th><th>E(R)</th>
            <th>MaxDD%</th><th>Trades</th><th>Cherry</th><th>Confidence</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Render: Detail View ───────────────────────────────────────
function renderDetail(res) {
  const p = res.data;
  const sc = scoreColor(p.iq_score);
  const monthly = res.monthly_iq || [];
  const pairs = res.pairs || [];
  const badges = res.badges || [];

  // Derived scores for radar/breakdown
  const consistency = Math.max(0, 100 - num(p.r_stddev) * 50);
  const antiCherry  = Math.max(0, (1 - num(p.cherry_pick_score)) * 100);
  const rrScore     = Math.min(100, Math.max(0, num(p.expectancy_r) * 40));
  const dqScore     = num(p.data_completeness) * 100;

  const content = document.getElementById('piq-content');
  content.innerHTML = `
    <button class="piq-back" onclick="loadProviders()">← Back to Leaderboard</button>
    <div class="piq-fade">
      <!-- Header -->
      <div class="piq-detail-header">
        ${renderIQRing(p.iq_score, 100)}
        <div class="piq-detail-info">
          <div class="piq-detail-name">
            ${esc(p.name)}
            ${p.is_verified ? '<span style="margin-left:8px;color:var(--green)">✓</span>' : ''}
          </div>
          <div class="piq-detail-desc">${esc(p.description || 'No description available.')}</div>
          <div class="piq-detail-badges">
            ${pill(sc, p.marketplace_tier)}
            ${pill('var(--muted)', (p.sample_confidence || 'unknown') + ' confidence')}
            ${badges.map(b => pill('var(--cyan)', b)).join('')}
          </div>
        </div>
        ${renderRadar(p, 160)}
      </div>

      <!-- Core metrics -->
      <div class="piq-grid-4" style="margin-bottom:16px">
        ${metricCard('WIN RATE', num(p.win_rate).toFixed(1) + '%', sc)}
        ${metricCard('EXPECTANCY (R)', num(p.expectancy_r).toFixed(2), num(p.expectancy_r) > 0 ? 'var(--green)' : 'var(--red)')}
        ${metricCard('PROFIT FACTOR', num(p.profit_factor).toFixed(2), num(p.profit_factor) > 1 ? 'var(--green)' : 'var(--red)')}
        ${metricCard('MAX DRAWDOWN', num(p.max_drawdown_pct).toFixed(1) + '%', 'var(--red)')}
      </div>

      <!-- Secondary metrics -->
      <div class="piq-grid-4" style="margin-bottom:16px">
        ${metricCard('TRADE COUNT', num(p.trade_count), 'var(--cyan)')}
        ${metricCard('DATA QUALITY', (dqScore).toFixed(0) + '%', dqScore >= 60 ? 'var(--green)' : 'var(--amber)')}
        ${metricCard('CHERRY-PICK RISK', (num(p.cherry_pick_score) * 100).toFixed(0) + '%', num(p.cherry_pick_score) > 0.35 ? 'var(--red)' : 'var(--green)',
          num(p.cherry_pick_score) < 0.15 ? 'Clean' : num(p.cherry_pick_score) < 0.35 ? 'Caution' : 'Suspect')}
        ${metricCard('R STD DEV', num(p.r_stddev).toFixed(2), num(p.r_stddev) < 1.5 ? 'var(--green)' : 'var(--amber)')}
      </div>

      <!-- IQ Breakdown -->
      <div class="piq-section">
        <div class="piq-section-label">IQ Score Breakdown</div>
        ${barRow('Win Rate (30%)', num(p.win_rate), 100, 'var(--cyan)')}
        ${barRow('Risk-Reward (25%)', rrScore, 100, 'var(--green)')}
        ${barRow('Data Quality (20%)', dqScore, 100, '#a78bfa')}
        ${barRow('Consistency (15%)', consistency, 100, 'var(--amber)')}
        ${barRow('Anti-Cherry (10%)', antiCherry, 100, '#fb923c')}
      </div>

      <!-- Cherry-pick breakdown -->
      <div class="piq-section">
        <div class="piq-section-label">Cherry-Pick Breakdown</div>
        <div class="piq-grid-4">
          ${metricCard('DELETE RATE', (num(p.cherry_delete_rate) * 100).toFixed(1) + '%', num(p.cherry_delete_rate) > 0.02 ? 'var(--red)' : 'var(--green)')}
          ${metricCard('EDIT RATE', (num(p.cherry_edit_rate) * 100).toFixed(1) + '%', num(p.cherry_edit_rate) > 0.05 ? 'var(--red)' : 'var(--green)')}
          ${metricCard('UNRESOLVED', (num(p.cherry_unresolved_rate) * 100).toFixed(1) + '%', num(p.cherry_unresolved_rate) > 0.10 ? 'var(--amber)' : 'var(--green)')}
          ${metricCard('COMPOSITE', (num(p.cherry_pick_score) * 100).toFixed(0) + '%', num(p.cherry_pick_score) > 0.35 ? 'var(--red)' : 'var(--green)',
            num(p.cherry_pick_score) < 0.15 ? 'Clean' : num(p.cherry_pick_score) < 0.35 ? 'Caution' : 'Suspect')}
        </div>
      </div>

      <!-- Monthly IQ trend -->
      ${monthly.length > 1 ? `
        <div class="piq-section">
          <div class="piq-section-label">IQ Trend</div>
          ${renderSparklineSVG(monthly, sc, 500, 60)}
        </div>` : ''}

      <!-- Pairs -->
      ${pairs.length > 0 ? `
        <div class="piq-section">
          <div class="piq-section-label">Traded Pairs</div>
          <div class="piq-detail-pairs">${pairs.map(p => pill('var(--cyan)', p)).join('')}</div>
        </div>` : ''}

      <!-- AI Insight (Elite only) -->
      <div class="piq-section">
        <div class="piq-section-label" style="color:var(--cyan)">AI Provider Insight</div>
        ${isElite()
          ? `<button class="piq-ai-btn large" onclick="requestAiInsight('${esc(p.id)}')" id="ai-btn-detail">⚡ Generate AI Insight</button>
             <div id="ai-detail-text" style="font-size:12px;color:var(--text);line-height:1.7;white-space:pre-wrap;margin-top:12px"></div>`
          : renderUpgradeCTA()}
      </div>
    </div>`;

  updateBreadcrumb(p.name);
}

// ── AI Drawer ─────────────────────────────────────────────────
let drawerInsightCache = {};

function ensureDrawer() {
  if (document.getElementById('piq-drawer')) return;
  const overlay = document.createElement('div');
  overlay.className = 'piq-drawer-overlay';
  overlay.id = 'piq-drawer-overlay';
  overlay.onclick = closeDrawer;
  document.body.appendChild(overlay);

  const drawer = document.createElement('div');
  drawer.className = 'piq-drawer';
  drawer.id = 'piq-drawer';
  drawer.innerHTML = `
    <div class="piq-drawer-header">
      <div class="piq-drawer-title"><span class="icon">⚡</span> AI Provider Insight</div>
      <button class="piq-drawer-close" onclick="closeDrawer()">✕</button>
    </div>
    <div class="piq-drawer-provider" id="piq-drawer-provider"></div>
    <div class="piq-drawer-body" id="piq-drawer-body"></div>
    <div class="piq-drawer-actions" id="piq-drawer-actions" style="display:none">
      <button class="piq-drawer-retry" id="piq-drawer-retry">⚡ Regenerate Insight</button>
    </div>
    <div class="piq-drawer-powered">Powered by Llama 3.1 via HuggingFace Inference</div>`;
  document.body.appendChild(drawer);
}

function openDrawer() {
  ensureDrawer();
  document.getElementById('piq-drawer-overlay').classList.add('open');
  document.getElementById('piq-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  const overlay = document.getElementById('piq-drawer-overlay');
  const drawer = document.getElementById('piq-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  document.body.style.overflow = '';
}

function getProviderById(id) {
  return providers.find(p => p.id === id) || null;
}

function renderDrawerProvider(p) {
  if (!p) return '';
  const sc = scoreColor(p.iq_score);
  return `
    <div class="piq-drawer-provider-name">${esc(p.name)} ${pill(sc, p.iq_score + ' IQ')}</div>
    <div class="piq-drawer-provider-meta">
      <span><span class="val">${num(p.win_rate).toFixed(1)}%</span> Win Rate</span>
      <span><span class="val">${num(p.expectancy_r).toFixed(2)}</span> E(R)</span>
      <span><span class="val">${num(p.trade_count)}</span> Trades</span>
      <span><span class="val">${num(p.profit_factor).toFixed(2)}</span> PF</span>
    </div>`;
}

function renderDrawerLoading() {
  return `
    <div class="piq-drawer-loading">
      <div class="pulse-ring"></div>
      <div class="pulse-text">Analyzing provider metrics...</div>
    </div>`;
}

function renderDrawerInsight(text) {
  return `
    <div class="piq-drawer-insight">
      <div class="insight-label"><span class="dot"></span> AI Analysis</div>
      ${esc(text)}
    </div>`;
}

async function requestAiInsight(providerId) {
  if (!isElite()) return;

  const p = getProviderById(providerId);
  openDrawer();

  const provEl = document.getElementById('piq-drawer-provider');
  const bodyEl = document.getElementById('piq-drawer-body');
  const actionsEl = document.getElementById('piq-drawer-actions');
  const retryBtn = document.getElementById('piq-drawer-retry');

  if (provEl) provEl.innerHTML = renderDrawerProvider(p);
  actionsEl.style.display = 'none';

  // Check cache
  if (drawerInsightCache[providerId]) {
    bodyEl.innerHTML = renderDrawerInsight(drawerInsightCache[providerId]);
    actionsEl.style.display = 'flex';
    retryBtn.onclick = () => { delete drawerInsightCache[providerId]; requestAiInsight(providerId); };
    return;
  }

  bodyEl.innerHTML = renderDrawerLoading();

  try {
    const res = await apiFetch('/api/v1/ai/provider-iq', {
      method: 'POST',
      body: JSON.stringify({ providerId }),
    });
    const text = res?.text || 'Unable to generate insight.';
    drawerInsightCache[providerId] = text;
    bodyEl.innerHTML = renderDrawerInsight(text);
    actionsEl.style.display = 'flex';
    retryBtn.onclick = () => { delete drawerInsightCache[providerId]; requestAiInsight(providerId); };
  } catch (e) {
    bodyEl.innerHTML = '<div class="piq-drawer-error">Unable to generate insight. Please try again.</div>';
    actionsEl.style.display = 'flex';
    retryBtn.onclick = () => requestAiInsight(providerId);
  }
}

// ── Render helpers ────────────────────────────────────────────
function scoreColor(score) {
  const s = num(score);
  return s >= 75 ? 'var(--green)' : s >= 50 ? 'var(--amber)' : 'var(--red)';
}

function pill(color, text) {
  return `<span class="piq-pill" style="background:${color}12;color:${color};border:1px solid ${color}30">${esc(String(text))}</span>`;
}

function metricCard(label, value, color, sub) {
  return `<div class="piq-metric">
    <div class="piq-metric-label">${esc(label)}</div>
    <div class="piq-metric-value" style="color:${color}">${value}</div>
    ${sub ? `<div class="piq-metric-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function barRow(label, val, max, color) {
  const pct = Math.min((num(val) / max) * 100, 100);
  return `<div class="piq-bar-row">
    <span class="piq-bar-label">${esc(label)}</span>
    <div class="piq-bar-track"><div class="piq-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${color}88,${color})"></div></div>
    <span class="piq-bar-val" style="color:${color}">${Math.round(num(val))}</span>
  </div>`;
}

function renderIQRing(score, size) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - num(score) / 100);
  const color = scoreColor(score);
  return `<svg width="${size}" height="${size}" style="flex-shrink:0">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
      stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
      transform="rotate(-90 ${size/2} ${size/2})" style="transition:stroke-dashoffset 1s ease"/>
    <text x="50%" y="50%" text-anchor="middle" dy=".35em"
      style="font-size:${size*0.28}px;font-weight:800;fill:${color};font-family:'DM Mono',monospace">${num(score)}</text>
  </svg>`;
}

function renderRadar(p, size) {
  const cx = size/2, cy = size/2, r = size/2 - 20;
  const consistency = Math.max(0, 100 - num(p.r_stddev) * 50);
  const antiCherry  = Math.max(0, (1 - num(p.cherry_pick_score)) * 100);
  const rrScore     = Math.min(100, Math.max(0, num(p.expectancy_r) * 40));
  const dims = [
    { label:'Win Rate',    val: num(p.win_rate) },
    { label:'Data Quality',val: num(p.data_completeness) * 100 },
    { label:'Consistency', val: consistency },
    { label:'Risk/Reward', val: rrScore },
    { label:'Anti-Cherry', val: antiCherry },
  ];
  // Grid rings
  let svg = `<svg width="${size}" height="${size}" style="flex-shrink:0">`;
  [0.25, 0.5, 0.75, 1].forEach(s => {
    const pts = dims.map((_, i) => {
      const a = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
      return `${cx + Math.cos(a) * r * s},${cy + Math.sin(a) * r * s}`;
    }).join(' ');
    svg += `<polygon points="${pts}" fill="none" stroke="var(--border)" stroke-width="0.5"/>`;
  });
  // Data polygon
  const dataPts = dims.map((d, i) => {
    const a = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    const v = (d.val / 100) * r;
    return `${cx + Math.cos(a) * v},${cy + Math.sin(a) * v}`;
  }).join(' ');
  svg += `<polygon points="${dataPts}" fill="rgba(0,212,255,.12)" stroke="var(--cyan)" stroke-width="1.5"/>`;
  // Labels
  dims.forEach((d, i) => {
    const a = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    const lx = cx + Math.cos(a) * (r + 14);
    const ly = cy + Math.sin(a) * (r + 14);
    svg += `<text x="${lx}" y="${ly}" text-anchor="middle" dy=".35em" style="font-size:8px;fill:var(--muted)">${d.label}</text>`;
  });
  svg += '</svg>';
  return svg;
}

function renderSparklineSVG(data, color, width, height) {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data) || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / (max - min)) * height}`
  ).join(' ');
  return `<svg width="${width}" height="${height}" style="display:block">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

// ── Utilities ─────────────────────────────────────────────────
function num(v) { return typeof v === 'number' ? v : Number(v) || 0; }
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
function updateBreadcrumb(text) {
  const el = document.getElementById('piq-breadcrumb');
  if (el) el.textContent = text;
}
function updateURL(path) {
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState({}, '', path);
  }
}

// ── Browser back/forward ──────────────────────────────────────
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) { loadProvider(id); } else { loadProviders(); }
});

// ── Escape closes drawer ─────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});
