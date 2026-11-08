import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { MeOut, TeacherApi, TodayClass } from '../../core/teachers';
import { money } from '../../receipt/format';

type Where =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'here'; metres: number; accuracy: number }
  | { kind: 'away'; metres: number; accuracy: number }
  | { kind: 'unknown'; accuracy: number }            // located, but the academy's spot is not set
  | { kind: 'blocked' }
  | { kind: 'insecure' }
  | { kind: 'failed'; message: string };

interface Fix { lat: number; lng: number; accuracy: number; at: number }

const CATEGORY_COLOURS: Record<string, string> = {
  kids: '#e8457c', junior: '#3567e8', youth: '#0f9f6e', adult: '#7c3aed', online: '#e07a10', choir: '#0e9aa7',
};

/**
 * A teacher's phone at the academy: today's classes, one big button to check in to each,
 * and what this pay period comes to so far. The phone's location is checked on the server
 * too, so the button only works at the academy.
 */
@Component({
  selector: 'app-checkin',
  imports: [RouterLink],
  templateUrl: './checkin.html',
  styleUrl: './checkin.css',
})
export class CheckIn {
  private api = inject(TeacherApi);
  protected auth = inject(Auth);

  protected readonly me = signal<MeOut | null>(null);
  protected readonly loadError = signal('');
  protected readonly where = signal<Where>({ kind: 'idle' });
  protected readonly busy = signal('');          // slot id being checked in
  protected readonly message = signal<{ text: string; ok: boolean } | null>(null);
  protected readonly money = money;

  private fix: Fix | null = null;

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });
  protected readonly name = computed(() => this.me()?.teacher.name || this.auth.teacherName() || 'Teacher');
  /** classes finished today (marked done, or ticked by the office) */
  protected readonly done = computed(() => (this.me()?.today ?? []).filter(c => c.state === 'COMPLETE').length);
  /** classes with something to tap right now: check in, or mark done */
  protected readonly open = computed(() => (this.me()?.today ?? []).filter(c => c.state === 'OPEN' || c.state === 'FINISH'));
  protected readonly toFinish = computed(() => (this.me()?.today ?? []).filter(c => c.state === 'FINISH'));
  /** why there is no button to tap right now, if there isn't one */
  protected readonly nothingOpen = computed(() => {
    const m = this.me();
    if (!m || !m.today.length || this.open().length || m.holiday?.classOff) return '';
    const inClass = m.today.find(c => c.state === 'IN_CLASS');
    if (inClass) return `You're in ${inClass.slot.label}. Come back when it ends — you can mark it done from ${inClass.doneOpensAt}.`;
    const later = m.today.find(c => c.state === 'LATER');
    if (later) return `No class is open for check-in yet. The next one, ${later.slot.label}, opens at ${later.opensAt}.`;
    if (m.today.every(c => c.state === 'COMPLETE')) return '';
    return 'Check-in for today\'s classes has closed. If you taught a class and could not check in, ask the office to add it.';
  });

  /** what each class covered, typed before marking it done */
  protected readonly notes = signal<Record<string, string | undefined>>({});
  protected readonly classes = computed(() => this.me()?.pay ? this.me()!.pay!.weekday + this.me()!.pay!.weekend : 0);

  constructor() {
    this.load();
    this.locate();
    // class windows open and close through the day
    const t = setInterval(() => this.load(), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  protected async load() {
    try {
      this.me.set(await this.api.me());
      this.loadError.set('');
      this.updateWhere();
    } catch (e) {
      this.loadError.set(errorMessage(e, 'Could not load your classes.'));
    }
  }

  /* ---------------- where am I ---------------- */

  protected locate(): Promise<Fix | null> {
    if (!window.isSecureContext) { this.where.set({ kind: 'insecure' }); return Promise.resolve(null); }
    if (!('geolocation' in navigator)) { this.where.set({ kind: 'failed', message: 'This browser cannot share its location.' }); return Promise.resolve(null); }
    this.where.set({ kind: 'looking' });
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        p => {
          this.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
          this.updateWhere();
          resolve(this.fix);
        },
        err => {
          this.where.set(err.code === err.PERMISSION_DENIED ? { kind: 'blocked' }
            : { kind: 'failed', message: err.code === err.TIMEOUT ? 'Finding your location took too long.' : 'Your location could not be found.' });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
      );
    });
  }

  private updateWhere() {
    const me = this.me(), f = this.fix;
    if (!f) return;
    if (!me?.siteSet || me.siteLat == null || me.siteLng == null) { this.where.set({ kind: 'unknown', accuracy: f.accuracy }); return; }
    const metres = distance(f.lat, f.lng, me.siteLat, me.siteLng);
    const near = metres <= me.radius + Math.min(f.accuracy, 75);
    this.where.set({ kind: near ? 'here' : 'away', metres, accuracy: f.accuracy });
  }

  /* ---------------- check in ---------------- */

  protected async checkIn(c: TodayClass) {
    if (this.busy()) return;
    this.busy.set(c.slot.id);
    this.message.set(null);
    try {
      // a reading older than two minutes is taken again, so the check-in is where they are now
      const f = this.fix && Date.now() - this.fix.at < 120_000 ? this.fix : await this.locate();
      if (!f) {
        this.message.set({ text: 'Your phone did not share its location. ' + this.whereHelp(), ok: false });
        return;
      }
      this.me.set(await this.api.checkIn(c.slot.id, f.lat, f.lng, f.accuracy));
      this.updateWhere();
      this.message.set({ text: `✓ Checked in to ${c.slot.label} at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Have a lovely class!`, ok: true });
      navigator.vibrate?.(60);
    } catch (e) {
      this.message.set({ text: errorMessage(e, 'Could not check in.'), ok: false });
    } finally {
      this.busy.set('');
    }
  }

  /** After the class: confirm it was taught, at the academy, with what was covered. */
  protected async finish(c: TodayClass) {
    if (this.busy()) return;
    this.busy.set(c.slot.id);
    this.message.set(null);
    try {
      const f = this.fix && Date.now() - this.fix.at < 120_000 ? this.fix : await this.locate();
      if (!f) {
        this.message.set({ text: 'Your phone did not share its location. ' + this.whereHelp(), ok: false });
        return;
      }
      this.me.set(await this.api.finish(c.slot.id, f.lat, f.lng, f.accuracy, this.notes()[c.slot.id] ?? ''));
      this.updateWhere();
      this.message.set({ text: `🎉 ${c.slot.label} marked as done. Thank you!`, ok: true });
      navigator.vibrate?.([40, 60, 40]);
    } catch (e) {
      this.message.set({ text: errorMessage(e, 'Could not mark the class done.'), ok: false });
    } finally {
      this.busy.set('');
    }
  }

  protected setNote(slotId: string, text: string) {
    this.notes.update(n => ({ ...n, [slotId]: text }));
  }

  protected whereHelp(): string {
    switch (this.where().kind) {
      case 'blocked': return 'Location is blocked for this site — allow it in your browser settings, then tap "Find me again".';
      case 'insecure': return 'Location only works when the app is opened over https.';
      default: return 'Turn on location (GPS) and try again.';
    }
  }

  /* ---------------- display ---------------- */

  protected colour(category: string): string {
    return CATEGORY_COLOURS[(category || '').toLowerCase()] ?? '#8e2b52';
  }

  protected km(m: number): string {
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  }

  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected time(iso: string | null): string {
    return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }
}

/** metres between two points */
function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6_371_000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = p2 - p1, dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
