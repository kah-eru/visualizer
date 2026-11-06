# Bounty

Earn LLM API credits by completing sponsored integration challenges.

This is a **Wizard-of-Oz prototype**: the plumbing is real (CLI → server → wallet),
but verification is done by a human operator clicking **Approve** in a web panel
instead of by automated checks. That lets us validate the end-to-end experience
and run a paid sponsor pilot before building real verifiers.

- **Zero dependencies.** Node built-ins only — no `npm install`, no Python.
- **Runs anywhere Node ≥ 18 does**, including a plain Windows machine.

## Quick start

```bash
# 1. start the verification server + operator panel
node server.js
#    → Bounty server on http://localhost:4777
#    → Operator panel:   http://localhost:4777/panel

# 2. in another terminal, use the CLI
node cli.js earn                                   # list bounties
node cli.js earn resend-first-email                # see the steps
node cli.js verify resend-first-email --proof msg_123   # submit + wait
node cli.js balance
node cli.js history
```

While `verify` is waiting, open **http://localhost:4777/panel** and click
**Approve** — the CLI prints `✓ Verified!` and the credits land.

## CLI

```
bounty earn                      list available bounties
bounty earn <id>                 show the steps for one bounty
bounty verify <id> --proof <x>   submit proof and wait for verification
bounty balance                   show your credit balance
bounty history                   show your past submissions
```

Point the CLI at a non-default server with `BOUNTY_SERVER=http://host:port`
(or just `BOUNTY_PORT=4777`).

## How it works

```
  developer                 server (localhost:4777)              operator
  ─────────                 ──────────────────────              ────────
  bounty verify  ──POST /submit──▶  pending submission
       │                                  │ ──shows in──▶  /panel
       │ polls /submission/:id            │                 │
       │                                  │ ◀──POST /approve── click
       │ ◀──────── approved ──────────────┤
   "✓ Verified! +500 cr"            wallet += reward
```

- **`server.js`** — HTTP verification server. Serves the operator panel,
  accepts submissions, and awards credits on approval. State is a JSON file
  (`.data/state.json`).
- **`cli.js`** — the developer-facing CLI. A thin HTTP client; holds no state.
- **`challenges.json`** — the bounty catalog (sponsor, reward, steps, proof label).
- **`lib/store.js`** — tiny JSON-file state store (balance, submissions, completed).

Each challenge declares a `verify` type — `url`, `inbox`, or `local` — which is
the self-contained verification pattern a real verifier would use (probe a URL,
check an inbox/webhook, or confirm local execution). In the prototype the
operator stands in for all three.

## Verification paths (for real, later)

| Type    | How it would verify without sponsor admin access                 |
|---------|------------------------------------------------------------------|
| `url`   | Probe a public URL / resource the integration creates.           |
| `inbox` | Dev sends to a Bounty-controlled address / webhook; we confirm.  |
| `local` | Dev runs a command; a signed receipt proves it executed.         |

## Tests

```bash
node smoke-test.js      # end-to-end: CLI ⇄ server ⇄ operator approval (13 checks)
```

## Notes

- Single-user wallet for now (no auth) — fine for a piloted demo.
- One reward per challenge; re-submitting a completed bounty is rejected.
- `operator-panel.png` is a screenshot of the panel with two pending submissions.
