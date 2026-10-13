export type ZcashStatus = {
  ok: boolean;
  chain?: string;
  blocks?: number;
  source?: string;
  canSend?: boolean;
  error?: string;
};

export const TESTNET_EXPLORER = "https://api.testnet.cipherscan.app/api";
export const MAINNET_EXPLORER = "https://api.mainnet.cipherscan.app/api";

export type ZcashVerify = { ok: true } | { ok: false; error: string };

export type Zcash = {
  status(): Promise<ZcashStatus>;
  verifyShieldedSettlement(txid: string): Promise<ZcashVerify>;
  sendShielded(input: { to: string; amount: number }): Promise<{ txid: string }>;
  orchardAddress(): Promise<string>;
};

export function inspectSettlementTx(tx: unknown): ZcashVerify {
  if (!tx || typeof tx !== "object") {
    return { ok: false, error: "transaction not found" };
  }
  const row = tx as Record<string, unknown>;
  if (!isShielded(row)) {
    return { ok: false, error: "transaction is not shielded" };
  }
  const confirmations = Number(
    row.confirmations ?? (row.status === "confirmed" || row.blockHeight ? 1 : 0),
  );
  if (confirmations < 1) {
    return { ok: false, error: "transaction is unconfirmed" };
  }
  return { ok: true };
}

function isShielded(tx: Record<string, unknown>) {
  if (tx.hasOrchard === true || Number(tx.orchardActions ?? 0) > 0) {
    return true;
  }
  if (tx.hasSapling === true || Number(tx.saplingOutputCount ?? 0) > 0 || Number(tx.saplingSpendCount ?? 0) > 0) {
    return true;
  }
  const orchard = tx.orchard;
  if (orchard && typeof orchard === "object") {
    const actions = (orchard as { actions?: unknown[] }).actions;
    if (Array.isArray(actions) && actions.length > 0) {
      return true;
    }
    if ("flags" in orchard || "valueBalance" in orchard) {
      return true;
    }
  }
  return (
    (Array.isArray(tx.vShieldedOutput) && tx.vShieldedOutput.length > 0) ||
    (Array.isArray(tx.vShieldedSpend) && tx.vShieldedSpend.length > 0)
  );
}

export function zcashFromEnv(): Zcash {
  const network = process.env.ZCASH_NETWORK ?? "testnet";
  const explorer = new ExplorerZcash(network === "mainnet" ? MAINNET_EXPLORER : TESTNET_EXPLORER, network);
  const rpc = new RpcZcash({
    url: process.env.ZCASH_RPC_URL ?? "http://127.0.0.1:18232",
    user: process.env.ZCASH_RPC_USER ?? "veil",
    password: process.env.ZCASH_RPC_PASSWORD ?? "veil-regtest",
  });
  return new CompositeZcash(rpc, explorer);
}

export class ExplorerZcash implements Zcash {
  constructor(
    private readonly base = TESTNET_EXPLORER,
    private readonly chain = "testnet",
  ) {}

  async status(): Promise<ZcashStatus> {
    try {
      const res = await fetch(`${this.base}/network/health`, { signal: AbortSignal.timeout(8000) });
      const body = (await res.json()) as { success?: boolean; zebra?: { healthy?: boolean } };
      if (!res.ok || !body.success) {
        return { ok: false, chain: this.chain, source: "explorer", canSend: false, error: "explorer unhealthy" };
      }
      return { ok: true, chain: this.chain, source: "explorer", canSend: false };
    } catch (err) {
      return {
        ok: false,
        chain: this.chain,
        source: "explorer",
        canSend: false,
        error: err instanceof Error ? err.message : "explorer unavailable",
      };
    }
  }

  async verifyShieldedSettlement(txid: string): Promise<ZcashVerify> {
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
      return { ok: false, error: "txid must be a 64-character hex Zcash transaction id" };
    }
    try {
      const res = await fetch(`${this.base}/tx/${txid}`, { signal: AbortSignal.timeout(12000) });
      if (res.status === 404) {
        return { ok: false, error: "transaction not found on Zcash testnet" };
      }
      const tx = await res.json();
      return inspectSettlementTx(tx);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "testnet lookup failed" };
    }
  }

  async sendShielded(): Promise<{ txid: string }> {
    throw new Error("Sending needs a local Zcash wallet. Paste a testnet shielded txid to settle.");
  }

  async orchardAddress(): Promise<string> {
    throw new Error("Orchard addresses need a local Zcash wallet");
  }
}

export class CompositeZcash implements Zcash {
  constructor(
    private readonly rpc: Zcash,
    private readonly explorer: Zcash,
  ) {}

  async status(): Promise<ZcashStatus> {
    const local = await this.rpc.status();
    if (local.ok) {
      return { ...local, source: local.source ?? "rpc", canSend: true };
    }
    return this.explorer.status();
  }

  async verifyShieldedSettlement(txid: string): Promise<ZcashVerify> {
    const local = await this.rpc.status();
    if (local.ok) {
      return this.rpc.verifyShieldedSettlement(txid);
    }
    return this.explorer.verifyShieldedSettlement(txid);
  }

  sendShielded(input: { to: string; amount: number }) {
    return this.rpc.sendShielded(input);
  }

  orchardAddress() {
    return this.rpc.orchardAddress();
  }
}

export class RpcZcash implements Zcash {
  constructor(
    private readonly cfg: { url: string; user: string; password: string },
  ) {}

  async status(): Promise<ZcashStatus> {
    try {
      const info = (await this.rpc("getblockchaininfo")) as { chain?: string; blocks?: number };
      return { ok: true, chain: info.chain, blocks: info.blocks };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "zcash rpc unavailable" };
    }
  }

  async verifyShieldedSettlement(txid: string): Promise<ZcashVerify> {
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
      return { ok: false, error: "txid must be a 64-character hex Zcash transaction id" };
    }
    try {
      const tx = await this.rpc("getrawtransaction", [txid, 1]);
      return inspectSettlementTx(tx);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "zcash lookup failed" };
    }
  }

  async orchardAddress(): Promise<string> {
    const accounts = (await this.rpc("z_listaccounts").catch(() => [])) as { account?: number }[];
    const account = accounts[0]?.account ?? ((await this.rpc("z_getnewaccount")) as { account: number }).account;
    const ua = (await this.rpc("z_getaddressforaccount", [account, ["orchard"]])) as { address: string };
    return ua.address;
  }

  async sendShielded(input: { to: string; amount: number }): Promise<{ txid: string }> {
    if (!input.to || !(input.amount > 0)) {
      throw new Error("to and amount are required");
    }
    const from = await this.orchardAddress();
    await this.ensureSpendable(from);
    let opid: string;
    try {
      opid = (await this.rpc("z_sendmany", [
        from,
        [{ address: input.to, amount: input.amount }],
        1,
        0,
      ])) as string;
    } catch {
      opid = (await this.rpc("z_sendmany", [
        from,
        [{ address: input.to, amount: input.amount }],
        1,
        0,
        "AllowRevealedSenders",
      ])) as string;
    }
    const txid = await this.waitOp(opid);
    await this.rpc("generate", [1]).catch(async () => {
      await this.rpc("generatetoaddress", [1, from]);
    });
    return { txid };
  }

  private async ensureSpendable(address: string) {
    const info = (await this.rpc("getblockchaininfo")) as { blocks?: number };
    if ((info.blocks ?? 0) < 101) {
      await this.rpc("generate", [101]).catch(async () => {
        await this.rpc("generatetoaddress", [101, address]);
      });
    }
    const opid = (await this.rpc("z_shieldcoinbase", ["*", address, 0, 0]).catch(() => null)) as string | null;
    if (opid) {
      await this.waitOp(opid).catch(() => undefined);
      await this.rpc("generate", [1]).catch(async () => {
        await this.rpc("generatetoaddress", [1, address]);
      });
    }
  }

  private async waitOp(opid: string) {
    for (let i = 0; i < 40; i += 1) {
      const rows = (await this.rpc("z_getoperationresult", [[opid]])) as {
        status?: string;
        result?: { txid?: string };
        error?: { message?: string };
      }[];
      const row = rows?.[0];
      if (row?.status === "success" && row.result?.txid) {
        return row.result.txid;
      }
      if (row?.status === "failed") {
        throw new Error(row.error?.message ?? "zcash send failed");
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("zcash send timed out");
  }

  private async rpc(method: string, params: unknown[] = []) {
    const auth = Buffer.from(`${this.cfg.user}:${this.cfg.password}`).toString("base64");
    const res = await fetch(this.cfg.url, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "veil", method, params }),
      signal: AbortSignal.timeout(1500),
    });
    const body = (await res.json().catch(() => ({}))) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      throw new Error(body.error?.message ?? `zcash rpc ${method} failed (${res.status})`);
    }
    return body.result;
  }
}
