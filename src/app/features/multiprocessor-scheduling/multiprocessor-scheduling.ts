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
  PROCESSOR_COUNT,
  SPEED_MULTIPLIERS,
  SchedulingEngine,
  SchedulingImprovement,
  SchedulingParams,
  SchedulingSnapshot,
  SchedulingState,
} from './scheduling-algorithm';

const PROCESSOR_COLORS = ['#4f8cff', '#22d3ee', '#34d399', '#fbbf24'];

interface TaskSegment {
  index: number;
  baseTime: number;
  contribution: number;
}

interface ProcessorBlock {
  proc: number;
  label: string;
  multiplier: number;
  color: string;
  load: number;
  isMakespan: boolean;
  tasks: TaskSegment[];
}

@Component({
  selector: 'app-multiprocessor-scheduling',
  imports: [ReactiveFormsModule, NgApexchartsModule, AlgorithmPage, DecimalPipe],
  templateUrl: './multiprocessor-scheduling.html',
  styleUrl: './multiprocessor-scheduling.scss',
})
export class MultiprocessorScheduling {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly processors = SPEED_MULTIPLIERS.map((mult, i) => ({
    label: `P${i + 1}`,
    multiplier: mult,
    color: PROCESSOR_COLORS[i],
  }));

  protected readonly form = this.fb.nonNullable.group({
    taskCount: [100, [Validators.required, Validators.min(PROCESSOR_COUNT), Validators.max(5000)]],
    timeMin: [10, [Validators.required, Validators.min(0)]],
    timeMax: [90, [Validators.required, Validators.min(1)]],
    mutationGenes: [1, [Validators.required, Validators.min(1)]],
    maxStaleIterations: [1000, [Validators.required, Validators.min(1)]],
    seed: [null as number | null],
    speed: [50, [Validators.required, Validators.min(1), Validators.max(2000)]],
  });

  protected readonly isRunning = signal(false);
  protected readonly isDone = signal(false);
  protected readonly generation = signal(0);
  protected readonly staleCount = signal(0);
  protected readonly makespan = signal(0);
  protected readonly loads = signal<number[]>([]);
  protected readonly assignment = signal<Uint8Array>(new Uint8Array());
  protected readonly history = signal<{ generation: number; makespan: number }[]>([]);

  protected readonly initialState = signal<SchedulingSnapshot | null>(null);
  protected readonly improvements = signal<SchedulingImprovement[]>([]);

  protected readonly tasks = signal<readonly number[]>([]);

  private engine: SchedulingEngine | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly engineInitialized = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  protected readonly hasRun = computed(() => this.engineInitialized());

  protected readonly imbalance = computed(() => {
    const l = this.loads();
    if (!l.length) return 0;
    const avg = l.reduce((s, v) => s + v, 0) / l.length;
    return avg > 0 ? this.makespan() / avg : 0;
  });

  protected readonly finalSnapshot = computed<SchedulingSnapshot | null>(() => {
    if (!this.engineInitialized()) return null;
    return {
      assignment: this.assignment(),
      loads: this.loads(),
      makespan: this.makespan(),
    };
  });

  protected readonly initialBlocks = computed(() =>
    this.buildBlocks(this.initialState()),
  );
  protected readonly finalBlocks = computed(() =>
    this.buildBlocks(this.finalSnapshot()),
  );

  protected readonly blockScale = computed(() => {
    const a = this.initialState()?.makespan ?? 0;
    const b = this.finalSnapshot()?.makespan ?? 0;
    return Math.max(a, b, 1);
  });

  protected readonly makespanGain = computed(() => {
    const init = this.initialState();
    const fin = this.finalSnapshot();
    if (!init || !fin) return 0;
    return init.makespan - fin.makespan;
  });

  protected readonly blockPanels = computed(() => {
    const init = this.initialState();
    const fin = this.finalSnapshot();
    if (!init || !fin) return [];
    return [
      {
        key: 'initial',
        title: 'Stan początkowy',
        subtitle: 'losowy przydział',
        makespan: init.makespan,
        blocks: this.initialBlocks(),
      },
      {
        key: 'final',
        title: 'Stan końcowy',
        subtitle: 'najlepszy przydział',
        makespan: fin.makespan,
        blocks: this.finalBlocks(),
      },
    ];
  });

  private buildBlocks(snap: SchedulingSnapshot | null): ProcessorBlock[] {
    if (!snap) return [];
    const tasks = this.tasks();
    const blocks: ProcessorBlock[] = this.processors.map((p, proc) => ({
      proc,
      label: p.label,
      multiplier: p.multiplier,
      color: p.color,
      load: snap.loads[proc] ?? 0,
      isMakespan: (snap.loads[proc] ?? 0) >= snap.makespan - 1e-9,
      tasks: [],
    }));
    for (let i = 0; i < snap.assignment.length; i++) {
      const proc = snap.assignment[i];
      const base = tasks[i] ?? 0;
      blocks[proc]?.tasks.push({
        index: i,
        baseTime: base,
        contribution: base * SPEED_MULTIPLIERS[proc],
      });
    }
    return blocks;
  }

  protected readonly lineChart: ApexChart = {
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
  protected readonly lineXaxis: ApexXAxis = {
    type: 'numeric',
    title: { text: 'pokolenie' },
    labels: { formatter: (v) => `${Math.round(Number(v))}` },
  };
  protected readonly lineYaxis: ApexYAxis = {
    title: { text: 'ΔT (makespan)' },
    labels: { formatter: (v) => v.toFixed(0) },
  };
  protected readonly convergenceSeries = computed<ApexAxisChartSeries>(() => [
    {
      name: 'ΔT',
      data: this.history().map((p) => [p.generation, Math.round(p.makespan)]),
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
    this.makespan.set(0);
    this.loads.set([]);
    this.assignment.set(new Uint8Array());
    this.history.set([]);
    this.tasks.set([]);
    this.initialState.set(null);
    this.improvements.set([]);
  }

  protected regenerateTasks(): void {
    this.reset();
    this.buildEngine();
  }

  private buildEngine(): void {
    this.engine = new SchedulingEngine(this.readParams());
    this.tasks.set(this.engine.tasks);
    this.initialState.set(this.engine.initial);
    this.engineInitialized.set(true);
    this.publish(this.engine.state(), this.engine.history());
  }

  private tick(): void {
    if (!this.engine) return;
    const batch = this.form.controls.speed.value;
    let state: SchedulingState | null = null;

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
    state: SchedulingState,
    history: { generation: number; makespan: number }[],
  ): void {
    this.generation.set(state.generation);
    this.staleCount.set(state.staleCount);
    this.makespan.set(state.makespan);
    this.loads.set(state.loads);
    this.assignment.set(state.assignment);
    this.history.set(history);
    if (this.engine) this.improvements.set(this.engine.improvements());
  }

  private readParams(): SchedulingParams {
    const v = this.form.getRawValue();
    return {
      taskCount: v.taskCount,
      timeMin: v.timeMin,
      timeMax: v.timeMax,
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
