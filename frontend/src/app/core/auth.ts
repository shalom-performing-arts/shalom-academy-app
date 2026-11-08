import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';

const KEY = 'sapa.token';
const NAME_KEY = 'sapa.teacher';

const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, t: string) => {
  try { if (t) localStorage.setItem(k, t); else localStorage.removeItem(k); } catch { /* private mode */ }
};

/**
 * The sign-in. The office signs in with the shared password; a teacher signs in with their
 * name and PIN and can then only check in. Either way the token lasts 30 days and is kept in
 * this browser, so the person stays signed in.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly token = signal(read(KEY));
  readonly signedIn = computed(() => !!this.token());
  /** a teacher's token reads "t~<id>~…"; anything else is the office */
  readonly isTeacher = computed(() => this.token().startsWith('t~'));
  readonly isOffice = computed(() => this.signedIn() && !this.isTeacher());
  readonly teacherId = computed(() => this.isTeacher() ? this.token().split('~')[1] : '');
  readonly teacherName = signal(read(NAME_KEY));

  async login(password: string) {
    const res = await firstValueFrom(this.http.post<{ token: string }>('/api/auth/login', { password }));
    this.keep(res.token, '');
  }

  async loginTeacher(teacherId: string, pin: string) {
    const res = await firstValueFrom(this.http.post<{ token: string; name: string }>('/api/auth/teacher', { teacherId, pin }));
    this.keep(res.token, res.name);
  }

  /** the teachers who can sign in, for the list on the sign-in screen */
  teachers() {
    return firstValueFrom(this.http.get<{ id: string; name: string }[]>('/api/auth/teachers'));
  }

  /** where a person lands after signing in */
  home(): string {
    return this.isTeacher() ? '/checkin' : '/';
  }

  logout() {
    const teacher = this.isTeacher();
    this.keep('', '');
    this.router.navigate(['/login'], teacher ? { queryParams: { as: 'teacher' } } : {});
  }

  /** The server turned the token down (expired, password or PIN changed). */
  expired() {
    if (!this.token()) return;
    const teacher = this.isTeacher();
    this.keep('', '');
    this.router.navigate(['/login'], { queryParams: { expired: 1, ...(teacher ? { as: 'teacher' } : {}) } });
  }

  private keep(token: string, name: string) {
    write(KEY, token);
    write(NAME_KEY, name);
    this.token.set(token);
    this.teacherName.set(name);
  }
}

const OPEN = ['/api/auth/login', '/api/auth/teacher', '/api/auth/teachers'];

/** Adds the token to API calls and sends the person back to sign in when it is refused. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const token = auth.token();
  // signing in, and the parents' registration form, carry no token and never sign anyone out
  const isLogin = OPEN.some(u => req.url.endsWith(u)) || req.url.includes('/api/public/');
  const sent = token && !isLogin ? req.clone({ setHeaders: { Authorization: 'Bearer ' + token } }) : req;
  return next(sent).pipe(catchError((e: unknown) => {
    if (e instanceof HttpErrorResponse && e.status === 401 && !isLogin) auth.expired();
    return throwError(() => e);
  }));
};

/** The office's pages. A teacher who opens one is taken to their check-in. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  if (!auth.signedIn()) return inject(Router).createUrlTree(['/login']);
  return auth.isTeacher() ? inject(Router).createUrlTree(['/checkin']) : true;
};

/** The check-in page: teachers only. */
export const teacherGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  if (!auth.signedIn()) return inject(Router).createUrlTree(['/login'], { queryParams: { as: 'teacher' } });
  return auth.isTeacher() ? true : inject(Router).createUrlTree(['/teachers']);
};
