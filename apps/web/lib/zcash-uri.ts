import { isZcashAddress } from "./wallet";

export function zip321Uri(address: string, amount: number, memo = "") {
  const query = [`amount=${amount}`];
  if (memo) {
    query.push(`memo=${base64Url(memo)}`);
  }
  query.push(`message=${encodeURIComponent("Veil sealed-bid settlement")}`);
  return `zcash:${address}?${query.join("&")}`;
}

export function zodlReceiveDeepLink() {
  return "zcash:///home/receive";
}

export function zodlSendDeepLink(address: string, amount: number) {
  return `zcash:///home/send?address=${encodeURIComponent(address)}&amount=${amount}`;
}

export function parseZcashPayload(raw: string): string | null {
  const text = raw.trim();
  if (isZcashAddress(text)) {
    return text;
  }
  if (!text.toLowerCase().startsWith("zcash:")) {
    return null;
  }
  const rest = text.slice(text.indexOf(":") + 1);
  if (rest.startsWith("///")) {
    const params = new URLSearchParams(rest.split("?")[1] ?? "");
    const nested = params.get("address");
    return nested && isZcashAddress(nested) ? nested : null;
  }
  const [hier, query] = rest.split("?");
  if (hier && isZcashAddress(hier)) {
    return hier;
  }
  const params = new URLSearchParams(query ?? "");
  const addr = params.get("address");
  return addr && isZcashAddress(addr) ? addr : null;
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
