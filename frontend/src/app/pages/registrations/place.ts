import { Component, computed, inject, input, output, signal } from '@angular/core';
import { errorMessage } from '../../core/api';
import { Session } from '../../core/models';
import { RegRow, RegistrationApi } from '../../core/registrations';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { money } from '../../receipt/format';
import { Dialog } from '../../core/dialog';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "3:30 - 4:30 PM" → minutes after midnight of the start, for sorting */
export function startMinutes(t: string): number {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(t || '');
  if (!m) return 9999;
  let h = +m[1] % 12;
  const pm = (m[3] ?? (/PM/i.test(t) ? 'PM' : 'AM')).toUpperCase() === 'PM';
  if (pm) h += 12;
  return h * 60 + (+(m[2] ?? 0));
}

export const sessionOrder = (a: Session, b: Session) =>
  (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) || startMinutes(a.time) - startMinutes(b.time) || a.name.localeCompare(b.name);

/** The message for the parent once their child has a class. */
export function placedMessage(o: {
  parent: string; child: string; academy: string; number: string; session: string; category: string;
  day: string; time: string; fee: number | null;
}): string {
  const first = o.child.split(' ').find(w => w.length > 2 && !w.includes('.')) ?? o.child;
  return [
    `Dear ${o.parent || 'Parent'},`,
    '',
    `Welcome to ${o.academy}! 🎵 ${first}'s place is confirmed.`,
    '',
    `🎼 Class: ${o.session ? o.session + ' (' + o.category + ')' : o.category}`,
    ...(o.day ? [`🗓️ Every ${o.day}${o.time ? ', ' + o.time : ''}`] : []),
    ...(o.fee !== null ? [`💳 Monthly fee: Rs. ${money(o.fee)}`] : []),
    `🔖 Registration: ${o.number}`,
    '',
    `Please come 10 minutes early for the first class. We can't wait to meet ${first}!`,
    '',
    o.academy,
  ].join('\n');
}

/**
 * Places one child from the registration pool in a class. Picks the class and session (with the
 * free places of each), then creates the student through the server, the same way the
 * Students page adds one; the confirmation for the parent follows.
 */
@Component({
  selector: 'app-place-sheet',
  template: `
<div class="sheet-backdrop" (click)="closed.emit()"></div>
<aside class="sheet pl" role="dialog" aria-label="Place in a class">
  <header class="sheet-head">
    <div><h2>🎼 Place in a class</h2><small>{{ row().reg.childName }} · {{ row().reg.number }}</small></div>
    <button type="button" class="btn-icon" (click)="closed.emit()" aria-label="Close">✕</button>
  </header>
  <div class="sheet-body">
    @if (message(); as msg) {
      <p class="pl-done">✅ {{ row().reg.childName }} is now a student{{ newId() ? ' (' + newId() + ')' : '' }}</p>
      <label class="field"><span>Message to {{ row().reg.parentName }} <em>· {{ phone() }}</em></span>
        <textarea rows="12" [value]="msg" (input)="message.set($any($event.target).value)"></textarea></label>
      <div class="pl-act">
        <button type="button" class="btn btn-wa" (click)="copy(msg)">📋 Copy message</button>
        <button type="button" class="btn" (click)="copy(phone())">Copy number</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" (click)="closed.emit()">Done</button>
      </div>
    } @else {
      <div class="pl-wish">
        <b>Parent's wish</b>
        <span>{{ row().reg.preferredClass || 'Not sure' }}</span>
        @if (row().reg.preferredDays?.length) { <span>{{ row().reg.preferredDays!.join(', ') }}</span> }
        @if (row().age !== null) { <span>Age {{ row().age }}</span> }
        @if (row().reg.interest) { <span>{{ row().reg.interest }}</span> }
      </div>

      <p class="pl-label">1 · Class</p>
      <div class="pl-cats">
        @for (c of store.categories(); track c.name) {
          <button type="button" class="pl-cat" [style.--c]="store.colour(c.name)" [class.is-on]="cat() === c.name"
                  (click)="pickCat(c.name)">
            {{ c.name }}
            @if (c.name === row().reg.preferredClass) { <small>wished</small> }
          </button>
        }
      </div>

      @if (cat() && usesSessions()) {
        <p class="pl-label">2 · Session</p>
        @if (!sessions().length) { <p class="hint">No sessions in {{ cat() }} yet. Add one on the Students page.</p> }
        <div class="pl-sess">
          @for (o of sessions(); track o.s.name) {
            <button type="button" class="pl-opt" [class.is-on]="ses() === o.s.name" [class.wished]="o.wished"
                    [style.--c]="store.colour(o.s.category)" (click)="ses.set(o.s.name)">
              <span class="pl-day">{{ o.s.day || '—' }}</span>
              <span class="pl-name"><b>{{ o.s.name }}</b><small>{{ o.s.time }}</small></span>
              <span class="pl-cap" [class.full]="o.free !== null && o.free <= 0">
                {{ o.free === null ? o.count + ' students' : o.free <= 0 ? 'Full' : o.free + ' free' }}
              </span>
            </button>
          }
        </div>
      }

      @if (cat()) {
        <details class="pl-more">
          <summary>Name on the register</summary>
          <label class="field"><span>Student name <em>change only if another student has the same name</em></span>
            <input type="text" [value]="name()" (input)="name.set($any($event.target).value)"></label>
        </details>
      }
      @if (error()) { <p class="pl-err" role="alert">⚠ {{ error() }}</p> }

      <footer class="sheet-foot">
        <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary pl-go" [disabled]="!ready() || busy()" (click)="place()">
          {{ busy() ? 'Placing…' : summary() }}
        </button>
      </footer>
    }
  </div>
</aside>
  `,
  styles: [`
    .pl-wish{display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:10px 12px; border-radius:12px; background:#fdf2fa; font-size:13.5px; margin-bottom:6px}
    .pl-wish b{color:#a21caf; margin-right:4px}
    .pl-wish span{background:#fff; border-radius:99px; padding:2px 10px; color:#5b4660; font-weight:600}
    .pl-label{margin:16px 0 8px; font-weight:800; font-size:13px; letter-spacing:.6px; text-transform:uppercase; color:#7a6c80}
    .pl-cats{display:flex; flex-wrap:wrap; gap:8px}
    .pl-cat{--c:#8e2b52; border:2px solid color-mix(in srgb, var(--c) 35%, #fff); background:#fff; color:var(--c); font:inherit; font-weight:800; font-size:15px;
      padding:9px 16px; border-radius:12px; cursor:pointer; display:flex; flex-direction:column; align-items:center; line-height:1.15; min-height:46px; justify-content:center}
    .pl-cat small{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; opacity:.8}
    .pl-cat.is-on{background:var(--c); color:#fff; border-color:var(--c); box-shadow:0 6px 16px color-mix(in srgb, var(--c) 35%, transparent)}
    .pl-sess{display:grid; gap:8px}
    .pl-opt{--c:#8e2b52; display:grid; grid-template-columns:96px 1fr auto; align-items:center; gap:10px; text-align:left; font:inherit; cursor:pointer;
      background:#fff; border:1.5px solid #ece5f0; border-left:5px solid var(--c); border-radius:12px; padding:10px 12px; min-height:56px}
    .pl-opt.wished{background:#fffbea}
    .pl-opt.is-on{border-color:var(--c); background:color-mix(in srgb, var(--c) 9%, #fff); box-shadow:0 0 0 3px color-mix(in srgb, var(--c) 20%, transparent)}
    .pl-day{font-weight:800; color:#fff; background:var(--c); border-radius:8px; padding:4px 8px; text-align:center; font-size:13.5px}
    .pl-name b{display:block; font-size:16px; color:#2d1430}
    .pl-name small{font-size:14px; color:#5b4660; font-weight:600}
    .pl-cap{font-size:12.5px; font-weight:800; padding:3px 10px; border-radius:99px; background:#d9f7e8; color:#047857; white-space:nowrap}
    .pl-cap.full{background:#fde2e2; color:#a32626}
    .pl-more{margin-top:14px; font-size:13.5px}
    .pl-more summary{cursor:pointer; color:#7a6c80; margin-bottom:8px}
    .pl-err{margin:12px 0 0; padding:10px 12px; border-radius:10px; background:#fff1f1; color:#a32626; font-weight:600}
    .pl-go{min-height:46px}
    .pl-done{margin:0 0 12px; padding:10px 14px; border-radius:12px; background:#e3f6ec; color:#0b6b3f; font-weight:800; font-size:15px}
    .pl textarea{width:100%; font:inherit; font-size:15px; line-height:1.5; resize:vertical}
    .pl-act{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px}
    .pl-act .btn-wa{min-height:46px; text-decoration:none}
    @media (max-width:560px){ .pl-opt{grid-template-columns:78px 1fr auto} }
  `],
})
export class PlaceSheet {
  protected store = inject(Store);
  private dialog = inject(Dialog);
  private api = inject(RegistrationApi);
  private toast = inject(Toast);

  readonly row = input.required<RegRow>();
  /** when opened from a session on the Classes page: that session, already picked */
  readonly session = input<Session | null>(null);
  readonly closed = output<void>();
  readonly placed = output<RegRow>();

  protected readonly cat = signal('');
  protected readonly ses = signal('');
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly newId = signal('');

  ngOnInit() {
    const r = this.row(), s = this.session();
    this.name.set(r.reg.childName);
    if (s) { this.cat.set(s.category); this.ses.set(s.name); }
    else if (r.reg.preferredClass && this.store.category(r.reg.preferredClass)) this.cat.set(this.store.category(r.reg.preferredClass)!.name);
  }

  protected readonly usesSessions = computed(() => this.store.usesSessions(this.cat()));

  protected readonly sessions = computed(() => {
    const days = this.row().reg.preferredDays ?? [];
    const counts = new Map<string, number>();
    for (const st of this.store.students()) if (st.active && st.session) counts.set(st.session, (counts.get(st.session) ?? 0) + 1);
    return this.store.sessions().filter(s => s.category === this.cat()).sort(sessionOrder).map(s => {
      const count = counts.get(s.name) ?? 0;
      return { s, count, free: s.max == null ? null : s.max - count, wished: days.includes(s.day) };
    });
  });

  protected readonly ready = computed(() => !!this.cat() && (!this.usesSessions() || !!this.ses() || !this.sessions().length));

  protected readonly summary = computed(() => {
    const s = this.store.sessions().find(x => x.name === this.ses());
    return !this.cat() ? 'Pick a class' : this.usesSessions() && !s && this.sessions().length ? 'Pick a session'
      : `Place in ${s ? s.name + ' · ' + s.day : this.cat()}`;
  });

  protected pickCat(c: string) {
    this.cat.set(c);
    if (!this.store.sessions().some(s => s.name === this.ses() && s.category === c)) this.ses.set('');
  }

  protected phone() {
    return this.row().reg.whatsapp || this.row().reg.phone;
  }

  protected async place() {
    const r = this.row();
    const s = this.usesSessions() ? this.store.sessions().find(x => x.name === this.ses()) ?? null : null;
    const free = s ? this.sessions().find(o => o.s.name === s.name)?.free ?? null : null;
    if (free !== null && free <= 0 && !await this.dialog.confirm(`${s!.name} is already full. Place ${r.reg.childName} there anyway?`)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const out = await this.api.place(r.reg.id, this.cat(), s?.name ?? '', this.name().trim() !== r.reg.childName ? this.name().trim() : '');
      await this.store.loadRoster(false);
      const st = this.store.findStudentById(out.placed?.studentId ?? '');
      this.newId.set(out.placed?.studentId ?? '');
      this.toast.show(`${r.reg.childName} placed in ${s ? s.name : this.cat()}.`);
      this.message.set(placedMessage({
        parent: r.reg.parentName, child: st?.name ?? r.reg.childName, academy: this.store.settings().academyName,
        number: r.reg.number, session: s?.name ?? '', category: this.cat(), day: s?.day ?? '', time: s?.time ?? '',
        fee: st?.fee ?? this.store.classFee(this.cat()),
      }));
      this.placed.emit(out);
    } catch (e) {
      this.error.set(errorMessage(e, 'Could not place the child.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Message copied.'), () => this.toast.show('Could not copy.'));
  }
}
