import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';

/** Shapes shared with lk.shalom.receipts.service.TeacherService. */

export interface Teacher {
  id: string;
  name: string;
  phone: string;
  colour: string;
  active: boolean;
  hasPin: boolean;
}

export interface Rates {
  weekday: number;
  weekend: number;
  transport: number;
  transportMinClasses: number;
}

export interface Slot {
  id: string;
  day: string;
  /** "15:30" */
  start: string;
  minutes: number;
  category: string;
  label: string;
}

export interface Holiday {
  date: string;
  name: string;
  classOff: boolean;
}

export interface Site {
  lat: number | null;
  lng: number | null;
  radius: number;
  earlyMinutes: number;
  lateMinutes: number;
  /** how long after a class ends it can still be marked done */
  doneMinutes: number;
}

export interface Who {
  teacherId: string;
  /** "self" = checked in at the academy from their phone; "office" = ticked by the office */
  method: 'self' | 'office';
  at: string;
  distance: number | null;
  /** when the teacher marked the class done after it ended; null = not yet */
  doneAt: string | null;
  /** what they covered, written when marking it done */
  note: string | null;
  /** marked done, or ticked by the office */
  finished: boolean;
}

export interface ClassOut {
  slot: Slot;
  time: string;
  teachers: Who[];
  removed: boolean;
}

export interface DayOut {
  date: string;
  dayName: string;
  label: string;
  weekend: boolean;
  today: boolean;
  future: boolean;
  holiday: Holiday | null;
  classes: ClassOut[];
}

export interface PayLine {
  teacherId: string;
  name: string;
  colour: string;
  weekday: number;
  weekend: number;
  weekdayPay: number;
  weekendPay: number;
  classPay: number;
  transport: number;
  adjustment: number;
  adjustmentNote: string;
  total: number;
  paidAt: string | null;
}

export interface SalaryOut {
  period: string;
  payDate: string;
  rates: Rates;
  lines: PayLine[];
  weekday: number;
  weekend: number;
  classPay: number;
  transport: number;
  adjustment: number;
  total: number;
}

export interface SheetOut {
  period: string;
  label: string;
  from: string;
  to: string;
  payDate: string;
  teachers: Teacher[];
  days: DayOut[];
  salary: SalaryOut;
}

export interface SetupOut {
  teachers: Teacher[];
  rates: Rates;
  schedule: Slot[];
  holidays: Holiday[];
  site: Site;
}

/**
 * LATER (check-in not open yet) → OPEN (check in now) → IN_CLASS → FINISH (mark it done now) → COMPLETE.
 * MISSED = never checked in; UNFINISHED = checked in but not marked done in time.
 */
export type SlotState = 'LATER' | 'OPEN' | 'IN_CLASS' | 'FINISH' | 'COMPLETE' | 'UNFINISHED' | 'MISSED' | 'HOLIDAY';

export interface TodayClass {
  slot: Slot;
  time: string;
  state: SlotState;
  opensAt: string;
  closesAt: string;
  checkedAt: string | null;
  method: string | null;
  others: string[];
  doneOpensAt: string;
  doneClosesAt: string;
  doneAt: string | null;
  note: string | null;
}

export interface MeOut {
  teacher: Teacher;
  date: string;
  dateLabel: string;
  holiday: Holiday | null;
  siteSet: boolean;
  radius: number;
  siteLat: number | null;
  siteLng: number | null;
  today: TodayClass[];
  pay: PayLine | null;
  period: string;
  periodLabel: string;
  next: { date: string; label: string; classes: string[] }[];
}

/** The teacher endpoints: the office's under /api/teachers, a teacher's own under /api/me. */
@Injectable({ providedIn: 'root' })
export class TeacherApi {
  private http = inject(HttpClient);
  private api = inject(Api);

  sheet(period?: string) {
    return firstValueFrom(this.http.get<SheetOut>('/api/teachers/sheet', { params: period ? { period } : {} }));
  }

  mark(date: string, slotId: string, teacherId: string, on: boolean) {
    return firstValueFrom(this.http.put<SheetOut>('/api/teachers/mark', { date, slotId, teacherId, on }));
  }

  adjust(period: string, teacherId: string, amount: number | null, note: string) {
    return firstValueFrom(this.http.put<SalaryOut>('/api/teachers/adjustment', { period, teacherId, amount, note }));
  }

  paid(period: string, teacherId: string, paid: boolean) {
    return firstValueFrom(this.http.put<SalaryOut>('/api/teachers/paid', { period, teacherId, paid }));
  }

  downloadSalary(period: string) {
    return this.api.download(`/api/teachers/salary.csv?period=${period}`, `teacher-salary-${period}.csv`);
  }

  setup() {
    return firstValueFrom(this.http.get<SetupOut>('/api/teachers/setup'));
  }

  saveSetup(s: Partial<Pick<SetupOut, 'rates' | 'schedule' | 'holidays' | 'site'>>) {
    return firstValueFrom(this.http.put<SetupOut>('/api/teachers/setup', s));
  }

  saveTeacher(id: string | null, t: { name: string; phone: string; colour: string; active: boolean }) {
    return firstValueFrom(id
      ? this.http.put<Teacher>(`/api/teachers/${encodeURIComponent(id)}`, t)
      : this.http.post<Teacher>('/api/teachers', t));
  }

  deleteTeacher(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/teachers/${encodeURIComponent(id)}`));
  }

  setPin(id: string, pin: string) {
    return firstValueFrom(this.http.post<{ pin: string }>(`/api/teachers/${encodeURIComponent(id)}/pin`, { pin }));
  }

  me() {
    return firstValueFrom(this.http.get<MeOut>('/api/me'));
  }

  /** after the class: confirm it was taught, with an optional note on what was covered */
  finish(slotId: string, lat: number, lng: number, accuracy: number, note: string) {
    return firstValueFrom(this.http.post<MeOut>('/api/me/done', { slotId, lat, lng, accuracy, note }));
  }

  checkIn(slotId: string, lat: number, lng: number, accuracy: number) {
    return firstValueFrom(this.http.post<MeOut>('/api/me/checkin', { slotId, lat, lng, accuracy }));
  }
}

/** "2026-11" → "2026-12" */
export function shiftPeriod(p: string, by: number): string {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "15:30" → "3:30 PM" */
export function clock12(hhmm: string): string {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
