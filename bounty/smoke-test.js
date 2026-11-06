'use strict';

// End-to-end smoke test. Starts the server on a throwaway port, drives the CLI
// as a real subprocess, plays the Wizard-of-Oz operator by hitting /approve,
// and asserts the credit lands. Run: `node smoke-test.js`.

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4788;
const BASE = 'http://localhost:' + PORT;
const DATA = path.join(__dirname, '.data', 'state.json');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m ' + name); pass++; }
  else { console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (extra ? '  ' + extra : '')); fail++; }
}

function get(p) {
  return new Promise((res, rej) => {
    http.get(BASE + p, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
}
function post(p, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body || {});
    const u = new URL(BASE + p);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); });
    req.on('error', rej); req.write(data); req.end();
  });
}
function runCli(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
      env: { ...process.env, BOUNTY_PORT: String(PORT), NO_COLOR: '1' },
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', (code) => res({ code, out, err }));
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // fresh state
  try { fs.unlinkSync(DATA); } catch {}

  process.env.BOUNTY_PORT = String(PORT);
  const { server } = require('./server');
  await new Promise((r) => server.listen(PORT, r));
  console.log('\nBounty smoke test on ' + BASE + '\n');

  // 1. list
  let r = await runCli(['earn']);
  ok('earn lists resend bounty', r.out.includes('resend-first-email'), r.err.trim());
  ok('earn shows reward', r.out.includes('+500 cr'));

  // 2. detail
  r = await runCli(['earn', 'resend-first-email']);
  ok('earn <id> shows steps', r.out.includes('Send your first transactional email') && r.out.includes('1.'));

  // 3. balance starts at 0
  r = await runCli(['balance']);
  ok('balance starts at 0', r.out.includes('0 credits'));

  // 4. verify — run CLI, operator approves mid-flight
  const verifyP = runCli(['verify', 'resend-first-email', '--proof', 'msg_abc123']);
  let approved = false;
  for (let i = 0; i < 40 && !approved; i++) {
    await sleep(500);
    const { pending } = await get('/pending');
    if (pending.length) {
      ok('submission appears in operator queue', pending[0].proof === 'msg_abc123');
      const res = await post('/approve/' + pending[0].id, {});
      ok('approve awards credits', res.balance === 500, 'balance=' + res.balance);
      approved = true;
    }
  }
  const vr = await verifyP;
  ok('verify reports success to user', vr.out.includes('Verified') && vr.out.includes('500'));
  ok('verify exits 0', vr.code === 0, 'code=' + vr.code);

  // 5. balance updated
  r = await runCli(['balance']);
  ok('balance now 500', r.out.includes('500 credits'));

  // 6. history shows approved
  r = await runCli(['history']);
  ok('history shows approved resend', /resend-first-email/.test(r.out) && r.out.includes('+500 cr'));

  // 7. no double-claim
  r = await runCli(['verify', 'resend-first-email', '--proof', 'again']);
  ok('cannot re-claim completed bounty', r.out.includes('already completed'));

  // 8. reject path
  const rejP = runCli(['verify', 'stripe-first-charge', '--proof', 'pi_bad']);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const { pending } = await get('/pending');
    const s = pending.find(x => x.challengeId === 'stripe-first-charge');
    if (s) { await post('/reject/' + s.id, { reason: 'test reject' }); break; }
  }
  const rr = await rejP;
  ok('verify reports rejection', rr.out.includes('Rejected'), rr.out.trim());
  ok('rejected verify exits non-zero', rr.code === 1, 'code=' + rr.code);

  server.close();
  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
