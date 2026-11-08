import { ageOn, birthday } from '../../core/birthdays';
import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Billing, CategoryInput, Session, Student, StudentField, StudentInput } from '../../core/models';
import { Store, monthKey } from '../../core/store';
import { Toast } from '../../core/toast';
import { download } from '../../receipt/export';
import { MONTHS, money } from '../../receipt/format';

interface Editing {
  id: string | null;            // null = a new student
  form: StudentInput;
}

interface SessionEdit {
  create: boolean;
  name: string;                 // the session's current name (its identity)
  rename: string;               // what it is being called now
  category: string;
  day: string;
  time: string;
  max: number | null;
  meaning: string;
}

/** A class while it is being edited in the Classes panel. */
interface ClassDraft extends CategoryInput {
  key: number;                  // stable while rows move about
  students: number;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));

@Component({
  selector: 'app-students',
  imports: [FormsModule],
  templateUrl: './students.html',
})
export class Students {
  protected store = inject(Store);
  private api = inject(Api);
  private toast = inject(Toast);

  protected readonly money = money;
  protected readonly DAYS = DAYS;
  protected readonly MONTHS = MONTHS;
  protected readonly MONTHS_SHORT = MONTHS_SHORT;

  protected readonly tab = signal('');
  protected readonly query = signal('');
  protected readonly showInactive = signal(false);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly sessionEdit = signal<SessionEdit | null>(null);
  protected readonly classes = signal<ClassDraft[] | null>(null);
  protected readonly saving = signal(false);

  // the Classes page links here with ?q=<name> to find one student
  private readonly fromLink = (() => {
    const q = inject(ActivatedRoute).snapshot.queryParamMap.get('q');
    if (q) { this.query.set(q); this.showInactive.set(true); }
    return q;
  })();

  private nameBox = viewChild<ElementRef<HTMLInputElement>>('nameBox');

  protected readonly categories = this.store.categories;
  protected readonly fields = computed(() => this.store.settings().studentFields ?? []);
  protected readonly listFields = computed(() => this.fields().filter(f => f.inList));

  /** the open tab, or the first class when none is chosen yet */
  protected readonly current = computed(() => this.tab() || this.categories()[0]?.name || '');
  protected readonly currentUsesSessions = computed(() => this.store.usesSessions(this.current()));

  protected readonly counts = computed(() => {
    const out: Record<string, { active: number; inactive: number; unplaced: number }> = {};
    for (const c of this.categories()) out[c.name] = { active: 0, inactive: 0, unplaced: 0 };
    for (const s of this.store.students()) {
      const c = out[s.category] ??= { active: 0, inactive: 0, unplaced: 0 };
      if (s.active) { c.active++; if (!s.session && this.store.usesSessions(s.category)) c.unplaced++; } else c.inactive++;
    }
    return out;
  });

  protected readonly totalActive = computed(() => this.store.students().filter(s => s.active).length);

  /** family names already in use, offered as suggestions */
  protected readonly families = computed(() =>
    [...new Set(this.store.students().map(s => s.family).filter(Boolean))].sort());

  protected readonly groups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const tab = this.current();
    const list = this.store.students()
      .filter(s => this.showInactive() || s.active)
      .filter(s => q ? this.haystack(s).includes(q) : s.category === tab);
    const sessions = this.store.sessions().filter(s => q || s.category === tab);
    const out: { key: string; session: Session | null; title: string; students: Student[]; active: number }[] = [];
    for (const s of sessions) {
      const inIt = list.filter(x => x.session.toLowerCase() === s.name.toLowerCase());
      const active = this.store.students().filter(x => x.active && x.session.toLowerCase() === s.name.toLowerCase()).length;
      if (inIt.length || !q) out.push({ key: s.name, session: s, title: s.name, students: inIt, active });
    }
    const placed = new Set(sessions.map(s => s.name.toLowerCase()));
    const rest = list.filter(x => !placed.has(x.session.toLowerCase()));
    if (rest.length) {
      out.push({
        key: '_rest', session: null, students: rest, active: rest.filter(x => x.active).length,
        title: !q && !this.currentUsesSessions() ? tab + ' students' : 'Not in a session yet',
      });
    }
    return out;
  });

  /** sessions the editor may offer: those of the chosen class */
  protected readonly sessionChoices = computed(() => {
    const e = this.editing();
    return e ? this.store.sessions().filter(s => !s.category || s.category === e.form.category) : [];
  });

  private haystack(s: Student) {
    return [s.name, s.id, s.parent, s.phone, s.family, ...Object.values(s.custom ?? {})].join(' ').toLowerCase();
  }

  /* ---------------- classes ---------------- */

  protected openClasses() {
    let key = 0;
    this.classes.set(this.categories().map(c => ({
      ...c, from: c.name, key: key++, changes: [...(c.changes ?? [])], termMonths: [...(c.termMonths ?? [])],
      students: this.store.students().filter(s => s.category === c.name).length
        + this.store.sessions().filter(s => s.category === c.name).length,
    })));
  }

  protected patchClass(key: number, p: Partial<ClassDraft>) {
    this.classes.update(list => list && list.map(c => c.key === key ? { ...c, ...p } : c));
  }

  protected setBilling(c: ClassDraft, billing: Billing) {
    const p: Partial<ClassDraft> = { billing };
    if (billing === 'payg') p.fee = null;
    if (billing === 'term' && !c.termMonths.length) p.termMonths = [1, 5, 9];
    this.patchClass(c.key, p);
  }

  protected toggleTermMonth(c: ClassDraft, m: number) {
    const has = c.termMonths.includes(m);
    this.patchClass(c.key, { termMonths: has ? c.termMonths.filter(x => x !== m) : [...c.termMonths, m].sort((a, b) => a - b) });
  }

  protected moveClass(i: number, by: number) {
    this.classes.update(list => {
      if (!list) return list;
      const copy = [...list];
      const [x] = copy.splice(i, 1);
      copy.splice(i + by, 0, x);
      return copy;
    });
  }

  protected addClass() {
    this.classes.update(list => list && [...list, {
      key: Math.max(0, ...list.map(c => c.key)) + 1, name: '', fee: null, billing: 'monthly', termMonths: [],
      usesSessions: true, changes: [], students: 0,
    }]);
  }

  protected removeClass(c: ClassDraft) {
    if (c.students) return;
    this.classes.update(list => list && list.filter(x => x.key !== c.key));
  }

  protected addChange(c: ClassDraft) {
    // next month, at the current fee, as a starting point to edit
    const d = new Date();
    const next = monthKey(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    this.patchClass(c.key, { changes: [...c.changes, { from: next, fee: c.fee ?? 0 }] });
  }

  protected patchChange(c: ClassDraft, i: number, p: { from?: string; fee?: number }) {
    this.patchClass(c.key, { changes: c.changes.map((x, j) => j === i ? { ...x, ...p } : x) });
  }

  protected removeChange(c: ClassDraft, i: number) {
    this.patchClass(c.key, { changes: c.changes.filter((_, j) => j !== i) });
  }

  protected async saveClasses() {
    const list = this.classes();
    if (!list || this.saving()) return;
    if (list.some(c => !c.name.trim())) { this.toast.show('Every class needs a name.'); return; }
    this.saving.set(true);
    try {
      await this.api.saveCategories(list.map(c => ({
        name: c.name.trim(), from: c.from || undefined,
        fee: c.billing === 'payg' || c.fee === null || (c.fee as unknown) === '' ? null : Number(c.fee),
        billing: c.billing, termMonths: c.termMonths, usesSessions: c.usesSessions,
        changes: c.changes.filter(x => x.from).map(x => ({ from: x.from, fee: Number(x.fee) || 0 })),
      })));
      const renamed = list.find(c => c.from && c.from === this.tab() && c.name.trim() !== c.from);
      await this.store.loadRoster(false);
      if (renamed) this.tab.set(renamed.name.trim());
      this.classes.set(null);
      this.toast.show('Classes saved.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not save the classes.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected billingNote(c: { billing: Billing; termMonths: number[] }) {
    if (c.billing === 'payg') return 'pay as you go';
    if (c.billing === 'term') return 'per term · ' + c.termMonths.map(m => MONTHS_SHORT[m - 1]).join(', ');
    return 'class fee';
  }

  /** the scheduled change still to come, if any, for the fee box */
  protected nextChange(name: string) {
    const c = this.store.category(name);
    const now = monthKey();
    return (c?.changes ?? []).filter(x => x.from > now).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
  }

  protected monthLabel(key: string) {
    const [y, m] = key.split('-').map(Number);
    return MONTHS_SHORT[m - 1] + ' ' + y;
  }

  /* ---------------- birthdays ---------------- */

  protected readonly todayIso = new Date().toISOString().slice(0, 10);

  protected age(dob: string | undefined): number | null {
    return ageOn(dob);
  }

  protected isBirthday(s: Student): boolean {
    return !!s.dateOfBirth && birthday(s, s.dateOfBirth)?.daysAway === 0;
  }

  /* ---------------- student editor ---------------- */

  private blank(category: string, session = ''): StudentInput {
    return { name: '', category, session, specialFee: null, active: true, parent: '', phone: '', note: '',
             country: '', family: '', custom: {}, dateOfBirth: '' };
  }

  private input(s: Student): StudentInput {
    return { name: s.name, category: s.category, session: s.session, specialFee: s.specialFee, active: s.active,
             parent: s.parent, phone: s.phone, note: s.note, country: s.country, family: s.family ?? '',
             custom: { ...(s.custom ?? {}) }, dateOfBirth: s.dateOfBirth ?? '' };
  }

  protected newStudent(session?: Session) {
    this.editing.set({ id: null, form: this.blank(session?.category || this.current(), session?.name ?? '') });
    setTimeout(() => this.nameBox()?.nativeElement.focus());
  }

  protected edit(s: Student) {
    this.editing.set({ id: s.id, form: this.input(s) });
  }

  protected patch(p: Partial<StudentInput>) {
    this.editing.update(e => e && ({ ...e, form: { ...e.form, ...p } }));
  }

  /** a field not filled in yet has no entry at all */
  protected customValue(form: StudentInput, key: string): string {
    return (form.custom as Record<string, string | undefined>)[key] ?? '';
  }

  protected setCustom(key: string, value: string) {
    this.editing.update(e => e && ({ ...e, form: { ...e.form, custom: { ...e.form.custom, [key]: value } } }));
  }

  protected setCategory(category: string) {
    const e = this.editing();
    if (!e) return;
    // a session belongs to one class, so moving class clears it unless it fits
    const keep = this.store.sessions().some(s => s.name === e.form.session && s.category === category);
    this.patch({ category, session: keep ? e.form.session : '' });
  }

  protected async save() {
    const e = this.editing();
    if (!e || this.saving()) return;
    if (!e.form.name.trim()) { this.toast.show('Enter the student’s name.'); return; }
    this.saving.set(true);
    try {
      const raw = e.form.specialFee as unknown;
      const form = { ...e.form, specialFee: raw === null || raw === '' ? null : Number(raw) };
      const saved = e.id ? await this.api.updateStudent(e.id, form) : await this.api.createStudent(form);
      await this.store.loadRoster(false);
      this.editing.set(null);
      if (!this.query()) this.tab.set(saved.category);
      this.toast.show(e.id ? `${saved.name} saved.` : `${saved.name} added as ${saved.id}.`);
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not save the student.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove() {
    const e = this.editing();
    if (!e?.id) return;
    if (!confirm(`Delete ${e.form.name} completely?\n\nOnly for someone added by mistake. A student who stops coming should be set to Inactive instead, which keeps their history.`)) return;
    try {
      await this.api.deleteStudent(e.id);
      await this.store.loadRoster(false);
      this.editing.set(null);
      this.toast.show('Student deleted.');
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not delete the student.'));
    }
  }

  protected async toggleActive(s: Student) {
    const to = !s.active;
    if (!to && !confirm(`Set ${s.name} to Inactive?\n\nTheir fee stops from the newest month and their place in ${s.session || 'the class'} becomes free. Their history stays.`)) return;
    try {
      await this.api.updateStudent(s.id, { ...this.input(s), active: to });
      await this.store.loadRoster(false);
      this.toast.show(`${s.name} is ${to ? 'active again' : 'now inactive'}.`);
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not change that.'));
    }
  }

  /* ---------------- sessions ---------------- */

  protected editSession(s: Session) {
    this.sessionEdit.set({ create: false, name: s.name, rename: s.name, category: s.category, day: s.day, time: s.time,
                           max: s.max, meaning: s.meaning });
  }

  protected newSession() {
    const cat = this.categories().find(c => c.usesSessions && c.name === this.current())?.name
             ?? this.categories().find(c => c.usesSessions)?.name ?? '';
    this.sessionEdit.set({ create: true, name: '', rename: '', category: cat, day: 'Saturday', time: '', max: 15, meaning: '' });
  }

  protected patchSession(p: Partial<SessionEdit>) {
    this.sessionEdit.update(s => s && ({ ...s, ...p }));
  }

  protected async saveSession() {
    const s = this.sessionEdit();
    if (!s || this.saving()) return;
    const name = (s.create ? s.rename : s.name).trim();
    if (!name || !s.rename.trim()) { this.toast.show('Give the session a name.'); return; }
    this.saving.set(true);
    try {
      await this.api.saveSession({
        name, rename: s.create ? undefined : s.rename.trim(), category: s.category, day: s.day, time: s.time.trim(),
        max: s.max === null || (s.max as unknown) === '' ? null : Number(s.max), meaning: s.meaning,
      }, s.create);
      await this.store.loadRoster(false);
      this.sessionEdit.set(null);
      this.toast.show(s.create ? `${name} added.` : `${s.rename.trim()} saved.`);
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not save the session.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteSession() {
    const s = this.sessionEdit();
    if (!s || s.create) return;
    if (!confirm(`Delete the session ${s.name}?`)) return;
    try {
      await this.api.deleteSession(s.name);
      await this.store.loadRoster(false);
      this.sessionEdit.set(null);
      this.toast.show(`${s.name} deleted.`);
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not delete the session.'));
    }
  }

  /* ---------------- export ---------------- */

  /** Every student, with their custom fields, as a CSV for Excel. */
  protected exportCsv() {
    const fields = this.fields();
    const head = ['Student ID', 'Name', 'Class', 'Session', 'Day', 'Time', 'Monthly fee', 'Special fee', 'Active',
      'Family', 'Parent', 'Phone', 'Country', 'Notes', ...fields.map(f => f.label)];
    const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')];
    for (const s of this.store.students()) {
      lines.push([s.id, s.name, s.category, s.session, s.day, s.time, s.fee ?? '', s.specialFee ?? '',
        s.active ? 'Active' : 'Inactive', s.family, s.parent, s.phone, s.country, s.note,
        ...fields.map(f => s.custom?.[f.key] ?? '')].map(q).join(','));
    }
    download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      'shalom-students-' + new Date().toISOString().slice(0, 10) + '.csv');
  }

  /* ---------------- display ---------------- */

  protected feeFor(s: Student) {
    if (s.fee === null) return 'per payment';
    if (s.fee === 0) return 'Free place';
    return money(s.fee);
  }

  protected fieldValue(s: Student, f: StudentField) {
    const v = s.custom?.[f.key];
    if (!v) return '';
    if (f.type === 'date') {
      const [y, m, d] = v.split('-').map(Number);
      return y && m && d ? d + ' ' + MONTHS_SHORT[m - 1] + ' ' + y : v;
    }
    return v;
  }

  protected inputType(f: StudentField) {
    return f.type === 'phone' ? 'tel' : f.type === 'select' ? 'text' : f.type;
  }

  protected fill(active: number, max: number | null) {
    if (!max) return '0%';
    return Math.min(100, Math.round(active / max * 100)) + '%';
  }

  protected freeLabel(active: number, max: number | null) {
    if (!max) return '';
    const free = max - active;
    return free > 0 ? free + ' free' : free === 0 ? 'Full' : 'Over by ' + -free;
  }

  @HostListener('window:keydown.escape')
  protected closeDialogs() {
    this.editing.set(null);
    this.sessionEdit.set(null);
    this.classes.set(null);
  }
}
