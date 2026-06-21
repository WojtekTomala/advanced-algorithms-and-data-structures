import {
  TspParams,
  TspRun,
  generateCostMatrix,
  makeRng,
  mutate,
  swapAdjacent,
  tourCost,
} from './tsp-algorithm';
import { mulberry32 } from '../../core/rng';

const baseParams: TspParams = {
  cityCount: 30,
  costMin: 10,
  costMax: 90,
  mutationGenes: 1,
  maxStaleIterations: 300,
  runs: 1,
  seed: 2024,
};

describe('generateCostMatrix', () => {
  it('is N×N, in range, with zero diagonal', () => {
    const m = generateCostMatrix(baseParams, mulberry32(1));
    expect(m).toHaveLength(baseParams.cityCount);
    for (let i = 0; i < m.length; i++) {
      expect(m[i]).toHaveLength(baseParams.cityCount);
      expect(m[i][i]).toBe(0);
      for (let j = 0; j < m.length; j++) {
        if (i !== j) {
          expect(m[i][j]).toBeGreaterThanOrEqual(baseParams.costMin);
          expect(m[i][j]).toBeLessThan(baseParams.costMax);
        }
      }
    }
  });

  it('is asymmetric (exists i,j with cost[i][j] != cost[j][i])', () => {
    const m = generateCostMatrix(baseParams, mulberry32(5));
    let asymmetric = false;
    for (let i = 0; i < m.length && !asymmetric; i++) {
      for (let j = 0; j < m.length; j++) {
        if (i !== j && m[i][j] !== m[j][i]) {
          asymmetric = true;
          break;
        }
      }
    }
    expect(asymmetric).toBe(true);
  });
});

describe('tourCost', () => {
  it('sums consecutive edges of an open path', () => {
    const cost = [
      [0, 5, 9],
      [7, 0, 2],
      [4, 3, 0],
    ];

    expect(tourCost(Uint8Array.from([0, 2, 1]), cost)).toBe(12);
  });
});

describe('swapAdjacent', () => {
  it('swaps positions i and i+1, original intact', () => {
    const t = Uint8Array.from([1, 2, 3, 4]);
    const c = swapAdjacent(t, 1);
    expect([...c]).toEqual([1, 3, 2, 4]);
    expect([...t]).toEqual([1, 2, 3, 4]);
  });

  it('wraps around at the last position (N-1 with 0)', () => {
    const t = Uint8Array.from([1, 2, 3, 4]);
    const c = swapAdjacent(t, 3);
    expect([...c]).toEqual([4, 2, 3, 1]);
  });
});

describe('mutate', () => {
  it('returns the swapped positions and keeps a valid permutation', () => {
    const rng = mulberry32(11);
    const t = Uint8Array.from([0, 1, 2, 3, 4]);
    const { child, i, j } = mutate(t, 1, rng);
    expect(j).toBe((i + 1) % t.length);
    expect([...child].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('TspRun', () => {
  it('never increases cost across steps (1+1 monotonicity)', () => {
    const rng = makeRng(baseParams.seed);
    const cost = generateCostMatrix(baseParams, rng);
    const run = new TspRun(baseParams, cost, rng, 1);
    let prev = Infinity;
    for (let s = 0; s < 1000; s++) {
      run.step();
      const c = run.state().cost;
      expect(c).toBeLessThanOrEqual(prev + 1e-9);
      prev = c;
    }
  });

  it('accepted mutations strictly reduce cost', () => {
    const rng = makeRng(baseParams.seed);
    const cost = generateCostMatrix(baseParams, rng);
    const run = new TspRun(baseParams, cost, rng, 1);
    for (let s = 0; s < 1000; s++) {
      const m = run.step();
      if (m) {
        expect(m.costAfter).toBeLessThan(m.costBefore);
        expect(m.gain).toBeCloseTo(m.costBefore - m.costAfter, 9);
      }
    }
  });

  it('improves over the random start', () => {
    const rng = makeRng(baseParams.seed);
    const cost = generateCostMatrix(baseParams, rng);
    const run = new TspRun(baseParams, cost, rng, 1);
    const start = run.state().cost;
    for (let s = 0; s < 3000; s++) run.step();
    expect(run.state().cost).toBeLessThan(start);
  });

  it('signals isDone() after maxStaleIterations', () => {
    const rng = makeRng(baseParams.seed);
    const cost = generateCostMatrix(baseParams, rng);
    const run = new TspRun({ ...baseParams, maxStaleIterations: 50 }, cost, rng, 1);
    let guard = 0;
    while (!run.isDone() && guard < 1_000_000) {
      run.step();
      guard++;
    }
    expect(run.isDone()).toBe(true);
  });

  it('is reproducible for a fixed seed', () => {
    const rngA = makeRng(baseParams.seed);
    const costA = generateCostMatrix(baseParams, rngA);
    const a = new TspRun(baseParams, costA, rngA, 1);

    const rngB = makeRng(baseParams.seed);
    const costB = generateCostMatrix(baseParams, rngB);
    const b = new TspRun(baseParams, costB, rngB, 1);

    for (let s = 0; s < 500; s++) {
      a.step();
      b.step();
    }
    expect([...a.state().tour]).toEqual([...b.state().tour]);
    expect(a.state().cost).toBeCloseTo(b.state().cost, 9);
  });
});
