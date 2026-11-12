/* ============================================================================
   Feedback / crash-report widget.

   Injects a "Feedback" button into the header and a modal. The report bundles:
   app version + build time, browser/viewport/URL, the captured error log
   (from errors.js), and an app-state snapshot (getDiagnostics). Event arrays
   are excluded, but filenames, selected filters and captured error text may
   contain log values. The payload is previewed and only sent on user action.

   Submits to Web3Forms (VITE_WEB3FORMS_KEY) via fetch, or else to the generic
   VITE_FEEDBACK_ENDPOINT; if neither is configured or the POST fails, falls back
   to downloading the report as a file.
   Also opens when an `open-feedback` event fires (from the error banner).
   ========================================================================== */
import { getErrorLog } from "./errors.js";

// Injected by Vite's `define` (see vite.config.js).
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const BUILD_TIME = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "dev";
const ENDPOINT = import.meta.env.VITE_FEEDBACK_ENDPOINT || "";
// Web3Forms access key (a public submission token tied to your email, embedded in the client
// bundle by design — same model as Formspree). Set VITE_WEB3FORMS_KEY to enable email delivery.
const WEB3FORMS_KEY = import.meta.env.VITE_WEB3FORMS_KEY || "";
const WEB3FORMS_URL = "https://api.web3forms.com/submit";

let getDiagnostics = () => ({});
let modal = null;
let opener = null;
let previewPayload = null;

export function initFeedback(opts = {}) {
  if (typeof opts.getDiagnostics === "function") getDiagnostics = opts.getDiagnostics;
  injectButton();
  buildModal();
  window.addEventListener("open-feedback", open);
}

function injectButton() {
  const btn = document.createElement("button");
  btn.id = "feedbackBtn";
  btn.type = "button";
  btn.className =
    "bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-sm px-4 py-2 transition-colors flex items-center gap-2";
  btn.setAttribute("data-print-hide", "true");
  btn.innerHTML =
    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-3.5-7.1L21 3v6h-6"/></svg>Feedback';
  btn.addEventListener("click", open);
  // Place it just before the Reference button if present, else at the end of <body>.
  const ref = document.getElementById("refBtn");
  if (ref && ref.parentElement) ref.parentElement.insertBefore(btn, ref);
  else document.body.appendChild(btn);
}

function buildModal() {
  modal = document.createElement("dialog");
  modal.id = "feedbackModal";
  modal.className = "w-full max-w-2xl m-auto p-4 text-slate-200 bg-transparent border-0";
  modal.setAttribute("aria-labelledby", "feedbackTitle");
  modal.setAttribute("data-print-hide", "true");
  modal.innerHTML = `
    <div class="mx-auto max-w-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col" style="max-height:90vh;">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-800">
        <h3 id="feedbackTitle" class="text-base font-bold text-white">Send Feedback / Report a Problem</h3>
        <button data-act="close" class="text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/60 px-2 py-1 text-sm transition-colors">✕ Close</button>
      </div>
      <div class="p-5 overflow-y-auto space-y-4 text-sm">
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1" for="fbMessage">What happened? (optional)</label>
          <textarea id="fbMessage" rows="4" placeholder="Describe the bug or suggestion…" class="w-full bg-slate-800 border border-slate-700 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"></textarea>
        </div>
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1" for="fbEmail">Your email (optional, so we can reply)</label>
          <input id="fbEmail" type="email" placeholder="you@example.com" class="w-full bg-slate-800 border border-slate-700 px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500">
        </div>
        <details class="border border-slate-800">
          <summary class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 cursor-pointer">Preview diagnostic report ▾</summary>
          <pre id="fbPayload" class="px-3 py-2 text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto"></pre>
        </details>
        <p class="text-xs text-slate-500">Reports exclude event arrays. Filenames, selected filters, and captured error messages may contain values from your log. Review the diagnostic preview before sending or downloading. Nothing is sent automatically.</p>
        <div id="fbStatus" class="text-sm" role="status"></div>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800">
        <button data-act="download" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm px-4 py-2 transition-colors">Download report</button>
        <button data-act="send" class="bg-sky-500 hover:bg-sky-400 text-slate-900 font-semibold text-sm px-4 py-2 transition-colors">Send</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('[data-act="close"]').addEventListener("click", close);
  modal.querySelector('[data-act="download"]').addEventListener("click", downloadReport);
  modal.querySelector('[data-act="send"]').addEventListener("click", send);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.addEventListener("close", () => opener?.focus());
}

// All outgoing fields are assembled here. Diagnostics excludes event arrays;
// selected filter values and captured errors are intentionally included for review.
export function assembleReport({ message = "", email = "", diagnostics = {}, errors = [] }) {
  return {
    message,
    email,
    version: APP_VERSION,
    buildTime: BUILD_TIME,
    capturedAt: new Date().toISOString(),
    url: location.href.split(/[?#]/, 1)[0],
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    diagnostics,
    errors,
  };
}

function buildPayload() {
  return assembleReport({
    message: modal.querySelector("#fbMessage").value.trim(),
    email: modal.querySelector("#fbEmail").value.trim(),
    diagnostics: previewPayload?.diagnostics ?? safe(getDiagnostics),
    errors: previewPayload?.errors ?? getErrorLog(),
  });
}

function safe(fn) {
  try { return fn(); } catch (e) { return { diagnosticsError: String(e) }; }
}

function refreshPreview() {
  previewPayload = null;
  const { message, email, ...rest } = buildPayload();
  previewPayload = rest;
  // preview shows everything except the free-text fields the user is editing
  modal.querySelector("#fbPayload").textContent = JSON.stringify(rest, null, 2);
}

function open() {
  refreshPreview();
  setStatus("");
  if (!modal.open) {
    opener = document.activeElement;
    modal.showModal();
  }
  modal.querySelector("#fbMessage").focus();
}
function close() { modal.close(); }

function setStatus(message, color) {
  const el = modal.querySelector("#fbStatus");
  el.textContent = message;
  el.style.color = color || "";
}

async function send() {
  const payload = buildPayload();
  if (!WEB3FORMS_KEY && !ENDPOINT) {
    setStatus("No feedback endpoint is configured for this build — use “Download report” and email it instead.", "#fca5a5");
    return;
  }
  const sendBtn = modal.querySelector('[data-act="send"]');
  sendBtn.disabled = true;
  setStatus("Sending…", "#94a3b8");
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15_000);
  try {
    let ok;
    if (WEB3FORMS_KEY) {
      // Web3Forms: POST the access key + fields; success is res.ok AND { success: true }.
      const res = await fetch(WEB3FORMS_URL, {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: "Baseline Visualizer — feedback / report",
          from_name: "Baseline Visualizer",
          replyto: payload.email || undefined,
          message: payload.message || "(no message)",
          email: payload.email || "(none)",
          _report: JSON.stringify(payload),
        }),
      });
      ok = res.ok && (await res.json().catch(() => ({}))).success === true;
      if (!ok) throw new Error(`HTTP ${res.status}`);
    } else {
      // Generic endpoint (e.g. Formspree): success is just res.ok.
      const res = await fetch(ENDPOINT, {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          message: payload.message || "(no message)",
          email: payload.email || "(none)",
          _report: JSON.stringify(payload),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    setStatus("Thanks — your report was sent. ✓", "#86efac");
    setTimeout(close, 1200);
  } catch (err) {
    setStatus(
      `Couldn't send (${String(err.message || err)}). Please use “Download report” and email it to us.`,
      "#fca5a5"
    );
  } finally {
    clearTimeout(deadline);
    sendBtn.disabled = false;
  }
}

function downloadReport() {
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `visualizer-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Report downloaded. Email it to us and we'll take a look.", "#86efac");
}
