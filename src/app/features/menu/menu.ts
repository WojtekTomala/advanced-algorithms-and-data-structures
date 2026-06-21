import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ALGORITHMS } from '../../core/algorithm-registry';

@Component({
  selector: 'app-menu',
  imports: [RouterLink],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
})
export class Menu {
  protected readonly algorithms = ALGORITHMS;
}
