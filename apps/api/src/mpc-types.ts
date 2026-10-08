import type { BidShare, Commitment } from "./types.ts";

export type ArgmaxBid = {
  bid_id: string;
  bid_commitment: Commitment;
  shares: BidShare[];
};
