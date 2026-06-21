import { mulberry32 } from '../../core/rng';

export const SPEED_MULTIPLIERS = [1, 1.25, 1.5, 1.75] as const;
export const PROCESSOR_COUNT = SPEED_MULTIPLIERS.length;

export interface SchedulingParams {

  taskCount: number;
  timeMin: number;
  timeMax: number;

  mutationGenes: number;

  maxStaleIterations: number;

  seed?: number;
}

export interface SchedulingHistoryPoint {
  readonly generation: number;
  readonly makespan: number;
}

export interface SchedulingState {
  readonly generation: number;
  readonly staleCount: number;

  readonly assignment: Uint8Array;

  readonly makespan: number;

  readonly loads: number[];
}

export interface SchedulingSnapshot {
  readonly assignment: Uint8Array;
  readonly loads: number[];
  readonly makespan: number;
}

export interface SchedulingImprovement {
  readonly attempt: number;
  readonly generation: number;
  readonly makespanBefore: number;
  readonly makespanAfter: number;
  readonly gain: number;
}

function randInRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function generateTasks(
  params: SchedulingParams,
  rng: () => number,
): number[] {
  const tasks: number[] = [];
  for (let i = 0; i < params.taskCount; i++) {
    tasks.push(randInRange(rng, params.timeMin, params.timeMax));
  }
  return tasks;
}

export function computeLoads(
  assignment: Uint8Array,
  tasks: readonly number[],
): number[] {
  const loads = new Array<number>(PROCESSOR_COUNT).fill(0);
  for (let i = 0; i < assignment.length; i++) {
    const p = assignment[i];
    loads[p] += tasks[i] * SPEED_MULTIPLIERS[p];
  }
  return loads;
}

export function makespanOf(loads: readonly number[]): number {
  let max = 0;
  for (const l of loads) if (l > max) max = l;
  return max;
}

export function mutate(
  assignment: Uint8Array,
  k: number,
  rng: () => number,
): Uint8Array {
  const child = assignment.slice();
  const n = child.length;
  const flips = Math.min(k, n);
  const chosen = new Set<number>();
  while (chosen.size < flips) {
    const idx = Math.floor(rng() * n);
    if (chosen.has(idx)) continue;
    chosen.add(idx);

    const current = child[idx];
    let next = Math.floor(rng() * (PROCESSOR_COUNT - 1));
    if (next >= current) next++;
    child[idx] = next;
  }
  return child;
}

export class SchedulingEngine {
  readonly tasks: readonly number[];

  private readonly rng: () => number;
  private readonly params: SchedulingParams;

  private parent: Uint8Array;
  private parentLoads: number[];
  private parentMakespan: number;
  private generationCount = 0;
  private staleCount = 0;
  private readonly historyPoints: SchedulingHistoryPoint[] = [];
  private readonly improvementLog: SchedulingImprovement[] = [];

  readonly initial: SchedulingSnapshot;

  constructor(params: SchedulingParams, tasks?: readonly number[]) {
    this.params = params;
    this.rng = mulberry32(params.seed ?? (Date.now() >>> 0));
    this.tasks = tasks ?? generateTasks(params, this.rng);

    this.parent = new Uint8Array(this.tasks.length);
    for (let i = 0; i < this.parent.length; i++) {
      this.parent[i] = Math.floor(this.rng() * PROCESSOR_COUNT);
    }
    this.parentLoads = computeLoads(this.parent, this.tasks);
    this.parentMakespan = makespanOf(this.parentLoads);
    this.initial = {
      assignment: this.parent.slice(),
      loads: this.parentLoads.slice(),
      makespan: this.parentMakespan,
    };
    this.historyPoints.push({ generation: 0, makespan: this.parentMakespan });
  }

  step(): SchedulingState {
    const child = mutate(this.parent, this.params.mutationGenes, this.rng);
    const childLoads = computeLoads(child, this.tasks);
    const childMakespan = makespanOf(childLoads);
    this.generationCount++;

    if (childMakespan < this.parentMakespan) {
      const before = this.parentMakespan;
      this.parent = child;
      this.parentLoads = childLoads;
      this.parentMakespan = childMakespan;
      this.staleCount = 0;
      this.historyPoints.push({
        generation: this.generationCount,
        makespan: childMakespan,
      });
      this.improvementLog.push({
        attempt: this.improvementLog.length + 1,
        generation: this.generationCount,
        makespanBefore: before,
        makespanAfter: childMakespan,
        gain: before - childMakespan,
      });
    } else {
      this.staleCount++;
    }
    return this.state();
  }

  isDone(): boolean {
    return this.staleCount >= this.params.maxStaleIterations;
  }

  state(): SchedulingState {
    return {
      generation: this.generationCount,
      staleCount: this.staleCount,
      assignment: this.parent.slice(),
      makespan: this.parentMakespan,
      loads: this.parentLoads.slice(),
    };
  }

  history(): SchedulingHistoryPoint[] {
    return this.historyPoints.slice();
  }

  improvements(): SchedulingImprovement[] {
    return this.improvementLog.slice();
  }
}
