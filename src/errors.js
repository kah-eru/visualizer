/* ============================================================================
   Global error capture.

   Installs window error / unhandledrejection handlers (at import time, so it
   must be imported before the app), keeps a bounded ring buffer of the most
   recent errors + console.error/warn, and shows a dismissible banner on a
   fatal so the user never sees a blank/broken page. The banner's "Send report"
   button dispatches an `open-feedback` event that src/feedback.js listens for
   (kept decoupled to avoid an import cycle).
   ========================================================================== */

const MAX_ENTRIES = 50;
const ringBuffer = [];

function record(type, message, stack, source) {
  ringBuffer.push({
    time: new Date().toISOString(),
    type,
    message: String(message == null ? "" : message).slice(0, 1000),
    stack: stack ? String(stack).slice(0, 4000) : "",
    source: source || "",
  });
  if (ringBuffer.length > MAX_ENTRIES) ringBuffer.shift();
}

/** Snapshot copy of the captured error log (most recent last). */
export function getErrorLog() {
  return ringBuffer.slice();
}

/** Manually record an error (used by the app's try/catch entry points). */
export function pushError(type, message, stack, source) {
  record(type, message, stack, source);
}

// ---- Global listeners (installed immediately on import) --------------------
window.addEventListener("error", (e) => {
  const err = e.error;
  record(
    "error",
    e.message || (err && err.message),
    err && err.stack,
    e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : ""
  );
});

window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  record("unhandledrejection", (r && r.message) || r, r && r.stack, "");
});

// Tee console.error / console.warn into the buffer without swallowing them.
for (const level of ["error", "warn"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try {
      record(`console.${level}`, args.map(stringifyArg).join(" "), "", "");
    } catch {
      /* never let logging capture throw */
    }
    original(...args);
  };
}

function stringifyArg(a) {
  if (a instanceof Error) return a.message;
  if (typeof a === "object") {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

// ---- Fatal banner ----------------------------------------------------------
let bannerEl = null;

/**
 * Show a dismissible banner for a fatal error. Records it too. Safe to call
 * repeatedly; only one banner is shown at a time.
 */
export function showErrorBanner(message, err) {
  record("fatal", message, err && err.stack, "");
  if (bannerEl) return;
  bannerEl = document.createElement("div");
  bannerEl.setAttribute("role", "alert");
  bannerEl.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fee2e2;" +
    "font-size:13px;padding:8px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.5);";
  bannerEl.innerHTML =
    '<span style="flex:1">Something went wrong while rendering. Your data is safe — nothing was uploaded.</span>' +
    '<button data-act="send" style="background:#fca5a5;color:#7f1d1d;font-weight:600;border:none;border-radius:4px;padding:4px 10px;cursor:pointer">Send report</button>' +
    '<button data-act="close" style="background:transparent;color:#fee2e2;border:1px solid #fca5a5;border-radius:4px;padding:4px 10px;cursor:pointer">Dismiss</button>';
  bannerEl.querySelector('[data-act="send"]').addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("open-feedback"));
  });
  bannerEl.querySelector('[data-act="close"]').addEventListener("click", dismissBanner);
  document.body.appendChild(bannerEl);
}

function dismissBanner() {
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
}

/**
 * Run `fn` and, if it throws, record + show the banner instead of letting the
 * UI break. Returns fn's result, or undefined on error.
 */
export function guard(fn, context) {
  try {
    return fn();
  } catch (err) {
    showErrorBanner(context || "Unexpected error", err);
    return undefined;
  }
}
