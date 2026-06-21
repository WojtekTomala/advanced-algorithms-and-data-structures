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
  AcceptedMutation,
  TspHistoryPoint,
  TspParams,
  TspRun,
  generateCostMatrix,
  makeRng,
} from './tsp-algorithm';

interface NodePos {
  x: number;
  y: number;
}

const VIEW = 400;
const CENTER = VIEW / 2;
const RADIUS = VIEW / 2 - 28;

@Component({
  selector: 'app-traveling-salesman',
  imports: [ReactiveFormsModule, NgApexchartsModule, AlgorithmPage, DecimalPipe],
  templateUrl: './traveling-salesman.html',
  styleUrl: './traveling-salesman.scss',
})
export class TravelingSalesman {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly viewBox = `0 0 ${VIEW} ${VIEW}`;

  protected readonly form = this.fb.nonNullable.group({
    cityCount: [100, [Validators.required, Validators.min(3), Validators.max(256)]],
    costMin: [10, [Validators.required, Validators.min(0)]],
    costMax: [90, [Validators.required, Validators.min(1)]],
    mutationGenes: [1, [Validators.required, Validators.min(1)]],
    maxStaleIterations: [1000, [Validators.required, Validators.min(1)]],
    runs: [10, [Validators.required, Validators.min(1), Validators.max(100)]],
    seed: [null as number | null],
    speed: [50, [Validators.required, Validators.min(1), Validators.max(2000)]],
  });

  protected readonly isRunning = signal(false);
  protected readonly isDone = signal(false);
  protected readonly runIndex = signal(0);
  protected readonly totalRuns = signal(0);
  protected readonly generation = signal(0);
  protected readonly staleCount = signal(0);
  protected readonly currentCost = signal(0);
  protected readonly bestCost = signal(Infinity);
  protected readonly bestTour = signal<Uint8Array>(new Uint8Array());
  protected readonly tour = signal<Uint8Array>(new Uint8Array());
  protected readonly mutations = signal<AcceptedMutation[]>([]);
  protected readonly selectedMutationIndex = signal<number | null>(null);
  protected readonly history = signal<TspHistoryPoint[]>([]);

  private engine: TspRun | null = null;
  private cost: number[][] = [];
  private rng: () => number = makeRng();
  private params: TspParams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private priorHistory: TspHistoryPoint[] = [];
  private genOffset = 0;
  private readonly engineInitialized = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  protected readonly hasRun = computed(() => this.engineInitialized());

  protected readonly previewing = computed(() => this.selectedMutationIndex() !== null);

  protected readonly bestCostValue = computed(() => {
    const b = this.bestCost();
    return Number.isFinite(b) ? b : null;
  });

  protected readonly nodePositions = computed<NodePos[]>(() => {
    const n = this.tour().length || this.form.controls.cityCount.value;
    const pts: NodePos[] = [];
    for (let k = 0; k < n; k++) {
      const theta = (2 * Math.PI * k) / n - Math.PI / 2;
      pts.push({
        x: CENTER + RADIUS * Math.cos(theta),
        y: CENTER + RADIUS * Math.sin(theta),
      });
    }
    return pts;
  });

  protected readonly displayedTour = computed<Uint8Array>(() => {
    const idx = this.selectedMutationIndex();
    if (idx !== null) {
      const m = this.mutations()[idx];
      if (m) return m.tour;
    }
    if (this.isDone() && this.bestTour().length) return this.bestTour();
    return this.tour();
  });

  protected readonly routePoints = computed<string>(() => {
    const t = this.displayedTour();
    const pos = this.nodePositions();
    if (!t.length || !pos.length) return '';
    const parts: string[] = [];
    for (let k = 0; k < t.length; k++) {
      const p = pos[t[k]];
      if (p) parts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    return parts.join(' ');
  });

  protected readonly startNode = computed<NodePos | null>(() => {
    const t = this.displayedTour();
    const pos = this.nodePositions();
    return t.length && pos[t[0]] ? pos[t[0]] : null;
  });

  protected readonly chart: ApexChart = {
    type: 'line',
    height: 300,
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
    title: { text: 'pokolenie (łącznie)' },
    labels: { formatter: (v) => `${Math.round(Number(v))}` },
  };
  protected readonly yaxis: ApexYAxis = {
    title: { text: 'koszt trasy' },
    labels: { formatter: (v) => v.toFixed(0) },
  };
  protected readonly series = computed<ApexAxisChartSeries>(() => [
    {
      name: 'koszt',
      data: this.history().map((p) => [p.generation, Math.round(p.cost)]),
    },
  ]);

  protected start(): void {
    if (this.isRunning() || this.form.invalid) return;
    if (!this.engine) this.buildProblem();
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
    this.params = null;
    this.cost = [];
    this.priorHistory = [];
    this.genOffset = 0;
    this.engineInitialized.set(false);
    this.isDone.set(false);
    this.runIndex.set(0);
    this.totalRuns.set(0);
    this.generation.set(0);
    this.staleCount.set(0);
    this.currentCost.set(0);
    this.bestCost.set(Infinity);
    this.bestTour.set(new Uint8Array());
    this.tour.set(new Uint8Array());
    this.mutations.set([]);
    this.selectedMutationIndex.set(null);
    this.history.set([]);
  }

  protected regenerateCities(): void {
    this.reset();
    this.buildProblem();
  }

  protected selectMutation(index: number): void {
    this.selectedMutationIndex.set(index);
  }

  protected clearPreview(): void {
    this.selectedMutationIndex.set(null);
  }

  private buildProblem(): void {
    this.params = this.readParams();
    this.rng = makeRng(this.params.seed);
    this.cost = generateCostMatrix(this.params, this.rng);
    this.priorHistory = [];
    this.genOffset = 0;
    this.bestCost.set(Infinity);
    this.totalRuns.set(this.params.runs);
    this.engineInitialized.set(true);
    this.startRun(1);
  }

  private startRun(index: number): void {
    if (!this.params) return;
    this.engine = new TspRun(this.params, this.cost, this.rng, index);
    this.runIndex.set(index);
    this.publishRunState();
    this.updateCombinedHistory();
  }

  private tick(): void {
    if (!this.engine) return;
    const batch = this.form.controls.speed.value;
    const accepted: AcceptedMutation[] = [];

    for (let i = 0; i < batch; i++) {
      const mutation = this.engine.step();
      if (mutation) accepted.push(mutation);

      if (this.engine.isDone()) {
        this.finishRun(accepted);
        return;
      }
    }

    if (accepted.length) {
      this.mutations.update((list) => [...list, ...accepted]);
    }
    this.publishRunState();
    this.updateCombinedHistory();
  }

  private finishRun(accepted: AcceptedMutation[]): void {
    if (!this.engine) return;
    if (accepted.length) {
      this.mutations.update((list) => [...list, ...accepted]);
    }
    this.publishRunState();

    const runHist = this.engine.history();
    this.priorHistory = [
      ...this.priorHistory,
      ...runHist.map((p) => ({ generation: p.generation + this.genOffset, cost: p.cost })),
    ];
    this.genOffset += this.engine.state().generation;
    this.history.set(this.priorHistory);

    const idx = this.runIndex();
    if (idx < this.totalRuns()) {
      this.startRun(idx + 1);
    } else {
      this.isDone.set(true);
      this.stop();
      this.clearPreview();
    }
  }

  private publishRunState(): void {
    if (!this.engine) return;
    const s = this.engine.state();
    this.generation.set(s.generation);
    this.staleCount.set(s.staleCount);
    this.currentCost.set(s.cost);
    this.tour.set(s.tour);
    if (s.cost < this.bestCost()) {
      this.bestCost.set(s.cost);
      this.bestTour.set(s.tour);
    }
  }

  private updateCombinedHistory(): void {
    if (!this.engine) return;
    const current = this.engine
      .history()
      .map((p) => ({ generation: p.generation + this.genOffset, cost: p.cost }));
    this.history.set([...this.priorHistory, ...current]);
  }

  private readParams(): TspParams {
    const v = this.form.getRawValue();
    return {
      cityCount: v.cityCount,
      costMin: v.costMin,
      costMax: v.costMax,
      mutationGenes: v.mutationGenes,
      maxStaleIterations: v.maxStaleIterations,
      runs: v.runs,
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
