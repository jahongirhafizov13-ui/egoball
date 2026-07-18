// ============================================================================
// boot.js - Boot sequence
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= BOOT ============================= */
(async function boot(){
  await loadSettings();
  applyI18n();
  resizeCanvas();
  show('screen-login');
})();
