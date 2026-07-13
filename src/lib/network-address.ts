import { isIP } from "node:net";

function blockedIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224;
}

function ipv6Words(input: string): number[] | null {
  let ip = input.toLowerCase().split("%")[0];
  const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    if (blockedIpv4(dotted) && isIP(dotted) !== 4) return null;
    const b = dotted.split(".").map(Number);
    ip = ip.slice(0, -dotted.length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const words = [...left, ...Array(fill).fill("0"), ...right].map((part) => /^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : -1);
  return words.length === 8 && words.every((n) => n >= 0) ? words : null;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip.split("%")[0]);
  if (version === 4) return blockedIpv4(ip);
  if (version !== 6) return true;
  const w = ipv6Words(ip);
  if (!w) return true;
  if (w.every((n) => n === 0) || w.slice(0, 7).every((n) => n === 0) && w[7] === 1) return true;
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return true;
  if (w.slice(0, 5).every((n) => n === 0) && w[5] === 0xffff) {
    return blockedIpv4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h === "localhost.localdomain") return true;
  return isIP(h) ? isBlockedIp(h) : false;
}
