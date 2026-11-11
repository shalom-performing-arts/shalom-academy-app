import { Component, inject, input, output } from '@angular/core';
import { Dialog } from '../core/dialog';

/**
 * Edits a short list of names: rename in place, reorder, remove, add. Used for the Paid-to
 * accounts and the payment methods in Settings.
 */
@Component({
  selector: 'app-list-editor',
  template: `
    <div class="opt-list">
      @for (o of items(); track $index; let i = $index; let last = $last) {
        <div class="opt-row">
          @if (firstLabel()) { <span class="opt-badge">{{ i === 0 ? firstLabel() : '' }}</span> }
          <input type="text" [value]="o" (change)="rename(i, $any($event.target).value)" [attr.aria-label]="noun() + ' ' + (i + 1)">
          <button type="button" class="btn-icon" [disabled]="i === 0" (click)="move(i, -1)" title="Move up" aria-label="Move up">↑</button>
          <button type="button" class="btn-icon" [disabled]="last" (click)="move(i, 1)" title="Move down" aria-label="Move down">↓</button>
          <button type="button" class="btn-icon danger" [disabled]="items().length < 2" (click)="remove(i)">Remove</button>
        </div>
      }
    </div>
    <div class="with-btn">
      <input #add type="text" [placeholder]="placeholder()" (keydown.enter)="$event.preventDefault(); push(add)">
      <button type="button" class="btn btn-sm" (click)="push(add)">Add</button>
    </div>
  `,
})
export class ListEditor {
  private dialog = inject(Dialog);
  readonly items = input.required<string[]>();
  readonly noun = input('Item');
  readonly placeholder = input('Add another');
  /** a badge on the first entry, e.g. "Usual" */
  readonly firstLabel = input('');
  readonly changed = output<string[]>();

  private emit(list: string[]) {
    const clean = list.map(s => s.trim()).filter((s, i, all) => s && all.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i);
    if (clean.length) this.changed.emit(clean);
  }

  protected rename(i: number, v: string) {
    const list = [...this.items()];
    list[i] = v;
    this.emit(list);
  }

  protected move(i: number, by: number) {
    const list = [...this.items()];
    const [x] = list.splice(i, 1);
    list.splice(i + by, 0, x);
    this.emit(list);
  }

  protected async remove(i: number) {
    if (!await this.dialog.confirm(`Remove “${this.items()[i]}”?\n\nAnything already recorded with it keeps it.`)) return;
    this.emit(this.items().filter((_, j) => j !== i));
  }

  protected push(box: HTMLInputElement) {
    const v = box.value.trim();
    if (!v) return;
    if (this.items().some(o => o.toLowerCase() === v.toLowerCase())) { box.select(); return; }
    this.emit([...this.items(), v]);
    box.value = '';
  }
}
