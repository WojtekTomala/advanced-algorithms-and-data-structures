import { mulberry32 } from '../../core/rng';

export interface TspParams {

  cityCount: number;
  costMin: number;
  costMax: number;

  mutationGenes: number;

  maxStaleIterations: number;

  runs: number;

  seed?: number;
}

export interface AcceptedMutation {

  readonly run: number;
  readonly generation: number;

  readonly i: number;
  readonly j: number;
  readonly costBefore: number;
  readonly costAfter: number;
  readonly gain: number;

  readonly tour: Uint8Array;
}

export interface TspHistoryPoint {
  readonly generation: number;
  readonly cost: number;
}

export interface TspState {
  readonly generation: number;
  readonly staleCount: number;
  readonly tour: Uint8Array;
  readonly cost: number;
}

export function generateCostMatrix(
  params: TspParams,
  rng: () => number,
): number[][] {
  const n = params.cityCount;
  const span = params.costMax - params.costMin;
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      row[j] = i === j ? 0 : params.costMin + rng() * span;
    }
    matrix.push(row);
  }
  return matrix;
}

export function tourCost(tour: Uint8Array, cost: number[][]): number {
  let total = 0;
  for (let k = 0; k < tour.length - 1; k++) {
    total += cost[tour[k]][tour[k + 1]];
  }
  return total;
}

export function swapAdjacent(tour: Uint8Array, i: number): Uint8Array {
  const n = tour.length;
  const j = (i + 1) % n;
  const child = tour.slice();
  const tmp = child[i];
  child[i] = child[j];
  child[j] = tmp;
  return child;
}

export function mutate(
  tour: Uint8Array,
  k: number,
  rng: () => number,
): { child: Uint8Array; i: number; j: number } {
  let child = tour;
  let lastI = 0;
  const n = tour.length;
  const swaps = Math.max(1, k);
  for (let s = 0; s < swaps; s++) {
    lastI = Math.floor(rng() * n);
    child = swapAdjacent(child, lastI);
  }
  return { child, i: lastI, j: (lastI + 1) % n };
}

function randomPermutation(n: number, rng: () => number): Uint8Array {
  const tour = new Uint8Array(n);
  for (let i = 0; i < n; i++) tour[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const r = Math.floor(rng() * (i + 1));
    const tmp = tour[i];
    tour[i] = tour[r];
    tour[r] = tmp;
  }
  return tour;
}

export class TspRun {
  private readonly rng: () => number;
  private readonly params: TspParams;
  private readonly cost: number[][];

  readonly runIndex: number;

  private parent: Uint8Array;
  private parentCost: number;
  private generationCount = 0;
  private staleCount = 0;
  private readonly historyPoints: TspHistoryPoint[] = [];

  constructor(
    params: TspParams,
    cost: number[][],
    rng: () => number,
    runIndex: number,
  ) {
    this.params = params;
    this.cost = cost;
    this.rng = rng;
    this.runIndex = runIndex;
    this.parent = randomPermutation(params.cityCount, rng);
    this.parentCost = tourCost(this.parent, cost);
    this.historyPoints.push({ generation: 0, cost: this.parentCost });
  }

  step(): AcceptedMutation | null {
    const { child, i, j } = mutate(this.parent, this.params.mutationGenes, this.rng);
    const childCost = tourCost(child, this.cost);
    this.generationCount++;

    if (this.parentCost > childCost) {
      const before = this.parentCost;
      this.parent = child;
      this.parentCost = childCost;
      this.staleCount = 0;
      this.historyPoints.push({ generation: this.generationCount, cost: childCost });
      return {
        run: this.runIndex,
        generation: this.generationCount,
        i,
        j,
        costBefore: before,
        costAfter: childCost,
        gain: before - childCost,
        tour: child.slice(),
      };
    }
    this.staleCount++;
    return null;
  }

  isDone(): boolean {
    return this.staleCount >= this.params.maxStaleIterations;
  }

  state(): TspState {
    return {
      generation: this.generationCount,
      staleCount: this.staleCount,
      tour: this.parent.slice(),
      cost: this.parentCost,
    };
  }

  history(): TspHistoryPoint[] {
    return this.historyPoints.slice();
  }
}

export function makeRng(seed?: number): () => number {
  return mulberry32(seed ?? (Date.now() >>> 0));
}
