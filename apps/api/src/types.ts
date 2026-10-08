export type AuctionStatus =
  | "CREATED"
  | "OPEN"
  | "CLOSING"
  | "ELIGIBILITY_CHECK"
  | "MPC_WINNER_SELECTION"
  | "PROVISIONAL_WINNER"
  | "SETTLEMENT_WINDOW"
  | "SETTLED"
  | "DEFAULTED"
  | "COMPLETED";

export type BidStatus = "ACCEPTED" | "REJECTED";

export type Commitment = { compressed: string };

export type PublicInputs = {
  auction_id: string;
  bid_commitment: Commitment;
  funding_commitment: Commitment;
  bid_tag: string;
  note_commitment: string;
  minimum_bid: number;
  bond_requirement: number;
};

export type EligibilityProof = {
  public: PublicInputs;
  range_proof: string;
};

export type Auction = {
  auctionId: string;
  seller: string;
  minimumBid: number;
  bondAmount: number;
  startTime: string;
  endTime: string;
  settlementWindow: number;
  pricingRule: "FIRST_PRICE";
  status: AuctionStatus;
};

export type StoredBid = {
  bidId: string;
  auctionId: string;
  bidCommitment: string;
  fundingCommitment: string;
  bidTag: string;
  noteCommitment: string;
  eligibilityProof: EligibilityProof;
  status: BidStatus;
  createdAt: string;
};

export type CreateAuctionBody = {
  auctionId?: string;
  seller: string;
  minimumBid: number;
  bondAmount: number;
  startTime?: string;
  endTime: string;
  settlementWindow?: number;
};
