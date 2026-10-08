import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { EligibilityProof } from "./types.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function cryptoBin(): string {
  return process.env.VEIL_CRYPTO_BIN ?? path.join(repoRoot, "target", "debug", "veil-crypto");
}

export async function verifyProof(proof: EligibilityProof): Promise<{ valid: boolean; error?: string }> {
  const result = await runCrypto("verify", JSON.stringify(proof));
  if (result.exitCode === 0) {
    return JSON.parse(result.stdout) as { valid: boolean; error?: string };
  }
  if (result.stdout.trim()) {
    try {
      return JSON.parse(result.stdout) as { valid: boolean; error?: string };
    } catch {
      /* fall through */
    }
  }
  return { valid: false, error: result.stderr.trim() || "verify failed" };
}

export async function proveLocal(request: unknown): Promise<{ proof: EligibilityProof }> {
  const result = await runCrypto("prove", JSON.stringify(request));
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "prove failed");
  }
  return JSON.parse(result.stdout) as { proof: EligibilityProof };
}

function runCrypto(command: "prove" | "verify", stdin: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(cryptoBin(), [command], { stdio: ["pipe", "pipe", "pipe"] });
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
