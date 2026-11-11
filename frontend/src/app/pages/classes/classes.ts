import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PoolPicker } from '../registrations/pool-picker';
import { Api, errorMessage } from '../../core/api';
import { Toast } from '../../core/toast';
import { RollApi, coverMessage } from '../../core/roll';
import { PayStatus, Session, Student } from '../../core/models';
import { Store } from '../../core/store';
import { money } from '../../receipt/format';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface Group {
  key: string;
  title: string;
  category: string;
  colour: string;
  symbol: string;
  symbolStyle: string;
  meaning: string;
  family: string;
  day: string;
  time: string;
  max: number | null;
  students: Student[];
  loose?: boolean;
}

interface ClassBlock {
  name: string;
  colour: string;
  fee: string;
  count: number;
  capacity: number;
  groups: Group[];
}

type View = 'class' | 'day';

/**
 * Bird's-eye view of the academy: every class, its sessions and the students in each — by
 * class, or as the weekly timetable.
 */
@Component({
  selector: 'app-classes',
  imports: [NgTemplateOutlet, PoolPicker],
  template: `
    <section class="panel cv" [class]="'panel cv size-' + textSize() + ' cards-' + cardSize()">

      <!-- ============ one tile per class ============ -->
      <div class="cv-tiles" role="group" aria-label="Show a class">
        <button type="button" class="cv-tile all" [class.is-on]="!only()" (click)="only.set('')">
          <span class="cv-tile-ico">✦</span>
          <b>{{ total() }}</b>
          <span class="cv-tile-name">All classes</span>
          <small>{{ sessionCount() }} sessions a week</small>
        </button>
        @for (c of blocks(); track c.name) {
          <button type="button" class="cv-tile" [style.--c]="c.colour" [class.is-on]="only() === c.name"
                  (click)="only.set(only() === c.name ? '' : c.name)">
            <span class="cv-tile-ico">{{ c.name.charAt(0) }}</span>
            <b>{{ c.count }}</b>
            <span class="cv-tile-name">{{ c.name }}</span>
            <small>{{ c.groups.length }} {{ c.groups.length === 1 ? 'group' : 'sessions' }} · {{ c.fee }}</small>
            @if (c.capacity) {
              <i class="cv-tile-bar"><span [style.width.%]="pct(c.count, c.capacity)"></span></i>
            }
          </button>
        }
      </div>

      <!-- ============ tools ============ -->
      <div class="cv-tools">
        <div class="cv-view" role="tablist" aria-label="View">
          <button type="button" role="tab" [class.is-on]="view() === 'class'" (click)="view.set('class')">🎼 By class</button>
          <button type="button" role="tab" [class.is-on]="view() === 'day'" (click)="view.set('day')">🗓️ By day</button>
        </div>
        <input type="search" class="search" placeholder="🔍 Find a student…" [value]="query()"
               (input)="query.set($any($event.target).value)">
        <button type="button" class="cv-pool" (click)="openPool()" title="Children registered online, waiting for a class">🧺 Registration pool</button>
        <label class="cv-toggle"><input type="checkbox" [checked]="showPaid()" (change)="showPaid.set(!showPaid())"><span></span>Payments</label>
        <label class="cv-toggle"><input type="checkbox" [checked]="showInactive()" (change)="showInactive.set(!showInactive())"><span></span>Inactive</label>
        <button type="button" class="cv-adjust-btn" [class.is-on]="adjusting()" (click)="adjusting.set(!adjusting())"
                [attr.aria-expanded]="adjusting()">⚙ View</button>
      </div>

      <!-- ============ how the page looks (remembered on this computer) ============ -->
      @if (adjusting()) {
        <div class="cv-adjust" role="group" aria-label="How the classes are shown">
          <div class="cv-adj"><span>Text size</span>
            <div class="cv-seg">
              <button type="button" [class.is-on]="textSize() === 's'" (click)="textSize.set('s')" title="Smaller">A−</button>
              <button type="button" [class.is-on]="textSize() === 'm'" (click)="textSize.set('m')" title="Normal">A</button>
              <button type="button" [class.is-on]="textSize() === 'l'" (click)="textSize.set('l')" title="Larger">A+</button>
            </div></div>
          <div class="cv-adj"><span>Students</span>
            <div class="cv-seg">
              <button type="button" [class.is-on]="names() === 'all'" (click)="names.set('all')">Show all</button>
              <button type="button" [class.is-on]="names() === 'counts'" (click)="names.set('counts'); clearOpen()">Counts only</button>
            </div></div>
          <div class="cv-adj"><span>Order</span>
            <div class="cv-seg">
              <button type="button" [class.is-on]="order() === 'name'" (click)="order.set('name')">A–Z</button>
              <button type="button" [class.is-on]="order() === 'unpaid'" (click)="order.set('unpaid'); showPaid.set(true)">Unpaid first</button>
            </div></div>
          <div class="cv-adj"><span>Cards</span>
            <div class="cv-seg">
              <button type="button" [class.is-on]="cardSize() === 'narrow'" (click)="cardSize.set('narrow')">Narrow</button>
              <button type="button" [class.is-on]="cardSize() === 'wide'" (click)="cardSize.set('wide')">Wide</button>
            </div></div>
          <div class="cv-adj"><span>Classes</span>
            <div class="cv-seg">
              <button type="button" (click)="expandAll()">Expand all</button>
              <button type="button" (click)="collapseAll()">Collapse all</button>
            </div></div>
          <button type="button" class="cv-adj-reset" (click)="resetView()">Reset</button>
        </div>
      }
      @if (showPaid()) {
        <p class="cv-key">
          <span><i class="d st-paid"></i>Paid</span><span><i class="d st-part"></i>Part paid</span>
          <span><i class="d st-pending"></i>Not paid</span><span><i class="d st-free"></i>Free place</span>
          <span><i class="d st-off"></i>Not due</span>
          <em>{{ monthLabel() }}</em>
        </p>
      }

      <!-- ============ by class ============ -->
      @if (view() === 'class') {
        @for (c of shown(); track c.name) {
          <article class="cv-class" [style.--c]="c.colour" [class.is-collapsed]="collapsed().has(c.name)">
            <header class="cv-class-head">
              <button type="button" class="cv-collapse" (click)="toggleClass(c.name)"
                      [attr.aria-expanded]="!collapsed().has(c.name)"
                      [title]="collapsed().has(c.name) ? 'Show this class' : 'Hide this class'">{{ collapsed().has(c.name) ? '▸' : '▾' }}</button>
              <span class="cv-class-mark">{{ c.name.charAt(0) }}</span>
              <div class="cv-class-title">
                <h2>{{ c.name }}</h2>
                <p>{{ c.groups.length }} {{ c.groups.length === 1 ? 'group' : 'sessions' }} a week</p>
              </div>
              <div class="cv-class-stats">
                <span><b>{{ c.count }}</b>students</span>
                @if (c.capacity) { <span class="free" [class.none]="c.capacity <= c.count"><b>{{ Math.max(0, c.capacity - c.count) }}</b>places free</span> }
                <span class="fee"><b>{{ c.fee.replace(' a month', '').replace(' a term', '') }}</b>{{ c.fee.includes('term') ? 'a term' : c.fee.includes('month') ? 'a month' : '' }}</span>
              </div>
            </header>
            @if (!collapsed().has(c.name)) {
              <div class="cv-grid">
                @for (g of c.groups; track g.key) {
                  <ng-container *ngTemplateOutlet="card; context: { $implicit: g, compact: false }" />
                }
              </div>
            }
          </article>
        } @empty {
          <p class="cv-nothing">No students match “{{ query() }}”.</p>
        }
      }

      <!-- ============ by day: the week ============ -->
      @if (view() === 'day') {
        <div class="cv-week">
          @for (d of week(); track d.day) {
            <section class="cv-day">
              <header class="cv-day-head" [class.today]="d.day === todayName">
                <b>{{ d.day }}</b>
                <small>{{ d.groups.length }} sessions · {{ d.students }} students</small>
                @if (d.day === todayName) { <em>Today</em> }
              </header>
              @for (g of d.groups; track g.key) {
                <ng-container *ngTemplateOutlet="card; context: { $implicit: g, compact: true }" />
              }
            </section>
          } @empty {
            <p class="cv-nothing">No sessions match.</p>
          }
        </div>
      }
    </section>

    <!-- ============ a session ============ -->
    <ng-template #card let-g let-compact="compact">
      <div class="cv-session" [class.is-loose]="g.loose" [class.compact]="compact" [style.--c]="g.colour"
           [class.is-drop]="dropKey() === g.key" [class.is-source]="dragFrom() === g.key"
           (dragover)="dragOver($event, g)" (dragleave)="dragLeave($event, g)" (drop)="drop($event, g)">
        <div class="cv-s-head">
          <span class="cv-sym" [class.italic]="g.symbolStyle === 'italic'">{{ g.symbol || g.title.charAt(0) }}</span>
          <div class="cv-s-title">
            <b>{{ g.title }}</b>
            @if (g.meaning) { <small>{{ g.meaning }}</small> }
          </div>
          @if (compact) { <span class="cv-cat">{{ g.category }}</span> }
          @if (sessionOf(g); as se) {
            <button type="button" class="cv-edit" (click)="editSession(se)" [title]="'Change ' + g.title + ' (day, time, places)'" aria-label="Edit session">✎</button>
          }
        </div>
        @if (g.time || g.day) {
          <!-- the day and time on one strong line: the first thing read on a card -->
          <p class="cv-when">
            @if (!compact && g.day) {
              <span class="cv-wday" [title]="g.day"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>{{ g.day.slice(0, 3) }}</span>
            }
            @if (g.time) {
              <span class="cv-time"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>{{ g.time }}</span>
            }
          </p>
        }
        <div class="cv-cap" [class.over]="g.max !== null && g.students.length > g.max" [class.full]="g.max !== null && g.students.length === g.max">
          <span class="cv-cap-text">
            <b>{{ g.students.length }}</b>{{ g.max !== null ? ' of ' + g.max : '' }} students
            @if (g.max !== null) {
              <em>{{ g.students.length > g.max ? 'Over by ' + (g.students.length - g.max) : g.students.length === g.max ? 'Full' : (g.max - g.students.length) + ' free' }}</em>
            }
          </span>
          @if (g.max) { <i class="cv-cap-bar"><span [style.width.%]="pct(g.students.length, g.max)"></span></i> }
        </div>
        @if (names() === 'counts' && !openGroups().has(g.key) && !hasHit(g)) {
          <!-- counts only: tap to see the names -->
          <button type="button" class="cv-reveal" (click)="toggleGroup(g.key)">
            👥 Show {{ g.students.length }} {{ g.students.length === 1 ? 'student' : 'students' }}
            @if (showPaid() && dueCount(g)) { <em>{{ dueCount(g) }} not paid</em> }
          </button>
        } @else {
          <ol class="cv-names">
            @for (s of ordered(g); track s.id; let i = $index) {
              <li [class]="'st-' + statusClass(s)" [class.is-hit]="hit(s)" [class.is-off]="!s.active"
                  [class.is-dragging]="dragId() === s.id" draggable="true"
                  (dragstart)="dragStart($event, s, g)" (dragend)="dragEnd()"
                  [title]="tip(s) + '\\n\\nDrag to another session to move them, or click for options'" (click)="openMove(s)">
                <span class="grip" aria-hidden="true">⋮⋮</span><span class="n">{{ i + 1 }}</span><span class="nm"><b>{{ firstName(s.name) }}</b>@if (otherNames(s.name); as rest) {{{ " " }}<span class="rest">{{ rest }}</span>}</span>
                @if (payLabel(s); as pl) { <i class="pay">{{ pl }}</i> }
              </li>
            } @empty {
              @if (!g.max) { <li class="cv-empty">No students yet</li> }
            }
            <!-- the empty places, as one row -->
            @if (freeSlots(g).length; as free) {
              <li class="cv-free" [class.can-fill]="canFill(g)" (click)="fillFree(g)" [attr.title]="canFill(g) ? 'Add a child from the registration pool' : null">
                <i class="seat">＋</i><span class="nm">{{ free }} free {{ free === 1 ? 'place' : 'places' }}</span>
                @if (canFill(g)) { <span class="cv-free-add">Add from pool</span> }
              </li>
            }
          </ol>
          @if (names() === 'counts' && openGroups().has(g.key)) {
            <button type="button" class="cv-reveal close" (click)="toggleGroup(g.key)">Hide names</button>
          }
        }
        @if (dragId() && dropKey() === g.key) { <p class="cv-drophint">Drop to move here</p> }
      </div>
    </ng-template>

    <!-- ============ fill a free place from the registration pool ============ -->
    @if (filling(); as fs) {
      <app-pool-picker [session]="fs" (closed)="filling.set(null)" />
    }

    <!-- ============ change a session: day, time, places ============ -->
    @if (sessionEdit(); as se) {
      <div class="sheet-backdrop" (click)="sessionEdit.set(null)"></div>
      <aside class="sheet small cv-edit-sheet" role="dialog" aria-modal="true" aria-label="Edit session">
        <header class="sheet-head">
          <div><h2>✎ {{ se.name }}</h2><small>{{ se.category }} · its students move with it</small></div>
          <button type="button" class="btn-icon" (click)="sessionEdit.set(null)" aria-label="Close">✕</button>
        </header>
        <div class="sheet-body">
          <label class="field"><span>Name</span>
            <input type="text" maxlength="60" [value]="se.rename" (input)="patchEdit({ rename: $any($event.target).value })"></label>
          <div class="cv-edit-grid">
            <label class="field"><span>Day</span>
              <select [value]="se.day" (change)="patchEdit({ day: $any($event.target).value })">
                @for (d of days; track d) { <option [value]="d" [selected]="d === se.day">{{ d }}</option> }
              </select></label>
            <label class="field"><span>Time</span>
              <input type="text" maxlength="40" placeholder="3:30 - 4:30 PM" [value]="se.time" (input)="patchEdit({ time: $any($event.target).value })"></label>
            <label class="field"><span>Places <em>(blank = no limit)</em></span>
              <input type="number" min="0" max="200" [value]="se.max ?? ''" (input)="patchEdit({ max: $any($event.target).value })"></label>
          </div>
          <label class="field"><span>Meaning <em>(optional)</em></span>
            <input type="text" maxlength="80" placeholder="e.g. loud and strong" [value]="se.meaning" (input)="patchEdit({ meaning: $any($event.target).value })"></label>
          <footer class="sheet-foot">
            <button type="button" class="btn btn-ghost" (click)="sessionEdit.set(null)">Cancel</button>
            <span class="spacer"></span>
            <button type="button" class="btn" [disabled]="busy()" (click)="saveSession()">{{ busy() ? 'Saving…' : 'Save' }}</button>
          </footer>
        </div>
      </aside>
    }

    <!-- ============ move a student (tap a name; the way on a phone) ============ -->
    @if (moving(); as m) {
      <div class="sheet-backdrop" (click)="moving.set(null)"></div>
      <aside class="sheet small cv-move" role="dialog" aria-modal="true" aria-label="Move student">
        <header class="sheet-head">
          <div><h2>{{ m.name }}</h2><small>{{ m.category }}{{ m.session ? ' · ' + m.session : '' }} · {{ m.id }}</small></div>
          <button type="button" class="btn-icon" (click)="moving.set(null)" aria-label="Close">✕</button>
        </header>
        <div class="sheet-body">
          @if (confirmMsg(); as cm) {
            <!-- booked: the message for the parent -->
            <div class="cv-done">
              <p class="cv-done-head">✅ Cover-up booked</p>
              <label class="field"><span>Message to {{ m.parent || 'the parent' }}@if (m.phone) { <em>· {{ m.phone }}</em> }</span>
                <textarea rows="11" [value]="cm" (input)="confirmMsg.set($any($event.target).value)"></textarea></label>
              <div class="cv-done-act">
                <button type="button" class="btn btn-wa" (click)="copyMsg(cm)">📋 Copy message</button>
                <span class="spacer"></span>
                <button type="button" class="btn btn-ghost" (click)="moving.set(null)">Done</button>
              </div>
              @if (!m.phone) { <p class="hint warn">No WhatsApp number on file for {{ m.name.split(' ')[0] }} — WhatsApp will ask you to pick the chat. Add the number on the Students page.</p> }
            </div>
          } @else {
          <div class="cv-mode" role="tablist">
            <button type="button" role="tab" [class.is-on]="mode() === 'cover'" [disabled]="!m.session" (click)="mode.set('cover')">↻ Cover-up class</button>
            <button type="button" role="tab" [class.is-on]="mode() === 'move'" (click)="mode.set('move')">⇄ Move for good</button>
          </div>

          @if (mode() === 'cover' && m.session) {
            <!-- a one-off cover-up: misses one class, comes to another session that day -->
            <p class="cv-move-lead">For a parent asking for a cover-up: pick the class {{ m.name.split(' ')[0] }} will <b>miss</b>,
              then the class they will <b>come to</b> instead. When they are marked there, the missed class is marked made up.</p>
            <h3 class="cv-step">1 · Misses {{ m.session }} on</h3>
            <div class="cv-dates">
              @for (dt of missDates(); track dt.iso) {
                <button type="button" class="cv-date" [class.is-on]="missDate() === dt.iso" [class.past]="dt.past" (click)="missDate.set(dt.iso)">
                  <b>{{ dt.day }}</b><span>{{ dt.label }}</span>@if (dt.today) { <i>today</i> }
                </button>
              }
            </div>
            <label class="field cv-reason"><span>Reason <em>(optional)</em></span>
              <input type="text" maxlength="200" placeholder="e.g. school exam, family trip" [value]="reason()" (input)="reason.set($any($event.target).value)"></label>
            <h3 class="cv-step">2 · Comes instead to
              <label class="cv-all"><input type="checkbox" [checked]="coverAll()" (change)="coverAll.set(!coverAll())"> other classes too</label>
            </h3>
            <div class="cv-move-list">
              @for (o of coverOptions(); track o.session.name + o.date) {
                <button type="button" class="cv-move-opt" [style.--c]="store.colour(o.session.category)" [disabled]="busy()" (click)="bookCover(m, o)">
                  <span class="cv-odate"><b>{{ o.dayShort }}</b>{{ o.label }}</span>
                  <span class="cv-move-text"><b>{{ o.session.name }}</b><small>{{ o.session.category }} · {{ o.session.time }}</small></span>
                  <span class="cv-move-cap" [class.full]="o.free !== null && o.free <= 0">{{ o.free === null ? '' : o.free <= 0 ? 'Full' : o.free + ' free' }}</span>
                </button>
              } @empty {
                <p class="hint">No other {{ m.category }} sessions. Tick “other classes too”.</p>
              }
            </div>
          }

          @if (mode() === 'move' || !m.session) {
          <p class="cv-move-lead">Move to another session for good — their class, day, time and fee follow it.</p>
          @for (b of moveTargets(); track b.name) {
            <h3 class="cv-move-class" [style.--c]="b.colour">{{ b.name }} <small>{{ b.fee }}</small></h3>
            <div class="cv-move-list">
              @for (g of b.groups; track g.key) {
                <button type="button" class="cv-move-opt" [style.--c]="b.colour" [class.current]="isCurrent(m, g)"
                        [disabled]="isCurrent(m, g) || busy()" (click)="move(m, g)">
                  <span class="cv-sym" [class.italic]="g.symbolStyle === 'italic'">{{ g.symbol || g.title.charAt(0) }}</span>
                  <span class="cv-move-text"><b>{{ g.title }}</b><small>{{ whenOf(g) }}</small></span>
                  <span class="cv-move-cap" [class.full]="g.max !== null && g.students.length >= g.max">
                    {{ isCurrent(m, g) ? 'Now here' : g.max !== null ? (g.students.length >= g.max ? 'Full' : (g.max - g.students.length) + ' free') : g.students.length + ' students' }}
                  </span>
                </button>
              }
            </div>
          }
          }
          }
          <footer class="sheet-foot">
            <button type="button" class="btn btn-ghost" (click)="openStudent(m)">Open on the Students page</button>
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="moving.set(null)">Close</button>
          </footer>
        </div>
      </aside>
    }
  `,
  styles: `
    .cv{display:flex; flex-direction:column; gap:16px}

    /* ---- class tiles ---- */
    .cv-tiles{display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:12px}
    .cv-tile{
      --c:#3a1238; position:relative; overflow:hidden; text-align:left; cursor:pointer;
      display:flex; flex-direction:column; gap:2px; padding:14px 16px 16px; border-radius:20px;
      background:#fff; border:1.5px solid color-mix(in srgb, var(--c) 18%, #fff); color:#2d1430; font:inherit;
      box-shadow:0 6px 18px color-mix(in srgb, var(--c) 10%, transparent); transition:transform .15s, box-shadow .15s;
    }
    .cv-tile:hover{transform:translateY(-2px); box-shadow:0 12px 26px color-mix(in srgb, var(--c) 18%, transparent)}
    .cv-tile::after{content:''; position:absolute; right:-24px; top:-24px; width:90px; height:90px; border-radius:50%;
      background:color-mix(in srgb, var(--c) 10%, transparent)}
    .cv-tile-ico{width:34px; height:34px; border-radius:11px; display:grid; place-items:center; margin-bottom:6px;
      background:var(--c); color:#fff; font-weight:800; font-size:16px; box-shadow:0 6px 12px color-mix(in srgb, var(--c) 35%, transparent)}
    .cv-tile b{font-size:30px; line-height:1; font-variant-numeric:tabular-nums}
    .cv-tile-name{font-family:var(--f-display); font-size:17px; font-weight:700; letter-spacing:.4px}
    .cv-tile small{font-size:11.5px; color:var(--muted)}
    .cv-tile-bar{display:block; height:5px; margin-top:8px; border-radius:5px; background:color-mix(in srgb, var(--c) 12%, #fff); overflow:hidden}
    .cv-tile-bar span{display:block; height:100%; background:var(--c); border-radius:5px}
    .cv-tile.all{--c:#74204f}
    .cv-tile.is-on{background:linear-gradient(140deg, var(--c), color-mix(in srgb, var(--c) 65%, #2a0f3c)); color:#fff; border-color:transparent}
    .cv-tile.is-on small{color:rgba(255,255,255,.8)}
    .cv-tile.is-on .cv-tile-ico{background:rgba(255,255,255,.22); box-shadow:none}
    .cv-tile.is-on::after{background:rgba(255,255,255,.08)}
    .cv-tile.is-on .cv-tile-bar{background:rgba(255,255,255,.25)}
    .cv-tile.is-on .cv-tile-bar span{background:#fff}

    /* ---- tools ---- */
    .cv-tools{display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; padding:10px 12px; border-radius:18px;
      background:#fff; border:1px solid #ece5f0; box-shadow:0 4px 14px rgba(58,18,56,.05)}
    .cv-view{display:flex; gap:4px; padding:4px; border-radius:14px; background:#f4eff7}
    .cv-view button{border:0; cursor:pointer; padding:8px 14px; border-radius:10px; background:none; font:inherit; font-size:14px; font-weight:700; color:#6f5a76; min-height:40px}
    .cv-view button.is-on{background:#fff; color:#3a1238; box-shadow:0 3px 10px rgba(58,18,56,.12)}
    .cv-tools .search{flex:1 1 200px; min-width:0}
    .cv-toggle{display:inline-flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600; color:#5b4660; cursor:pointer}
    .cv-toggle input{display:none}
    .cv-toggle span{width:36px; height:20px; border-radius:20px; background:#ddd3e2; position:relative; transition:background .15s}
    .cv-toggle span::after{content:''; position:absolute; left:2px; top:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 3px rgba(0,0,0,.2)}
    .cv-toggle input:checked + span{background:#74204f}
    .cv-toggle input:checked + span::after{left:18px}
    .cv-key{display:flex; flex-wrap:wrap; gap:6px 16px; margin:-6px 4px 0; font-size:12.5px; color:var(--muted)}
    .cv-key span{display:inline-flex; align-items:center; gap:6px}
    .cv-key em{margin-left:auto; font-style:normal; font-weight:700; color:#6d1f3e}

    /* payment dots */
    i.d{flex:none; width:9px; height:9px; border-radius:50%; background:var(--dot, transparent)}
    .st-paid{--dot:#1fa463} .st-part{--dot:#f0a020} .st-pending{--dot:#e5484d}
    .st-free{--dot:#3567e8} .st-off{--dot:#b8b2bb} .st-none{--dot:transparent}

    /* ---- by class ---- */
    .cv-class{--c:#6d1f3e; border-radius:24px; background:#fff; overflow:hidden;
      border:1px solid color-mix(in srgb, var(--c) 20%, #fff); box-shadow:0 14px 34px color-mix(in srgb, var(--c) 12%, transparent)}
    .cv-class-head{display:flex; flex-wrap:wrap; align-items:center; gap:14px 18px; padding:18px 22px; color:#fff;
      background:radial-gradient(300px 160px at 100% 0%, rgba(255,255,255,.18), transparent 70%),
                 linear-gradient(120deg, var(--c), color-mix(in srgb, var(--c) 62%, #2a0f3c))}
    .cv-class-mark{flex:none; width:56px; height:56px; border-radius:18px; display:grid; place-items:center;
      background:rgba(255,255,255,.95); color:var(--c); font-family:var(--f-display); font-size:28px; font-weight:800}
    .cv-class-title{flex:1; min-width:140px}
    .cv-class-title h2{margin:0; font-family:var(--f-display); font-size:28px; letter-spacing:1px; line-height:1.1}
    .cv-class-title p{margin:2px 0 0; font-size:13.5px; opacity:.85}
    .cv-class-stats{display:flex; gap:10px; flex-wrap:wrap}
    .cv-class-stats span{display:flex; flex-direction:column; align-items:center; min-width:78px; padding:8px 12px; border-radius:14px;
      background:rgba(255,255,255,.16); font-size:11.5px; text-transform:uppercase; letter-spacing:.6px; line-height:1.2}
    .cv-class-stats b{font-size:21px; letter-spacing:0; text-transform:none; font-variant-numeric:tabular-nums}
    .cv-class-stats .fee b{font-size:16px; padding:3px 0}
    .cv-class-stats .free{background:#d9f7e8; color:#047857; box-shadow:0 4px 12px rgba(4,120,87,.25)}
    .cv-class-stats .free.none{background:rgba(255,255,255,.16); color:#fff; box-shadow:none}
    .cv-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:16px; padding:18px;
      background:color-mix(in srgb, var(--c) 4%, #fff)}

    /* ---- a session ---- */
    .cv-session{--c:#6d1f3e; background:#fff; border-radius:18px; padding:16px; display:flex; flex-direction:column; gap:10px;
      border:1px solid color-mix(in srgb, var(--c) 16%, #fff); box-shadow:0 6px 16px rgba(58,18,56,.05); position:relative; overflow:hidden}
    .cv-session::before{content:''; position:absolute; left:0; top:0; right:0; height:5px; background:var(--c)}
    .cv-session.is-loose{background:#fffbf3; border-style:dashed}
    .cv-session.is-loose::before{background:repeating-linear-gradient(90deg, var(--c) 0 10px, transparent 10px 16px)}
    .cv-s-head{display:flex; align-items:center; gap:12px; margin-top:2px}
    .cv-sym{flex:none; min-width:48px; height:48px; padding:0 6px; border-radius:15px; display:grid; place-items:center;
      background:linear-gradient(140deg, var(--c), color-mix(in srgb, var(--c) 65%, #2a0f3c)); color:#fff;
      font:700 19px Georgia, serif; box-shadow:0 8px 16px color-mix(in srgb, var(--c) 30%, transparent)}
    .cv-sym.italic{font-style:italic}
    .cv-s-title{flex:1; min-width:0; line-height:1.25}
    .cv-s-title b{display:block; font-family:var(--f-display); font-size:20px; letter-spacing:.5px; color:color-mix(in srgb, var(--c) 72%, #1d1b1e)}
    .cv-s-title small{color:var(--muted); font-size:12.5px; font-style:italic}
    .cv-cat{flex:none; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.8px; padding:4px 9px; border-radius:999px;
      background:color-mix(in srgb, var(--c) 12%, #fff); color:color-mix(in srgb, var(--c) 80%, #000)}
    /* the day and time: big, bold pills, the first thing read on a card */
    .cv-when{display:flex; flex-wrap:wrap; gap:8px; margin:2px 0 0}
    .cv-when span{display:inline-flex; align-items:center; gap:8px; padding:8px 14px; border-radius:12px;
      font-family:'Segoe UI', Roboto, system-ui, sans-serif; font-weight:800; line-height:1; font-variant-numeric:tabular-nums}
    .cv-when svg{flex:none; width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round}
    /* the day: solid, in the class colour */
    .cv-when .cv-wday{background:var(--c); color:#fff; font-size:15px; letter-spacing:1.2px; text-transform:uppercase;
      box-shadow:0 4px 10px color-mix(in srgb, var(--c) 30%, transparent)}
    /* the time: the darkest, largest text on the card */
    .cv-when .cv-time{background:#fff; color:#1d1b1e; font-size:18px; letter-spacing:.2px; border:2px solid color-mix(in srgb, var(--c) 45%, #fff)}
    .cv-when .cv-time svg{color:var(--c)}
    .cv-session.compact .cv-when .cv-time{font-size:17px; padding:7px 12px}
    .cv-cap{display:flex; flex-direction:column; gap:5px; padding:10px 12px; border-radius:12px; background:color-mix(in srgb, var(--c) 6%, #fff)}
    .cv-cap-text{display:flex; align-items:baseline; gap:4px; font-size:13px; color:#5b4660}
    .cv-cap-text b{font-size:17px; color:#2d1430}
    /* free places: always the same fresh green, whatever the class colour */
    .cv-cap-text em{margin-left:auto; font-style:normal; font-weight:800; font-size:12px; padding:3px 10px; border-radius:999px;
      background:#d9f7e8; color:#047857; box-shadow:inset 0 0 0 1px #9fe3c3}
    .cv-cap.full .cv-cap-text em{background:#fff1d6; color:#8a5300; box-shadow:inset 0 0 0 1px #f3d39a}
    .cv-cap.over .cv-cap-text em{background:#fde3e3; color:#b3261e; box-shadow:inset 0 0 0 1px #f5b5b5}
    .cv-cap-bar{display:block; height:7px; border-radius:7px; overflow:hidden;
      background:repeating-linear-gradient(135deg, #c9f1dc 0 6px, #e8faf1 6px 12px)}
    .cv-names li.cv-free.can-fill{cursor:pointer}
    .cv-names li.cv-free.can-fill:hover{background:#dcf7ea !important; border-style:solid}
    .cv-names li.cv-free.can-fill:hover .nm::after{content:" — add from the pool"; font-style:normal; font-weight:700}
    .cv-pool{border:0; cursor:pointer; font:inherit; font-weight:800; font-size:14px; color:#fff; padding:0 16px; min-height:42px; border-radius:12px;
      background:linear-gradient(135deg, #f472b6, #a21caf); box-shadow:0 6px 14px rgba(162,28,175,.25); white-space:nowrap}
    .cv-names li.cv-free{cursor:default; background:#f0fbf5 !important; border:1.5px dashed #8fdcb5; color:#047857; font-style:italic; font-weight:600}
    .cv-names li.cv-free .n{color:#34b07a}
    .cv-names li.cv-free .seat{flex:none; font-style:normal; width:22px; height:22px; border-radius:50%; display:grid; place-items:center;
      background:#10b981; color:#fff; font-size:13px; font-weight:800}
    .cv-names li.cv-free + li.cv-free{margin-top:2px}
    .cv-cap-bar span{display:block; height:100%; border-radius:6px; background:var(--c)}
    .cv-cap.over .cv-cap-bar span{background:#e5484d}

    .cv-names{list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr; gap:2px}
    .cv-names li{display:flex; align-items:center; gap:10px; padding:7px 8px; border-radius:10px; cursor:pointer; font-size:14px; color:#2d1430; transition:background .12s}
    .cv-names li:nth-child(odd){background:#faf7fc}
    .cv-names li:hover{background:color-mix(in srgb, var(--c) 10%, #fff)}
    .cv-names .n{flex:none; width:22px; text-align:right; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums}
    .cv-names .nm{flex:1; min-width:0}
    .cv-names li.is-off .nm{opacity:.5; text-decoration:line-through}
    .cv-names li.is-hit{background:#fff3c4 !important; box-shadow:inset 3px 0 0 #f0a020}
    .cv-names li.cv-empty{cursor:default; color:var(--muted); justify-content:center; font-style:italic; background:none}

    /* ---- by day ---- */
    .cv-week{display:grid; grid-template-columns:repeat(auto-fit, minmax(205px, 1fr)); gap:14px; align-items:start}
    .cv-day{display:flex; flex-direction:column; gap:12px}
    .cv-day-head{display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 10px; padding:12px 16px; border-radius:16px;
      background:linear-gradient(120deg, #3a1238, #74204f); color:#fff; box-shadow:0 8px 20px rgba(58,18,56,.2)}
    .cv-day-head b{font-family:var(--f-display); font-size:20px; letter-spacing:.8px}
    .cv-day-head small{font-size:12.5px; opacity:.8}
    .cv-day-head em{margin-left:auto; font-style:normal; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:1px;
      padding:3px 9px; border-radius:999px; background:#fff; color:#74204f}
    .cv-day-head.today{background:linear-gradient(120deg, #d6336c, #7c3aed)}
    .cv-session.compact{padding:14px; gap:8px}
    .cv-session.compact .cv-sym{min-width:40px; height:40px; font-size:16px; border-radius:12px}
    .cv-session.compact .cv-s-title b{font-size:17px}
    .cv-session.compact .cv-names li{padding:5px 6px; font-size:13.5px}

    .cv-nothing{text-align:center; color:var(--muted); padding:30px}

    /* ---- moving students ---- */
    .cv-names li{user-select:none}
    .cv-names li[draggable=true]{cursor:grab}
    .cv-names li[draggable=true]:active{cursor:grabbing}
    .cv-names .grip{flex:none; width:10px; font-size:11px; line-height:1; letter-spacing:-2px; color:#c9bccf; opacity:0; transition:opacity .12s}
    .cv-names li:hover .grip{opacity:1}
    .cv-names li.is-dragging{opacity:.4; background:#f1ecf4 !important}
    .cv-session.is-source{opacity:.85}
    .cv-session.is-drop{outline:3px dashed var(--c); outline-offset:3px; background:color-mix(in srgb, var(--c) 7%, #fff);
      box-shadow:0 14px 34px color-mix(in srgb, var(--c) 28%, transparent); transform:translateY(-2px)}
    .cv-session{transition:transform .12s, box-shadow .12s, background .12s}
    .cv-drophint{margin:0; padding:10px; border-radius:12px; text-align:center; font-weight:800; font-size:13px;
      background:var(--c); color:#fff; animation:cv-pop .2s ease-out}
    @keyframes cv-pop{from{transform:scale(.95); opacity:0} to{transform:none; opacity:1}}

    .cv-move-lead{margin:0 0 6px; font-size:13.5px; color:var(--muted); line-height:1.5}
    .cv-done-head{margin:0 0 10px; padding:10px 14px; border-radius:12px; background:#e3f6ec; color:#0b6b3f; font-weight:800; font-size:15px}
    .cv-done textarea{width:100%; font:inherit; font-size:15px; line-height:1.5; resize:vertical}
    .cv-done-act{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px}
    .cv-done-act .btn-wa{min-height:46px; text-decoration:none}
    .cv-mode{display:grid; grid-template-columns:1fr 1fr; gap:6px; padding:5px; margin-bottom:12px; border-radius:14px; background:#f4eff7}
    .cv-mode button{border:0; cursor:pointer; min-height:42px; border-radius:10px; background:none; font:inherit; font-size:14px; font-weight:800; color:#6f5a76}
    .cv-mode button.is-on{background:#fff; color:#5b21b6; box-shadow:0 3px 10px rgba(58,18,56,.12)}
    .cv-mode button:disabled{opacity:.4; cursor:not-allowed}
    .cv-step{display:flex; align-items:center; gap:10px; margin:14px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.8px; color:#5b21b6}
    .cv-all{margin-left:auto; display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; text-transform:none; letter-spacing:0; color:var(--muted); cursor:pointer}
    .cv-dates{display:flex; gap:6px; flex-wrap:wrap}
    .cv-date{display:flex; flex-direction:column; align-items:center; min-width:64px; padding:7px 8px; border-radius:12px; cursor:pointer;
      border:1.5px solid #e3d6ec; background:#fff; font:inherit; color:#3a1238; line-height:1.2}
    .cv-date b{font-size:12px; text-transform:uppercase; color:var(--muted)}
    .cv-date span{font-size:14px; font-weight:800}
    .cv-date i{font-style:normal; font-size:10px; font-weight:800; color:#d6336c; text-transform:uppercase}
    .cv-date.past{opacity:.55}
    .cv-date.is-on{background:#7c3aed; border-color:#7c3aed; color:#fff; opacity:1}
    .cv-date.is-on b, .cv-date.is-on i{color:rgba(255,255,255,.85)}
    .cv-reason{margin-top:12px}
    .cv-odate{flex:none; width:54px; display:flex; flex-direction:column; align-items:center; font-size:12px; color:var(--muted); line-height:1.15}
    .cv-odate b{font-size:14px; text-transform:uppercase; color:var(--c)}
    .cv-move-cap:empty{display:none}
    .cv-move-class{--c:#8e2b52; display:flex; align-items:baseline; gap:8px; margin:14px 0 6px; font-family:var(--f-display); font-size:17px;
      color:color-mix(in srgb, var(--c) 75%, #1d1b1e); letter-spacing:.5px}
    .cv-move-class small{font-family:var(--f-body, inherit); font-size:12px; font-weight:600; color:var(--muted); letter-spacing:0}
    .cv-move-list{display:flex; flex-direction:column; gap:6px}
    .cv-move-opt{--c:#8e2b52; display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; min-height:54px; border-radius:14px; cursor:pointer;
      border:1.5px solid color-mix(in srgb, var(--c) 22%, #fff); background:#fff; font:inherit; text-align:left; color:#2d1430}
    .cv-move-opt:hover:not(:disabled){background:color-mix(in srgb, var(--c) 8%, #fff); border-color:var(--c)}
    .cv-move-opt .cv-sym{min-width:38px; height:38px; font-size:14px; border-radius:11px}
    .cv-move-opt.current{background:color-mix(in srgb, var(--c) 10%, #fff); border-style:dashed; cursor:default; opacity:1}
    .cv-move-text{flex:1; min-width:0; display:flex; flex-direction:column; line-height:1.25}
    .cv-move-text b{font-size:15px}
    .cv-move-text small{font-size:12px; color:var(--muted)}
    .cv-move-cap{flex:none; font-size:12px; font-weight:800; padding:3px 9px; border-radius:999px; background:#d9f7e8; color:#047857}
    .cv-move-cap.full{background:#fff1d6; color:#8a5300}
    .cv-move-opt.current .cv-move-cap{background:var(--c); color:#fff}

    @media (min-width:1200px){
      .cv-grid .cv-names{grid-template-columns:1fr}
    }
    @media (max-width:720px){
      /* a strip to swipe through, so the sessions are on the first screen */
      .cv-tiles{display:flex; gap:10px; overflow-x:auto; margin:0 -12px; padding:2px 12px 8px; scroll-snap-type:x proximity}
      .cv-tile{flex:0 0 128px; scroll-snap-align:start; padding:10px 12px 12px; border-radius:16px}
      .cv-tile-ico{width:28px; height:28px; font-size:13px; border-radius:9px; margin-bottom:4px}
      .cv-tile b{font-size:24px}
      .cv-tile-name{font-size:15px}
      .cv-tile small{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
      .cv-tools{padding:10px}
      .cv-view{flex:1 1 100%}
      .cv-view button{flex:1}
      .cv-class-head{padding:16px}
      .cv-class-title h2{font-size:23px}
      .cv-class-stats{width:100%}
      .cv-class-stats span{flex:1; min-width:0}
      .cv-grid{grid-template-columns:1fr; padding:12px; gap:12px}
      .cv-names li{font-size:15px; padding:9px 8px}
      .cv-key em{margin-left:0; flex-basis:100%}
    }

    /* =========================================================
       Clearer, and set up the way the office likes
       ========================================================= */

    /* the class tiles fill one row */
    .cv-tiles{grid-template-columns:repeat(auto-fit, minmax(140px, 1fr))}

    /* ---- the View panel ---- */
    .cv-adjust-btn{border:1px solid #e3d6ec; background:#fff; cursor:pointer; font:inherit; font-size:14px; font-weight:800; color:#5b21b6;
      min-height:40px; padding:0 14px; border-radius:12px}
    .cv-adjust-btn.is-on{background:#5b21b6; border-color:#5b21b6; color:#fff}
    .cv-adjust{display:flex; flex-wrap:wrap; align-items:flex-end; gap:12px 18px; margin-top:-6px; padding:14px 16px; border-radius:18px;
      background:linear-gradient(180deg, #faf7fd, #fff); border:1px solid #e9def0; box-shadow:0 6px 18px rgba(91,33,182,.07)}
    .cv-adj{display:flex; flex-direction:column; gap:5px}
    .cv-adj > span{font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.8px; color:#8a7590}
    .cv-seg{display:flex; gap:3px; padding:3px; border-radius:12px; background:#f1ebf6}
    .cv-seg button{border:0; cursor:pointer; min-height:34px; padding:0 12px; border-radius:9px; background:none; font:inherit;
      font-size:13.5px; font-weight:700; color:#6f5a76; white-space:nowrap}
    .cv-seg button.is-on{background:#fff; color:#3a1238; box-shadow:0 2px 8px rgba(58,18,56,.14)}
    .cv-seg button:active{transform:scale(.97)}
    .cv-adj-reset{margin-left:auto; border:0; background:none; cursor:pointer; font:inherit; font-size:13px; font-weight:700;
      color:#8a7590; text-decoration:underline; min-height:34px}

    /* ---- collapsing a class ---- */
    .cv-collapse{flex:none; width:36px; height:36px; border-radius:11px; border:1px solid rgba(255,255,255,.35); cursor:pointer;
      background:rgba(255,255,255,.14); color:#fff; font-size:16px; line-height:1}
    .cv-collapse:hover{background:rgba(255,255,255,.26)}
    .cv-class.is-collapsed{box-shadow:0 6px 16px color-mix(in srgb, var(--c) 10%, transparent)}

    /* ---- a session: edit, day and time on one line ---- */
    .cv-edit{flex:none; width:34px; height:34px; border-radius:10px; cursor:pointer; font-size:15px; line-height:1;
      border:1px solid color-mix(in srgb, var(--c) 25%, #fff); background:#fff; color:color-mix(in srgb, var(--c) 80%, #1d1b1e)}
    .cv-edit:hover{background:color-mix(in srgb, var(--c) 10%, #fff)}
    .cv-when{gap:6px}
    .cv-when span{padding:7px 12px}
    .cv-when .cv-wday{font-size:13.5px}
    .cv-when .cv-time{font-size:16px}

    /* ---- the payment, in a word ---- */
    .cv-names li i.pay{flex:none; font-style:normal; font-size:11px; font-weight:800; letter-spacing:.3px; padding:2px 8px; border-radius:999px;
      background:color-mix(in srgb, var(--dot) 14%, #fff); color:color-mix(in srgb, var(--dot) 80%, #1d1b1e);
      border:1px solid color-mix(in srgb, var(--dot) 35%, #fff)}
    .cv-names li.st-pending{box-shadow:inset 3px 0 0 #e5484d}
    .cv-names li.st-part{box-shadow:inset 3px 0 0 #f0a020}
    .cv-names .nm{line-height:1.3}

    /* ---- the free places, as one row ---- */
    .cv-names li.cv-free{gap:10px; font-style:normal}
    .cv-names li.cv-free .nm{font-weight:700}
    .cv-free-add{margin-left:auto; font-size:12px; font-weight:800; color:#047857; text-decoration:underline}
    .cv-names li.cv-free.can-fill:hover .nm::after{content:none}

    /* ---- counts only ---- */
    .cv-reveal{display:flex; align-items:center; justify-content:center; gap:8px; width:100%; min-height:44px; border-radius:12px; cursor:pointer;
      border:1.5px dashed color-mix(in srgb, var(--c) 35%, #fff); background:color-mix(in srgb, var(--c) 5%, #fff);
      font:inherit; font-size:14px; font-weight:800; color:color-mix(in srgb, var(--c) 80%, #1d1b1e)}
    .cv-reveal em{font-style:normal; font-size:12px; padding:2px 8px; border-radius:999px; background:#fde3e3; color:#b3261e}
    .cv-reveal.close{min-height:34px; border-style:solid; font-size:12.5px; font-weight:700}

    /* ---- text size ---- */
    .cv.size-s .cv-names li{font-size:12.5px; padding:5px 7px}
    .cv.size-s .cv-s-title b{font-size:17px}
    .cv.size-s .cv-when .cv-time{font-size:14px}
    .cv.size-l .cv-names li{font-size:16.5px; padding:10px 9px}
    .cv.size-l .cv-names .n{font-size:13.5px; width:26px}
    .cv.size-l .cv-names li i.pay{font-size:12.5px; padding:3px 10px}
    .cv.size-l .cv-s-title b{font-size:23px}
    .cv.size-l .cv-s-title small{font-size:14px}
    .cv.size-l .cv-when .cv-time{font-size:19px}
    .cv.size-l .cv-when .cv-wday{font-size:15px}
    .cv.size-l .cv-cap-text{font-size:14.5px}

    /* ---- card width ---- */
    .cv.cards-wide .cv-grid{grid-template-columns:repeat(auto-fill, minmax(400px, 1fr))}
    .cv.cards-wide .cv-names{grid-template-columns:1fr 1fr; column-gap:8px}
    .cv.cards-wide .cv-names li.cv-free, .cv.cards-wide .cv-names li.cv-empty{grid-column:1 / -1}

    /* names never push past the card: the list column may shrink */
    .cv-names{grid-template-columns:minmax(0, 1fr)}
    .cv.cards-wide .cv-names{grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)}
    .cv-names li{min-width:0}
    /* day and time as one joined pill on one line */
    .cv-when{flex-wrap:wrap; gap:0; row-gap:6px}
    .cv-when span{padding:7px 10px}
    .cv-when .cv-time{font-size:15px; letter-spacing:0}
    .cv-when .cv-time svg, .cv-when .cv-wday svg{width:16px; height:16px}
    .cv-session:not(.compact) .cv-when .cv-time svg{display:none}
    .cv-when .cv-wday{border-radius:12px 0 0 12px; letter-spacing:1.5px}
    .cv-when .cv-time{border-radius:0 12px 12px 0; border-left:0; white-space:nowrap}
    .cv-when .cv-time:only-child{border-radius:12px; border-left:2px solid color-mix(in srgb, var(--c) 45%, #fff)}

    /* ---- names, readable at a glance ---- */
    .cv-names{gap:3px}
    .cv-names li{font-size:16px; padding:9px 10px; color:#1d1b1e; line-height:1.3}
    .cv-names .nm b{font-weight:800; color:#1d1b1e; letter-spacing:.1px}
    .cv-names .nm .rest{font-weight:500; color:#5f5266}
    .cv-names .nm{overflow-wrap:break-word}
    .cv-names .n{width:20px; font-size:11.5px; color:#b3a6b8}
    .cv-names li i.pay{font-size:11.5px; padding:3px 9px}
    .cv.size-s .cv-names li{font-size:14px; padding:6px 8px}
    .cv.size-l .cv-names li{font-size:19px; padding:11px 11px}
    .cv.size-l .cv-names li i.pay{font-size:13px; padding:3px 10px}
    .cv.size-l .cv-names .n{font-size:13px; width:24px}
    @media (max-width:720px){ .cv-names li{font-size:17px; padding:10px 9px} }

    /* ---- editing a session ---- */
    .cv-edit-grid{display:grid; grid-template-columns:1fr 1fr; gap:10px}
    .cv-edit-grid .field:last-child{grid-column:1 / -1}
    .cv-edit-sheet .field{margin-bottom:10px}
    .cv-edit-sheet select, .cv-edit-sheet input{width:100%}

    @media (max-width:720px){
      .cv-adjust{padding:12px}
      .cv-adj{flex:1 1 100%}
      .cv-seg button{flex:1}
      .cv-adj-reset{margin-left:0}
      .cv.cards-wide .cv-grid{grid-template-columns:1fr}
      .cv.cards-wide .cv-names{grid-template-columns:1fr}
    }
  `,
})
export class Classes {
  protected store = inject(Store);
  private api = inject(Api);
  private toast = inject(Toast);
  private roll = inject(RollApi);
  private router = inject(Router);

  protected readonly Math = Math;
  protected readonly view = signal<View>('class');
  protected readonly only = signal('');
  /** ?find=Name, from the Registration pool: that student, highlighted */
  protected readonly query = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('find') ?? '');
  protected readonly showPaid = signal(true);
  protected readonly showInactive = signal(false);
  private readonly status = signal<Map<string, PayStatus>>(new Map());
  protected readonly monthLabel = signal('');
  protected readonly todayName = DAYS[(new Date().getDay() + 6) % 7];
  protected readonly days = DAYS;

  /* ---------------- how the page looks (remembered on this computer) ---------------- */

  private readonly saved = readView();
  protected readonly adjusting = signal(false);
  protected readonly textSize = signal<TextSize>(this.saved.textSize ?? 'm');
  protected readonly names = signal<'all' | 'counts'>(this.saved.names ?? 'all');
  protected readonly order = signal<'name' | 'unpaid'>(this.saved.order ?? 'name');
  protected readonly cardSize = signal<'narrow' | 'wide'>(this.saved.cardSize ?? 'narrow');
  protected readonly collapsed = signal<Set<string>>(new Set(this.saved.collapsed ?? []));
  /** sessions opened while "counts only" is on */
  protected readonly openGroups = signal<Set<string>>(new Set());

  protected toggleClass(name: string) {
    this.collapsed.update(s => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }
  protected expandAll() { this.collapsed.set(new Set()); }
  protected collapseAll() { this.collapsed.set(new Set(this.blocks().map(b => b.name))); }
  protected toggleGroup(key: string) {
    this.openGroups.update(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  protected clearOpen() { this.openGroups.set(new Set()); }
  protected resetView() {
    this.textSize.set('m'); this.names.set('all'); this.order.set('name'); this.cardSize.set('narrow');
    this.collapsed.set(new Set()); this.openGroups.set(new Set());
  }

  /** a session holding a search match always shows its names */
  protected hasHit(g: Group): boolean {
    const q = this.query().trim().toLowerCase();
    return !!q && g.students.some(s => matches(s, q));
  }

  protected dueCount(g: Group): number {
    return g.students.filter(s => { const c = this.statusClass(s); return c === 'pending' || c === 'part'; }).length;
  }

  /** the students in the chosen order: A–Z, or the ones still to pay first */
  protected ordered(g: Group): Student[] {
    if (this.order() !== 'unpaid') return g.students;
    const rank: Record<string, number> = { pending: 0, part: 1, none: 2, off: 3, free: 4, paid: 5 };
    return [...g.students].sort((a, b) => (rank[this.statusClass(a)] ?? 2) - (rank[this.statusClass(b)] ?? 2) || byName(a, b));
  }

  /** "Kenul" from "Kenul Devjaan Withanage": the name read first, at a glance */
  protected firstName(name: string): string {
    const w = words(name);
    return w.slice(0, leadLength(w)).join(' ');
  }

  protected otherNames(name: string): string {
    const w = words(name);
    return w.slice(leadLength(w)).join(' ');
  }

  /** the payment, in a word */
  protected payLabel(s: Student): string {
    switch (this.statusClass(s)) {
      case 'paid': return 'Paid';
      case 'part': return 'Part';
      case 'pending': return 'Due';
      case 'free': return 'Free';
      case 'off': return 'Not due';
      default: return '';
    }
  }

  /* ---------------- change a session ---------------- */

  protected readonly sessionEdit = signal<SessionEdit | null>(null);

  /** the real session behind a card (not "Not placed yet" or a session that no longer exists) */
  protected sessionOf(g: Group): Session | null {
    return g.key.startsWith('~') ? null : this.store.sessions().find(x => x.name === g.key) ?? null;
  }

  protected editSession(s: Session) {
    this.sessionEdit.set({ name: s.name, rename: s.name, category: s.category, day: s.day, time: s.time, max: s.max, meaning: s.meaning ?? '' });
  }

  protected patchEdit(p: Partial<SessionEdit>) {
    this.sessionEdit.update(s => s && ({ ...s, ...p }));
  }

  protected async saveSession() {
    const s = this.sessionEdit();
    if (!s || this.busy()) return;
    if (!s.rename.trim()) { this.toast.show('Give the session a name.'); return; }
    const max = s.max === null || (s.max as unknown) === '' ? null : Number(s.max);
    if (max !== null && (!Number.isFinite(max) || max < 0)) { this.toast.show('Places should be a number.'); return; }
    this.busy.set(true);
    try {
      await this.api.saveSession({ name: s.name, rename: s.rename.trim(), category: s.category, day: s.day,
                                   time: s.time.trim(), max, meaning: s.meaning }, false);
      await this.store.loadRoster(false);
      this.sessionEdit.set(null);
      this.toast.show(`${s.rename.trim()} saved.`);
    } catch (err) {
      this.toast.show(errorMessage(err, 'Could not save the session.'));
    } finally {
      this.busy.set(false);
    }
  }

  constructor() {
    // remember how the page was set up
    effect(() => writeView({ textSize: this.textSize(), names: this.names(), order: this.order(),
                             cardSize: this.cardSize(), collapsed: [...this.collapsed()] }));
    // payment colours come from the month the Payments page shows
    effect(() => {
      const month = this.store.paymentsMonth();
      if (!this.store.loaded()) return;
      this.api.month(month).then(v => {
        this.status.set(new Map(v.rows.map(r => [r.studentId, r.status])));
        this.monthLabel.set(v.label);
      }).catch(() => this.status.set(new Map()));
    });
  }

  protected readonly blocks = computed<ClassBlock[]>(() => {
    const students = this.store.students().filter(s => this.showInactive() || s.active);
    const sessions = this.store.sessions();
    const cats = this.store.categories();
    // classes in Settings order, then any class only a student mentions
    const names = [...cats.map(c => c.name)];
    for (const s of students) if (s.category && !names.includes(s.category)) names.push(s.category);
    return names.map(name => {
      const mine = students.filter(s => s.category === name).sort(byName);
      const cat = cats.find(c => c.name === name);
      const colour = this.store.colour(name);
      const blank = { category: name, colour, symbol: '', symbolStyle: 'plain', meaning: '', family: '', day: '', time: '', max: null };
      const groups: Group[] = [];
      if (this.store.usesSessions(name)) {
        const own = sessions.filter(x => x.category === name).sort(byDay);
        for (const x of own) groups.push(this.group(x, colour, mine.filter(s => s.session === x.name)));
        // a session a student names that no longer exists, then the students not yet placed
        const known = new Set(own.map(x => x.name));
        const stray = Array.from(new Set(mine.map(s => s.session).filter(n => n && !known.has(n))));
        for (const n of stray) groups.push({ ...blank, key: '~stray:' + n, title: n, students: mine.filter(s => s.session === n) });
        const loose = mine.filter(s => !s.session);
        if (loose.length) groups.push({ ...blank, key: '~loose', title: 'Not placed yet', symbol: '?', meaning: 'no session chosen yet', students: loose, loose: true });
      } else {
        groups.push({ ...blank, key: '~all', title: 'All students', symbol: '★', meaning: 'no sessions in this class', students: mine });
      }
      const fee = cat?.billing === 'payg' || cat?.fee === null || cat === undefined ? 'Pay as you go'
        : `Rs. ${money(this.store.classFee(name) ?? 0)}${cat.billing === 'term' ? ' a term' : ' a month'}`;
      const capacity = groups.reduce((t, g) => t + (g.max ?? 0), 0);
      return { name, colour, fee, count: mine.length, capacity, groups };
    }).filter(b => b.count || b.groups.some(g => !g.loose));
  });

  protected readonly total = computed(() => this.blocks().reduce((t, b) => t + b.count, 0));
  protected readonly sessionCount = computed(() => this.store.sessions().length);

  /** the classes on show: the picked tile, and only the sessions holding a search match */
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    let list = this.blocks().filter(b => !this.only() || b.name === this.only());
    if (q) {
      list = list.map(b => ({ ...b, groups: b.groups.filter(g => g.students.some(s => matches(s, q))) }))
        .filter(b => b.groups.length);
    }
    return list;
  });

  /** the same sessions as a week: Monday to Sunday, each day in time order */
  protected readonly week = computed(() => {
    const all = this.shown().flatMap(b => b.groups).filter(g => g.day);
    return DAYS.map(day => {
      const groups = all.filter(g => g.day === day).sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
      return { day, groups, students: groups.reduce((t, g) => t + g.students.length, 0) };
    }).filter(d => d.groups.length);
  });

  private group(x: Session, colour: string, students: Student[]): Group {
    return {
      key: x.name, title: x.name, category: x.category, colour, symbol: x.symbol, symbolStyle: x.symbolStyle,
      meaning: x.meaning, family: x.family, day: x.day, time: x.time, max: x.max, students,
    };
  }

  /** one empty row per free place (none when the session has no limit set) */
  protected freeSlots(g: Group): number[] {
    return g.max ? Array.from({ length: Math.max(0, g.max - g.students.length) }) : [];
  }

  protected pct(n: number, of: number): number {
    return of ? Math.min(100, (n / of) * 100) : 0;
  }

  protected hit(s: Student): boolean {
    const q = this.query().trim().toLowerCase();
    return !!q && matches(s, q);
  }

  protected statusClass(s: Student): string {
    if (!this.showPaid()) return 'none';
    switch (this.status().get(s.id)) {
      case 'Paid': return 'paid';
      case 'Partially Paid': return 'part';
      case 'Pending': return 'pending';
      case 'Free place': return 'free';
      case 'Inactive': case 'Not due': return 'off';
      default: return 'none';
    }
  }

  protected tip(s: Student): string {
    const st = this.status().get(s.id);
    return [s.id, s.parent && 'Parent: ' + s.parent, s.phone, st && st + (this.monthLabel() ? ' — ' + this.monthLabel() : '')]
      .filter(Boolean).join('\n');
  }

  /** a name opens that student on the Students page */
  protected openStudent(s: Student) {
    this.moving.set(null);
    this.router.navigate(['/students'], { queryParams: { q: s.name } });
  }

  /* ---------------- filling a free place from the registration pool ---------------- */

  protected readonly filling = signal<Session | null>(null);

  protected canFill(g: Group): boolean {
    return !g.loose && !g.key.startsWith('~') && this.store.sessions().some(s => s.name === g.title);
  }

  protected fillFree(g: Group) {
    const s = this.store.sessions().find(x => x.name === g.title);
    if (s && this.canFill(g)) this.filling.set(s);
  }

  protected openPool() {
    this.router.navigate(['/registrations']);
  }

  /* ---------------- moving a student: drag a name, or tap it ---------------- */

  protected readonly dragId = signal('');
  /** the session the name was picked up from */
  protected readonly dragFrom = signal('');
  /** the session being dragged over */
  protected readonly dropKey = signal('');
  /** the student whose "Move to…" panel is open */
  protected readonly moving = signal<Student | null>(null);
  protected readonly busy = signal(false);

  protected dragStart(e: DragEvent, s: Student, g: Group) {
    this.dragId.set(s.id);
    this.dragFrom.set(g.key);
    e.dataTransfer?.setData('text/plain', s.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected dragEnd() {
    this.dragId.set('');
    this.dragFrom.set('');
    this.dropKey.set('');
  }

  protected dragOver(e: DragEvent, g: Group) {
    if (!this.dragId() || g.key === this.dragFrom() || g.key.startsWith('~stray')) return;
    e.preventDefault();                       // allows the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.dropKey.set(g.key);
  }

  protected dragLeave(e: DragEvent, g: Group) {
    // leaving for a child of the same card is not leaving it
    const to = e.relatedTarget as Node | null;
    if (to && (e.currentTarget as HTMLElement).contains(to)) return;
    if (this.dropKey() === g.key) this.dropKey.set('');
  }

  protected drop(e: DragEvent, g: Group) {
    e.preventDefault();
    const s = this.store.students().find(x => x.id === (this.dragId() || e.dataTransfer?.getData('text/plain')));
    this.dragEnd();
    if (s) this.move(s, g);
  }

  /** the parent's confirmation, once a cover-up is booked */
  protected readonly confirmMsg = signal('');

  protected copyMsg(text: string) {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Message copied.'), () => this.toast.show('Could not copy.'));
  }

  protected openMove(s: Student) {
    this.confirmMsg.set('');
    this.mode.set(s.session ? 'cover' : 'move');
    this.reason.set('');
    this.coverAll.set(false);
    this.missDate.set(this.missDatesFor(s).find(d => !d.past)?.iso ?? '');
    this.moving.set(s);
  }

  /* ---------------- a cover-up class, booked from here ---------------- */

  protected readonly mode = signal<'cover' | 'move'>('cover');
  protected readonly missDate = signal('');
  protected readonly reason = signal('');
  protected readonly coverAll = signal(false);

  /** the student's own class days: two weeks back to five weeks ahead */
  private missDatesFor(s: Student) {
    const ses = this.store.sessions().find(x => x.name === s.session);
    if (!ses) return [];
    const today = isoDay(new Date());
    const out: { iso: string; day: string; label: string; past: boolean; today: boolean }[] = [];
    for (let d = -14; d <= 35; d++) {
      const day = new Date(Date.now() + d * 864e5);
      if (DAYS[(day.getDay() + 6) % 7] !== ses.day) continue;
      const iso = isoDay(day);
      out.push({ iso, day: day.toLocaleDateString('en-GB', { weekday: 'short' }), label: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        past: iso < today, today: iso === today });
    }
    return out;
  }

  protected readonly missDates = computed(() => {
    const m = this.moving();
    return m ? this.missDatesFor(m) : [];
  });

  /** other sessions from a week before to three weeks after the missed class, their own class first */
  protected readonly coverOptions = computed(() => {
    const m = this.moving(), miss = this.missDate();
    if (!m || !miss) return [];
    const from = new Date(miss + 'T12:00:00');
    const counts = new Map<string, number>();
    for (const st of this.store.students()) if (st.active && st.session) counts.set(st.session, (counts.get(st.session) ?? 0) + 1);
    const out: { session: Session; date: string; dayShort: string; label: string; free: number | null; same: boolean }[] = [];
    for (const ses of this.store.sessions()) {
      if (ses.name === m.session) continue;
      const same = ses.category === m.category;
      if (!same && !this.coverAll()) continue;
      for (let d = -7; d <= 21; d++) {
        const day = new Date(from.getTime() + d * 864e5);
        if (DAYS[(day.getDay() + 6) % 7] !== ses.day) continue;
        out.push({ session: ses, date: isoDay(day), same,
          dayShort: day.toLocaleDateString('en-GB', { weekday: 'short' }),
          label: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          free: ses.max == null ? null : ses.max - (counts.get(ses.name) ?? 0) });
      }
    }
    return out.sort((a, b) => Number(b.same) - Number(a.same) || a.date.localeCompare(b.date) || startMinutes(a.session.time) - startMinutes(b.session.time));
  });

  protected async bookCover(s: Student, o: { session: Session; date: string; dayShort: string; label: string }) {
    if (this.busy() || !this.missDate()) return;
    this.busy.set(true);
    try {
      const mu = await this.roll.book(s.id, s.session, this.missDate(), o.session.name, o.date, this.reason());
      this.toast.show(`Cover-up booked: ${s.name} misses ${mu.fromLabel} → comes to ${mu.toLabel}.`);
      this.confirmMsg.set(coverMessage({
        parent: s.parent, student: s.name, academy: this.store.settings().academyName,
        fromSession: mu.fromSession, fromCategory: s.category, fromDate: mu.fromDate,
        toSession: mu.toSession, toDate: mu.toDate, toTime: o.session.time, reason: this.reason(),
      }));
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not book the cover-up.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** every class with its sessions, for the "Move to…" panel */
  protected readonly moveTargets = computed(() =>
    this.blocks().map(b => ({ ...b, groups: b.groups.filter(g => !g.key.startsWith('~stray') && g.key !== '~loose') }))
      .filter(b => b.groups.length));

  protected isCurrent(s: Student, g: Group): boolean {
    return g.key === '~all' ? s.category === g.category && !s.session : s.session === g.title && s.category === g.category;
  }

  protected whenOf(g: Group): string {
    return [g.day, g.time].filter(Boolean).join(' · ') || g.meaning;
  }

  /**
   * Moves a student to another session (or to a class without sessions). The class, day, time
   * and fee all follow the session; this month's fee changes too, unless it is already paid.
   */
  protected async move(s: Student, g: Group) {
    if (this.busy() || this.isCurrent(s, g)) return;
    const session = g.key === '~all' || g.loose ? '' : g.title;
    const newFee = s.specialFee !== null ? s.specialFee : this.store.classFee(g.category);
    const oldFee = s.fee;
    const lines = [
      `Move ${s.name}`,
      `from ${s.session || 'no session'} (${s.category}) to ${session || 'no session'} (${g.category})?`,
      '',
      g.day || g.time ? `New class time: ${[g.day, g.time].filter(Boolean).join(', ')}` : '',
      g.category !== s.category
        ? (s.specialFee !== null ? `Fee stays Rs. ${money(s.specialFee)} (a special fee).`
          : `Fee changes from ${oldFee === null ? 'pay as you go' : 'Rs. ' + money(oldFee)} to ${newFee === null ? 'pay as you go' : 'Rs. ' + money(newFee)} a month.`)
        : 'The fee stays the same.',
      g.max !== null && g.students.length >= g.max ? `⚠ ${g.title} is already full (${g.students.length} of ${g.max}).` : '',
    ].filter(x => x !== null);
    if (!confirm(lines.join('\n').replace(/\n{3,}/g, '\n\n'))) return;

    this.busy.set(true);
    try {
      await this.api.updateStudent(s.id, {
        name: s.name, category: g.category, session, specialFee: s.specialFee ?? null, active: s.active,
        parent: s.parent, phone: s.phone, note: s.note, country: s.country, family: s.family ?? '', custom: s.custom ?? {},
      });
      await this.store.loadRoster(false);
      this.moving.set(null);
      this.toast.show(`${s.name} moved to ${session || g.category}${g.day ? ' — ' + g.day + ' ' + g.time : ''}.`);
    } catch (e) {
      this.toast.show(errorMessage(e, 'Could not move the student.'));
    } finally {
      this.busy.set(false);
    }
  }
}

const byName = (a: Student, b: Student) => a.name.localeCompare(b.name);
const byDay = (a: Session, b: Session) =>
  (dayIndex(a.day) - dayIndex(b.day)) || startMinutes(a.time) - startMinutes(b.time) || a.name.localeCompare(b.name);
const dayIndex = (d: string) => { const i = DAYS.indexOf(d); return i < 0 ? 9 : i; };

/** "3:30 - 4:30 PM" → minutes after midnight of the start, for sorting */
function startMinutes(t: string): number {
  const [a, b = ''] = (t || '').split(/\s*[-–]\s*/);
  const start = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(a);
  if (!start) return 9999;
  const end = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(b);
  const at = (h: number, m: number, mer?: string) =>
    ((h % 12) + (mer ? (/pm/i.test(mer) ? 12 : 0) : (h % 12 < 8 ? 12 : 0))) * 60 + m;   // classes run in the afternoon
  const endMin = end ? at(+end[1], +(end[2] ?? 0), end[3]) : null;
  // a start without AM/PM takes the end's ("3:30 - 4:30 PM"), unless that would put it after the end ("11:30 - 12:30 PM")
  let s = at(+start[1], +(start[2] ?? 0), start[3] ?? end?.[3]);
  if (!start[3] && endMin !== null && s > endMin) s -= 12 * 60;
  return s;
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function matches(s: Student, q: string): boolean {
  return (s.name + ' ' + s.id + ' ' + (s.parent || '')).toLowerCase().includes(q);
}

/* ---------------- how the page looks, remembered in this browser ---------------- */

type TextSize = 's' | 'm' | 'l';

interface SessionEdit {
  name: string;
  rename: string;
  category: string;
  day: string;
  time: string;
  max: number | null;
  meaning: string;
}

interface ViewPrefs {
  textSize?: TextSize;
  names?: 'all' | 'counts';
  order?: 'name' | 'unpaid';
  cardSize?: 'narrow' | 'wide';
  collapsed?: string[];
}

const VIEW_KEY = 'sapa.classes.view';

function readView(): ViewPrefs {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as ViewPrefs; } catch { return {}; }
}

function writeView(v: ViewPrefs) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* private mode: not remembered */ }
}

/* ---------------- names at a glance ---------------- */

function words(name: string): string[] {
  return (name ?? '').trim().split(/\s+/).filter(Boolean);
}

/** how many words make the bold part: the first name, with any initials before it ("N.M.A. Ayon") */
function leadLength(w: string[]): number {
  let i = 0;
  while (i < w.length - 1 && w[i].includes('.')) i++;
  return Math.min(w.length, i + 1);
}
