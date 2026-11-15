// Small deterministic PRNG (mulberry32) so server and client build the same map from a seed.
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  weighted<T>(items: readonly T[], w: (t: T) => number): T {
    let total = 0;
    for (const i of items) total += w(i);
    let r = this.next() * total;
    for (const i of items) { r -= w(i); if (r <= 0) return i; }
    return items[items.length - 1];
  }
}
