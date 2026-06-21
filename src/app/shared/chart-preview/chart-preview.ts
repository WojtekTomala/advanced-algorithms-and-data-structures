import { Component, input } from '@angular/core';
import {
  NgApexchartsModule,
  ApexChart,
  ApexAxisChartSeries,
  ApexXAxis,
  ApexStroke,
  ApexGrid,
  ApexTooltip,
  ApexDataLabels,
} from 'ng-apexcharts';

@Component({
  selector: 'app-chart-preview',
  imports: [NgApexchartsModule],
  templateUrl: './chart-preview.html',
  styleUrl: './chart-preview.scss',
})
export class ChartPreview {

  readonly heading = input('Wizualizacja na żywo');

  readonly yLabel = input('wartość funkcji celu');

  protected readonly series: ApexAxisChartSeries = [
    { name: 'placeholder', data: [] },
  ];

  protected readonly chart: ApexChart = {
    type: 'line',
    height: 280,
    foreColor: '#9aa3b2',
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: true },
  };

  protected readonly stroke: ApexStroke = { curve: 'smooth', width: 2 };
  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly grid: ApexGrid = { borderColor: '#2a3040' };
  protected readonly tooltip: ApexTooltip = { theme: 'dark' };

  protected readonly xaxis: ApexXAxis = {
    title: { text: 'iteracja / epoka' },
  };
}
