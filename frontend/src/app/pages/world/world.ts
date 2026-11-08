import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

/**
 * Sri Lanka against the countries the online students live in. Canada, the USA and Australia
 * span several time zones, so each shows its two main ones. Summer time is handled by the
 * browser's own time-zone data, so the differences stay right all year.
 */
interface Place { city: string; country: string; code: string; tz: string; colour: string }

const HOME: Place = { city: 'Colombo', country: 'Sri Lanka', code: 'LK', tz: 'Asia/Colombo', colour: '#8e2b52' };
const PLACES: Place[] = [
  { city: 'London', country: 'United Kingdom', code: 'UK', tz: 'Europe/London', colour: '#3567e8' },
  { city: 'Toronto', country: 'Canada', code: 'CA', tz: 'America/Toronto', colour: '#e5484d' },
  { city: 'Vancouver', country: 'Canada', code: 'CA', tz: 'America/Vancouver', colour: '#e5484d' },
  { city: 'New York', country: 'USA', code: 'US', tz: 'America/New_York', colour: '#7c3aed' },
  { city: 'Los Angeles', country: 'USA', code: 'US', tz: 'America/Los_Angeles', colour: '#7c3aed' },
  { city: 'Sydney', country: 'Australia', code: 'AU', tz: 'Australia/Sydney', colour: '#0f9f6e' },
  { city: 'Perth', country: 'Australia', code: 'AU', tz: 'Australia/Perth', colour: '#0f9f6e' },
];

type Part = 'night' | 'morning' | 'day' | 'evening';

interface Clock {
  place: Place;
  h: number; m: number; s: number;
  time: string;          // "4:05 PM"
  date: string;          // "Wed 4 Nov"
  dayShift: number;      // -1 yesterday, 0 same day, +1 tomorrow (against Sri Lanka)
  diff: number;          // minutes ahead of Sri Lanka (negative = behind)
  part: Part;
  hands: { h: number; m: number; s: number };   // degrees
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MARKS = Array.from({ length: 12 }, (_, i) => i);

@Component({
  selector: 'app-world',
  template: `
    <section class="panel wc">

      <!-- ============ Sri Lanka, big ============ -->
      <div class="wc-hero" [class]="'wc-hero is-' + home().part">
        <div class="wc-hero-clock">
          <ng-container *ngTemplateOutlet="dial; context: { $implicit: home(), big: true }" />
        </div>
        <div class="wc-hero-text">
          <span class="wc-code home">LK</span>
          <h2>Sri Lanka</h2>
          <p class="wc-hero-time">{{ home().time }}</p>
          <p class="wc-hero-date">{{ longDate() }} · {{ partLabel(home().part) }}</p>
          @if (planning()) { <span class="wc-plan-flag">Planning — not the time now</span> }
        </div>
      </div>

      <!-- ============ plan a time ============ -->
      <div class="card wc-plan">
        <div class="card-head">
          <h2 data-ico="🗓️" data-tone="teal">Plan a class time</h2>
          <button type="button" class="btn btn-sm" [class.btn-primary]="!planning()" (click)="live()">
            {{ planning() ? '↺ Back to now' : '● Live now' }}</button>
        </div>
        <p class="hint wc-plan-hint">Slide to a time in <b>Sri Lanka</b> — every clock below shows what time that is for the student.</p>
        <div class="wc-slider">
          <b>{{ fmtMinutes(slMinutes()) }}</b>
          <input type="range" min="0" max="1425" step="15" [value]="slMinutes()"
                 (input)="plan(+$any($event.target).value)" aria-label="Time in Sri Lanka">
          <div class="wc-slider-scale"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>
        </div>
      </div>

      <!-- ============ the other clocks ============ -->
      <p class="wc-grid-title">Compared with Sri Lanka — <b>▲ ahead</b> means later in the day there, <b>▼ behind</b> means earlier.</p>
      <div class="wc-grid">
        @for (c of clocks(); track c.place.tz) {
          <article class="wc-card" [class]="'wc-card is-' + c.part" [style.--c]="c.place.colour">
            <header>
              <span class="wc-code">{{ c.place.code }}</span>
              <div class="wc-name"><b>{{ c.place.country }}</b><small>{{ c.place.city }}</small></div>
              <span class="wc-part" [title]="partLabel(c.part)">{{ partIcon(c.part) }}</span>
            </header>
            <div class="wc-dial-wrap">
              <ng-container *ngTemplateOutlet="dial; context: { $implicit: c, big: false }" />
            </div>
            <p class="wc-time">{{ c.time }}</p>
            <p class="wc-date">
              {{ c.date }}
              @if (c.dayShift > 0) { <em class="wc-shift">tomorrow</em> }
              @if (c.dayShift < 0) { <em class="wc-shift">yesterday</em> }
            </p>
            <p class="wc-diff" [class.ahead]="c.diff > 0" [title]="diffText(c.diff) + ' of Sri Lanka'">{{ diffText(c.diff) }}</p>
            <p class="wc-awake" [class.no]="!awake(c.h)">{{ awake(c.h) ? '✓ Good time to call' : '☾ Probably asleep' }}</p>
          </article>
        }
      </div>

      <!-- ============ a day side by side ============ -->
      <div class="card wc-day">
        <div class="card-head"><h2 data-ico="🌍" data-tone="blue">A whole day, side by side</h2></div>
        <p class="hint">Each column is one hour in Sri Lanka. The colour shows what part of the day it is for them —
          <span class="wc-key night">night</span> <span class="wc-key morning">morning</span>
          <span class="wc-key day">day</span> <span class="wc-key evening">evening</span>.
          The line marks {{ planning() ? 'the planned time' : 'now' }}; click a column to plan that hour.</p>
        <div class="wc-table">
          <div class="wc-row head">
            <span class="wc-row-name"></span>
            <div class="wc-cells">
              @for (h of HOURS; track h) { <span class="wc-cell lbl" (click)="plan(h * 60)">{{ short(h) }}</span> }
              <i class="wc-now" [style.left.%]="nowPct()"></i>
            </div>
          </div>
          @for (r of rows(); track r.place.tz) {
            <div class="wc-row" [style.--c]="r.place.colour">
              <span class="wc-row-name"><b>{{ r.place.code }}</b> {{ r.place.city }}</span>
              <div class="wc-cells">
                @for (x of r.hours; track $index) {
                  <span class="wc-cell" [class]="'wc-cell ' + x.part" [title]="r.place.city + ': ' + x.label" (click)="plan($index * 60)">{{ x.short }}</span>
                }
                <i class="wc-now" [style.left.%]="nowPct()"></i>
              </div>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- an analog clock face -->
    <ng-template #dial let-c let-big="big">
      <svg class="wc-dial" [class.big]="big" viewBox="0 0 200 200" role="img" [attr.aria-label]="c.place.city + ' ' + c.time">
        <circle class="face" cx="100" cy="100" r="94" />
        @if (c.part === 'night') {
          <circle class="star" cx="62" cy="58" r="1.6"/><circle class="star" cx="140" cy="66" r="1.2"/>
          <circle class="star" cx="132" cy="140" r="1.4"/><circle class="star" cx="58" cy="136" r="1"/>
        }
        @for (i of MARKS; track i) {
          <line class="mark" [class.q]="i % 3 === 0" x1="100" [attr.y1]="i % 3 === 0 ? 14 : 16" x2="100" [attr.y2]="i % 3 === 0 ? 30 : 24"
                [attr.transform]="'rotate(' + i * 30 + ' 100 100)'" />
        }
        <line class="hand h" x1="100" y1="108" x2="100" y2="52" [attr.transform]="'rotate(' + c.hands.h + ' 100 100)'" />
        <line class="hand m" x1="100" y1="112" x2="100" y2="32" [attr.transform]="'rotate(' + c.hands.m + ' 100 100)'" />
        @if (!planning()) {
          <line class="hand s" x1="100" y1="118" x2="100" y2="26" [attr.transform]="'rotate(' + c.hands.s + ' 100 100)'" />
        }
        <circle class="pin" cx="100" cy="100" r="5" />
      </svg>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    .wc{display:flex; flex-direction:column; gap:18px}

    /* ---- Sri Lanka ---- */
    .wc-hero{
      display:flex; align-items:center; gap:28px; padding:22px 28px; border-radius:22px; color:#fff; overflow:hidden; position:relative;
      background:linear-gradient(120deg, #6d1f3e, #a3326a 55%, #e0457b);
      box-shadow:0 18px 40px rgba(109,31,62,.28);
    }
    .wc-hero.is-night{background:linear-gradient(120deg, #170b2e, #2e1650 55%, #5b2370)}
    .wc-hero.is-evening{background:linear-gradient(120deg, #6d1f3e, #c2410c 70%, #f59e0b)}
    .wc-hero-clock{flex:none; width:190px}
    .wc-hero-text h2{margin:6px 0 0; font-family:var(--f-display); font-size:30px; letter-spacing:1px}
    .wc-hero-time{margin:2px 0 0; font-size:52px; font-weight:700; line-height:1.05; font-variant-numeric:tabular-nums; letter-spacing:-1px}
    .wc-hero-date{margin:6px 0 0; font-size:15px; opacity:.9}
    .wc-plan-flag{display:inline-block; margin-top:10px; padding:4px 12px; border-radius:999px; background:rgba(255,255,255,.22); font-size:12.5px; font-weight:700}

    /* ---- planner ---- */
    .wc-plan .card-head{margin-bottom:10px}
    .wc-plan-hint{margin:0 0 12px}
    .wc-slider{display:grid; grid-template-columns:auto 1fr; gap:4px 18px; align-items:center}
    .wc-slider > b{grid-row:span 2; font-size:26px; color:#0e8a8f; min-width:120px; font-variant-numeric:tabular-nums}
    .wc-slider input{width:100%; accent-color:#0e9aa7; height:28px}
    .wc-slider-scale{display:flex; justify-content:space-between; font-size:11.5px; color:var(--muted)}

    /* ---- country cards ---- */
    .wc-grid-title{margin:0 0 -6px; font-size:14px; color:var(--muted)}
    .wc-grid-title b{color:#3a1238}
    .wc-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:16px}
    .wc-card{
      --c:#3567e8; background:#fff; border-radius:20px; padding:16px; text-align:center;
      border:1px solid color-mix(in srgb, var(--c) 18%, #fff); border-top:5px solid var(--c);
      box-shadow:0 10px 26px color-mix(in srgb, var(--c) 10%, transparent);
    }
    .wc-card.is-night{background:linear-gradient(180deg, #1f1538, #2d1f4f); color:#f1ecff; border-color:#3a2c63}
    .wc-card header{display:flex; align-items:center; gap:10px; text-align:left}
    .wc-name{min-width:0; line-height:1.2}
    .wc-name b{display:block; font-family:var(--f-display); font-size:18px; letter-spacing:.4px}
    .wc-name small{font-size:12.5px; opacity:.7}
    .wc-part{margin-left:auto; font-size:22px}
    .wc-code{
      flex:none; display:grid; place-items:center; width:40px; height:40px; border-radius:12px;
      background:var(--c); color:#fff; font-weight:800; font-size:13px; letter-spacing:.5px;
      box-shadow:0 6px 14px color-mix(in srgb, var(--c) 35%, transparent);
    }
    .wc-code.home{display:inline-grid; background:rgba(255,255,255,.22); box-shadow:none}
    .wc-dial-wrap{width:150px; margin:12px auto 6px}
    .wc-time{margin:0; font-size:28px; font-weight:700; font-variant-numeric:tabular-nums}
    .wc-date{margin:0; font-size:13px; opacity:.75}
    .wc-shift{font-style:normal; font-weight:700; margin-left:4px; padding:1px 8px; border-radius:999px; background:#fff1d6; color:#9a5b00}
    .wc-diff{
      display:inline-block; margin:10px 0 0; padding:5px 14px; border-radius:999px; font-weight:700; font-size:13.5px;
      background:color-mix(in srgb, var(--c) 12%, #fff); color:color-mix(in srgb, var(--c) 80%, #000);
    }
    .is-night .wc-diff{background:rgba(255,255,255,.12); color:#fff}
    .wc-awake{margin:8px 0 0; font-size:12.5px; font-weight:600; color:#0b7a4b}
    .wc-awake.no{color:#b9a8e6}
    .wc-card:not(.is-night) .wc-awake.no{color:#8a6fc4}

    /* ---- the analog dial ---- */
    .wc-dial{display:block; width:100%; height:auto}
    .wc-dial .face{fill:#fff; stroke:var(--c, #8e2b52); stroke-width:6}
    .is-night .wc-dial .face{fill:#151029; stroke:#7c6bd6}
    .is-morning .wc-dial .face{fill:#fffaf0}
    .is-evening .wc-dial .face{fill:#fff4ea}
    .wc-dial .mark{stroke:#c9bfd0; stroke-width:3; stroke-linecap:round}
    .wc-dial .mark.q{stroke:#5b4660; stroke-width:5}
    .is-night .wc-dial .mark{stroke:#4a3f75} .is-night .wc-dial .mark.q{stroke:#b8acec}
    .wc-dial .hand{stroke-linecap:round}
    .wc-dial .hand.h{stroke:#2d1430; stroke-width:8}
    .wc-dial .hand.m{stroke:#2d1430; stroke-width:5}
    .is-night .wc-dial .hand.h, .is-night .wc-dial .hand.m{stroke:#f1ecff}
    .wc-dial .hand.s{stroke:var(--c, #e0457b); stroke-width:2}
    .wc-dial .pin{fill:var(--c, #e0457b)}
    .wc-dial .star{fill:#fff7c2}
    .wc-dial.big .face{fill:rgba(255,255,255,.96); stroke:rgba(255,255,255,.5); stroke-width:8}
    .is-night .wc-dial.big .face{fill:#151029}
    .wc-dial.big .hand.s, .wc-dial.big .pin{stroke:#e0457b; fill:#e0457b}

    /* ---- the day table ---- */
    .wc-table{display:flex; flex-direction:column; gap:6px; overflow-x:auto; padding-bottom:4px}
    .wc-row{--c:#8e2b52; display:grid; grid-template-columns:130px 1fr; align-items:center; gap:10px; min-width:640px}
    .wc-row-name{font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
    .wc-row-name b{display:inline-block; min-width:28px; padding:1px 6px; margin-right:4px; border-radius:6px; background:var(--c); color:#fff; font-size:11px; text-align:center}
    .wc-cells{position:relative; display:grid; grid-template-columns:repeat(24, 1fr); gap:2px}
    .wc-cell{height:30px; border-radius:5px; display:grid; place-items:center; font-size:10.5px; font-weight:600; cursor:pointer; color:#3a2a40}
    .wc-cell.lbl{height:auto; color:var(--muted); font-weight:500}
    .wc-cell.night, .wc-key.night{background:#2d1f4f; color:#cfc5f2}
    .wc-cell.morning, .wc-key.morning{background:#ffe6a8}
    .wc-cell.day, .wc-key.day{background:#bfe9d3}
    .wc-cell.evening, .wc-key.evening{background:#ffc9a6}
    .wc-key{padding:1px 8px; border-radius:6px; font-size:12px; font-weight:600}
    .wc-now{position:absolute; top:-3px; bottom:-3px; width:3px; margin-left:-1px; border-radius:3px; background:#e0457b; box-shadow:0 0 0 2px #fff; pointer-events:none}

    @media (max-width:720px){
      .wc-hero{flex-direction:column; text-align:center; gap:14px; padding:20px}
      .wc-hero-clock{width:150px}
      .wc-hero-time{font-size:42px}
      .wc-grid{grid-template-columns:repeat(2, 1fr); gap:10px}
      .wc-card{padding:12px 10px; border-radius:16px}
      .wc-card header{flex-direction:column; text-align:center; gap:6px}
      .wc-part{margin:0; position:absolute}
      .wc-card{position:relative}
      .wc-card .wc-part{top:10px; right:10px; font-size:18px}
      .wc-name b{font-size:15px}
      .wc-dial-wrap{width:110px}
      .wc-time{font-size:22px}
      .wc-diff{font-size:12px; padding:4px 10px}
      .wc-slider{grid-template-columns:1fr}
      .wc-slider > b{grid-row:auto; text-align:center}
    }
  `,
})
export class World {
  protected readonly HOURS = HOURS;
  protected readonly MARKS = MARKS;

  /** the real time, ticking every second */
  private readonly now = signal(Date.now());
  /** a planned Sri Lanka time in minutes after midnight; null = show the time now */
  private readonly planned = signal<number | null>(null);
  protected readonly planning = computed(() => this.planned() !== null);

  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** the moment every clock shows */
  private readonly at = computed(() => {
    const now = this.now();
    const p = this.planned();
    if (p === null) return now;
    const w = wall(HOME.tz, now);
    const midnight = now - ((w.h * 60 + w.m) * 60 + w.s) * 1000 - (now % 1000);
    return midnight + p * 60_000;
  });

  protected readonly slMinutes = computed(() => {
    const w = wall(HOME.tz, this.at());
    return w.h * 60 + w.m;
  });

  protected readonly home = computed(() => clock(HOME, this.at()));
  protected readonly clocks = computed(() => PLACES.map(p => clock(p, this.at())));
  protected readonly longDate = computed(() =>
    new Intl.DateTimeFormat('en-GB', { timeZone: HOME.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(this.at()));

  /** 24 rows of hours: for each Sri Lanka hour, what it is in each place */
  protected readonly rows = computed(() => {
    const day = this.at() - this.slMinutes() * 60_000;     // Sri Lanka midnight
    return [HOME, ...PLACES].map(place => ({
      place,
      hours: HOURS.map(h => {
        const w = wall(place.tz, day + h * 3_600_000);
        return { part: partOf(w.h), short: this.short(w.h), label: fmtHM(w.h, w.m) };
      }),
    }));
  });

  protected readonly nowPct = computed(() => (this.slMinutes() / 1440) * 100);

  protected plan(minutes: number) { this.planned.set(Math.max(0, Math.min(1439, minutes))); }
  protected live() { this.planned.set(null); }

  protected fmtMinutes(min: number) { return fmtHM(Math.floor(min / 60), min % 60); }
  protected short(h: number) { return (h % 12 || 12) + (h < 12 ? 'a' : 'p'); }

  protected diffText(min: number): string {
    if (min === 0) return 'Same time as Sri Lanka';
    const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    // every card is compared with Sri Lanka, so the name is left off to keep it on one line
    return `${min > 0 ? '▲' : '▼'} ${h}h${m ? ' ' + m + 'm' : ''} ${min > 0 ? 'ahead' : 'behind'}`;
  }

  protected awake(h: number) { return h >= 8 && h < 21; }
  protected partIcon(p: Part) { return { night: '🌙', morning: '🌅', day: '☀️', evening: '🌇' }[p]; }
  protected partLabel(p: Part) { return { night: 'Night', morning: 'Morning', day: 'Daytime', evening: 'Evening' }[p]; }
}

/* ---------------- time-zone arithmetic ---------------- */

/** the wall-clock time in a time zone at a moment */
function wall(tz: string, at: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => +(parts.find(p => p.type === t)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), m: get('minute'), s: get('second') };
}

/** minutes the zone is ahead of UTC at that moment (summer time included) */
function offset(tz: string, at: number): number {
  const w = wall(tz, at);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.m, w.s) - Math.floor(at / 1000) * 1000) / 60_000);
}

function clock(place: Place, at: number): Clock {
  const w = wall(place.tz, at);
  const home = wall(HOME.tz, at);
  const dayShift = Math.sign(Date.UTC(w.y, w.mo - 1, w.d) - Date.UTC(home.y, home.mo - 1, home.d));
  return {
    place, h: w.h, m: w.m, s: w.s,
    time: fmtHM(w.h, w.m),
    date: new Intl.DateTimeFormat('en-GB', { timeZone: place.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(at),
    dayShift,
    diff: offset(place.tz, at) - offset(HOME.tz, at),
    part: partOf(w.h),
    hands: { h: (w.h % 12) * 30 + w.m * 0.5, m: w.m * 6 + w.s * 0.1, s: w.s * 6 },
  };
}

function partOf(h: number): Part {
  if (h < 6 || h >= 21) return 'night';
  if (h < 10) return 'morning';
  if (h < 17) return 'day';
  return 'evening';
}

function fmtHM(h: number, m: number) {
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
