import { birthday } from './core/birthdays';
import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth } from './core/auth';
import { Store } from './core/store';
import { Toast } from './core/toast';
import { Dialog } from './core/dialog';
import { SITE_LOGO } from './receipt/receipt-sheet';

/** One entry in the side menu. `tone` picks its colour (shell.css). */
interface NavItem { path: string; label: string; hint: string; tone: string; icon: string }

const NAV: NavItem[] = [
  { path: '/', label: 'New receipt', hint: 'Issue and send a fee receipt', tone: 'rose',
    icon: 'M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5' },
  { path: '/payments', label: 'Payments', hint: 'Who has paid this month', tone: 'green',
    icon: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M7 15h3' },
  { path: '/students', label: 'Students', hint: 'Students, classes and fees', tone: 'blue',
    icon: 'M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M3.5 19c.7-3.2 3-5 5.5-5s4.8 1.8 5.5 5 M17 11.4a2.4 2.4 0 1 0 0-4.8 M15.8 14.2c2.3.2 4 1.8 4.6 4.3' },
  { path: '/registrations', label: 'Registration pool', hint: 'Children registered online', tone: 'fuchsia',
    icon: 'M9 4h6v3H9z M7 5.5H5.5A1.5 1.5 0 0 0 4 7v12.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17 M12 11v6 M9 14h6' },
  { path: '/classes', label: 'Classes', hint: 'Every class and its students', tone: 'teal',
    icon: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z' },
  { path: '/attendance', label: 'Attendance', hint: 'Mark students present, late or absent', tone: 'sky',
    icon: 'M9 11l3 3 8-8 M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9' },
  { path: '/teachers', label: 'Teachers', hint: 'Attendance and salary', tone: 'coral',
    icon: 'M12 4l9 4-9 4-9-4z M7 10v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4 M21 8v5' },
  { path: '/today', label: "Today's special", hint: 'Birthdays and celebrations', tone: 'party',
    icon: 'M4 21h16 M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7 M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 M12 12V8 M12 5.5a1.2 1.2 0 0 0 1.2-1.2C13.2 3.4 12 2 12 2s-1.2 1.4-1.2 2.3A1.2 1.2 0 0 0 12 5.5z' },
  { path: '/world', label: 'World clock', hint: 'Sri Lanka and the online students', tone: 'indigo',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3.6 9h16.8 M3.6 15h16.8 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18' },
  { path: '/history', label: 'History', hint: 'Every receipt issued', tone: 'amber',
    icon: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z M12 7.5V12l3 2' },
  { path: '/settings', label: 'Settings', hint: 'Academy details and lists', tone: 'violet',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3 M5.3 5.3l2.1 2.1 M16.6 16.6l2.1 2.1 M5.3 18.7l2.1-2.1 M16.6 7.4l2.1-2.1' },
];

const COLLAPSED_KEY = 'sapa.nav.collapsed';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  protected store = inject(Store);
  protected toast = inject(Toast);
  protected dialog = inject(Dialog);
  protected auth = inject(Auth);
  private router = inject(Router);

  protected readonly nav = NAV;

  /** how many students have their birthday today, for the menu */
  protected readonly birthdaysToday = computed(() =>
    this.store.students().filter(s => s.active && birthday(s, s.dateOfBirth ?? '')?.daysAway === 0).length);
  protected readonly logo = computed(() => this.store.settings().logo || SITE_LOGO);
  protected readonly brand = computed(() =>
    this.store.settings().academyName.replace(/^Shalom Academy.*/i, 'Shalom Academy'));

  /** phones: the menu slides in over the page */
  protected readonly open = signal(false);
  /** computers: the menu shrinks to its icons */
  protected readonly collapsed = signal(readFlag());

  private readonly url = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationEnd), map(e => (e as NavigationEnd).urlAfterRedirects)),
    { initialValue: this.router.url });
  protected readonly page = computed(() => {
    const path = (this.url() || '/').split(/[?#]/)[0];
    return NAV.find(n => n.path === path) ?? NAV[0];
  });
  /** the parents' registration form: no menu, whoever opens it */
  protected readonly bare = computed(() => (this.url() || '').startsWith('/register/'));
  protected readonly today = new Date().toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  constructor() {
    // load everything once signed in; forget it all on signing out
    effect(() => {
      // a teacher's phone only checks in, so it loads none of the office's data
      const office = this.auth.isOffice();
      untracked(() => office ? this.store.load() : this.store.clear());
    });
    // a page change closes the phone menu
    effect(() => { this.url(); untracked(() => this.open.set(false)); });
  }

  protected toggleCollapsed() {
    const v = !this.collapsed();
    this.collapsed.set(v);
    try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : ''); } catch { /* private mode */ }
  }

  @HostListener('document:keydown.escape')
  protected closeMenu() { this.open.set(false); }

  /* ---- phones: swipe in from the left edge to open, swipe left to close ---- */
  private touch: { x: number; y: number; lx: number; ly: number } | null = null;

  @HostListener('document:touchstart', ['$event'])
  protected onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    // only from the very edge when closed, so sideways scrolling inside the page still works
    this.touch = this.open() || t.clientX < 24 ? { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY } : null;
  }

  @HostListener('document:touchmove', ['$event'])
  protected onTouchMove(e: TouchEvent) {
    if (!this.touch) return;
    this.touch.lx = e.touches[0].clientX;
    this.touch.ly = e.touches[0].clientY;
  }

  // the browser may take a sideways drag over as a scroll and cancel it, so act on either
  @HostListener('document:touchcancel')
  @HostListener('document:touchend')
  protected onTouchEnd() {
    if (!this.touch || !this.auth.signedIn()) return;
    const dx = this.touch.lx - this.touch.x, dy = this.touch.ly - this.touch.y;
    this.touch = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0 && !this.open()) this.open.set(true);
    else if (dx < 0 && this.open()) this.open.set(false);
  }
}

function readFlag(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}
