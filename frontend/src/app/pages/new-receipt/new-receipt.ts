import {
  Component, HostListener, Injector, afterNextRender, computed, effect, inject, signal, untracked,
  viewChild, viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Student, AppSettings } from '../../core/models';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { PAGE, saveJpg, savePdf, sheetCanvas } from '../../receipt/export';
import { MONTHS, fillMessage, makeNumber, money, names, num, prettyWa, safeName, todayIso } from '../../receipt/format';
import {
  Extra, ReceiptForm, StudentSlot, buildReceipt, emptyExtra, emptySlot, formFromReceipt, problem,
} from '../../receipt/receipt-form';
import { ReceiptSheet, SITE_SIGNATURE } from '../../receipt/receipt-sheet';
import { prepareSignature } from '../../receipt/signature';
import { StudentPicker } from './student-picker';
import { WhatsAppSend, WhatsAppSent } from './whatsapp-send';

/** What the WhatsApp panel is opened with. */
interface WaJob {
  title: string;
  parent: string;
  phone: string;
  message: string;
  fileBase: string;
  meta: { title: string; subject: string; author: string };
  /** the student whose record holds the number */
  student: Student | null;
}

type Slot = 1 | 2 | 3;

/** "Admission fee" → "Admission Fee", to match the other lines printed on the receipt */
const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

@Component({
  selector: 'app-new-receipt',
  imports: [FormsModule, ReceiptSheet, StudentPicker, WhatsAppSend],
  templateUrl: './new-receipt.html',
})
export class NewReceipt {
  protected store = inject(Store);
  private toast = inject(Toast);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private injector = inject(Injector);
  private api = inject(Api);

  private sheet = viewChild.required(ReceiptSheet);
  private picker1 = viewChild<StudentPicker>('picker1');
  /** the second and third students' pickers, in order */
  private extraPickers = viewChildren<StudentPicker>('pickerN');

  protected readonly MONTHS = MONTHS;
  protected readonly methods = computed(() => {
    // a method used on an older receipt stays selectable even after it leaves the list
    const list = [...(this.store.settings().paymentMethods ?? [])];
    const m = this.form().method;
    if (m && !list.includes(m)) list.push(m);
    return list;
  });
  /** fee types a receipt line can be, besides the monthly and admission fees */
  protected readonly extraTypes = computed(() =>
    (this.store.settings().feeTypes ?? []).filter(t => t.id !== 'monthly' && t.id !== 'admission'));
  protected readonly admissionLabel = computed(() =>
    titleCase(this.store.feeTypeName('admission')));
  protected readonly money = money;

  protected readonly form = signal<ReceiptForm>(this.blankForm());
  protected readonly receipt = computed(() => buildReceipt(this.form(), this.admissionLabel()));
  protected readonly settings = this.store.settings;
  protected readonly busy = signal<'' | 'pdf' | 'jpg'>('');
  protected readonly signature = signal('');
  protected readonly wa = signal<WaJob | null>(null);
  protected readonly waSaving = signal(false);
  /** when the receipt in the form was sent on WhatsApp */
  protected readonly sentInfo = computed(() => {
    const id = this.form().id;
    const r = id ? this.store.receipts().find(x => x.id === id) : null;
    return r?.sentAt ? { to: prettyWa(r.sentTo ?? ''), at: new Date(r.sentAt) } : null;
  });

  protected readonly categories = computed(() =>
    Array.from(new Set(this.store.students().map(s => s.category).filter(Boolean))));

  /** Class options, plus a class from a reopened receipt that is no longer in Settings. */
  protected readonly classOptions = computed(() => {
    const names = this.settings().classes.map(c => c.name);
    const f = this.form();
    for (const c of [f.s1.cls, f.s2.cls, f.s3?.cls]) if (c && !names.includes(c)) names.push(c);
    return names;
  });

  protected readonly rosterHint = computed(() => {
    const err = this.store.rosterError();
    if (err) return { text: err, warn: true };
    const n = this.store.students().length;
    return {
      text: n ? n + ' students — add or change them on the Students page.'
              : 'Type any part of a name — details fill in from the student list.',
      warn: false,
    };
  });

  constructor() {
    // Once settings and roster are in, start a blank receipt — or open the one in ?open=<id>.
    effect(() => {
      if (!this.store.loaded()) return;
      untracked(() => {
        const params = this.route.snapshot.queryParamMap;
        const id = params.get('open');
        const student = params.get('student');
        const saved = id ? this.store.receipts().find(r => r.id === id) : null;
        const draft = this.store.draft() as ReceiptForm | null;
        if (saved) {
          this.form.set(formFromReceipt(saved, n => this.store.findStudent(n)));
        } else if (student) {
          // "Issue receipt" on the Payments page; "Send receipt on WhatsApp" also opens the WhatsApp panel
          const wa = !!params.get('wa');
          this.prefill(student, params.get('month') ?? '').then(() => {
            if (wa) afterNextRender(() => this.openWhatsApp(), { injector: this.injector });
          });
        } else if (draft) {
          // carry on where we were
          this.form.set({ ...draft, three: draft.three ?? false, s3: draft.s3 ?? emptySlot(),
            paidTo: draft.paidTo ?? this.defaultPaidTo(), extras: draft.extras ?? [emptyExtra()] });
        } else {
          this.reset();
        }
        // "Send" in History opens the receipt straight into the WhatsApp panel
        if (saved && params.get('send')) afterNextRender(() => this.openWhatsApp(), { injector: this.injector });
        if (id || student) this.router.navigate([], { queryParams: {}, replaceUrl: true });
      });
    });

    // keep the half-filled form while visiting the other tabs
    effect(() => {
      const f = this.form();
      if (this.store.loaded()) this.store.draft.set(f);
    });

    // The signature image is trimmed to its ink before it goes on the sheet.
    effect(() => {
      const s = this.settings();
      if (s.signStyle !== 'image') return;
      prepareSignature(s.signature || SITE_SIGNATURE).then(d => this.signature.set(d));
    });
  }

  /* ---------------- form state ---------------- */

  private blankForm(): ReceiptForm {
    const now = new Date();
    return {
      id: null, number: '', date: todayIso(now), two: false, three: false,
      s1: emptySlot(), s2: emptySlot(), s3: emptySlot(),
      month: MONTHS[now.getMonth()], year: now.getFullYear(),
      extras: [emptyExtra()], method: this.store.settings().paymentMethods?.[0] ?? 'Bank Transfer', paidTo: this.defaultPaidTo(),
      payer: '', reference: '', note: '',
    };
  }

  // reads the store directly: this runs while fields are still being set up, before `settings`
  private defaultPaidTo() {
    return this.store.settings().paidToOptions?.[0] ?? '';
  }

  /**
   * A receipt for one student's month, from the Payments page. The fee is what they paid if
   * the fee is already ticked (the receipt then links to that payment), else what they owe.
   */
  private async prefill(studentId: string, month: string) {
    this.reset();
    const s = this.store.findStudentById(studentId);
    if (!s) { this.toast.show('That student is no longer on the Students page.'); return; }
    this.applyStudent(1, s, true);
    const [y, m] = month.split('-').map(Number);
    if (y && m) this.patch({ month: MONTHS[m - 1], year: y });
    if (s.parent) this.patch({ payer: s.parent });
    try {
      const row = (await this.api.month(month)).rows.find(r => r.studentId === studentId);
      if (!row) return;
      const fees = row.payments.filter(p => p.kind === 'monthly');
      const amount = fees.length ? row.paid : row.outstanding;
      this.patchSlot(1, { monthly: amount || null });
      const paidTo = fees.at(-1)?.paidTo;
      if (paidTo) this.patch({ paidTo, method: /cash/i.test(paidTo) ? 'Cash' : this.form().method });
      const admission = row.payments.find(p => p.kind === 'admission');
      if (admission) this.patchSlot(1, { admission: admission.amount });
      // any other fee already recorded this month goes on as its own line
      const extras: Extra[] = row.payments.filter(p => p.kind !== 'monthly' && p.kind !== 'admission')
        .map(p => ({ type: p.kind, label: p.kind === 'other' ? (p.note ?? 'Other charge') : this.store.feeTypeName(p.kind), amount: p.amount }));
      if (extras.length) this.patch({ extras });
    } catch {
      /* the form is still usable with the roster fee */
    }
  }

  /** Cash in hand goes to the cash option; anything else to the usual account. */
  protected setMethod(method: string) {
    const options = this.settings().paidToOptions ?? [];
    const cash = options.find(o => /cash/i.test(o));
    const cur = this.form().paidTo;
    const isCash = /cash/i.test(method);
    let paidTo = cur;
    if (isCash && cash) paidTo = cash;
    else if (!isCash && cash && cur === cash) paidTo = this.defaultPaidTo();
    this.patch({ method, paidTo });
  }

  /* ---------------- extra charge lines ---------------- */

  protected patchExtra(i: number, p: Partial<Extra>) {
    this.patch({ extras: this.form().extras.map((x, j) => j === i ? { ...x, ...p } : x) });
  }

  /** Picking a fee type names the line after it and fills its usual amount. */
  protected setExtraType(i: number, type: string) {
    const t = this.extraTypes().find(x => x.id === type);
    const cur = this.form().extras[i];
    this.patchExtra(i, t
      ? { type, label: t.name, amount: cur.amount || t.defaultAmount }
      : { type: 'other', label: '' });
  }

  protected addExtra() {
    this.patch({ extras: [...this.form().extras, emptyExtra()] });
  }

  protected removeExtra(i: number) {
    const left = this.form().extras.filter((_, j) => j !== i);
    this.patch({ extras: left.length ? left : [emptyExtra()] });
  }

  private classFee(name: string): number {
    return this.settings().classes.find(c => c.name === name)?.fee ?? 0;
  }

  protected reset() {
    const first = this.settings().classes[0]?.name ?? '';
    const f = this.blankForm();
    f.number = makeNumber(this.settings());
    f.s1 = { ...emptySlot(first), monthly: this.classFee(first) || null };
    f.s2 = emptySlot(first);
    f.s3 = emptySlot(first);
    this.form.set(f);
  }

  protected newReceipt() {
    this.reset();
    this.toast.show('Blank receipt ready.');
  }

  protected patch(p: Partial<ReceiptForm>) {
    this.form.update(f => ({ ...f, ...p }));
  }

  protected slot(n: Slot): StudentSlot {
    const f = this.form();
    return n === 1 ? f.s1 : n === 2 ? f.s2 : (f.s3 ?? emptySlot());
  }

  protected patchSlot(n: Slot, p: Partial<StudentSlot>) {
    this.form.update(f => n === 1 ? { ...f, s1: { ...f.s1, ...p } }
      : n === 2 ? { ...f, s2: { ...f.s2, ...p } }
      : { ...f, s3: { ...(f.s3 ?? emptySlot()), ...p } });
  }

  protected onStudentText(n: Slot, text: string) {
    const exact = this.store.findStudent(text);
    if (exact) this.applyStudent(n, exact, false);
    else this.patchSlot(n, { name: text, picked: null, session: '' });
  }

  /**
   * Fill a slot from the roster. Picking a student from the list sets their own fee; an exact
   * name typed in only fills an empty fee box, so it never overwrites an amount typed by hand.
   */
  protected applyStudent(n: Slot, s: Student, explicit: boolean) {
    const cur = this.slot(n);
    const p: Partial<StudentSlot> = {
      name: s.name, id: s.id, category: s.category, day: s.day, time: s.time,
      session: s.session, picked: s,
    };
    if (s.session && this.settings().classes.some(c => c.name === s.session)) p.cls = s.session;
    // a fee of 0 is a real answer (a free place), so test for "on file", not truthiness
    if (s.fee !== null && (explicit || !num(cur.monthly))) p.monthly = s.fee;
    this.patchSlot(n, p);
  }

  protected clearStudent(n: Slot) {
    this.patchSlot(n, { name: '', id: '', category: '', day: '', time: '', session: '', picked: null });
    this.focusPicker(n);
  }

  protected setTwo(on: boolean) {
    if (on) {
      this.patch({ two: true });
      afterNextRender(() => this.focusPicker(2), { injector: this.injector });
    } else {
      // clearing on the way out keeps a stale sibling out of the next receipt
      this.patch({ two: false, three: false, s2: emptySlot(this.form().s1.cls), s3: emptySlot(this.form().s1.cls) });
    }
  }

  /** a third brother or sister on the same receipt */
  protected setThree(on: boolean) {
    if (on) {
      this.patch({ three: true, s3: emptySlot(this.form().s1.cls) });
      afterNextRender(() => this.focusPicker(3), { injector: this.injector });
    } else {
      this.patch({ three: false, s3: emptySlot(this.form().s1.cls) });
    }
  }

  /** the slots after the first: [2], or [2, 3] with a third student */
  protected readonly extraSlots = computed<Slot[]>(() => {
    const f = this.form();
    return !f.two ? [] : f.three ? [2, 3] : [2];
  });

  private focusPicker(n: Slot) {
    if (n === 1) this.picker1()?.focus();
    else this.extraPickers()[n - 2]?.focus();
  }

  protected setClass(n: Slot, cls: string) {
    const fee = this.classFee(cls);
    this.patchSlot(n, fee ? { cls, monthly: fee } : { cls });
  }

  protected renumber() {
    this.patch({ number: makeNumber(this.settings()), id: null });
    this.toast.show('New receipt number generated.');
  }

  /* ---------------- display helpers ---------------- */

  /** Fee rows only name a child once there are two of them. */
  protected who(n: Slot): string {
    if (!this.form().two) return '';
    const first = this.slot(n).name.trim().split(/\s+/)[0] || '';
    return first ? '— ' + first : '';
  }

  protected chips(n: Slot): { k: string; v: string; off?: boolean }[] {
    const s = this.slot(n);
    if (!s.name.trim()) return [];
    const bits = [
      { k: 'ID', v: s.id }, { k: 'Category', v: s.category }, { k: 'Day', v: s.day }, { k: 'Time', v: s.time },
    ].filter(b => b.v && b.v.trim());
    if (s.picked && s.picked.fee !== null) bits.push({ k: 'Fee', v: 'Rs. ' + money(s.picked.fee) });
    if (bits.length && s.picked && !s.picked.active) return [...bits, { k: 'Status', v: 'Inactive', off: true }];
    return bits;
  }

  /* ---------------- issue: save, then download ---------------- */

  /**
   * The receipt is recorded on the server before any file is made, so nothing can be sent to a
   * parent that is missing from History.
   */
  private async issue(): Promise<boolean> {
    const f = this.form(), r = this.receipt();
    const why = problem(f, r);
    if (why) {
      this.toast.show(why);
      if (why.startsWith('Pick')) this.picker1()?.focus();
      else if (why.startsWith('Add the second')) this.focusPicker(2);
      else if (why.startsWith('Add the third')) this.focusPicker(3);
      else if (why.startsWith('Enter')) document.getElementById('fMonthly')?.focus();
      return false;
    }
    try {
      const saved = await this.store.saveReceipt(r);
      this.patch({ id: saved.id });
      return true;
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not save the receipt.'));
      return false;
    }
  }

  private fileName(ext: string) {
    const r = this.receipt();
    return safeName('Receipt ' + r.number + ' - ' + names(r)) + '.' + ext;
  }

  protected async exportPdf() {
    if (this.busy()) return;
    this.busy.set('pdf');
    try {
      if (!(await this.issue())) return;
      const r = this.receipt();
      const canvas = await sheetCanvas(this.sheet().paper, () => this.sheet().fitPaper());
      await savePdf(canvas, this.fileName('pdf'), {
        title: 'Fee Receipt ' + r.number,
        subject: names(r) + ' — ' + r.period,
        author: this.settings().academyName,
      });
      this.toast.show(PAGE.label + ' PDF saved — ready to send on WhatsApp.');
    } catch (e) {
      console.error(e);
      this.toast.show('Could not build the PDF. The receipt is saved — try Print → Save as PDF.');
    } finally {
      this.busy.set('');
    }
  }

  protected async exportJpg() {
    if (this.busy()) return;
    this.busy.set('jpg');
    try {
      if (!(await this.issue())) return;
      const canvas = await sheetCanvas(this.sheet().paper, () => this.sheet().fitPaper());
      await saveJpg(canvas, this.fileName('jpg'));
      this.toast.show(`${PAGE.label} image saved — ${PAGE.w} × ${PAGE.h} mm at ${PAGE.dpi} dpi.`);
    } catch (e) {
      console.error(e);
      this.toast.show('Could not build the image. The receipt is saved — try Print → Save as PDF.');
    } finally {
      this.busy.set('');
    }
  }

  /* ---------------- send on WhatsApp ---------------- */

  protected readonly capture = () => sheetCanvas(this.sheet().paper, () => this.sheet().fitPaper());

  /**
   * Opens the WhatsApp panel. Nothing is saved yet: the receipt is only recorded, and the fee
   * marked paid, once the person confirms the message went.
   */
  protected openWhatsApp() {
    const f = this.form(), r = this.receipt();
    const why = problem(f, r);
    if (why) { this.toast.show(why); return; }
    const s = this.store;
    const student = [f.s1, f.two ? f.s2 : null, f.two && f.three ? f.s3 : null]
      .map(x => x?.id ? s.findStudentById(x.id) : null).find(x => !!x) ?? null;
    const withPhone = [f.s1, f.two ? f.s2 : null, f.two && f.three ? f.s3 : null]
      .map(x => x?.id ? s.findStudentById(x.id) : null).find(x => !!x?.phone) ?? student;
    const parent = (withPhone?.parent || f.payer || '').trim();
    const st = this.settings();
    this.wa.set({
      title: names(r) + ' — ' + r.period,
      parent,
      phone: withPhone?.phone ?? '',
      message: fillMessage(st.whatsappMessage || '', {
        parent: parent || 'Parent',
        student: names(r),
        period: r.period,
        total: money(r.total),
        number: r.number,
        academy: st.academyName,
      }),
      fileBase: safeName('Receipt ' + r.number + ' - ' + names(r)),
      meta: { title: 'Fee Receipt ' + r.number, subject: names(r) + ' — ' + r.period, author: st.academyName },
      student: withPhone,
    });
  }

  protected async onWhatsAppSent(e: WhatsAppSent) {
    const job = this.wa();
    if (!job || this.waSaving()) return;
    this.waSaving.set(true);
    try {
      // saving the receipt is what marks the fee paid on the Payments page
      if (!(await this.issue())) return;
      // the number it went to is noted when there is one; pasting by hand may leave it blank
      if (e.to) await this.store.markSent(this.form().id!, e.to);
      if (e.saveNumber && e.to && job.student) await this.saveNumber(job.student, e.to);
      this.wa.set(null);
      this.toast.show(`Sent to ${job.parent || (e.to ? prettyWa(e.to) : 'the parent')} — ${names(this.receipt())} marked as paid for ${this.receipt().period}.`);
    } catch (err) {
      this.toast.error(errorMessage(err, 'The receipt is saved, but could not note that it was sent.'));
    } finally {
      this.waSaving.set(false);
    }
  }

  private async saveNumber(s: Student, to: string) {
    try {
      await this.api.updateStudent(s.id, {
        name: s.name, category: s.category, session: s.session, specialFee: s.specialFee ?? null,
        active: s.active, parent: s.parent, phone: prettyWa(to), note: s.note, country: s.country,
        family: s.family ?? '', custom: s.custom ?? {},
      });
      await this.store.loadRoster(false);
    } catch {
      /* the receipt went and is saved; the number can be added on the Students page */
    }
  }

  protected async print() {
    if (await this.issue()) setTimeout(() => window.print(), 60);
  }

  /** On a phone the preview sits below the form: take the person to it. */
  protected showPreview() {
    document.getElementById('receiptPreview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  @HostListener('window:keydown', ['$event'])
  protected onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.exportPdf();
    }
  }
}
