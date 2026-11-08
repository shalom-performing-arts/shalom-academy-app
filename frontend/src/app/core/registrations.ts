import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';

/** One child registered through the online form. */
export interface Registration {
  id: string;
  /** given to the parent: REG-2026-0001 */
  number: string;
  submittedAt: string;
  childName: string;
  preferredName: string | null;
  /** yyyy-MM-dd */
  dateOfBirth: string;
  gender: string | null;
  school: string | null;
  grade: string | null;
  /** the course: Guitar and Vocal … */
  interest: string | null;
  /** the parent's wish (Kids, Junior …), not a placement */
  preferredClass: string | null;
  preferredDays: string[] | null;
  experience: string | null;
  parentName: string;
  relation: string | null;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  medical: string | null;
  howHeard: string | null;
  message: string | null;
  photoConsent: boolean | null;
  agreed: boolean | null;
  adminNote: string | null;
  /** set once placed in a class */
  studentId: string | null;
  placedAt: string | null;
  updatedAt: string | null;
}

export interface Placement {
  studentId: string; name: string; category: string; session: string; day: string; time: string; active: boolean;
}

/** a registration and where it stands */
export interface RegRow {
  reg: Registration;
  status: 'pool' | 'placed';
  placed: Placement | null;
  age: number | null;
  /** an existing student with the same name, who may be this child already */
  maybeStudent: string | null;
}

/** what the form sends, and what the office can change */
export type RegInput = Omit<Registration, 'id' | 'number' | 'submittedAt' | 'studentId' | 'placedAt' | 'updatedAt'> & {
  submissionKey?: string | null;
  /** left empty by people; bots fill it */
  website?: string;
};

export interface PublicForm {
  open: boolean; title: string; intro: string; closedMessage: string; academy: string; logo: string;
  phone: string; whatsapp: string; classes: string[]; courses: string[]; days: string[];
}

export interface Submitted { number: string; childName: string; parentName: string; thanks: string }

export interface RegForm { open: boolean; token: string; title: string; intro: string; closedMessage: string; thanks: string }

export interface RegFormView { form: RegForm; total: number; inPool: number; placed: number; lastAt: string | null }

export function emptyInput(): RegInput {
  return {
    childName: '', preferredName: '', dateOfBirth: '', gender: '', school: '', grade: '', interest: '',
    preferredClass: '', preferredDays: [], experience: '', parentName: '', relation: '', phone: '', whatsapp: '',
    email: '', address: '', emergencyName: '', emergencyPhone: '', medical: '', howHeard: '', message: '',
    photoConsent: false, agreed: false, adminNote: '',
  };
}

export function toInput(r: Registration): RegInput {
  const out = emptyInput();
  for (const k of Object.keys(out) as (keyof RegInput)[]) {
    const v = (r as unknown as Record<string, unknown>)[k];
    (out as unknown as Record<string, unknown>)[k] = v ?? (Array.isArray(out[k]) ? [] : typeof out[k] === 'boolean' ? false : '');
  }
  return out;
}

/** The public link parents open. */
export function formLink(token: string): string {
  return `${location.origin}/register/${token}`;
}

/* ---- the same checks the server makes, so parents see them before submitting ---- */

export function phoneProblem(v: string | null | undefined, required: boolean): string {
  const t = (v ?? '').trim();
  if (!t) return required ? 'Please enter a phone number.' : '';
  if (!/^\+?[0-9 ()-]{7,24}$/.test(t)) return 'Use numbers only, e.g. 071 040 7740.';
  const d = t.replace(/\D/g, '');
  if (!t.startsWith('+') && d.startsWith('0') && d.length !== 10) return 'A Sri Lankan number has 10 digits, e.g. 071 040 7740.';
  if (d.length < 9 || d.length > 15) return 'This number looks too short or too long.';
  return '';
}

export function emailProblem(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  return t && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? 'Please check the email address, e.g. name@gmail.com.' : '';
}

/** The parents' side: no sign-in. */
@Injectable({ providedIn: 'root' })
export class PublicRegistrationApi {
  private http = inject(HttpClient);

  form(token: string) {
    return firstValueFrom(this.http.get<PublicForm>(`/api/public/register/${encodeURIComponent(token)}`));
  }

  submit(token: string, input: RegInput) {
    return firstValueFrom(this.http.post<Submitted>(`/api/public/register/${encodeURIComponent(token)}`, input));
  }
}

/** The office's side: the registration pool and the form. */
@Injectable({ providedIn: 'root' })
export class RegistrationApi {
  private http = inject(HttpClient);
  private api = inject(Api);

  list() {
    return firstValueFrom(this.http.get<RegRow[]>('/api/registrations'));
  }

  update(id: string, input: RegInput) {
    return firstValueFrom(this.http.put<RegRow>(`/api/registrations/${encodeURIComponent(id)}`, input));
  }

  delete(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/registrations/${encodeURIComponent(id)}`));
  }

  /** places the child in a class: creates the student, as the Students page would */
  place(id: string, category: string, session: string, name?: string) {
    return firstValueFrom(this.http.post<RegRow>(`/api/registrations/${encodeURIComponent(id)}/place`,
      { category, session, name: name || null }));
  }

  form() {
    return firstValueFrom(this.http.get<RegFormView>('/api/registration-form'));
  }

  saveForm(f: Partial<RegForm>) {
    return firstValueFrom(this.http.put<RegFormView>('/api/registration-form', f));
  }

  newLink() {
    return firstValueFrom(this.http.post<RegFormView>('/api/registration-form/new-link', {}));
  }

  downloadCsv() {
    return this.api.download('/api/registration-form/export.csv', 'shalom-registrations.csv');
  }

  downloadExcel() {
    return this.api.download('/api/registration-form/export.xlsx', 'shalom-registrations.xlsx');
  }
}
