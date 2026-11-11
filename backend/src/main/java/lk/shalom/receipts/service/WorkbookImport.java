package lk.shalom.receipts.service;

import lk.shalom.receipts.model.MonthSheet;
import lk.shalom.receipts.model.Payment;
import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.repository.MonthRepository;
import lk.shalom.receipts.repository.PaymentRepository;
import lk.shalom.receipts.repository.RosterRepository;
import lk.shalom.receipts.repository.SettingsRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.Month;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Makes the app match the academy's monthly fee workbook (the Excel file the office kept before
 * the app): its students, sessions, class fees, and that month's payments. The workbook is the
 * truth; the app follows it.
 *
 * <ul>
 *   <li>students are matched by name (also a slightly different spelling of the same child), so
 *       a matched child keeps their academy number, parent, phone and history;</li>
 *   <li>a child in the workbook but not the app is added; one in the app but not the workbook
 *       is switched off (inactive), never deleted;</li>
 *   <li>the month's payments are replaced by the workbook's, and the month's receipts removed;
 *       other months are left alone.</li>
 * </ul>
 * {@link #plan} works everything out without saving, for the preview; {@link #apply} saves it.
 */
@Service
public class WorkbookImport {

    private static final Pattern SECTION = Pattern.compile("^([A-Za-z]+)\\s{2,}(\\S.*?)\\s{2,}(\\S.*)$");
    private static final Pattern NUMBER = Pattern.compile("^\\d+(\\.0+)?$");
    private static final Pattern NOTE_IN_NAME = Pattern.compile("^(.*?)\\s*\\(([^)]*)\\)\\s*$");

    private final RosterRepository roster;
    private final PaymentRepository payments;
    private final MonthRepository months;
    private final MonthService monthService;
    private final ReceiptService receipts;
    private final SettingsRepository settings;

    public WorkbookImport(RosterRepository roster, PaymentRepository payments, MonthRepository months,
                          MonthService monthService, ReceiptService receipts, SettingsRepository settings) {
        this.roster = roster;
        this.payments = payments;
        this.months = months;
        this.monthService = monthService;
        this.receipts = receipts;
        this.settings = settings;
    }

    /* =========================================================
       What the office sees before anything is saved
       ========================================================= */

    public record Check(String what, String workbook, String app, boolean ok) {}

    public record Rename(String from, String to, String where) {}

    public record Move(String name, String from, String to) {}

    public record FeeChange(String name, String from, String to) {}

    public record Money(int count, BigDecimal amount) {}

    public record PaidTo(String name, int count, BigDecimal amount) {}

    public record Preview(String month, String monthLabel, boolean applied, List<Check> checks,
                          int students, int active, List<String> added, List<Rename> renamed, List<Move> moved,
                          List<FeeChange> fees, List<String> inactivated, List<String> reactivated,
                          List<String> sessionsAdded, List<String> sessionsChanged, List<String> sessionsRemoved,
                          List<String> classFees, Money paymentsRemoved, Money paymentsAdded, List<PaidTo> byPaidTo,
                          List<String> receiptsRemoved, List<String> warnings) {}

    /* =========================================================
       Reading the workbook
       ========================================================= */

    /** One child on the Students sheet (and their row on the class sheet). */
    private static final class Kid {
        String name, note, category, session, country;
        boolean active = true;
        BigDecimal special;          // null = the class fee; 0 = free place
        BigDecimal monthFee;         // what the class sheet charges this month
        BigDecimal collected = BigDecimal.ZERO;
        String paidTo, remark;
        Map<String, Object> app;     // the app's record, once matched
        boolean online;
        boolean ticked;              // the Paid cell is ticked (or holds an amount)
    }

    private record SessionRow(String category, String name, String meaning, String day, String time, Integer max) {}

    private record Book(YearMonth month, Map<String, BigDecimal> classFees, List<SessionRow> sessions, List<Kid> kids,
                        Map<String, BigDecimal> dashMoney, Map<String, Integer> dashCount, Integer dashStudents,
                        BigDecimal dashExpected, BigDecimal dashCollected, List<String> warnings) {}

    private static Book read(Map<String, List<List<String>>> sheets) {
        List<String> warnings = new ArrayList<>();
        YearMonth month = month(sheets.get("Dashboard"));

        // class fees: the yellow boxes at the top right of the Students sheet
        Map<String, BigDecimal> classFees = new LinkedHashMap<>();
        List<List<String>> st = sheet(sheets, "Students");
        for (int i = 0; i < Math.min(8, st.size()); i++) {
            for (int c = 0; c + 1 < st.get(i).size(); c++) {
                String name = cell(st.get(i), c);
                BigDecimal fee = money(cell(st.get(i), c + 1));
                if (fee != null && fee.signum() > 0 && name.matches("[A-Za-z]+") && !name.equalsIgnoreCase("Month")) {
                    classFees.put(name, fee);
                }
            }
        }

        // sessions
        List<SessionRow> sessions = new ArrayList<>();
        List<List<String>> ss = sheet(sheets, "Sessions");
        int head = find(ss, r -> cell(r, 0).equalsIgnoreCase("Class") && cell(r, 1).equalsIgnoreCase("Session"));
        for (int i = head + 1; head >= 0 && i < ss.size(); i++) {
            List<String> r = ss.get(i);
            String cat = cell(r, 0), name = cell(r, 1);
            if (cat.equalsIgnoreCase("ALL") || cat.isEmpty() || name.isEmpty()) break;
            String when = cell(r, 3);
            int sp = when.indexOf(' ');
            BigDecimal max = money(cell(r, 4));
            sessions.add(new SessionRow(cat, name, cell(r, 2), sp < 0 ? when : when.substring(0, sp),
                    sp < 0 ? "" : when.substring(sp + 1).trim(), max == null ? null : max.intValue()));
        }

        // students, session by session
        List<Kid> kids = new ArrayList<>();
        String cat = null, sess = null;
        for (List<String> r : st) {
            String a = cell(r, 0);
            Matcher m = SECTION.matcher(a);
            if (m.matches() && !a.toUpperCase().contains("TOTAL")) {
                cat = titleOf(m.group(1), classFees.keySet());
                String raw = m.group(2).trim();
                sess = sessions.stream().map(SessionRow::name).filter(n -> n.equalsIgnoreCase(raw)).findFirst().orElse(title(raw));
                continue;
            }
            if (a.toUpperCase().contains("TOTAL")) continue;
            String name = cell(r, 1);
            if (cat == null || !NUMBER.matcher(a).matches() || name.isEmpty()) continue;
            Kid k = new Kid();
            Matcher nm = NOTE_IN_NAME.matcher(name);
            k.name = nm.matches() ? nm.group(1).trim() : name.trim();
            String inName = nm.matches() ? nm.group(2).trim() : "";
            String notes = cell(r, 5);
            k.note = join(inName, notes);
            k.category = cat;
            k.session = sess;
            k.active = !cell(r, 2).equalsIgnoreCase("Inactive");
            BigDecimal sp = money(cell(r, 3));
            if (sp != null) k.special = sp.compareTo(new BigDecimal("0.01")) < 0 ? BigDecimal.ZERO : sp.setScale(0, RoundingMode.HALF_UP);
            BigDecimal classFee = classFees.get(cat);
            if (k.special != null && classFee != null && k.special.compareTo(classFee) == 0) k.special = null;
            k.monthFee = !k.active ? null : k.special != null ? k.special : classFee;
            kids.add(k);
        }

        // payments: each class sheet
        for (String catName : new ArrayList<>(classFees.keySet())) {
            List<List<String>> cs = sheets.get(catName);
            if (cs == null) continue;
            int h = find(cs, r -> r.stream().anyMatch(x -> x.equalsIgnoreCase("Student Name")));
            if (h < 0) continue;
            List<String> header = cs.get(h);
            int name = indexOf(header, "Student Name"), paidTo = indexOf(header, "Paid to"), remark = indexOf(header, "Remark"),
                    fee = indexOf(header, "fee"), collected = indexOf(header, "collected"), session = indexOf(header, "session");
            String sectionSession = null;
            for (int i = h + 1; i < cs.size(); i++) {
                List<String> r = cs.get(i);
                String a = cell(r, 0), nameText = cell(r, name);
                if (!NUMBER.matcher(a).matches()) {
                    // a session heading: "Forte      Wednesday 3:30 - 4:30 PM"
                    String first = a.split("\\s{2,}")[0].trim();
                    if (!first.isEmpty()) sectionSession = first;
                    continue;
                }
                if (nameText.isEmpty()) continue;
                Matcher nm = NOTE_IN_NAME.matcher(nameText);
                String clean = nm.matches() ? nm.group(1).trim() : nameText.trim();
                String inSession = session >= 0 && !cell(r, session).isEmpty() ? cell(r, session) : sectionSession;
                Kid k = kids.stream().filter(x -> norm(x.name).equals(norm(clean)) && catName.equalsIgnoreCase(x.category)
                                && (inSession == null || x.session == null || x.session.equalsIgnoreCase(inSession)))
                        .findFirst().orElse(null);
                if (k == null) {
                    warnings.add(clean + " is on the " + catName + " sheet but not on the Students sheet, so their row there was skipped.");
                    continue;
                }
                BigDecimal got = collected >= 0 ? money(cell(r, collected)) : null;
                if (got != null && got.compareTo(new BigDecimal("0.01")) >= 0) k.collected = got.setScale(0, RoundingMode.HALF_UP);
                k.ticked = !cell(r, name + 1).isEmpty();
                if (paidTo >= 0) k.paidTo = cell(r, paidTo);
                if (remark >= 0 && !cell(r, remark).isEmpty()) k.remark = cell(r, remark);
                BigDecimal f = fee >= 0 ? money(cell(r, fee)) : null;
                if (f != null && k.active) k.monthFee = f.compareTo(new BigDecimal("0.01")) < 0 ? BigDecimal.ZERO : f.setScale(0, RoundingMode.HALF_UP);
            }
        }

        // the online class: its own small sheet
        List<List<String>> on = sheets.entrySet().stream().filter(e -> e.getKey().toLowerCase().startsWith("online"))
                .map(Map.Entry::getValue).findFirst().orElse(List.of());
        int oh = find(on, r -> r.stream().anyMatch(x -> x.equalsIgnoreCase("Student Name")));
        if (oh >= 0) {
            List<String> header = on.get(oh);
            int name = indexOf(header, "Student Name"), country = indexOf(header, "Country");
            String mon = month.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
            int monCol = indexOf(header, mon);
            String onlineCat = "Online";
            for (int i = oh + 1; i < on.size(); i++) {
                List<String> r = on.get(i);
                String n = cell(r, name);
                if (n.isEmpty()) continue;
                Kid k = new Kid();
                k.name = n.trim();
                k.category = onlineCat;
                k.online = true;
                k.country = country >= 0 ? cell(r, country) : "";
                if (k.country.equalsIgnoreCase("To confirm")) { k.note = "Country to confirm"; k.country = ""; }
                if (monCol >= 0 && cell(r, monCol).toLowerCase().contains("done")) {
                    BigDecimal amt = money(cell(r, monCol + 1));
                    if (amt != null && amt.signum() > 0) {
                        k.collected = amt.setScale(0, RoundingMode.HALF_UP);
                        k.paidTo = "Shalom Academy";
                    } else {
                        warnings.add(k.name + " (online) is marked Done for " + mon + " with no amount, so no payment was added.");
                    }
                }
                kids.add(k);
            }
        }

        // the Dashboard's own totals, to check the import against
        Map<String, BigDecimal> dashMoney = new LinkedHashMap<>();
        Map<String, Integer> dashCount = new LinkedHashMap<>();
        Integer dashStudents = null;
        BigDecimal dashExpected = null, dashCollected = null;
        List<List<String>> d = sheets.getOrDefault("Dashboard", List.of());
        int where = find(d, r -> cell(r, 1).equalsIgnoreCase("WHERE THE MONEY IS"));
        if (where >= 0 && where + 3 < d.size()) {
            List<String> names = d.get(where + 1), amounts = d.get(where + 2);
            List<String> counts = find(d, r -> r.stream().anyMatch(x -> x.contains("payments"))) >= 0
                    ? d.get(find(d, r -> r.stream().anyMatch(x -> x.contains("payments")))) : List.of();
            for (int c = 0; c < names.size(); c++) {
                String n = cell(names, c);
                BigDecimal amt = money(cell(amounts, c));
                if (n.isEmpty() || amt == null) continue;
                dashMoney.put(n, amt);
                Matcher cm = Pattern.compile("(\\d+)\\s+payments").matcher(cell(counts, c));
                if (cm.find()) dashCount.put(n, Integer.parseInt(cm.group(1)));
            }
        }
        for (List<String> r : d) {
            String label = cell(r, 1);
            BigDecimal v = money(cell(r, 2));
            if (label.equalsIgnoreCase("Total number of students") && v != null) dashStudents = v.intValue();
            if (label.equalsIgnoreCase("Total expected monthly income")) dashExpected = v;
            if (label.equalsIgnoreCase("Total amount collected")) dashCollected = v;
        }
        return new Book(month, classFees, sessions, kids, dashMoney, dashCount, dashStudents, dashExpected, dashCollected, warnings);
    }

    private static YearMonth month(List<List<String>> dashboard) {
        Integer year = null;
        Month month = null;
        for (List<String> r : dashboard == null ? List.<List<String>>of() : dashboard) {
            for (int c = 0; c + 1 < r.size(); c++) {
                if (cell(r, c).equalsIgnoreCase("Year")) {
                    BigDecimal y = money(cell(r, c + 1));
                    if (y != null) year = y.intValue();
                }
                if (cell(r, c).equalsIgnoreCase("Month")) {
                    String m = cell(r, c + 1).trim();
                    for (Month x : Month.values()) {
                        if (x.getDisplayName(TextStyle.FULL, Locale.ENGLISH).equalsIgnoreCase(m)) month = x;
                    }
                }
            }
        }
        if (year == null || month == null) {
            throw ApiException.badRequest("The workbook's Dashboard does not say which month and year it is for.");
        }
        return YearMonth.of(year, month);
    }

    /* =========================================================
       Working out the changes
       ========================================================= */

    /** Everything needed to save, worked out once. */
    private record Plan(Preview preview, Map<String, Object> raw, List<Payment> payments, List<String> receiptIds,
                        String month, Map<String, BigDecimal> monthFees, Map<String, String> remarks) {}

    public Preview preview(byte[] xlsx) {
        return preview(XlsxReader.read(xlsx));
    }

    public Preview apply(byte[] xlsx) {
        return apply(XlsxReader.read(xlsx));
    }

    /** The workbook already read into rows (sheet name → rows). */
    public Preview preview(Map<String, List<List<String>>> sheets) {
        return plan(sheets, false).preview();
    }

    public synchronized Preview apply(Map<String, List<List<String>>> sheets) {
        Plan p = plan(sheets, true);
        // 1. receipts of the month (before the payments, which would otherwise be unlinked one by one)
        for (String id : p.receiptIds()) {
            try { receipts.delete(id, false); } catch (ApiException ignored) { /* already gone */ }
        }
        // 2. students, sessions and class fees
        roster.replaceRaw(p.raw());
        // 3. the month's payments
        payments.replaceAll(p.payments());
        // 4. the month itself, started afresh from the new students, then set to the workbook's fees
        List<MonthSheet> others = months.findAll().stream().filter(m -> !p.month().equals(m.month())).toList();
        months.replaceAll(others);
        MonthSheet sheet = monthService.start(p.month());
        for (MonthSheet.Due d : sheet.dues()) {
            BigDecimal want = p.monthFees().get(d.studentId());
            String remark = p.remarks().get(d.studentId());
            boolean feeDiffers = want != null && (d.fee() == null || d.fee().compareTo(want) != 0);
            if (feeDiffers || remark != null) {
                monthService.updateDue(p.month(), d.studentId(), new MonthService.DueUpdate(feeDiffers ? want : null, null, remark));
            }
        }
        Preview v = p.preview();
        return new Preview(v.month(), v.monthLabel(), true, v.checks(), v.students(), v.active(), v.added(), v.renamed(),
                v.moved(), v.fees(), v.inactivated(), v.reactivated(), v.sessionsAdded(), v.sessionsChanged(),
                v.sessionsRemoved(), v.classFees(), v.paymentsRemoved(), v.paymentsAdded(), v.byPaidTo(),
                v.receiptsRemoved(), v.warnings());
    }

    @SuppressWarnings("unchecked")
    private Plan plan(Map<String, List<List<String>>> sheets, boolean forSaving) {
        Book book = read(sheets);
        String month = book.month().toString();
        String monthLabel = book.month().getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " " + book.month().getYear();
        List<String> warnings = new ArrayList<>(book.warnings());
        if (book.kids().stream().noneMatch(k -> !k.online)) {
            throw ApiException.badRequest("No students were found on the workbook's Students sheet.");
        }

        Map<String, Object> raw = deepCopy(roster.raw());
        List<Map<String, Object>> appStudents = new ArrayList<>((List<Map<String, Object>>) raw.getOrDefault("students", new ArrayList<>()));
        Roster current = roster.load();
        Map<String, Roster.Student> byId = new HashMap<>();
        current.students().forEach(s -> byId.put(s.id(), s));

        // ---- match the workbook's children to the app's ----
        // by identity: the records change as they are filled in, so they cannot be told apart by content
        Set<Map<String, Object>> taken = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        for (Kid k : book.kids()) {            // exact names first
            for (Map<String, Object> s : appStudents) {
                if (!taken.contains(s) && norm(str(s.get("name"))).equals(norm(k.name))) { k.app = s; taken.add(s); break; }
            }
        }
        record Candidate(Kid kid, Map<String, Object> app, double score) {}
        List<Candidate> cands = new ArrayList<>();
        for (Kid k : book.kids()) {            // then close spellings of the same child
            if (k.app != null) continue;
            for (Map<String, Object> s : appStudents) {
                if (taken.contains(s)) continue;
                double score = likeness(k, s);
                if (score > 0) cands.add(new Candidate(k, s, score));
            }
        }
        cands.sort(Comparator.comparingDouble(Candidate::score).reversed());
        List<Rename> renamed = new ArrayList<>();
        for (Candidate c : cands) {
            if (c.kid().app != null || taken.contains(c.app())) continue;
            c.kid().app = c.app();
            taken.add(c.app());
            renamed.add(new Rename(str(c.app().get("name")), c.kid().name, c.kid().online ? "Online" : c.kid().session));
        }

        // ---- the new students list: the workbook's order, then everyone else switched off ----
        int next = nextNumber(appStudents);
        List<Map<String, Object>> out = new ArrayList<>();
        List<String> added = new ArrayList<>(), inactivated = new ArrayList<>(), reactivated = new ArrayList<>();
        List<Move> moved = new ArrayList<>();
        List<FeeChange> fees = new ArrayList<>();
        Map<String, SessionRow> sessionByName = new HashMap<>();
        book.sessions().forEach(s -> sessionByName.put(s.name().toLowerCase(), s));
        Set<String> seenNames = new HashSet<>();
        for (Kid k : book.kids()) {
            if (!seenNames.add(norm(k.name))) {
                warnings.add(k.name + " is on the workbook twice; only the first row was used.");
                continue;
            }
            Map<String, Object> s = k.app != null ? k.app : new LinkedHashMap<>();
            if (k.app == null) {
                s.put("id", "s" + (appStudents.size() + out.size() + 1));
                s.put("key", randomKey());
                s.put("sapaId", "SAPA-" + (next++));
                added.add(k.name + (k.online ? " (Online)" : " (" + k.session + ")"));
            } else {
                Roster.Student before = byId.get(str(s.get("sapaId")));
                String oldSession = str(s.get("className"));
                String newSession = k.online ? "" : nz(k.session);
                if (!k.online && !oldSession.equalsIgnoreCase(newSession)) {
                    moved.add(new Move(k.name, oldSession.isEmpty() ? "no session" : oldSession, newSession));
                }
                if (before != null && !before.active() && k.active) reactivated.add(k.name);
                if (before != null && k.active && !k.online) {
                    BigDecimal was = before.fee();
                    BigDecimal now = k.special != null ? k.special : book.classFees().get(k.category);
                    if (now != null && (was == null || was.compareTo(now) != 0)) {
                        fees.add(new FeeChange(k.name, was == null ? "—" : "Rs. " + plain(was), "Rs. " + plain(now)));
                    }
                }
            }
            s.put("name", k.name);
            s.put("category", k.category);
            if (k.online) {
                s.remove("className");
                if (!nz(k.country).isEmpty()) s.put("country", k.country);
            } else {
                s.put("className", k.session);
                SessionRow sr = sessionByName.get(nz(k.session).toLowerCase());
                if (sr != null) {
                    s.put("classDay", sr.day());
                    s.put("classTime", sr.time());
                }
            }
            if (k.special == null) s.remove("specialFee"); else s.put("specialFee", k.special);
            BigDecimal fee = k.online ? null : k.special != null ? k.special : book.classFees().get(k.category);
            if (fee == null) s.remove("fee"); else s.put("fee", fee);
            s.put("active", k.active);
            if (!nz(k.note).isEmpty()) s.put("note", k.note);
            out.add(s);
        }
        for (Map<String, Object> s : appStudents) {
            if (taken.contains(s)) continue;
            if (!Boolean.FALSE.equals(s.get("active"))) inactivated.add(str(s.get("name")));
            s.put("active", false);
            out.add(s);
        }
        raw.put("students", out);

        // ---- sessions ----
        List<Map<String, Object>> oldClasses = (List<Map<String, Object>>) raw.getOrDefault("classes", new ArrayList<>());
        List<Map<String, Object>> classes = new ArrayList<>();
        List<String> sAdded = new ArrayList<>(), sChanged = new ArrayList<>(), sRemoved = new ArrayList<>();
        for (SessionRow r : book.sessions()) {
            Map<String, Object> old = oldClasses.stream().filter(c -> r.name().equalsIgnoreCase(str(c.get("name")))).findFirst().orElse(null);
            Map<String, Object> c = old == null ? new LinkedHashMap<>() : new LinkedHashMap<>(old);
            c.put("name", r.name());
            c.put("category", titleOf(r.category(), book.classFees().keySet()));
            c.put("day", r.day());
            c.put("time", r.time());
            if (r.max() == null || r.max() <= 0) c.remove("max"); else c.put("max", r.max());
            if (!nz(r.meaning()).isEmpty()) c.put("meaning", r.meaning());
            if (old == null) {
                sAdded.add(r.name() + " · " + r.day() + " " + r.time());
            } else {
                List<String> what = new ArrayList<>();
                if (!r.day().equalsIgnoreCase(str(old.get("day"))) || !r.time().equalsIgnoreCase(str(old.get("time")))) {
                    what.add(str(old.get("day")) + " " + str(old.get("time")) + " → " + r.day() + " " + r.time());
                }
                if (!Objects.equals(r.max(), old.get("max") == null ? null : ((Number) old.get("max")).intValue())) {
                    what.add("places " + (old.get("max") == null ? "—" : old.get("max")) + " → " + (r.max() == null ? "no limit" : r.max()));
                }
                if (!what.isEmpty()) sChanged.add(r.name() + ": " + String.join(", ", what));
            }
            classes.add(c);
        }
        for (Map<String, Object> old : oldClasses) {
            if (book.sessions().stream().noneMatch(r -> r.name().equalsIgnoreCase(str(old.get("name"))))) sRemoved.add(str(old.get("name")));
        }
        raw.put("classes", classes);

        // ---- class fees ----
        List<String> classFees = new ArrayList<>();
        List<Map<String, Object>> cats = new ArrayList<>();
        for (Map<String, Object> c : (List<Map<String, Object>>) raw.getOrDefault("categories", new ArrayList<>())) cats.add(new LinkedHashMap<>(c));
        for (Map.Entry<String, BigDecimal> e : book.classFees().entrySet()) {
            Map<String, Object> c = cats.stream().filter(x -> e.getKey().equalsIgnoreCase(str(x.get("name")))).findFirst().orElse(null);
            if (c == null) {
                c = new LinkedHashMap<>();
                c.put("name", e.getKey());
                c.put("billing", "monthly");
                c.put("usesSessions", true);
                cats.add(c);
            }
            Roster.Category had = current.categories().stream().filter(x -> x.name().equalsIgnoreCase(e.getKey())).findFirst().orElse(null);
            BigDecimal was = had == null ? null : had.feeOn(month);
            if (was == null || was.compareTo(e.getValue()) != 0) {
                classFees.add(e.getKey() + ": " + (was == null ? "—" : "Rs. " + plain(was)) + " → Rs. " + plain(e.getValue()));
            }
            c.put("fee", e.getValue());
            // a fee change already scheduled up to this month would override the workbook's fee
            if (c.get("changes") instanceof List<?> l) {
                List<Object> keep = new ArrayList<>();
                for (Object o : l) if (o instanceof Map<?, ?> m && String.valueOf(m.get("from")).compareTo(month) > 0) keep.add(o);
                if (keep.isEmpty()) c.remove("changes"); else c.put("changes", keep);
            }
        }
        boolean hasOnline = book.kids().stream().anyMatch(k -> k.online);
        if (hasOnline && cats.stream().noneMatch(x -> "Online".equalsIgnoreCase(str(x.get("name"))))) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("name", "Online");
            c.put("fee", null);
            c.put("billing", "payg");
            c.put("usesSessions", false);
            cats.add(c);
        }
        raw.put("categories", cats);

        // ---- the month's payments ----
        List<Payment> all = payments.findAll();
        List<Payment> removed = all.stream().filter(p -> month.equals(p.month())).toList();
        List<Payment> kept = new ArrayList<>(all.stream().filter(p -> !month.equals(p.month())).toList());
        List<String> options = settings.get().paidToOptions();
        String today = MonthService.today();
        Instant now = Instant.now();
        List<Payment> added_ = new ArrayList<>();
        Map<String, BigDecimal> monthFees = new HashMap<>();
        Map<String, String> remarks = new HashMap<>();
        for (Kid k : book.kids()) {
            Map<String, Object> s = out.stream().filter(x -> norm(str(x.get("name"))).equals(norm(k.name))).findFirst().orElse(null);
            if (s == null) continue;
            String id = str(s.get("sapaId"));
            if (k.active && !k.online && k.monthFee != null) monthFees.put(id, k.monthFee);
            if (!nz(k.remark).isEmpty()) remarks.put(id, k.remark);
            if (k.collected.signum() <= 0) continue;
            String paidTo = options.stream().filter(o -> o.equalsIgnoreCase(nz(k.paidTo).trim())).findFirst()
                    .orElse(nz(k.paidTo).isBlank() ? (options.isEmpty() ? "Shalom Academy" : options.getFirst()) : k.paidTo.trim());
            // the day it was paid: kept from the app's own record of it, when there was one
            String date = removed.stream().filter(p -> id.equals(p.studentId())).map(Payment::date).filter(Objects::nonNull)
                    .findFirst().orElse(today);
            added_.add(new Payment(newId(), id, k.name, month, Payment.MONTHLY, k.collected, paidTo, date,
                    k.online ? "From the Online Class sheet" : null, null, null, now));
        }
        kept.addAll(added_);

        // ---- the month's receipts ----
        String monthName = book.month().getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
        List<Receipt> monthReceipts = receipts.list().stream()
                .filter(r -> monthLabel.equalsIgnoreCase(nz(r.period()))
                        || (monthName.equalsIgnoreCase(nz(r.month())) && Integer.valueOf(book.month().getYear()).equals(r.year())))
                .toList();

        // ---- checks against the workbook's Dashboard ----
        List<Check> checks = new ArrayList<>();
        List<Kid> classKids = book.kids().stream().filter(k -> !k.online).toList();
        int activeKids = (int) classKids.stream().filter(k -> k.active).count();
        if (book.dashStudents() != null) {
            checks.add(new Check("Active students (classes)", String.valueOf(book.dashStudents()), String.valueOf(activeKids),
                    book.dashStudents() == activeKids));
        }
        BigDecimal expected = classKids.stream().filter(k -> k.active && k.monthFee != null).map(k -> k.monthFee).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (book.dashExpected() != null) {
            checks.add(new Check("Expected this month", "Rs. " + plain(book.dashExpected()), "Rs. " + plain(expected),
                    book.dashExpected().compareTo(expected) == 0));
        }
        List<Payment> classPayments = added_.stream().filter(p -> p.note() == null).toList();
        BigDecimal collected = classPayments.stream().map(Payment::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (book.dashCollected() != null) {
            checks.add(new Check("Collected", "Rs. " + plain(book.dashCollected()), "Rs. " + plain(collected),
                    book.dashCollected().compareTo(collected) == 0));
        }
        for (Map.Entry<String, BigDecimal> e : book.dashMoney().entrySet()) {
            List<Payment> to = classPayments.stream().filter(p -> e.getKey().equalsIgnoreCase(p.paidTo())).toList();
            BigDecimal amt = to.stream().map(Payment::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
            Integer wantCount = book.dashCount().get(e.getKey());
            // the workbook counts a free place ticked as paid as a payment (of Rs.0); the app does not
            long freeTicks = wantCount == null ? 0 : classKids.stream().filter(k -> k.active && k.monthFee != null && k.monthFee.signum() == 0
                    && e.getKey().equalsIgnoreCase(nz(k.paidTo)) && k.collected.signum() == 0 && k.ticked).count();
            boolean countOk = wantCount == null || wantCount == to.size() || wantCount == to.size() + freeTicks;
            checks.add(new Check("Paid to " + e.getKey(),
                    "Rs. " + plain(e.getValue()) + (wantCount == null ? "" : " · " + wantCount + " payments"),
                    "Rs. " + plain(amt) + " · " + to.size() + " payments",
                    e.getValue().compareTo(amt) == 0 && countOk));
        }
        classKids.stream().filter(k -> k.active && k.monthFee != null && k.monthFee.signum() == 0)
                .forEach(k -> warnings.add(k.name + " has a free place (fee Rs.0): shown as \"Free place\", with no payment."));
        long onlinePaid = added_.stream().filter(p -> p.note() != null).count();
        if (onlinePaid > 0) {
            warnings.add(onlinePaid + " online payment(s) were read from the Online Class sheet (the amount beside \""
                    + book.month().getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + "\"), paid to Shalom Academy. They are not in the Dashboard's totals.");
        }

        Map<String, PaidTo> byPaidTo = new LinkedHashMap<>();
        for (Payment p : added_) {
            PaidTo t = byPaidTo.getOrDefault(p.paidTo(), new PaidTo(p.paidTo(), 0, BigDecimal.ZERO));
            byPaidTo.put(p.paidTo(), new PaidTo(p.paidTo(), t.count() + 1, t.amount().add(p.amount())));
        }

        int activeAll = (int) out.stream().filter(s -> !Boolean.FALSE.equals(s.get("active"))).count();
        Preview preview = new Preview(month, monthLabel, false, checks, out.size(), activeAll, added, renamed, moved, fees,
                inactivated, reactivated, sAdded, sChanged, sRemoved, classFees,
                new Money(removed.size(), sum(removed)), new Money(added_.size(), sum(added_)),
                List.copyOf(byPaidTo.values()),
                monthReceipts.stream().map(r -> nz(r.number()) + " · " + nz(r.student())).toList(), warnings);
        return new Plan(preview, raw, kept, monthReceipts.stream().map(Receipt::id).toList(), month, monthFees, remarks);
    }

    /* =========================================================
       Helpers
       ========================================================= */

    /**
     * How sure we are that a workbook name and an app record are the same child: 0 = not.
     * A close spelling ("Himath Mandiv" / "Himath Mandinu"), or a short name that is the start of
     * the full one in the same class ("Sethula" / "Sethula Perera").
     */
    private static double likeness(Kid k, Map<String, Object> s) {
        String a = norm(k.name), b = norm(str(s.get("name")));
        if (a.isEmpty() || b.isEmpty()) return 0;
        boolean sameClass = nz(k.category).equalsIgnoreCase(str(s.get("category")));
        String[] wa = a.split(" "), wb = b.split(" ");
        double ratio = 1 - (double) distance(a, b) / Math.max(a.length(), b.length());
        if (wa[0].equals(wb[0]) && ratio >= 0.72) return ratio + (sameClass ? 0.1 : 0);
        if (ratio >= 0.86) return ratio + (sameClass ? 0.1 : 0);
        if (sameClass && (wa.length == 1 || wb.length == 1) && wa[0].equals(wb[0])) return 0.7;
        return 0;
    }

    private static int distance(String a, String b) {
        int[] prev = new int[b.length() + 1], cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1));
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[b.length()];
    }

    /** "K. N. Kenuka" and "K.N.  Kenuka" read the same; a note in brackets is not part of the name. */
    static String norm(String name) {
        String n = nz(name);
        Matcher m = NOTE_IN_NAME.matcher(n);
        if (m.matches()) n = m.group(1);
        return n.toLowerCase(Locale.ROOT).replace('.', ' ').replaceAll("\\s+", " ").trim();
    }

    private static int nextNumber(List<Map<String, Object>> students) {
        int max = 999;
        for (Map<String, Object> s : students) {
            String id = str(s.get("sapaId"));
            if (id.matches("SAPA-\\d+")) max = Math.max(max, Integer.parseInt(id.substring(5)));
        }
        return max + 1;
    }

    private static String newId() {
        SecureRandom r = new SecureRandom();
        StringBuilder sb = new StringBuilder("p");
        for (int i = 0; i < 16; i++) sb.append("0123456789abcdef".charAt(r.nextInt(16)));
        return sb.toString();
    }

    private static String randomKey() {
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 6; i++) sb.append(alphabet.charAt(rnd.nextInt(alphabet.length())));
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> deepCopy(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        in.forEach((k, v) -> out.put(k, copy(v)));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Object copy(Object v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> o = new LinkedHashMap<>();
            m.forEach((k, x) -> o.put(String.valueOf(k), copy(x)));
            return o;
        }
        if (v instanceof List<?> l) {
            List<Object> o = new ArrayList<>();
            l.forEach(x -> o.add(copy(x)));
            return o;
        }
        return v;
    }

    private static List<List<String>> sheet(Map<String, List<List<String>>> sheets, String name) {
        List<List<String>> s = sheets.get(name);
        if (s == null) throw ApiException.badRequest("The workbook has no \"" + name + "\" sheet. Is it the monthly fee workbook?");
        return s;
    }

    private static int find(List<List<String>> rows, java.util.function.Predicate<List<String>> test) {
        for (int i = 0; i < rows.size(); i++) if (test.test(rows.get(i))) return i;
        return -1;
    }

    private static int indexOf(List<String> header, String name) {
        for (int i = 0; i < header.size(); i++) if (header.get(i).trim().equalsIgnoreCase(name)) return i;
        return -1;
    }

    private static String cell(List<String> row, int i) {
        return i >= 0 && i < row.size() && row.get(i) != null ? row.get(i).trim() : "";
    }

    private static BigDecimal money(String s) {
        if (s == null) return null;
        String t = s.replace(",", "").replace("Rs.", "").trim();
        if (t.isEmpty()) return null;
        try { return new BigDecimal(t); } catch (NumberFormatException e) { return null; }
    }

    private static BigDecimal sum(List<Payment> ps) {
        return ps.stream().map(Payment::amount).filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static String plain(BigDecimal b) {
        return String.format(Locale.ENGLISH, "%,d", b.setScale(0, RoundingMode.HALF_UP).longValue());
    }

    /** "KIDS" → "Kids", matching a class the workbook already names. */
    private static String titleOf(String word, Set<String> known) {
        return known.stream().filter(k -> k.equalsIgnoreCase(word)).findFirst().orElse(title(word));
    }

    private static String title(String s) {
        String t = nz(s).toLowerCase(Locale.ROOT);
        return t.isEmpty() ? t : Character.toUpperCase(t.charAt(0)) + t.substring(1);
    }

    private static String join(String a, String b) {
        if (nz(a).isEmpty()) return nz(b);
        if (nz(b).isEmpty()) return nz(a);
        return a + " · " + b;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

}
