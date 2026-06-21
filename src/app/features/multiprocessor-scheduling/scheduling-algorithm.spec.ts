import {
  PROCESSOR_COUNT,
  SPEED_MULTIPLIERS,
  SchedulingEngine,
  SchedulingParams,
  computeLoads,
  generateTasks,
  makespanOf,
  mutate,
} from './scheduling-algorithm';
import { mulberry32 } from '../../core/rng';

const baseParams: SchedulingParams = {
  taskCount: 60,
  timeMin: 10,
  timeMax: 90,
  mutationGenes: 1,
  maxStaleIterations: 300,
  seed: 4242,
};

describe('generateTasks', () => {
  it('returns taskCount times within range', () => {
    const tasks = generateTasks(baseParams, mulberry32(1));
    expect(tasks).toHaveLength(baseParams.taskCount);
    for (const t of tasks) {
      expect(t).toBeGreaterThanOrEqual(baseParams.timeMin);
      expect(t).toBeLessThan(baseParams.timeMax);
    }
  });
});

describe('computeLoads / makespanOf', () => {
  it('sums task times weighted by processor multiplier', () => {
    const tasks = [10, 20, 40];
    const assignment = Uint8Array.from([0, 1, 0]);
    const loads = computeLoads(assignment, tasks);

    expect(loads).toEqual([50, 25, 0, 0]);
    expect(makespanOf(loads)).toBe(50);
  });

  it('has one load entry per processor', () => {
    const loads = computeLoads(Uint8Array.from([0, 1, 2, 3]), [1, 1, 1, 1]);
    expect(loads).toHaveLength(PROCESSOR_COUNT);
  });
});

describe('mutate', () => {
  it('changes exactly k cells, always to a different processor, original intact', () => {
    const rng = mulberry32(9);
    const original = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]);
    const child = mutate(original, 3, rng);

    let changed = 0;
    for (let i = 0; i < original.length; i++) {
      if (child[i] !== original[i]) {
        changed++;
        expect(child[i]).toBeLessThan(PROCESSOR_COUNT);
      }
    }
    expect(changed).toBe(3);
    expect([...original]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('never assigns the same processor it had (single cell)', () => {
    const rng = mulberry32(3);
    for (let trial = 0; trial < 50; trial++) {
      const a = Uint8Array.from([2]);
      const child = mutate(a, 1, rng);
      expect(child[0]).not.toBe(2);
      expect(child[0]).toBeLessThan(PROCESSOR_COUNT);
    }
  });
});

describe('SchedulingEngine', () => {
  it('never increases makespan across steps (1+1 monotonicity)', () => {
    const engine = new SchedulingEngine(baseParams);
    let prev = Infinity;
    for (let i = 0; i < 500; i++) {
      const state = engine.step();
      expect(state.makespan).toBeLessThanOrEqual(prev);
      prev = state.makespan;
    }
  });

  it('improves makespan compared to the random start', () => {
    const engine = new SchedulingEngine(baseParams);
    const start = engine.state().makespan;
    for (let i = 0; i < 2000; i++) engine.step();
    expect(engine.state().makespan).toBeLessThan(start);
  });

  it('multipliers match the spec', () => {
    expect([...SPEED_MULTIPLIERS]).toEqual([1, 1.25, 1.5, 1.75]);
  });

  it('signals isDone() after maxStaleIterations', () => {
    const engine = new SchedulingEngine({ ...baseParams, maxStaleIterations: 50 });
    let guard = 0;
    while (!engine.isDone() && guard < 1_000_000) {
      engine.step();
      guard++;
    }
    expect(engine.isDone()).toBe(true);
  });

  it('is reproducible for a fixed seed', () => {
    const a = new SchedulingEngine(baseParams);
    const b = new SchedulingEngine(baseParams);
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect([...a.state().assignment]).toEqual([...b.state().assignment]);
    expect(a.state().makespan).toBe(b.state().makespan);
  });
});
