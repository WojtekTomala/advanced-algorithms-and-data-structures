import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
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
  Gbest,
  Particle,
  PsoParams,
  PsoSwarm,
  PsoHistoryPoint,
  TWO_PI,
  sampleField,
} from './pso-algorithm';

const FIELD_RES = 200;

const BANDS = 14;

@Component({
  selector: 'app-particle-swarm',
  imports: [ReactiveFormsModule, NgApexchartsModule, AlgorithmPage, DecimalPipe],
  templateUrl: './particle-swarm.html',
  styleUrl: './particle-swarm.scss',
})
export class ParticleSwarm {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly fieldRes = FIELD_RES;
  private readonly mapCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');

  protected readonly form = this.fb.nonNullable.group({
    particleCount: [100, [Validators.required, Validators.min(1), Validators.max(2000)]],
    velocity: [0.001, [Validators.required, Validators.min(0.0001), Validators.max(0.5)]],
    randomness: [0.2, [Validators.required, Validators.min(0), Validators.max(1)]],
    maxStaleIterations: [1000, [Validators.required, Validators.min(1)]],
    seed: [null as number | null],
    speed: [50, [Validators.required, Validators.min(1), Validators.max(2000)]],
  });

  protected readonly isRunning = signal(false);
  protected readonly isDone = signal(false);
  protected readonly epoch = signal(0);
  protected readonly staleCount = signal(0);
  protected readonly particles = signal<Particle[]>([]);
  protected readonly gbest = signal<Gbest>({ x: 0, y: 0, value: 0 });
  protected readonly history = signal<PsoHistoryPoint[]>([]);

  private swarm: PsoSwarm | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private heatmap: HTMLCanvasElement | null = null;
  private readonly engineInitialized = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());

    effect(() => {
      this.particles();
      this.gbest();
      this.mapCanvas();
      this.draw();
    });
  }

  protected readonly hasRun = computed(() => this.engineInitialized());

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
    title: { text: 'epoka' },
    labels: { formatter: (v) => `${Math.round(Number(v))}` },
  };
  protected readonly yaxis: ApexYAxis = {
    title: { text: 'najlepsze f(x,y)' },
    min: 0,
    max: 8,
    labels: { formatter: (v) => v.toFixed(2) },
  };
  protected readonly series = computed<ApexAxisChartSeries>(() => [
    {
      name: 'max f',
      data: this.history().map((p) => [p.epoch, +p.best.toFixed(3)]),
    },
  ]);

  protected start(): void {
    if (this.isRunning() || this.form.invalid) return;
    if (!this.swarm) this.buildSwarm();
    this.isRunning.set(true);
    this.timer = setInterval(() => this.tick(), 16);
  }

  protected stop(): void {
    this.clearTimer();
    this.isRunning.set(false);
  }

  protected reset(): void {
    this.stop();
    this.swarm = null;
    this.engineInitialized.set(false);
    this.isDone.set(false);
    this.epoch.set(0);
    this.staleCount.set(0);
    this.particles.set([]);
    this.gbest.set({ x: 0, y: 0, value: 0 });
    this.history.set([]);
  }

  protected reseed(): void {
    this.reset();
    this.buildSwarm();
  }

  private buildSwarm(): void {
    this.swarm = new PsoSwarm(this.readParams());
    this.engineInitialized.set(true);
    this.publish(this.swarm.state(), this.swarm.history());
  }

  private tick(): void {
    if (!this.swarm) return;
    const batch = this.form.controls.speed.value;
    let done = false;
    for (let i = 0; i < batch; i++) {
      this.swarm.step();
      if (this.swarm.isDone()) {
        done = true;
        break;
      }
    }
    this.publish(this.swarm.state(), this.swarm.history());
    if (done) {
      this.isDone.set(true);
      this.stop();
    }
  }

  private publish(
    state: { epoch: number; staleCount: number; particles: Particle[]; gbest: Gbest },
    history: PsoHistoryPoint[],
  ): void {
    this.epoch.set(state.epoch);
    this.staleCount.set(state.staleCount);
    this.particles.set(state.particles);
    this.gbest.set(state.gbest);
    this.history.set(history);
  }

  private readParams(): PsoParams {
    const v = this.form.getRawValue();
    return {
      particleCount: v.particleCount,
      velocity: v.velocity,
      randomness: v.randomness,
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

  private draw(): void {
    const canvasEl = this.mapCanvas()?.nativeElement;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    if (!this.heatmap) this.heatmap = this.buildHeatmap();
    const w = canvasEl.width;
    const h = canvasEl.height;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.heatmap, 0, 0, w, h);

    const ps = this.particles();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const p of ps) {
      const px = (p.x / TWO_PI) * w;
      const py = (p.y / TWO_PI) * h;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, TWO_PI);
      ctx.fill();
    }

    if (ps.length) {
      const g = this.gbest();
      const gx = (g.x / TWO_PI) * w;
      const gy = (g.y / TWO_PI) * h;
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, 6, 0, TWO_PI);
      ctx.stroke();
    }
  }

  private buildHeatmap(): HTMLCanvasElement {
    const res = FIELD_RES;
    const field = sampleField(res, res);
    const off = document.createElement('canvas');
    off.width = res;
    off.height = res;
    const ctx = off.getContext('2d')!;
    const img = ctx.createImageData(res, res);
    const data = img.data;

    const band = (v: number) => Math.floor((v / 8) * BANDS);

    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const i = r * res + c;
        const v = field[i];
        let [cr, cg, cb] = colorFor(v / 8);

        const b = band(v);
        const left = c > 0 ? band(field[i - 1]) : b;
        const up = r > 0 ? band(field[i - res]) : b;
        if (b !== left || b !== up) {
          cr *= 0.45;
          cg *= 0.45;
          cb *= 0.45;
        }

        const o = i * 4;
        data[o] = cr;
        data[o + 1] = cg;
        data[o + 2] = cb;
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off;
  }
}

function colorFor(t: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [12, 16, 38]],
    [0.35, [28, 70, 120]],
    [0.6, [30, 140, 150]],
    [0.8, [70, 200, 160]],
    [1.0, [250, 240, 150]],
  ];
  const tc = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (tc <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (tc - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}
