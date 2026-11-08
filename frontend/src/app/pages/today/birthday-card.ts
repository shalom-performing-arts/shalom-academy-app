import { Component, OnDestroy, OnInit, inject, input, output, signal } from '@angular/core';
import { Birthday, WISHES, birthdayMessage, firstName, ordinal, prettyDay, wishFor } from '../../core/birthdays';
import { Store } from '../../core/store';
import { Toast } from '../../core/toast';
import { download } from '../../receipt/export';
import { SITE_LOGO } from '../../receipt/receipt-sheet';
import { THEMES, CardTheme, canvasPng, drawCard, themeFor } from './card-art';

/**
 * A birthday card for one student: pick a design, change the wish, then copy the picture and
 * the message and paste them into the parent's WhatsApp chat.
 */
@Component({
  selector: 'app-birthday-card',
  template: `
<div class="sheet-backdrop" (click)="closed.emit()"></div>
<aside class="sheet bc" role="dialog" aria-label="Birthday card">
  <header class="sheet-head">
    <div><h2>🎂 Birthday card</h2>
      <small>{{ b().student.name }} · {{ b().daysAway === 0 ? 'today' : prettyDay(b().next) }}{{ b().turning ? ' · turns ' + b().turning : '' }}</small></div>
    <button type="button" class="btn-icon" (click)="closed.emit()" aria-label="Close">✕</button>
  </header>
  <div class="sheet-body bc-body">
    <!-- the card, large; tap it to see it full size -->
    <div class="bc-left">
      <button type="button" class="bc-preview" (click)="zoom.set(true)" [disabled]="!url()" title="See the card full size">
        @if (url()) { <img [src]="url()" alt="Birthday card"> } @else { <span>Drawing the card…</span> }
      </button>
      @if (url()) { <p class="bc-tap">🔍 Tap the card to see it full size</p> }
    </div>

    <div class="bc-right">
    <p class="bc-label">Design <em>· {{ theme().month }}: {{ theme().stone }} &amp; {{ theme().flower }}{{ theme().id === own().id ? ' — their birth month' : '' }}</em></p>
    <div class="bc-themes">
      @for (t of themes; track t.id) {
        <button type="button" [class.is-on]="theme().id === t.id" [class.own]="t.id === own().id" (click)="pick(t)"
                [title]="t.month + ' · ' + t.stone + ' & ' + t.flower"
                [style.background]="'linear-gradient(150deg,' + t.bg[1] + ',' + t.bg[0] + ' 60%,' + t.gem[0] + ')'">
          {{ t.month.slice(0, 3) }}</button>
      }
    </div>

    <label class="field"><span>From</span>
      <input type="text" maxlength="40" [value]="from()" (input)="setFrom($any($event.target).value)" placeholder="Teacher Rebeccah"></label>

    <label class="field"><span>Wish on the card
        <button type="button" class="link bc-another" (click)="anotherWish()">↻ Another wish</button></span>
      <textarea rows="3" maxlength="170" [value]="wish()" (input)="setWish($any($event.target).value)"></textarea></label>

    <div class="bc-steps">
      <div class="bc-step" [class.done]="copied() === 'picture'">
        <span class="bc-n">1</span>
        <button type="button" class="btn btn-wa" [disabled]="!ready()" (click)="copyPicture()">
          {{ copied() === 'picture' ? '✓ Copied — now paste' : '📋 Copy card picture' }}</button>
        <button type="button" class="link" [disabled]="!ready()" (click)="save()">Save picture</button>
      </div>
      <div class="bc-step" [class.done]="copied() === 'message'">
        <span class="bc-n">2</span>
        <div class="bc-msg">
          <textarea rows="7" [value]="message()" (input)="message.set($any($event.target).value)"></textarea>
          <button type="button" class="btn btn-wa" (click)="copyMessage()">
            {{ copied() === 'message' ? '✓ Copied — now paste' : '📋 Copy message' }}</button>
        </div>
      </div>
      @if (b().student.phone) {
        <p class="bc-to">To <b>{{ b().student.parent || 'the parent' }}</b> · {{ b().student.phone }}
          <button type="button" class="link" (click)="copyNumber()">{{ copied() === 'number' ? '✓ copied' : 'copy number' }}</button></p>
      } @else {
        <p class="hint warn">No WhatsApp number on file for {{ first() }} — add it on the Students page.</p>
      }
      @if (note()) { <p class="hint warn">{{ note() }}</p> }
    </div>
    </div>
  </div>
</aside>

@if (zoom() && url()) {
  <div class="bc-zoom" (click)="zoom.set(false)" role="dialog" aria-label="The card, full size">
    <img [src]="url()" alt="Birthday card, full size">
    <button type="button" class="bc-zoom-x" aria-label="Close">✕</button>
  </div>
}
  `,
  styles: [`
    .bc{width:min(1080px, 100vw)}
    .bc .sheet-head{background:linear-gradient(90deg, #ffe3ee, #efe5ff)}
    /* a computer: the card on the left, as tall as the window allows; the controls on the right */
    .bc .bc-body{display:grid; grid-template-columns:minmax(0, 1.05fr) minmax(0, 1fr); gap:24px; align-items:start}
    .bc-left{position:sticky; top:0; display:flex; flex-direction:column; align-items:center; gap:6px}
    .bc-right{min-width:0; display:flex; flex-direction:column}
    .bc-right > *{flex:none}
    .bc-preview{width:100%; display:grid; place-items:center; background:linear-gradient(160deg, #f6f1f8, #efe7f3); border:0; border-radius:18px;
      padding:14px; cursor:zoom-in; font:inherit}
    .bc-preview img{display:block; width:auto; max-width:100%; max-height:calc(100vh - 170px); aspect-ratio:1080 / 1350; height:auto;
      border-radius:10px; box-shadow:0 16px 40px rgba(58,18,56,.3)}
    .bc-preview span{color:var(--muted); padding:120px 0}
    .bc-tap{margin:0; font-size:12.5px; color:var(--muted)}
    .bc-zoom{position:fixed; inset:0; z-index:80; background:rgba(15,8,20,.88); display:grid; place-items:center; padding:20px; cursor:zoom-out; animation:fade .15s}
    .bc-zoom img{width:auto; height:auto; max-width:calc(100vw - 40px); max-height:calc(100vh - 40px); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.5)}
    .bc-zoom-x{position:absolute; top:14px; right:16px; width:44px; height:44px; border-radius:50%; border:0; background:#fff; font-size:18px; cursor:pointer}
    .bc-label{margin:14px 0 6px; font-weight:700; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px}
    .bc-another{float:right; font-size:12.5px; font-weight:700}
    .bc-label em{font-style:normal; font-weight:600; text-transform:none; letter-spacing:0; color:#7a5c2e}
    .bc-themes{display:grid; grid-template-columns:repeat(6, 1fr); gap:6px; margin-bottom:12px}
    .bc-themes button{position:relative; border:2px solid transparent; border-radius:10px; color:#fff; font:inherit; font-weight:800; font-size:12.5px;
      padding:10px 2px; cursor:pointer; text-shadow:0 1px 3px rgba(0,0,0,.45); min-height:44px; letter-spacing:.5px}
    .bc-themes button.own::after{content:"🎂"; position:absolute; top:-8px; right:-6px; font-size:13px}
    .bc-themes button.is-on{border-color:#c9952f; box-shadow:0 0 0 2px #fff inset, 0 4px 12px rgba(0,0,0,.25)}
    .bc textarea{width:100%; font:inherit; font-size:14.5px; line-height:1.5; resize:vertical}
    .bc-steps{display:flex; flex-direction:column; gap:10px; margin-top:4px}
    .bc-step{display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 12px; border-radius:14px; background:#f7faf8; border:1.5px solid #dcefe3}
    .bc-step.done{background:#e3f6ec; border-color:#7fd1a3}
    .bc-step .btn-wa{min-height:44px; font-size:15px}
    .bc-n{flex:none; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:#128c4b; color:#fff; font-weight:800; font-size:13px; align-self:flex-start; margin-top:8px}
    .bc-msg{flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; align-items:flex-start}
    .bc-to{margin:0; font-size:13.5px; color:#5b4660}
    /* a phone or narrow window: the card on top, full width, then the controls */
    @media (max-width:900px){
      .bc .bc-body{display:flex; flex-direction:column; gap:12px}
      .bc .bc-body > *{flex:none}
      .bc-left{position:static}
      .bc-preview img{max-height:none; width:100%}
    }
    @media (max-width:560px){ .bc-themes{grid-template-columns:repeat(4, 1fr)} }
  `],
})
export class BirthdayCard implements OnInit, OnDestroy {
  private store = inject(Store);
  private toast = inject(Toast);

  readonly b = input.required<Birthday>();
  readonly closed = output<void>();

  protected readonly themes = THEMES;
  protected readonly prettyDay = prettyDay;
  protected readonly theme = signal<CardTheme>(THEMES[0]);
  protected readonly wish = signal('');
  /** the card shown full size */
  protected readonly zoom = signal(false);
  /** who signs the card and the message */
  protected readonly from = signal('Teacher Rebeccah');
  private wishNo = 0;
  protected readonly message = signal('');
  protected readonly url = signal('');
  protected readonly ready = signal(false);
  protected readonly copied = signal<'' | 'picture' | 'message' | 'number'>('');
  protected readonly note = signal('');
  private png: Blob | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private drawn = 0;

  /** the design of the month they were born in */
  protected own(): CardTheme {
    return themeFor(this.b().next.getMonth());
  }

  protected first() {
    return firstName(this.b().student.name);
  }

  ngOnInit() {
    // the design of their birth month, and a wish of its own
    this.theme.set(this.own());
    this.wish.set(wishFor(this.b().student.name));
    this.message.set(this.parentMessage());
    this.draw();
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
    if (this.url()) URL.revokeObjectURL(this.url());
  }

  protected pick(t: CardTheme) {
    this.theme.set(t);
    this.draw();
  }

  /** the next of the written wishes */
  protected anotherWish() {
    this.wishNo = (this.wishNo + 1) % WISHES.length;
    this.wish.set(wishFor(this.b().student.name, this.wishNo));
    this.draw();
  }

  private parentMessage(): string {
    return birthdayMessage({ parent: this.b().student.parent, student: this.b().student.name, turning: this.b().turning,
      academy: this.store.settings().academyName, from: this.from().trim() });
  }

  protected setFrom(v: string) {
    this.from.set(v);
    this.message.set(this.parentMessage());
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.draw(), 350);
  }

  protected setWish(v: string) {
    this.wish.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.draw(), 350);
  }

  private async draw() {
    const run = ++this.drawn;
    this.ready.set(false);
    this.copied.set('');
    const s = this.store.settings();
    const canvas = await drawCard({
      name: this.b().student.name,
      turning: this.b().turning, wish: this.wish().trim(), academy: s.academyName, from: this.from().trim(), motto: s.motto,
      logo: s.logo || SITE_LOGO, theme: this.theme(),
    });
    const png = await canvasPng(canvas);
    if (run !== this.drawn) return;   // a newer drawing has started
    this.png = png;
    if (this.url()) URL.revokeObjectURL(this.url());
    this.url.set(URL.createObjectURL(png));
    this.ready.set(true);
  }

  protected async copyPicture() {
    if (!this.png) return;
    this.note.set('');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': this.png })]);
      this.copied.set('picture');
    } catch {
      this.note.set('This browser could not copy the picture. Use "Save picture" and attach it in WhatsApp.');
    }
  }

  protected async copyMessage() {
    await this.copyText(this.message().trim(), 'message');
  }

  protected async copyNumber() {
    await this.copyText(this.b().student.phone, 'number');
  }

  private async copyText(text: string, what: 'message' | 'number') {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(what);
    } catch {
      this.toast.show('Could not copy.');
    }
  }

  protected save() {
    if (this.png) download(this.png, `Happy-Birthday-${firstName(this.b().student.name)}${this.b().turning ? '-' + ordinal(this.b().turning!) : ''}.png`);
  }
}
