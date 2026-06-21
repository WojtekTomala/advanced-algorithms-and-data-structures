import { Type } from '@angular/core';

export interface AlgorithmMeta {

  readonly id: string;

  readonly order: number;

  readonly title: string;

  readonly summary: string;

  readonly method: string;

  readonly tags: readonly string[];

  readonly icon: string;

  readonly loadComponent: () => Promise<Type<unknown>>;
}

export const ALGORITHMS: readonly AlgorithmMeta[] = [
  {
    id: 'knapsack',
    order: 1,
    title: 'Problem plecakowy',
    summary:
      'Wybór podzbioru przedmiotów maksymalizujący wartość przy ograniczeniu pojemności.',
    method: 'Strategia ewolucyjna (1+1)',
    tags: ['NP-trudny', 'O(2^N)', 'kodowanie binarne'],
    icon: '',
    loadComponent: () =>
      import('../features/knapsack/knapsack').then((m) => m.Knapsack),
  },
  {
    id: 'multiprocessor-scheduling',
    order: 2,
    title: 'Przydział zadań do procesorów',
    summary:
      'Szeregowanie 100 zadań na 4 procesorach o różnych mocach, minimalizacja czasu ΔT.',
    method: 'Strategia ewolucyjna (1+1)',
    tags: ['NP-trudny', '4^100', 'kodowanie całkowitoliczbowe'],
    icon: '',
    loadComponent: () =>
      import('../features/multiprocessor-scheduling/multiprocessor-scheduling').then(
        (m) => m.MultiprocessorScheduling,
      ),
  },
  {
    id: 'traveling-salesman',
    order: 3,
    title: 'Problem komiwojażera',
    summary:
      'Najtańsza trasa odwiedzająca 100 miast dokładnie raz (macierz asymetryczna).',
    method: 'Strategia ewolucyjna (1+1)',
    tags: ['NP-trudny', 'N!', 'permutacja'],
    icon: '',
    loadComponent: () =>
      import('../features/traveling-salesman/traveling-salesman').then(
        (m) => m.TravelingSalesman,
      ),
  },
  {
    id: 'particle-swarm',
    order: 4,
    title: 'Maksimum funkcji (rój cząstek)',
    summary:
      'Znajdowanie globalnego maksimum funkcji f(x,y) na obszarze [0, 2π]² metodą PSO.',
    method: 'Particle Swarm Optimization',
    tags: ['metaheurystyka', '100 cząstek', 'optymalizacja ciągła'],
    icon: '',
    loadComponent: () =>
      import('../features/particle-swarm/particle-swarm').then(
        (m) => m.ParticleSwarm,
      ),
  },
  {
    id: 'kohonen-network',
    order: 5,
    title: 'Sieć Kohonena (SOM)',
    summary:
      'Samoorganizująca się mapa do klasteryzacji świec giełdowych (KGHM, 1 rok).',
    method: 'Uczenie nienadzorowane (SOM)',
    tags: ['sieć neuronowa', 'klasteryzacja', 'mapa 2D'],
    icon: '',
    loadComponent: () =>
      import('../features/kohonen-network/kohonen-network').then(
        (m) => m.KohonenNetwork,
      ),
  },
] as const;
