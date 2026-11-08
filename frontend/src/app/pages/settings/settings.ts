import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AppSettings, ClassFee, FeeType, SiblingDiscount, StudentField } from '../../core/models';
import { ListEditor } from '../../shared/list-editor';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { num } from '../../receipt/format';
import { SITE_LOGO, SITE_SIGNATURE } from '../../receipt/receipt-sheet';
import { readImageFile } from '../../receipt/signature';

const classesToText = (list: ClassFee[]) =>
  list.map(c => (c.fee ? c.name + ' | ' + c.fee : c.name)).join('\n');

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink, ListEditor],
  templateUrl: './settings.html',
})
export class Settings {
  protected store = inject(Store);
  protected api = inject(Api);
  private toast = inject(Toast);

  protected readonly s = this.store.settings;
  protected readonly SITE_LOGO = SITE_LOGO;
  protected readonly SITE_SIGNATURE = SITE_SIGNATURE;

  /** edited as text, "Class name | default fee" per line; kept apart so typing is not reflowed */
  protected readonly classesText = signal(classesToText(this.s().classes));

  protected readonly rosterQuery = signal('');
  protected readonly roster = computed(() => {
    const q = this.rosterQuery().trim().toLowerCase();
    return this.store.students()
      .filter(st => !q || (st.name + ' ' + st.id + ' ' + st.category).toLowerCase().includes(q))
      .slice(0, 400);
  });

  constructor() {
    // opened straight onto /settings: fill the class list once the server's settings arrive
    effect(() => {
      if (this.store.loaded()) untracked(() => this.classesText.set(classesToText(this.s().classes)));
    });
  }

  protected set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    this.store.updateSettings({ ...this.s(), [key]: value });
  }

  protected setText(key: keyof AppSettings, value: string) {
    this.set(key, value as never);
  }

  protected setClasses(text: string) {
    this.classesText.set(text);
    const classes = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [name, fee] = l.split('|');
      return { name: name.trim(), fee: num(fee) };
    }).filter(c => c.name);
    if (classes.length) this.set('classes', classes);
  }

  /** a typed amount, or null when the box is empty */
  protected amount(v: unknown): number | null {
    const n = num(v);
    return n > 0 ? n : null;
  }

  protected splitList(v: string): string[] {
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }

  /* ---------------- fee types ---------------- */

  protected patchFeeType(i: number, p: Partial<FeeType>) {
    const list = this.s().feeTypes.map((t, j) => j === i ? { ...t, ...p } : t);
    if (list[i].name.trim()) this.set('feeTypes', list);
  }

  protected addFeeType(box: HTMLInputElement) {
    const name = box.value.trim();
    if (!name) return;
    if (this.s().feeTypes.some(t => t.name.toLowerCase() === name.toLowerCase())) { box.select(); return; }
    this.set('feeTypes', [...this.s().feeTypes, { id: '', name, defaultAmount: null }]);
    box.value = '';
  }

  protected removeFeeType(i: number) {
    const t = this.s().feeTypes[i];
    if (!confirm(`Remove “${t.name}”?\n\nPayments already recorded as ${t.name} keep it.`)) return;
    this.set('feeTypes', this.s().feeTypes.filter((_, j) => j !== i));
  }

  /* ---------------- sibling discount ---------------- */

  protected patchDiscount(p: Partial<SiblingDiscount>) {
    this.set('siblingDiscount', { ...this.s().siblingDiscount, ...p });
  }

  /* ---------------- student fields ---------------- */

  protected patchField(i: number, p: Partial<StudentField>) {
    const list = this.s().studentFields.map((f, j) => j === i ? { ...f, ...p } : f);
    if (list[i].label.trim()) this.set('studentFields', list);
  }

  protected addField(box: HTMLInputElement) {
    const label = box.value.trim();
    if (!label) return;
    if (this.s().studentFields.some(f => f.label.toLowerCase() === label.toLowerCase())) { box.select(); return; }
    this.set('studentFields', [...this.s().studentFields,
      { key: '', label, type: 'text', options: [], inList: false }]);
    box.value = '';
  }

  protected removeField(i: number) {
    const f = this.s().studentFields[i];
    if (!confirm(`Remove the field “${f.label}”?\n\nWhat was entered stays in the student file, but is no longer shown.`)) return;
    this.set('studentFields', this.s().studentFields.filter((_, j) => j !== i));
  }

  protected async upload(which: 'logo' | 'signature', input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.set(which, await readImageFile(file));
    } catch {
      this.toast.show('That file could not be read as an image.');
    }
  }

  protected async reloadRoster() {
    await this.store.loadRoster(true);
  }

  protected async exportBackup() {
    try {
      await this.api.downloadBackup();
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not export the backup.'));
    }
  }

  protected async restore(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let data: { app?: string };
    try {
      data = JSON.parse(await file.text());
    } catch {
      this.toast.show('That file is not a valid backup.');
      return;
    }
    if (data?.app !== 'shalom-fee-receipts') {
      this.toast.show('That file is not a valid backup.');
      return;
    }
    if (!confirm('Restore this backup? The settings and all receipts on the server will be replaced.')) return;
    try {
      const res = await this.api.restoreBackup(data);
      await Promise.all([this.store.loadSettings(), this.store.loadReceipts()]);
      this.classesText.set(classesToText(this.s().classes));
      this.toast.show('Backup restored — ' + res.receipts + ' receipts.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not restore the backup.'));
    }
  }

  protected async wipe() {
    const n = this.store.receipts().length;
    if (!n) { this.toast.show('Nothing to delete.'); return; }
    if (!confirm('Delete all ' + n + ' saved receipts on the server? Every device will lose them.')) return;
    try {
      await this.api.deleteAllReceipts();
      this.store.receipts.set([]);
      this.toast.show('All receipts deleted.');
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not delete the receipts.'));
    }
  }
}
