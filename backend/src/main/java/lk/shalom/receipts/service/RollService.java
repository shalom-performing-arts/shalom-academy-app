package lk.shalom.receipts.service;

import lk.shalom.receipts.model.RollBook;
import lk.shalom.receipts.model.RollBook.Entry;
import lk.shalom.receipts.model.RollBook.Makeup;
import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Session;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.TeacherBook.Holiday;
import lk.shalom.receipts.repository.RollRepository;
import lk.shalom.receipts.repository.TeacherRepository;
import lk.shalom.receipts.repository.RosterRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Student attendance — the paper register, in the app. Each class session (Forte, Legato …)
 * meets once a week; on each of its days every student is marked present, late or absent, by
 * whichever teacher is taking the register, or by the office.
 *
 * <p>A student who missed a class can be booked into a <em>cover-up</em> class in another
 * session. They then appear in that session's register; marking them there marks the class they
 * missed as made up (M), which counts as attended.
 */
@Service
public class RollService {

    public static final String OFFICE = "office";
    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_SHORT = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH);
    /** a class shows as "now" from this many minutes before it starts */
    static final int EARLY = 15;

    private final RosterRepository roster;
    private final RollRepository repo;
    private final TeacherRepository teachers;
    private final Clock clock;

    @Autowired
    public RollService(RosterRepository roster, RollRepository repo, TeacherRepository teachers) {
        this(roster, repo, teachers, Clock.system(TeacherService.SRI_LANKA));
    }

    RollService(RosterRepository roster, RollRepository repo, TeacherRepository teachers, Clock clock) {
        this.roster = roster;
        this.repo = repo;
        this.teachers = teachers;
        this.clock = clock;
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(TeacherService.SRI_LANKA));
    }

    /* =========================================================
       A day: its classes in time order, each with its register
       ========================================================= */

    /**
     * One line of a register.
     *
     * @param coverFor   for a student here as a cover-up: the class they missed, "Forte · Wed 4 Nov"
     * @param makeupId   the cover-up this line belongs to — the one they are attending here, or,
     *                   on the register of the class they missed, the one booked for it
     * @param makeupNote on the missed class's register: "Cover-up booked: Fortissimo · Sat 7 Nov"
     */
    public record RollStudent(String id, String name, String status, String note, String byName, Instant at, boolean left,
                              String coverFor, String makeupId, String makeupStatus, String makeupNote, CoverInfo cover) {}

    /**
     * Where a cover-up student comes from: their own class and session, when it usually meets,
     * the class they missed, why, and who booked it.
     */
    public record CoverInfo(String category, String session, String symbol, String symbolStyle, String day, String time,
                            String missedDate, String missedLabel, String reason, String bookedBy, Instant bookedAt,
                            String studentNumber, String parent, String phone) {}

    /**
     * @param state  "now" (on, or starting within 15 minutes), "next", "later", or "done" (over)
     * @param covers how many of the students are here for a cover-up
     */
    public record RollClass(Session session, String time, String start, String end, String state,
                            List<RollStudent> students, int present, int late, int absent, int unmarked, int madeUp,
                            int covers, String markedBy, Instant markedAt) {}

    /** @param focus the class to open on: the one on now, else the next, else the last */
    public record RollDay(String date, String label, boolean today, Holiday holiday, List<RollClass> classes, String focus) {}

    public RollDay day(LocalDate date) {
        Roster r = roster.load();
        RollBook book = repo.get();
        LocalDate today = today();
        LocalTime now = LocalDateTime.now(clock.withZone(TeacherService.SRI_LANKA)).toLocalTime();
        String day = date.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
        List<Session> sessions = r.sessions().stream().filter(s -> day.equalsIgnoreCase(s.day()))
                .sorted(Comparator.comparing(s -> times(s.time()).start())).toList();

        List<RollClass> classes = new ArrayList<>();
        boolean nextGiven = false;
        for (Session s : sessions) {
            Times t = times(s.time());
            String state;
            if (date.isBefore(today)) state = "done";
            else if (date.isAfter(today)) state = "later";
            else if (now.isAfter(t.end())) state = "done";
            else if (!now.isBefore(t.start().minusMinutes(EARLY))) state = "now";
            else { state = nextGiven ? "later" : "next"; nextGiven = true; }
            classes.add(build(r, book, date, s, t, state));
        }
        String focus = classes.stream().filter(c -> c.state().equals("now")).map(c -> c.session().name()).findFirst()
                .or(() -> classes.stream().filter(c -> c.state().equals("next")).map(c -> c.session().name()).findFirst())
                .orElse(classes.isEmpty() ? "" : (date.isAfter(today) ? classes.getFirst() : classes.getLast()).session().name());
        Holiday h = teachers.get().holidays().stream().filter(x -> date.toString().equals(x.date())).findFirst().orElse(null);
        return new RollDay(date.toString(), date.format(LONG), date.equals(today), h, classes, focus);
    }

    private RollClass build(Roster r, RollBook book, LocalDate date, Session s, Times t, String state) {
        String iso = date.toString();
        Map<String, Entry> marks = new LinkedHashMap<>();
        for (Entry e : book.entries()) {
            if (e.date().equals(iso) && e.session().equalsIgnoreCase(s.name())) marks.put(e.studentId(), e);
        }
        List<RollStudent> list = new ArrayList<>();
        for (Student st : r.students()) {
            if (!st.active() || !s.name().equalsIgnoreCase(st.session())) continue;
            Entry e = marks.remove(st.id());
            // a cover-up booked for this very class they are missing
            Makeup booked = book.makeups().stream().filter(m -> m.studentId().equals(st.id()) && m.fromDate().equals(iso)
                    && m.fromSession().equalsIgnoreCase(s.name())).findFirst().orElse(null);
            list.add(line(st.id(), st.name(), e, false, null, booked, booked == null ? null : makeupNote(r, booked), null));
        }
        // students coming to this class for a cover-up
        int covers = 0;
        for (Makeup m : book.makeups()) {
            if (!m.toDate().equals(iso) || !m.toSession().equalsIgnoreCase(s.name())) continue;
            Entry e = marks.remove(m.studentId());
            list.add(line(m.studentId(), m.studentName(), e, false,
                    m.fromSession() + " · " + LocalDate.parse(m.fromDate()).format(DAY_SHORT), m, null, coverInfo(r, m)));
            covers++;
        }
        // marked on the day but since left or moved: still in the register for that day
        for (Entry e : marks.values()) list.add(line(e.studentId(), e.studentName(), e, true, null, null, null, null));
        int p = 0, l = 0, a = 0, u = 0, mu = 0;
        for (RollStudent x : list) {
            if (x.status() == null) u++;
            else switch (x.status()) {
                case RollBook.PRESENT -> p++;
                case RollBook.LATE -> l++;
                case RollBook.MADE_UP -> mu++;
                default -> a++;
            }
        }
        Entry last = book.entries().stream().filter(e -> e.date().equals(iso) && e.session().equalsIgnoreCase(s.name()))
                .reduce(RollService::later).orElse(null);
        return new RollClass(s, s.time(), t.start().toString(), t.end().toString(), state, list, p, l, a, u, mu, covers,
                last == null ? null : last.byName(), last == null ? null : last.at());
    }

    /** the more recent of two marks; on a tie the one saved later */
    private static Entry later(Entry a, Entry b) {
        Instant x = a.at() == null ? Instant.EPOCH : a.at(), y = b.at() == null ? Instant.EPOCH : b.at();
        return y.isBefore(x) ? a : b;
    }

    private static RollStudent line(String id, String name, Entry e, boolean left, String coverFor, Makeup m, String makeupNote,
                                    CoverInfo cover) {
        return new RollStudent(id, name, e == null ? null : e.status(), e == null ? null : e.note(),
                e == null ? null : e.byName(), e == null ? null : e.at(), left,
                coverFor, m == null ? null : m.id(), m == null ? null : m.status(), makeupNote, cover);
    }

    private static CoverInfo coverInfo(Roster r, Makeup m) {
        Student st = r.students().stream().filter(x -> x.id().equals(m.studentId())).findFirst().orElse(null);
        Session home = r.sessions().stream().filter(x -> x.name().equalsIgnoreCase(m.fromSession())).findFirst().orElse(null);
        return new CoverInfo(
                home != null ? home.category() : st == null ? "" : st.category(),
                m.fromSession(),
                home == null ? "" : home.symbol(), home == null ? "plain" : home.symbolStyle(),
                home == null ? "" : home.day(), home == null ? "" : home.time(),
                m.fromDate(), LocalDate.parse(m.fromDate()).format(LONG),
                m.note(), m.byName(), m.at(),
                m.studentId(), st == null ? "" : st.parent(), st == null ? "" : st.phone());
    }

    private static String makeupNote(Roster r, Makeup m) {
        String when = LocalDate.parse(m.toDate()).format(DAY_SHORT);
        return switch (m.status()) {
            case Makeup.ATTENDED -> "Made up: " + m.toSession() + " · " + when;
            case Makeup.MISSED -> "Missed the cover-up: " + m.toSession() + " · " + when;
            default -> "Cover-up booked: " + m.toSession() + " · " + when;
        };
    }

    /* =========================================================
       Marking
       ========================================================= */

    public record MarkInput(String date, String session, String studentId, String status, String note) {}

    /**
     * Marks one student. A null status clears the mark; a null note keeps the one already there.
     * Marking a student who is here for a cover-up also marks the class they missed.
     *
     * @param by     a teacher's id, or {@link #OFFICE}
     * @param byName shown as "marked by"
     */
    public RollClass mark(MarkInput in, String by, String byName) {
        if (in == null) throw ApiException.badRequest("Nothing was sent.");
        LocalDate date = date(in.date());
        Roster r = roster.load();
        Session s = session(r, in.session());
        checkDay(date, s);
        if (in.status() != null && !RollBook.valid(in.status())) throw ApiException.badRequest("Mark P, L or A.");
        String name = r.students().stream().filter(x -> x.id().equals(in.studentId())).map(Student::name).findFirst()
                .orElseGet(() -> repo.get().entries().stream().filter(e -> e.studentId().equals(in.studentId()))
                        .map(Entry::studentName).findFirst()
                        .orElseThrow(() -> ApiException.notFound("No student with id " + in.studentId())));
        Instant now = Instant.now(clock);
        repo.update(b -> {
            Entry old = b.entries().stream().filter(e -> same(e, date, s.name(), in.studentId())).findFirst().orElse(null);
            b.entries().removeIf(e -> same(e, date, s.name(), in.studentId()));
            String note = in.note() != null ? clip(in.note()) : old == null ? null : old.note();
            if (in.status() != null) {
                b.entries().add(new Entry(date.toString(), s.name(), in.studentId(), name, in.status(), note, by, byName, now));
            }
            followCover(b, date, s.name(), in.studentId(), in.status(), by, byName, now);
            return b;
        });
        return classOn(date, s);
    }

    /** Marks everyone not yet marked as present — the quick start for a full class. */
    public RollClass allPresent(String dateIso, String sessionName, String by, String byName) {
        LocalDate date = date(dateIso);
        Roster r = roster.load();
        Session s = session(r, sessionName);
        checkDay(date, s);
        Instant now = Instant.now(clock);
        repo.update(b -> {
            for (Student st : r.students()) {
                if (!st.active() || !s.name().equalsIgnoreCase(st.session())) continue;
                if (b.entries().stream().anyMatch(e -> same(e, date, s.name(), st.id()))) continue;
                // someone booked into a cover-up elsewhere is not here
                if (b.makeups().stream().anyMatch(m -> m.studentId().equals(st.id()) && m.fromDate().equals(date.toString())
                        && m.fromSession().equalsIgnoreCase(s.name()))) continue;
                b.entries().add(new Entry(date.toString(), s.name(), st.id(), st.name(), RollBook.PRESENT, null, by, byName, now));
            }
            for (Makeup m : List.copyOf(b.makeups())) {
                if (!m.toDate().equals(date.toString()) || !m.toSession().equalsIgnoreCase(s.name())) continue;
                if (b.entries().stream().anyMatch(e -> same(e, date, s.name(), m.studentId()))) continue;
                b.entries().add(new Entry(date.toString(), s.name(), m.studentId(), m.studentName(), RollBook.PRESENT, null, by, byName, now));
                followCover(b, date, s.name(), m.studentId(), RollBook.PRESENT, by, byName, now);
            }
            return b;
        });
        return classOn(date, s);
    }

    /**
     * If the student was marked in a class they came to as a cover-up, the class they missed
     * follows: present or late makes it M (made up); absent leaves it A; clearing sets it back.
     */
    private static void followCover(RollBook b, LocalDate date, String session, String studentId, String status,
                                    String by, String byName, Instant now) {
        Makeup m = b.makeups().stream().filter(x -> x.studentId().equals(studentId) && x.toDate().equals(date.toString())
                && x.toSession().equalsIgnoreCase(session)).findFirst().orElse(null);
        if (m == null) return;
        String outcome = status == null ? Makeup.BOOKED : RollBook.ABSENT.equals(status) ? Makeup.MISSED : Makeup.ATTENDED;
        b.makeups().replaceAll(x -> x.id().equals(m.id()) ? x.withStatus(outcome) : x);
        String when = LocalDate.parse(m.toDate()).format(DAY_SHORT);
        String originalStatus = Makeup.ATTENDED.equals(outcome) ? RollBook.MADE_UP : RollBook.ABSENT;
        String note = switch (outcome) {
            case Makeup.ATTENDED -> "Made up: " + m.toSession() + " · " + when;
            case Makeup.MISSED -> "Missed the cover-up: " + m.toSession() + " · " + when;
            default -> "Cover-up booked: " + m.toSession() + " · " + when;
        };
        LocalDate from = LocalDate.parse(m.fromDate());
        b.entries().removeIf(e -> same(e, from, m.fromSession(), studentId));
        b.entries().add(new Entry(m.fromDate(), m.fromSession(), studentId, m.studentName(), originalStatus, note, by, byName, now));
    }

    private RollClass classOn(LocalDate date, Session s) {
        return day(date).classes().stream().filter(c -> c.session().name().equalsIgnoreCase(s.name())).findFirst().orElseThrow();
    }

    private void checkDay(LocalDate date, Session s) {
        String day = date.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
        if (!day.equalsIgnoreCase(s.day())) {
            throw ApiException.badRequest(s.name() + " meets on " + s.day() + ", not on " + day + ".");
        }
        if (date.isAfter(today())) throw ApiException.badRequest("That class has not happened yet.");
    }

    private static boolean same(Entry e, LocalDate date, String session, String studentId) {
        return e.date().equals(date.toString()) && e.session().equalsIgnoreCase(session) && e.studentId().equals(studentId);
    }

    /* =========================================================
       Cover-up classes
       ========================================================= */

    public record BookInput(String studentId, String fromSession, String fromDate, String toSession, String toDate, String note) {}

    /** A cover-up as shown on the office's list. */
    public record MakeupOut(String id, String studentId, String studentName, String category, String fromSession, String fromDate,
                            String fromLabel, String toSession, String toDate, String toLabel, String status, String note,
                            String byName, Instant at) {}

    /**
     * Books a student who missed (or will miss) a class into another session instead. The class
     * they miss is marked absent, noting the cover-up, until the cover-up class is marked.
     */
    public MakeupOut book(BookInput in, String by, String byName) {
        if (in == null) throw ApiException.badRequest("Nothing was sent.");
        Roster r = roster.load();
        Student st = r.students().stream().filter(x -> x.id().equals(in.studentId())).findFirst()
                .orElseThrow(() -> ApiException.notFound("No student with id " + in.studentId()));
        Session from = session(r, in.fromSession()), to = session(r, in.toSession());
        LocalDate fromDate = date(in.fromDate()), toDate = date(in.toDate());
        onItsDay(fromDate, from, "The class missed");
        onItsDay(toDate, to, "The cover-up class");
        if (from.name().equalsIgnoreCase(to.name())) {
            throw ApiException.badRequest("Pick a different session for the cover-up — " + st.name() + " is already in " + from.name() + ".");
        }
        RollBook b0 = repo.get();
        if (b0.makeups().stream().anyMatch(m -> m.studentId().equals(st.id()) && m.fromDate().equals(fromDate.toString())
                && m.fromSession().equalsIgnoreCase(from.name()))) {
            throw ApiException.conflict(st.name() + " already has a cover-up booked for " + from.name() + " on "
                    + fromDate.format(DAY_SHORT) + ". Cancel it first to book another.");
        }
        if (b0.makeups().stream().anyMatch(m -> m.studentId().equals(st.id()) && m.toDate().equals(toDate.toString())
                && m.toSession().equalsIgnoreCase(to.name()))) {
            throw ApiException.conflict(st.name() + " is already coming to " + to.name() + " on " + toDate.format(DAY_SHORT) + " for a cover-up.");
        }
        String id = "mu" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        Instant now = Instant.now(clock);
        String note = in.note() == null ? null : clip(in.note());
        Makeup m = new Makeup(id, st.id(), st.name(), from.name(), fromDate.toString(), to.name(), toDate.toString(),
                Makeup.BOOKED, note, by, byName, now);
        repo.update(b -> {
            b.makeups().add(m);
            Entry old = b.entries().stream().filter(e -> same(e, fromDate, from.name(), st.id())).findFirst().orElse(null);
            if (old == null || !RollBook.MADE_UP.equals(old.status())) {
                b.entries().removeIf(e -> same(e, fromDate, from.name(), st.id()));
                b.entries().add(new Entry(fromDate.toString(), from.name(), st.id(), st.name(), RollBook.ABSENT,
                        "Cover-up booked: " + to.name() + " · " + toDate.format(DAY_SHORT), by, byName, now));
            }
            return b;
        });
        return out(r, m);
    }

    /** Cancels a cover-up. The class missed goes back to plain absent. */
    public void cancel(String id, String by, String byName) {
        Makeup m = repo.get().makeups().stream().filter(x -> x.id().equals(id)).findFirst()
                .orElseThrow(() -> ApiException.notFound("No cover-up with id " + id));
        Instant now = Instant.now(clock);
        repo.update(b -> {
            b.makeups().removeIf(x -> x.id().equals(id));
            b.entries().removeIf(e -> same(e, LocalDate.parse(m.toDate()), m.toSession(), m.studentId()));
            LocalDate from = LocalDate.parse(m.fromDate());
            b.entries().removeIf(e -> same(e, from, m.fromSession(), m.studentId()));
            // a class still to come has no mark yet; one already held goes back to plain absent
            if (!from.isAfter(today())) {
                b.entries().add(new Entry(m.fromDate(), m.fromSession(), m.studentId(), m.studentName(), RollBook.ABSENT,
                        null, by, byName, now));
            }
            return b;
        });
    }

    /** Cover-ups touching a month (missed or attended in it), soonest first. */
    public List<MakeupOut> makeups(String month) {
        YearMonth.parse(month);
        Roster r = roster.load();
        return repo.get().makeups().stream()
                .filter(m -> m.fromDate().startsWith(month) || m.toDate().startsWith(month))
                .sorted(Comparator.comparing(Makeup::toDate).thenComparing(Makeup::studentName))
                .map(m -> out(r, m)).toList();
    }

    private static MakeupOut out(Roster r, Makeup m) {
        String cat = r.students().stream().filter(s -> s.id().equals(m.studentId())).map(Student::category).findFirst().orElse("");
        Session to = r.sessions().stream().filter(s -> s.name().equalsIgnoreCase(m.toSession())).findFirst().orElse(null);
        String toTime = to == null ? "" : " · " + to.time();
        return new MakeupOut(m.id(), m.studentId(), m.studentName(), cat, m.fromSession(), m.fromDate(),
                m.fromSession() + " · " + LocalDate.parse(m.fromDate()).format(DAY_SHORT),
                m.toSession(), m.toDate(), m.toSession() + " · " + LocalDate.parse(m.toDate()).format(DAY_SHORT) + toTime,
                m.status(), m.note(), m.byName(), m.at());
    }

    private static void onItsDay(LocalDate date, Session s, String what) {
        String day = date.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
        if (!day.equalsIgnoreCase(s.day())) {
            throw ApiException.badRequest(what + " (" + s.name() + ") meets on " + s.day() + ", not on " + day + ".");
        }
    }

    /* =========================================================
       The month, like the paper register
       ========================================================= */

    public record Cell(String date, String status, String note) {}

    public record MonthRow(String id, String name, List<Cell> cells, int present, int late, int absent, int madeUp,
                           Integer rate, boolean left) {}

    public record MonthDate(String date, String label, boolean future, boolean holiday, String markedBy) {}

    public record RollMonth(Session session, String month, String label, List<MonthDate> dates, List<MonthRow> rows,
                            List<Session> sessions) {}

    public RollMonth month(String sessionName, String month) {
        YearMonth ym;
        try {
            ym = YearMonth.parse(month);
        } catch (Exception e) {
            throw ApiException.badRequest("Months look like 2026-11.");
        }
        Roster r = roster.load();
        Session s = session(r, sessionName);
        DayOfWeek dow = dayOfWeek(s.day());
        LocalDate today = today();
        RollBook book = repo.get();
        List<LocalDate> days = new ArrayList<>();
        for (LocalDate d = ym.atDay(1); !d.isAfter(ym.atEndOfMonth()); d = d.plusDays(1)) {
            if (d.getDayOfWeek() == dow) days.add(d);
        }
        // students who only came here for a cover-up belong to their own session's register
        Set<String> visits = new HashSet<>();
        for (Makeup m : book.makeups()) if (m.toSession().equalsIgnoreCase(s.name())) visits.add(m.studentId() + "|" + m.toDate());
        List<Entry> mine = book.entries().stream().filter(e -> e.session().equalsIgnoreCase(s.name())
                && e.date().startsWith(ym.toString()) && !visits.contains(e.studentId() + "|" + e.date())).toList();
        List<MonthDate> dates = days.stream().map(d -> new MonthDate(d.toString(), d.format(SHORT), d.isAfter(today),
                teachers.get().holidays().stream().anyMatch(h -> h.date().equals(d.toString()) && h.off()),
                mine.stream().filter(e -> e.date().equals(d.toString())).reduce(RollService::later)
                        .map(Entry::byName).orElse(null))).toList();

        List<MonthRow> rows = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        for (Student st : r.students()) {
            if (!st.active() || !s.name().equalsIgnoreCase(st.session())) continue;
            rows.add(row(st.id(), st.name(), days, mine, false));
            seen.add(st.id());
        }
        mine.stream().filter(e -> !seen.contains(e.studentId())).map(e -> List.of(e.studentId(), e.studentName())).distinct()
                .forEach(x -> rows.add(row(x.get(0), x.get(1), days, mine, true)));
        return new RollMonth(s, ym.toString(), ym.getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " " + ym.getYear(),
                dates, rows, r.sessions().stream().sorted(Comparator.comparing((Session x) -> dayOfWeek(x.day()))
                        .thenComparing(x -> times(x.time()).start())).toList());
    }

    private static MonthRow row(String id, String name, List<LocalDate> days, List<Entry> entries, boolean left) {
        List<Cell> cells = new ArrayList<>();
        int p = 0, l = 0, a = 0, mu = 0;
        for (LocalDate d : days) {
            Entry e = entries.stream().filter(x -> x.studentId().equals(id) && x.date().equals(d.toString())).findFirst().orElse(null);
            cells.add(new Cell(d.toString(), e == null ? null : e.status(), e == null ? null : e.note()));
            if (e == null) continue;
            switch (e.status()) {
                case RollBook.PRESENT -> p++;
                case RollBook.LATE -> l++;
                case RollBook.MADE_UP -> mu++;
                default -> a++;
            }
        }
        // late and made-up both count as attended
        Integer rate = p + l + a + mu == 0 ? null : Math.round(100f * (p + l + mu) / (p + l + a + mu));
        return new MonthRow(id, name, cells, p, l, a, mu, rate, left);
    }

    /* =========================================================
       The student session behind a teacher's timetable slot
       ========================================================= */

    /**
     * What a teacher sees about a class: the session's name and musical term ("Forte" · Dynamics ·
     * "loud and strong" · f), its size limit and how many active students it has.
     */
    public record ClassInfo(String session, String family, String meaning, String symbol, String symbolStyle,
                            Integer max, int students) {}

    /**
     * For each timetable slot, the session meeting on the same day at the same start time, of the
     * same class (Kids, Junior …) when there is one; slots with no matching session are left out.
     */
    public Map<String, ClassInfo> classInfo(List<lk.shalom.receipts.model.TeacherBook.Slot> slots) {
        Roster r = roster.load();
        Map<String, ClassInfo> out = new java.util.LinkedHashMap<>();
        for (var slot : slots) {
            LocalTime start;
            try { start = LocalTime.parse(slot.start()); } catch (RuntimeException e) { continue; }
            List<Session> same = r.sessions().stream().filter(s -> slot.day() != null && slot.day().equalsIgnoreCase(s.day())
                    && times(s.time()).start().equals(start)).toList();
            Session s = same.stream().filter(x -> x.category() != null && x.category().equalsIgnoreCase(slot.category()))
                    .findFirst().orElse(same.size() == 1 ? same.getFirst() : null);
            if (s == null) continue;
            int students = (int) r.students().stream().filter(st -> st.active() && s.name().equalsIgnoreCase(st.session())).count();
            out.put(slot.id(), new ClassInfo(s.name(), s.family(), s.meaning(), s.symbol(), s.symbolStyle(), s.max(), students));
        }
        return out;
    }

    /* =========================================================
       Helpers
       ========================================================= */

    record Times(LocalTime start, LocalTime end) {}

    private static final Pattern CLOCK = Pattern.compile("(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)?", Pattern.CASE_INSENSITIVE);

    /**
     * "3:30 - 4:30 PM", "11:30 AM - 12:30 PM", "9:30 - 10:30 AM". A start without AM/PM takes the
     * end's, unless that would put it after the end ("11:30 - 12:30 PM" starts at 11:30 AM).
     */
    static Times times(String text) {
        if (text == null) return new Times(LocalTime.MIDNIGHT, LocalTime.MIDNIGHT);
        String[] parts = text.split("[-–]");
        Matcher a = CLOCK.matcher(parts[0].trim());
        Matcher b = CLOCK.matcher(parts.length > 1 ? parts[1].trim() : "");
        if (!a.find()) return new Times(LocalTime.MIDNIGHT, LocalTime.MIDNIGHT);
        boolean hasEnd = b.find();
        String endMer = hasEnd ? b.group(3) : null;
        String startMer = a.group(3) != null ? a.group(3) : endMer;
        LocalTime start = at(a.group(1), a.group(2), startMer);
        LocalTime end = hasEnd ? at(b.group(1), b.group(2), endMer) : start.plusHours(1);
        if (a.group(3) == null && start.isAfter(end)) start = start.minusHours(12);
        return new Times(start, end);
    }

    private static LocalTime at(String h, String m, String mer) {
        int hour = Integer.parseInt(h) % 12;
        if (mer == null ? hour < 8 : mer.equalsIgnoreCase("PM")) hour += 12;   // classes run in the afternoon
        return LocalTime.of(hour % 24, m == null ? 0 : Integer.parseInt(m));
    }

    private static DayOfWeek dayOfWeek(String day) {
        for (DayOfWeek d : DayOfWeek.values()) {
            if (d.getDisplayName(TextStyle.FULL, Locale.ENGLISH).equalsIgnoreCase(Objects.requireNonNullElse(day, "").trim())) return d;
        }
        return DayOfWeek.MONDAY;
    }

    private static Session session(Roster r, String name) {
        return r.sessions().stream().filter(s -> s.name().equalsIgnoreCase(name == null ? "" : name.trim())).findFirst()
                .orElseThrow(() -> ApiException.notFound("No class session called " + name));
    }

    private static LocalDate date(String iso) {
        try {
            return LocalDate.parse(iso);
        } catch (Exception e) {
            throw ApiException.badRequest("Dates look like 2026-11-04.");
        }
    }

    private static String clip(String s) {
        String t = s.trim();
        return t.isEmpty() ? null : t.length() > 200 ? t.substring(0, 200) : t;
    }
}
