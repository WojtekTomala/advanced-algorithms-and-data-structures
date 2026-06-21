import { mulberry32 } from '../../core/rng';

export const TWO_PI = 2 * Math.PI;

export function objective(x: number, y: number): number {
  const sx = Math.sin(x) + Math.sin(2 * x) + Math.sin(4 * x) + Math.sin(8 * x);
  const cy = Math.cos(y) + Math.cos(2 * y) + Math.cos(4 * y) + Math.cos(8 * y);
  return Math.abs(sx) + Math.abs(cy);
}

export function sampleField(cols: number, rows: number): Float32Array {
  const field = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = (r / (rows - 1)) * TWO_PI;
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1)) * TWO_PI;
      field[r * cols + c] = objective(x, y);
    }
  }
  return field;
}

export interface PsoParams {
  particleCount: number;

  velocity: number;

  randomness: number;

  maxStaleIterations: number;
  seed?: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
}

export interface Gbest {
  x: number;
  y: number;
  value: number;
}

export interface PsoHistoryPoint {
  readonly epoch: number;
  readonly best: number;
}

export interface PsoState {
  readonly epoch: number;
  readonly staleCount: number;
  readonly particles: Particle[];
  readonly gbest: Gbest;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class PsoSwarm {
  private readonly rng: () => number;
  private readonly params: PsoParams;

  private particles: Particle[];
  private gbest: Gbest;
  private epochCount = 0;
  private staleCount = 0;
  private readonly historyPoints: PsoHistoryPoint[] = [];

  constructor(params: PsoParams) {
    this.params = params;
    this.rng = mulberry32(params.seed ?? (Date.now() >>> 0));

    this.particles = [];
    for (let i = 0; i < params.particleCount; i++) {
      const x = this.rng() * TWO_PI;
      const y = this.rng() * TWO_PI;
      const angle = this.rng() * TWO_PI;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * params.velocity,
        vy: Math.sin(angle) * params.velocity,
        value: objective(x, y),
      });
    }
    this.gbest = this.findBest();
    this.historyPoints.push({ epoch: 0, best: this.gbest.value });
  }

  private findBest(): Gbest {
    let best = this.particles[0];
    for (const p of this.particles) if (p.value > best.value) best = p;
    return { x: best.x, y: best.y, value: best.value };
  }

  step(): PsoState {
    const { velocity, randomness } = this.params;
    const target = this.gbest;

    for (const p of this.particles) {

      let dx = target.x - p.x;
      let dy = target.y - p.y;
      let len = Math.hypot(dx, dy);
      if (len < 1e-9) {

        const a = this.rng() * TWO_PI;
        dx = Math.cos(a);
        dy = Math.sin(a);
        len = 1;
      }
      dx /= len;
      dy /= len;

      const a = this.rng() * TWO_PI;
      const mixX = (1 - randomness) * dx + randomness * Math.cos(a);
      const mixY = (1 - randomness) * dy + randomness * Math.sin(a);
      const mlen = Math.hypot(mixX, mixY) || 1;

      p.vx = (mixX / mlen) * velocity;
      p.vy = (mixY / mlen) * velocity;

      const nx = clamp(p.x + p.vx, 0, TWO_PI);
      const ny = clamp(p.y + p.vy, 0, TWO_PI);
      const nValue = objective(nx, ny);
      if (nValue > p.value) {
        p.x = nx;
        p.y = ny;
        p.value = nValue;
      }
    }

    this.epochCount++;
    const newBest = this.findBest();
    if (newBest.value > this.gbest.value + 1e-12) {
      this.gbest = newBest;
      this.staleCount = 0;
      this.historyPoints.push({ epoch: this.epochCount, best: newBest.value });
    } else {
      this.staleCount++;
    }
    return this.state();
  }

  isDone(): boolean {
    return this.staleCount >= this.params.maxStaleIterations;
  }

  state(): PsoState {
    return {
      epoch: this.epochCount,
      staleCount: this.staleCount,
      particles: this.particles.map((p) => ({ ...p })),
      gbest: { ...this.gbest },
    };
  }

  history(): PsoHistoryPoint[] {
    return this.historyPoints.slice();
  }
}
