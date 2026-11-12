import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { MonthView, Receipt } from '../../core/models';
import { RegRow, RegistrationApi } from '../../core/registrations';
import { RollApi, RollDay } from '../../core/roll';
import { Store, monthKey } from '../../core/store';
import { SheetOut, TeacherApi } from '../../core/teachers';
import { money } from '../../receipt/format';

interface Attention { icon: string; text: string; detail: string; link: string; query?: Record<string, string>; tone: 'red' | 'amber' | 'blue' }
interface Birthday { name: string; when: string; age: number | null; today: boolean; session: string; colour: string }

/**
 * The office's start page: the day at a glance (today's classes and their registers, which
 * teachers have come in), the month's money, what needs doing, and a tap to everything else.
 * Each part loads on its own, so one slow or missing part never holds up the rest.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <section class="hm">

      <!-- ============ the day ============ -->
      <header class="hm-hero">
        <div class="hm-hero-text">
          <p class="hm-greet">{{ greeting() }} 👋</p>
          <h1>{{ store.settings().academyName || 'Shalom Academy of Performing Arts' }}</h1>
          <p class="hm-date"><b>{{ dayName }}</b> {{ dateLabel }}
            @if (roll()?.holiday; as h) { <span class="hm-hol">🎉 {{ h.name }}{{ h.classOff ? ' · no classes' : '' }}</span> }
          </p>
        </div>
        <nav class="hm-actions" aria-label="Quick actions">
          <a routerLink="/receipt" class="hm-act rose"><i>🧾</i><span>New receipt</span></a>
          <a routerLink="/payments" class="hm-act green"><i>💳</i><span>Payments</span></a>
          <a routerLink="/attendance" class="hm-act sky"><i>✋</i><span>Attendance</span></a>
          <a routerLink="/students" class="hm-act blue"><i>👥</i><span>Students</span></a>
        </nav>
      </header>

      <div class="hm-grid">

        <!-- ============ this month's money ============ -->
        <a class="hm-card hm-money" routerLink="/payments">
          <div class="hm-card-head"><h2>💰 {{ month()?.label || 'This month' }}</h2><span class="hm-more">Payments →</span></div>
          @if (month(); as m) {
            <div class="hm-money-main">
              <div class="hm-ring" [style.--p]="m.totals.completion">
                <b>{{ pct(m.totals.completion) }}</b><small>collected</small>
              </div>
              <div class="hm-money-fig">
                <p class="hm-big">Rs. {{ money(m.totals.collected) }}</p>
                <p class="hm-sub">of Rs. {{ money(m.totals.expected) }} expected</p>
                <p class="hm-sub">Still to come <b>Rs. {{ money(m.totals.outstanding) }}</b></p>
              </div>
            </div>
            <div class="hm-counts">
              <span class="ok"><b>{{ m.totals.paid + m.totals.free }}</b>paid</span>
              <span class="part"><b>{{ m.totals.partial }}</b>part paid</span>
              <span class="due"><b>{{ m.totals.pending }}</b>pending</span>
              <span><b>{{ m.totals.students }}</b>students</span>
            </div>
            @if (m.totals.byPaidTo.length) {
              <div class="hm-accounts">
                @for (t of m.totals.byPaidTo; track t.name) {
                  <span><small>{{ t.name }}</small><b>Rs. {{ money(t.amount) }}</b></span>
                }
              </div>
            }
          } @else if (failed().has('month')) { <p class="hm-empty">Could not load this month.</p> }
          @else { <div class="hm-skel"></div> }
        </a>

        <!-- ============ today's classes ============ -->
        <a class="hm-card hm-classes" routerLink="/attendance">
          <div class="hm-card-head"><h2>🎵 Today's classes</h2><span class="hm-more">Attendance →</span></div>
          @if (roll(); as r) {
            @for (c of r.classes; track c.session.name) {
              <div class="hm-class" [class]="'hm-class st-' + c.state" [style.--c]="store.colour(c.session.category)">
                <span class="hm-time">{{ c.time.split(' - ')[0] || c.start }}</span>
                <div class="hm-class-what">
                  <b>{{ c.session.name }}</b>
                  <small>{{ c.session.category }} · {{ c.students.length }} students</small>
                </div>
                @switch (registerState(c)) {
                  @case ('taken') { <span class="hm-pill ok">✓ {{ c.present + c.late }}/{{ c.students.length }} here</span> }
                  @case ('missing') { <span class="hm-pill due">Register not taken</span> }
                  @case ('now') { <span class="hm-pill now">● On now</span> }
                  @default { <span class="hm-pill">{{ c.state === 'next' ? 'Next' : 'Later' }}</span> }
                }
              </div>
            } @empty {
              <p class="hm-empty">{{ r.holiday?.classOff ? 'No classes today — ' + r.holiday?.name : 'No classes today.' }}</p>
            }
            @for (mv of r.moved ?? []; track mv.id) {
              <p class="hm-moved">📅 {{ mv.kind === 'away'
                ? mv.session + ' is not today — moved to ' + mv.otherLabel + ', ' + mv.time
                : mv.session + ' is today at ' + mv.time + ', instead of ' + mv.otherLabel }}</p>
            }
          } @else if (failed().has('roll')) { <p class="hm-empty">Could not load today's classes.</p> }
          @else { <div class="hm-skel"></div> }
        </a>

        <!-- ============ needs attention ============ -->
        <div class="hm-card hm-attention">
          <div class="hm-card-head"><h2>📌 Needs attention</h2></div>
          @for (a of attention(); track a.text) {
            <a class="hm-att" [class]="'hm-att tone-' + a.tone" [routerLink]="a.link" [queryParams]="a.query ?? {}">
              <i>{{ a.icon }}</i><div><b>{{ a.text }}</b><small>{{ a.detail }}</small></div><span>→</span>
            </a>
          } @empty {
            @if (month() && roll()) { <p class="hm-allgood">✨ All clear — nothing waiting.</p> }
            @else { <div class="hm-skel short"></div> }
          }
        </div>

        <!-- ============ teachers ============ -->
        <a class="hm-card hm-teachers" routerLink="/teachers">
          <div class="hm-card-head"><h2>🎓 Teachers today</h2><span class="hm-more">Teachers →</span></div>
          @if (teachersToday(); as t) {
            @for (x of t.reported; track x.id) {
              <div class="hm-teacher" [style.--t]="x.colour">
                <span class="hm-av">{{ x.name.charAt(0) }}</span>
                <div><b>{{ x.name }}</b><small>Reported {{ x.at }}{{ x.classes ? ' · ' + x.classes + ' class' + (x.classes === 1 ? '' : 'es') + ' marked' : '' }}</small></div>
              </div>
            } @empty { <p class="hm-empty">{{ t.slots ? 'No teacher has reported in yet.' : 'No teaching today.' }}</p> }
            @if (t.slots) { <p class="hm-foot">{{ t.marked }} of {{ t.slots }} classes marked by teachers</p> }
          } @else if (failed().has('teachers')) { <p class="hm-empty">Could not load teachers.</p> }
          @else { <div class="hm-skel short"></div> }
        </a>

        <!-- ============ birthdays ============ -->
        <a class="hm-card hm-bdays" routerLink="/today">
          <div class="hm-card-head"><h2>🎂 Birthdays</h2><span class="hm-more">See all →</span></div>
          @for (b of birthdays(); track b.name) {
            <div class="hm-bday" [class.today]="b.today" [style.--c]="b.colour">
              <span class="hm-bday-when">{{ b.today ? 'Today' : b.when }}</span>
              <div><b>{{ b.name }}</b><small>{{ b.age ? 'turns ' + b.age : '' }}{{ b.age && b.session ? ' · ' : '' }}{{ b.session }}</small></div>
              @if (b.today) { <span class="hm-cake">🎉</span> }
            </div>
          } @empty { <p class="hm-empty">No birthdays in the next 7 days.</p> }
        </a>

        <!-- ============ recent receipts ============ -->
        <a class="hm-card hm-receipts" routerLink="/history">
          <div class="hm-card-head"><h2>🧾 Recent receipts</h2><span class="hm-more">History →</span></div>
          @for (r of recent(); track r.number) {
            <div class="hm-rcpt">
              <div><b>{{ r.student || 'Receipt' }}</b><small>{{ r.number }} · {{ r.period || r.month }}</small></div>
              <span>Rs. {{ money(r.total) }}</span>
            </div>
          } @empty { <p class="hm-empty">No receipts yet.</p> }
        </a>
      </div>
    </section>
  `,
  styles: `
    .hm{display:flex; flex-direction:column; gap:18px}

    /* ---- the day ---- */
    .hm-hero{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:18px; padding:26px 28px;
      border-radius:26px; color:#fff; overflow:hidden; position:relative;
      background:radial-gradient(420px 260px at 0% 0%, rgba(255,107,154,.45), transparent 70%),
                 radial-gradient(380px 260px at 100% 100%, rgba(124,58,237,.5), transparent 70%),
                 linear-gradient(140deg, #2a0f3c, #74204f);
      box-shadow:0 20px 44px rgba(58,18,56,.25)}
    .hm-greet{margin:0; font-size:15px; opacity:.85}
    .hm-hero h1{margin:4px 0 6px; font-family:var(--f-display); font-size:30px; letter-spacing:.8px; line-height:1.15}
    .hm-date{margin:0; display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:15px; opacity:.92}
    .hm-date b{font-weight:800}
    .hm-hol{padding:3px 10px; border-radius:999px; background:rgba(255,255,255,.16); font-size:13px}
    .hm-actions{display:grid; grid-template-columns:repeat(4, minmax(92px, 1fr)); gap:10px}
    .hm-act{display:flex; flex-direction:column; align-items:center; gap:6px; padding:14px 10px; border-radius:18px; text-decoration:none;
      color:#fff; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); transition:transform .15s, background .15s}
    .hm-act:hover{transform:translateY(-2px); background:rgba(255,255,255,.2)}
    .hm-act i{font-style:normal; font-size:24px; line-height:1}
    .hm-act span{font-size:13px; font-weight:800; white-space:nowrap}

    /* ---- cards ---- */
    .hm-grid{display:grid; grid-template-columns:repeat(12, 1fr); gap:16px}
    .hm-card{display:flex; flex-direction:column; gap:10px; padding:18px; border-radius:22px; background:#fff; color:inherit;
      text-decoration:none; border:1px solid #ece5f0; box-shadow:0 8px 22px rgba(58,18,56,.06); min-width:0; transition:box-shadow .15s, transform .15s}
    a.hm-card:hover{box-shadow:0 14px 30px rgba(58,18,56,.11); transform:translateY(-1px)}
    .hm-money{grid-column:span 7} .hm-classes{grid-column:span 5}
    .hm-attention{grid-column:span 5} .hm-teachers{grid-column:span 4} .hm-bdays{grid-column:span 3}
    .hm-receipts{grid-column:span 12}
    .hm-card-head{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:4px 8px}
    .hm-card-head h2{white-space:nowrap}
    .hm-card-head h2{margin:0; font-family:var(--f-display); font-size:18px; color:#3a1238; letter-spacing:.4px}
    .hm-more{font-size:12.5px; font-weight:800; color:#8e2b52; white-space:nowrap}
    .hm-empty{margin:4px 0; color:var(--muted); font-size:14px}
    .hm-foot{margin:2px 0 0; font-size:12.5px; color:var(--muted)}
    .hm-skel{height:120px; border-radius:14px; background:linear-gradient(90deg, #f4eff7 25%, #faf7fc 50%, #f4eff7 75%); background-size:200% 100%; animation:hm-shine 1.2s infinite}
    .hm-skel.short{height:70px}
    @keyframes hm-shine{to{background-position:-200% 0}}

    /* ---- money ---- */
    .hm-money-main{display:flex; align-items:center; gap:20px}
    .hm-ring{--p:0; flex:none; width:118px; height:118px; border-radius:50%; display:grid; place-items:center; align-content:center; position:relative;
      background:conic-gradient(#12b76a calc(var(--p) * 360deg), #eee7f2 0)}
    .hm-ring::before{content:""; position:absolute; inset:11px; border-radius:50%; background:#fff}
    .hm-ring > *{position:relative}
    .hm-ring b{font-size:24px; color:#0b6b3f; line-height:1}
    .hm-ring small{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px}
    .hm-big{margin:0; font-size:30px; font-weight:800; color:#2b1030; font-variant-numeric:tabular-nums}
    .hm-sub{margin:2px 0 0; font-size:14px; color:#6b5872}
    .hm-sub b{color:#9c1d45}
    .hm-counts{display:grid; grid-template-columns:repeat(4, 1fr); gap:8px}
    .hm-counts span{display:flex; flex-direction:column; align-items:center; padding:9px 4px; border-radius:14px; background:#f7f2fa; font-size:12px; color:var(--muted)}
    .hm-counts b{font-size:20px; color:#2b1030}
    .hm-counts .ok{background:#e9f8ef} .hm-counts .ok b{color:#0b6b3f}
    .hm-counts .part{background:#fff6e5} .hm-counts .part b{color:#8a5300}
    .hm-counts .due{background:#fdecec} .hm-counts .due b{color:#b3261e}
    .hm-accounts{display:flex; flex-wrap:wrap; gap:8px}
    .hm-accounts span{flex:1 1 140px; display:flex; flex-direction:column; padding:8px 12px; border-radius:12px; border:1px solid #ece5f0}
    .hm-accounts small{font-size:11.5px; color:var(--muted)}
    .hm-accounts b{font-size:15px; font-variant-numeric:tabular-nums}

    /* ---- today's classes ---- */
    .hm-class{--c:#8e2b52; display:flex; align-items:center; gap:12px; padding:9px 10px; border-radius:14px; border-left:4px solid var(--c);
      background:color-mix(in srgb, var(--c) 5%, #fff)}
    .hm-class.st-now{background:color-mix(in srgb, var(--c) 12%, #fff); box-shadow:0 0 0 2px color-mix(in srgb, var(--c) 30%, transparent)}
    .hm-class.st-done{opacity:.85}
    .hm-time{flex:none; width:58px; font-weight:800; font-size:13.5px; color:color-mix(in srgb, var(--c) 75%, #1d1b1e); font-variant-numeric:tabular-nums}
    .hm-class-what{flex:1; min-width:0; line-height:1.25}
    .hm-class-what b{display:block; font-size:15px}
    .hm-class-what small{font-size:12px; color:var(--muted)}
    .hm-pill{flex:none; padding:4px 10px; border-radius:999px; font-size:11.5px; font-weight:800; background:#f1ecf4; color:#6b5872; white-space:nowrap}
    .hm-pill.ok{background:#dff5e9; color:#0b6b3f} .hm-pill.due{background:#fde3e3; color:#b3261e} .hm-pill.now{background:#fff1d6; color:#8a5300}

    .hm-moved{margin:0; padding:8px 10px; border-radius:12px; background:#eef3ff; border:1px solid #c9d8fb; color:#22479c; font-size:13px}

    /* ---- needs attention ---- */
    .hm-att{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:14px; text-decoration:none; color:inherit;
      border:1px solid var(--edge, #ece5f0); background:var(--soft, #fff); transition:transform .12s}
    .hm-att:hover{transform:translateX(2px)}
    .hm-att i{font-style:normal; font-size:20px}
    .hm-att div{flex:1; min-width:0; line-height:1.3}
    .hm-att b{display:block; font-size:14.5px}
    .hm-att small{font-size:12.5px; color:var(--muted)}
    .hm-att > span{color:var(--muted); font-weight:800}
    .hm-att.tone-red{--soft:#fff6f6; --edge:#f6d0d0} .hm-att.tone-amber{--soft:#fffaf0; --edge:#f3e0b0} .hm-att.tone-blue{--soft:#f5f8ff; --edge:#d6e2fb}
    .hm-allgood{margin:4px 0; padding:14px; border-radius:14px; background:#e9f8ef; color:#0b6b3f; font-weight:700; text-align:center}

    /* ---- teachers ---- */
    .hm-teacher{--t:#8e2b52; display:flex; align-items:center; gap:10px}
    .hm-av{flex:none; width:36px; height:36px; border-radius:50%; display:grid; place-items:center; background:var(--t); color:#fff; font-weight:800}
    .hm-teacher b{display:block; font-size:14.5px}
    .hm-teacher small{font-size:12.5px; color:var(--muted)}

    /* ---- birthdays ---- */
    .hm-bday{--c:#8e2b52; display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:14px; background:#faf7fc}
    .hm-bday.today{background:linear-gradient(135deg, #fff0f6, #f3e8ff); box-shadow:0 0 0 1.5px #f3c4dc}
    .hm-bday-when{flex:none; min-width:52px; text-align:center; padding:4px 6px; border-radius:10px; font-size:12px; font-weight:800;
      background:#fff; color:color-mix(in srgb, var(--c) 80%, #1d1b1e)}
    .hm-bday div{flex:1; min-width:0; line-height:1.25}
    .hm-bday b{display:block; font-size:14px}
    .hm-bday small{font-size:12px; color:var(--muted)}
    .hm-cake{font-size:20px}

    /* ---- receipts ---- */
    .hm-receipts{display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px}
    .hm-receipts .hm-card-head, .hm-receipts .hm-empty{grid-column:1 / -1}
    .hm-rcpt{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-radius:14px; border:1px solid #ece5f0}
    .hm-rcpt div{min-width:0; line-height:1.3}
    .hm-rcpt b{display:block; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
    .hm-rcpt small{font-size:12px; color:var(--muted)}
    .hm-rcpt > span{flex:none; font-weight:800; font-size:14px; color:#0b6b3f; font-variant-numeric:tabular-nums}

    @media (max-width:1100px){
      .hm-money, .hm-classes{grid-column:span 12}
      .hm-attention{grid-column:span 12} .hm-teachers, .hm-bdays{grid-column:span 6}
    }
    @media (max-width:720px){
      .hm-hero{padding:20px 18px; border-radius:22px}
      .hm-hero h1{font-size:23px}
      .hm-actions{width:100%; grid-template-columns:repeat(4, 1fr); gap:8px}
      .hm-act{padding:12px 4px; border-radius:14px}
      .hm-act span{font-size:11.5px}
      .hm-teachers, .hm-bdays{grid-column:span 12}
      .hm-money-main{gap:14px}
      .hm-ring{width:96px; height:96px}
      .hm-big{font-size:24px}
    }
    @media (prefers-reduced-motion:reduce){ .hm-skel{animation:none} }
  `,
})
export class Home {
  protected store = inject(Store);
  private api = inject(Api);
  private rollApi = inject(RollApi);
  private teacherApi = inject(TeacherApi);
  private regApi = inject(RegistrationApi);
  protected readonly money = money;

  protected readonly month = signal<MonthView | null>(null);
  protected readonly roll = signal<RollDay | null>(null);
  private readonly sheet = signal<SheetOut | null>(null);
  private readonly regs = signal<RegRow[] | null>(null);
  protected readonly failed = signal<Set<string>>(new Set());

  private readonly now = new Date();
  protected readonly dayName = this.now.toLocaleDateString('en-GB', { weekday: 'long' });
  protected readonly dateLabel = this.now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });

  constructor() {
    this.load();
    // classes start and end through the day
    const t = setInterval(() => this.load(), 5 * 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  private load() {
    const part = <T>(name: string, p: Promise<T>, set: (v: T) => void) =>
      p.then(set).catch(() => this.failed.update(s => new Set(s).add(name)));
    part('month', this.api.month(monthKey()), v => this.month.set(v));
    part('roll', this.rollApi.day(), v => this.roll.set(v));
    part('teachers', this.teacherApi.sheet(), v => this.sheet.set(v));
    part('regs', this.regApi.list(), v => this.regs.set(v));
  }

  /** a register: taken, missing (the class is over and nobody marked it), on now, or not yet */
  protected registerState(c: RollDay['classes'][number]): 'taken' | 'missing' | 'now' | 'wait' {
    const marked = c.students.length - c.unmarked;
    if (c.students.length && marked === c.students.length) return 'taken';
    if (c.state === 'done' && c.students.length) return 'missing';
    if (c.state === 'now') return 'now';
    return 'wait';
  }

  /** who reported at the academy today, and how many classes they marked */
  protected readonly teachersToday = computed(() => {
    const s = this.sheet();
    if (!s) return null;
    const today = s.days.find(d => d.today);
    if (!today) return { reported: [], slots: 0, marked: 0 };
    const reported = Object.entries(today.arrivals ?? {}).map(([id, at]) => {
      const t = s.teachers.find(x => x.id === id);
      return {
        id, name: t?.name ?? id, colour: t?.colour ?? '#8e2b52',
        at: new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        classes: today.classes.filter(c => c.teachers.some(w => w.teacherId === id && w.method === 'self')).length,
      };
    });
    const slots = today.classes.filter(c => !c.removed).length;
    const marked = today.classes.filter(c => c.teachers.length).length;
    return { reported, slots, marked };
  });

  /** what needs doing, most pressing first */
  protected readonly attention = computed<Attention[]>(() => {
    const out: Attention[] = [];
    const m = this.month(), r = this.roll(), regs = this.regs();
    for (const c of r?.classes ?? []) {
      if (this.registerState(c) === 'missing') {
        out.push({ icon: '✋', tone: 'red', text: `Register not taken: ${c.session.name}`, detail: `${c.time} · ${c.students.length} students`, link: '/attendance' });
      }
    }
    if (m && m.totals.pending + m.totals.partial > 0) {
      out.push({ icon: '💳', tone: 'amber', text: `${m.totals.pending + m.totals.partial} students still to pay`,
        detail: `Rs. ${money(m.totals.outstanding)} outstanding for ${m.label}`, link: '/payments' });
    }
    const over = (m?.sessions ?? []).filter(s => s.max !== null && s.students > s.max!);
    if (over.length) {
      out.push({ icon: '⚠️', tone: 'amber', text: `${over.length} session${over.length === 1 ? ' is' : 's are'} over the limit`,
        detail: over.map(s => `${s.name} ${s.students}/${s.max}`).join(' · '), link: '/classes' });
    }
    const waiting = (regs ?? []).filter(x => x.status === 'pool').length;
    if (waiting) {
      out.push({ icon: '🧺', tone: 'blue', text: `${waiting} registration${waiting === 1 ? '' : 's'} waiting for a class`,
        detail: 'Children registered online, not placed yet', link: '/registrations' });
    }
    const unplaced = this.store.students().filter(s => s.active && !s.session && this.store.usesSessions(s.category));
    if (unplaced.length) {
      out.push({ icon: '🪑', tone: 'blue', text: `${unplaced.length} student${unplaced.length === 1 ? '' : 's'} without a session`,
        detail: unplaced.slice(0, 3).map(s => s.name).join(', ') + (unplaced.length > 3 ? '…' : ''), link: '/classes' });
    }
    return out;
  });

  /** birthdays today and in the next 7 days */
  protected readonly birthdays = computed<Birthday[]>(() => {
    const start = new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate());
    const out: (Birthday & { days: number })[] = [];
    for (const s of this.store.students()) {
      if (!s.active || !s.dateOfBirth) continue;
      const [y, mo, d] = s.dateOfBirth.split('-').map(Number);
      if (!mo || !d) continue;
      let next = new Date(start.getFullYear(), mo - 1, d);
      if (next < start) next = new Date(start.getFullYear() + 1, mo - 1, d);
      const days = Math.round((next.getTime() - start.getTime()) / 86_400_000);
      if (days > 7) continue;
      out.push({
        name: s.name, days, today: days === 0, session: s.session || s.category,
        when: next.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
        age: y ? next.getFullYear() - y : null, colour: this.store.colour(s.category),
      });
    }
    return out.sort((a, b) => a.days - b.days).slice(0, 6);
  });

  protected readonly recent = computed<Receipt[]>(() =>
    [...this.store.receipts()].sort((a, b) => (b.createdAt ?? b.date ?? '').localeCompare(a.createdAt ?? a.date ?? '')).slice(0, 6));

  protected pct(n: number) {
    return Math.round(n * 1000) / 10 + '%';
  }
}
