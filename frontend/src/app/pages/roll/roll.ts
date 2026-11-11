import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { classColour } from '../../core/colours';
import { Makeup, Mark, RollApi, RollClass, RollDay, RollMonth, RollStudent, coverMessage } from '../../core/roll';
import { Session } from '../../core/models';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { Dialog } from '../../core/dialog';

type Tab = 'day' | 'month';

/**
 * Student attendance — the paper register on a phone. Opens on today, on the class that is on
 * now (or next). One tap marks a student present, late or absent and saves straight away, so
 * whichever of the class's teachers takes the register, the others see it at once.
 */
@Component({
  selector: 'app-roll',
  imports: [NgTemplateOutlet],
  templateUrl: './roll.html',
  styleUrl: './roll.css',
})
export class Roll {
  private api = inject(RollApi);
  private dialog = inject(Dialog);
  private toast = inject(Toast);
  private store = inject(Store);
  protected auth = inject(Auth);

  protected readonly tab = signal<Tab>('day');
  protected readonly day = signal<RollDay | null>(null);
  protected readonly date = signal(isoToday());
  protected readonly selected = signal('');
  protected readonly loading = signal(false);
  /** student ids being saved */
  protected readonly saving = signal<Set<string>>(new Set());
  /** the student whose note box is open */
  protected readonly noteOpen = signal('');
  protected readonly bulk = signal(false);

  /* month */
  protected readonly month = signal<RollMonth | null>(null);
  protected readonly monthKey = signal(isoToday().slice(0, 7));
  protected readonly monthSession = signal('');

  protected readonly teacher = this.auth.isTeacher();
  protected readonly storeSessions = this.store.sessions;

  protected readonly current = computed(() => {
    const d = this.day();
    return d?.classes.find(c => c.session.name === this.selected()) ?? d?.classes[0] ?? null;
  });

  /** the class's own students, and those here for a cover-up, listed apart */
  protected readonly regulars = computed(() => (this.current()?.students ?? []).filter(s => !s.coverFor));
  protected readonly visitors = computed(() => (this.current()?.students ?? []).filter(s => !!s.coverFor));

  /* ---------------- cover-up classes ---------------- */

  /** the student a cover-up is being booked for, from this class on this date */
  protected readonly booking = signal<{ student: RollStudent; from: RollClass; date: string } | null>(null);
  protected readonly bookNote = signal('');
  protected readonly bookAll = signal(false);
  protected readonly makeups = signal<Makeup[]>([]);
  protected readonly showMakeups = signal(false);

  constructor() {
    this.load(true);
    // other teachers may be marking the same class: refresh every 30 seconds while nothing is being typed
    const t = setInterval(() => {
      if (this.tab() === 'day' && !this.noteOpen() && !this.saving().size && !this.bulk()) this.load(false);
    }, 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /* ---------------- loading ---------------- */

  protected async load(refocus: boolean) {
    if (refocus) this.loading.set(true);
    try {
      const d = await this.api.day(this.teacher ? undefined : this.date());
      this.day.set(d);
      this.date.set(d.date);
      this.loadMakeups();
      if (refocus || !d.classes.some(c => c.session.name === this.selected())) this.selected.set(d.focus);
    } catch (e) {
      if (refocus) this.toast.error(errorMessage(e, 'Could not load the classes.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected shiftDay(by: number) {
    const d = new Date(this.date() + 'T12:00:00');
    d.setDate(d.getDate() + by);
    this.date.set(d.toISOString().slice(0, 10));
    this.load(true);
  }

  protected setDate(iso: string) {
    if (!iso) return;
    this.date.set(iso);
    this.load(true);
  }

  protected goToday() {
    this.date.set(isoToday());
    this.load(true);
  }

  protected pick(c: RollClass) {
    this.selected.set(c.session.name);
    this.noteOpen.set('');
  }

  /* ---------------- marking ---------------- */

  /** Tapping the mark a student already has clears it, so a slip is one tap to undo. */
  protected async mark(c: RollClass, s: RollStudent, status: Mark) {
    const next = s.status === status ? null : status;
    await this.save(c, s, next, null);
  }

  protected async saveNote(c: RollClass, s: RollStudent, note: string) {
    this.noteOpen.set('');
    if ((note || '') === (s.note || '')) return;
    // a note needs a mark to hang on; a note on its own counts the student present
    await this.save(c, s, s.status ?? 'P', note);
  }

  private async save(c: RollClass, s: RollStudent, status: Mark | null, note: string | null) {
    const before = this.day();
    // show it at once; the server's copy replaces it a moment later
    this.patchStudent(c.session.name, s.id, { status, ...(note !== null ? { note } : {}) });
    this.saving.update(x => new Set(x).add(s.id));
    try {
      const fresh = await this.api.mark(this.date(), c.session.name, s.id, status, note);
      this.replaceClass(fresh);
    } catch (e) {
      this.day.set(before);
      this.toast.error(errorMessage(e, 'Could not save that mark.'));
    } finally {
      this.saving.update(x => { const n = new Set(x); n.delete(s.id); return n; });
    }
  }

  protected async allPresent(c: RollClass) {
    if (this.bulk()) return;
    this.bulk.set(true);
    try {
      this.replaceClass(await this.api.allPresent(this.date(), c.session.name));
      this.toast.show(`Everyone not yet marked in ${c.session.name} is now present. Tap anyone who is late or absent.`);
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not mark everyone present.'));
    } finally {
      this.bulk.set(false);
    }
  }

  private patchStudent(session: string, id: string, p: Partial<RollStudent>) {
    this.day.update(d => d ? {
      ...d, classes: d.classes.map(c => c.session.name !== session ? c : recount({
        ...c, students: c.students.map(s => s.id === id ? { ...s, ...p } : s),
      })),
    } : d);
  }

  private replaceClass(fresh: RollClass) {
    this.day.update(d => d ? { ...d, classes: d.classes.map(c => c.session.name === fresh.session.name ? fresh : c) } : d);
  }

  protected openBooking(c: RollClass, st: RollStudent) {
    this.booked.set(null);
    this.bookNote.set('');
    this.bookAll.set(false);
    this.booking.set({ student: st, from: c, date: this.date() });
  }

  /**
   * Where the student can make up the class: every other session's days from a week before the
   * missed class to three weeks after it, the same class (Kids, Junior …) first.
   */
  protected readonly bookOptions = computed(() => {
    const b = this.booking();
    if (!b) return [];
    const from = new Date(b.date + 'T12:00:00');
    const cat = b.from.session.category;
    const counts = new Map<string, number>();
    for (const st of this.store.students()) if (st.active && st.session) counts.set(st.session, (counts.get(st.session) ?? 0) + 1);
    const out: { session: Session; date: string; label: string; free: number | null; sameClass: boolean }[] = [];
    for (const ses of this.store.sessions()) {
      if (ses.name === b.from.session.name) continue;
      const same = ses.category === cat;
      if (!same && !this.bookAll()) continue;
      for (let d = -7; d <= 21; d++) {
        const day = new Date(from.getTime() + d * 864e5);
        if (day.toLocaleDateString('en-GB', { weekday: 'long' }) !== ses.day) continue;
        const iso = isoOf(day);
        const n = counts.get(ses.name) ?? 0;
        out.push({ session: ses, date: iso, sameClass: same,
          label: day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
          free: ses.max == null ? null : ses.max - n });
      }
    }
    return out.sort((a, c) => Number(c.sameClass) - Number(a.sameClass) || a.date.localeCompare(c.date)
      || a.session.time.localeCompare(c.session.time));
  });

  protected async book(o: { session: Session; date: string }) {
    const b = this.booking();
    if (!b || this.bulk()) return;
    this.bulk.set(true);
    try {
      const m = await this.api.book(b.student.id, b.from.session.name, b.date, o.session.name, o.date, this.bookNote());
      const st = this.store.students().find(x => x.id === b.student.id);
      this.booked.set({
        name: b.student.name, parent: st?.parent ?? '', phone: st?.phone ?? '',
        text: coverMessage({
          parent: st?.parent ?? '', student: b.student.name, academy: this.store.settings().academyName,
          fromSession: m.fromSession, fromCategory: b.from.session.category, fromDate: m.fromDate,
          toSession: m.toSession, toDate: m.toDate, toTime: o.session.time, reason: this.bookNote(),
        }),
      });
      await this.load(false);
      this.loadMakeups();
      this.toast.show(`Cover-up booked: ${b.student.name} → ${m.toLabel}.`);
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not book the cover-up.'));
    } finally {
      this.bulk.set(false);
    }
  }

  /** after booking: the confirmation for the parent */
  protected readonly booked = signal<{ name: string; parent: string; phone: string; text: string } | null>(null);

  protected copyMsg(text: string) {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Message copied.'), () => this.toast.show('Could not copy.'));
  }

  protected closeBooking() {
    this.booking.set(null);
    this.booked.set(null);
  }

  protected async cancelMakeup(id: string | null, name: string) {
    if (!id || !await this.dialog.confirm(`Cancel the cover-up for ${name}? Their missed class goes back to absent.`)) return;
    try {
      await this.api.cancelMakeup(id);
      await this.load(false);
      this.loadMakeups();
      this.toast.show('Cover-up cancelled.');
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not cancel the cover-up.'));
    }
  }

  protected async loadMakeups() {
    if (this.teacher) return;
    try {
      this.makeups.set(await this.api.makeups(this.date().slice(0, 7)));
    } catch {
      this.makeups.set([]);
    }
  }

  /** open the day of a cover-up from the list */
  protected goTo(date: string, session: string) {
    this.showMakeups.set(false);
    this.date.set(date);
    this.load(false).then(() => this.selected.set(session));
  }

  /* ---------------- month ---------------- */

  protected setTab(t: Tab) {
    this.tab.set(t);
    if (t === 'month') {
      if (!this.monthSession()) this.monthSession.set(this.current()?.session.name || this.day()?.classes[0]?.session.name || '');
      this.loadMonth();
    }
  }

  protected async loadMonth() {
    // a day without classes: start on the first session there is
    if (!this.monthSession()) this.monthSession.set(this.store.sessions()[0]?.name ?? '');
    if (!this.monthSession()) return;
    try {
      this.month.set(await this.api.month(this.monthSession(), this.monthKey()));
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not load the month.'));
    }
  }

  protected shiftMonth(by: number) {
    const [y, m] = this.monthKey().split('-').map(Number);
    const d = new Date(y, m - 1 + by, 1);
    this.monthKey.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    this.loadMonth();
  }

  protected setMonthSession(name: string) {
    this.monthSession.set(name);
    this.loadMonth();
  }

  /** open that day in the Day tab, to correct a mark */
  protected openDay(date: string) {
    this.tab.set('day');
    this.selected.set(this.monthSession());
    this.date.set(date);
    this.load(false).then(() => this.selected.set(this.monthSession()));
  }

  protected print() {
    window.print();
  }

  /* ---------------- display ---------------- */

  protected colour(category: string) {
    return classColour(category);
  }

  protected label(m: Mark | null) {
    return m === 'P' ? 'P' : m === 'L' ? 'L' : m === 'A' ? 'ab' : m === 'M' ? 'MU' : '';
  }

  protected prettyDay(iso: string) {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  protected time(iso: string | null) {
    return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }

  protected startLabel(c: RollClass) {
    return c.time.split(/\s*[-–]\s*/)[0];
  }

  protected percent(c: RollClass) {
    const n = c.students.length;
    return n ? Math.round(((n - c.unmarked) / n) * 100) : 0;
  }

  protected isSaving(id: string) {
    return this.saving().has(id);
  }
}

function recount(c: RollClass): RollClass {
  let present = 0, late = 0, absent = 0, unmarked = 0, madeUp = 0;
  for (const s of c.students) {
    if (s.status === 'P') present++; else if (s.status === 'L') late++; else if (s.status === 'A') absent++;
    else if (s.status === 'M') madeUp++; else unmarked++;
  }
  return { ...c, present, late, absent, unmarked, madeUp };
}

function isoToday(): string {
  // Sri Lanka's date, whatever the device's own time zone
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
