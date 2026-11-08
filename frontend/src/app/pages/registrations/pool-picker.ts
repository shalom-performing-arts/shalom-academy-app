import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api';
import { Session } from '../../core/models';
import { RegRow, RegistrationApi } from '../../core/registrations';
import { Store } from '../../core/store';
import { PlaceSheet } from './place';

/**
 * From a free place on the Classes page: the children waiting in the registration pool, best
 * matches for this session first (the class and day their parent asked for). Picking one opens
 * the usual placing sheet with this session already chosen.
 */
@Component({
  selector: 'app-pool-picker',
  imports: [PlaceSheet, RouterLink],
  template: `
@if (picked(); as p) {
  <app-place-sheet [row]="p" [session]="session()" (closed)="closed.emit()" (placed)="placed.emit($event)" />
} @else {
  <div class="sheet-backdrop" (click)="closed.emit()"></div>
  <aside class="sheet pp" role="dialog" aria-label="Add from the registration pool" [style.--c]="store.colour(session().category)">
    <header class="sheet-head">
      <div><h2>🧺 Fill a free place</h2>
        <small>{{ session().name }} · {{ session().category }} · {{ session().day }} {{ session().time }}</small></div>
      <button type="button" class="btn-icon" (click)="closed.emit()" aria-label="Close">✕</button>
    </header>
    <div class="sheet-body">
      <input type="search" class="pp-q" placeholder="🔍 Find a child in the pool…" [value]="q()" (input)="q.set($any($event.target).value)">
      @if (error()) { <p class="pp-err">⚠ {{ error() }}</p> }
      @else if (rows() === null) { <p class="hint">Loading the registration pool…</p> }
      @else if (!list().length) {
        <div class="pp-empty">
          <span>🧺</span>
          <b>{{ q() ? 'No one matches' : 'The registration pool is empty' }}</b>
          <small>Children registered through the online form wait here until they are placed.</small>
          <a class="btn" routerLink="/registrations" [queryParams]="{ tab: 'form' }" (click)="closed.emit()">🔗 Get the registration link</a>
        </div>
      } @else {
        <ul class="pp-list">
          @for (x of list(); track x.r.reg.id) {
            <li>
              <button type="button" (click)="picked.set(x.r)" [style.--k]="store.colour(x.r.reg.preferredClass)">
                <span class="pp-who"><b>{{ x.r.reg.childName }}</b>
                  <small>{{ x.r.reg.number }}{{ x.r.age !== null ? ' · Age ' + x.r.age : '' }} · {{ x.r.reg.parentName }}</small></span>
                <span class="pp-tags">
                  @if (x.classMatch) { <i class="ok">✓ {{ session().category }}</i> }
                  @else if (x.r.reg.preferredClass) { <i>{{ x.r.reg.preferredClass }}</i> }
                  @if (x.dayMatch) { <i class="ok">✓ {{ session().day }}</i> }
                  @else if (x.r.reg.preferredDays?.length) { <i>{{ x.r.reg.preferredDays!.join(', ') }}</i> }
                </span>
                <span class="pp-go">Place →</span>
              </button>
            </li>
          }
        </ul>
        <p class="hint">✓ = the class or day the parent asked for. Best matches are at the top.</p>
      }
    </div>
  </aside>
}
  `,
  styles: [`
    .pp .sheet-head{border-top:5px solid var(--c)}
    .pp-q{font-size:16px !important; padding:12px 14px !important; border-radius:12px !important; margin-bottom:12px; min-height:48px}
    .pp-list{list-style:none; margin:0; padding:0; display:grid; gap:8px}
    .pp-list button{--k:#a21caf; width:100%; display:grid; grid-template-columns:1fr auto; gap:6px 10px; align-items:center; text-align:left; font:inherit; cursor:pointer;
      background:#fff; border:1.5px solid #efe6f2; border-left:5px solid var(--k); border-radius:14px; padding:12px 14px; transition:background .12s}
    .pp-list button:hover{background:#fdf2fa}
    .pp-who b{display:block; font-size:16px; color:#2d1430}
    .pp-who small{font-size:13px; color:var(--muted)}
    .pp-tags{grid-column:1; display:flex; flex-wrap:wrap; gap:4px}
    .pp-tags i{font-style:normal; font-size:12px; font-weight:700; padding:2px 8px; border-radius:99px; background:#f3edf6; color:#5b4660}
    .pp-tags i.ok{background:#d9f7e8; color:#047857}
    .pp-go{grid-column:2; grid-row:1 / span 2; font-weight:800; color:#fff; background:var(--c); padding:8px 14px; border-radius:10px; font-size:14px}
    .pp-empty{display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; padding:30px 10px}
    .pp-empty span{font-size:40px}
    .pp-empty small{color:var(--muted)}
    .pp-empty .btn{margin-top:8px}
    .pp-err{color:#a32626; font-weight:600}
  `],
})
export class PoolPicker {
  protected store = inject(Store);
  private api = inject(RegistrationApi);

  readonly session = input.required<Session>();
  readonly closed = output<void>();
  readonly placed = output<RegRow>();

  protected readonly rows = signal<RegRow[] | null>(null);
  protected readonly error = signal('');
  protected readonly q = signal('');
  protected readonly picked = signal<RegRow | null>(null);

  constructor() {
    this.api.list().then(r => this.rows.set(r.filter(x => x.status === 'pool')),
      e => this.error.set(errorMessage(e, 'Could not load the registration pool.')));
  }

  protected readonly list = computed(() => {
    const s = this.session(), q = this.q().trim().toLowerCase();
    return (this.rows() ?? [])
      .filter(r => !q || r.reg.childName.toLowerCase().includes(q) || r.reg.number.toLowerCase().includes(q))
      .map(r => ({
        r,
        classMatch: (r.reg.preferredClass ?? '').toLowerCase() === s.category.toLowerCase(),
        dayMatch: (r.reg.preferredDays ?? []).includes(s.day),
      }))
      .sort((a, b) => (+b.classMatch + +b.dayMatch) - (+a.classMatch + +a.dayMatch)
        || (a.r.reg.submittedAt ?? '').localeCompare(b.r.reg.submittedAt ?? ''));
  });
}
