import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { MeOut, TeacherApi, TodayClass } from '../../core/teachers';

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
 * The phone's location is checked on the server
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
  protected readonly message = signal<{ text: string; ok: boolean; slotId?: string } | null>(null);

  private fix: Fix | null = null;

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });
  protected readonly name = computed(() => this.me()?.teacher.name || this.auth.teacherName() || 'Teacher');
  /** classes marked today (by the teacher, or ticked by the office) */
  protected readonly done = computed(() => (this.me()?.today ?? []).filter(c => c.state === 'COMPLETE').length);
  /** classes that can be marked right now */
  protected readonly open = computed(() => (this.me()?.today ?? []).filter(c => c.state === 'OPEN'));
  /** why there is no button to tap right now, if there isn't one */
  protected readonly nothingOpen = computed(() => {
    const m = this.me();
    if (!m || !m.today.length || this.open().length || m.holiday?.classOff) return '';
    const later = m.today.find(c => c.state === 'LATER');
    if (later) return `No class can be marked yet. The next one, ${later.slot.label}, opens at ${later.opensAt}.`;
    return '';
  });


  /** the class waiting for the teacher's "are you sure?" */
  protected readonly confirming = signal<TodayClass | null>(null);

  private watchId: number | null = null;

  constructor() {
    this.load();
    this.locate();
    this.watch();
    // class windows open and close through the day
    const t = setInterval(() => this.load(), 60_000);
    // keep the location fresh only while the page is on screen (saves the battery)
    const onVisible = () => document.hidden ? this.unwatch() : this.watch();
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      this.unwatch();
    });
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

  protected locate(maximumAge = 0): Promise<Fix | null> {
    if (!window.isSecureContext) { this.where.set({ kind: 'insecure' }); return Promise.resolve(null); }
    if (!('geolocation' in navigator)) { this.where.set({ kind: 'failed', message: 'This browser cannot share its location.' }); return Promise.resolve(null); }
    if (!this.fix) this.where.set({ kind: 'looking' });
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
        { enableHighAccuracy: true, timeout: 20_000, maximumAge },
      );
    });
  }

  /**
   * Follows the phone's location while the page is open, so a reading is already there when
   * "Check in" is tapped. Waiting for a brand-new GPS fix at the tap took several seconds.
   */
  private watch() {
    if (this.watchId != null || !window.isSecureContext || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      p => {
        this.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
        this.updateWhere();
      },
      () => { /* locate() reports problems; the watch just stays quiet */ },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
  }

  private unwatch() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /** a reading from the last two minutes, or a new one (a reading from the last minute is fine) */
  private current(): Promise<Fix | null> {
    return this.fix && Date.now() - this.fix.at < 120_000 ? Promise.resolve(this.fix) : this.locate(60_000);
  }

  private updateWhere() {
    const me = this.me(), f = this.fix;
    if (!f) return;
    if (!me?.siteSet || me.siteLat == null || me.siteLng == null) { this.where.set({ kind: 'unknown', accuracy: f.accuracy }); return; }
    const metres = distance(f.lat, f.lng, me.siteLat, me.siteLng);
    const near = metres <= me.radius + Math.min(f.accuracy, 75);
    this.where.set({ kind: near ? 'here' : 'away', metres, accuracy: f.accuracy });
    if (near) void this.report(f);
  }

  /* ---------------- reported at the academy ---------------- */

  /** the "you reported at …" pop-up, with the time */
  protected readonly welcome = signal<string | null>(null);
  private reporting = false;
  private reportTriedAt = 0;

  /**
   * The first time today the phone is at the academy, the server notes the time (its own clock)
   * as the teacher's reported time, and a thank-you pop-up shows it. Once a day; a failed try is
   * repeated at most every 30 seconds while the page is open.
   */
  private async report(f: Fix) {
    const me = this.me();
    if (!me || me.arrivedAt || this.reporting || Date.now() - this.reportTriedAt < 30_000) return;
    this.reporting = true;
    this.reportTriedAt = Date.now();
    try {
      const after = await this.api.arrive(f.lat, f.lng, f.accuracy);
      this.me.set(after);
      if (after.arrivedAt) {
        this.welcome.set(this.time(after.arrivedAt));
        navigator.vibrate?.([60, 80, 60]);
      }
    } catch {
      /* not close enough yet, or no signal: tried again on a later reading */
    } finally {
      this.reporting = false;
    }
  }

  protected closeWelcome() {
    this.welcome.set(null);
  }

  /* ---------------- mark a class ---------------- */

  /** "Mark attended" first asks the teacher to confirm they really taught the class. */
  protected askMark(c: TodayClass) {
    if (this.busy()) return;
    this.message.set(null);
    this.confirming.set(c);
    // get the location ready while they read the question
    if (!this.fix || Date.now() - this.fix.at > 60_000) void this.locate(60_000);
  }

  protected cancelMark() {
    this.confirming.set(null);
  }

  protected confirmMark() {
    const c = this.confirming();
    this.confirming.set(null);
    if (c) void this.mark(c);
  }

  /** Marks the class as taught, at the academy (any time from shortly before it until the end of the day). */
  private async mark(c: TodayClass) {
    if (this.busy()) return;
    this.busy.set(c.slot.id);
    this.message.set(null);
    try {
      const f = await this.current();
      if (!f) {
        this.message.set({ text: 'Your phone did not share its location. ' + this.whereHelp(), ok: false, slotId: c.slot.id });
        return;
      }
      this.me.set(await this.api.checkIn(c.slot.id, f.lat, f.lng, f.accuracy));
      this.updateWhere();
      this.message.set({ text: `✓ ${c.slot.label} marked. Thank you!`, ok: true, slotId: c.slot.id });
      navigator.vibrate?.(60);
    } catch (e) {
      this.message.set({ text: errorMessage(e, 'Could not mark the class.'), ok: false, slotId: c.slot.id });
    } finally {
      this.busy.set('');
    }
  }

  /** Takes back a mark made by mistake (today only, their own). */
  protected async undo(c: TodayClass) {
    if (this.busy()) return;
    this.busy.set(c.slot.id);
    this.message.set(null);
    try {
      this.me.set(await this.api.unmark(c.slot.id));
      this.message.set({ text: `${c.slot.label} is no longer marked.`, ok: true, slotId: c.slot.id });
    } catch (e) {
      this.message.set({ text: errorMessage(e, 'Could not change the mark.'), ok: false, slotId: c.slot.id });
    } finally {
      this.busy.set('');
    }
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
