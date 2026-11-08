import { classColour } from './colours';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Api, errorMessage } from './api';
import { AppSettings, Category, Receipt, Session, Student } from './models';
import { Toast } from './toast';

export const DEFAULT_SETTINGS: AppSettings = {
  academyName: 'Shalom Academy of Performing Arts',
  tagline: '',
  motto: 'Where Music Truly Comes to Life for Children.',
  address: '',
  phone: '',
  whatsapp: '0706 333 778',
  email: '',
  logo: '',
  signature: '',
  signName: 'Rebeccah Shalom',
  signTitle: 'Authorised Signature',
  signStyle: 'typed',
  prefix: 'SAPA',
  numFormat: 'datetime',
  currency: 'LKR',
  currencyWord: 'Rupees',
  theme: 'monthly',
  classes: [{ name: 'Guitar and Vocal', fee: 0 }, { name: 'Ukulele and Vocal', fee: 0 }],
  admissionFee: 0,
  footer: 'Thank you so much for your support and trust! ❤️',
  paidToOptions: ['Shalom Academy', 'Rebeccah Nayomi', 'Cash'],
  paymentMethods: ['Bank Transfer', 'Online Payment', 'Cash', 'Cheque', 'Card'],
  feeTypes: [{ id: 'monthly', name: 'Monthly fee', defaultAmount: null },
             { id: 'admission', name: 'Admission fee', defaultAmount: null }],
  siblingDiscount: { enabled: false, type: 'percent', value: 0 },
  studentFields: [],
  countryCode: '94',
  whatsappMessage: 'Dear {parent},\n\nThank you for the payment of Rs. {total} for {student} ({period}). Your receipt {number} is attached.\n\n{academy}',
};

/** "2026-11" for a date, in the browser's own time zone. */
export const monthKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

/**
 * Everything the pages share: settings, roster and saved receipts, loaded from the API once
 * and kept in signals so every page sees the same copy.
 */
@Injectable({ providedIn: 'root' })
export class Store {
  private api = inject(Api);
  private toast = inject(Toast);

  readonly settings = signal<AppSettings>(DEFAULT_SETTINGS);
  readonly students = signal<Student[]>([]);
  readonly sessions = signal<Session[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly receipts = signal<Receipt[]>([]);

  /** the month the Payments page last showed, kept when switching tabs */
  readonly paymentsMonth = signal(monthKey());

  /** the New receipt form as it was left, so switching tabs does not lose it */
  readonly draft = signal<unknown>(null);

  /** why the roster is missing, shown under the name box */
  readonly rosterError = signal('');
  readonly loaded = signal(false);

  readonly sessionsByName = computed(() => {
    const map = new Map<string, Session>();
    for (const s of this.sessions()) map.set(s.name.toLowerCase(), s);
    return map;
  });

  async load() {
    await Promise.all([this.loadSettings(), this.loadRoster(false), this.loadReceipts()]);
    this.loaded.set(true);
  }

  /** Signed out: drop everything from memory so the next person starts clean. */
  clear() {
    this.settings.set(DEFAULT_SETTINGS);
    this.students.set([]);
    this.sessions.set([]);
    this.categories.set([]);
    this.receipts.set([]);
    this.draft.set(null);
    this.rosterError.set('');
    this.loaded.set(false);
  }

  async loadSettings() {
    try {
      this.settings.set({ ...DEFAULT_SETTINGS, ...(await this.api.settings()) });
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not load settings — using the defaults.'));
    }
  }

  async loadRoster(announce: boolean) {
    try {
      const r = await this.api.roster();
      this.students.set(r.students);
      this.sessions.set(r.sessions);
      this.categories.set(r.categories ?? []);
      this.rosterError.set(r.students.length ? '' : 'The server has no students in data/students.json.');
      if (announce) this.toast.show(r.students.length + ' students reloaded from the server.');
    } catch (e) {
      const msg = errorMessage(e, 'Could not load the student list.');
      this.rosterError.set(msg);
      if (announce) this.toast.show(msg);
    }
  }

  async loadReceipts() {
    try {
      this.receipts.set(await this.api.receipts());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not load saved receipts.'));
    }
  }

  private settingsEdits = 0;
  private settingsTimer?: ReturnType<typeof setTimeout>;

  /**
   * The preview follows at once; the server is told a moment after typing stops. Its reply is
   * only applied if nothing was typed meanwhile, so a slow save never undoes a keystroke.
   */
  updateSettings(s: AppSettings) {
    this.settings.set(s);
    const edit = ++this.settingsEdits;
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(async () => {
      try {
        const saved = await this.api.saveSettings(s);
        if (edit === this.settingsEdits) this.settings.set({ ...DEFAULT_SETTINGS, ...saved });
      } catch (e) {
        this.toast.show(errorMessage(e, 'Could not save settings.'));
      }
    }, 400);
  }

  /** Saves and returns the stored copy (with its id), or throws with a readable message. */
  async saveReceipt(r: Receipt): Promise<Receipt> {
    const saved = await this.api.saveReceipt(r);
    this.receipts.update(list => [saved, ...list.filter(x => x.id !== saved.id)]);
    return saved;
  }

  /** Notes that the receipt went to the parent on WhatsApp. */
  async markSent(id: string, to: string): Promise<Receipt> {
    const saved = await this.api.markSent(id, to);
    this.receipts.update(list => list.map(x => x.id === saved.id ? saved : x));
    return saved;
  }

  async deleteReceipt(id: string, removePayments: boolean) {
    await this.api.deleteReceipt(id, removePayments);
    this.receipts.update(list => list.filter(x => x.id !== id));
  }

  /** the colour that marks a class on every page */
  colour(category: string | null | undefined): string {
    return classColour(category, this.categories().map(c => c.name));
  }

  findStudentById(id: string): Student | null {
    return this.students().find(s => s.id === id) ?? null;
  }

  category(name: string): Category | null {
    return this.categories().find(c => c.name.toLowerCase() === (name ?? '').toLowerCase()) ?? null;
  }

  /** the class fee charged this month, after any scheduled change; null = pay as you go */
  classFee(category: string, month = monthKey()): number | null {
    const c = this.category(category);
    if (!c || c.billing === 'payg') return null;
    let fee = c.fee;
    for (const ch of [...(c.changes ?? [])].sort((a, b) => a.from.localeCompare(b.from))) {
      if (ch.from <= month) fee = ch.fee;
    }
    return fee;
  }

  /** false for classes such as Online, whose students have no session */
  usesSessions(category: string): boolean {
    return this.category(category)?.usesSessions ?? true;
  }

  feeTypeName(id: string): string {
    if (id === 'other') return 'Other';
    return this.settings().feeTypes?.find(t => t.id === id)?.name ?? id;
  }

  findStudent(name: string): Student | null {
    const k = name.trim().toLowerCase();
    if (!k) return null;
    return this.students().find(s => s.name.toLowerCase() === k) ?? null;
  }

  /** Name starts with the query, then name contains it, then the student ID matches. */
  searchStudents(q: string): Student[] {
    const k = q.trim().toLowerCase();
    if (!k) return [];
    const starts: Student[] = [], has: Student[] = [], byId: Student[] = [];
    for (const s of this.students()) {
      const n = s.name.toLowerCase();
      if (n.startsWith(k)) starts.push(s);
      else if (n.includes(k)) has.push(s);
      else if (s.id && s.id.toLowerCase().includes(k)) byId.push(s);
    }
    return [...starts, ...has, ...byId];
  }
}
