import {
  Candle,
  SomNetwork,
  SomParams,
  Vec3,
  candleToFeatures,
  normalize,
  parseOhlcCsv,
  response,
} from './som-algorithm';

function makeCandles(seed: number, n: number): Candle[] {

  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const archetypes: Array<[number, number, number, number]> = [
    [1, 20, 0, 2],
    [1, 20, 0, 19],
    [18, 20, 0, 19],
    [9, 20, 0, 11],
  ];
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const [o, h, l, c] = archetypes[i % archetypes.length];
    const j = () => (rnd() - 0.5) * 0.6;
    out.push({ open: o + j(), high: h + j(), low: l + j(), close: c + j() });
  }
  return out;
}

const baseParams: SomParams = {
  width: 8,
  height: 8,
  eta: 0.05,
  neighborH: 0.5,
  epochs: 1000,
  seed: 99,
};

describe('candleToFeatures', () => {
  it('bullish candle features sum to 1', () => {
    const f = candleToFeatures({ open: 72, high: 91, low: 71, close: 90 });
    expect(f[0] + f[1] + f[2]).toBeCloseTo(1, 9);
  });

  it('bearish candle features sum to 1', () => {
    const f = candleToFeatures({ open: 90, high: 91, low: 71, close: 72 });
    expect(f[0] + f[1] + f[2]).toBeCloseTo(1, 9);
  });

  it('hammer has a dominant lower wick', () => {
    const f = candleToFeatures({ open: 90, high: 92, low: 70, close: 91 });
    expect(f[2]).toBeGreaterThan(f[0]);
    expect(f[2]).toBeGreaterThan(f[1]);
  });

  it('guards a flat candle (H == L)', () => {
    const f = candleToFeatures({ open: 50, high: 50, low: 50, close: 50 });
    expect(f.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('normalize / response', () => {
  it('normalize yields unit length', () => {
    const n = normalize([3, 0, 4]);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
  });

  it('response of identical normalized vectors is 1 and stays in [-1,1]', () => {
    const v = normalize([0.3, 0.6, 0.1]);
    expect(response(v, v)).toBeCloseTo(1, 9);
    const r = response(normalize([1, 0, 0]), normalize([0, 1, 0]));
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe('parseOhlcCsv', () => {
  it('parses Yahoo-style header', () => {
    const csv =
      'Date,Open,High,Low,Close,Adj Close,Volume\n' +
      '2023-01-02,100,105,99,104,104,1000\n' +
      '2023-01-03,104,108,103,107,107,1200\n';
    const candles = parseOhlcCsv(csv);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ open: 100, high: 105, low: 99, close: 104 });
    expect(candles[1].date).toBe('2023-01-03');
  });

  it('skips malformed rows', () => {
    const csv = 'Date,Open,High,Low,Close\n2023-01-02,abc,1,1,1\n2023-01-03,1,2,0.5,1.5\n';
    expect(parseOhlcCsv(csv)).toHaveLength(1);
  });
});

describe('SomNetwork', () => {
  it('keeps weights normalized after training', () => {
    const net = new SomNetwork(baseParams, makeCandles(1, 120));
    for (let i = 0; i < 1000; i++) net.step();
    for (const w of net.weights()) {
      expect(Math.hypot(w[0], w[1], w[2])).toBeCloseTo(1, 6);
    }
  });

  it('reduces quantization error compared to the start', () => {
    const candles = makeCandles(2, 150);
    const net = new SomNetwork(baseParams, candles);
    const startErr = net.quantizationError();
    for (let i = 0; i < 3000; i++) net.step();
    expect(net.quantizationError()).toBeLessThan(startErr);
  });

  it('neighbors wrap around at the edges (4 per neuron)', () => {
    const net = new SomNetwork({ ...baseParams, width: 4, height: 4 }, makeCandles(3, 30));

    const counts = net.hitCounts();
    expect(counts).toHaveLength(16);
  });

  it('signals isDone() after the configured epochs', () => {
    const net = new SomNetwork({ ...baseParams, epochs: 200 }, makeCandles(4, 50));
    while (!net.isDone()) net.step();
    expect(net.epoch).toBeGreaterThanOrEqual(200);
  });

  it('is reproducible for a fixed seed', () => {
    const candles = makeCandles(5, 80);
    const a = new SomNetwork(baseParams, candles);
    const b = new SomNetwork(baseParams, candles);
    for (let i = 0; i < 500; i++) {
      a.step();
      b.step();
    }
    const wa = a.weights();
    const wb = b.weights();
    expect(wa[0][0]).toBeCloseTo(wb[0][0], 9);
    expect(a.quantizationError()).toBeCloseTo(b.quantizationError(), 9);
  });
});
