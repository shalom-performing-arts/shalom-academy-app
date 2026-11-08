import { Component, OnDestroy, OnInit, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { download, jpgBlob, pdfBlob, pngBlob, PdfMeta } from '../../receipt/export';
import { prettyWa, waNumber } from '../../receipt/format';

/** What the person confirmed: the number it went to (may be blank), and whether to keep it on file. */
export interface WhatsAppSent { to: string; saveNumber: boolean }

type Copied = '' | 'picture' | 'message' | 'number';

/**
 * Sending a receipt by copy and paste. The app opens nothing: the person has WhatsApp open
 * already, copies the receipt picture and the message from here, pastes them into the parent's
 * chat, and then says it went. That confirmation saves the receipt, which marks the fee paid.
 */
@Component({
  selector: 'app-whatsapp-send',
  imports: [FormsModule],
  template: `
    <div class="sheet-backdrop" (click)="closed.emit()"></div>
    <aside class="sheet small wa-sheet" role="dialog" aria-modal="true" aria-label="Send on WhatsApp">
      <header class="sheet-head">
        <div><h2>Send on WhatsApp</h2><small>{{ title() }}</small></div>
        <button type="button" class="btn-icon" (click)="closed.emit()" aria-label="Close">✕</button>
      </header>

      <div class="sheet-body">
        <p class="wa-how">Copy each one and paste it (<kbd>Ctrl</kbd> + <kbd>V</kbd>) into
          <b>{{ parent() || 'the parent' }}</b>'s chat in WhatsApp.</p>

        <!-- 1. the receipt picture -->
        <div class="wa-item" [class.done]="copied() === 'picture'">
          <span class="wa-n">1</span>
          <div class="wa-pic">
            @if (pngUrl()) { <img [src]="pngUrl()" alt="Receipt picture"> }
            @else { <span class="wa-wait">{{ note() || 'Preparing…' }}</span> }
          </div>
          <div class="wa-item-body">
            <b>Receipt picture</b>
            <button type="button" class="btn btn-wa wa-copy" [disabled]="!ready()" (click)="copyPicture()">
              {{ copied() === 'picture' ? '✓ Copied — now paste' : '📋 Copy picture' }}</button>
            <span class="wa-save">
              <button type="button" class="link" [disabled]="!ready()" (click)="savePicture()">Save picture</button> ·
              <button type="button" class="link" [disabled]="!ready()" (click)="savePdf()">Save PDF</button>
            </span>
          </div>
        </div>

        <!-- 2. the message -->
        <div class="wa-item" [class.done]="copied() === 'message'">
          <span class="wa-n">2</span>
          <div class="wa-item-body wide">
            <b>Message</b>
            <textarea name="msg" rows="6" [ngModel]="message()" (ngModelChange)="message.set($event)"></textarea>
            <button type="button" class="btn btn-wa wa-copy" (click)="copyMessage()">
              {{ copied() === 'message' ? '✓ Copied — now paste' : '📋 Copy message' }}</button>
          </div>
        </div>

        <!-- the parent's number, to find the chat -->
        <div class="wa-to">
          <label class="field"><span>Parent's WhatsApp <em>(to find the chat; optional)</em></span>
            <span class="wa-to-row">
              <input type="tel" inputmode="tel" name="to" placeholder="e.g. 071 040 7740" autocomplete="off"
                     [ngModel]="to()" (ngModelChange)="to.set($event)">
              <button type="button" class="btn" [disabled]="!to().trim()" (click)="copyNumber()">
                {{ copied() === 'number' ? '✓ Copied' : 'Copy' }}</button>
            </span></label>
          @if (number() && number() !== onFile()) {
            <label class="check"><input type="checkbox" name="save" [ngModel]="saveNumber()" (ngModelChange)="saveNumber.set($event)">
              <span>Save this number to the student's record</span></label>
          }
        </div>

        @if (note() && ready()) { <p class="hint warn">{{ note() }}</p> }

        <div class="wa-confirm">
          <p>Sent the receipt to <b>{{ parent() || 'the parent' }}</b>?</p>
          <button type="button" class="btn btn-wa btn-block" [disabled]="saving()" (click)="confirm()">
            {{ saving() ? 'Marking as paid…' : 'Yes, it’s sent — mark as paid' }}</button>
          <p class="hint">Not sent? Close this — nothing is saved and the fee stays unpaid.</p>
        </div>
      </div>
    </aside>
  `,
  styles: [`
    .wa-how{margin:0 0 14px; font-size:14.5px; line-height:1.5}
    .wa-item{display:flex; gap:12px; align-items:flex-start; padding:12px; margin-bottom:12px; border-radius:14px;
      background:#f7faf8; border:1.5px solid #dcefe3; transition:background .2s, border-color .2s}
    .wa-item.done{background:#e3f6ec; border-color:#7fd1a3}
    .wa-n{flex:none; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:#128c4b; color:#fff; font-weight:800; font-size:13px}
    .wa-pic{flex:none; width:96px; min-height:70px; display:grid; place-items:center; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.12)}
    .wa-pic img{width:100%; height:auto; display:block}
    .wa-wait{font-size:12px; color:var(--muted); padding:8px; text-align:center}
    .wa-item-body{flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; align-items:flex-start}
    .wa-item-body.wide textarea{width:100%}
    .wa-item-body b{font-size:15px}
    .wa-copy{min-height:44px; font-size:15px; padding:0 18px}
    .wa-save{font-size:13px; color:var(--muted)}
    .wa-to{margin-bottom:6px}
    .wa-to-row{display:flex; gap:8px}
    .wa-to-row input{flex:1; min-width:0}
    kbd{font:inherit; font-size:12px; font-weight:700; padding:1px 6px; border-radius:5px; background:#fff; border:1px solid #cfd8d3; box-shadow:0 1px 0 #cfd8d3}
  `],
})
export class WhatsAppSend implements OnInit, OnDestroy {
  /** "Kavindu Perera — November 2026" */
  readonly title = input.required<string>();
  readonly parent = input('');
  /** the number on the student's record, as typed there */
  readonly phoneOnFile = input('');
  readonly countryCode = input('94');
  readonly initialMessage = input.required<string>();
  /** file name without the extension */
  readonly fileBase = input.required<string>();
  readonly pdfMeta = input.required<PdfMeta>();
  /** draws the receipt sheet at full size */
  readonly capture = input.required<() => Promise<HTMLCanvasElement>>();
  readonly saving = input(false);

  readonly sent = output<WhatsAppSent>();
  readonly closed = output<void>();

  protected readonly to = signal('');
  protected readonly message = signal('');
  protected readonly saveNumber = signal(false);
  protected readonly note = signal('');
  protected readonly copied = signal<Copied>('');

  protected readonly number = computed(() => waNumber(this.to(), this.countryCode()));
  protected readonly onFile = computed(() => waNumber(this.phoneOnFile(), this.countryCode()));

  // drawn once when the panel opens, so copying is instant
  private canvas: HTMLCanvasElement | null = null;
  private png: Blob | null = null;
  private pdf: Blob | null = null;
  protected readonly ready = signal(false);
  protected readonly pngUrl = signal('');

  ngOnDestroy() {
    if (this.pngUrl()) URL.revokeObjectURL(this.pngUrl());
  }

  ngOnInit() {
    this.to.set(this.phoneOnFile());
    this.message.set(this.initialMessage());
    this.saveNumber.set(!this.onFile());
    this.prepare();
  }

  private async prepare() {
    try {
      this.canvas = await this.capture()();
      [this.png, this.pdf] = await Promise.all([pngBlob(this.canvas), pdfBlob(this.canvas, this.pdfMeta())]);
      this.pngUrl.set(URL.createObjectURL(this.png));
      this.ready.set(true);
    } catch (e) {
      console.error(e);
      this.note.set('Could not draw the receipt. Close this and try again.');
    }
  }

  protected async copyPicture() {
    if (!this.png) return;
    this.note.set('');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': this.png })]);
      this.copied.set('picture');
    } catch {
      this.copied.set('');
      this.note.set('This browser could not copy the picture. Use "Save picture" and attach the file in WhatsApp instead.');
    }
  }

  protected async copyMessage() {
    await this.copyText(this.message().trim(), 'message');
  }

  protected async copyNumber() {
    await this.copyText(this.number() ? prettyWa(this.number()) : this.to().trim(), 'number');
  }

  private async copyText(text: string, what: Copied) {
    this.note.set('');
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(what);
    } catch {
      this.note.set('Could not copy. Select the text and press Ctrl + C.');
    }
  }

  protected async savePicture() {
    if (this.canvas) download(await jpgBlob(this.canvas), this.fileBase() + '.jpg');
  }

  protected savePdf() {
    if (this.pdf) download(this.pdf, this.fileBase() + '.pdf');
  }

  protected confirm() {
    this.sent.emit({ to: this.number(), saveNumber: this.saveNumber() && !!this.number() && this.number() !== this.onFile() });
  }
}
