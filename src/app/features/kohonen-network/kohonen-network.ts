import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  NgApexchartsModule,
  ApexChart,
  ApexAxisChartSeries,
  ApexStroke,
  ApexGrid,
  ApexTooltip,
  ApexDataLabels,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';

import { AlgorithmPage } from '../../shared/algorithm-page/algorithm-page';
import {
  CANONICAL_TEST_CANDLES,
  Candle,
  SomNetwork,
  SomParams,
  SomHistoryPoint,
  Vec3,
  candleToFeatures,
  normalize,
  parseOhlcCsv,
} from './som-algorithm';

interface NeuronCell {
  index: number;
  color: string;
  hits: number;
}

interface CandleGeom {
  bodyY: number;
  bodyH: number;
}

const CANDLE_H = 120;

@Component({
  selector: 'app-kohonen-network',
  imports: [ReactiveFormsModule, NgApexchartsModule, AlgorithmPage, DecimalPipe],
  templateUrl: './kohonen-network.html',
  styleUrl: './kohonen-network.scss',
})
export class KohonenNetwork {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly candleH = CANDLE_H;
  protected readonly testCandles = CANONICAL_TEST_CANDLES;

  protected readonly form = this.fb.nonNullable.group({
    width: [12, [Validators.required, Validators.min(2), Validators.max(40)]],
    height: [12, [Validators.required, Validators.min(2), Validators.max(40)]],
    eta: [0.01, [Validators.required, Validators.min(0.0001), Validators.max(1)]],
    neighborH: [0.5, [Validators.required, Validators.min(0), Validators.max(1)]],
    epochs: [1000, [Validators.required, Validators.min(1)]],
    seed: [null as number | null],
    speed: [50, [Validators.required, Validators.min(1), Validators.max(5000)]],
  });

  protected readonly candles = signal<Candle[]>([]);
  protected readonly dataSource = signal<string>('wbudowany (KGHM ~1 rok)');

  protected readonly isRunning = signal(false);
  protected readonly isDone = signal(false);
  protected readonly epoch = signal(0);
  protected readonly quantError = signal(0);
  protected readonly mapWidth = signal(0);
  protected readonly mapHeight = signal(0);
  protected readonly cells = signal<NeuronCell[]>([]);
  protected readonly history = signal<SomHistoryPoint[]>([]);
  protected readonly selectedNeuron = signal<number | null>(null);
  protected readonly showHits = signal(false);

  protected readonly testWinners = signal<number[]>([]);

  private net: SomNetwork | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly engineInitialized = signal(false);

  constructor() {
    this.loadDefaultData();
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  protected readonly hasRun = computed(() => this.engineInitialized());

  protected readonly prototype = computed(() => {
    const idx = this.selectedNeuron();
    const cellList = this.cells();
    if (idx === null || !this.net) return null;
    const w = this.net.weights()[idx];
    if (!w) return null;
    const sum = w[0] + w[1] + w[2] || 1;
    const upper = w[0] / sum;
    const body = w[1] / sum;
    const lower = w[2] / sum;
    return {
      index: idx,
      x: idx % this.mapWidth(),
      y: Math.floor(idx / this.mapWidth()),
      upper,
      body,
      lower,
      hits: cellList[idx]?.hits ?? 0,
      geom: this.candleGeom(upper, body),
    };
  });

  protected readonly chart: ApexChart = {
    type: 'line',
    height: 300,
    foreColor: '#9aa3b2',
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: false },
  };
  protected readonly stroke: ApexStroke = { curve: 'smooth', width: 2 };
  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly grid: ApexGrid = { borderColor: '#2a3040' };
  protected readonly tooltip: ApexTooltip = { theme: 'dark' };
  protected readonly xaxis: ApexXAxis = {
    type: 'numeric',
    title: { text: 'epoka' },
    labels: { formatter: (v) => `${Math.round(Number(v))}` },
  };
  protected readonly yaxis: ApexYAxis = {
    title: { text: 'błąd kwantyzacji' },
    labels: { formatter: (v) => v.toFixed(3) },
  };
  protected readonly series = computed<ApexAxisChartSeries>(() => [
    {
      name: 'błąd',
      data: this.history().map((p) => [p.epoch, +p.error.toFixed(4)]),
    },
  ]);

  protected start(): void {
    if (this.isRunning() || this.form.invalid || !this.candles().length) return;
    if (!this.net) this.buildNetwork();
    this.isRunning.set(true);
    this.timer = setInterval(() => this.tick(), 16);
  }

  protected stop(): void {
    this.clearTimer();
    this.isRunning.set(false);
  }

  protected reset(): void {
    this.stop();
    this.net = null;
    this.engineInitialized.set(false);
    this.isDone.set(false);
    this.epoch.set(0);
    this.quantError.set(0);
    this.cells.set([]);
    this.history.set([]);
    this.selectedNeuron.set(null);
    this.testWinners.set([]);
  }

  protected reinit(): void {
    this.reset();
    this.buildNetwork();
  }

  protected toggleHits(): void {
    this.showHits.update((v) => !v);
    if (this.net) this.publish();
  }

  protected selectNeuron(index: number): void {
    this.selectedNeuron.set(index);
  }

  protected selectTest(i: number): void {
    const w = this.testWinners()[i];
    if (w !== undefined) this.selectedNeuron.set(w);
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseOhlcCsv(String(reader.result ?? ''));
      if (parsed.length) {
        this.reset();
        this.candles.set(parsed);
        this.dataSource.set(`${file.name} (${parsed.length} świec)`);
      }
    };
    reader.readAsText(file);
  }

  candleGeom(upper: number, body: number): CandleGeom {
    return {
      bodyY: upper * CANDLE_H,
      bodyH: Math.max(2, body * CANDLE_H),
    };
  }

  geomForCandle(c: Candle): CandleGeom {
    const [upper, body] = candleToFeatures(c);
    return this.candleGeom(upper, body);
  }

  private loadDefaultData(): void {
    this.http
      .get<Candle[]>('kghm-1y.json')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          if (Array.isArray(data) && data.length) this.candles.set(data);
        },
        error: () => {

          this.dataSource.set('brak danych — wgraj CSV');
        },
      });
  }

  private buildNetwork(): void {
    const params = this.readParams();
    this.net = new SomNetwork(params, this.candles());
    this.mapWidth.set(this.net.width);
    this.mapHeight.set(this.net.height);
    this.engineInitialized.set(true);
    this.publish();
  }

  private tick(): void {
    if (!this.net) return;
    const batch = this.form.controls.speed.value;
    for (let i = 0; i < batch; i++) {
      this.net.step();
      if (this.net.isDone()) break;
    }
    this.publish();
    if (this.net.isDone()) {
      this.isDone.set(true);
      this.stop();
    }
  }

  private publish(): void {
    if (!this.net) return;
    const weights = this.net.weights();
    const hits = this.net.hitCounts();
    const cells: NeuronCell[] = weights.map((w, i) => ({
      index: i,
      color: colorFor(w),
      hits: hits[i],
    }));
    this.cells.set(cells);
    this.epoch.set(this.net.epoch);
    this.quantError.set(this.net.quantizationError());
    this.history.set(this.net.history());
    this.testWinners.set(
      this.testCandles.map((t) => this.net!.winnerOf(normalize(candleToFeatures(t.candle)))),
    );
  }

  private readParams(): SomParams {
    const v = this.form.getRawValue();
    return {
      width: v.width,
      height: v.height,
      eta: v.eta,
      neighborH: v.neighborH,
      epochs: v.epochs,
      seed: v.seed ?? undefined,
    };
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function colorFor(w: Vec3): string {
  const r = Math.round(Math.min(1, w[0]) * 255);
  const g = Math.round(Math.min(1, w[1]) * 255);
  const b = Math.round(Math.min(1, w[2]) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}
