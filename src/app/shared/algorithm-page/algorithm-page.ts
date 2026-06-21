import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ALGORITHMS } from '../../core/algorithm-registry';

@Component({
  selector: 'app-algorithm-page',
  imports: [RouterLink],
  templateUrl: './algorithm-page.html',
  styleUrl: './algorithm-page.scss',
})
export class AlgorithmPage {

  readonly algoId = input.required<string>();

  protected readonly meta = computed(() =>
    ALGORITHMS.find((a) => a.id === this.algoId()),
  );
}
