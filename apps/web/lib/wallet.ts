import { randomHex } from "./api";
import type { LocalEnvelope, LocalNote } from "./types";

const WALLET_KEY = "veil.wallet";
const BIDS_KEY = "veil.localBids";

export type Wallet = {
  sellerId: string;
  note: LocalNote;
};

function emptyWallet(): Wallet {
  return {
    sellerId: `zs1${randomHex(8)}`,
    note: { value: 20, rho: randomHex(32), nk: randomHex(32) },
  };
}

export function loadWallet(): Wallet {
  if (typeof window === "undefined") {
    return emptyWallet();
  }
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    if (raw) {
      return JSON.parse(raw) as Wallet;
    }
  } catch {
    /* ignore */
  }
  const wallet = emptyWallet();
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  return wallet;
}

export function loadLocalBids(): LocalEnvelope[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(BIDS_KEY);
    return raw ? (JSON.parse(raw) as LocalEnvelope[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalBids(bids: LocalEnvelope[]) {
  localStorage.setItem(BIDS_KEY, JSON.stringify(bids));
}

export function freshNote(value = 20): LocalNote {
  return { value, rho: randomHex(32), nk: randomHex(32) };
}
