"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { endsIn, lotTitle, statusCopy, zec } from "../../../lib/format";
import type { Auction, Bid, LocalEnvelope } from "../../../lib/types";
import { freshNote, loadLocalBids, loadWallet, saveLocalBids, type Wallet } from "../../../lib/wallet";

export default function AuctionPage() {
  const { id } = useParams<{ id: string }>();
  const [auction, setAuction] = useState<Auction | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [envelopes, setEnvelopes] = useState<LocalEnvelope[]>([]);
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const mine = useMemo(
    () => envelopes.filter((e) => e.auctionId === id),
    [envelopes, id],
  );
  const isSeller = wallet && auction && auction.seller === wallet.sellerId;

  const refresh = useCallback(async () => {
    const next = await api<Auction>(`/auctions/${id}`);
    setAuction(next);
    setEnvelopes((prev) => {
      const synced = prev.map((e) => {
        const row = next.bids?.find((b) => b.bidId === e.bidId);
        return row ? { ...e, status: row.status } : e;
      });
      saveLocalBids(synced);
      return synced;
    });
  }, [id]);

  useEffect(() => {
    setWallet(loadWallet());
    setEnvelopes(loadLocalBids());
    void refresh().catch((err) => setNotice(err instanceof Error ? err.message : "not found"));
  }, [refresh]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      setNotice(label);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function placeBid() {
    if (!auction || !wallet) return;
    await run("Sealed bid submitted. Amount stayed on this device.", async () => {
      const note = mine.length === 0 ? wallet.note : freshNote(wallet.note.value);
      const proved = await api<{ proof: { public: { bid_tag: string } }; bid_nonce: string }>(
        "/prover/prove",
        {
          method: "POST",
          body: JSON.stringify({
            auction_id: auction.auctionId,
            bid_amount: amount,
            minimum_bid: auction.minimumBid,
            bond_requirement: auction.bondAmount,
            note,
          }),
        },
      );
      const posted = await api<Bid>(`/auctions/${auction.auctionId}/bids`, {
        method: "POST",
        body: JSON.stringify({ proof: proved.proof }),
      });
      const split = await api<{ shares: { index: number }[] }>("/prover/split", {
        method: "POST",
        body: JSON.stringify({
          auction_id: auction.auctionId,
          bid_amount: amount,
          bid_nonce: proved.bid_nonce,
        }),
      });
      for (const share of split.shares) {
        await api(`/committee/${share.index}/shares`, {
          method: "POST",
          body: JSON.stringify({
            auctionId: auction.auctionId,
            bidId: posted.bidId,
            share,
          }),
        });
      }
      const next: LocalEnvelope = {
        auctionId: auction.auctionId,
        bidId: posted.bidId,
        bidNonce: proved.bid_nonce,
        amount,
        note,
        status: posted.status,
      };
      const all = [...loadLocalBids(), next];
      saveLocalBids(all);
      setEnvelopes(all);
      await refresh();
    });
  }

  async function reconfirm(envelope: LocalEnvelope) {
    await run("Eligibility reconfirmed.", async () => {
      const indexer = await api<{ nullifiers: string[] }>("/indexer");
      const proved = await api<{ proof: unknown }>("/prover/prove", {
        method: "POST",
        body: JSON.stringify({
          auction_id: auction?.auctionId,
          bid_amount: envelope.amount,
          minimum_bid: auction?.minimumBid,
          bond_requirement: auction?.bondAmount,
          note: envelope.note,
          spent_nullifiers: indexer.nullifiers,
          bid_nonce: envelope.bidNonce,
        }),
      });
      await api(`/auctions/${auction?.auctionId}/bids/${envelope.bidId}/reconfirm`, {
        method: "POST",
        body: JSON.stringify({ proof: proved.proof }),
      });
      await refresh();
    });
  }

  async function closeAuction() {
    await run("Bidding closed.", async () => {
      await api(`/auctions/${id}/close`, { method: "POST" });
      await refresh();
    });
  }

  async function selectWinner() {
    await run("Winner selected. Only the bid id is public.", async () => {
      await api(`/auctions/${id}/select-winner`, { method: "POST" });
      await refresh();
    });
  }

  async function settle() {
    await run("Settlement recorded.", async () => {
      await api(`/auctions/${id}/settle`, {
        method: "POST",
        body: JSON.stringify({ txid: `shielded-${Date.now()}` }),
      });
      await refresh();
    });
  }

  async function defaultWinner() {
    await run("Winner defaulted. Next bid selected.", async () => {
      await api(`/auctions/${id}/default`, { method: "POST" });
      await refresh();
    });
  }

  if (!auction) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm text-[var(--muted)]">{notice || "Loading listing…"}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-[var(--gold)]">
          Back to auctions
        </Link>
      </main>
    );
  }

  const publicBids = auction.bids ?? [];
  const winnerTag = publicBids.find((b) => b.bidId === auction.winnerBidId)?.bidTag;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-xs tracking-widest text-[var(--muted)] uppercase">
        All auctions
      </Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section>
          <p className="text-xs tracking-[0.28em] text-[var(--gold)] uppercase">{statusCopy(auction.status)}</p>
          <h1 className="mt-2 font-[family-name:var(--font-fraunces)] text-5xl tracking-tight">{lotTitle(auction)}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {auction.description || "A sealed-bid lot. Amounts stay with bidders until settlement."}
          </p>
          <dl className="mt-8 grid gap-4 sm:grid-cols-4">
            <Stat label="Min bid" value={zec(auction.minimumBid)} />
            <Stat label="Bond" value={zec(auction.bondAmount)} />
            <Stat label="Sealed bids" value={String(publicBids.length)} />
            <Stat label="Ends" value={endsIn(auction.endTime)} />
          </dl>
          {auction.winnerBidId && (
            <p className="mt-6 text-sm">
              Winner <span className="text-[var(--gold)]">{winnerTag?.slice(0, 16) ?? auction.winnerBidId.slice(0, 8)}…</span>
              {auction.settlementTxid && " · settled"}
            </p>
          )}
          {notice && <p className="mt-4 text-sm text-[var(--gold)]">{notice}</p>}
        </section>

        <aside className="space-y-4">
          {auction.status === "OPEN" && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <h2 className="font-[family-name:var(--font-fraunces)] text-xl">Place a sealed bid</h2>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Your amount is proven locally. Veil only stores a commitment.
              </p>
              <label className="mt-4 block text-xs text-[var(--muted)]">
                Your bid (ZEC)
                <input
                  type="number"
                  min={auction.minimumBid}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"
                />
              </label>
              <button
                disabled={busy}
                onClick={placeBid}
                className="mt-4 w-full rounded-full bg-[var(--gold)] px-4 py-2 text-sm text-black disabled:opacity-40"
              >
                Submit sealed bid
              </button>
            </div>
          )}

          {mine.length > 0 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <h2 className="font-[family-name:var(--font-fraunces)] text-xl">Your bids</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Only this browser knows the amounts.</p>
              <ul className="mt-4 space-y-3">
                {mine.map((envelope) => (
                  <li key={envelope.bidId} className="border-t border-[var(--line)] pt-3 text-sm">
                    <p>
                      {zec(envelope.amount)} · {envelope.status ?? "submitted"}
                    </p>
                    {auction.status === "ELIGIBILITY_CHECK" && (
                      <button
                        disabled={busy}
                        onClick={() => reconfirm(envelope)}
                        className="mt-2 text-xs text-[var(--gold)] disabled:opacity-40"
                      >
                        Reconfirm eligibility
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isSeller && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <h2 className="font-[family-name:var(--font-fraunces)] text-xl">Seller tools</h2>
              <p className="mt-2 text-xs text-[var(--muted)]">Close the lot, then settle with the winner.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Action disabled={busy || auction.status !== "OPEN"} onClick={closeAuction} label="Close bidding" />
                <Action
                  disabled={busy || auction.status !== "ELIGIBILITY_CHECK"}
                  onClick={selectWinner}
                  label="Select winner"
                />
                <Action disabled={busy || auction.status !== "SETTLEMENT_WINDOW"} onClick={settle} label="Mark settled" />
                <Action
                  disabled={busy || auction.status !== "SETTLEMENT_WINDOW"}
                  onClick={defaultWinner}
                  label="Winner defaulted"
                />
              </div>
            </div>
          )}
        </aside>
      </div>

      <section className="mt-12">
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl">Public record</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Tags and commitments only. No amounts.</p>
        <ul className="mt-4 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
          {publicBids.length === 0 && (
            <li className="px-5 py-6 text-sm text-[var(--muted)]">No sealed bids yet.</li>
          )}
          {publicBids.map((bid) => (
            <li key={bid.bidId} className="px-5 py-4 text-xs text-[var(--muted)]">
              <span className="text-[var(--foreground)]">{bid.status}</span>
              <span className="mt-1 block truncate">tag {bid.bidTag}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs tracking-widest text-[var(--muted)] uppercase">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-fraunces)] text-xl">{value}</p>
    </div>
  );
}

function Action({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40"
    >
      {label}
    </button>
  );
}
