#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# AgoraIQ Logo Patch v2
# Replaces ALL old layer-stack SVGs (nav, sidebar, footer,
# marketplace, login/signup/proof) with hexagonal gradient mark.
# Flips text colors: Agora → white (#e2e8f0), IQ → cyan (#00e5ff)
#
# Usage:   bash patch-logo.sh /opt/agoraiq/packages/web/public
# Revert:  for f in /opt/agoraiq/packages/web/public/*.bak; do mv "$f" "${f%.bak}"; done
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

DIR="${1:-/opt/agoraiq/packages/web/public}"

if [ ! -d "$DIR" ]; then
  echo "ERROR: Directory $DIR does not exist"; exit 1
fi

echo "🔧 AgoraIQ Logo Patch v2 — Target: $DIR"
echo ""

# ── New hexagon SVG body (size-agnostic) ────────────────────────
HEX='viewBox="0 0 40 40" fill="none"><defs><linearGradient id="hg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#00e5ff"/><stop offset="1" stop-color="#0066ff"/></linearGradient></defs><polygon points="20,2 38,11 38,29 20,38 2,29 2,11" fill="url(#hg)"/></svg>'

HEX18="<svg width=\"18\" height=\"18\" ${HEX}"
HEX20="<svg width=\"20\" height=\"20\" ${HEX}"
HEX22="<svg width=\"22\" height=\"22\" ${HEX}"

OLD_PATH='<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'

COUNT=0

for f in "$DIR"/*.html; do
  [ -f "$f" ] || continue
  BN="$(basename "$f")"
  TOUCHED=0

  # ── 1. Replace inline SVGs by size ──────────────────────────

  # 18x18 (footer logos)
  if grep -q 'width="18" height="18" viewBox="0 0 24 24"' "$f" 2>/dev/null; then
    sed -i.bak "s|<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\">${OLD_PATH}</svg>|${HEX18}|g" "$f"
    TOUCHED=1
  fi

  # 22x22 (nav + login/signup/proof header logos)
  if grep -q 'width="22" height="22" viewBox="0 0 24 24"' "$f" 2>/dev/null; then
    sed -i.bak "s|<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\">${OLD_PATH}</svg>|${HEX22}|g" "$f"
    TOUCHED=1
  fi

  # 20x20 single-path (marketplace)
  if grep -q 'width="20" height="20" viewBox="0 0 24 24"' "$f" 2>/dev/null; then
    sed -i.bak "s|<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\">${OLD_PATH}</svg>|${HEX20}|g" "$f"
    TOUCHED=1
  fi

  # 20x20 multi-line (dashboard sidebar)
  if [ "$BN" = "dashboard.html" ]; then
    perl -i.bak -0pe "s|<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\">\s*<path d=\"M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5\" stroke=\"#a78bfa\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\s*</svg>|${HEX20}|gs" "$f"
    TOUCHED=1
  fi

  # 24x24 three-path (markets sidebar)
  if [ "$BN" = "markets.html" ]; then
    perl -i.bak -0pe 's|<svg width="24" height="24" viewBox="0 0 24 24" fill="none">\s*<path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#a78bfa" stroke-width="1\.5" stroke-linejoin="round"/>\s*<path d="M2 17l10 5 10-5" stroke="#a78bfa" stroke-width="1\.5" stroke-linejoin="round"/>\s*<path d="M2 12l10 5 10-5" stroke="#a78bfa" stroke-width="1\.5" stroke-linejoin="round" opacity="\.5"/>\s*</svg>|<svg width="24" height="24" viewBox="0 0 40 40" fill="none"><defs><linearGradient id="hg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#00e5ff"/><stop offset="1" stop-color="#0066ff"/></linearGradient></defs><polygon points="20,2 38,11 38,29 20,38 2,29 2,11" fill="url(#hg)"/></svg>|gs' "$f"
    TOUCHED=1
  fi

  # Onboarding: inject hex before text-only logo
  if [ "$BN" = "onboarding.html" ]; then
    sed -i.bak "s|<div class=\"logo\"><span class=\"a\">Agora</span><span class=\"b\">IQ</span></div>|<div class=\"logo\">${HEX22} <span class=\"a\">Agora</span><span class=\"b\">IQ</span></div>|g" "$f"
    sed -i 's|\.logo{font-size:18px;font-weight:700;margin-bottom:48px}|.logo{font-size:18px;font-weight:700;margin-bottom:48px;display:flex;align-items:center;gap:8px}|' "$f"
    TOUCHED=1
  fi

  # ── 2. CSS color flips ──────────────────────────────────────

  # nav-logo
  sed -i 's|\.nav-logo \.agora{color:#a78bfa}|.nav-logo .agora{color:#e2e8f0}|g' "$f"
  sed -i 's|\.nav-logo \.iq{color:#e2e8f0}|.nav-logo .iq{color:#00e5ff}|g' "$f"

  # footer-logo
  sed -i 's|\.footer-logo \.agora{color:#a78bfa}|.footer-logo .agora{color:#e2e8f0}|g' "$f"
  sed -i 's|\.footer-logo \.iq{color:#e2e8f0}|.footer-logo .iq{color:#00e5ff}|g' "$f"

  # sidebar-logo (dashboard)
  sed -i 's|\.sidebar-logo \.mark \.a { color: var(--accent); }|.sidebar-logo .mark .a { color: var(--text); }|g' "$f"
  sed -i 's|\.sidebar-logo \.mark \.b { color: var(--text); }|.sidebar-logo .mark .b { color: #00e5ff; }|g' "$f"
  # sidebar-logo (markets — tight spacing variant)
  sed -i 's|\.sidebar-logo \.mark \.a { color:var(--accent); }|.sidebar-logo .mark .a { color:var(--text); }|g' "$f"
  sed -i 's|\.sidebar-logo \.mark \.b { color:var(--text); }|.sidebar-logo .mark .b { color:#00e5ff; }|g' "$f"

  # marketplace
  sed -i 's|\.mp-logo \.a{color:var(--accent)}|.mp-logo .a{color:var(--text)}|g' "$f"
  sed -i 's|\.mp-logo \.b{color:var(--text)}|.mp-logo .b{color:#00e5ff}|g' "$f"

  # login / signup / proof (.logo .agora / .iq)
  sed -i 's|\.logo \.agora { color:#a78bfa; }|.logo .agora { color:#e2e8f0; }|g' "$f"
  sed -i 's|\.logo \.iq { color:var(--text); }|.logo .iq { color:#00e5ff; }|g' "$f"
  sed -i 's|\.logo \.iq { color:#e2e8f0; }|.logo .iq { color:#00e5ff; }|g' "$f"

  # onboarding (.logo .a / .b)
  sed -i 's|\.logo \.a{color:var(--accent)}\.logo \.b{color:var(--text)}|.logo .a{color:var(--text)}.logo .b{color:#00e5ff}|g' "$f"

  if [ "$TOUCHED" = "1" ]; then
    COUNT=$((COUNT + 1))
    echo "  ✅ $BN"
  fi
done

# ── 3. Update favicon.svg ────────────────────────────────────────
FAV="$DIR/favicon.svg"
[ -f "$FAV" ] && cp "$FAV" "${FAV}.bak"
cat > "$FAV" << 'FAVEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <defs>
    <linearGradient id="hg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop stop-color="#00e5ff"/>
      <stop offset="1" stop-color="#0066ff"/>
    </linearGradient>
  </defs>
  <polygon points="20,2 38,11 38,29 20,38 2,29 2,11" fill="url(#hg)"/>
</svg>
FAVEOF
echo "  ✅ favicon.svg"
COUNT=$((COUNT + 1))

# ── Cleanup stale double-backups ─────────────────────────────────
find "$DIR" -name "*.bak.bak" -delete 2>/dev/null || true

echo ""
echo "🎯 Patched $COUNT files."
echo ""

# ── Verification ─────────────────────────────────────────────────
OLDSVG=$(grep -rl 'stroke="#a78bfa"' "$DIR"/*.html 2>/dev/null | wc -l)
HEXOK=$(grep -rl 'polygon points="20,2' "$DIR"/*.html 2>/dev/null | wc -l)

echo "   Verification:"
echo "   ✓ Hexagon mark found in $HEXOK HTML files"

if [ "$OLDSVG" -gt 0 ]; then
  echo "   ⚠ Old purple stroke still in $OLDSVG files (likely CSS --violet var, not logo):"
  grep -rn 'stroke="#a78bfa"' "$DIR"/*.html 2>/dev/null | sed 's|^|     |'
else
  echo "   ✓ Zero old purple SVG strokes remaining"
fi

echo ""
echo "Revert: for f in ${DIR}/*.bak; do mv \"\$f\" \"\${f%.bak}\"; done"
