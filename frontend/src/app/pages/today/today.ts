import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Birthday, birthday, firstName, ordinal, prettyDay, prettyDob, today } from '../../core/birthdays';
import { RegistrationApi } from '../../core/registrations';
import { Store } from '../../core/store';
import { BirthdayCard } from './birthday-card';

/**
 * Today's special: whose birthday it is today, big and bright, with the card one tap away; the
 * birthdays coming up; and the ones just missed, for a belated wish.
 */
@Component({
  selector: 'app-today',
  imports: [RouterLink, BirthdayCard],
  template: `
<div class="td">
  <header class="td-hero">
    <div class="td-hero-text">
      <small>{{ todayLabel }}</small>
      @if (todays().length) {
        <h2>🎉 {{ todays().length === 1 ? 'A birthday today!' : todays().length + ' birthdays today!' }}</h2>
        <p>Send {{ todays().length === 1 ? 'a card' : 'each a card' }} to make their day.</p>
      } @else {
        <h2>No birthdays today</h2>
        <p>@if (upcoming()[0]; as n) { Next: <b>{{ n.student.name }}</b> — {{ when(n) }}. } @else { Add students' birthdays to see them here. }</p>
      }
    </div>
    <span class="td-cake" aria-hidden="true">🎂</span>
  </header>

  <!-- ================= today ================= -->
  @if (todays().length) {
    <div class="td-today">
      @for (b of todays(); track b.student.id) {
        <article class="td-star" [style.--c]="store.colour(b.student.category)">
          <div class="td-confetti" aria-hidden="true"></div>
          <span class="td-av">{{ initials(b.student.name) }}</span>
          <h3>{{ b.student.name }}</h3>
          <p class="td-turn">@if (b.turning) { turns <b>{{ b.turning }}</b> today 🎈 } @else { birthday today 🎈 }</p>
          <p class="td-where">{{ b.student.session || b.student.category }}{{ b.student.day ? ' · ' + b.student.day + ' ' + b.student.time : '' }}</p>
          @if (b.student.parent || b.student.phone) { <p class="td-parent">{{ b.student.parent }} {{ b.student.phone }}</p> }
          <button type="button" class="td-go" (click)="card.set(b)">🎂 Make the birthday card</button>
        </article>
      }
    </div>
  }

  <div class="td-cols">
    <!-- ================= coming up ================= -->
    <section class="td-card">
      <h3 class="td-h">📅 Coming up <small>next 30 days</small></h3>
      @if (!upcoming().length) { <p class="td-empty">No birthdays in the next 30 days.</p> }
      <ul class="td-list">
        @for (b of upcoming(); track b.student.id) {
          <li [style.--c]="store.colour(b.student.category)" [class.soon]="b.daysAway <= 3">
            <span class="td-date"><b>{{ b.next.getDate() }}</b><small>{{ month(b.next) }}</small></span>
            <span class="td-who"><b>{{ b.student.name }}</b>
              <small>{{ when(b) }}{{ b.turning ? ' · turns ' + b.turning : '' }} · {{ b.student.session || b.student.category }}</small></span>
            <button type="button" class="btn btn-sm" (click)="card.set(b)" title="Make the card now, to send on the day">🎂 Card</button>
          </li>
        }
      </ul>
    </section>

    <div class="td-side">
      <!-- ================= just missed ================= -->
      @if (missed().length) {
        <section class="td-card td-missed">
          <h3 class="td-h">💌 Just missed <small>a belated wish is still lovely</small></h3>
          <ul class="td-list">
            @for (b of missed(); track b.student.id) {
              <li [style.--c]="store.colour(b.student.category)">
                <span class="td-date"><b>{{ b.next.getDate() }}</b><small>{{ month(b.next) }}</small></span>
                <span class="td-who"><b>{{ b.student.name }}</b><small>{{ agoText(b) }}</small></span>
                <button type="button" class="btn btn-sm" (click)="card.set(b)">🎂 Card</button>
              </li>
            }
          </ul>
        </section>
      }

      <!-- ================= birthdays on file ================= -->
      <section class="td-card td-known">
        <h3 class="td-h">🗂️ Birthdays on file</h3>
        <div class="td-bar"><i [style.width.%]="known().pct"></i></div>
        <p><b>{{ known().with }}</b> of {{ known().all }} students have their birthday saved.</p>
        @if (known().without) {
          <p class="hint">Add the others on the <a routerLink="/students">Students page</a> (tap a student → Date of birth).
            Children registered online bring theirs with them.</p>
        }
      </section>
    </div>
  </div>
</div>

@if (card(); as b) { <app-birthday-card [b]="b" (closed)="card.set(null)" /> }
  `,
  styles: [`
    :host{display:block}
    .td{display:flex; flex-direction:column; gap:16px; width:100%}
    .td-hero{position:relative; overflow:hidden; display:flex; align-items:center; justify-content:space-between; gap:16px;
      padding:26px 28px; border-radius:24px; color:#fff;
      background:radial-gradient(500px 200px at 90% 0%, rgba(255,255,255,.25), transparent 60%),
        linear-gradient(120deg, #ff6b9a, #d6336c 45%, #7c3aed); box-shadow:0 18px 40px rgba(214,51,108,.3)}
    .td-hero::before{content:""; position:absolute; inset:0; opacity:.45; pointer-events:none;
      background-image:radial-gradient(#fff 2px, transparent 2.5px), radial-gradient(#fde68a 2px, transparent 2.5px);
      background-size:46px 46px, 64px 64px; background-position:0 0, 23px 30px}
    .td-hero-text{position:relative}
    .td-hero small{font-size:14px; letter-spacing:1px; text-transform:uppercase; opacity:.9}
    .td-hero h2{margin:4px 0; font-family:var(--f-display); font-size:clamp(26px, 4vw, 38px)}
    .td-hero p{margin:0; font-size:16px; opacity:.95}
    .td-cake{position:relative; font-size:clamp(60px, 9vw, 96px); filter:drop-shadow(0 8px 16px rgba(0,0,0,.25)); animation:td-bob 2.4s ease-in-out infinite}
    @keyframes td-bob{50%{transform:translateY(-8px) rotate(-4deg)}}

    .td-today{display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px}
    .td-star{--c:#d6336c; position:relative; overflow:hidden; text-align:center; padding:26px 20px 20px; border-radius:24px; background:#fff;
      border:2px solid color-mix(in srgb, var(--c) 30%, #fff); box-shadow:0 14px 34px color-mix(in srgb, var(--c) 20%, transparent)}
    .td-confetti{position:absolute; inset:0 0 auto; height:90px; pointer-events:none;
      background:linear-gradient(135deg, color-mix(in srgb, var(--c) 85%, #fff), color-mix(in srgb, var(--c) 55%, #7c3aed))}
    .td-confetti::after{content:""; position:absolute; inset:0; opacity:.7;
      background-image:radial-gradient(#fff 2px, transparent 2.5px), radial-gradient(#fde68a 2.5px, transparent 3px);
      background-size:28px 28px, 40px 40px; background-position:0 0, 14px 18px}
    .td-av{position:relative; display:inline-grid; place-items:center; width:92px; height:92px; margin-top:22px; border-radius:50%;
      background:#fff; color:var(--c); font-family:var(--f-display); font-weight:700; font-size:32px; border:5px solid #fff;
      box-shadow:0 8px 20px rgba(0,0,0,.18), inset 0 0 0 3px color-mix(in srgb, var(--c) 40%, #fff)}
    .td-star h3{margin:12px 0 2px; font-family:var(--f-display); font-size:22px; color:#2d1430}
    .td-turn{margin:0; font-size:17px; color:#5b4660}
    .td-turn b{font-size:24px; color:var(--c)}
    .td-where{margin:8px 0 0; font-weight:700; color:var(--c)}
    .td-parent{margin:2px 0 0; font-size:13.5px; color:var(--muted)}
    .td-go{margin-top:16px; width:100%; min-height:52px; border:0; border-radius:14px; cursor:pointer; font:inherit; font-size:16px; font-weight:800; color:#fff;
      background:linear-gradient(135deg, #ff6b9a, #7c3aed); box-shadow:0 10px 22px rgba(124,58,237,.3)}
    .td-go:hover{filter:brightness(1.05)}

    .td-cols{display:grid; grid-template-columns:1.4fr 1fr; gap:16px; align-items:start}
    .td-side{display:flex; flex-direction:column; gap:16px}
    .td-card{background:#fff; border-radius:20px; padding:18px; border:1px solid #efe6f2; box-shadow:0 8px 22px rgba(58,18,56,.06)}
    .td-h{margin:0 0 12px; font-family:var(--f-display); font-size:19px; color:#6b1a52}
    .td-h small{font-family:var(--f-body, inherit); font-size:12.5px; color:var(--muted); font-weight:400; margin-left:6px}
    .td-empty{color:var(--muted); margin:0}
    .td-list{list-style:none; margin:0; padding:0; display:grid; gap:8px}
    .td-list li{--c:#d6336c; display:grid; grid-template-columns:54px 1fr auto; gap:12px; align-items:center; padding:8px 10px; border-radius:14px; background:#faf7fc}
    .td-list li.soon{background:#fff4f8; box-shadow:inset 3px 0 0 var(--c)}
    .td-date{display:flex; flex-direction:column; align-items:center; line-height:1; padding:6px 0; border-radius:12px; color:#fff;
      background:linear-gradient(160deg, color-mix(in srgb, var(--c) 80%, #fff), var(--c))}
    .td-date b{font-size:22px}
    .td-date small{font-size:11px; text-transform:uppercase; letter-spacing:.8px; margin-top:3px}
    .td-who{min-width:0}
    .td-who b{display:block; font-size:15.5px; color:#2d1430; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
    .td-who small{font-size:13px; color:var(--muted)}
    .td-bar{height:10px; border-radius:99px; background:#f1eaf4; overflow:hidden; margin-bottom:10px}
    .td-bar i{display:block; height:100%; background:linear-gradient(90deg, #ff6b9a, #7c3aed); border-radius:99px}
    .td-known p{margin:0 0 6px}
    @media (max-width:900px){ .td-cols{grid-template-columns:1fr} }
    @media (max-width:560px){ .td-hero{padding:20px} .td-list li{grid-template-columns:48px 1fr; } .td-list li .btn{grid-column:1 / -1} }
  `],
})
export class Today {
  protected store = inject(Store);
  private registrations = inject(RegistrationApi);

  protected readonly card = signal<Birthday | null>(null);
  protected readonly todayLabel = prettyDay(today());
  /** birthdays from online registrations, for students placed before birthdays were kept on students */
  private readonly fromRegistrations = signal<Map<string, string>>(new Map());

  constructor() {
    this.registrations.list().then(rows => this.fromRegistrations.set(new Map(rows
      .filter(r => r.placed?.studentId && r.reg.dateOfBirth).map(r => [r.placed!.studentId, r.reg.dateOfBirth]))))
      .catch(() => { /* the students' own birthdays still show */ });
  }

  private readonly all = computed(() => {
    const extra = this.fromRegistrations();
    const out: Birthday[] = [];
    for (const s of this.store.students()) {
      if (!s.active) continue;
      const b = birthday(s, s.dateOfBirth || extra.get(s.id) || '');
      if (b) out.push(b);
    }
    return out.sort((a, b) => a.daysAway - b.daysAway || a.student.name.localeCompare(b.student.name));
  });

  protected readonly todays = computed(() => this.all().filter(b => b.daysAway === 0));
  protected readonly upcoming = computed(() => this.all().filter(b => b.daysAway > 0 && b.daysAway <= 30));

  /** birthdays in the last 3 days (daysAway is then negative: −1 = yesterday) */
  protected readonly missed = computed(() => {
    const t = today().getTime();
    return this.all()
      .map(b => {
        const last = new Date(b.next); last.setFullYear(last.getFullYear() - 1);
        return { ...b, next: last, daysAway: -Math.round((t - last.getTime()) / 86_400_000), turning: b.turning ? b.turning - 1 : null };
      })
      .filter(b => b.daysAway >= -3 && b.daysAway <= -1)
      .sort((a, b) => b.daysAway - a.daysAway);
  });

  protected readonly known = computed(() => {
    const active = this.store.students().filter(s => s.active);
    const extra = this.fromRegistrations();
    const withDob = active.filter(s => s.dateOfBirth || extra.has(s.id)).length;
    return { all: active.length, with: withDob, without: active.length - withDob, pct: active.length ? withDob / active.length * 100 : 0 };
  });

  protected when(b: Birthday): string {
    return b.daysAway === 1 ? 'tomorrow' : b.daysAway < 7 ? prettyDay(b.next).split(' ')[0] + ' (in ' + b.daysAway + ' days)'
      : 'in ' + b.daysAway + ' days';
  }

  protected agoText(b: Birthday): string {
    const d = -b.daysAway;
    return (d === 1 ? 'yesterday' : d + ' days ago') + (b.turning ? ' · turned ' + b.turning : '');
  }

  protected month(d: Date): string {
    return d.toLocaleDateString('en-GB', { month: 'short' });
  }

  protected initials(n: string): string {
    return n.split(/\s+/).filter(w => w.length > 1 && !w.includes('.')).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  protected readonly ordinal = ordinal;
  protected readonly firstName = firstName;
  protected readonly prettyDob = prettyDob;
}
