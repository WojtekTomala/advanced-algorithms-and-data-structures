import { mulberry32 } from '../../core/rng';

export interface Candle {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SomParams {
  width: number;
  height: number;

  eta: number;

  neighborH: number;

  epochs: number;
  seed?: number;
}

export type Vec3 = [number, number, number];

export interface SomHistoryPoint {
  readonly epoch: number;
  readonly error: number;
}

export function candleToFeatures(c: Candle): Vec3 {
  const range = c.high - c.low;
  if (range <= 0) return [0, 1, 0];
  const upper = (c.high - Math.max(c.open, c.close)) / range;
  const body = Math.abs(c.close - c.open) / range;
  const lower = (Math.min(c.open, c.close) - c.low) / range;
  return [upper, body, lower];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [v[0], v[1], v[2]];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function response(weights: Vec3, input: Vec3): number {
  return weights[0] * input[0] + weights[1] * input[1] + weights[2] * input[2];
}

export function parseOhlcCsv(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx('date');
  const iOpen = idx('open');
  const iHigh = idx('high');
  const iLow = idx('low');
  const iClose = idx('close');
  if (iOpen < 0 || iHigh < 0 || iLow < 0 || iClose < 0) return [];

  const out: Candle[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(',');
    const open = parseFloat(cols[iOpen]);
    const high = parseFloat(cols[iHigh]);
    const low = parseFloat(cols[iLow]);
    const close = parseFloat(cols[iClose]);
    if ([open, high, low, close].some((v) => !Number.isFinite(v))) continue;
    out.push({
      date: iDate >= 0 ? cols[iDate]?.trim() : undefined,
      open,
      high,
      low,
      close,
    });
  }
  return out;
}

export const CANONICAL_TEST_CANDLES: ReadonlyArray<{ label: string; candle: Candle }> = [
  { label: 'Młot (długi dolny knot)', candle: { open: 90, high: 92, low: 70, close: 91 } },
  { label: 'Spadająca gwiazda (górny knot)', candle: { open: 81, high: 100, low: 80, close: 82 } },
  { label: 'Długi korpus byczy', candle: { open: 72, high: 91, low: 71, close: 90 } },
  { label: 'Długi korpus niedźwiedzi', candle: { open: 90, high: 91, low: 71, close: 72 } },
  { label: 'Doji (brak korpusu)', candle: { open: 85, high: 95, low: 75, close: 85.2 } },
];

export class SomNetwork {
  readonly width: number;
  readonly height: number;

  private grid: Vec3[];
  private readonly inputs: Vec3[];
  private readonly rng: () => number;
  private readonly params: SomParams;

  private epochCount = 0;
  private readonly historyPoints: SomHistoryPoint[] = [];

  constructor(params: SomParams, candles: readonly Candle[]) {
    this.params = params;
    this.width = params.width;
    this.height = params.height;
    this.rng = mulberry32(params.seed ?? (Date.now() >>> 0));

    this.inputs = candles.map((c) => normalize(candleToFeatures(c)));

    this.grid = [];
    for (let i = 0; i < this.width * this.height; i++) {
      this.grid.push(normalize([this.rng(), this.rng(), this.rng()]));
    }
    this.historyPoints.push({ epoch: 0, error: this.quantizationError() });
  }

  winnerOf(input: Vec3): number {
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < this.grid.length; i++) {
      const r = response(this.grid[i], input);
      if (r > bestVal) {
        bestVal = r;
        best = i;
      }
    }
    return best;
  }

  private neighbors(index: number): number[] {
    const x = index % this.width;
    const y = Math.floor(index / this.width);
    const w = this.width;
    const h = this.height;
    const left = ((x - 1 + w) % w) + y * w;
    const right = ((x + 1) % w) + y * w;
    const up = x + ((y - 1 + h) % h) * w;
    const down = x + ((y + 1) % h) * w;
    return [left, right, up, down];
  }

  private learn(index: number, input: Vec3, rate: number): void {
    const w = this.grid[index];
    const nw: Vec3 = [
      w[0] + rate * (input[0] - w[0]),
      w[1] + rate * (input[1] - w[1]),
      w[2] + rate * (input[2] - w[2]),
    ];
    this.grid[index] = normalize(nw);
  }

  step(): void {
    if (!this.inputs.length) {
      this.epochCount++;
      return;
    }
    const input = this.inputs[Math.floor(this.rng() * this.inputs.length)];
    const winner = this.winnerOf(input);

    this.learn(winner, input, this.params.eta);
    const rate = this.params.eta * this.params.neighborH;
    for (const n of this.neighbors(winner)) this.learn(n, input, rate);

    this.epochCount++;

    if (this.epochCount % Math.max(1, Math.round(this.grid.length / 4)) === 0) {
      this.historyPoints.push({ epoch: this.epochCount, error: this.quantizationError() });
    }
  }

  quantizationError(): number {
    if (!this.inputs.length) return 0;
    let sum = 0;
    for (const input of this.inputs) {
      const w = this.grid[this.winnerOf(input)];
      sum += 1 - response(w, input);
    }
    return sum / this.inputs.length;
  }

  hitCounts(): number[] {
    const counts = new Array<number>(this.grid.length).fill(0);
    for (const input of this.inputs) counts[this.winnerOf(input)]++;
    return counts;
  }

  isDone(): boolean {
    return this.epochCount >= this.params.epochs;
  }

  get epoch(): number {
    return this.epochCount;
  }

  weights(): Vec3[] {
    return this.grid.map((w) => [w[0], w[1], w[2]] as Vec3);
  }

  history(): SomHistoryPoint[] {
    return this.historyPoints.slice();
  }
}
