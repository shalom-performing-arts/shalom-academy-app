import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api';
import { Store } from '../../core/store';
import {
  ClassOut, DAYS, DayOut, Holiday, PayLine, SalaryOut, SetupOut, SheetOut, Site, Slot, Teacher, TeacherApi, clock12, shiftPeriod,
} from '../../core/teachers';
import { Toast } from '../../core/toast';
import { money } from '../../receipt/format';

type Tab = 'attendance' | 'salary' | 'setup';

interface TeacherEdit { id: string | null; name: string; phone: string; colour: string; active: boolean }
interface PinShown { teacher: Teacher; pin: string }

const TEACHER_COLOURS = ['#e8457c', '#3567e8', '#0f9f6e', '#7c3aed', '#e07a10', '#0e9aa7', '#b4447a'];

/**
 * Teacher attendance and salary for the office — the app version of the attendance workbook.
 * Attendance is ticked per class (or comes from teachers checking in on their phones), and
 * the salary for each pay period (26th to 25th) is worked out from it.
 */
@Component({
  selector: 'app-teachers',
  imports: [FormsModule],
  templateUrl: './teachers.html',
  styleUrl: './teachers.css',
})
export class Teachers {
  private api = inject(TeacherApi);
  private toast = inject(Toast);
  private host = inject(ElementRef<HTMLElement>);
  private injector = inject(Injector);
  protected store = inject(Store);

  protected readonly money = money;
  protected readonly abs = Math.abs;
  protected readonly clock12 = clock12;
  protected readonly DAYS = DAYS;
  protected readonly COLOURS = TEACHER_COLOURS;

  protected readonly tab = signal<Tab>('attendance');
  protected readonly period = signal('');
  protected readonly sheet = signal<SheetOut | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal('');
  protected readonly showPast = signal(false);

  /* setup */
  protected readonly setup = signal<SetupOut | null>(null);
  protected readonly editing = signal<TeacherEdit | null>(null);
  protected readonly pinShown = signal<PinShown | null>(null);
  protected readonly locating = signal(false);

  constructor() {
    this.load();
  }

  protected readonly teachers = computed(() => this.sheet()?.teachers ?? []);
  protected readonly salary = computed(() => this.sheet()?.salary ?? null);

  /** the people shown on each class: active teachers, plus anyone inactive who was ticked */
  protected readonly classTeachers = computed(() => {
    // anyone switched off since still shows for a period they taught in, so their ticks stay visible
    const taught = new Set((this.sheet()?.days ?? []).flatMap(d => d.classes.flatMap(c => c.teachers.map(w => w.teacherId))));
    return this.teachers().filter(t => t.active || taught.has(t.id));
  });

  protected readonly days = computed(() => {
    const all = this.sheet()?.days ?? [];
    if (this.showPast()) return all;
    // a period still running opens on this week; earlier days are one tap away
    const today = all.findIndex(d => d.today);
    if (today < 0) return all;
    const from = Math.max(0, today - 3);
    return all.slice(from);
  });
  protected readonly hiddenDays = computed(() => (this.sheet()?.days.length ?? 0) - this.days().length);

  /* ---------------- the one-page grid: classes down, weeks across ---------------- */

  /** the grid (a week at a time on a phone), or the day-by-day list */
  protected readonly layout = signal<'grid' | 'list'>('grid');

  /** a phone-sized screen: the grid shows one week at a time */
  protected readonly phone = signal(false);
  /** the week shown on a phone; -1 = this week (or the first) */
  protected readonly mWeek = signal(-1);

  private readonly watchPhone = (() => {
    const mq = window.matchMedia('(max-width: 720px)');
    this.phone.set(mq.matches);
    const on = (e: MediaQueryListEvent) => this.phone.set(e.matches);
    mq.addEventListener('change', on);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', on));
    return true;
  })();

  /** the week on show on a phone, with its days and classes */
  protected readonly week = computed(() => {
    const g = this.grid(), s = this.sheet();
    if (!g || !s) return null;
    const pick = this.mWeek();
    const index = pick >= 0 && pick < g.weeks.length ? pick : Math.max(0, g.weeks.findIndex(w => w.now));
    const start = new Date(s.from + 'T12:00:00');
    const weekOf = (iso: string) => Math.floor((new Date(iso + 'T12:00:00').getTime() - start.getTime()) / (7 * 864e5));
    const days = s.days.filter(d => weekOf(d.date) === index);
    const totals = this.classTeachers().map(t => ({
      t, n: days.reduce((n, d) => n + d.classes.filter(c => this.marked(c, t.id)).length, 0),
    }));
    return { index, info: g.weeks[index], days, totals };
  });

  protected readonly grid = computed(() => {
    const s = this.sheet();
    if (!s) return null;
    const start = new Date(s.from + 'T12:00:00');
    const weekOf = (iso: string) => Math.floor((new Date(iso + 'T12:00:00').getTime() - start.getTime()) / (7 * 864e5));
    const weekCount = weekOf(s.to) + 1;
    const weeks = Array.from({ length: weekCount }, (_, w) => {
      const a = new Date(start.getTime() + w * 7 * 864e5), b = new Date(Math.min(a.getTime() + 6 * 864e5, new Date(s.to + 'T12:00:00').getTime()));
      const days = s.days.filter(d => weekOf(d.date) === w);
      return { index: w, label: w < 4 ? `Week ${w + 1}` : 'Extra days', range: `${short(a)} – ${short(b)}`, now: days.some(d => d.today) };
    });
    // one row per class in the timetable (and any removed class that still has ticks)
    const slots = new Map<string, { slot: Slot; time: string; removed: boolean }>();
    for (const d of s.days) for (const c of d.classes) if (!slots.has(c.slot.id)) slots.set(c.slot.id, { slot: c.slot, time: c.time, removed: c.removed });
    const rows = [...slots.values()]
      .sort((a, b) => DAYS.indexOf(a.slot.day) - DAYS.indexOf(b.slot.day) || (a.slot.start || '').localeCompare(b.slot.start || ''))
      .map(r => ({
        ...r,
        cells: weeks.map(w => {
          const day = s.days.find(d => weekOf(d.date) === w.index && d.classes.some(c => c.slot.id === r.slot.id));
          const cls = day?.classes.find(c => c.slot.id === r.slot.id) ?? null;
          return day && cls ? { day, cls } : null;
        }),
      }));
    // a heading row wherever the weekday changes
    const withDays: ({ kind: 'day'; day: string } | ({ kind: 'row' } & typeof rows[number]))[] = [];
    let last = '';
    for (const r of rows) {
      if (r.slot.day !== last) { withDays.push({ kind: 'day', day: r.slot.day }); last = r.slot.day; }
      withDays.push({ kind: 'row', ...r });
    }
    return { weeks, rows: withDays };
  });

  /** how many of this class a teacher took in the period */
  protected rowCount(cells: ({ cls: ClassOut } | null)[], teacherId: string): number {
    return cells.reduce((n, c) => n + (c && this.marked(c.cls, teacherId) ? 1 : 0), 0);
  }

  protected readonly todayStats = computed(() => {
    const d = this.sheet()?.days.find(x => x.today);
    if (!d) return null;
    const ticks = d.classes.reduce((t, c) => t + c.teachers.length, 0);
    const self = d.classes.reduce((t, c) => t + c.teachers.filter(w => w.method === 'self').length, 0);
    return { classes: d.classes.length, ticks, self, holiday: d.holiday };
  });

  /* ---------------- loading ---------------- */

  protected async load(period?: string) {
    this.loading.set(true);
    try {
      const s = await this.api.sheet(period);
      this.sheet.set(s);
      this.period.set(s.period);
      if (!period) afterNextRender(() => this.scrollToToday(), { injector: this.injector });
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not load the attendance.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected shift(by: number) {
    this.mWeek.set(-1);   // a new period opens on its current (or first) week
    this.load(shiftPeriod(this.period(), by));
  }

  protected scrollToToday() {
    (this.host.nativeElement as HTMLElement).querySelector('.tc-day.is-today')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected setTab(t: Tab) {
    this.tab.set(t);
    if (t === 'setup' && !this.setup()) this.loadSetup();
  }

  /* ---------------- attendance ---------------- */

  protected marked(c: ClassOut, teacherId: string) {
    return c.teachers.find(w => w.teacherId === teacherId) ?? null;
  }

  protected async toggle(d: DayOut, c: ClassOut, t: Teacher) {
    const key = d.date + c.slot.id + t.id;
    if (this.saving()) return;
    const was = this.marked(c, t.id);
    let on = !was;
    if (was?.method === 'self' && !was.finished) {
      // checked in but never marked done: the office can confirm the class was taught, or remove it
      if (confirm(`${t.name} checked in for ${c.slot.label} at ${this.time(was.at)} but has not marked it done.\n\n`
        + `OK — confirm the class was taught.\nCancel — leave it, or remove it next.`)) {
        on = true;
      } else if (confirm(`Remove ${t.name}'s check-in for ${c.slot.label}? They will not be paid for it.`)) {
        on = false;
      } else {
        return;
      }
    } else if (was?.method === 'self' && !confirm(`${t.name} checked in for ${c.slot.label} at ${this.time(was.at)}`
      + ` and marked it done at ${this.time(was.doneAt)}.\n\nRemove it anyway?`)) {
      return;
    }
    this.saving.set(key);
    try {
      this.sheet.set(await this.api.mark(d.date, c.slot.id, t.id, on));
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not save that.'));
    } finally {
      this.saving.set('');
    }
  }

  protected whoTitle(c: ClassOut, t: Teacher): string {
    const w = this.marked(c, t.id);
    if (!w) return `Tick if ${t.name} took this class`;
    if (w.method !== 'self') return 'Ticked by the office';
    const inAt = `${t.name} checked in at the academy at ${this.time(w.at)}${w.distance != null ? ` (${Math.round(w.distance)} m away)` : ''}`;
    if (!w.finished) return `${inAt}.\nNot marked done yet — tap to confirm the class was taught.`;
    return `${inAt}.\nMarked done at ${this.time(w.doneAt)}${w.note ? `: “${w.note}”` : ''}`;
  }

  /** a teacher checked in but the class ended without them marking it done */
  protected pendingDone(d: DayOut, c: ClassOut, w: { method: string; finished: boolean } | null): boolean {
    return !!w && w.method === 'self' && !w.finished;
  }

  /** what teachers wrote when marking the class done */
  protected notesOf(c: ClassOut): { name: string; colour: string; note: string }[] {
    return c.teachers.filter(w => w.note && w.note !== 'Confirmed by the office')
      .map(w => ({ name: this.teachers().find(t => t.id === w.teacherId)?.name ?? w.teacherId, colour: this.teacherColour(w.teacherId), note: w.note! }));
  }

  /** the student session this class matches, e.g. "Forte" for Kids at 3:30 on Wednesday */
  protected sessionName(s: Slot): string {
    const start = clock12(s.start).replace(/ (AM|PM)$/, '');
    return this.store.sessions().find(x => x.category === s.category && x.day === s.day
      && (x.time || '').replace(/\s/g, '').startsWith(start.replace(/\s/g, '')))?.name ?? '';
  }

  protected colour(category: string): string {
    return this.store.colour(category);
  }

  protected teacherColour(id: string): string {
    return this.teachers().find(t => t.id === id)?.colour ?? '#8e2b52';
  }

  protected dayTicks(d: DayOut) {
    return d.classes.reduce((n, c) => n + c.teachers.length, 0);
  }

  /* ---------------- salary ---------------- */

  protected async adjust(l: PayLine, amount: string, note: string) {
    const n = amount.trim() === '' ? 0 : Number(amount);
    if (Number.isNaN(n)) { this.toast.show('Enter the adjustment as a number, e.g. -2500 or 1000.'); return; }
    if (n === l.adjustment && note.trim() === l.adjustmentNote) return;
    await this.saveSalary(() => this.api.adjust(this.period(), l.teacherId, n, note), `Adjustment for ${l.name} saved.`);
  }

  protected async setPaid(l: PayLine, paid: boolean) {
    if (!paid && !confirm(`Mark ${l.name}'s salary as not paid?`)) return;
    await this.saveSalary(() => this.api.paid(this.period(), l.teacherId, paid),
      paid ? `${l.name}'s salary marked as paid.` : `${l.name}'s salary marked as not paid.`);
  }

  private async saveSalary(call: () => Promise<SalaryOut>, done: string) {
    try {
      const salary = await call();
      this.sheet.update(s => s ? { ...s, salary } : s);
      this.toast.show(done);
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not save that.'));
    }
  }

  protected async exportSalary() {
    try {
      await this.api.downloadSalary(this.period());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not export.'));
    }
  }

  /* ---------------- setup ---------------- */

  protected async loadSetup() {
    try {
      this.setup.set(await this.api.setup());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not load the setup.'));
    }
  }

  protected patchSetup(p: Partial<SetupOut>) {
    this.setup.update(s => s ? { ...s, ...p } : s);
  }

  protected async saveSetup(part: 'rates' | 'schedule' | 'holidays' | 'site') {
    const s = this.setup();
    if (!s) return;
    this.saving.set(part);
    try {
      this.setup.set(await this.api.saveSetup({ [part]: s[part] }));
      this.toast.show({ rates: 'Rates saved.', schedule: 'Timetable saved.', holidays: 'Holidays saved.', site: 'Academy location saved.' }[part]);
      this.load(this.period());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not save.'));
    } finally {
      this.saving.set('');
    }
  }

  /* teachers */

  protected newTeacher() {
    const used = new Set((this.setup()?.teachers ?? []).map(t => t.colour));
    this.editing.set({ id: null, name: '', phone: '', colour: TEACHER_COLOURS.find(c => !used.has(c)) ?? TEACHER_COLOURS[0], active: true });
  }

  protected editTeacher(t: Teacher) {
    this.editing.set({ id: t.id, name: t.name, phone: t.phone, colour: t.colour, active: t.active });
  }

  protected patchEdit(p: Partial<TeacherEdit>) {
    this.editing.update(e => e ? { ...e, ...p } : e);
  }

  protected async saveTeacher() {
    const e = this.editing();
    if (!e) return;
    if (!e.name.trim()) { this.toast.show('Enter the teacher\'s name.'); return; }
    this.saving.set('teacher');
    try {
      const t = await this.api.saveTeacher(e.id, e);
      this.editing.set(null);
      await this.loadSetup();
      this.load(this.period());
      this.toast.show(e.id ? `${t.name} saved.` : `${t.name} added. Give them a PIN so they can check in.`);
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not save the teacher.'));
    } finally {
      this.saving.set('');
    }
  }

  protected async removeTeacher(t: Teacher) {
    if (!confirm(`Remove ${t.name}?`)) return;
    try {
      await this.api.deleteTeacher(t.id);
      this.editing.set(null);
      await this.loadSetup();
      this.load(this.period());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not remove.'));
    }
  }

  protected async newPin(t: Teacher, typed = '') {
    if (t.hasPin && !typed && !confirm(`Give ${t.name} a new PIN? Their old PIN stops working and their phone is signed out.`)) return;
    try {
      const { pin } = await this.api.setPin(t.id, typed);
      this.pinShown.set({ teacher: t, pin });
      await this.loadSetup();
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not set the PIN.'));
    }
  }

  /** where a teacher opens the app on their phone */
  protected signInLink(): string {
    return `${location.origin}/login?as=teacher`;
  }

  /** the sign-in link and PIN, copied to paste into the teacher's WhatsApp chat */
  protected copyPin(p: PinShown) {
    const text = `Hi ${p.teacher.name}! 🎵\n\nYou can now check in for your classes at Shalom Academy from your phone.\n\n` +
      `1. Open ${this.signInLink()}\n2. Tap "Teacher", pick your name\n3. Your PIN is *${p.pin}*\n\n` +
      `When you arrive at the academy, tap "Check in" on each class. (Allow location when your phone asks.)`;
    navigator.clipboard?.writeText(text).then(() => this.toast.show(`Message copied — paste it into ${p.teacher.name}'s chat.`),
      () => this.toast.show('Could not copy.'));
  }

  protected copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Copied.'), () => this.toast.show(text));
  }

  /* timetable */

  protected readonly scheduleByDay = computed(() => {
    const s = this.setup();
    if (!s) return [];
    return DAYS.map(day => ({ day, slots: s.schedule.map((x, i) => ({ x, i })).filter(r => r.x.day === day)
      .sort((a, b) => a.x.start.localeCompare(b.x.start)) })).filter(d => d.slots.length);
  });

  protected readonly categoryOptions = computed(() =>
    Array.from(new Set([...this.store.categories().map(c => c.name), ...(this.setup()?.schedule ?? []).map(s => s.category), 'Choir']
      .filter(Boolean))));

  protected patchSlot(i: number, p: Partial<Slot>) {
    this.setup.update(s => s ? { ...s, schedule: s.schedule.map((x, j) => j === i ? { ...x, ...p } : x) } : s);
  }

  protected addSlot(day = 'Saturday') {
    this.setup.update(s => s ? { ...s, schedule: [...s.schedule, { id: '', day, start: '09:00', minutes: 60, category: 'Kids', label: 'Kids' }] } : s);
  }

  protected removeSlot(i: number) {
    this.setup.update(s => s ? { ...s, schedule: s.schedule.filter((_, j) => j !== i) } : s);
  }

  /* holidays */

  protected patchHoliday(i: number, p: Partial<Holiday>) {
    this.setup.update(s => s ? { ...s, holidays: s.holidays.map((x, j) => j === i ? { ...x, ...p } : x) } : s);
  }

  protected addHoliday() {
    const today = new Date().toISOString().slice(0, 10);
    this.setup.update(s => s ? { ...s, holidays: [...s.holidays, { date: today, name: '', classOff: true }] } : s);
  }

  protected removeHoliday(i: number) {
    this.setup.update(s => s ? { ...s, holidays: s.holidays.filter((_, j) => j !== i) } : s);
  }

  protected isPast(date: string) {
    return date < new Date().toISOString().slice(0, 10);
  }

  /* location */

  protected patchSite(p: Partial<Site>) {
    this.setup.update(s => s ? { ...s, site: { ...s.site, ...p } } : s);
  }

  /** Stand in the academy and tap: this device's GPS becomes the academy's spot. */
  protected useHere() {
    if (!window.isSecureContext || !navigator.geolocation) {
      this.toast.show('Location needs the app opened over https (or on this computer at localhost).');
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(p => {
      this.locating.set(false);
      this.patchSite({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) });
      this.toast.show(`Location found (±${Math.round(p.coords.accuracy)} m). Press Save to keep it.`);
    }, () => {
      this.locating.set(false);
      this.toast.show('Could not get this device\'s location.');
    }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  }

  protected mapLink(s: Site): string {
    return `https://www.google.com/maps?q=${s.lat},${s.lng}`;
  }

  /* ---------------- display ---------------- */

  protected time(iso: string | null): string {
    return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected initial(name: string) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  protected dayNum(iso: string) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
}

function short(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
