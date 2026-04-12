const fs = require("fs");
const path = require("path");

const STORE_DIR = path.join(process.cwd(), "cache");
const STORE_FILE = path.join(STORE_DIR, "campaign-profile-store.json");

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(STORE_FILE, "utf8");
    if (!raw.trim()) {
      return {};
    }

    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store) {
  ensureStoreDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function loadCampaignProfileFromStore(cid) {
  if (!cid) return null;
  const store = readStore();
  return store[cid] || null;
}

function saveCampaignProfileToStore(cid, profile) {
  if (!cid || !profile) return;

  const store = readStore();
  store[cid] = profile;
  writeStore(store);
}

module.exports = {
  loadCampaignProfileFromStore,
  saveCampaignProfileToStore,
};
