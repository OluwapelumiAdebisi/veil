import { randomHex } from "./api";
import type { LocalEnvelope, LocalNote } from "./types";

const WALLET_KEY = "veil.wallet";
const BIDS_KEY = "veil.localBids";

export type WalletSource = "zodl" | "zashi" | "ywallet" | "address";

export type Wallet = {
  address: string;
  source: WalletSource | null;
  connected: boolean;
  note: LocalNote;
};

function emptyWallet(): Wallet {
  return {
    address: "",
    source: null,
    connected: false,
    note: { value: 20, rho: randomHex(32), nk: randomHex(32) },
  };
}

export function isZcashAddress(value: string) {
  const v = value.trim();
  return /^(u1|utest1|uregtest1|zs1|ztestsapling1|tm|t1|t3)[a-z0-9]{10,}$/i.test(v);
}

export function shortenAddress(address: string) {
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function loadWallet(): Wallet {
  if (typeof window === "undefined") {
    return emptyWallet();
  }
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Wallet> & { sellerId?: string };
      const address = parsed.address || parsed.sellerId || "";
      return {
        address,
        source: parsed.source ?? null,
        connected: Boolean(parsed.connected && address),
        note: parsed.note ?? emptyWallet().note,
      };
    }
  } catch {
    /* ignore */
  }
  const wallet = emptyWallet();
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  return wallet;
}

export function saveWallet(wallet: Wallet) {
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  window.dispatchEvent(new Event("veil-wallet"));
}

export function connectWallet(address: string, source: WalletSource): Wallet {
  const next: Wallet = {
    ...loadWallet(),
    address: address.trim(),
    source,
    connected: true,
  };
  saveWallet(next);
  return next;
}

export function disconnectWallet(): Wallet {
  const next: Wallet = { ...loadWallet(), address: "", source: null, connected: false };
  saveWallet(next);
  return next;
}

export function onWalletChange(cb: () => void) {
  const handler = () => cb();
  window.addEventListener("veil-wallet", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("veil-wallet", handler);
    window.removeEventListener("storage", handler);
  };
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
