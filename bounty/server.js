'use strict';

// Bounty verification server + Wizard-of-Oz operator panel.
// Zero external dependencies — Node built-ins only. Run: `node server.js`.
//
// In the "Wizard of Oz" prototype there is no real automated verification yet.
// A human operator watches the panel at http://localhost:PORT/panel and
// approves or rejects each submission by hand. The CLI talks to this server
// over HTTP; the operator and CLI share state through lib/store.js.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');

const PORT = process.env.BOUNTY_PORT ? Number(process.env.BOUNTY_PORT) : 4777;

const challenges = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'challenges.json'), 'utf8')
).challenges;

const challengeById = Object.fromEntries(challenges.map((c) => [c.id, c]));

// ---------- helpers ----------
function sendJSON(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy(); // basic guard
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function pendingList(state) {
  return Object.values(state.submissions)
    .filter((s) => s.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- operator panel ----------
function panelHTML() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bounty — Operator Panel</title>
<style>
  :root { color-scheme: light dark; --bg:#0b0d10; --card:#14181d; --fg:#e7edf3; --muted:#8a97a6; --accent:#4f8cff; --ok:#2ea043; --no:#d1434b; --line:#222a33; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:20px 24px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:17px; margin:0; font-weight:650; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--ok); box-shadow:0 0 8px var(--ok); }
  main { max-width:820px; margin:0 auto; padding:24px 16px 80px; }
  .empty { color:var(--muted); text-align:center; padding:48px 0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 14px; }
  .row { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
  .sponsor { font-weight:650; }
  .reward { color:var(--accent); font-variant-numeric:tabular-nums; font-weight:650; white-space:nowrap; }
  .meta { color:var(--muted); font-size:13px; margin-top:2px; }
  .proof { margin:12px 0; padding:10px 12px; background:#0d1116; border:1px solid var(--line); border-radius:8px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; word-break:break-all; }
  .proof .lbl { color:var(--muted); font-family:inherit; display:block; margin-bottom:4px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .actions { display:flex; gap:10px; margin-top:4px; }
  button { font:inherit; font-weight:600; border:none; border-radius:8px; padding:9px 16px; cursor:pointer; color:#fff; }
  .approve { background:var(--ok); }
  .reject { background:transparent; color:var(--no); border:1px solid var(--no); }
  button:active { transform:translateY(1px); }
  .bar { color:var(--muted); font-size:13px; margin-bottom:18px; display:flex; gap:18px; }
  .bar b { color:var(--fg); }
</style>
</head>
<body>
<header><span class="dot"></span><h1>Bounty — Operator Panel</h1></header>
<main>
  <div class="bar">
    <span>Wallet balance <b id="bal">—</b></span>
    <span>Pending <b id="count">—</b></span>
    <span>Approved <b id="done">—</b></span>
  </div>
  <div id="list"><div class="empty">Loading…</div></div>
</main>
<script>
async function refresh() {
  const [p, b] = await Promise.all([
    fetch('/pending').then(r => r.json()),
    fetch('/balance').then(r => r.json()),
  ]);
  document.getElementById('bal').textContent = b.balance + ' cr';
  document.getElementById('count').textContent = p.pending.length;
  document.getElementById('done').textContent = b.completed.length;
  const list = document.getElementById('list');
  if (!p.pending.length) { list.innerHTML = '<div class="empty">No pending submissions. Waiting…</div>'; return; }
  list.innerHTML = p.pending.map(function(s){
    return '<div class="card">'
      + '<div class="row"><div><span class="sponsor">'+esc(s.sponsor)+'</span>'
      + '<div class="meta">'+esc(s.title)+' · '+esc(s.verify)+' check · '+ago(s.createdAt)+'</div></div>'
      + '<div class="reward">+'+s.reward+' cr</div></div>'
      + '<div class="proof"><span class="lbl">'+esc(s.proofLabel||'proof')+'</span>'+esc(s.proof||'(none)')+'</div>'
      + '<div class="actions">'
      + '<button class="approve" onclick="act(\\''+s.id+'\\',\\'approve\\')">Approve</button>'
      + '<button class="reject" onclick="act(\\''+s.id+'\\',\\'reject\\')">Reject</button>'
      + '</div></div>';
  }).join('');
}
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
function ago(ts){ var s=Math.round((Date.now()-ts)/1000); if(s<60)return s+'s ago'; var m=Math.round(s/60); return m+'m ago'; }
async function act(id, kind){
  await fetch('/'+kind+'/'+id, { method:'POST', headers:{'Content-Type':'application/json'}, body: kind==='reject' ? JSON.stringify({reason:'not verified'}) : '{}' });
  refresh();
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (method === 'GET' && (p === '/' || p === '/panel')) {
      const html = panelHTML();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (method === 'GET' && p === '/challenges') {
      return sendJSON(res, 200, { challenges });
    }

    if (method === 'GET' && p === '/balance') {
      const state = store.load();
      return sendJSON(res, 200, { balance: state.balance, completed: state.completed });
    }

    if (method === 'GET' && p === '/history') {
      const state = store.load();
      const history = Object.values(state.submissions).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      return sendJSON(res, 200, { history });
    }

    if (method === 'GET' && p === '/pending') {
      const state = store.load();
      return sendJSON(res, 200, { pending: pendingList(state) });
    }

    if (method === 'GET' && p.startsWith('/submission/')) {
      const id = p.split('/')[2];
      const state = store.load();
      const s = state.submissions[id];
      if (!s) return sendJSON(res, 404, { error: 'not found' });
      return sendJSON(res, 200, s);
    }

    if (method === 'POST' && p === '/submit') {
      const body = await readBody(req);
      const ch = challengeById[body.challengeId];
      if (!ch) return sendJSON(res, 400, { error: 'unknown challenge' });
      const state = store.load();
      if (state.completed.includes(ch.id)) {
        return sendJSON(res, 409, { error: 'challenge already completed' });
      }
      const id = crypto.randomUUID();
      state.submissions[id] = {
        id,
        challengeId: ch.id,
        sponsor: ch.sponsor,
        title: ch.title,
        verify: ch.verify,
        reward: ch.reward,
        proofLabel: ch.proofLabel,
        proof: body.proof || '',
        status: 'pending',
        createdAt: Date.now(),
        resolvedAt: null,
      };
      store.save(state);
      return sendJSON(res, 201, { id, status: 'pending' });
    }

    if (method === 'POST' && p.startsWith('/approve/')) {
      const id = p.split('/')[2];
      const state = store.load();
      const s = state.submissions[id];
      if (!s) return sendJSON(res, 404, { error: 'not found' });
      if (s.status === 'pending') {
        s.status = 'approved';
        s.resolvedAt = Date.now();
        if (!state.completed.includes(s.challengeId)) {
          state.completed.push(s.challengeId);
          state.balance += s.reward;
        }
        store.save(state);
      }
      return sendJSON(res, 200, { id, status: s.status, balance: state.balance });
    }

    if (method === 'POST' && p.startsWith('/reject/')) {
      const id = p.split('/')[2];
      const body = await readBody(req);
      const state = store.load();
      const s = state.submissions[id];
      if (!s) return sendJSON(res, 404, { error: 'not found' });
      if (s.status === 'pending') {
        s.status = 'rejected';
        s.reason = body.reason || 'rejected';
        s.resolvedAt = Date.now();
        store.save(state);
      }
      return sendJSON(res, 200, { id, status: s.status });
    }

    sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Bounty server on http://localhost:${PORT}`);
    console.log(`Operator panel:   http://localhost:${PORT}/panel`);
  });
}

module.exports = { server, PORT };
