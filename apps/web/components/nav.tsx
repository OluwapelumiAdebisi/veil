import Link from "next/link";

export function Nav() {
  return (
    <header className="border-b border-[var(--line)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-[family-name:var(--font-fraunces)] text-2xl tracking-tight">Veil</span>
          <span className="text-[10px] tracking-[0.28em] text-[var(--gold)]">SEALED BIDS</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="text-[var(--muted)] hover:text-[var(--foreground)]">
            Auctions
          </Link>
          <Link href="/sell" className="text-[var(--muted)] hover:text-[var(--foreground)]">
            List an item
          </Link>
        </nav>
      </div>
    </header>
  );
}
