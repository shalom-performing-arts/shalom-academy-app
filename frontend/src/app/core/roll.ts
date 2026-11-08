import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Auth } from './auth';
import { Session } from './models';
import { Holiday } from './teachers';

/** Shapes shared with lk.shalom.receipts.service.RollService. */

/** P = present, L = late, A = absent, M = made up in a cover-up class; null = not marked yet */
export type Mark = 'P' | 'L' | 'A' | 'M';

export interface RollStudent {
  id: string;
  name: string;
  status: Mark | null;
  note: string | null;
  byName: string | null;
  at: string | null;
  /** marked on the day, but no longer in this session */
  left: boolean;
  /** here for a cover-up: the class they missed, "Forte · Wed 4 Nov" */
  coverFor: string | null;
  /** the cover-up this line belongs to (attending one here, or one booked for this missed class) */
  makeupId: string | null;
  makeupStatus: 'booked' | 'attended' | 'missed' | null;
  /** on the missed class: "Cover-up booked: Fortissimo · Sat 7 Nov" */
  makeupNote: string | null;
  /** for a cover-up student: where they come from */
  cover: CoverInfo | null;
}

/** a cover-up student's own class, the class they missed, why, and who booked it */
export interface CoverInfo {
  category: string; session: string; symbol: string; symbolStyle: string; day: string; time: string;
  missedDate: string; missedLabel: string; reason: string | null; bookedBy: string; bookedAt: string;
  studentNumber: string; parent: string; phone: string;
}

export interface RollClass {
  session: Session;
  time: string;
  /** "15:30" */
  start: string;
  end: string;
  /** now = on (or starting within 15 minutes); next; later; done = over */
  state: 'now' | 'next' | 'later' | 'done';
  students: RollStudent[];
  present: number;
  late: number;
  absent: number;
  unmarked: number;
  madeUp: number;
  /** students here for a cover-up */
  covers: number;
  markedBy: string | null;
  markedAt: string | null;
}

export interface RollDay {
  date: string;
  label: string;
  today: boolean;
  holiday: Holiday | null;
  classes: RollClass[];
  /** the class to open on */
  focus: string;
}

export interface MonthDate { date: string; label: string; future: boolean; holiday: boolean; markedBy: string | null }
export interface MonthCell { date: string; status: Mark | null; note: string | null }
export interface MonthRow { id: string; name: string; cells: MonthCell[]; present: number; late: number; absent: number; madeUp: number; rate: number | null; left: boolean }

/** a cover-up class booked for a student who missed one */
export interface Makeup {
  id: string; studentId: string; studentName: string; category: string;
  fromSession: string; fromDate: string; fromLabel: string;
  toSession: string; toDate: string; toLabel: string;
  status: 'booked' | 'attended' | 'missed'; note: string | null; byName: string; at: string;
}
export interface RollMonth { session: Session; month: string; label: string; dates: MonthDate[]; rows: MonthRow[]; sessions: Session[] }

/**
 * Student attendance. The office can open any day; a teacher's sign-in reaches only today's
 * classes, through /api/me/roll.
 */
@Injectable({ providedIn: 'root' })
export class RollApi {
  private http = inject(HttpClient);
  private auth = inject(Auth);

  private get base() {
    return this.auth.isTeacher() ? '/api/me/roll' : '/api/roll';
  }

  day(date?: string) {
    return firstValueFrom(this.auth.isTeacher()
      ? this.http.get<RollDay>('/api/me/roll')
      : this.http.get<RollDay>('/api/roll/day', { params: date ? { date } : {} }));
  }

  mark(date: string, session: string, studentId: string, status: Mark | null, note: string | null) {
    return firstValueFrom(this.http.put<RollClass>(`${this.base}/mark`, { date, session, studentId, status, note }));
  }

  allPresent(date: string, session: string) {
    return firstValueFrom(this.http.post<RollClass>(`${this.base}/all-present`, { date, session }));
  }

  makeups(month: string) {
    return firstValueFrom(this.http.get<Makeup[]>('/api/roll/makeups', { params: { month } }));
  }

  book(studentId: string, fromSession: string, fromDate: string, toSession: string, toDate: string, note: string) {
    return firstValueFrom(this.http.post<Makeup>('/api/roll/makeups', { studentId, fromSession, fromDate, toSession, toDate, note }));
  }

  cancelMakeup(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/roll/makeups/${encodeURIComponent(id)}`));
  }

  month(session: string, month: string) {
    return firstValueFrom(this.http.get<RollMonth>('/api/roll/month', { params: { session, month } }));
  }
}

/** The message to the parent once a cover-up class is booked. */
export function coverMessage(o: {
  parent: string; student: string; academy: string;
  fromSession: string; fromCategory: string; fromDate: string;
  toSession: string; toDate: string; toTime: string; reason?: string | null;
}): string {
  const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const first = o.student.split(' ')[0];
  return [
    `Dear ${o.parent || 'Parent'},`,
    '',
    `${first}'s cover-up class is confirmed 🎵`,
    '',
    `❌ Missing: ${o.fromSession}${o.fromCategory ? ' (' + o.fromCategory + ')' : ''} — ${day(o.fromDate)}`,
    `✅ Cover-up: ${o.toSession} — ${day(o.toDate)}${o.toTime ? ', ' + o.toTime : ''}`,
    ...(o.reason ? [`📝 Reason: ${o.reason}`] : []),
    '',
    `Please bring ${first} 10 minutes early. Thank you!`,
    '',
    o.academy,
  ].join('\n');
}
