import {
  Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input,
  signal, viewChild,
} from '@angular/core';
import { AppSettings, Person, Receipt, Session } from '../core/models';
import { border, seal, single, speciesFor } from './flowers';
import { amountWords, initials, money, prettyDate } from './format';
import { paletteFor } from './palette';

/** Files in the app's public folder, used when Settings has no override. */
export const SITE_LOGO = 'logo.png';
export const SITE_SIGNATURE = 'signature.png';

/**
 * Density levels for a receipt that runs long. A5 is a fixed page, so the sheet steps down a
 * notch rather than letting a long note or an extra line spill off the bottom. The level goes
 * on .rc and is mirrored onto the paper, because the flower and border sit outside .rc.
 */
const FIT_LEVELS: [string, string][] = [
  ['rc', 'full'],
  ['rc tight', 'tight'],
  ['rc tight tighter', 'tighter'],
  ['rc tight tighter tightest', 'tightest'],
  ['rc tight tighter tightest squeeze', 'squeeze'],                     // trims the masthead
  ['rc tight tighter tightest squeeze squeeze2', 'squeeze2'],           // two students, everything
  ['rc tight tighter tightest squeeze squeeze2 squeeze3', 'squeeze3'],  // last resort: shrinks the name
];

/** every part of a flower in shades of gold, for the watermark */
const GOLD_FLOWER = {
  p1: '#e7cd8a', p2: '#d4b264', p3: '#c09443', p4: '#f1dfaa', eye: '#a8772a', eyeDark: '#8a6020',
  leaf: '#cfae68', leafDark: '#a8772a', accent: '#b8862b', edge: '#fff6dd',
};

// One stamp for every month: a paid seal is red whatever the sheet is.
const PAID_SEAL = `url("${seal('rgb(197,42,34)')}")`;

/** The A5 receipt itself, exactly as it is exported. */
@Component({
  selector: 'app-receipt-sheet',
  templateUrl: './receipt-sheet.html',
})
export class ReceiptSheet {
  readonly receipt = input.required<Receipt>();
  readonly settings = input.required<AppSettings>();
  readonly sessions = input<Map<string, Session>>(new Map());
  /** the signature after trimming to its ink (see signature.ts); blank until ready */
  readonly signature = input('');

  private wrap = viewChild.required<ElementRef<HTMLElement>>('wrap');
  private paperRef = viewChild.required<ElementRef<HTMLElement>>('paper');
  private injector = inject(Injector);

  protected readonly wrapHeight = signal<number | null>(null);
  private scale = 1;

  protected readonly monthly = computed(() => this.settings().theme !== 'classic');
  protected readonly palette = computed(() => paletteFor(this.receipt().month));
  protected readonly paperVars = computed(() => (this.monthly() ? this.palette().vars : {}));
  protected readonly borderArt = computed(() => border(this.palette().fl, 148, 210));
  protected readonly bloomArt = computed(() => single(this.palette().month, this.palette().fl, 27));
  protected readonly flowerName = computed(() => speciesFor(this.palette().month));
  protected readonly paidSeal = PAID_SEAL;

  /** the month's flower, large and faint behind the fee table: drawn tone on tone in gold, like a pressed emboss */
  protected readonly watermarkArt = computed(() => single(this.palette().month, GOLD_FLOWER, 118));

  protected readonly logoSrc = computed(() => this.settings().logo || SITE_LOGO);
  protected readonly initials = computed(() => initials(this.settings().academyName));
  protected readonly cur = computed(() => this.settings().currency || 'LKR');

  protected readonly contact = computed(() => {
    const s = this.settings();
    return [s.address, s.phone ? 'Tel ' + s.phone : '',
      s.whatsapp && s.whatsapp !== s.phone ? 'WhatsApp ' + s.whatsapp : '', s.email]
      .filter(Boolean).join('  ·  ');
  });

  protected readonly people = computed<Partial<Person>[]>(() => {
    const r = this.receipt();
    return r.people?.length ? r.people : [{
      name: r.student, id: r.studentId, category: r.category, cls: r.cls, day: r.day, time: r.time,
    }];
  });

  /** the labelled grid on the Classic sheet for a single student */
  protected readonly pairs = computed(() => {
    const p = this.people()[0];
    return ([
      ['Student', p.name || '—', true],
      ['Student ID', p.id, false],
      ['Category', p.category, false],
      ['Class', p.cls, false],
      ['Class day & time', [p.day, p.time].filter(Boolean).join(', '), false],
    ] as [string, string | undefined, boolean][]).filter(x => x[1]);
  });

  protected readonly fillers = computed(() =>
    this.monthly() ? [] : Array.from({ length: Math.max(0, 3 - this.receipt().items.length) }));

  protected readonly words = computed(() =>
    amountWords(this.receipt().total, this.settings().currencyWord));

  protected readonly showSignImage = computed(() =>
    this.settings().signStyle === 'image' && !!(this.signature() || this.settings().signature || SITE_SIGNATURE));
  protected readonly signImage = computed(() =>
    this.signature() || this.settings().signature || SITE_SIGNATURE);

  protected readonly money = money;
  protected readonly prettyDate = prettyDate;

  constructor() {
    // Everything that changes the sheet's content re-runs the fitting once Angular has drawn it.
    effect(() => {
      this.receipt();
      this.settings();
      this.signature();
      afterNextRender(() => this.layout(), { injector: this.injector });
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(() => this.fitPaper());
      ro.observe(this.wrap().nativeElement);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected sessionFor(name: string | undefined): Session | null {
    if (!this.monthly()) return null;
    return this.sessions().get(String(name || '').toLowerCase()) ?? null;
  }

  protected readonly NBSP = ' ';

  /** Name, id and category read as one thing (who this is), so they share one line. */
  protected studentMeta(p: Partial<Person>): string {
    return [p.id, p.category].filter(Boolean).join('   ·   ');
  }

  protected personMeta(p: Partial<Person>): string {
    return [p.id, p.category, p.cls, [p.day, p.time].filter(Boolean).join(', ')]
      .filter(Boolean).join('  ·  ');
  }

  /** "Sunday, 5:00 - 6:00 PM" for one child's row */
  protected duoWhen(p: Partial<Person>): string {
    return [p.day, p.time].filter(Boolean).join(', ');
  }

  protected when(): string {
    const r = this.receipt();
    return [r.day, r.time].filter(Boolean).join(', ');
  }

  /** the paper element, for export */
  get paper(): HTMLElement {
    return this.paperRef().nativeElement;
  }

  /** Called after any image on the sheet loads, since the logo changes the masthead height. */
  protected layout() {
    this.autoFit();
    this.fitSignature();
    this.fitPaper();
  }

  private autoFit() {
    const paper = this.paper;
    const rc = paper.querySelector<HTMLElement>('.rc');
    if (!rc) return;
    // The footer has margin-top:auto, so the content box measures full height while it still
    // fits; measure the last block against the bottom padding instead.
    const fits = () => {
      const last = rc.lastElementChild;
      if (!last) return true;
      const padB = parseFloat(getComputedStyle(rc).paddingBottom) || 0;
      return last.getBoundingClientRect().bottom <= rc.getBoundingClientRect().bottom - padB + 0.5;
    };
    for (const [cls, level] of FIT_LEVELS) {
      rc.className = cls;
      paper.dataset['fit'] = level;
      if (fits()) return;
    }
  }

  /** The script signature is set on one line; shrink a long name to fit the rule. */
  private fitSignature() {
    const el = this.paper.querySelector<HTMLElement>('.rc-sigtext');
    if (!el) return;
    el.style.fontSize = '';
    const box = el.parentElement!;
    let pt = parseFloat(getComputedStyle(el).fontSize) * 72 / 96;
    while (pt > 10 && el.getBoundingClientRect().width > box.getBoundingClientRect().width) {
      pt -= 0.5;
      el.style.fontSize = pt.toFixed(1) + 'pt';
    }
  }

  /** Scale the true-size sheet down to the preview column. */
  fitPaper() {
    const wrap = this.wrap().nativeElement, paper = this.paper;
    if (!wrap.clientWidth) return;
    this.scale = Math.min(1, wrap.clientWidth / paper.offsetWidth);
    paper.style.transform = 'scale(' + this.scale + ')';
    this.wrapHeight.set(Math.ceil(paper.offsetHeight * this.scale));
  }
}
