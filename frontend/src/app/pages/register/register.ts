import { waUrl } from '../../core/whatsapp';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { errorMessage } from '../../core/api';
import {
  PublicForm, PublicRegistrationApi, RegInput, Submitted, emailProblem, emptyInput, phoneProblem,
} from '../../core/registrations';
import { waNumber } from '../../receipt/format';
import { SITE_LOGO } from '../../receipt/receipt-sheet';

interface Step { title: string; hint: string; icon: string }

const STEPS: Step[] = [
  { title: 'Your child', hint: 'Who is joining us', icon: '🧒' },
  { title: 'Parent / guardian', hint: 'How we reach you', icon: '👪' },
  { title: 'Music & classes', hint: 'What and when', icon: '🎵' },
  { title: 'Health & consent', hint: 'Keeping them safe', icon: '🩺' },
  { title: 'Check & send', hint: 'One last look', icon: '✅' },
];

const RELATIONS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Other'];
const GENDERS = ['Girl', 'Boy', 'Prefer not to say'];
const EXPERIENCE = ['No experience yet', 'Had some lessons', 'Plays already'];
const HEARD = ['Facebook', 'Instagram', 'TikTok', 'Friend or family', 'Google', 'Saw the academy', 'Other'];

/**
 * The online registration form parents open from the shared link. No sign-in: it talks only to
 * /api/public/register/{token}. Opened with ?preview=1 by the office, it never saves anything.
 */
@Component({
  selector: 'app-register',
  imports: [FormsModule],
  styleUrl: './register.css',
  template: `
<div class="rg">
  <header class="rg-hero">
    <div class="rg-hero-in">
      <span class="rg-logo"><img [src]="logo()" alt=""></span>
      <div>
        <p class="rg-academy">{{ info()?.academy || 'Shalom Academy of Performing Arts' }}</p>
        <h1>{{ info()?.title || 'Student Registration' }}</h1>
      </div>
    </div>
  </header>

  <main class="rg-main">
    @if (preview) {
      <div class="rg-preview">👀 <b>Preview</b> — this is exactly what parents see. Nothing is saved from here.</div>
    }

    @if (loadError()) {
      <section class="rg-card rg-msg">
        <span class="rg-big">🔗</span>
        <h2>This link doesn't work</h2>
        <p>{{ loadError() }}</p>
      </section>
    } @else if (!info()) {
      <section class="rg-card rg-msg"><p class="rg-wait">Loading the form…</p></section>
    } @else if (!info()!.open && !preview) {
      <section class="rg-card rg-msg">
        <span class="rg-big">🎼</span>
        <h2>Registrations are closed</h2>
        <p>{{ info()!.closedMessage }}</p>
        @if (contactWa()) { <a class="rg-btn rg-wa" [href]="contactWa()" target="_blank" rel="noopener">💬 Message the academy</a> }
      </section>
    } @else if (done(); as d) {
      <!-- ================= thank you ================= -->
      <section class="rg-card rg-done">
        <div class="rg-tick" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        <h2>Registration received!</h2>
        <p class="rg-done-who"><b>{{ d.childName }}</b> is registered.</p>
        <div class="rg-number">
          <small>Your registration number</small>
          <b>{{ d.number }}</b>
          <small>Please keep it for your records</small>
        </div>
        <p class="rg-thanks">{{ d.thanks }}</p>
        <ol class="rg-next">
          <li><span>1</span>We review your registration</li>
          <li><span>2</span>We find the best class and time for {{ firstName(d.childName) }}</li>
          <li><span>3</span>We contact you on WhatsApp to confirm</li>
        </ol>
        <div class="rg-done-act">
          <button type="button" class="rg-btn rg-ghost" (click)="another()">➕ Register another child</button>
          @if (contactWa()) { <a class="rg-btn rg-wa" [href]="contactWa()" target="_blank" rel="noopener">💬 WhatsApp the academy</a> }
        </div>
      </section>
    } @else {
      <!-- ================= the form ================= -->
      @if (step() === 0 && !started()) {
        <section class="rg-card rg-intro">
          <p>{{ info()!.intro }}</p>
        </section>
      }

      <nav class="rg-progress" aria-label="Progress">
        <div class="rg-bar"><i [style.width.%]="(step() / (steps.length - 1)) * 100"></i></div>
        <ol>
          @for (s of steps; track s.title; let i = $index) {
            <li [class.is-on]="i === step()" [class.is-done]="i < step()">
              <button type="button" (click)="goTo(i)" [disabled]="i > furthest()" [attr.aria-current]="i === step() ? 'step' : null">
                <span class="rg-dot">{{ i < step() ? '✓' : i + 1 }}</span>
                <span class="rg-step-name">{{ s.title }}</span>
              </button>
            </li>
          }
        </ol>
        <p class="rg-step-of">Step {{ step() + 1 }} of {{ steps.length }} · <b>{{ steps[step()].title }}</b></p>
      </nav>

      <section class="rg-card">
        <header class="rg-card-head">
          <span class="rg-ico">{{ steps[step()].icon }}</span>
          <div><h2>{{ steps[step()].title }}</h2><small>{{ steps[step()].hint }}</small></div>
        </header>

        @switch (step()) {
          @case (0) {
            <label class="rg-field" [class.bad]="err('childName')">
              <span>Child's full name <i>*</i></span>
              <input type="text" name="childName" [(ngModel)]="m.childName" autocomplete="off" placeholder="e.g. Amaya Nethmi Perera" maxlength="80">
              @if (err('childName'); as e) { <em class="rg-err">{{ e }}</em> }
            </label>
            <div class="rg-two">
              <label class="rg-field">
                <span>Name they like to be called</span>
                <input type="text" name="preferredName" [(ngModel)]="m.preferredName" placeholder="e.g. Amu" maxlength="60">
              </label>
              <label class="rg-field" [class.bad]="err('dateOfBirth')">
                <span>Date of birth <i>*</i></span>
                <input type="date" name="dob" [(ngModel)]="m.dateOfBirth" [max]="today">
                @if (err('dateOfBirth'); as e) { <em class="rg-err">{{ e }}</em> }
                @else if (age() !== null) { <em class="rg-ok">Age {{ age() }}</em> }
              </label>
            </div>
            <div class="rg-field">
              <span>Gender</span>
              <div class="rg-pills">
                @for (g of genders; track g) {
                  <button type="button" [class.is-on]="m.gender === g" (click)="m.gender = m.gender === g ? '' : g">{{ g }}</button>
                }
              </div>
            </div>
            <div class="rg-two">
              <label class="rg-field">
                <span>School</span>
                <input type="text" name="school" [(ngModel)]="m.school" placeholder="e.g. Musaeus College" maxlength="120">
              </label>
              <label class="rg-field">
                <span>Grade / year</span>
                <input type="text" name="grade" [(ngModel)]="m.grade" placeholder="e.g. Grade 3" maxlength="30">
              </label>
            </div>
          }

          @case (1) {
            <div class="rg-two">
              <label class="rg-field" [class.bad]="err('parentName')">
                <span>Your full name <i>*</i></span>
                <input type="text" name="parentName" [(ngModel)]="m.parentName" autocomplete="name" placeholder="e.g. Nadeesha Perera" maxlength="80">
                @if (err('parentName'); as e) { <em class="rg-err">{{ e }}</em> }
              </label>
              <div class="rg-field" [class.bad]="err('relation')">
                <span>You are the child's <i>*</i></span>
                <div class="rg-pills">
                  @for (r of relations; track r) {
                    <button type="button" [class.is-on]="m.relation === r" (click)="m.relation = r">{{ r }}</button>
                  }
                </div>
                @if (err('relation'); as e) { <em class="rg-err">{{ e }}</em> }
              </div>
            </div>
            <div class="rg-two">
              <label class="rg-field" [class.bad]="err('phone')">
                <span>Mobile number <i>*</i></span>
                <input type="tel" name="phone" [(ngModel)]="m.phone" autocomplete="tel" inputmode="tel" placeholder="071 040 7740" maxlength="24">
                @if (err('phone'); as e) { <em class="rg-err">{{ e }}</em> }
              </label>
              <div class="rg-field" [class.bad]="err('whatsapp')">
                <span>WhatsApp number</span>
                <label class="rg-check small"><input type="checkbox" name="waSame" [(ngModel)]="waSame"> Same as mobile number</label>
                @if (!waSame) {
                  <input type="tel" name="whatsapp" [(ngModel)]="m.whatsapp" inputmode="tel" placeholder="077 123 4567" maxlength="24">
                }
                @if (err('whatsapp'); as e) { <em class="rg-err">{{ e }}</em> }
              </div>
            </div>
            <label class="rg-field" [class.bad]="err('email')">
              <span>Email</span>
              <input type="email" name="email" [(ngModel)]="m.email" autocomplete="email" inputmode="email" placeholder="name@gmail.com" maxlength="120">
              @if (err('email'); as e) { <em class="rg-err">{{ e }}</em> }
            </label>
            <label class="rg-field">
              <span>Home address</span>
              <textarea name="address" rows="2" [(ngModel)]="m.address" autocomplete="street-address" placeholder="House number, street, town" maxlength="300"></textarea>
            </label>
          }

          @case (2) {
            @if (info()!.courses.length) {
              <div class="rg-field">
                <span>Which course would you like?</span>
                <div class="rg-cards">
                  @for (c of info()!.courses; track c) {
                    <button type="button" class="rg-choice" [class.is-on]="m.interest === c" (click)="m.interest = m.interest === c ? '' : c">
                      <b>{{ courseIcon(c) }}</b>{{ c }}
                    </button>
                  }
                </div>
              </div>
            }
            <div class="rg-field">
              <span>Which class do you think fits? <em>We will confirm the right one</em></span>
              <div class="rg-pills">
                @for (c of info()!.classes; track c) {
                  <button type="button" [class.is-on]="m.preferredClass === c" (click)="m.preferredClass = c">{{ c }}</button>
                }
                <button type="button" [class.is-on]="!m.preferredClass" (click)="m.preferredClass = ''">Not sure — please advise</button>
              </div>
            </div>
            @if (info()!.days.length) {
              <div class="rg-field">
                <span>Which days suit you? <em>Pick all that work</em></span>
                <div class="rg-pills">
                  @for (d of info()!.days; track d) {
                    <button type="button" [class.is-on]="hasDay(d)" (click)="toggleDay(d)">{{ hasDay(d) ? '✓ ' : '' }}{{ d }}</button>
                  }
                </div>
              </div>
            }
            <div class="rg-field">
              <span>Music experience</span>
              <div class="rg-pills">
                @for (x of experience; track x) {
                  <button type="button" [class.is-on]="m.experience === x" (click)="m.experience = m.experience === x ? '' : x">{{ x }}</button>
                }
              </div>
            </div>
            <label class="rg-field">
              <span>How did you hear about us?</span>
              <select name="howHeard" [(ngModel)]="m.howHeard">
                <option value="">— Choose —</option>
                @for (h of heard; track h) { <option [value]="h">{{ h }}</option> }
              </select>
            </label>
            <label class="rg-field">
              <span>Anything you'd like us to know?</span>
              <textarea name="message" rows="3" [(ngModel)]="m.message" placeholder="Questions, goals, songs they love…" maxlength="1000"></textarea>
            </label>
          }

          @case (3) {
            <div class="rg-two">
              <label class="rg-field">
                <span>Emergency contact name</span>
                <input type="text" name="emergencyName" [(ngModel)]="m.emergencyName" placeholder="Someone other than you" maxlength="80">
              </label>
              <label class="rg-field" [class.bad]="err('emergencyPhone')">
                <span>Emergency contact number</span>
                <input type="tel" name="emergencyPhone" [(ngModel)]="m.emergencyPhone" inputmode="tel" placeholder="077 123 4567" maxlength="24">
                @if (err('emergencyPhone'); as e) { <em class="rg-err">{{ e }}</em> }
              </label>
            </div>
            <label class="rg-field">
              <span>Medical conditions or allergies</span>
              <textarea name="medical" rows="2" [(ngModel)]="m.medical" placeholder="Leave empty if none" maxlength="600"></textarea>
            </label>
            <label class="rg-consent">
              <input type="checkbox" name="photo" [(ngModel)]="m.photoConsent">
              <span><b>Photos & videos</b> — I'm happy for photos or videos of my child at classes and concerts to be shared by the academy.</span>
            </label>
            <label class="rg-consent" [class.bad]="err('agreed')">
              <input type="checkbox" name="agreed" [(ngModel)]="m.agreed">
              <span><b>I agree <i>*</i></b> — the details I've given are correct, and I agree to the academy's rules,
                including paying the monthly class fee on time. <em>(Required)</em></span>
            </label>
            @if (err('agreed'); as e) { <em class="rg-err">{{ e }}</em> }
          }

          @case (4) {
            <div class="rg-review">
              @for (sec of review(); track sec.title; let i = $index) {
                <div class="rg-rev">
                  <header><b>{{ steps[i].icon }} {{ sec.title }}</b><button type="button" (click)="goTo(i)">Edit</button></header>
                  <dl>
                    @for (r of sec.rows; track r[0]) { <dt>{{ r[0] }}</dt><dd>{{ r[1] || '—' }}</dd> }
                  </dl>
                </div>
              }
            </div>
            @if (sendError()) { <p class="rg-send-err" role="alert">⚠ {{ sendError() }}</p> }
          }
        }

        <footer class="rg-foot">
          @if (step() > 0) { <button type="button" class="rg-btn rg-ghost" (click)="back()">← Back</button> }
          <span class="rg-space"></span>
          @if (step() < steps.length - 1) {
            <button type="button" class="rg-btn rg-go" (click)="next()">Next →</button>
          } @else {
            <button type="button" class="rg-btn rg-go rg-send" (click)="send()" [disabled]="sending()">
              {{ sending() ? 'Sending…' : preview ? 'Submit (preview)' : 'Submit registration' }}
            </button>
          }
        </footer>
      </section>
      <p class="rg-small">Fields marked <i>*</i> are required. Your details are only used by the academy.</p>
    }
  </main>
</div>
  `,
})
export class Register {
  private api = inject(PublicRegistrationApi);
  private route = inject(ActivatedRoute);

  protected readonly steps = STEPS;
  protected readonly relations = RELATIONS;
  protected readonly genders = GENDERS;
  protected readonly experience = EXPERIENCE;
  protected readonly heard = HEARD;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly preview = this.route.snapshot.queryParamMap.get('preview') === '1';
  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  protected readonly info = signal<PublicForm | null>(null);
  protected readonly loadError = signal('');
  protected readonly step = signal(0);
  protected readonly furthest = signal(0);
  protected readonly started = signal(false);
  /** set once Next was pressed on a step, so mistakes show only then */
  private readonly tried = signal<Set<number>>(new Set());
  protected readonly sending = signal(false);
  protected readonly sendError = signal('');
  protected readonly done = signal<Submitted | null>(null);

  protected m: RegInput = emptyInput();
  protected waSame = true;
  private key = newKey();

  protected readonly logo = computed(() => this.info()?.logo || SITE_LOGO);
  protected readonly contactWa = computed(() => {
    const i = this.info();
    const n = waNumber(i?.whatsapp || i?.phone || '', '94');
    return n ? waUrl(n) : '';
  });

  constructor() {
    this.api.form(this.token).then(f => this.info.set(f), e => {
      this.loadError.set(e instanceof HttpErrorResponse && e.status === 404
        ? 'This registration link is not valid any more. Please ask the academy for the new link.'
        : errorMessage(e, 'The form could not be loaded. Please check your internet connection and try again.'));
    });
  }

  /* ---------------- checking ---------------- */

  /** the problems on one step, by field */
  private problems(step: number): Record<string, string> {
    const m = this.m, out: Record<string, string> = {};
    if (step === 0) {
      if ((m.childName ?? '').replace(/[^\p{L}]/gu, '').length < 2) out['childName'] = "Please enter your child's full name.";
      if (!m.dateOfBirth) out['dateOfBirth'] = 'Please enter the date of birth.';
      else if (m.dateOfBirth > this.today) out['dateOfBirth'] = 'The date of birth cannot be in the future.';
    }
    if (step === 1) {
      if ((m.parentName ?? '').replace(/[^\p{L}]/gu, '').length < 2) out['parentName'] = 'Please enter your name.';
      if (!m.relation) out['relation'] = 'Please choose one.';
      const p = phoneProblem(m.phone, true); if (p) out['phone'] = p;
      if (!this.waSame) { const w = phoneProblem(m.whatsapp, false); if (w) out['whatsapp'] = w; }
      const e = emailProblem(m.email); if (e) out['email'] = e;
    }
    if (step === 3) {
      const p = phoneProblem(m.emergencyPhone, false); if (p) out['emergencyPhone'] = p;
      if (!m.agreed) out['agreed'] = 'Please tick this box to continue.';
    }
    return out;
  }

  protected err(field: string): string {
    const s = this.step();
    return this.tried().has(s) ? this.problems(s)[field] ?? '' : '';
  }

  protected age(): number | null {
    if (!this.m.dateOfBirth) return null;
    const b = new Date(this.m.dateOfBirth), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a >= 0 && a < 120 ? a : null;
  }

  /* ---------------- moving between steps ---------------- */

  protected next() {
    const s = this.step();
    this.tried.update(t => new Set(t).add(s));
    if (Object.keys(this.problems(s)).length) {
      setTimeout(() => document.querySelector('.rg-field.bad, .rg-consent.bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    this.started.set(true);
    this.step.set(s + 1);
    this.furthest.update(f => Math.max(f, s + 1));
    this.top();
  }

  protected back() {
    this.step.update(s => Math.max(0, s - 1));
    this.top();
  }

  protected goTo(i: number) {
    if (i > this.furthest()) return;
    this.step.set(i);
    this.top();
  }

  private top() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- answers ---------------- */

  protected hasDay(d: string) {
    return (this.m.preferredDays ?? []).includes(d);
  }

  protected toggleDay(d: string) {
    const days = this.m.preferredDays ?? [];
    this.m.preferredDays = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
  }

  protected courseIcon(c: string) {
    const l = c.toLowerCase();
    return l.includes('ukulele') ? '🪕' : l.includes('guitar') ? '🎸' : l.includes('piano') || l.includes('key') ? '🎹'
      : l.includes('violin') ? '🎻' : l.includes('drum') ? '🥁' : l.includes('vocal') || l.includes('sing') ? '🎤' : '🎵';
  }

  protected firstName(n: string) {
    return n.trim().split(/\s+/).find(w => w.length > 2 && !w.includes('.')) ?? n;
  }

  protected review(): { title: string; rows: [string, string][] }[] {
    const m = this.m;
    const dob = m.dateOfBirth ? new Date(m.dateOfBirth).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return [
      { title: 'Your child', rows: [['Name', m.childName], ['Called', m.preferredName ?? ''],
        ['Date of birth', dob + (this.age() !== null ? ` (age ${this.age()})` : '')], ['Gender', m.gender ?? ''],
        ['School', [m.school, m.grade].filter(Boolean).join(', ')]] },
      { title: 'Parent / guardian', rows: [['Name', m.parentName + (m.relation ? ` (${m.relation})` : '')], ['Mobile', m.phone],
        ['WhatsApp', this.waSame ? 'Same as mobile' : m.whatsapp ?? ''], ['Email', m.email ?? ''], ['Address', m.address ?? '']] },
      { title: 'Music & classes', rows: [['Course', m.interest ?? ''], ['Class', m.preferredClass || 'Not sure — please advise'],
        ['Days', (m.preferredDays ?? []).join(', ')], ['Experience', m.experience ?? ''], ['Heard from', m.howHeard ?? ''],
        ['Message', m.message ?? '']] },
      { title: 'Health & consent', rows: [['Emergency contact', [m.emergencyName, m.emergencyPhone].filter(Boolean).join(' · ')],
        ['Medical', m.medical || 'None'], ['Photos & videos', m.photoConsent ? 'Yes' : 'No'], ['Agreed to rules', m.agreed ? 'Yes' : 'No']] },
    ];
  }

  /* ---------------- sending ---------------- */

  protected async send() {
    for (const s of [0, 1, 3]) {
      if (Object.keys(this.problems(s)).length) {
        this.tried.update(t => new Set(t).add(s));
        this.goTo(s);
        return;
      }
    }
    this.sendError.set('');
    if (this.preview) {
      this.done.set({ number: 'REG-PREVIEW', childName: this.m.childName, parentName: this.m.parentName,
        thanks: 'Preview only: nothing was saved. Parents see your thank-you message here.' });
      this.top();
      return;
    }
    this.sending.set(true);
    try {
      const body: RegInput = { ...this.m, whatsapp: this.waSame ? '' : this.m.whatsapp, submissionKey: this.key, website: '' };
      this.done.set(await this.api.submit(this.token, body));
      this.top();
    } catch (e) {
      this.sendError.set(errorMessage(e, 'Your registration could not be sent. Please check your internet connection and try again.'));
    } finally {
      this.sending.set(false);
    }
  }

  /** a brother or sister: keep the parent's details, start the child afresh */
  protected another() {
    const keep = this.m;
    this.m = { ...emptyInput(), parentName: keep.parentName, relation: keep.relation, phone: keep.phone,
      whatsapp: keep.whatsapp, email: keep.email, address: keep.address, emergencyName: keep.emergencyName,
      emergencyPhone: keep.emergencyPhone, howHeard: keep.howHeard };
    this.key = newKey();
    this.tried.set(new Set());
    this.done.set(null);
    this.sendError.set('');
    this.step.set(0);
    this.furthest.set(0);
    this.started.set(true);
    this.top();
  }
}

function newKey(): string {
  try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
}
