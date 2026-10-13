"use client";

import { useCallback, useEffect, useState } from "react";
import { zodlReceiveDeepLink } from "../lib/zcash-uri";
import {
  connectWallet,
  disconnectWallet,
  isZcashAddress,
  loadWallet,
  onWalletChange,
  shortenAddress,
  type Wallet,
} from "../lib/wallet";
import { QrScan } from "./qr-scan";

export function WalletButton() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setWallet(loadWallet());
    sync();
    return onWalletChange(sync);
  }, []);

  if (!wallet) {
    return null;
  }

  return (
    <>
      {wallet.connected ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--gold)]"
        >
          {shortenAddress(wallet.address)}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-[var(--gold)] px-4 py-1.5 text-xs text-[var(--gold)]"
        >
          Connect Zodl
        </button>
      )}
      {open && <WalletModal wallet={wallet} onClose={() => setOpen(false)} />}
    </>
  );
}

function WalletModal({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");

  const accept = useCallback(
    (address: string) => {
      connectWallet(address, "zodl");
      onClose();
    },
    [onClose],
  );

  function connectPasted() {
    if (!isZcashAddress(paste)) {
      setError("That doesn’t look like a Zcash Unified Address.");
      return;
    }
    accept(paste);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.28em] text-[var(--gold)]">ZODL</p>
            <h2 className="mt-1 font-[family-name:var(--font-fraunces)] text-2xl">Link Zodl</h2>
          </div>
          <button onClick={onClose} className="text-sm text-[var(--muted)]">
            Close
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          This only saves your Unified Address so the seller gets paid there. Veil never gets keys, and
          linking an address does not move funds. When you win, you pay from Zodl.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-4 text-xs leading-5 text-[var(--muted)]">
          <li>Open Zodl on your phone.</li>
          <li>Go to Receive and show the Unified Address QR.</li>
          <li>Scan it here.</li>
        </ol>
        <a
          href={zodlReceiveDeepLink()}
          className="mt-4 inline-block text-xs text-[var(--gold)]"
        >
          Open Zodl Receive
        </a>
        <div className="mt-5">
          <QrScan onAddress={accept} />
        </div>
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-[var(--muted)]">Paste address instead</summary>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Same as scanning: it names a receive address. It does not unlock a wallet. Use an address you
            control in Zodl, or you will not be able to complete settlement.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 font-mono text-[11px]"
            placeholder="utest1… or u1…"
          />
          <button
            onClick={connectPasted}
            className="mt-2 rounded-full border border-[var(--line)] px-4 py-1.5 text-xs"
          >
            Use this address
          </button>
        </details>
        {error && <p className="mt-2 text-xs text-[var(--gold)]">{error}</p>}
        {wallet.connected && (
          <button
            onClick={() => {
              disconnectWallet();
              onClose();
            }}
            className="mt-4 text-xs text-[var(--muted)]"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
