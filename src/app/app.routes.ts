import { Routes } from '@angular/router';
import { ALGORITHMS } from './core/algorithm-registry';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/menu/menu').then((m) => m.Menu),
    title: 'Algorytmy — menu',
  },

  ...ALGORITHMS.map((algo) => ({
    path: algo.id,
    loadComponent: algo.loadComponent,
    title: algo.title,
  })),
  { path: '**', redirectTo: '' },
];
