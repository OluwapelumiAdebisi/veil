export function lotTitle(auction: { auctionId: string; title?: string }) {
  return auction.title?.trim() || `Lot ${auction.auctionId.slice(0, 8)}`;
}

export function statusCopy(status?: string) {
  switch (status) {
    case "OPEN":
      return "Live";
    case "ELIGIBILITY_CHECK":
      return "Confirming";
    case "SETTLEMENT_WINDOW":
      return "Settling";
    case "SETTLED":
      return "Sold";
    case "DEFAULTED":
      return "Defaulted";
    default:
      return status ?? "—";
  }
}

export function zec(amount: number) {
  return `${amount} ZEC`;
}

export function endsIn(iso?: string) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
