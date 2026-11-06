'use strict';

// Tiny JSON-file state store. No external dependencies.
// State lives next to the server so the Wizard-of-Oz operator and the CLI
// share one source of truth over HTTP (the CLI never touches this file
// directly; only the server does).

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  // single-user prototype: one wallet
  balance: 0,
  // submissions keyed by id: { id, challengeId, proof, status, createdAt, resolvedAt, reward }
  submissions: {},
  // completed challenge ids (one reward per challenge)
  completed: [],
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) {
    save(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    // corrupt file: back it up and start fresh rather than crash the pilot
    fs.renameSync(STATE_FILE, STATE_FILE + '.corrupt-' + Date.now());
    save(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
}

function save(state) {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

module.exports = { load, save, STATE_FILE, DEFAULT_STATE };
