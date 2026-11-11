import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  kind: ToastKind;
  title: string;
  text: string;
}

/**
 * A message box at the bottom of the screen: green for done, red for a problem (with a title,
 * staying until it is read), purple for anything else. One at a time; a new one replaces it.
 */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly current = signal<ToastMessage | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  /** A message; whether it reads as done, a problem or a note is worked out from its words. */
  show(msg: string) {
    this.open(guess(msg), msg);
  }

  success(msg: string) {
    this.open('success', msg);
  }

  /** Something went wrong: shown longer, with a title, and closed by hand or after a while. */
  error(msg: string) {
    this.open('error', msg);
  }

  info(msg: string) {
    this.open('info', msg);
  }

  close() {
    clearTimeout(this.timer);
    this.current.set(null);
  }

  private open(kind: ToastKind, msg: string) {
    const text = (msg ?? '').trim();
    if (!text) return;
    this.current.set({ kind, title: TITLES[kind], text });
    clearTimeout(this.timer);
    const ms = kind === 'error' ? 9000 : text.length > 90 ? 6000 : 3500;
    this.timer = setTimeout(() => this.current.set(null), ms);
  }
}

const TITLES: Record<ToastKind, string> = {
  success: 'Done',
  error: 'Something went wrong',
  info: 'Note',
};

/** "Could not …", "… failed", "Give the session a name." read as problems; "… saved." as done. */
function guess(msg: string): ToastKind {
  const m = (msg ?? '').toLowerCase();
  if (/\b(could not|couldn't|cannot|can't|failed|error|not valid|invalid|too big|too short|not found|refused|try again|is not a|did not|didn't|should be|give the|choose|pick|enter a|type a)\b/.test(m)) return 'error';
  if (/\b(saved|added|removed|deleted|sent|copied|imported|restored|done|marked|moved|booked|updated|reloaded|placed|paid)\b/.test(m) || m.startsWith('✓')) return 'success';
  return 'info';
}
