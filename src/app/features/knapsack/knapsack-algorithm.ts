import { mulberry32 } from '../../core/rng';

export { mulberry32 };

export interface KnapsackItem {
  readonly value: number;
  readonly weight: number;
}

export interface KnapsackParams {

  itemCount: number;
  valueMin: number;
  valueMax: number;
  weightMin: number;
  weightMax: number;

  capacityRatio: number;

  mutationGenes: number;

  maxStaleIterations: number;

  seed?: number;
}

export interface Evaluation {
  readonly value: number;
  readonly weight: number;
  readonly feasible: boolean;

  readonly fitness: number;
}

export interface HistoryPoint {
  readonly generation: number;
  readonly value: number;
}

export interface KnapsackState {
  readonly generation: number;
  readonly staleCount: number;

  readonly genome: Uint8Array;
  readonly bestValue: number;
  readonly bestWeight: number;
  readonly selectedCount: number;
  readonly feasible: boolean;
  readonly capacity: number;
}

export interface KnapsackSnapshot {
  readonly genome: Uint8Array;
  readonly value: number;
  readonly weight: number;
  readonly selectedCount: number;
  readonly feasible: boolean;
}

export interface Improvement {
  readonly attempt: number;
  readonly generation: number;
  readonly valueBefore: number;
  readonly valueAfter: number;
  readonly gain: number;
  readonly weight: number;
  readonly selectedCount: number;
  readonly feasible: boolean;
}

function countSelected(genome: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < genome.length; i++) n += genome[i];
  return n;
}

function snapshotOf(genome: Uint8Array, ev: Evaluation): KnapsackSnapshot {
  return {
    genome: genome.slice(),
    value: ev.value,
    weight: ev.weight,
    selectedCount: countSelected(genome),
    feasible: ev.feasible,
  };
}

function randInRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function generateItems(
  params: KnapsackParams,
  rng: () => number,
): KnapsackItem[] {
  const items: KnapsackItem[] = [];
  for (let i = 0; i < params.itemCount; i++) {
    items.push({
      value: randInRange(rng, params.valueMin, params.valueMax),
      weight: randInRange(rng, params.weightMin, params.weightMax),
    });
  }
  return items;
}

export function capacityOf(items: readonly KnapsackItem[], ratio: number): number {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  return total * ratio;
}

export function evaluate(
  genome: Uint8Array,
  items: readonly KnapsackItem[],
  capacity: number,
): Evaluation {
  let value = 0;
  let weight = 0;
  let maxValue = 0;
  for (let i = 0; i < genome.length; i++) {
    if (items[i].value > maxValue) maxValue = items[i].value;
    if (genome[i]) {
      value += items[i].value;
      weight += items[i].weight;
    }
  }
  const feasible = weight <= capacity;
  const penalty = maxValue + 1;
  const fitness = feasible ? value : value - penalty * (weight - capacity);
  return { value, weight, feasible, fitness };
}

export function mutate(
  genome: Uint8Array,
  k: number,
  rng: () => number,
): Uint8Array {
  const child = genome.slice();
  const n = child.length;
  const flips = Math.min(k, n);
  const chosen = new Set<number>();
  while (chosen.size < flips) {
    const idx = Math.floor(rng() * n);
    if (chosen.has(idx)) continue;
    chosen.add(idx);
    child[idx] = child[idx] ? 0 : 1;
  }
  return child;
}

export class KnapsackEngine {
  readonly items: readonly KnapsackItem[];
  readonly capacity: number;

  private readonly rng: () => number;
  private readonly params: KnapsackParams;

  private parent: Uint8Array;
  private parentEval: Evaluation;
  private generationCount = 0;
  private staleCount = 0;
  private readonly historyPoints: HistoryPoint[] = [];
  private readonly improvementLog: Improvement[] = [];

  readonly initial: KnapsackSnapshot;

  constructor(params: KnapsackParams, items?: readonly KnapsackItem[]) {
    this.params = params;
    this.rng = mulberry32(params.seed ?? (Date.now() >>> 0));
    this.items = items ?? generateItems(params, this.rng);
    this.capacity = capacityOf(this.items, params.capacityRatio);

    this.parent = new Uint8Array(this.items.length);
    for (let i = 0; i < this.parent.length; i++) {
      this.parent[i] = this.rng() < 0.5 ? 1 : 0;
    }
    this.parentEval = evaluate(this.parent, this.items, this.capacity);
    this.initial = snapshotOf(this.parent, this.parentEval);
    this.historyPoints.push({ generation: 0, value: this.snapshotValue() });
  }

  private snapshotValue(): number {
    return this.parentEval.feasible ? this.parentEval.value : 0;
  }

  step(): KnapsackState {
    const child = mutate(this.parent, this.params.mutationGenes, this.rng);
    const childEval = evaluate(child, this.items, this.capacity);
    this.generationCount++;

    if (childEval.fitness > this.parentEval.fitness) {
      const valueBefore = this.parentEval.value;
      this.parent = child;
      this.parentEval = childEval;
      this.staleCount = 0;
      this.historyPoints.push({
        generation: this.generationCount,
        value: this.snapshotValue(),
      });
      this.improvementLog.push({
        attempt: this.improvementLog.length + 1,
        generation: this.generationCount,
        valueBefore,
        valueAfter: childEval.value,
        gain: childEval.value - valueBefore,
        weight: childEval.weight,
        selectedCount: countSelected(child),
        feasible: childEval.feasible,
      });
    } else {
      this.staleCount++;
    }
    return this.state();
  }

  isDone(): boolean {
    return this.staleCount >= this.params.maxStaleIterations;
  }

  state(): KnapsackState {
    let selectedCount = 0;
    for (let i = 0; i < this.parent.length; i++) selectedCount += this.parent[i];
    return {
      generation: this.generationCount,
      staleCount: this.staleCount,
      genome: this.parent.slice(),
      bestValue: this.parentEval.value,
      bestWeight: this.parentEval.weight,
      selectedCount,
      feasible: this.parentEval.feasible,
      capacity: this.capacity,
    };
  }

  history(): HistoryPoint[] {
    return this.historyPoints.slice();
  }

  improvements(): Improvement[] {
    return this.improvementLog.slice();
  }
}
