/* ═══════════════════════════════════════════════════════════════
   AgoraIQ — Auth Guard (auth.js)
   Checks localStorage token via GET /api/v1/auth/me (Bearer)
   Redirects to /login on missing/invalid token.
═══════════════════════════════════════════════════════════════ */

(async function authGuard() {
  const screen = document.getElementById('loading-screen');

  const token = localStorage.getItem('iq_token');

  if (!token) {
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }

  try {
    const res = await fetch('/api/v1/auth/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('iq_token');
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }

    if (!res.ok) {
      // Non-auth error — let page degrade gracefully
      if (screen) screen.classList.add('hidden');
      if (typeof pageInit === 'function') await pageInit(null).catch(console.error);
      return;
    }

    const user = await res.json();
    window.__user = user;

    // Set header badge
    const badge = document.getElementById('username-badge');
    if (badge) {
      badge.textContent = user.name || user.email?.split('@')[0] || 'User';
    }

    // Run page-specific init
    if (typeof pageInit === 'function') {
      await pageInit(user).catch(e => console.error('[pageInit]', e));
    }

  } catch (err) {
    console.warn('[auth] Network error:', err.message);
    // Network down — still try to render page
    if (typeof pageInit === 'function') await pageInit(null).catch(console.error);
  } finally {
    if (screen) screen.classList.add('hidden');
  }
})();
