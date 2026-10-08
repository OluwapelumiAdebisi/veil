import type { Auction, StoredBid } from "./types.ts";

export class MemoryStore {
  auctions = new Map<string, Auction>();
  bids = new Map<string, StoredBid[]>();
  tags = new Set<string>();

  putAuction(auction: Auction) {
    this.auctions.set(auction.auctionId, auction);
  }

  getAuction(id: string) {
    return this.auctions.get(id);
  }

  addBid(bid: StoredBid) {
    const list = this.bids.get(bid.auctionId) ?? [];
    list.push(bid);
    this.bids.set(bid.auctionId, list);
    this.tags.add(`${bid.auctionId}:${bid.bidTag}`);
  }

  listBids(auctionId: string) {
    return this.bids.get(auctionId) ?? [];
  }

  hasTag(auctionId: string, tag: string) {
    return this.tags.has(`${auctionId}:${tag}`);
  }
}
