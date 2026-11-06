#!/usr/bin/env node
'use strict';

// Bounty CLI — earn LLM credits by completing sponsored integration challenges.
// Zero external dependencies. Talks to the local verification server over HTTP.
//
//   bounty earn                      list available challenges
//   bounty earn <id>                 show steps for one challenge
//   bounty verify <id> --proof <x>   submit proof and wait for verification
//   bounty balance                   show your credit balance
//   bounty history                   show your submissions

const http = require('http');

const BASE =
  process.env.BOUNTY_SERVER || 'http://localhost:' + (process.env.BOUNTY_PORT || 4777);

// ---------- tiny styling ----------
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);
const blue = (s) => c('34', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);

// ---------- http client ----------
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => (raw += d));
        res.on('end', () => {
          let parsed = {};
          try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function serverDownHint(e) {
  console.error(red('✗ Could not reach the Bounty server at ' + BASE));
  console.error(dim('  Start it with:  node server.js'));
  if (e && e.code) console.error(dim('  (' + e.code + ')'));
}

// ---------- arg parsing ----------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

// ---------- commands ----------
async function cmdEarn(id) {
  const { body } = await request('GET', '/challenges');
  const list = body.challenges || [];
  if (!id) {
    console.log('\n' + bold('Available bounties') + '\n');
    for (const ch of list) {
      console.log(
        '  ' + blue(ch.id.padEnd(22)) + ' ' + green('+' + ch.reward + ' cr').padEnd(10) +
        '  ' + ch.title
      );
      console.log('  ' + dim(''.padEnd(22)) + ' ' + dim(ch.sponsor + ' · ~' + ch.estMinutes + ' min · ' + ch.verify + ' check'));
    }
    console.log('\n' + dim('Run  bounty earn <id>  to see the steps.\n'));
    return;
  }
  const ch = list.find((x) => x.id === id);
  if (!ch) { console.error(red('✗ No challenge with id ' + JSON.stringify(id))); process.exitCode = 1; return; }
  console.log('\n' + bold(ch.title) + '  ' + green('+' + ch.reward + ' ' + ch.rewardUnit));
  console.log(dim(ch.sponsor + ' · ~' + ch.estMinutes + ' min · verified by ' + ch.verify + ' check'));
  console.log('\n' + ch.blurb + '\n');
  ch.steps.forEach((s, i) => console.log('  ' + bold((i + 1) + '.') + ' ' + s));
  console.log('\n' + dim('When done:  ') + 'bounty verify ' + ch.id + ' --proof <' + ch.proofLabel + '>\n');
}

async function cmdVerify(id, proof) {
  if (!id) { console.error(red('✗ Usage: bounty verify <id> --proof <proof>')); process.exitCode = 1; return; }
  if (!proof) { console.error(red('✗ Missing --proof <value>')); process.exitCode = 1; return; }

  const sub = await request('POST', '/submit', { challengeId: id, proof });
  if (sub.status === 400) { console.error(red('✗ ' + (sub.body.error || 'unknown challenge'))); process.exitCode = 1; return; }
  if (sub.status === 409) { console.log(yellow('• ' + (sub.body.error || 'already completed'))); return; }
  if (sub.status !== 201) { console.error(red('✗ Submit failed (' + sub.status + ')')); process.exitCode = 1; return; }

  const subId = sub.body.id;
  process.stdout.write(dim('Submitted. Waiting for verification'));

  const deadline = Date.now() + 120000; // 2 min
  while (Date.now() < deadline) {
    await sleep(1500);
    process.stdout.write(dim('.'));
    const st = await request('GET', '/submission/' + subId);
    const s = st.body;
    if (s.status === 'approved') {
      const bal = await request('GET', '/balance');
      console.log('\n' + green('✓ Verified!') + ' +' + s.reward + ' credits.  Balance: ' + bold(bal.body.balance + ' cr'));
      return;
    }
    if (s.status === 'rejected') {
      console.log('\n' + red('✗ Rejected') + (s.reason ? dim(' — ' + s.reason) : ''));
      process.exitCode = 1;
      return;
    }
  }
  console.log('\n' + yellow('• Still pending.') + dim('  Check later with  bounty history'));
}

async function cmdBalance() {
  const { body } = await request('GET', '/balance');
  console.log('\n' + bold('Balance: ') + green(body.balance + ' credits'));
  console.log(dim('Completed ' + body.completed.length + ' ' + (body.completed.length === 1 ? 'bounty' : 'bounties')) + '\n');
}

async function cmdHistory() {
  const { body } = await request('GET', '/history');
  const h = body.history || [];
  if (!h.length) { console.log('\n' + dim('No submissions yet. Try  bounty earn\n')); return; }
  console.log('\n' + bold('Your submissions') + '\n');
  for (const s of h) {
    const mark = s.status === 'approved' ? green('✓') : s.status === 'rejected' ? red('✗') : yellow('•');
    const amt = s.status === 'approved' ? green('+' + s.reward + ' cr') : dim(s.status);
    console.log('  ' + mark + ' ' + s.sponsor.padEnd(10) + ' ' + dim(s.challengeId.padEnd(22)) + ' ' + amt);
  }
  console.log('');
}

function usage() {
  console.log(`
${bold('bounty')} — earn LLM API credits by completing sponsored integrations

  ${blue('bounty earn')}                    list available bounties
  ${blue('bounty earn')} <id>               show the steps for one bounty
  ${blue('bounty verify')} <id> --proof <x> submit proof and wait for verification
  ${blue('bounty balance')}                 show your credit balance
  ${blue('bounty history')}                 show your past submissions

Server: ${dim(BASE)}  ${dim('(override with BOUNTY_SERVER)')}
`);
}

// ---------- dispatch ----------
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  try {
    switch (cmd) {
      case 'earn': return await cmdEarn(positional[1]);
      case 'verify': return await cmdVerify(positional[1], flags.proof);
      case 'balance': return await cmdBalance();
      case 'history': return await cmdHistory();
      case undefined:
      case 'help':
      case '--help':
      case '-h': return usage();
      default:
        console.error(red('✗ Unknown command: ' + cmd));
        usage();
        process.exitCode = 1;
    }
  } catch (e) {
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET')) serverDownHint(e);
    else { console.error(red('✗ ' + (e && e.message || e))); process.exitCode = 1; }
  }
}

main();
