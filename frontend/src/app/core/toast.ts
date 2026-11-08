import { Injectable, signal } from '@angular/core';

/** One short message at the bottom of the screen, gone after a few seconds. */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly message = signal('');
  private timer?: ReturnType<typeof setTimeout>;

  show(msg: string) {
    this.message.set(msg);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), msg.length > 90 ? 5000 : 2600);
  }
}
