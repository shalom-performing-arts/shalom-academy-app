import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { errorMessage } from '../../core/api';
import {
  RegFormView, RegInput, RegRow, RegistrationApi, emailProblem, formLink, phoneProblem, toInput,
} from '../../core/registrations';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { waNumber } from '../../receipt/format';
import { PlaceSheet } from './place';

type Status = 'all' | 'pool' | 'placed';
type Tab = 'pool' | 'form';

/**
 * The Registration pool: every child registered through the online form, and the form itself
 * (its link, open or closed, the texts, the downloads).
 */
@Component({
  selector: 'app-registrations',
  imports: [FormsModule, PlaceSheet],
  templateUrl: './registrations.html',
  styleUrl: './registrations.css',
})
export class Registrations {
  protected store = inject(Store);
  private api = inject(RegistrationApi);
  private toast = inject(Toast);
  private router = inject(Router);

  protected readonly tab = signal<Tab>(inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'form' ? 'form' : 'pool');
  protected readonly rows = signal<RegRow[]>([]);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal('');
  protected readonly formView = signal<RegFormView | null>(null);

  /* ---------------- search and filters ---------------- */
  protected readonly q = signal('');
  protected readonly status = signal<Status>('pool');
  protected readonly cls = signal('');
  protected readonly month = signal('');
  protected readonly sort = signal<'new' | 'old' | 'name' | 'age'>('new');

  constructor() {
    this.reload();
  }

  protected async reload() {
    try {
      const [rows, form] = await Promise.all([this.api.list(), this.api.form()]);
      this.rows.set(rows);
      this.formView.set(form);
      this.loadError.set('');
    } catch (e) {
      this.loadError.set(errorMessage(e, 'Could not load the registrations.'));
    } finally {
      this.loaded.set(true);
    }
  }

  protected readonly counts = computed(() => {
    const r = this.rows(), now = new Date().toISOString().slice(0, 7);
    return {
      all: r.length,
      pool: r.filter(x => x.status === 'pool').length,
      placed: r.filter(x => x.status === 'placed').length,
      month: r.filter(x => (x.reg.submittedAt ?? '').slice(0, 7) === now).length,
    };
  });

  protected readonly months = computed(() =>
    [...new Set(this.rows().map(x => (x.reg.submittedAt ?? '').slice(0, 7)).filter(Boolean))].sort().reverse());

  protected readonly shown = computed(() => {
    const q = this.q().trim().toLowerCase(), digits = q.replace(/\D/g, '');
    const list = this.rows().filter(x => {
      if (this.status() !== 'all' && x.status !== this.status()) return false;
      if (this.cls() && (x.reg.preferredClass ?? '') !== this.cls() && x.placed?.category !== this.cls()) return false;
      if (this.month() && !(x.reg.submittedAt ?? '').startsWith(this.month())) return false;
      if (!q) return true;
      const g = x.reg;
      return g.childName.toLowerCase().includes(q) || (g.preferredName ?? '').toLowerCase().includes(q)
        || g.number.toLowerCase().includes(q) || g.parentName.toLowerCase().includes(q)
        || (digits.length >= 3 && (g.phone + ' ' + (g.whatsapp ?? '')).replace(/\D/g, '').includes(digits));
    });
    const s = this.sort();
    return [...list].sort((a, b) =>
      s === 'name' ? a.reg.childName.localeCompare(b.reg.childName)
        : s === 'age' ? (a.age ?? 99) - (b.age ?? 99)
          : s === 'old' ? (a.reg.submittedAt ?? '').localeCompare(b.reg.submittedAt ?? '')
            : (b.reg.submittedAt ?? '').localeCompare(a.reg.submittedAt ?? ''));
  });

  protected clearFilters() {
    this.q.set(''); this.status.set('all'); this.cls.set(''); this.month.set('');
  }

  /* ---------------- one registration ---------------- */
  protected readonly openId = signal<string | null>(null);
  protected readonly open = computed(() => this.rows().find(x => x.reg.id === this.openId()) ?? null);
  protected readonly editing = signal<RegInput | null>(null);
  protected readonly editError = signal('');
  protected readonly saving = signal(false);
  protected readonly placing = signal<RegRow | null>(null);

  protected view(r: RegRow) {
    this.editing.set(null);
    this.editError.set('');
    this.openId.set(r.reg.id);
  }

  protected close() {
    this.openId.set(null);
    this.editing.set(null);
  }

  protected edit(r: RegRow) {
    this.editError.set('');
    this.editing.set(toInput(r.reg));
  }

  protected toggleDay(m: RegInput, d: string) {
    const days = m.preferredDays ?? [];
    m.preferredDays = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
  }

  protected async save(r: RegRow) {
    const m = this.editing();
    if (!m) return;
    const problem = !m.childName.trim() ? "Enter the child's name." : !m.dateOfBirth ? 'Enter the date of birth.'
      : !m.parentName.trim() ? "Enter the parent's name." : phoneProblem(m.phone, true) || phoneProblem(m.whatsapp, false)
        || phoneProblem(m.emergencyPhone, false) || emailProblem(m.email);
    if (problem) { this.editError.set(problem); return; }
    this.saving.set(true);
    try {
      const out = await this.api.update(r.reg.id, m);
      this.rows.update(list => list.map(x => x.reg.id === out.reg.id ? out : x));
      this.editing.set(null);
      this.toast.show(`${out.reg.childName}'s registration saved.`);
    } catch (e) {
      this.editError.set(errorMessage(e, 'Could not save.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(r: RegRow) {
    const extra = r.status === 'placed'
      ? `\n\n${r.placed!.name} stays a student (${r.placed!.studentId}) — only the registration form is deleted.` : '';
    if (!confirm(`Delete the registration of ${r.reg.childName} (${r.reg.number})?\n\nThis cannot be undone.${extra}`)) return;
    try {
      await this.api.delete(r.reg.id);
      this.rows.update(list => list.filter(x => x.reg.id !== r.reg.id));
      this.close();
      this.toast.show(`Registration ${r.reg.number} deleted.`);
      this.refreshForm();
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not delete.'));
    }
  }

  protected place(r: RegRow) {
    this.placing.set(r);
  }

  protected onPlaced(out: RegRow) {
    this.rows.update(list => list.map(x => x.reg.id === out.reg.id ? out : x));
    this.selected.update(s => { const n = new Set(s); n.delete(out.reg.id); return n; });
    this.refreshForm();
  }

  protected goToClass(r: RegRow) {
    this.router.navigate(['/classes'], { queryParams: { find: r.placed?.name } });
  }

  /* ---------------- several at once ---------------- */
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly bulk = signal(false);
  protected readonly bulkSession = signal('');
  protected readonly bulkBusy = signal(false);

  protected isSelected(id: string) { return this.selected().has(id); }

  protected toggle(id: string, e?: Event) {
    e?.stopPropagation();
    this.selected.update(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  protected selectAllShown() {
    const pool = this.shown().filter(x => x.status === 'pool').map(x => x.reg.id);
    const all = pool.length > 0 && pool.every(id => this.selected().has(id));
    this.selected.set(all ? new Set() : new Set(pool));
  }

  protected clearSelection() { this.selected.set(new Set()); }

  protected readonly allShownSelected = computed(() => {
    const pool = this.shown().filter(x => x.status === 'pool');
    return pool.length > 0 && pool.every(x => this.selected().has(x.reg.id));
  });

  protected readonly selectedRows = computed(() => this.rows().filter(x => this.selected().has(x.reg.id) && x.status === 'pool'));

  protected readonly bulkOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const st of this.store.students()) if (st.active && st.session) counts.set(st.session, (counts.get(st.session) ?? 0) + 1);
    return this.store.sessions().map(s => ({ s, free: s.max == null ? null : s.max - (counts.get(s.name) ?? 0) }))
      .sort((a, b) => a.s.category.localeCompare(b.s.category) || a.s.name.localeCompare(b.s.name));
  });

  protected async placeSelected() {
    const s = this.store.sessions().find(x => x.name === this.bulkSession());
    const list = this.selectedRows();
    if (!s || !list.length) return;
    if (!confirm(`Place ${list.length} child${list.length === 1 ? '' : 'ren'} in ${s.name} (${s.category}, ${s.day} ${s.time})?\n\n`
      + list.map(x => '• ' + x.reg.childName).join('\n'))) return;
    this.bulkBusy.set(true);
    const failed: string[] = [];
    for (const r of list) {
      try {
        this.onPlaced(await this.api.place(r.reg.id, s.category, s.name));
      } catch (e) {
        failed.push(`${r.reg.childName}: ${errorMessage(e, 'failed')}`);
      }
    }
    await this.store.loadRoster(false);
    this.bulkBusy.set(false);
    this.bulk.set(false);
    const ok = list.length - failed.length;
    this.toast.show(`${ok} placed in ${s.name}.${failed.length ? ' Not placed — ' + failed.join('; ') : ''}`);
  }

  /* ---------------- the form ---------------- */
  protected readonly link = computed(() => this.formView() ? formLink(this.formView()!.form.token) : '');
  protected readonly local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);
  protected readonly texts = signal<{ title: string; intro: string; thanks: string; closedMessage: string } | null>(null);

  private async refreshForm() {
    try { this.formView.set(await this.api.form()); } catch { /* the counts can wait */ }
  }

  protected copyLink() {
    navigator.clipboard?.writeText(this.link()).then(() => this.toast.show('Registration link copied.'),
      () => this.toast.show('Could not copy — select the link and copy it.'));
  }

  protected shareText() {
    return `Hello! 🎵 Please register your child at ${this.store.settings().academyName} using this form. It takes about 3 minutes:\n${this.link()}`;
  }

  /** the link with a few friendly words, to paste into WhatsApp, Facebook or an email */
  protected copyInvite() {
    navigator.clipboard?.writeText(this.shareText()).then(() => this.toast.show('Invitation copied — paste it into WhatsApp.'),
      () => this.toast.show('Could not copy.'));
  }

  protected mailShare() {
    return `mailto:?subject=${encodeURIComponent('Student registration – ' + this.store.settings().academyName)}&body=${encodeURIComponent(this.shareText())}`;
  }

  protected async setOpen(open: boolean) {
    try {
      this.formView.set(await this.api.saveForm({ open }));
      this.toast.show(open ? 'Registrations are open. Parents can use the link.' : 'Registrations closed. The link now shows your closed message.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not change the form.'));
    }
  }

  protected editTexts() {
    const f = this.formView()!.form;
    this.texts.set({ title: f.title, intro: f.intro, thanks: f.thanks, closedMessage: f.closedMessage });
  }

  protected async saveTexts() {
    const t = this.texts();
    if (!t) return;
    try {
      this.formView.set(await this.api.saveForm(t));
      this.texts.set(null);
      this.toast.show('Form texts saved.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not save.'));
    }
  }

  protected async newLink() {
    if (!confirm('Make a new registration link?\n\nThe old link stops working straight away — parents who still have it will see "this link is not valid". Use this only if the link was shared somewhere it should not be.')) return;
    try {
      this.formView.set(await this.api.newLink());
      this.toast.show('New link made. Share the new one.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not make a new link.'));
    }
  }

  protected async download(kind: 'xlsx' | 'csv') {
    try {
      await (kind === 'xlsx' ? this.api.downloadExcel() : this.api.downloadCsv());
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not download.'));
    }
  }

  /* ---------------- display ---------------- */
  protected readonly days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  protected when(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', '
      + d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  protected ago(iso: string | null): string {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return mins <= 1 ? 'just now' : mins + ' min ago';
    const h = Math.round(mins / 60);
    if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : d < 31 ? d + ' days ago' : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  protected dob(iso: string): string {
    return iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }

  protected monthName(m: string): string {
    return new Date(m + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  protected initials(n: string): string {
    return n.split(/\s+/).filter(w => w.length > 1 && !w.includes('.')).slice(0, 2).map(w => w[0]).join('').toUpperCase() || n.slice(0, 1);
  }

  protected copyNumber(r: RegRow) {
    const n = r.reg.whatsapp || r.reg.phone;
    navigator.clipboard?.writeText(n).then(() => this.toast.show('' + n + ' copied.'), () => this.toast.show('Could not copy.'));
  }
}
