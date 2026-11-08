import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AppSettings, Category, CategoryInput, MonthTotal, MonthView, Payment, PaymentInput, Receipt, Roster, Session, Student,
  StudentInput,
} from './models';

/** Thin wrapper over the REST API. Every call returns a promise. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = '/api';

  settings() {
    return firstValueFrom(this.http.get<AppSettings>(`${this.base}/settings`));
  }

  saveSettings(s: AppSettings) {
    return firstValueFrom(this.http.put<AppSettings>(`${this.base}/settings`, s));
  }

  roster() {
    return firstValueFrom(this.http.get<Roster>(`${this.base}/roster`));
  }

  receipts() {
    return firstValueFrom(this.http.get<Receipt[]>(`${this.base}/receipts`));
  }

  saveReceipt(r: Receipt) {
    return firstValueFrom(r.id
      ? this.http.put<Receipt>(`${this.base}/receipts/${encodeURIComponent(r.id)}`, r)
      : this.http.post<Receipt>(`${this.base}/receipts`, r));
  }

  markSent(id: string, to: string) {
    return firstValueFrom(this.http.post<Receipt>(`${this.base}/receipts/${encodeURIComponent(id)}/sent`, { to }));
  }

  /** removePayments: also mark the fees it recorded as unpaid again */
  deleteReceipt(id: string, removePayments: boolean) {
    return firstValueFrom(this.http.delete<void>(`${this.base}/receipts/${encodeURIComponent(id)}`,
      { params: { removePayments } }));
  }

  /* ---------------- students ---------------- */

  createStudent(s: StudentInput) {
    return firstValueFrom(this.http.post<Student>(`${this.base}/students`, s));
  }

  updateStudent(id: string, s: StudentInput) {
    return firstValueFrom(this.http.put<Student>(`${this.base}/students/${encodeURIComponent(id)}`, s));
  }

  deleteStudent(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.base}/students/${encodeURIComponent(id)}`));
  }

  /** `rename` gives an existing session a new name, taking its students along */
  saveSession(s: Partial<Session> & { name: string; rename?: string }, create: boolean) {
    return firstValueFrom(create
      ? this.http.post<Session>(`${this.base}/sessions`, s)
      : this.http.put<Session>(`${this.base}/sessions/${encodeURIComponent(s.name)}`, s));
  }

  deleteSession(name: string) {
    return firstValueFrom(this.http.delete<void>(`${this.base}/sessions/${encodeURIComponent(name)}`));
  }

  /** every class, in order; one with `from` set is renamed from that name */
  saveCategories(c: CategoryInput[]) {
    return firstValueFrom(this.http.put<Category[]>(`${this.base}/categories`, c));
  }

  /* ---------------- months and payments ---------------- */

  month(month: string) {
    return firstValueFrom(this.http.get<MonthView>(`${this.base}/months/${month}`));
  }

  startMonth(month: string) {
    return firstValueFrom(this.http.post<MonthView>(`${this.base}/months/${month}`, {}));
  }

  /** this month's fee for one student (or reset to the usual fee), and/or their remark */
  updateDue(month: string, studentId: string, change: { fee?: number | null; reset?: boolean; remark?: string }) {
    return firstValueFrom(this.http.patch<MonthView>(
      `${this.base}/months/${month}/students/${encodeURIComponent(studentId)}`, change));
  }

  createPayment(p: PaymentInput) {
    return firstValueFrom(this.http.post<Payment>(`${this.base}/payments`, p));
  }

  updatePayment(id: string, p: PaymentInput) {
    return firstValueFrom(this.http.patch<Payment>(`${this.base}/payments/${encodeURIComponent(id)}`, p));
  }

  deletePayment(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.base}/payments/${encodeURIComponent(id)}`));
  }

  async downloadMonthCsv(month: string) {
    await this.download(`${this.base}/months/${month}/export.csv`, `shalom-payments-${month}.csv`);
  }

  deleteAllReceipts() {
    return firstValueFrom(this.http.delete<{ deleted: number }>(`${this.base}/receipts`));
  }

  summary() {
    return firstValueFrom(this.http.get<MonthTotal[]>(`${this.base}/receipts/summary`));
  }

  /** Fetched rather than linked, because a plain link cannot carry the sign-in token. */
  async downloadCsv() {
    await this.download(`${this.base}/receipts/export.csv`, 'shalom-receipts.csv');
  }

  async downloadBackup() {
    await this.download(`${this.base}/backup`, 'shalom-receipts-backup.json');
  }

  async download(url: string, fallbackName: string) {
    const res = await firstValueFrom(this.http.get(url, { responseType: 'blob', observe: 'response' }));
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
    const href = URL.createObjectURL(res.body!);
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  }

  restoreBackup(data: unknown) {
    return firstValueFrom(this.http.post<{ receipts: number }>(`${this.base}/backup/restore`, data));
  }
}

/** The server's own message when it sent one, otherwise something a person can act on. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Cannot reach the server. Is the backend running?';
    const m = e.error && typeof e.error === 'object' ? (e.error as { message?: string }).message : '';
    if (m) return m;
  }
  return fallback;
}
