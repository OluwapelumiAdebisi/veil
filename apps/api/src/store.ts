import type { Auction, BidShare, StoredBid } from "./types.ts";

export class MemoryStore {
  auctions = new Map<string, Auction>();
  bids = new Map<string, StoredBid[]>();
  tags = new Set<string>();
  observed: string[] = [];
  committee = [new Map<string, BidShare>(), new Map<string, BidShare>(), new Map<string, BidShare>()];

  putAuction(auction: Auction) {
    this.auctions.set(auction.auctionId, auction);
  }

  getAuction(id: string) {
    return this.auctions.get(id);
  }

  listAuctions() {
    return [...this.auctions.values()];
  }

  addBid(bid: StoredBid) {
    const list = this.bids.get(bid.auctionId) ?? [];
    list.push(bid);
    this.bids.set(bid.auctionId, list);
    this.tags.add(`${bid.auctionId}:${bid.bidTag}`);
  }

  getBid(auctionId: string, bidId: string) {
    return this.listBids(auctionId).find((b) => b.bidId === bidId);
  }

  listBids(auctionId: string) {
    return this.bids.get(auctionId) ?? [];
  }

  hasTag(auctionId: string, tag: string) {
    return this.tags.has(`${auctionId}:${tag}`);
  }

  addObserved(spent: string) {
    if (!this.observed.includes(spent)) {
      this.observed.push(spent);
    }
  }

  putShare(nodeId: number, bidId: string, share: BidShare) {
    this.committee[nodeId - 1].set(bidId, share);
  }

  getShare(nodeId: number, bidId: string) {
    return this.committee[nodeId - 1].get(bidId);
  }

  reset() {
    this.auctions.clear();
    this.bids.clear();
    this.tags.clear();
    this.observed = [];
    this.committee = [new Map(), new Map(), new Map()];
  }
}
