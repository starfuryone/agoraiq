/* ═══════════════════════════════════════════════════════════════
   AgoraIQ — Auth Guard (auth.js)
   Include on protected pages. Shows loading overlay until auth
   is resolved; redirects to /login on 401.
═══════════════════════════════════════════════════════════════ */

(async function authGuard() {
  // Show the loading screen immediately (it's in the HTML)
  const screen = document.getElementById('loading-screen');

  try {
    const API = window.AGORAIQ_API_URL || 'https://api.agoraiq.net';
    const res = await fetch(`${API}/api/v1/users/me`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status === 401 || res.status === 403) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }

    if (!res.ok) {
      // Non-auth error — let the page handle it gracefully
      if (screen) screen.classList.add('hidden');
      return;
    }

    const user = await res.json();
    // Expose on window for page scripts to use
    window.__user = user;

    // Set header username badge if present
    const badge = document.getElementById('username-badge');
    if (badge) badge.textContent = user.name || user.email?.split('@')[0] || 'User';

  } catch (err) {
    console.warn('[auth] Could not reach API:', err.message);
    // Network error — don't redirect, let page degrade gracefully
  } finally {
    // Page-specific init runs AFTER auth is resolved
    if (typeof pageInit === 'function') {
      try { await pageInit(window.__user); } catch (e) { console.error('[pageInit]', e); }
    }
    // Always hide loading screen
    if (screen) screen.classList.add('hidden');
  }
})();
