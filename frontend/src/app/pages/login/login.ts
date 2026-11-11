import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';

const LAST_TEACHER = 'sapa.lastTeacher';

/**
 * Signing in. The office uses the shared password; a teacher picks their name and types their
 * PIN, which takes them straight to checking in.
 */
@Component({
  selector: 'app-login',
  template: `
    <section class="panel login">
      <form class="card" (submit)="$event.preventDefault(); submit()">
        <div class="login-mark"><img src="logo-small.png" alt="" width="60" height="55"></div>
        <h1>Shalom Academy</h1>
        <p class="login-sub">of Performing Arts</p>

        <div class="login-who" role="tablist" aria-label="Who is signing in">
          <button type="button" role="tab" [class.is-on]="mode() === 'office'" (click)="setMode('office')">🏫 Office</button>
          <button type="button" role="tab" [class.is-on]="mode() === 'teacher'" (click)="setMode('teacher')">🎵 Teacher</button>
        </div>

        @if (expired) {
          <p class="hint warn">Your sign-in has ended. Please sign in again.</p>
        }

        @if (mode() === 'office') {
          <p class="hint">Fee receipts, payments and students — enter the office password.</p>
          <label class="field">
            <span>Password</span>
            <input #pw type="password" autocomplete="current-password" [disabled]="busy()"
                   [value]="password()" (input)="password.set($any($event.target).value)">
          </label>
        } @else {
          <p class="hint">Check in for your classes when you arrive at the academy.</p>
          @if (teachers().length) {
            <div class="field"><span>Who are you?</span>
              <div class="login-teachers">
                @for (t of teachers(); track t.id) {
                  <button type="button" [class.is-on]="teacherId() === t.id" (click)="pick(t.id)">
                    <i>{{ t.name.charAt(0) }}</i>{{ t.name }}</button>
                }
              </div>
            </div>
            <label class="field">
              <span>Your PIN</span>
              <input #pinBox class="login-pin" type="password" inputmode="numeric" autocomplete="one-time-code"
                     maxlength="6" placeholder="••••" [disabled]="busy()"
                     [value]="pin()" (input)="typePin($event)">
            </label>
          } @else {
            <p class="hint warn">{{ teachersLoaded() ? 'No teacher has a PIN yet. Ask the office to set one for you.' : 'Loading…' }}</p>
          }
        }

        @if (error()) { <p class="login-error" role="alert">{{ error() }}</p> }
        <button type="submit" class="btn btn-primary" [disabled]="busy() || (mode() === 'teacher' && !teachers().length)">
          {{ busy() ? 'Signing in…' : mode() === 'teacher' ? 'Sign in to check in' : 'Sign in' }}</button>
      </form>
    </section>
  `,
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);

  private pw = viewChild<ElementRef<HTMLInputElement>>('pw');
  private pinBox = viewChild<ElementRef<HTMLInputElement>>('pinBox');
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly expired = !!this.params.get('expired');

  protected readonly mode = signal<'office' | 'teacher'>(this.params.get('as') === 'teacher' ? 'teacher' : 'office');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly password = signal('');
  protected readonly pin = signal('');
  protected readonly teachers = signal<{ id: string; name: string }[]>([]);
  protected readonly teachersLoaded = signal(false);
  protected readonly teacherId = signal(readLast());

  constructor() {
    if (this.auth.signedIn()) this.router.navigate([this.auth.home()]);
    if (this.mode() === 'teacher') this.loadTeachers();
    afterNextRender(() => this.focus());
  }

  protected setMode(m: 'office' | 'teacher') {
    this.mode.set(m);
    this.error.set('');
    if (m === 'teacher' && !this.teachersLoaded()) this.loadTeachers();
    setTimeout(() => this.focus());
  }

  protected pick(id: string) {
    this.teacherId.set(id);
    this.error.set('');
    setTimeout(() => this.pinBox()?.nativeElement.focus());
  }

  /** digits only */
  protected typePin(e: Event) {
    const box = e.target as HTMLInputElement;
    const digits = box.value.replace(/\D/g, '');
    if (digits !== box.value) box.value = digits;
    this.pin.set(digits);
  }

  private async loadTeachers() {
    try {
      const list = await this.auth.teachers();
      this.teachers.set(list);
      // the name used last time on this phone, or the only one there is
      if (!list.some(t => t.id === this.teacherId())) this.teacherId.set(list.length === 1 ? list[0].id : '');
    } catch {
      this.error.set('Could not reach the server.');
    } finally {
      this.teachersLoaded.set(true);
    }
  }

  private focus() {
    if (this.mode() === 'office') this.pw()?.nativeElement.focus();
    else if (this.teacherId()) this.pinBox()?.nativeElement.focus();
  }

  protected async submit() {
    this.error.set('');
    if (this.mode() === 'office') {
      if (!this.password()) { this.error.set('Enter the password.'); return; }
    } else {
      if (!this.teacherId()) { this.error.set('Tap your name first.'); return; }
      if (this.pin().length < 4) { this.error.set('Enter your PIN (4 to 6 digits).'); return; }
    }
    this.busy.set(true);
    try {
      if (this.mode() === 'office') {
        await this.auth.login(this.password());
      } else {
        await this.auth.loginTeacher(this.teacherId(), this.pin());
        try { localStorage.setItem(LAST_TEACHER, this.teacherId()); } catch { /* private mode */ }
      }
      this.router.navigate([this.auth.home()]);
    } catch (e) {
      this.error.set(errorMessage(e, 'Could not sign in.'));
      this.busy.set(false);
      if (this.mode() === 'teacher') this.pin.set('');
      setTimeout(() => this.focus());
    }
  }
}

function readLast(): string {
  try { return localStorage.getItem(LAST_TEACHER) ?? ''; } catch { return ''; }
}
