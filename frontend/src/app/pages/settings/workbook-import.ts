import { Component, computed, inject, signal } from '@angular/core';
import { Api, WorkbookPreview, errorMessage } from '../../core/api';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { money } from '../../receipt/format';

/**
 * Settings → bring in the office's monthly fee workbook. Three steps, nothing saved until the
 * last: pick the file and read the preview, download a backup, then import.
 */
@Component({
  selector: 'app-workbook-import',
  template: `
    <div class="card wi">
      <div class="card-head"><h2 data-ico="📗" data-tone="green">Import the fee workbook</h2></div>
      <p class="hint">Makes the app match the monthly fee workbook (Excel): its <b>students</b>, <b>sessions</b>,
        <b>class fees</b> and that month's <b>payments</b>. Children not in the workbook are switched off (kept, not deleted);
        that month's payments and receipts are replaced. Nothing changes until you press <b>Import</b>.</p>

      <!-- 1. the file -->
      <div class="wi-step" [class.done]="!!preview()">
        <span class="wi-n">1</span>
        <div class="wi-body">
          <b>Choose the workbook</b>
          <label class="btn btn-sm wi-pick">{{ file() ? '📄 ' + file()!.name : 'Choose .xlsx file' }}
            <input #wb type="file" accept=".xlsx" hidden (change)="pick(wb)"></label>
          @if (busy() === 'reading') { <small>Reading the workbook…</small> }
        </div>
      </div>

      @if (preview(); as p) {
        <!-- what will change -->
        <div class="wi-preview" [class.applied]="p.applied">
          <h3>{{ p.applied ? '✅ Imported: ' : 'The ' }}{{ p.monthLabel }} workbook{{ p.applied ? '' : ' will make these changes' }}</h3>

          <div class="wi-checks">
            @for (c of p.checks; track c.what) {
              <div class="wi-check" [class.bad]="!c.ok">
                <span class="wi-tick">{{ c.ok ? '✓' : '✗' }}</span>
                <div><b>{{ c.what }}</b><small>Workbook {{ c.workbook }} · App {{ c.app }}</small></div>
              </div>
            }
          </div>

          <div class="wi-chips">
            <span class="wi-chip"><b>{{ p.active }}</b> active students</span>
            <span class="wi-chip green"><b>{{ p.added.length }}</b> added</span>
            <span class="wi-chip blue"><b>{{ p.moved.length }}</b> moved session</span>
            <span class="wi-chip amber"><b>{{ p.renamed.length }}</b> renamed</span>
            <span class="wi-chip grey"><b>{{ p.inactivated.length }}</b> switched off</span>
            <span class="wi-chip"><b>{{ p.paymentsAdded.count }}</b> payments · Rs. {{ money(p.paymentsAdded.amount) }}</span>
          </div>

          <details class="wi-more" open>
            <summary>Payments for {{ p.monthLabel }}</summary>
            <p>Removed: <b>{{ p.paymentsRemoved.count }}</b> payments (Rs. {{ money(p.paymentsRemoved.amount) }}) now in the app.
               Added: <b>{{ p.paymentsAdded.count }}</b> from the workbook (Rs. {{ money(p.paymentsAdded.amount) }}).</p>
            <ul class="wi-list">
              @for (t of p.byPaidTo; track t.name) { <li><b>{{ t.name }}</b> · {{ t.count }} payments · Rs. {{ money(t.amount) }}</li> }
            </ul>
            @if (p.receiptsRemoved.length) {
              <p><b>{{ p.receiptsRemoved.length }}</b> {{ p.monthLabel }} receipts will be removed:</p>
              <ul class="wi-list small">@for (r of p.receiptsRemoved; track r) { <li>{{ r }}</li> }</ul>
            }
          </details>
          @if (p.added.length) {
            <details class="wi-more"><summary>Added ({{ p.added.length }})</summary>
              <ul class="wi-list">@for (x of p.added; track x) { <li>{{ x }}</li> }</ul></details>
          }
          @if (p.renamed.length) {
            <details class="wi-more" open><summary>Renamed — please check these are the same child ({{ p.renamed.length }})</summary>
              <ul class="wi-list">@for (x of p.renamed; track x.from) { <li>{{ x.from }} → <b>{{ x.to }}</b> <small>{{ x.where }}</small></li> }</ul></details>
          }
          @if (p.moved.length) {
            <details class="wi-more"><summary>Moved to another session ({{ p.moved.length }})</summary>
              <ul class="wi-list">@for (x of p.moved; track x.name) { <li><b>{{ x.name }}</b>: {{ x.from }} → {{ x.to }}</li> }</ul></details>
          }
          @if (p.inactivated.length) {
            <details class="wi-more"><summary>Switched off — not in the workbook ({{ p.inactivated.length }})</summary>
              <ul class="wi-list">@for (x of p.inactivated; track x) { <li>{{ x }}</li> }</ul></details>
          }
          @if (p.reactivated.length) {
            <details class="wi-more"><summary>Switched back on ({{ p.reactivated.length }})</summary>
              <ul class="wi-list">@for (x of p.reactivated; track x) { <li>{{ x }}</li> }</ul></details>
          }
          @if (p.fees.length) {
            <details class="wi-more"><summary>Fee changes ({{ p.fees.length }})</summary>
              <ul class="wi-list">@for (x of p.fees; track x.name) { <li><b>{{ x.name }}</b>: {{ x.from }} → {{ x.to }}</li> }</ul></details>
          }
          @if (p.sessionsAdded.length || p.sessionsChanged.length || p.sessionsRemoved.length || p.classFees.length) {
            <details class="wi-more"><summary>Sessions and class fees</summary>
              <ul class="wi-list">
                @for (x of p.sessionsAdded; track x) { <li>➕ {{ x }}</li> }
                @for (x of p.sessionsChanged; track x) { <li>✎ {{ x }}</li> }
                @for (x of p.sessionsRemoved; track x) { <li>➖ {{ x }}</li> }
                @for (x of p.classFees; track x) { <li>Rs. {{ x }}</li> }
              </ul></details>
          }
          @if (p.warnings.length) {
            <div class="wi-warn">@for (w of p.warnings; track w) { <p>ℹ️ {{ w }}</p> }</div>
          }
        </div>

        @if (!p.applied) {
          <!-- 2. a backup first -->
          <div class="wi-step" [class.done]="backedUp()">
            <span class="wi-n">2</span>
            <div class="wi-body">
              <b>Download a backup</b>
              <small>Everything as it is now, so it can be put back with <i>Restore backup</i> if needed.</small>
              <button type="button" class="btn btn-sm" [disabled]="!!busy()" (click)="backup()">
                {{ busy() === 'backup' ? 'Downloading…' : backedUp() ? '✓ Backup downloaded' : '💾 Download backup' }}</button>
            </div>
          </div>

          <!-- 3. import -->
          <div class="wi-step">
            <span class="wi-n">3</span>
            <div class="wi-body">
              <b>Import</b>
              @if (!allOk()) { <small class="wi-bad">Some totals do not match the workbook's Dashboard — check them above before importing.</small> }
              <button type="button" class="btn wi-go" [disabled]="!backedUp() || !!busy()" (click)="apply()">
                {{ busy() === 'apply' ? 'Importing…' : 'Import ' + p.monthLabel + ' workbook' }}</button>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .wi-step{display:flex; gap:12px; align-items:flex-start; padding:12px 0; border-top:1px solid #f0e8f3}
    .wi-n{flex:none; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; font-weight:800;
      background:#efe6f4; color:#5b21b6}
    .wi-step.done .wi-n{background:#12b76a; color:#fff}
    .wi-body{flex:1; min-width:0; display:flex; flex-direction:column; align-items:flex-start; gap:6px}
    .wi-body small{color:var(--muted); font-size:12.5px}
    .wi-pick{max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
    .wi-bad{color:#b3261e !important; font-weight:700}
    .wi-go{background:linear-gradient(135deg, #12b76a, #0b8a4f); color:#fff; border:0; min-height:44px; padding:0 18px; font-weight:800}
    .wi-preview{margin:6px 0 4px; padding:14px; border-radius:16px; background:#faf7fd; border:1px solid #ece2f2}
    .wi-preview.applied{background:#effaf4; border-color:#c6e9d4}
    .wi-preview h3{margin:0 0 10px; font-size:16px; color:#3a1238}
    .wi-checks{display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:8px; margin-bottom:10px}
    .wi-check{display:flex; gap:10px; align-items:center; padding:8px 10px; border-radius:12px; background:#fff; border:1px solid #d7f0e2}
    .wi-check b{display:block; font-size:13px}
    .wi-check small{font-size:12px; color:var(--muted)}
    .wi-tick{flex:none; width:24px; height:24px; border-radius:50%; display:grid; place-items:center; background:#12b76a; color:#fff; font-weight:900; font-size:13px}
    .wi-check.bad{border-color:#f3c0c0; background:#fff6f6}
    .wi-check.bad .wi-tick{background:#e5484d}
    .wi-chips{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px}
    .wi-chip{padding:5px 10px; border-radius:999px; background:#fff; border:1px solid #e6dcea; font-size:12.5px; color:#5b4660}
    .wi-chip b{color:#2b1030}
    .wi-chip.green{background:#e9f8ef; border-color:#c6e9d4} .wi-chip.blue{background:#eef3ff; border-color:#c9d8fb}
    .wi-chip.amber{background:#fff6e5; border-color:#f3dca0} .wi-chip.grey{background:#f3f0f5}
    .wi-more{margin-top:6px; padding:8px 12px; border-radius:12px; background:#fff; border:1px solid #efe6f3}
    .wi-more summary{cursor:pointer; font-weight:800; font-size:13.5px; color:#3a1238}
    .wi-more p{margin:8px 0 4px; font-size:13.5px}
    .wi-list{margin:6px 0 2px; padding-left:18px; font-size:13.5px; line-height:1.6; max-height:240px; overflow:auto}
    .wi-list.small{font-size:12.5px}
    .wi-list small{color:var(--muted)}
    .wi-warn{margin-top:8px; padding:8px 12px; border-radius:12px; background:#eef3ff; border:1px solid #c9d8fb; font-size:13px; color:#22479c}
    .wi-warn p{margin:3px 0}
  `,
})
export class WorkbookImport {
  private api = inject(Api);
  private store = inject(Store);
  private toast = inject(Toast);
  protected readonly money = money;

  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<WorkbookPreview | null>(null);
  protected readonly backedUp = signal(false);
  protected readonly busy = signal<'' | 'reading' | 'backup' | 'apply'>('');
  protected readonly allOk = computed(() => (this.preview()?.checks ?? []).every(c => c.ok));

  protected async pick(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    this.file.set(f);
    this.preview.set(null);
    this.backedUp.set(false);
    this.busy.set('reading');
    try {
      this.preview.set(await this.api.importWorkbook(f, false));
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not read that workbook.'));
    } finally {
      this.busy.set('');
    }
  }

  protected async backup() {
    this.busy.set('backup');
    try {
      await this.api.downloadBackup();
      this.backedUp.set(true);
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not download the backup.'));
    } finally {
      this.busy.set('');
    }
  }

  protected async apply() {
    const f = this.file(), p = this.preview();
    if (!f || !p || !this.backedUp()) return;
    const sure = confirm(`Import the ${p.monthLabel} workbook?\n\n` +
      `• ${p.active} active students (${p.added.length} added, ${p.inactivated.length} switched off)\n` +
      `• ${p.monthLabel} payments replaced: ${p.paymentsAdded.count} payments, Rs. ${money(p.paymentsAdded.amount)}\n` +
      `• ${p.receiptsRemoved.length} ${p.monthLabel} receipts removed\n\n` +
      (this.allOk() ? '' : '⚠️ Some totals do not match the workbook.\n\n') + 'This cannot be undone except by restoring the backup.');
    if (!sure) return;
    this.busy.set('apply');
    try {
      this.preview.set(await this.api.importWorkbook(f, true));
      await this.store.load();
      this.toast.show(`${p.monthLabel} workbook imported.`);
    } catch (e) {
      this.toast.show(errorMessage(e, 'The import did not finish. Restore the backup if anything looks wrong.'));
    } finally {
      this.busy.set('');
    }
  }
}
