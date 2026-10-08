export type Bid = {
  bidId: string;
  bidTag: string;
  bidCommitment: string;
  status: string;
  createdAt?: string;
};

export type Auction = {
  auctionId: string;
  seller: string;
  title?: string;
  description?: string;
  minimumBid: number;
  bondAmount: number;
  status: string;
  endTime: string;
  startTime?: string;
  winnerBidId?: string;
  settlementDeadline?: string;
  settlementTxid?: string;
  defaultedBidIds?: string[];
  sealedBidCount?: number;
  bids?: Bid[];
};

export type LocalNote = {
  value: number;
  rho: string;
  nk: string;
};

export type LocalEnvelope = {
  auctionId: string;
  bidId: string;
  bidNonce: string;
  amount: number;
  note: LocalNote;
  status?: string;
};
