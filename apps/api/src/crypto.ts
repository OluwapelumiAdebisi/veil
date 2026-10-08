import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ArgmaxBid } from "./mpc-types.ts";
import type { BidShare, EligibilityProof } from "./types.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function cryptoBin(): string {
  return process.env.VEIL_CRYPTO_BIN ?? path.join(repoRoot, "target", "debug", "veil-crypto");
}

export function mpcBin(): string {
  return process.env.VEIL_MPC_BIN ?? path.join(repoRoot, "target", "debug", "veil-mpc");
}

export async function verifyProof(proof: EligibilityProof): Promise<{ valid: boolean; error?: string }> {
  const result = await runBin(cryptoBin(), ["verify"], JSON.stringify(proof));
  if (result.stdout.trim()) {
    try {
      return JSON.parse(result.stdout) as { valid: boolean; error?: string };
    } catch {
      /* fall through */
    }
  }
  return { valid: result.exitCode === 0, error: result.stderr.trim() || "verify failed" };
}

export async function proveLocal(request: unknown): Promise<{ proof: EligibilityProof; bid_nonce: string }> {
  const result = await runBin(cryptoBin(), ["prove"], JSON.stringify(request));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "prove failed");
  }
  return JSON.parse(result.stdout) as { proof: EligibilityProof; bid_nonce: string };
}

export async function noteNullifier(note: unknown): Promise<string> {
  const result = await runBin(cryptoBin(), ["nullifier"], JSON.stringify({ note }));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "nullifier failed");
  }
  return String((JSON.parse(result.stdout) as { nullifier: string | number }).nullifier);
}

export async function accumulatorRoot(nullifiers: string[]): Promise<{ root: string; nullifiers: string[] }> {
  const result = await runBin(cryptoBin(), ["acc-root"], JSON.stringify({ nullifiers }));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "acc-root failed");
  }
  return JSON.parse(result.stdout) as { root: string; nullifiers: number[] };
}

export async function splitBid(auctionId: string, bidAmount: number, bidNonce: string): Promise<BidShare[]> {
  const result = await runBin(
    mpcBin(),
    ["split"],
    JSON.stringify({ auction_id: auctionId, bid_amount: bidAmount, bid_nonce: bidNonce }),
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "split failed");
  }
  return JSON.parse(result.stdout) as BidShare[];
}

export async function argmaxBids(bids: ArgmaxBid[]): Promise<{ winner_bid_id: string }> {
  const result = await runBin(mpcBin(), ["argmax"], JSON.stringify({ bids }));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "argmax failed");
  }
  return JSON.parse(result.stdout) as { winner_bid_id: string };
}

function runBin(bin: string, args: string[], stdin: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
