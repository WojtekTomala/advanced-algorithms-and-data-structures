import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
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
  Improvement,
  KnapsackEngine,
  KnapsackItem,
  KnapsackParams,
  KnapsackSnapshot,
  KnapsackState,
} from './knapsack-algorithm';

@Component({
  selector: 'app-knapsack',
  imports: [ReactiveFormsModule, NgApexchartsModule, AlgorithmPage, DecimalPipe],
  templateUrl: './knapsack.html',
  styleUrl: './knapsack.scss',
})
export class Knapsack {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly form = this.fb.nonNullable.group({
    itemCount: [100, [Validators.required, Validators.min(2), Validators.max(2000)]],
    valueMin: [10, [Validators.required, Validators.min(0)]],
    valueMax: [90, [Validators.required, Validators.min(1)]],
    weightMin: [10, [Validators.required, Validators.min(0)]],
    weightMax: [90, [Validators.required, Validators.min(1)]],
    capacityRatio: [0.5, [Validators.required, Validators.min(0.05), Validators.max(0.95)]],
    mutationGenes: [1, [Validators.required, Validators.min(1)]],
    maxStaleIterations: [1000, [Validators.required, Validators.min(1)]],
    seed: [null as number | null],
    speed: [50, [Validators.required, Validators.min(1), Validators.max(2000)]],
  });

  protected readonly isRunning = signal(false);
  protected readonly isDone = signal(false);
  protected readonly generation = signal(0);
  protected readonly staleCount = signal(0);
  protected readonly bestValue = signal(0);
  protected readonly bestWeight = signal(0);
  protected readonly selectedCount = signal(0);
  protected readonly feasible = signal(true);
  protected readonly capacity = signal(0);
  protected readonly genome = signal<Uint8Array>(new Uint8Array());
  protected readonly history = signal<{ generation: number; value: number }[]>([]);

  protected readonly initialSnapshot = signal<KnapsackSnapshot | null>(null);
  protected readonly improvements = signal<Improvement[]>([]);

  protected readonly items = signal<readonly KnapsackItem[]>([]);

  private engine: KnapsackEngine | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  protected readonly hasRun = computed(() => this.engineInitialized());
  private readonly engineInitialized = signal(false);

  protected readonly finalSnapshot = computed<KnapsackSnapshot | null>(() => {
    if (!this.engineInitialized()) return null;
    return {
      genome: this.genome(),
      value: this.bestValue(),
      weight: this.bestWeight(),
      selectedCount: this.selectedCount(),
      feasible: this.feasible(),
    };
  });

  protected readonly comparisonCards = computed(() => {
    const init = this.initialSnapshot();
    const fin = this.finalSnapshot();
    if (!init || !fin) return [];
    return [
      { key: 'initial', title: 'Plecak początkowy', subtitle: 'losowy start', snap: init },
      { key: 'final', title: 'Plecak końcowy', subtitle: 'najlepsze rozwiązanie', snap: fin },
    ];
  });

  protected readonly valueGain = computed(() => {
    const init = this.initialSnapshot();
    const fin = this.finalSnapshot();
    if (!init || !fin) return 0;
    return fin.value - init.value;
  });

  protected fillPct(weight: number): number {
    const cap = this.capacity();
    return cap > 0 ? Math.min(100, (weight / cap) * 100) : 0;
  }

  protected readonly chart: ApexChart = {
    type: 'line',
    height: 320,
    foreColor: '#9aa3b2',
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: false },
  };
  protected readonly stroke: ApexStroke = { curve: 'stepline', width: 2 };
  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly grid: ApexGrid = { borderColor: '#2a3040' };
  protected readonly tooltip: ApexTooltip = { theme: 'dark' };
  protected readonly xaxis: ApexXAxis = {
    type: 'numeric',
    title: { text: 'pokolenie' },
    labels: { formatter: (v) => `${Math.round(Number(v))}` },
  };
  protected readonly yaxis: ApexYAxis = {
    title: { text: 'wartość plecaka' },
    labels: { formatter: (v) => v.toFixed(0) },
  };

  protected readonly series = computed<ApexAxisChartSeries>(() => [
    {
      name: 'najlepsza wartość',
      data: this.history().map((p) => [p.generation, Math.round(p.value)]),
    },
  ]);

  protected start(): void {
    if (this.isRunning() || this.form.invalid) return;
    if (!this.engine) this.buildEngine();
    this.isRunning.set(true);

    this.timer = setInterval(() => this.tick(), 16);
  }

  protected stop(): void {
    this.clearTimer();
    this.isRunning.set(false);
  }

  protected reset(): void {
    this.stop();
    this.engine = null;
    this.engineInitialized.set(false);
    this.isDone.set(false);
    this.generation.set(0);
    this.staleCount.set(0);
    this.bestValue.set(0);
    this.bestWeight.set(0);
    this.selectedCount.set(0);
    this.feasible.set(true);
    this.genome.set(new Uint8Array());
    this.history.set([]);
    this.items.set([]);
    this.initialSnapshot.set(null);
    this.improvements.set([]);
  }

  protected regenerateItems(): void {
    this.reset();
    this.buildEngine();
  }

  private buildEngine(): void {
    const params = this.readParams();
    this.engine = new KnapsackEngine(params);
    this.items.set(this.engine.items);
    this.capacity.set(this.engine.capacity);
    this.initialSnapshot.set(this.engine.initial);
    this.engineInitialized.set(true);
    this.publish(this.engine.state(), this.engine.history());
  }

  private tick(): void {
    if (!this.engine) return;
    const batch = this.form.controls.speed.value;
    let state: KnapsackState | null = null;

    for (let i = 0; i < batch; i++) {
      state = this.engine.step();
      if (this.engine.isDone()) {
        this.publish(state, this.engine.history());
        this.isDone.set(true);
        this.stop();
        return;
      }
    }
    if (state) this.publish(state, this.engine.history());
  }

  private publish(
    state: KnapsackState,
    history: { generation: number; value: number }[],
  ): void {
    this.generation.set(state.generation);
    this.staleCount.set(state.staleCount);
    this.bestValue.set(state.bestValue);
    this.bestWeight.set(state.bestWeight);
    this.selectedCount.set(state.selectedCount);
    this.feasible.set(state.feasible);
    this.capacity.set(state.capacity);
    this.genome.set(state.genome);
    this.history.set(history);
    if (this.engine) this.improvements.set(this.engine.improvements());
  }

  private readParams(): KnapsackParams {
    const v = this.form.getRawValue();
    return {
      itemCount: v.itemCount,
      valueMin: v.valueMin,
      valueMax: v.valueMax,
      weightMin: v.weightMin,
      weightMax: v.weightMax,
      capacityRatio: v.capacityRatio,
      mutationGenes: v.mutationGenes,
      maxStaleIterations: v.maxStaleIterations,
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
