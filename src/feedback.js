/* ============================================================================
   Feedback / crash-report widget.

   Injects a "Feedback" button into the header and a modal. The report bundles:
   app version + build time, browser/viewport/URL, the captured error log
   (from errors.js), and an app-state snapshot (getDiagnostics). It NEVER
   includes CSV row content — only the filename, counts, and filter/view state,
   and the payload is shown to the user before sending.

   Submits to VITE_FEEDBACK_ENDPOINT (a Formspree form) via fetch; if that's not
   configured or the POST fails, falls back to downloading the report as a file.
   Also opens when an `open-feedback` event fires (from the error banner).
   ========================================================================== */
import { getErrorLog } from "./errors.js";

// Injected by Vite's `define` (see vite.config.js).
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const BUILD_TIME = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "dev";
const ENDPOINT = import.meta.env.VITE_FEEDBACK_ENDPOINT || "";

let getDiagnostics = () => ({});
let modal = null;

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
    "bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-sm px-4 py-2 rounded-md transition-colors flex items-center gap-2";
  btn.setAttribute("data-html2canvas-ignore", "true");
  btn.innerHTML =
    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-3.5-7.1L21 3v6h-6"/></svg>Feedback';
  btn.addEventListener("click", open);
  // Place it just before the Reference button if present, else at the end of <body>.
  const ref = document.getElementById("refBtn");
  if (ref && ref.parentElement) ref.parentElement.insertBefore(btn, ref);
  else document.body.appendChild(btn);
}

function buildModal() {
  modal = document.createElement("div");
  modal.id = "feedbackModal";
  modal.className = "hidden fixed inset-0 z-50 bg-black/60 p-4 sm:p-8";
  modal.setAttribute("data-html2canvas-ignore", "true");
  modal.innerHTML = `
    <div class="mx-auto max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col" style="max-height:90vh;">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-800">
        <h3 class="text-base font-bold text-white">Send Feedback / Report a Problem</h3>
        <button data-act="close" class="text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/60 rounded-md px-2 py-1 text-sm transition-colors">✕ Close</button>
      </div>
      <div class="p-5 overflow-y-auto space-y-4 text-sm">
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1" for="fbMessage">What happened? (optional)</label>
          <textarea id="fbMessage" rows="4" placeholder="Describe the bug or suggestion…" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"></textarea>
        </div>
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1" for="fbEmail">Your email (optional, so we can reply)</label>
          <input id="fbEmail" type="email" placeholder="you@example.com" class="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500">
        </div>
        <details class="border border-slate-800 rounded-md">
          <summary class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 cursor-pointer">Diagnostic info included (no CSV data) ▾</summary>
          <pre id="fbPayload" class="px-3 py-2 text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto"></pre>
        </details>
        <p class="text-xs text-slate-500">Your event-log <strong>contents are never sent</strong> — only the filename, counts, current filters, and any error messages shown above.</p>
        <div id="fbStatus" class="text-sm"></div>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800">
        <button data-act="download" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm px-4 py-2 rounded-md transition-colors">Download report</button>
        <button data-act="send" class="bg-sky-500 hover:bg-sky-400 text-slate-900 font-semibold text-sm px-4 py-2 rounded-md transition-colors">Send</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('[data-act="close"]').addEventListener("click", close);
  modal.querySelector('[data-act="download"]').addEventListener("click", downloadReport);
  modal.querySelector('[data-act="send"]').addEventListener("click", send);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });
}

function buildPayload() {
  return {
    message: modal.querySelector("#fbMessage").value.trim(),
    email: modal.querySelector("#fbEmail").value.trim(),
    version: APP_VERSION,
    buildTime: BUILD_TIME,
    capturedAt: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    diagnostics: safe(getDiagnostics),
    errors: getErrorLog(),
  };
}

function safe(fn) {
  try { return fn(); } catch (e) { return { diagnosticsError: String(e) }; }
}

function refreshPreview() {
  const { message, email, ...rest } = buildPayload();
  // preview shows everything except the free-text fields the user is editing
  modal.querySelector("#fbPayload").textContent = JSON.stringify(rest, null, 2);
}

function open() {
  refreshPreview();
  setStatus("");
  modal.classList.remove("hidden");
  modal.querySelector("#fbMessage").focus();
}
function close() { modal.classList.add("hidden"); }

function setStatus(html, color) {
  const el = modal.querySelector("#fbStatus");
  el.innerHTML = html;
  el.style.color = color || "";
}

async function send() {
  const payload = buildPayload();
  if (!ENDPOINT) {
    setStatus("No feedback endpoint is configured for this build — use “Download report” and email it instead.", "#fca5a5");
    return;
  }
  const sendBtn = modal.querySelector('[data-act="send"]');
  sendBtn.disabled = true;
  setStatus("Sending…", "#94a3b8");
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        message: payload.message || "(no message)",
        email: payload.email || "(none)",
        _report: JSON.stringify(payload),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Thanks — your report was sent. ✓", "#86efac");
    setTimeout(close, 1200);
  } catch (err) {
    setStatus(
      `Couldn't send (${String(err.message || err)}). Please use “Download report” and email it to us.`,
      "#fca5a5"
    );
  } finally {
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
