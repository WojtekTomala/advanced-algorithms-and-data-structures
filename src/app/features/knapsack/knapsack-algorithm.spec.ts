import {
  KnapsackEngine,
  KnapsackParams,
  capacityOf,
  evaluate,
  generateItems,
  mulberry32,
  mutate,
  type KnapsackItem,
} from './knapsack-algorithm';

const baseParams: KnapsackParams = {
  itemCount: 50,
  valueMin: 10,
  valueMax: 90,
  weightMin: 10,
  weightMax: 90,
  capacityRatio: 0.5,
  mutationGenes: 1,
  maxStaleIterations: 200,
  seed: 12345,
};

describe('generateItems', () => {
  it('returns itemCount items within the given ranges', () => {
    const rng = mulberry32(1);
    const items = generateItems(baseParams, rng);
    expect(items).toHaveLength(baseParams.itemCount);
    for (const it of items) {
      expect(it.value).toBeGreaterThanOrEqual(baseParams.valueMin);
      expect(it.value).toBeLessThan(baseParams.valueMax);
      expect(it.weight).toBeGreaterThanOrEqual(baseParams.weightMin);
      expect(it.weight).toBeLessThan(baseParams.weightMax);
    }
  });
});

describe('evaluate', () => {
  const items: KnapsackItem[] = [
    { value: 60, weight: 10 },
    { value: 100, weight: 20 },
    { value: 120, weight: 30 },
  ];

  it('sums values when within capacity (feasible)', () => {
    const genome = Uint8Array.from([1, 1, 0]);
    const res = evaluate(genome, items, 50);
    expect(res.feasible).toBe(true);
    expect(res.value).toBe(160);
    expect(res.fitness).toBe(160);
  });

  it('penalizes overweight solutions below any feasible one', () => {
    const all = Uint8Array.from([1, 1, 1]);
    const overweight = evaluate(all, items, 50);
    expect(overweight.feasible).toBe(false);

    const feasible = evaluate(Uint8Array.from([1, 1, 0]), items, 50);
    expect(overweight.fitness).toBeLessThan(feasible.fitness);
  });
});

describe('mutate', () => {
  it('flips exactly k bits and does not mutate the original', () => {
    const rng = mulberry32(7);
    const original = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]);
    const child = mutate(original, 3, rng);

    let diff = 0;
    for (let i = 0; i < original.length; i++) if (original[i] !== child[i]) diff++;
    expect(diff).toBe(3);
    expect([...original]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('KnapsackEngine', () => {
  it('never decreases the best feasible value across steps (1+1 monotonicity)', () => {
    const engine = new KnapsackEngine(baseParams);
    let prev = -Infinity;
    for (let i = 0; i < 500; i++) {
      const state = engine.step();
      const reported = state.feasible ? state.bestValue : 0;
      expect(reported).toBeGreaterThanOrEqual(prev);
      prev = reported;
    }
  });

  it('keeps the final solution within capacity', () => {
    const engine = new KnapsackEngine(baseParams);
    for (let i = 0; i < 1000; i++) engine.step();
    const state = engine.state();
    expect(state.bestWeight).toBeLessThanOrEqual(state.capacity);
    expect(state.feasible).toBe(true);
  });

  it('signals isDone() after maxStaleIterations consecutive failures', () => {
    const engine = new KnapsackEngine({ ...baseParams, maxStaleIterations: 50 });
    let guard = 0;
    while (!engine.isDone() && guard < 1_000_000) {
      engine.step();
      guard++;
    }
    expect(engine.isDone()).toBe(true);
  });

  it('is reproducible for a fixed seed', () => {
    const a = new KnapsackEngine(baseParams);
    const b = new KnapsackEngine(baseParams);
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect([...a.state().genome]).toEqual([...b.state().genome]);
  });
});

describe('capacityOf', () => {
  it('returns ratio * total weight', () => {
    const items: KnapsackItem[] = [
      { value: 1, weight: 10 },
      { value: 1, weight: 30 },
    ];
    expect(capacityOf(items, 0.5)).toBe(20);
  });
});
