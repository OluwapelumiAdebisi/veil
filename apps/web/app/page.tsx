"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { endsIn, lotTitle, statusCopy, zec } from "../lib/format";
import type { Auction } from "../lib/types";

export default function Home() {
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    void api<Auction[]>("/auctions")
      .then(setAuctions)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load auctions"));
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-[family-name:var(--font-fraunces)] text-5xl tracking-tight">Live auctions</h1>
          <p className="mt-3 max-w-xl text-sm text-[var(--muted)]">
            Sealed-bid lots on Zcash. You see the market. Nobody sees your bid.
          </p>
        </div>
        <Link
          href="/sell"
          className="rounded-full border border-[var(--gold)] px-5 py-2 text-sm text-[var(--gold)]"
        >
          List an item
        </Link>
      </div>

      {(!ready || (auctions === null && !error)) && (
        <p className="text-sm text-[var(--muted)]">Loading lots…</p>
      )}
      {ready && error && <p className="text-sm text-[var(--gold)]">{error}</p>}
      {auctions?.length === 0 && (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-6 py-16 text-center">
          <p className="font-[family-name:var(--font-fraunces)] text-2xl">No lots yet</p>
          <p className="mt-2 text-sm text-[var(--muted)]">List something. Bids stay sealed until close.</p>
          <Link href="/sell" className="mt-6 inline-block text-sm text-[var(--gold)]">
            Create a listing
          </Link>
        </div>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {auctions?.map((auction) => (
          <li key={auction.auctionId}>
            <Link
              href={`/auctions/${auction.auctionId}`}
              className="block rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 transition hover:border-[var(--gold)]"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-[family-name:var(--font-fraunces)] text-2xl">{lotTitle(auction)}</h2>
                <span className="shrink-0 text-xs tracking-widest text-[var(--gold)] uppercase">
                  {statusCopy(auction.status)}
                </span>
              </div>
              {auction.description && (
                <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{auction.description}</p>
              )}
              <dl className="mt-5 grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
                <div>
                  <dt className="uppercase tracking-widest">Min bid</dt>
                  <dd className="mt-1 text-[var(--foreground)]">{zec(auction.minimumBid)}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-widest">Sealed bids</dt>
                  <dd className="mt-1 text-[var(--foreground)]">{auction.sealedBidCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-widest">Ends</dt>
                  <dd className="mt-1 text-[var(--foreground)]">{endsIn(auction.endTime)}</dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
