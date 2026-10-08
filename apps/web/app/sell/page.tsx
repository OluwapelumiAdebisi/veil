"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Auction } from "../../lib/types";
import { loadWallet } from "../../lib/wallet";

export default function SellPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minimumBid, setMinimumBid] = useState(1);
  const [bondAmount, setBondAmount] = useState(1);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const wallet = loadWallet();
      const created = await api<Auction>("/auctions", {
        method: "POST",
        body: JSON.stringify({
          seller: wallet.sellerId,
          title,
          description,
          minimumBid,
          bondAmount,
          settlementWindow: 20,
          endTime: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
        }),
      });
      router.push(`/auctions/${created.auctionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="font-[family-name:var(--font-fraunces)] text-4xl tracking-tight">List an item</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        Public listing only. Bid amounts never touch Veil.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field label="Title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"
            placeholder="Vintage orchard note"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"
            placeholder="What is being sold. Keep it public — nothing about bids."
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min bid (ZEC)">
            <input
              type="number"
              min={1}
              value={minimumBid}
              onChange={(e) => setMinimumBid(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"
            />
          </Field>
          <Field label="Bond (ZEC)">
            <input
              type="number"
              min={1}
              value={bondAmount}
              onChange={(e) => setBondAmount(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"
            />
          </Field>
          <Field label="Hours live">
            <input
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2"
            />
          </Field>
        </div>
        {error && <p className="text-sm text-[var(--gold)]">{error}</p>}
        <button
          disabled={busy}
          className="rounded-full bg-[var(--gold)] px-6 py-2 text-sm text-black disabled:opacity-40"
        >
          {busy ? "Publishing…" : "Publish listing"}
        </button>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs tracking-widest text-[var(--muted)] uppercase">
      {label}
      {children}
    </label>
  );
}
