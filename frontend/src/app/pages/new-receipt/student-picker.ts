import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Store } from '../../core/store';
import { Student } from '../../core/models';
import { money } from '../../receipt/format';

/**
 * Name search with a suggestion list. Type any part of a name (surnames too), then pick with
 * the mouse or ↓ / Enter. One instance per student slot, each with its own menu and cursor.
 */
@Component({
  selector: 'app-student-picker',
  template: `
    <div class="combo">
      <input #box type="text" [id]="inputId()" [value]="value()" placeholder="Start typing a name…"
             autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list"
             [attr.aria-expanded]="open()" [attr.aria-controls]="inputId() + 'Menu'"
             (input)="onInput(box.value)" (focus)="onFocus()" (blur)="onBlur()"
             (keydown)="onKey($event)">
      <ul class="combo-menu" role="listbox" [id]="inputId() + 'Menu'" [hidden]="!open()"
          (mousedown)="$event.preventDefault()">
        @for (s of hits(); track s.name; let i = $index) {
          <li role="option" [class.is-on]="i === cursor()" [class.is-off]="!s.active"
              (click)="choose(i)" (mousemove)="cursor.set(i)">
            {{ before(s.name) }}<mark>{{ match(s.name) }}</mark>{{ after(s.name) }}
            <small>{{ detail(s) }}</small>
          </li>
        } @empty {
          <li class="none">No student matches “{{ query().trim() }}”.</li>
        }
      </ul>
    </div>
  `,
})
export class StudentPicker {
  private store = inject(Store);

  readonly value = input('');
  readonly inputId = input('fStudent');
  /** every keystroke, so the parent can keep the name and look for an exact match */
  readonly textChange = output<string>();
  /** a suggestion was chosen */
  readonly pick = output<Student>();

  private box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly cursor = signal(-1);
  protected readonly hits = computed(() => this.store.searchStudents(this.query()).slice(0, 12));

  focus() {
    this.box().nativeElement.focus();
  }

  close() {
    this.open.set(false);
    this.cursor.set(-1);
  }

  protected onInput(text: string) {
    this.textChange.emit(text);
    this.show(text);
  }

  protected onFocus() {
    const text = this.box().nativeElement.value;
    if (text.trim()) this.show(text);
  }

  protected onBlur() {
    setTimeout(() => this.close(), 120);
  }

  private show(text: string) {
    this.query.set(text);
    const q = text.trim().toLowerCase();
    const hits = this.hits();
    // nothing typed, or an exact single match that is already applied: no menu needed
    if (!q || (hits.length === 1 && hits[0].name.toLowerCase() === q)) {
      this.close();
      return;
    }
    this.open.set(true);
    this.cursor.set(hits.length ? 0 : -1);
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.hits().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.open()) this.show(this.box().nativeElement.value);
      else if (n) this.moveTo((this.cursor() + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.open() && n) this.moveTo((this.cursor() - 1 + n) % n);
    } else if (e.key === 'Enter') {
      if (this.open() && this.cursor() >= 0) { e.preventDefault(); this.choose(this.cursor()); }
    } else if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Tab' && this.open() && this.cursor() >= 0) {
      this.choose(this.cursor());
    }
  }

  private moveTo(i: number) {
    this.cursor.set(i);
    // keep the highlighted row in view once Angular has moved the class
    setTimeout(() => this.box().nativeElement.parentElement
      ?.querySelector('li.is-on')?.scrollIntoView({ block: 'nearest' }));
  }

  protected choose(i: number) {
    const s = this.hits()[i];
    if (!s) return;
    this.pick.emit(s);
    this.close();
  }

  /* highlight the matched part of the name */
  private at(name: string) {
    return name.toLowerCase().indexOf(this.query().trim().toLowerCase());
  }
  protected before(name: string) {
    const i = this.at(name);
    return i < 0 ? name : name.slice(0, i);
  }
  protected match(name: string) {
    const i = this.at(name);
    return i < 0 ? '' : name.slice(i, i + this.query().trim().length);
  }
  protected after(name: string) {
    const i = this.at(name);
    return i < 0 ? '' : name.slice(i + this.query().trim().length);
  }

  /** The fee rides along, so siblings on different fees can be told apart before picking. */
  protected detail(s: Student) {
    return [s.id, s.category, [s.day, s.time].filter(Boolean).join(' '),
      s.fee === null ? '' : 'Rs. ' + money(s.fee),
      s.active ? '' : 'inactive'].filter(Boolean).join('  ·  ');
  }
}
