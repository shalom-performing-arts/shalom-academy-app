# Shalom Academy — Fee Receipts

Students, monthly fee collection and A5 fee receipts (PDF, JPG or print) for the academy, in
one app. It replaces the original `payment-receipt` page and the monthly `Payments_<Month>.xlsx`
workbook. It's an **Angular** frontend with a **Spring Boot** backend, so everything lives on a
server that every device shares.

```
fee-receipts/
├── backend/    Spring Boot 4.1 · Java 21 · REST API on :8080
│   └── data/   students.json, payments.json, months.json, receipts.json, settings.json
└── frontend/   Angular 21 · dev server on :4200, proxies /api to the backend
```

## The pages

| Page | Replaces | What it's for |
|---|---|---|
| **New receipt** | the old receipt page | Make and send a receipt. Issuing one marks the fee as paid |
| **Payments** | the Kids / Junior / Youth / Adult tabs and the Dashboard | Tick fees as they come in, and see where the money is |
| **Students** | the Students and Sessions tabs | Add, move and edit students; class fees; session sizes |
| **History** | — | Every receipt issued |
| **Settings** | — | Academy details, the Paid-to list, backup |

### Payments

- **One click to tick a fee.** It pays the student's full fee for the month, with today's date
  and the Paid-to shown on the row. Click again to undo.
- **Part payments** go in the row's details (click the name): type a smaller amount, then add
  the rest when it comes. The status shows *Partially Paid* until it's covered.
- **Admission fees and other charges** go in the same place. They count towards "where the
  money is" but not towards the month's fee collection.
- **Fee this month only** changes one student's fee for one month, such as a half month.
- **Issue receipt** opens the receipt already filled in. A fee that's already ticked is linked
  to the receipt, not counted twice.
- **Months.** A month copies every active student's fee and session when it starts, like making
  the month's copy of the workbook. After that, changes on the Students page reach only the
  **newest** month, and only for students who haven't paid in it yet. A fee change in December
  never rewrites November.
- **Export for Excel** downloads the month as a CSV with one row per student.

### Setting it up your way

These are all set up in the app, not in the code:

| What | Where | Notes |
|---|---|---|
| **Classes** | Students → *Classes & fees* | Add, rename, reorder or remove. A rename carries its students, sessions and past months with it. A class still in use can't be removed |
| **Billing** | Students → *Classes & fees* | Per class: *every month*, *per term* (due only in the months you pick; other months show "Not due"), or *pay as you go* (no set fee, like Online) |
| **Scheduled fee changes** | Students → *Classes & fees* | "9,000 from January 2027": earlier months keep the old fee |
| **Sessions** | Students → *Edit session* | Rename (students and past months follow), day, time, size, or delete once empty |
| **Sibling discount** | Settings | A percentage or fixed amount off for each brother or sister. Students with the same **Family** are siblings; the child on the highest fee pays in full. A special fee is never discounted further |
| **Fee types** | Settings | Monthly fee and Admission fee are built in (they can be renamed). Add others, such as an Exam fee, each with a default amount. They appear on receipts (*+ Add another charge*) and in the Payments page's add-payment form |
| **Payment methods** | Settings | The "Paid by" list on receipts. A method containing "Cash" sets Paid to your cash option |
| **Paid to** | Settings | The accounts money goes to |
| **Student fields** | Settings | Your own details per student: text, number, date, phone, or a choice from a list. Optionally shown on the Students rows, and always in *Students → Export* |

A student's fee for a month comes from one place (`FeeRules.java`): special fee if they have
one, otherwise the class fee for that month (after any scheduled change), less any sibling
discount. A term class's off-months charge nothing.

### Receipts and payments stay in step

- **Saving a receipt** records a payment for each fee line, including both children on a
  sibling receipt.
- **Editing a receipt** updates its payments.
- **Deleting a receipt** asks whether the money was really not received: either the fee goes
  back to unpaid, or the payment stays without a receipt.

## Running it

You need two terminals.

**Backend** (needs JDK 21; a portable one is in `..\tools\jdk-21.0.13+9`):

```powershell
cd backend
$env:JAVA_HOME = "D:\Shalom Academy of Performing Arts\tools\jdk-21.0.13+9"
.\mvnw.cmd spring-boot:run
```

**Frontend** (needs Node 24):

```powershell
cd frontend
npm install      # first time only
npm start
```

Then open <http://localhost:4200> and sign in.

## Teachers: attendance and salary

This replaces `teacher-attendance-salary-v2.xlsx` and uses the same rules:
- Each class a teacher takes pays the **weekday rate** (Mon–Fri, Rs. 700) or the **weekend rate**
  (Sat–Sun, Rs. 600).
- **Transport** (Rs. 5,000) is added once a teacher has taken at least one class in the pay period.
- Classes on a holiday marked **No class** don't count.
- An **adjustment** (+/−) can be added per teacher per period.
- Pay periods run from the **26th to the 25th** and are paid on the 25th.

The October 2026 sheet was imported, and the app gives the same Rs. 80,000 as the workbook.

**The office**, on the **Teachers** page:
- **Attendance:** every class day in the period. Tap a teacher's name on a class to tick it.
  📍 means the teacher checked in themselves at the academy; ✓ means the office ticked it.
- **Salary:** weekday and weekend classes, transport, adjustment and total for each teacher.
  You can mark a salary as paid and export it for Excel.
- **Setup:**
  - teachers, with their WhatsApp numbers and PINs;
  - pay rates;
  - the academy's location;
  - the weekly timetable (16 classes, from the workbook);
  - holidays (from the workbook).

**Teachers**, on their phones:
1. The office presses **Give PIN** in Setup → Teachers, then **Send on WhatsApp**. The teacher gets
   the link and their PIN.
2. The teacher opens the link, taps **Teacher**, picks their name and enters the PIN. Adding the
   page to the home screen makes it one tap next time.
3. At the academy, they tap **Check in** on each class. Check-in only works:
   - within the allowed distance of the academy (150 m by default), using the phone's GPS;
   - from 45 minutes before a class until 15 minutes after it ends.

   Missed it? The office ticks it on the Attendance tab.
4. **After each class**, from 10 minutes before it ends until an hour after, they tap
   **🎉 Class done** at the academy, with an optional note on what they covered. The time limit is
   set in Setup → Academy location.

On the Attendance tab:
- 🎉 means checked in and marked done. Hover to see the times; the note shows under the class.
- An amber **📍 not done** means the teacher checked in but didn't confirm. Tap it to confirm the
  class was taught (their check-in is kept), or to remove it.
- A class the teacher checked in to still counts for pay; "not done" is there for you to follow up.

A teacher's sign-in only opens their own check-in. It can't see payments, students or other
teachers' pay. Giving a teacher a new PIN signs them out everywhere.

**Before teachers can check in:**
- Set the academy's location: stand in the academy with a phone, open Setup → Academy location,
  tap **Use where I am now**, then **Save location**.
- Host the app on **https**. Phones only share their location with secure sites. The app works
  at `http://localhost` on this computer, but not on a phone at `http://192.168.x.x`.

GPS can be faked with special apps. Check-in is a convenience, not proof; the office can always
correct the sheet.

## Sending receipts on WhatsApp

Fill in the receipt and press **Send on WhatsApp** (or **Resend** / **WhatsApp** on the History page).

1. The panel shows the parent's number from the Students page (type one in if it is missing, and
   tick *Save this number* to keep it), the message, and Picture or PDF.
2. **Open WhatsApp**:
   - **On a computer:** WhatsApp Web opens in its own tab, in that parent's chat, with the message
     typed in. The receipt picture is already copied, so press **Ctrl + V** and then **Enter**.
     For a PDF, the file goes to Downloads; drag it into the chat.
   - **On a phone:** the share sheet opens. Pick WhatsApp, then the parent's chat.
3. Back in the app, press **Yes, it's sent — mark as paid**. Only then is the receipt saved and
   the fee marked **Paid** on the Payments page. History shows **✓ Sent** with the number and date.

If it wasn't sent, close the panel: nothing is saved and the fee stays unpaid. WhatsApp can't
tell the app that a message went through, so the last step asks you.

Settings → **Sending on WhatsApp** holds:
- the country code added to local numbers (94: 071 040 7740 becomes +94 71 040 7740);
- the message template.

An online student abroad needs their number with its own code, e.g. `+44 …`.

The sample student **Rebeccah Shalom** (SAPA-1153, Adult, Pianissimo) has the number
0710407740, for trying this out.

## Using it on a phone

The app adapts to phones: a tab bar along the bottom, compact Payments rows (tap a name for
Paid to, remark, part payments and receipts), a fixed **Total · Preview · PDF** bar on the receipt
page, History as cards, and editors that open full-screen. Text boxes are 16px, so iPhones don't
zoom in when you tap one.

**To open it on a phone on the same Wi-Fi** as this computer:

1. Start the frontend with `npm run start:phone` instead of `npm start`. If Windows asks
   whether to let Node.js through the firewall, allow it on **private** networks.
2. On the phone, open `http://<this computer's address>:4200`. Find the address with
   `ipconfig`, under "Wi-Fi → IPv4 Address" (it was `192.168.1.12` when this was written).
3. **Add it to the home screen** so it opens full-screen like an app, with the academy logo as
   its icon. iPhone: Share → *Add to Home Screen*. Android: ⋮ → *Add to Home screen*.

The backend doesn't need to change, because the frontend passes `/api` on to it. Only use this
on a network you trust: until the app is hosted with HTTPS, the password travels unencrypted
over the Wi-Fi.

## Password

The app has one shared password for everyone; there are no separate accounts.

- On first start the backend creates a random password and saves it in
  `backend/data/password.txt`, which is git-ignored. It's also printed in the backend log.
- **To change it**, edit that file and restart the backend, or set the `APP_PASSWORD`
  environment variable, which takes priority over the file.
- A sign-in lasts **30 days** in that browser, and restarting the server doesn't end it.
  **Changing the password signs everyone out.**
- After 5 wrong passwords from one address, that address must wait 5 minutes.
- Every `/api` call except `/api/auth/login` needs `Authorization: Bearer <token>`, so the
  data is protected on the server itself.

Run the backend tests with `.\mvnw.cmd test`.

## Where the data lives

For now all data is in JSON files under `backend/data/`. Nothing is in a database yet.

| File | What | Who writes it |
|---|---|---|
| `students.json` | Students, sessions (`classes`) and class fees (`categories`) | The app (Students page) |
| `months.json` | Each fee month: who owes what, and the month's remarks | The app (Payments page) |
| `payments.json` | Every payment: student, month, amount, paid to, date, receipt | The app (Payments page and receipts) |
| `receipts.json` | Every issued receipt | The app |
| `settings.json` | Academy details, receipt options, the Paid-to list | The app (Settings page) |

`students.json` also holds fields this app doesn't use, such as songs, ages and adjudication
results. These are kept exactly as they are whenever a student is saved. **Don't run the old
`update-roster.js` against it any more.** The Students page is now where the roster is kept, and
that script would undo changes made here.

Writes go to a temp file first and are then moved into place, so a crash can't leave half a file.
Everything except `students.json` is git-ignored, because it holds parents' and students'
details. `students.before-payments.json` is the roster as it was before the Students page
first wrote to it.

Use `DATA_DIR` to point the backend at another folder:
`$env:DATA_DIR = "D:\receipts-data"`.

### Moving to a database later

The storage sits behind five interfaces in `backend/src/main/java/lk/shalom/receipts/repository/`:
`ReceiptRepository`, `PaymentRepository`, `MonthRepository`, `SettingsRepository` and
`RosterRepository`. The `Json…Repository`
classes are the only code that knows about files. Add JPA (or JDBC) implementations of those
interfaces and remove the `@Repository` annotation from the JSON ones. The services,
controllers and frontend stay the same.

## API

| Method | Path | |
|---|---|---|
| POST | `/api/auth/login` | `{"password": "..."}` → `{"token": "..."}`. The only call that needs no token |
| GET | `/api/auth/check` | 200 while the token is still good |
| GET | `/api/roster` | Students, sessions and class fees |
| POST | `/api/students` | Add a student. The next SAPA number is assigned |
| PUT | `/api/students/{id}` | Change a student: class, session, special fee, active, parent, phone, note |
| DELETE | `/api/students/{id}` | Only for someone added by mistake. Refused once they have payments |
| POST / PUT | `/api/sessions` / `/api/sessions/{name}` | Add a session / change its day, time and size, or `"rename"` it |
| DELETE | `/api/sessions/{name}` | Only once no active student is in it |
| PUT | `/api/categories` | All classes in order: fee, `billing` (`monthly`/`term`/`payg`), `termMonths`, `usesSessions`, `changes` (scheduled fees). `"from": "Old name"` renames |
| GET | `/api/months/{yyyy-mm}` | The month: every student's fee, payments and status, plus the dashboard totals |
| POST | `/api/months/{yyyy-mm}` | Start the month (also happens by itself on its first payment) |
| PATCH | `/api/months/{yyyy-mm}/students/{id}` | `{"fee": 4000}`, `{"reset": true}` or `{"remark": "..."}` for that month |
| GET | `/api/months/{yyyy-mm}/export.csv` | The month for Excel |
| POST | `/api/payments` | Record a payment. With no amount, a monthly payment pays what's still owed |
| PATCH / DELETE | `/api/payments/{id}` | Change where it went, its date or note / remove it |
| GET / PUT | `/api/settings` | Academy settings (missing fields fall back to the defaults) |
| GET | `/api/receipts` | All receipts, newest first |
| GET | `/api/receipts/{id}` | One receipt |
| POST | `/api/receipts` | Save a new receipt. The server assigns the id and recomputes the total |
| PUT | `/api/receipts/{id}` | Update a saved receipt |
| POST | `/api/receipts/{id}/sent` | Record that it was sent on WhatsApp: `{"to": "94710407740"}` |
| DELETE | `/api/receipts/{id}?removePayments=true\|false` | Delete one; also un-pay its fees, or keep them paid |
| DELETE | `/api/receipts` | Delete all. Their payments stay |
| GET | `/api/receipts/summary` | Count and total per fee month |
| GET | `/api/receipts/export.csv` | Every receipt as CSV |
| GET | `/api/backup` | Everything (settings, receipts, payments, months, students) as one JSON file |
| POST | `/api/backup/restore` | Restore a backup. One from the old browser app only replaces settings and receipts |

Errors come back as `{"message": "..."}`, and the frontend shows that message as it is.

## Moving receipts over from the old browser app

The old app kept receipts in each browser. On each device that used it:

1. Open the old app and go to **Settings → Backup → Export backup (JSON)**.
2. In this app, go to **Settings → Backup → Restore backup** and choose that file.

Restore **replaces** everything on the server. If more than one device has receipts, combine
them first, or restore the device that has the most.

## Changes from the original

- **Saved before downloaded.** A receipt is recorded on the server before its PDF/JPG is made,
  so nothing can reach a parent without also being in History.
- **Receipt numbers are unique on the server.** Reusing a number is refused with a message
  naming the receipt that already has it.
- **Picking a student from the list sets their fee**, even if the box already had an amount.
  Before, it only filled an empty box, so switching students kept the previous child's fee.
- **Hidden rows really hide.** In the original, the empty student card and the second-sibling
  fee rows showed even with one student, because a `display:flex` rule overrode `[hidden]`.
- **No more file:// workarounds.** `assets.js`, `students-fallback.js` and `build-assets.js`
  existed only so the page could be opened straight from disk. A served app doesn't need them.
- **Roster upload/clear in Settings is gone.** The Students page is the one roster.

## November 2026 was imported from `Payments_November.xlsx`

Imported:
- the 24 ticked fees, with their Paid to and remarks;
- Jiyaan's admission fee of 5,000, taken from his remark;
- session days, times and sizes, and the class fees;
- the 9 Online Class students.

The totals match the workbook's Dashboard: 921,000 expected, 171,000 collected, split
109,000 / 48,000 / 14,000.

- **Payment dates.** The workbook didn't record dates, so imported payments carry 3 Nov 2026,
  the day of the import.
- **Changed from the old roster:**
  - Aaliya Shenali Galanga now has a 6,000 special fee, as in the workbook.
  - Nivyaan Karunanayake's "(comes at 12 pm)" became a note.
  - **Shashika Harshani** is in Youth with **no session yet**. Pick one on the Students page.
- **Online students** have no set fee: type the amount when they pay. "Anya + Faye" and
  "Sehas + Aken" came in as one row each, as in the workbook. The workbook says Sehas + Aken's
  November fee was given but not how much, so it isn't recorded yet.

## Not done yet

- **HTTPS before going online.** The password and token travel in plain text over `http://`.
  Fine on one computer, but serve it over HTTPS before anyone uses it across the internet.
- **Development servers only.** For hosting, build the frontend (`npm run build`), then
  either serve `frontend/dist/frontend/browser` from the same host as the API, or set
  `CORS_ORIGINS` on the backend to the frontend's address.
