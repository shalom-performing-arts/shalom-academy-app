package lk.shalom.receipts.service;

import lk.shalom.receipts.model.TeacherBook;
import lk.shalom.receipts.model.TeacherBook.Adjustment;
import lk.shalom.receipts.model.TeacherBook.Holiday;
import lk.shalom.receipts.model.TeacherBook.Mark;
import lk.shalom.receipts.model.TeacherBook.Payout;
import lk.shalom.receipts.model.TeacherBook.Rates;
import lk.shalom.receipts.model.TeacherBook.Site;
import lk.shalom.receipts.model.TeacherBook.Slot;
import lk.shalom.receipts.model.TeacherBook.Teacher;
import lk.shalom.receipts.repository.TeacherRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Teacher attendance and salary, worked out the way the academy's workbook does it:
 * <ul>
 *   <li>each class a teacher took pays the weekday rate (Mon–Fri) or the weekend rate (Sat, Sun);</li>
 *   <li>transport is paid once a teacher took at least one class in the pay period;</li>
 *   <li>classes on a holiday marked "class off" do not count;</li>
 *   <li>an adjustment (+/−) is added last.</li>
 * </ul>
 * Pay periods run from the 26th to the 25th and are named after the month they are paid in.
 */
@Service
public class TeacherService {

    public static final ZoneId SRI_LANKA = ZoneId.of("Asia/Colombo");
    private static final DateTimeFormatter LABEL = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    public static final String SELF = "self";
    public static final String OFFICE = "office";

    private final TeacherRepository repo;
    private final Clock clock;

    @Autowired
    public TeacherService(TeacherRepository repo) {
        this(repo, Clock.system(SRI_LANKA));
    }

    TeacherService(TeacherRepository repo, Clock clock) {
        this.repo = repo;
        this.clock = clock;
    }

    public TeacherBook book() {
        return repo.get();
    }

    /* =========================================================
       Pay periods
       ========================================================= */

    /** The period a date is paid in: up to the 25th it is that month, after it the next. */
    public static String periodOf(LocalDate d) {
        YearMonth m = YearMonth.from(d);
        return (d.getDayOfMonth() > 25 ? m.plusMonths(1) : m).toString();
    }

    public static LocalDate periodStart(String period) {
        return YearMonth.parse(period).minusMonths(1).atDay(26);
    }

    public static LocalDate periodEnd(String period) {
        return YearMonth.parse(period).atDay(25);
    }

    public static boolean weekend(LocalDate d) {
        return d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(SRI_LANKA));
    }

    public String currentPeriod() {
        return periodOf(today());
    }

    /* =========================================================
       The sheet: every class day in a period and who took each class
       ========================================================= */

    public record TeacherOut(String id, String name, String phone, String colour, boolean active, boolean hasPin) {}

    /**
     * One teacher on one class.
     *
     * @param doneAt   when the teacher marked the class done; null = not yet
     * @param finished true once marked done, and always for the office's ticks
     */
    public record Who(String teacherId, String method, Instant at, Double distance, Instant doneAt, String note,
                      boolean finished) {}

    public record ClassOut(Slot slot, String time, List<Who> teachers, boolean removed) {}

    public record DayOut(String date, String dayName, String label, boolean weekend, boolean today,
                         boolean future, Holiday holiday, List<ClassOut> classes) {}

    public record SheetOut(String period, String label, String from, String to, String payDate,
                           List<TeacherOut> teachers, List<DayOut> days, SalaryOut salary) {}

    public SheetOut sheet(String period) {
        TeacherBook b = repo.get();
        LocalDate from = periodStart(period), to = periodEnd(period), today = today();
        Map<String, List<Mark>> byDay = b.attendance().stream()
                .filter(m -> inPeriod(m.date(), from, to))
                .collect(Collectors.groupingBy(Mark::date));
        List<DayOut> days = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            String iso = d.toString();
            Holiday h = holiday(b, iso);
            List<Mark> marks = byDay.getOrDefault(iso, List.of());
            List<ClassOut> classes = new ArrayList<>();
            for (Slot s : slotsOn(b, d)) {
                classes.add(new ClassOut(s, timeRange(s), who(marks, s.id()), false));
            }
            // a class taken that is no longer in the timetable still shows, so nothing paid goes missing
            for (String gone : marks.stream().map(Mark::slotId).distinct()
                    .filter(id -> classes.stream().noneMatch(c -> c.slot().id().equals(id))).toList()) {
                Slot s = b.schedule().stream().filter(x -> x.id().equals(gone)).findFirst()
                        .orElse(new Slot(gone, dayName(d), "", 60, "", "Removed class"));
                classes.add(new ClassOut(s, timeRange(s), who(marks, gone), true));
            }
            if (classes.isEmpty() && h == null) continue;
            days.add(new DayOut(iso, dayName(d), d.format(SHORT), weekend(d), d.equals(today), d.isAfter(today), h, classes));
        }
        return new SheetOut(period, "Salary " + periodEnd(period).format(LABEL), from.toString(), to.toString(),
                periodEnd(period).toString(), teachersOut(b), days, salary(b, period));
    }

    private static List<Who> who(List<Mark> marks, String slotId) {
        return marks.stream().filter(m -> m.slotId().equals(slotId))
                .map(m -> new Who(m.teacherId(), m.method(), m.at(), m.distance(), m.doneAt(), m.note(), m.finished())).toList();
    }

    private static boolean inPeriod(String date, LocalDate from, LocalDate to) {
        try {
            LocalDate d = LocalDate.parse(date);
            return !d.isBefore(from) && !d.isAfter(to);
        } catch (Exception e) {
            return false;
        }
    }

    /** The timetable for that weekday, earliest first. */
    static List<Slot> slotsOn(TeacherBook b, LocalDate d) {
        String day = dayName(d);
        return b.schedule().stream().filter(s -> day.equalsIgnoreCase(s.day()))
                .sorted(Comparator.comparing(s -> s.start() == null ? "" : s.start())).toList();
    }

    static Holiday holiday(TeacherBook b, String iso) {
        return b.holidays().stream().filter(h -> iso.equals(h.date())).findFirst().orElse(null);
    }

    static String dayName(LocalDate d) {
        return d.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
    }

    static String timeRange(Slot s) {
        LocalTime t = startTime(s);
        if (t == null) return "";
        return clock12(t) + " – " + clock12(t.plusMinutes(s.length()));
    }

    static LocalTime startTime(Slot s) {
        try {
            return s.start() == null || s.start().isBlank() ? null : LocalTime.parse(s.start());
        } catch (Exception e) {
            return null;
        }
    }

    static String clock12(LocalTime t) {
        return t.format(DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH));
    }

    /* =========================================================
       Salary
       ========================================================= */

    public record PayLine(String teacherId, String name, String colour, int weekday, int weekend,
                          BigDecimal weekdayPay, BigDecimal weekendPay, BigDecimal classPay, BigDecimal transport,
                          BigDecimal adjustment, String adjustmentNote, BigDecimal total, Instant paidAt,
                          BigDecimal paidAmount) {}

    public record SalaryOut(String period, String payDate, Rates rates, List<PayLine> lines,
                            int weekday, int weekend, BigDecimal classPay, BigDecimal transport,
                            BigDecimal adjustment, BigDecimal total) {}

    public SalaryOut salary(String period) {
        return salary(repo.get(), period);
    }

    static SalaryOut salary(TeacherBook b, String period) {
        LocalDate from = periodStart(period), to = periodEnd(period);
        Rates r = b.rates();
        List<PayLine> lines = new ArrayList<>();
        // everyone active, plus anyone inactive who still taught in the period
        List<Teacher> who = b.teachers().stream().filter(t -> t.isActive() || b.attendance().stream()
                .anyMatch(m -> m.teacherId().equals(t.id()) && inPeriod(m.date(), from, to))).toList();
        for (Teacher t : who) {
            int wd = 0, we = 0;
            for (Mark m : b.attendance()) {
                if (!m.teacherId().equals(t.id()) || !inPeriod(m.date(), from, to)) continue;
                Holiday h = holiday(b, m.date());
                if (h != null && h.off()) continue;        // the workbook: holiday rows never count
                if (weekend(LocalDate.parse(m.date()))) we++; else wd++;
            }
            BigDecimal wdPay = r.weekday().multiply(BigDecimal.valueOf(wd));
            BigDecimal wePay = r.weekend().multiply(BigDecimal.valueOf(we));
            BigDecimal classPay = wdPay.add(wePay);
            BigDecimal transport = wd + we >= Math.max(1, r.minClasses()) ? r.transport() : BigDecimal.ZERO;
            Adjustment adj = b.adjustments().stream()
                    .filter(a -> a.period().equals(period) && a.teacherId().equals(t.id())).findFirst().orElse(null);
            BigDecimal adjustment = adj == null || adj.amount() == null ? BigDecimal.ZERO : adj.amount();
            Payout payout = b.payouts().stream().filter(p -> p.period().equals(period) && p.teacherId().equals(t.id()))
                    .findFirst().orElse(null);
            // the total always follows the marks (a mark taken back lowers it); what was actually paid
            // is kept beside it, so a change after paying shows as a difference
            lines.add(new PayLine(t.id(), t.name(), t.colour(), wd, we, wdPay, wePay, classPay, transport,
                    adjustment, adj == null ? "" : Objects.requireNonNullElse(adj.note(), ""),
                    classPay.add(transport).add(adjustment), payout == null ? null : payout.paidAt(),
                    payout == null ? null : payout.amount()));
        }
        return new SalaryOut(period, periodEnd(period).toString(), r, lines,
                lines.stream().mapToInt(PayLine::weekday).sum(), lines.stream().mapToInt(PayLine::weekend).sum(),
                sum(lines, PayLine::classPay), sum(lines, PayLine::transport), sum(lines, PayLine::adjustment),
                sum(lines, PayLine::total));
    }

    private static BigDecimal sum(List<PayLine> lines, java.util.function.Function<PayLine, BigDecimal> f) {
        return lines.stream().map(f).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public SalaryOut setAdjustment(String period, String teacherId, BigDecimal amount, String note) {
        YearMonth.parse(period);
        teacher(teacherId);
        repo.update(b -> {
            b.adjustments().removeIf(a -> a.period().equals(period) && a.teacherId().equals(teacherId));
            if ((amount != null && amount.signum() != 0) || (note != null && !note.isBlank())) {
                b.adjustments().add(new Adjustment(period, teacherId, amount == null ? BigDecimal.ZERO : amount,
                        note == null ? "" : note.trim()));
            }
            return b;
        });
        return salary(period);
    }

    public SalaryOut setPaid(String period, String teacherId, boolean paid) {
        YearMonth.parse(period);
        teacher(teacherId);
        BigDecimal amount = salary(period).lines().stream().filter(l -> l.teacherId().equals(teacherId))
                .map(PayLine::total).findFirst().orElse(BigDecimal.ZERO);
        repo.update(b -> {
            b.payouts().removeIf(p -> p.period().equals(period) && p.teacherId().equals(teacherId));
            if (paid) b.payouts().add(new Payout(period, teacherId, amount, Instant.now(clock)));
            return b;
        });
        return salary(period);
    }

    public String salaryCsv(String period) {
        SalaryOut s = salary(period);
        StringBuilder sb = new StringBuilder("﻿");
        sb.append(row("Pay date", "Teacher", "Weekday classes", "Weekend classes", "Class pay", "Transport",
                "Adjustment (+/-)", "Note", "Total", "Paid on"));
        for (PayLine l : s.lines()) {
            sb.append(row(periodEnd(period).format(LABEL), l.name(), l.weekday() + "", l.weekend() + "",
                    plain(l.classPay()), plain(l.transport()), plain(l.adjustment()), l.adjustmentNote(),
                    plain(l.total()), l.paidAt() == null ? "" : LocalDate.ofInstant(l.paidAt(), SRI_LANKA).format(LABEL)));
        }
        sb.append(row(periodEnd(period).format(LABEL) + " total", "", s.weekday() + "", s.weekend() + "",
                plain(s.classPay()), plain(s.transport()), plain(s.adjustment()), "", plain(s.total()), ""));
        return sb.toString();
    }

    private static String plain(BigDecimal b) {
        return b.stripTrailingZeros().toPlainString();
    }

    private static String row(String... cells) {
        return java.util.Arrays.stream(cells).map(c -> "\"" + (c == null ? "" : c.replace("\"", "\"\"")) + "\"")
                .collect(Collectors.joining(",")) + "\r\n";
    }

    /* =========================================================
       The office ticks attendance
       ========================================================= */

    public SheetOut setMark(String date, String slotId, String teacherId, boolean on) {
        LocalDate d = parseDate(date);
        teacher(teacherId);
        TeacherBook b = repo.get();
        if (b.schedule().stream().noneMatch(s -> s.id().equals(slotId))
                && b.attendance().stream().noneMatch(m -> m.slotId().equals(slotId) && m.date().equals(date))) {
            throw ApiException.badRequest("That class is not in the timetable.");
        }
        Holiday h = holiday(b, date);
        if (on && h != null && h.off()) {
            throw ApiException.badRequest(h.name() + " is a holiday with no classes. To hold a class that day, "
                    + "change the holiday to \"classes as usual\" in Setup first.");
        }
        repo.update(x -> {
            java.util.function.Predicate<Mark> same = m -> m.date().equals(date) && m.slotId().equals(slotId) && m.teacherId().equals(teacherId);
            Mark existing = x.attendance().stream().filter(same).findFirst().orElse(null);
            if (!on) {
                x.attendance().removeIf(same);
            } else if (existing == null) {
                x.attendance().add(new Mark(date, slotId, teacherId, OFFICE, Instant.now(clock), null, null, null, null));
            } else if (!existing.finished()) {
                // the teacher checked in but did not mark the class done: the office confirms it, and their check-in stays
                x.attendance().replaceAll(m -> same.test(m) ? m.withDone(Instant.now(clock), "Confirmed by the office", null) : m);
            }
            return x;
        });
        return sheet(periodOf(d));
    }

    /* =========================================================
       Teachers check in from their phone at the academy
       ========================================================= */

    /**
     * Where a teacher is with one of today's classes:
     * LATER (check-in not open yet), OPEN (check in now), IN_CLASS (checked in), FINISH (mark it done now),
     * COMPLETE. MISSED = never checked in; UNFINISHED = checked in but not marked done in time.
     */
    public enum SlotState { LATER, OPEN, IN_CLASS, FINISH, COMPLETE, UNFINISHED, MISSED, HOLIDAY }

    public record TodayClass(Slot slot, String time, SlotState state, String opensAt, String closesAt,
                             Instant checkedAt, String method, List<String> others,
                             String doneOpensAt, String doneClosesAt, Instant doneAt, String note,
                             boolean canUndo, String undoBlocked) {}

    public record MeOut(TeacherOut teacher, String date, String dateLabel, Holiday holiday, boolean siteSet,
                        Integer radius, Double siteLat, Double siteLng, List<TodayClass> today, PayLine pay,
                        String period, String periodLabel, List<UpcomingDay> next,
                        Map<String, RollService.ClassInfo> classInfo) {

        /** the student session behind each slot (by slot id), from {@link RollService#classInfo} */
        public MeOut withClassInfo(Map<String, RollService.ClassInfo> info) {
            return new MeOut(teacher, date, dateLabel, holiday, siteSet, radius, siteLat, siteLng, today, pay,
                    period, periodLabel, next, info);
        }

        /** every slot on the page: today's and the coming days' */
        public List<Slot> slots() {
            List<Slot> all = new ArrayList<>(today.stream().map(TodayClass::slot).toList());
            next.forEach(d -> d.slots().forEach(c -> all.add(c.slot())));
            return all;
        }
    }

    /** @param classes "3:30 PM · Kids 1" (kept for older pages); slots: the same classes in full */
    public record UpcomingDay(String date, String label, List<String> classes, List<UpcomingClass> slots) {}

    public record UpcomingClass(Slot slot, String time) {}

    public MeOut me(String teacherId) {
        Teacher t = teacher(teacherId);
        TeacherBook b = repo.get();
        LocalDate d = today();
        LocalDateTime now = LocalDateTime.now(clock.withZone(SRI_LANKA));
        Holiday h = holiday(b, d.toString());
        Site site = b.site();
        List<TodayClass> classes = new ArrayList<>();
        for (Slot s : slotsOn(b, d)) {
            Mark mine = b.attendance().stream().filter(m -> m.date().equals(d.toString()) && m.slotId().equals(s.id())
                    && m.teacherId().equals(teacherId)).findFirst().orElse(null);
            List<String> others = b.attendance().stream().filter(m -> m.date().equals(d.toString())
                            && m.slotId().equals(s.id()) && !m.teacherId().equals(teacherId))
                    .map(m -> name(b, m.teacherId())).toList();
            LocalTime start = startTime(s);
            LocalDateTime opens = start == null ? null : d.atTime(start).minusMinutes(site.early());
            LocalDateTime closes = start == null ? null : d.atTime(start).plusMinutes(s.length() + site.late());
            LocalDateTime ends = start == null ? null : d.atTime(start).plusMinutes(s.length());
            LocalDateTime doneOpens = ends == null ? null : ends.minusMinutes(Site.DONE_EARLY);
            LocalDateTime doneCloses = ends == null ? null : ends.plusMinutes(site.done());
            // one step: marked or not. Marking opens shortly before the class and stays open for the
            // rest of the day; a teacher's own mark can be taken back the same day.
            SlotState st;
            if (mine != null) st = SlotState.COMPLETE;
            else if (h != null && h.off()) st = SlotState.HOLIDAY;
            else if (opens == null || now.isBefore(opens)) st = SlotState.LATER;
            else st = SlotState.OPEN;
            classes.add(new TodayClass(s, timeRange(s), st, opens == null ? "" : clock12(opens.toLocalTime()),
                    closes == null ? "" : clock12(closes.toLocalTime()), mine == null ? null : mine.at(),
                    mine == null ? null : mine.method(), others,
                    doneOpens == null ? "" : clock12(doneOpens.toLocalTime()),
                    doneCloses == null ? "" : clock12(doneCloses.toLocalTime()),
                    mine == null ? null : mine.doneAt(), mine == null ? null : mine.note(),
                    mine != null && SELF.equals(mine.method()),
                    // why a mark cannot be taken back here, so the page says so instead of a button that fails
                    mine != null && !SELF.equals(mine.method()) ? "Marked by the office" : null));
        }
        String period = periodOf(d);
        PayLine pay = salary(b, period).lines().stream().filter(l -> l.teacherId().equals(teacherId)).findFirst().orElse(null);
        List<UpcomingDay> next = new ArrayList<>();
        for (LocalDate x = d.plusDays(1); next.size() < 3 && x.isBefore(d.plusDays(15)); x = x.plusDays(1)) {
            Holiday hx = holiday(b, x.toString());
            List<Slot> sx = slotsOn(b, x);
            if (sx.isEmpty() || (hx != null && hx.off())) continue;
            next.add(new UpcomingDay(x.toString(), dayName(x) + " " + x.format(SHORT),
                    sx.stream().map(s -> clock12(Objects.requireNonNull(startTime(s))) + " · " + s.label()).toList(),
                    sx.stream().map(s -> new UpcomingClass(s, timeRange(s))).toList()));
        }
        return new MeOut(out(t), d.toString(), dayName(d) + ", " + d.format(LABEL), h, site.isSet(), site.radiusM(),
                site.lat(), site.lng(), classes, pay, period, "Salary " + periodEnd(period).format(LABEL) + " · " + periodStart(period).format(SHORT)
                + " – " + periodEnd(period).format(SHORT), next, Map.of());
    }

    public record CheckIn(String slotId, Double lat, Double lng, Double accuracy) {}

    /**
     * Records that the teacher is taking a class, after checking they are at the academy and
     * it is near the class time. GPS on a phone is rarely better than 10–30 m, so the reading's
     * own accuracy (up to 75 m) is allowed on top of the radius.
     */
    public MeOut checkIn(String teacherId, CheckIn in) {
        Teacher t = teacher(teacherId);
        if (!t.isActive()) throw ApiException.badRequest("Your account is switched off. Please speak to the office.");
        TeacherBook b = repo.get();
        Site site = b.site();
        if (!site.isSet()) {
            throw ApiException.badRequest("The academy's location has not been set yet, so checking in is not possible. Please tell the office.");
        }
        if (in == null) throw ApiException.badRequest("Nothing was sent.");
        double acc = in.accuracy() == null ? 0 : in.accuracy();
        double dist = atAcademy(site, in.lat(), in.lng(), in.accuracy(), "Check in once you arrive");
        LocalDate d = today();
        Holiday h = holiday(b, d.toString());
        if (h != null && h.off()) throw ApiException.badRequest("Today is " + h.name() + " — there are no classes.");
        Slot s = slotsOn(b, d).stream().filter(x -> x.id().equals(in.slotId())).findFirst()
                .orElseThrow(() -> ApiException.badRequest("That class is not on today's timetable."));
        LocalTime start = startTime(s);
        LocalDateTime now = LocalDateTime.now(clock.withZone(SRI_LANKA));
        LocalDateTime opens = d.atTime(start).minusMinutes(site.early());
        LocalDateTime closes = d.atTime(start).plusMinutes(s.length() + site.late());
        if (now.isBefore(opens)) {
            throw ApiException.badRequest("Marking " + s.label() + " opens at " + clock12(opens.toLocalTime()) + ".");
        }
        // open for the rest of the day (the teacher has confirmed they taught it); earlier days are the office's
        repo.update(x -> {
            boolean already = x.attendance().stream().anyMatch(m -> m.date().equals(d.toString())
                    && m.slotId().equals(s.id()) && m.teacherId().equals(teacherId));
            if (!already) {
                Instant when = Instant.now(clock);
                x.attendance().add(new Mark(d.toString(), s.id(), teacherId, SELF, when,
                        round(in.lat(), 6), round(in.lng(), 6), round(acc, 0), round(dist, 0))
                        .withDone(when, "", round(dist, 0)));
            }
            return x;
        });
        return me(teacherId);
    }

    public record Unmark(String slotId) {}

    /**
     * The teacher takes back their own mark for one of today's classes (marked by mistake).
     * Only today's, only their own: the office's ticks and earlier days stay with the office.
     */
    public MeOut unmark(String teacherId, Unmark in) {
        teacher(teacherId);
        if (in == null || in.slotId() == null) throw ApiException.badRequest("Nothing was sent.");
        LocalDate d = today();
        TeacherBook b = repo.get();
        Mark mine = b.attendance().stream().filter(m -> m.date().equals(d.toString()) && m.slotId().equals(in.slotId())
                && m.teacherId().equals(teacherId)).findFirst().orElse(null);
        if (mine == null) return me(teacherId);
        if (!SELF.equals(mine.method())) {
            throw ApiException.badRequest("The office marked this class for you. Please ask the office to change it.");
        }
        repo.update(x -> {
            x.attendance().removeIf(m -> m.date().equals(d.toString()) && m.slotId().equals(in.slotId())
                    && m.teacherId().equals(teacherId) && SELF.equals(m.method()));
            return x;
        });
        return me(teacherId);
    }

    public record Finish(String slotId, Double lat, Double lng, Double accuracy, String note) {}

    /**
     * The teacher confirms, once the class is over, that they taught it: at the academy, from
     * {@link Site#DONE_EARLY} minutes before it ends until the "class done" time after it ends.
     * A short note on what was covered can go with it.
     */
    public MeOut finish(String teacherId, Finish in) {
        teacher(teacherId);
        TeacherBook b = repo.get();
        Site site = b.site();
        if (!site.isSet()) throw ApiException.badRequest("The academy's location has not been set yet. Please tell the office.");
        if (in == null) throw ApiException.badRequest("Nothing was sent.");
        LocalDate d = today();
        Mark mine = b.attendance().stream().filter(m -> m.date().equals(d.toString()) && m.slotId().equals(in.slotId())
                && m.teacherId().equals(teacherId)).findFirst()
                .orElseThrow(() -> ApiException.badRequest("Check in to this class first."));
        if (mine.finished()) return me(teacherId);
        Slot s = b.schedule().stream().filter(x -> x.id().equals(in.slotId())).findFirst()
                .orElseThrow(() -> ApiException.badRequest("That class is no longer on the timetable. Ask the office."));
        LocalDateTime now = LocalDateTime.now(clock.withZone(SRI_LANKA));
        LocalDateTime ends = d.atTime(startTime(s)).plusMinutes(s.length());
        LocalDateTime opens = ends.minusMinutes(Site.DONE_EARLY), closes = ends.plusMinutes(site.done());
        if (now.isBefore(opens)) {
            throw ApiException.badRequest(s.label() + " is still on. You can mark it done from " + clock12(opens.toLocalTime()) + ".");
        }
        if (now.isAfter(closes)) {
            throw ApiException.badRequest("Marking " + s.label() + " done closed at " + clock12(closes.toLocalTime())
                    + ". Ask the office to confirm it.");
        }
        double dist = atAcademy(site, in.lat(), in.lng(), in.accuracy(), "Mark the class done while you are at the academy");
        String note = in.note() == null ? "" : in.note().trim();
        String n = note.length() > 300 ? note.substring(0, 300) : note;
        repo.update(x -> {
            x.attendance().replaceAll(m -> m.date().equals(d.toString()) && m.slotId().equals(s.id())
                    && m.teacherId().equals(teacherId) ? m.withDone(Instant.now(clock), n, round(dist, 0)) : m);
            return x;
        });
        return me(teacherId);
    }

    /** Checks the phone is at the academy and returns how far away it is, in metres. */
    private static double atAcademy(Site site, Double lat, Double lng, Double accuracy, String advice) {
        if (lat == null || lng == null) {
            throw ApiException.badRequest("Your phone did not share its location. Allow location for this site and try again.");
        }
        double acc = accuracy == null ? 0 : accuracy;
        if (acc > 300) {
            throw ApiException.badRequest("Your phone's location is too rough (about " + Math.round(acc) + " m). "
                    + "Turn on precise location / GPS, step outside or near a window, and try again.");
        }
        double dist = metres(site.lat(), site.lng(), lat, lng);
        if (dist > site.radiusM() + Math.min(acc, 75)) {
            throw ApiException.badRequest("You are about " + distanceText(dist) + " from the academy. "
                    + advice + " (within " + site.radiusM() + " m).");
        }
        return dist;
    }

    /** Great-circle distance in metres. */
    static double metres(double lat1, double lng1, double lat2, double lng2) {
        double r = 6_371_000, p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dp = p2 - p1, dl = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private static String distanceText(double m) {
        return m >= 1000 ? String.format(Locale.ENGLISH, "%.1f km", m / 1000) : Math.round(m) + " m";
    }

    private static Double round(double v, int places) {
        double f = Math.pow(10, places);
        return Math.round(v * f) / f;
    }

    /* =========================================================
       Setup: teachers, PINs, rates, timetable, holidays, location
       ========================================================= */

    public record SetupOut(List<TeacherOut> teachers, Rates rates, List<Slot> schedule, List<Holiday> holidays, Site site) {}

    public SetupOut setup() {
        TeacherBook b = repo.get();
        List<Holiday> hs = b.holidays().stream().sorted(Comparator.comparing(Holiday::date)).toList();
        List<Slot> sc = b.schedule().stream().sorted(Comparator.comparing((Slot s) -> dayIndex(s.day()))
                .thenComparing(s -> s.start() == null ? "" : s.start())).toList();
        return new SetupOut(teachersOut(b), b.rates(), sc, hs, b.site());
    }

    public record TeacherInput(String name, String phone, String colour, Boolean active) {}

    public TeacherOut saveTeacher(String id, TeacherInput in) {
        if (in == null || in.name() == null || in.name().isBlank()) throw ApiException.badRequest("Enter the teacher's name.");
        String name = in.name().trim();
        TeacherBook b = repo.get();
        if (b.teachers().stream().anyMatch(t -> t.name().equalsIgnoreCase(name) && !t.id().equals(id))) {
            throw ApiException.conflict("There is already a teacher called " + name + ".");
        }
        String newId = id != null ? id : uniqueId(b, name);
        if (id != null) teacher(id);
        repo.update(x -> {
            Teacher old = x.teachers().stream().filter(t -> t.id().equals(newId)).findFirst().orElse(null);
            Teacher t = new Teacher(newId, name, in.phone() == null ? "" : in.phone().trim(),
                    in.colour() == null || in.colour().isBlank() ? (old == null ? spareColour(x) : old.colour()) : in.colour(),
                    in.active() == null ? (old == null || old.isActive()) : in.active(),
                    old == null ? null : old.pinSalt(), old == null ? null : old.pinHash());
            if (old == null) x.teachers().add(t); else x.teachers().set(x.teachers().indexOf(old), t);
            return x;
        });
        return out(teacher(newId));
    }

    public void deleteTeacher(String id) {
        teacher(id);
        if (repo.get().attendance().stream().anyMatch(m -> m.teacherId().equals(id))) {
            throw ApiException.conflict("This teacher has attendance on record, so they cannot be removed — "
                    + "switch them to inactive instead.");
        }
        repo.update(b -> { b.teachers().removeIf(t -> t.id().equals(id)); return b; });
    }

    /** Sets a teacher's PIN (4–6 digits). A blank PIN makes a random 4-digit one. Returns the PIN to tell them. */
    public String setPin(String id, String pin) {
        teacher(id);
        String p = pin == null || pin.isBlank() ? String.format("%04d", new SecureRandom().nextInt(10_000)) : pin.trim();
        if (!p.matches("\\d{4,6}")) throw ApiException.badRequest("A PIN is 4 to 6 digits.");
        String salt = HexFormat.of().formatHex(new SecureRandom().generateSeed(8));
        String hash = hash(salt, p);
        repo.update(b -> {
            b.teachers().replaceAll(t -> t.id().equals(id)
                    ? new Teacher(t.id(), t.name(), t.phone(), t.colour(), t.active(), salt, hash) : t);
            return b;
        });
        return p;
    }

    /** The teacher whose name and PIN these are, if they match and the teacher is active. */
    public Optional<Teacher> checkPin(String teacherId, String pin) {
        if (teacherId == null || pin == null) return Optional.empty();
        return repo.get().teachers().stream()
                .filter(t -> t.id().equals(teacherId) && t.isActive() && t.hasPin())
                .filter(t -> MessageDigest.isEqual(hash(t.pinSalt(), pin.trim()).getBytes(StandardCharsets.US_ASCII),
                        t.pinHash().getBytes(StandardCharsets.US_ASCII)))
                .findFirst();
    }

    /** Changes whenever the PIN changes, so a new PIN signs the teacher out on every phone. */
    public Optional<String> pinStamp(String teacherId) {
        return repo.get().teachers().stream().filter(t -> t.id().equals(teacherId) && t.isActive() && t.hasPin())
                .map(t -> t.pinHash().substring(0, 10)).findFirst();
    }

    /** Names for the sign-in list: only teachers who can actually sign in. */
    public List<Map<String, String>> signInList() {
        return repo.get().teachers().stream().filter(t -> t.isActive() && t.hasPin())
                .map(t -> Map.of("id", t.id(), "name", t.name())).toList();
    }

    public record SetupInput(Rates rates, List<Slot> schedule, List<Holiday> holidays, Site site) {}

    public SetupOut saveSetup(SetupInput in) {
        if (in == null) throw ApiException.badRequest("Nothing to save.");
        List<Slot> schedule = in.schedule() == null ? null : cleanSchedule(in.schedule());
        List<Holiday> holidays = in.holidays() == null ? null : cleanHolidays(in.holidays());
        if (in.site() != null && in.site().lat() != null && (Math.abs(in.site().lat()) > 90 || in.site().lng() == null
                || Math.abs(in.site().lng()) > 180)) {
            throw ApiException.badRequest("That location does not look right.");
        }
        repo.update(b -> new TeacherBook(b.teachers(),
                in.rates() == null ? b.rates() : in.rates(),
                schedule == null ? b.schedule() : schedule,
                holidays == null ? b.holidays() : holidays,
                in.site() == null ? b.site() : in.site(),
                b.attendance(), b.adjustments(), b.payouts()));
        return setup();
    }

    private static List<Slot> cleanSchedule(List<Slot> in) {
        List<Slot> out = new ArrayList<>();
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (Slot s : in) {
            if (s == null) continue;
            if (dayIndex(s.day()) > 6) throw ApiException.badRequest("Pick a day for every class.");
            if (startTime(s) == null) throw ApiException.badRequest("Enter a start time for every class, like 15:30.");
            String cat = s.category() == null ? "" : s.category().trim();
            String label = s.label() == null || s.label().isBlank() ? cat : s.label().trim();
            if (label.isBlank()) throw ApiException.badRequest("Give every class a name.");
            String id = s.id() == null || s.id().isBlank()
                    ? s.day().substring(0, 3).toLowerCase() + "-" + s.start().replace(":", "") + "-"
                    + label.toLowerCase().replaceAll("[^a-z0-9]+", "-")
                    : s.id();
            String unique = id;
            for (int n = 2; !ids.add(unique); n++) unique = id + "-" + n;
            int mins = s.minutes() == null || s.minutes() < 15 || s.minutes() > 300 ? 60 : s.minutes();
            out.add(new Slot(unique, cap(s.day()), LocalTime.parse(s.start()).toString(), mins, cat, label));
        }
        return out;
    }

    private static List<Holiday> cleanHolidays(List<Holiday> in) {
        Map<String, Holiday> out = new LinkedHashMap<>();
        for (Holiday h : in) {
            if (h == null || h.date() == null || h.date().isBlank()) continue;
            parseDate(h.date());
            out.put(h.date(), new Holiday(h.date(), h.name() == null || h.name().isBlank() ? "Holiday" : h.name().trim(), h.off()));
        }
        return out.values().stream().sorted(Comparator.comparing(Holiday::date)).toList();
    }

    /* ---------------- helpers ---------------- */

    public Teacher teacher(String id) {
        return repo.get().teachers().stream().filter(t -> t.id().equals(id)).findFirst()
                .orElseThrow(() -> ApiException.notFound("No teacher with id " + id));
    }

    private static String name(TeacherBook b, String id) {
        return b.teachers().stream().filter(t -> t.id().equals(id)).map(Teacher::name).findFirst().orElse(id);
    }

    private static List<TeacherOut> teachersOut(TeacherBook b) {
        return b.teachers().stream().map(TeacherService::out).toList();
    }

    static TeacherOut out(Teacher t) {
        return new TeacherOut(t.id(), t.name(), t.phone(), t.colour(), t.isActive(), t.hasPin());
    }

    private static String uniqueId(TeacherBook b, String name) {
        String base = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (base.isEmpty()) base = "teacher";
        java.util.Set<String> used = b.teachers().stream().map(Teacher::id).collect(Collectors.toSet());
        String id = base;
        for (int n = 2; used.contains(id); n++) id = base + "-" + n;
        return id;
    }

    private static final List<String> COLOURS = List.of("#e8457c", "#3567e8", "#0f9f6e", "#7c3aed", "#e07a10", "#0e9aa7", "#b4447a");

    private static String spareColour(TeacherBook b) {
        return COLOURS.stream().filter(c -> b.teachers().stream().noneMatch(t -> c.equalsIgnoreCase(t.colour())))
                .findFirst().orElse(COLOURS.get(b.teachers().size() % COLOURS.size()));
    }

    private static int dayIndex(String day) {
        if (day == null) return 9;
        for (DayOfWeek d : DayOfWeek.values()) {
            if (d.getDisplayName(TextStyle.FULL, Locale.ENGLISH).equalsIgnoreCase(day.trim())) return d.getValue() - 1;
        }
        return 9;
    }

    private static String cap(String day) {
        String d = day.trim().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(d.charAt(0)) + d.substring(1);
    }

    private static LocalDate parseDate(String s) {
        try {
            return LocalDate.parse(s);
        } catch (Exception e) {
            throw ApiException.badRequest("Dates look like 2026-11-04.");
        }
    }

    private static String hash(String salt, String pin) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest((salt + "|" + pin).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
