import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  /** the bold question; by default the message's first paragraph */
  title?: string;
  ok?: string;
  cancel?: string;
  /** a red button, for deleting and removing */
  danger?: boolean;
}

export interface OpenConfirm {
  title: string;
  lines: string[];
  ok: string;
  cancel: string;
  danger: boolean;
  resolve: (yes: boolean) => void;
}

/**
 * "Are you sure?" in the app's own look, instead of the browser's plain box.
 *
 *   if (!(await this.dialog.confirm('Delete this receipt?\n\nThe PDF already sent is not affected.'))) return;
 *
 * The first paragraph is the question; the rest is shown below it. Deleting and removing get
 * a red button by themselves.
 */
@Injectable({ providedIn: 'root' })
export class Dialog {
  readonly open = signal<OpenConfirm | null>(null);

  confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    // one at a time: a question still open is answered "no"
    this.open()?.resolve(false);
    const parts = (message ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const title = options.title ?? parts.shift() ?? 'Are you sure?';
    const danger = options.danger ?? /^(delete|remove|cancel|wipe|clear)\b/i.test(title);
    const verb = /^(\w+)/.exec(title)?.[1] ?? '';
    const ok = options.ok ?? (/^(delete|remove|restore|import|place|move|mark|give|make|set|cancel)$/i.test(verb)
      ? (verb.toLowerCase() === 'cancel' ? 'Yes, cancel it' : verb[0].toUpperCase() + verb.slice(1).toLowerCase())
      : 'Yes, continue');
    return new Promise<boolean>(resolve => {
      this.open.set({
        title, ok, danger,
        lines: parts.flatMap(p => p.split('\n')).map(l => l.trim()).filter(Boolean),
        cancel: options.cancel ?? (verb.toLowerCase() === 'cancel' ? 'Keep it' : 'Cancel'),
        resolve: (yes: boolean) => {
          this.open.set(null);
          resolve(yes);
        },
      });
    });
  }
}
