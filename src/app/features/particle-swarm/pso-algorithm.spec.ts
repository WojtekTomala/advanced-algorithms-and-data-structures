import {
  PsoParams,
  PsoSwarm,
  TWO_PI,
  objective,
  sampleField,
} from './pso-algorithm';

const baseParams: PsoParams = {
  particleCount: 80,
  velocity: 0.02,
  randomness: 0.2,
  maxStaleIterations: 300,
  seed: 777,
};

describe('objective', () => {
  it('equals 4 at the origin (sines=0, cosines=4)', () => {
    expect(objective(0, 0)).toBeCloseTo(4, 9);
  });

  it('stays within [0, 8] over the domain', () => {
    for (let i = 0; i <= 50; i++) {
      for (let j = 0; j <= 50; j++) {
        const v = objective((i / 50) * TWO_PI, (j / 50) * TWO_PI);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(8 + 1e-9);
      }
    }
  });
});

describe('sampleField', () => {
  it('returns cols*rows values within [0, 8]', () => {
    const field = sampleField(20, 15);
    expect(field).toHaveLength(20 * 15);
    for (const v of field) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(8 + 1e-9);
    }
  });
});

describe('PsoSwarm', () => {
  it('never decreases the global best across epochs', () => {
    const swarm = new PsoSwarm(baseParams);
    let prev = -Infinity;
    for (let i = 0; i < 500; i++) {
      const state = swarm.step();
      expect(state.gbest.value).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = state.gbest.value;
    }
  });

  it('keeps every particle inside [0, 2π]²', () => {
    const swarm = new PsoSwarm(baseParams);
    for (let i = 0; i < 300; i++) {
      const state = swarm.step();
      for (const p of state.particles) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(TWO_PI);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(TWO_PI);
      }
    }
  });

  it('improves the global best over the initial swarm', () => {
    const swarm = new PsoSwarm(baseParams);
    const start = swarm.state().gbest.value;
    for (let i = 0; i < 2000; i++) swarm.step();
    expect(swarm.state().gbest.value).toBeGreaterThan(start);
  });

  it('signals isDone() after maxStaleIterations', () => {
    const swarm = new PsoSwarm({ ...baseParams, maxStaleIterations: 40 });
    let guard = 0;
    while (!swarm.isDone() && guard < 1_000_000) {
      swarm.step();
      guard++;
    }
    expect(swarm.isDone()).toBe(true);
  });

  it('is reproducible for a fixed seed', () => {
    const a = new PsoSwarm(baseParams);
    const b = new PsoSwarm(baseParams);
    for (let i = 0; i < 400; i++) {
      a.step();
      b.step();
    }
    expect(a.state().gbest.value).toBeCloseTo(b.state().gbest.value, 9);
    expect(a.state().gbest.x).toBeCloseTo(b.state().gbest.x, 9);
  });
});
