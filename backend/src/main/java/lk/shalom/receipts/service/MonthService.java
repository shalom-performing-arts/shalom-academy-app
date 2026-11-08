package lk.shalom.receipts.service;

import lk.shalom.receipts.model.MonthSheet;
import lk.shalom.receipts.model.MonthSheet.Due;
import lk.shalom.receipts.model.Payment;
import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.repository.MonthRepository;
import lk.shalom.receipts.repository.PaymentRepository;
import lk.shalom.receipts.repository.RosterRepository;
import lk.shalom.receipts.repository.SettingsRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Fee months: who owes what, who has paid, and the totals the workbook's Dashboard showed.
 *
 * <p>A month copies each active student's fee and session when it starts, like copying the
 * workbook for a new month. After that, changes on the Students page reach the <em>newest</em>
 * month only, and only for students who have not paid anything in it yet, so a fee change in
 * December never rewrites November.
 */
@Service
public class MonthService {

    public static final String PAID = "Paid";
    public static final String PARTIAL = "Partially Paid";
    public static final String PENDING = "Pending";
    public static final String FREE = "Free place";
    public static final String INACTIVE = "Inactive";
    public static final String NOT_DUE = "Not due";

    private final MonthRepository months;
    private final PaymentRepository payments;
    private final RosterRepository roster;
    private final SettingsRepository settings;

    public MonthService(MonthRepository months, PaymentRepository payments, RosterRepository roster,
                        SettingsRepository settings) {
        this.months = months;
        this.payments = payments;
        this.roster = roster;
        this.settings = settings;
    }

    /* ---------------- month keys ---------------- */

    /** "2026-11", after checking it is one. */
    public static String check(String month) {
        if (month == null || !month.matches("\\d{4}-(0[1-9]|1[0-2])")) {
            throw ApiException.badRequest("A month looks like 2026-11.");
        }
        return month;
    }

    /** ("November", 2026) → "2026-11". */
    public static String key(String monthName, Integer year) {
        int m = ReceiptService.MONTHS.indexOf(monthName);
        if (m < 0 || year == null) return null;
        return YearMonth.of(year, m + 1).toString();
    }

    /** "2026-11" → "November 2026". */
    public static String label(String month) {
        YearMonth ym = YearMonth.parse(month);
        return ReceiptService.MONTHS.get(ym.getMonthValue() - 1) + " " + ym.getYear();
    }

    /* ---------------- starting and keeping months up to date ---------------- */

    /** Starts the month from the roster as it is now, if it has not been started. */
    public synchronized MonthSheet start(String month) {
        check(month);
        return months.find(month).orElseGet(() -> {
            Roster r = roster.load();
            List<Due> dues = r.students().stream()
                    .filter(Student::active)
                    .map(s -> dueFor(r, s, month))
                    .toList();
            MonthSheet created = months.save(new MonthSheet(month, Instant.now(), dues));
            return syncIfNewest(created);
        });
    }

    /** Makes sure the student has a line in the month, as one does once money arrives for them. */
    public synchronized void ensureDue(String month, String studentId) {
        if (studentId == null) return;
        MonthSheet sheet = start(month);
        if (sheet.dues().stream().anyMatch(d -> studentId.equals(d.studentId()))) return;
        Roster r = roster.load();
        r.students().stream().filter(s -> studentId.equals(s.id())).findFirst().ifPresent(s -> {
            List<Due> dues = new ArrayList<>(sheet.dues());
            dues.add(dueFor(r, s, month));
            months.save(new MonthSheet(month, sheet.createdAt(), dues));
        });
    }

    /**
     * A class or session was renamed: every month follows, so old months still show under the
     * class's current name. {@code field} is "category" or "session".
     */
    public synchronized void renameEverywhere(String field, String from, String to) {
        List<MonthSheet> all = months.findAll();
        List<MonthSheet> out = new ArrayList<>();
        for (MonthSheet m : all) {
            out.add(new MonthSheet(m.month(), m.createdAt(), m.dues().stream().map(d -> {
                if ("category".equals(field) && from.equalsIgnoreCase(String.valueOf(d.category()))) return d.withPlace(to, d.session());
                if ("session".equals(field) && from.equalsIgnoreCase(String.valueOf(d.session()))) return d.withPlace(d.category(), to);
                return d;
            }).toList()));
        }
        months.replaceAll(out);
    }

    /** Brings the newest month in line with the Students page. Called after every roster change. */
    public synchronized void syncNewest() {
        List<String> all = months.months();
        if (!all.isEmpty()) months.find(all.getLast()).ifPresent(this::syncIfNewest);
    }

    private MonthSheet syncIfNewest(MonthSheet sheet) {
        List<String> all = months.months();
        if (all.isEmpty() || !all.getLast().equals(sheet.month())) return sheet;

        Set<String> hasPaid = payments.findByMonth(sheet.month()).stream()
                .map(Payment::studentId).filter(Objects::nonNull).collect(Collectors.toSet());
        Roster r = roster.load();
        Map<String, Student> students = r.students().stream()
                .collect(Collectors.toMap(Student::id, Function.identity(), (a, b) -> a, LinkedHashMap::new));

        List<Due> out = new ArrayList<>();
        Set<String> present = new HashSet<>();
        boolean changed = false;
        for (Due d : sheet.dues()) {
            Student s = students.get(d.studentId());
            present.add(d.studentId());
            if (s == null) {
                // removed from the roster: keep the line only if they paid something
                if (hasPaid.contains(d.studentId())) out.add(d); else changed = true;
                continue;
            }
            boolean keepFee = hasPaid.contains(d.studentId()) || d.feeOverridden();
            Due fresh = dueFor(r, s, sheet.month());
            Due next = new Due(d.studentId(), s.name(), s.category(), s.session(),
                    keepFee ? d.fee() : fresh.fee(), s.active(), d.feeOverridden(), d.remark(),
                    keepFee ? d.discount() : fresh.discount(), keepFee ? d.notBilled() : fresh.notBilled());
            if (!next.equals(d)) changed = true;
            out.add(next);
        }
        for (Student s : students.values()) {
            if (s.active() && !present.contains(s.id())) {
                out.add(dueFor(r, s, sheet.month()));
                changed = true;
            }
        }
        return changed ? months.save(new MonthSheet(sheet.month(), sheet.createdAt(), out)) : sheet;
    }

    private Due dueFor(Roster r, Student s, String month) {
        FeeRules.Fee f = FeeRules.forMonth(r, s, month, settings.get().siblingDiscount());
        return new Due(s.id(), s.name(), s.category(), s.session(), f.fee(), s.active(), false, "",
                f.discount(), f.notBilled());
    }

    /** Changes one student's fee for this month only, and/or the month's remark for them. */
    public synchronized void updateDue(String month, String studentId, DueUpdate update) {
        start(month);
        ensureDue(month, studentId);
        MonthSheet sheet = months.find(month).orElseThrow();
        List<Due> dues = new ArrayList<>();
        boolean found = false;
        for (Due d : sheet.dues()) {
            if (studentId.equals(d.studentId())) {
                found = true;
                if (update.resetFee()) {
                    Roster r = roster.load();
                    Due current = d;
                    d = r.students().stream().filter(s -> s.id().equals(studentId)).findFirst()
                            .map(s -> dueFor(r, s, month))
                            .map(f -> new Due(current.studentId(), current.name(), current.category(), current.session(),
                                    f.fee(), current.active(), false, current.remark(), f.discount(), f.notBilled()))
                            .orElse(d.withFee(d.fee(), false));
                } else if (update.fee() != null) {
                    if (update.fee().signum() < 0) throw ApiException.badRequest("A fee cannot be negative.");
                    d = d.withFee(update.fee(), true);
                }
                if (update.remark() != null) d = d.withRemark(update.remark().trim());
            }
            dues.add(d);
        }
        if (!found) throw ApiException.notFound("That student is not in " + label(month) + ".");
        months.save(new MonthSheet(month, sheet.createdAt(), dues));
    }

    public record DueUpdate(BigDecimal fee, Boolean reset, String remark) {
        boolean resetFee() {
            return Boolean.TRUE.equals(reset);
        }
    }

    /* ---------------- the month view ---------------- */

    /** One student's month. {@code discount} is the sibling discount already taken off {@code fee}. */
    public record Row(String studentId, String name, String category, String session, String day, String time,
                      BigDecimal fee, BigDecimal paid, BigDecimal extra, BigDecimal outstanding, String status,
                      boolean active, boolean feeOverridden, String remark, String parent, String phone,
                      String country, List<Payment> payments, BigDecimal discount, String family) {}

    public record PaidTo(String name, BigDecimal amount, int count) {}

    public record Totals(int students, BigDecimal expected, BigDecimal collected, BigDecimal outstanding,
                         double completion, BigDecimal other, int paid, int partial, int pending, int free,
                         int inactive, int notDue, List<PaidTo> byPaidTo) {}

    public record CategoryTotal(String name, int students, BigDecimal expected, BigDecimal collected,
                                BigDecimal outstanding, int paid, int toPay, Integer freePlaces,
                                Map<String, BigDecimal> byPaidTo) {}

    public record SessionTotal(String name, String category, String day, String time, String meaning,
                               Integer max, int students, Integer free, BigDecimal expected, BigDecimal collected) {}

    public record MonthView(String month, String label, boolean started, boolean newest, List<String> months,
                            List<Row> rows, Totals totals, List<CategoryTotal> categories,
                            List<SessionTotal> sessions, List<Payment> unmatched, List<String> paidToOptions) {}

    public synchronized MonthView view(String month) {
        check(month);
        Roster r = roster.load();
        MonthSheet sheet = months.find(month).map(this::syncIfNewest).orElse(null);
        boolean started = sheet != null;
        // a month not started yet is shown as it would start, without saving anything
        List<Due> dues = started ? sheet.dues()
                : r.students().stream().filter(Student::active).map(s -> dueFor(r, s, month)).toList();
        List<Payment> monthPayments = payments.findByMonth(month);
        Map<String, List<Payment>> byStudent = monthPayments.stream().filter(p -> p.studentId() != null)
                .collect(Collectors.groupingBy(Payment::studentId));
        Map<String, Student> students = r.students().stream()
                .collect(Collectors.toMap(Student::id, Function.identity(), (a, b) -> a));

        // order as the workbook does: class, then session, then the roster's own order
        Map<String, Integer> studentOrder = new HashMap<>();
        for (int i = 0; i < r.students().size(); i++) studentOrder.put(r.students().get(i).id(), i);
        Map<String, Integer> sessionOrder = new HashMap<>();
        for (int i = 0; i < r.sessions().size(); i++) sessionOrder.put(r.sessions().get(i).name().toLowerCase(), i);
        List<String> categoryNames = r.categories().stream().map(Roster.Category::name).toList();

        List<Row> rows = new ArrayList<>();
        for (Due d : dues) {
            Student s = students.get(d.studentId());
            List<Payment> ps = byStudent.getOrDefault(d.studentId(), List.of()).stream()
                    .sorted(Comparator.comparing(Payment::date, Comparator.nullsLast(Comparator.naturalOrder()))).toList();
            BigDecimal paid = sum(ps.stream().filter(p -> Payment.MONTHLY.equals(p.kind())));
            BigDecimal extra = sum(ps.stream().filter(p -> !Payment.MONTHLY.equals(p.kind())));
            String status = status(d, paid);
            BigDecimal owing = !d.active() || d.fee() == null ? BigDecimal.ZERO : d.fee().subtract(paid).max(BigDecimal.ZERO);
            rows.add(new Row(d.studentId(), d.name(), d.category(), d.session(),
                    s == null ? "" : s.day(), s == null ? "" : s.time(),
                    d.fee(), paid, extra, owing, status, d.active(), d.feeOverridden(),
                    d.remark() == null ? "" : d.remark(),
                    s == null ? "" : s.parent(), s == null ? "" : s.phone(), s == null ? "" : s.country(), ps,
                    d.discount() == null ? BigDecimal.ZERO : d.discount(), s == null ? "" : s.family()));
        }
        rows.sort(Comparator
                .comparingInt((Row x) -> indexOr(categoryNames, x.category()))
                .thenComparingInt(x -> sessionOrder.getOrDefault(String.valueOf(x.session()).toLowerCase(), 999))
                .thenComparingInt(x -> studentOrder.getOrDefault(x.studentId(), 9999)));

        Set<String> known = rows.stream().map(Row::studentId).collect(Collectors.toSet());
        List<Payment> unmatched = monthPayments.stream()
                .filter(p -> p.studentId() == null || !known.contains(p.studentId())).toList();

        List<String> started_ = months.months();
        boolean newest = started && !started_.isEmpty() && started_.getLast().equals(month);
        return new MonthView(month, label(month), started, newest, started_, rows,
                totals(rows, monthPayments), categories(r, rows, monthPayments), sessions(r, rows),
                unmatched, settings.get().paidToOptions());
    }

    static String status(Due d, BigDecimal paid) {
        if (!d.active()) return INACTIVE;
        if (d.notDueThisMonth() && paid.signum() == 0) return NOT_DUE;   // a term class, between terms
        if (d.fee() == null) return paid.signum() > 0 ? PAID : PENDING;   // pays as they go
        if (d.fee().signum() == 0) return FREE;
        if (paid.compareTo(d.fee()) >= 0) return PAID;
        return paid.signum() > 0 ? PARTIAL : PENDING;
    }

    private static Totals totals(List<Row> rows, List<Payment> monthPayments) {
        List<Row> active = rows.stream().filter(Row::active).toList();
        BigDecimal expected = sum(active.stream().map(x -> x.fee() == null ? BigDecimal.ZERO : x.fee()));
        BigDecimal collected = sum(monthPayments.stream().filter(p -> Payment.MONTHLY.equals(p.kind())));
        BigDecimal other = sum(monthPayments.stream().filter(p -> !Payment.MONTHLY.equals(p.kind())));
        BigDecimal outstanding = sum(rows.stream().map(Row::outstanding));
        double completion = expected.signum() == 0 ? 0
                : collected.min(expected).divide(expected, 4, RoundingMode.HALF_UP).doubleValue();
        Map<String, PaidTo> byPaidTo = new LinkedHashMap<>();
        for (Payment p : monthPayments) {
            String k = p.paidTo() == null || p.paidTo().isBlank() ? "Not recorded" : p.paidTo();
            PaidTo old = byPaidTo.getOrDefault(k, new PaidTo(k, BigDecimal.ZERO, 0));
            byPaidTo.put(k, new PaidTo(k, old.amount().add(nz(p.amount())), old.count() + 1));
        }
        return new Totals(active.size(), expected, collected, outstanding, completion, other,
                count(rows, PAID), count(rows, PARTIAL), count(rows, PENDING), count(rows, FREE), count(rows, INACTIVE),
                count(rows, NOT_DUE), List.copyOf(byPaidTo.values()));
    }

    private static List<CategoryTotal> categories(Roster r, List<Row> rows, List<Payment> monthPayments) {
        Map<String, String> categoryOf = rows.stream()
                .collect(Collectors.toMap(Row::studentId, x -> String.valueOf(x.category()), (a, b) -> a));
        List<CategoryTotal> out = new ArrayList<>();
        for (Roster.Category c : r.categories()) {
            List<Row> in = rows.stream().filter(x -> c.name().equalsIgnoreCase(x.category())).toList();
            List<Row> active = in.stream().filter(Row::active).toList();
            Map<String, BigDecimal> byPaidTo = new LinkedHashMap<>();
            for (Payment p : monthPayments) {
                if (Payment.MONTHLY.equals(p.kind()) && c.name().equalsIgnoreCase(categoryOf.get(p.studentId()))) {
                    byPaidTo.merge(p.paidTo() == null ? "Not recorded" : p.paidTo(), nz(p.amount()), BigDecimal::add);
                }
            }
            Integer free = r.sessions().stream().filter(s -> c.name().equalsIgnoreCase(s.category()) && s.max() != null)
                    .map(s -> Math.max(0, s.max() - activeIn(r, s.name()))).reduce(Integer::sum).orElse(null);
            out.add(new CategoryTotal(c.name(), active.size(),
                    sum(active.stream().map(x -> x.fee() == null ? BigDecimal.ZERO : x.fee())),
                    sum(in.stream().map(Row::paid)),
                    sum(in.stream().map(Row::outstanding)),
                    count(in, PAID),
                    count(in, PENDING) + count(in, PARTIAL),
                    free, byPaidTo));
        }
        return out;
    }

    private static List<SessionTotal> sessions(Roster r, List<Row> rows) {
        return r.sessions().stream().map(s -> {
            List<Row> in = rows.stream().filter(x -> s.name().equalsIgnoreCase(x.session()) && x.active()).toList();
            int now = activeIn(r, s.name());
            return new SessionTotal(s.name(), s.category(), s.day(), s.time(), s.meaning(), s.max(), now,
                    s.max() == null ? null : s.max() - now,
                    sum(in.stream().map(x -> x.fee() == null ? BigDecimal.ZERO : x.fee())),
                    sum(in.stream().map(Row::paid)));
        }).toList();
    }

    private static int activeIn(Roster r, String session) {
        return (int) r.students().stream().filter(st -> st.active() && session.equalsIgnoreCase(st.session())).count();
    }

    /* ---------------- export ---------------- */

    /** The month as a CSV that opens in Excel or Google Sheets, one row per student. */
    public String csv(String month) {
        MonthView v = view(month);
        Map<String, String> typeName = new HashMap<>();
        settings.get().feeTypes().forEach(t -> typeName.put(t.id(), t.name()));
        List<String> lines = new ArrayList<>();
        lines.add(row(Stream.of("Class", "Session", "Student", "Student ID", "Status", "Fee", "Paid", "Still to pay",
                "Paid to", "Date paid", "Receipt", "Other payments", "Remark")));
        for (Row x : v.rows()) {
            List<Payment> fees = x.payments().stream().filter(p -> Payment.MONTHLY.equals(p.kind())).toList();
            lines.add(row(Stream.of(x.category(), x.session(), x.name(), x.studentId(), x.status(),
                    plain(x.fee()), plain(x.paid()), plain(x.outstanding()),
                    fees.stream().map(Payment::paidTo).filter(Objects::nonNull).distinct().collect(Collectors.joining(", ")),
                    fees.stream().map(Payment::date).filter(Objects::nonNull).distinct().collect(Collectors.joining(", ")),
                    x.payments().stream().map(Payment::receiptNumber).filter(Objects::nonNull).distinct().collect(Collectors.joining(", ")),
                    x.payments().stream().filter(p -> !Payment.MONTHLY.equals(p.kind()))
                            .map(p -> (p.note() != null && !p.note().isBlank() && Payment.OTHER.equals(p.kind())
                                    ? p.note() : typeName.getOrDefault(p.kind(), "Other")) + " " + plain(p.amount()))
                            .collect(Collectors.joining(", ")),
                    x.remark())));
        }
        return "﻿" + String.join("\r\n", lines);
    }

    private static String row(Stream<String> cells) {
        return cells.map(v -> "\"" + (v == null ? "" : v).replace("\"", "\"\"") + "\"").collect(Collectors.joining(","));
    }

    /* ---------------- helpers ---------------- */

    private static BigDecimal sum(Stream<?> s) {
        return s.map(o -> o instanceof Payment p ? nz(p.amount()) : nz((BigDecimal) o))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal nz(BigDecimal b) {
        return b == null ? BigDecimal.ZERO : b;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String plain(BigDecimal b) {
        return b == null ? "" : b.stripTrailingZeros().toPlainString();
    }

    private static int count(List<Row> rows, String status) {
        return (int) rows.stream().filter(x -> status.equals(x.status())).count();
    }

    private static int indexOr(List<String> list, String v) {
        for (int i = 0; i < list.size(); i++) if (list.get(i).equalsIgnoreCase(v)) return i;
        return 99;
    }

    /** Today in Sri Lanka, for payments marked without a date. */
    public static String today() {
        return LocalDate.now(java.time.ZoneId.of("Asia/Colombo")).toString();
    }
}
