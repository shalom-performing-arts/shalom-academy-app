import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { MonthTotal, Receipt } from '../../core/models';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { money, names, prettyDate, prettyWa } from '../../receipt/format';
import { Dialog } from '../../core/dialog';

@Component({
  selector: 'app-history',
  template: `
    <section class="panel">
      <div class="card">
        <div class="card-head">
          <h2 data-ico="🧾" data-tone="amber">Saved receipts</h2>
          <div class="row-gap">
            <input type="search" class="search" placeholder="Search name, number, month…"
                   [value]="query()" (input)="query.set($any($event.target).value)">
            <button type="button" class="btn btn-sm" (click)="exportCsv()">Export CSV</button>
          </div>
        </div>
        @if (store.receipts().length) {
          <div class="table-scroll">
            <!-- "resp": on a phone each row becomes a card (mobile.css) -->
            <table class="list resp">
              <thead>
                <tr><th>Receipt no.</th><th>Date</th><th>Student</th><th>Class</th><th>For</th><th class="num">Total</th><th></th></tr>
              </thead>
              <tbody>
                @for (r of list(); track r.id) {
                  <tr>
                    <td class="r-num"><code>{{ r.number }}</code></td>
                    <td class="r-date">{{ prettyDate(r.date) }}</td>
                    <td class="r-name">{{ names(r) }}
                      @if (r.sentAt) { <span class="sent-chip" [title]="'Sent on WhatsApp to ' + prettyWa(r.sentTo || '') + ', ' + prettyDate(r.sentAt.slice(0, 10))">✓ Sent</span> }
                    </td>
                    <td class="r-class">{{ r.cls }}</td>
                    <td class="r-period">{{ r.period }}</td>
                    <td class="num">{{ money(r.total) }}</td>
                    <td class="actions">
                      <button class="btn-icon" title="Open in the form" (click)="open(r)">Open</button>
                      <button class="btn-icon wa-text" [title]="r.sentAt ? 'Send again on WhatsApp' : 'Send on WhatsApp'" (click)="send(r)">{{ r.sentAt ? 'Resend' : 'WhatsApp' }}</button>
                      <button class="btn-icon danger" title="Delete" (click)="remove(r)">Delete</button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">Nothing matches that search.</td></tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="empty">No receipts yet. Create one from the <b>New receipt</b> tab.</p>
        }
      </div>

      <div class="card">
        <div class="card-head"><h2 data-ico="📊" data-tone="teal">Monthly totals</h2></div>
        <div class="table-scroll">
          <table class="list">
            <thead><tr><th>Fee month</th><th class="num">Receipts</th><th class="num">Total</th></tr></thead>
            <tbody>
              @for (m of totals(); track m.period) {
                <tr><td>{{ m.period }}</td><td class="num">{{ m.receipts }}</td><td class="num">{{ money(m.total) }}</td></tr>
              } @empty {
                <tr><td colspan="3" class="empty">No data yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `,
})
export class History {
  protected store = inject(Store);
  private dialog = inject(Dialog);
  protected api = inject(Api);
  private toast = inject(Toast);
  private router = inject(Router);

  protected readonly query = signal('');
  protected readonly totals = signal<MonthTotal[]>([]);
  protected readonly money = money;
  protected readonly names = names;
  protected readonly prettyDate = prettyDate;
  protected readonly prettyWa = prettyWa;

  protected readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.store.receipts().filter(r => !q ||
      (r.number + ' ' + names(r) + ' ' + r.cls + ' ' + r.period + ' ' + (r.studentId || ''))
        .toLowerCase().includes(q));
  });

  constructor() {
    this.store.loadReceipts();
    // the totals come from the server, so refresh them whenever the list changes
    effect(() => {
      this.store.receipts();
      this.api.summary().then(t => this.totals.set(t)).catch(() => this.totals.set([]));
    });
  }

  protected async exportCsv() {
    if (!this.store.receipts().length) { this.toast.show('No receipts to export.'); return; }
    try {
      await this.api.downloadCsv();
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not export the CSV.'));
    }
  }

  protected open(r: Receipt) {
    this.router.navigate(['/'], { queryParams: { open: r.id } });
  }

  protected send(r: Receipt) {
    this.router.navigate(['/'], { queryParams: { open: r.id, send: 1 } });
  }

  protected async remove(r: Receipt) {
    if (!r.id || !await this.dialog.confirm('Delete this receipt from the list?\n\nThe PDF you already sent is not affected.')) return;
    // the receipt marked fees as paid; ask whether that still stands
    const unpaid = await this.dialog.confirm(`Was the money for this receipt received?\n\n` +
      `If it was not, ${names(r)} will be marked as not paid for ${r.period} on the Payments page. ` +
      `If you are only re-issuing the receipt, keep the payment.`,
      { ok: 'Not received — mark unpaid', cancel: 'Received — keep payment', danger: true });
    try {
      await this.store.deleteReceipt(r.id, unpaid);
      // a form still showing this receipt becomes an unsaved one again
      const draft = this.store.draft() as { id?: string | null } | null;
      if (draft?.id === r.id) this.store.draft.set({ ...draft, id: null });
      this.toast.show('Receipt deleted.');
    } catch (e) {
      this.toast.error(errorMessage(e, 'Could not delete the receipt.'));
    }
  }
}
