import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { MonthRow, MonthView, Payment, PaymentKind, SessionTotal } from '../../core/models';
import { Store, monthKey } from '../../core/store';
import { Toast } from '../../core/toast';
import { MONTHS, money, prettyDate, todayIso } from '../../receipt/format';

interface Group {
  key: string;
  session: SessionTotal | null;
  title: string;
  rows: MonthRow[];
  expected: number;
  collected: number;
}

type Filter = 'all' | 'due' | 'paid';

interface AddForm { amount: number | null; kind: PaymentKind; paidTo: string; date: string; note: string; }

/** Colours for the "where the money is" tiles, in the order of the Paid-to options. */
const TILE_COLOURS = ['#1f3864', '#1f4e79', '#b45309', '#4f6b50', '#6e2a52', '#33373c'];

@Component({
  selector: 'app-payments',
  imports: [FormsModule],
  templateUrl: './payments.html',
})
export class Payments {
  protected store = inject(Store);
  private api = inject(Api);
  private toast = inject(Toast);
  private router = inject(Router);

  protected readonly money = money;
  protected readonly prettyDate = prettyDate;

  protected readonly month = this.store.paymentsMonth;
  protected readonly view = signal<MonthView | null>(null);
  protected readonly loading = signal(false);
  protected readonly tab = signal('Kids');
  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly expanded = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly showByClass = signal(false);

  /** the Paid-to picked on a row before its fee is ticked */
  private readonly chosenPaidTo = signal<Record<string, string>>({});

  /** the add-payment form in the open row */
  protected readonly add = signal<AddForm>({ amount: null, kind: 'monthly', paidTo: '', date: todayIso(), note: '' });

  protected readonly options = computed(() => this.view()?.paidToOptions ?? this.store.settings().paidToOptions);

  protected readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return MONTHS[m - 1] + ' ' + y;
  });
  protected readonly isCurrentMonth = computed(() => this.month() === monthKey());

  protected readonly tiles = computed(() => {
    const v = this.view();
    if (!v) return [];
    const byName = new Map(v.totals.byPaidTo.map(p => [p.name, p]));
    const names = [...this.options(), ...v.totals.byPaidTo.map(p => p.name).filter(n => !this.options().includes(n))];
    return names.map((name, i) => ({
      name,
      amount: byName.get(name)?.amount ?? 0,
      count: byName.get(name)?.count ?? 0,
      colour: TILE_COLOURS[i % TILE_COLOURS.length],
      cash: /cash/i.test(name),
    }));
  });

  protected readonly tabs = computed(() => {
    const v = this.view();
    if (!v) return [];
    return v.categories
      .filter(c => v.rows.some(r => r.category === c.name))
      .map(c => ({ ...c, done: c.expected ? Math.min(1, c.collected / c.expected) : 0 }));
  });

  protected readonly groups = computed<Group[]>(() => {
    const v = this.view();
    if (!v) return [];
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    // a search looks across every class; otherwise just the open tab
    const rows = v.rows.filter(r => (q ? true : r.category === this.tab()))
      .filter(r => !q || (r.name + ' ' + r.studentId + ' ' + r.session + ' ' + r.parent).toLowerCase().includes(q))
      .filter(r => f === 'all' || (f === 'paid' ? r.status === 'Paid' || r.status === 'Free place' : r.status === 'Pending' || r.status === 'Partially Paid'));

    const out: Group[] = [];
    const sessions = v.sessions.filter(s => q || s.category === this.tab());
    for (const s of sessions) {
      const inIt = rows.filter(r => r.session.toLowerCase() === s.name.toLowerCase());
      if (inIt.length) out.push(this.group(s.name, s, s.name, inIt));
    }
    const placed = new Set(sessions.map(s => s.name.toLowerCase()));
    const rest = rows.filter(r => !placed.has(r.session.toLowerCase()));
    if (rest.length) {
      const noSessions = !q && !this.store.usesSessions(this.tab());
      out.push(this.group('_rest', null, noSessions ? this.tab() + ' students' : 'Not in a session', rest));
    }
    return out;
  });

  private group(key: string, session: SessionTotal | null, title: string, rows: MonthRow[]): Group {
    return {
      key, session, title, rows,
      expected: rows.filter(r => r.active).reduce((t, r) => t + (r.fee ?? 0), 0),
      collected: rows.reduce((t, r) => t + r.paid, 0),
    };
  }

  constructor() {
    effect(() => {
      const m = this.month();
      if (this.store.loaded()) untracked(() => this.load(m));
    });
  }

  /* ---------------- loading ---------------- */

  private async load(m = this.month()) {
    this.loading.set(true);
    try {
      const v = await this.api.month(m);
      if (m !== this.month()) return;   // moved on to another month meanwhile
      this.view.set(v);
      if (!v.rows.some(r => r.category === this.tab()) && v.categories.length) {
        const first = v.categories.find(c => v.rows.some(r => r.category === c.name));
        if (first) this.tab.set(first.name);
      }
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not load the month.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected shiftMonth(by: number) {
    const [y, m] = this.month().split('-').map(Number);
    this.month.set(monthKey(new Date(y, m - 1 + by, 1)));
    this.expanded.set(null);
  }

  protected thisMonth() {
    this.month.set(monthKey());
  }

  protected async startMonth() {
    try {
      this.view.set(await this.api.startMonth(this.month()));
      this.toast.show(this.monthLabel() + ' started — every student’s fee was copied in.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not start the month.'));
    }
  }

  /* ---------------- marking payments ---------------- */

  protected monthlyPayments(r: MonthRow) {
    return r.payments.filter(p => p.kind === 'monthly');
  }

  protected isPaidish(r: MonthRow) {
    return r.status === 'Paid' || r.status === 'Partially Paid';
  }

  protected paidTo(r: MonthRow): string {
    const fees = this.monthlyPayments(r);
    return fees.at(-1)?.paidTo ?? this.chosenPaidTo()[r.studentId] ?? this.options()[0] ?? '';
  }

  protected paidDate(r: MonthRow): string {
    const d = this.monthlyPayments(r).at(-1)?.date;
    return d ? prettyDate(d) : '';
  }

  protected receipts(r: MonthRow): Payment[] {
    const seen = new Set<string>();
    return r.payments.filter(p => p.receiptId && !seen.has(p.receiptId) && seen.add(p.receiptId));
  }

  /** One click: pay the fee in full, or take the payments off again. */
  protected async tick(r: MonthRow) {
    if (this.busy()) return;
    if (this.noTick(r)) return;
    const fees = this.monthlyPayments(r);
    if (fees.length) {
      const fromReceipt = fees.filter(p => p.receiptNumber).map(p => p.receiptNumber);
      const msg = fromReceipt.length
        ? `Mark ${r.name} as not paid?\n\nThis payment came from receipt ${fromReceipt.join(', ')}. The receipt stays in History.`
        : `Mark ${r.name} as not paid for ${this.monthLabel()}?`;
      if (!confirm(msg)) return;
      await this.run(r.studentId, async () => {
        for (const p of fees) await this.api.deletePayment(p.id);
      }, 'Marked as not paid.');
      return;
    }
    if (r.fee === null) {
      // online students have no set fee: ask how much
      this.open(r);
      return;
    }
    await this.run(r.studentId, () => this.api.createPayment({
      studentId: r.studentId, month: this.month(), paidTo: this.paidTo(r), date: todayIso(),
    }), `${r.name} — Rs. ${money(r.outstanding)} paid to ${this.paidTo(r)}.`);
  }

  protected async setPaidTo(r: MonthRow, value: string) {
    const fees = this.monthlyPayments(r);
    if (!fees.length) {
      this.chosenPaidTo.update(m => ({ ...m, [r.studentId]: value }));
      return;
    }
    await this.run(r.studentId, async () => {
      for (const p of fees) await this.api.updatePayment(p.id, { paidTo: value });
    });
  }

  protected async saveRemark(r: MonthRow, text: string) {
    if (text.trim() === (r.remark ?? '').trim()) return;
    try {
      this.view.set(await this.api.updateDue(this.month(), r.studentId, { remark: text }));
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not save the remark.'));
    }
  }

  /* ---------------- the open row ---------------- */

  protected open(r: MonthRow) {
    if (this.expanded() === r.studentId) { this.expanded.set(null); return; }
    this.expanded.set(r.studentId);
    this.add.set({
      amount: r.outstanding || null, kind: 'monthly', paidTo: this.paidTo(r), date: todayIso(), note: '',
    });
  }

  protected patchAdd(p: Partial<AddForm>) {
    this.add.update(a => ({ ...a, ...p }));
  }

  protected async addPayment(r: MonthRow) {
    const a = this.add();
    if (!a.amount || a.amount <= 0) { this.toast.show('Enter the amount paid.'); return; }
    await this.run(r.studentId, () => this.api.createPayment({
      studentId: r.studentId, month: this.month(), kind: a.kind, amount: a.amount, paidTo: a.paidTo,
      date: a.date, note: a.note,
    }), 'Payment recorded.');
    this.patchAdd({ amount: null, note: '' });
  }

  protected async removePayment(r: MonthRow, p: Payment) {
    const msg = p.receiptNumber
      ? `Remove this payment of Rs. ${money(p.amount)}?\n\nIt came from receipt ${p.receiptNumber}, which stays in History.`
      : `Remove this payment of Rs. ${money(p.amount)}?`;
    if (!confirm(msg)) return;
    await this.run(r.studentId, () => this.api.deletePayment(p.id), 'Payment removed.');
  }

  protected async setMonthFee(r: MonthRow, value: unknown) {
    const fee = value === '' || value === null ? null : Number(value);
    if (fee === r.fee) return;
    try {
      this.view.set(await this.api.updateDue(this.month(), r.studentId,
        fee === null ? { reset: true } : { fee }));
      this.toast.show(fee === null ? 'Back to the usual fee.' : `${this.monthLabel()} fee set to Rs. ${money(fee)} for ${r.name}.`);
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not change the fee.'));
    }
  }

  protected issueReceipt(r: MonthRow) {
    this.router.navigate(['/'], { queryParams: { student: r.studentId, month: this.month() } });
  }

  /** Searching across every class; one match opens that student's details straight away. */
  protected search(text: string) {
    this.query.set(text);
    this.suggestOpen.set(!!text.trim());
    this.active.set(0);
    const rows = text.trim() ? this.groups().flatMap(g => g.rows) : [];
    if (rows.length === 1) this.expanded.set(rows[0].studentId);
    else if (!text.trim()) this.expanded.set(null);
  }

  /* ---- the suggestions under the search: pick a student, get their receipt on WhatsApp ---- */

  protected readonly suggestOpen = signal(false);
  /** the highlighted suggestion, moved with the arrow keys */
  protected readonly active = signal(0);

  protected readonly suggestions = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    const rows = this.view()?.rows ?? [];
    return rows
      .filter(r => { const hay = (r.name + ' ' + r.studentId + ' ' + r.parent + ' ' + r.session).toLowerCase(); return words.every(w => hay.includes(w)); })
      // names that start with what was typed come first
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 8);
  });

  protected onSearchKey(e: KeyboardEvent) {
    const list = this.suggestions();
    if (e.key === 'Escape') { this.suggestOpen.set(false); return; }
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.suggestOpen.set(true); this.active.set((this.active() + 1) % list.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set((this.active() - 1 + list.length) % list.length); }
    else if (e.key === 'Enter') { e.preventDefault(); this.pickSuggestion(list[this.active()] ?? list[0]); }
  }

  /** The receipt for the month — a new one, or the one already issued — straight to WhatsApp. */
  protected pickSuggestion(r: MonthRow) {
    this.suggestOpen.set(false);
    const issued = this.receipts(r)[0];
    if (issued) this.sendReceipt(issued);
    else if (this.noTick(r)) { this.expanded.set(r.studentId); this.toast.show(`${r.name} has no fee due for ${this.monthLabel()}.`); }
    else this.issueAndSend(r);
  }

  /** ✓ in a suggestion: mark the fee paid without leaving the search. */
  protected async quickTick(r: MonthRow, e: Event) {
    e.stopPropagation();
    await this.tick(r);
  }

  /** the suggestion list closes a moment after the box loses focus, so a click on it still lands */
  protected blurSearch() {
    setTimeout(() => this.suggestOpen.set(false), 180);
  }

  /** The receipt for this month, filled in, with the WhatsApp panel open. Confirming it marks the fee paid. */
  protected issueAndSend(r: MonthRow) {
    this.router.navigate(['/'], { queryParams: { student: r.studentId, month: this.month(), wa: 1 } });
  }

  /** A receipt already issued, sent (again) on WhatsApp. */
  protected sendReceipt(p: Payment) {
    this.router.navigate(['/'], { queryParams: { open: p.receiptId, send: 1 } });
  }

  protected openReceipt(p: Payment) {
    this.router.navigate(['/'], { queryParams: { open: p.receiptId } });
  }

  protected async exportCsv() {
    try {
      await this.api.downloadMonthCsv(this.month());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not export the month.'));
    }
  }

  private async run(id: string, work: () => Promise<unknown>, done?: string) {
    this.busy.set(id);
    try {
      await work();
      await this.load();
      if (done) this.toast.show(done);
    } catch (e) {
      this.toast.show(errorMessage(e, 'That did not work.'));
      await this.load();
    } finally {
      this.busy.set(null);
    }
  }

  /* ---------------- display ---------------- */

  protected statusClass(s: string) {
    return {
      'Paid': 'is-paid', 'Partially Paid': 'is-part', 'Pending': 'is-due', 'Free place': 'is-free', 'Inactive': 'is-off',
      'Not due': 'is-off',
    }[s] ?? '';
  }

  /** "46.6%", as the workbook shows it ("100%", not "100.0%") */
  protected pct(n: number) {
    return Math.round(n * 1000) / 10 + '%';
  }

  protected kindLabel(k: string) {
    return this.store.feeTypeName(k);
  }

  /** what a payment can be for: the fee types from Settings, then free-text "other" */
  protected readonly feeTypes = computed(() => this.store.settings().feeTypes ?? []);

  /** picking a fee type fills its usual amount */
  protected setAddKind(kind: string, r: MonthRow) {
    const t = this.feeTypes().find(x => x.id === kind);
    this.patchAdd({ kind, amount: kind === 'monthly' ? (r.outstanding || null) : (t?.defaultAmount ?? this.add().amount) });
  }

  protected noTick(r: MonthRow) {
    return !r.active || r.status === 'Free place' || r.status === 'Not due';
  }

  protected freeLabel(s: SessionTotal) {
    if (s.max === null || s.free === null) return '';
    if (s.free > 0) return s.free + ' free';
    return s.free === 0 ? 'Full' : 'Over by ' + -s.free;
  }
}
