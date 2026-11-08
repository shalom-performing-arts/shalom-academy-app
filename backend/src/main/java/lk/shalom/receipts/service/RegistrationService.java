package lk.shalom.receipts.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lk.shalom.receipts.model.AppSettings;
import lk.shalom.receipts.model.RegistrationBook;
import lk.shalom.receipts.model.RegistrationBook.Form;
import lk.shalom.receipts.model.RegistrationBook.Registration;
import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Session;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;
import lk.shalom.receipts.repository.RegistrationRepository;
import lk.shalom.receipts.repository.RosterRepository;
import lk.shalom.receipts.repository.SettingsRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.time.format.DateTimeParseException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * The online registration form and the registration pool.
 *
 * <p>Parents submit the public form without signing in; each child lands in the pool with a
 * registration number. The office then places a child in a class, which creates the student
 * through {@link StudentService} exactly as the Students page does, so fees, receipts, the
 * Classes page and attendance all pick them up from there.
 */
@Service
public class RegistrationService {

    public static final String POOL = "pool";
    public static final String PLACED = "placed";

    /** at most this many submissions an hour from one address */
    static final int PER_HOUR = 8;

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final List<String> WEEK = List.of("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday");

    private final RegistrationRepository repo;
    private final RosterRepository roster;
    private final SettingsRepository settings;
    private final StudentService students;
    private final Clock clock;
    private final Map<String, Deque<Instant>> recent = new ConcurrentHashMap<>();

    @Autowired
    public RegistrationService(RegistrationRepository repo, RosterRepository roster, SettingsRepository settings,
                               StudentService students) {
        this(repo, roster, settings, students, Clock.system(TeacherService.SRI_LANKA));
    }

    RegistrationService(RegistrationRepository repo, RosterRepository roster, SettingsRepository settings,
                        StudentService students, Clock clock) {
        this.repo = repo;
        this.roster = roster;
        this.settings = settings;
        this.students = students;
        this.clock = clock;
    }

    /* ======================= the public form ======================= */

    /** What the parent's form needs: the academy, the questions' choices, and whether it is open. */
    public record PublicForm(boolean open, String title, String intro, String closedMessage, String academy,
                             String logo, String phone, String whatsapp, List<String> classes,
                             List<String> courses, List<String> days) {}

    /** What a parent fills in, and what the office can change. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RegistrationInput(
            String childName, String preferredName, String dateOfBirth, String gender, String school, String grade,
            String interest, String preferredClass, List<String> preferredDays, String experience,
            String parentName, String relation, String phone, String whatsapp, String email, String address,
            String emergencyName, String emergencyPhone, String medical, String howHeard, String message,
            Boolean photoConsent, Boolean agreed, String adminNote, String submissionKey, String website) {}

    public record Submitted(String number, String childName, String parentName, String thanks) {}

    public PublicForm publicForm(String token) {
        Form f = formFor(token);
        AppSettings s = settings.get();
        Roster r = roster.load();
        List<String> days = r.sessions().stream().map(Session::day).filter(d -> d != null && WEEK.contains(d))
                .distinct().sorted(Comparator.comparingInt(WEEK::indexOf)).toList();
        return new PublicForm(f.open(), f.title(), f.intro(), f.closedMessage(), s.academyName(), s.logo(),
                s.phone(), s.whatsapp(), r.categories().stream().map(Roster.Category::name).toList(),
                s.classes().stream().map(AppSettings.ClassFee::name).toList(), days);
    }

    public Submitted submit(String token, RegistrationInput in, String address) {
        Form f = formFor(token);
        if (!f.open()) throw ApiException.conflict(f.closedMessage());
        if (in == null) throw ApiException.badRequest("Please fill in the form.");
        if (in.website() != null && !in.website().isBlank()) throw ApiException.badRequest("Please try again.");   // a bot
        Clean c = clean(in, true);
        Instant now = clock.instant();
        synchronized (this) {
            RegistrationBook book = repo.get();
            // a second tap on Submit, or the page sent again: the same registration, not a new one
            if (c.submissionKey != null) {
                for (Registration x : book.items()) {
                    if (c.submissionKey.equals(x.submissionKey())) {
                        return new Submitted(x.number(), x.childName(), x.parentName(), f.thanks());
                    }
                }
            }
            Registration dup = duplicateOf(book, c, null);
            if (dup != null) {
                throw ApiException.conflict(dup.childName() + " is already registered (" + dup.number() + "). "
                        + "If anything needs changing, please contact the academy.");
            }
            throttle(address, now);
            Registration reg = c.toRegistration(UUID.randomUUID().toString(), nextNumber(book, now), now, null);
            repo.update(b -> {
                b.items().add(reg);
                return b;
            });
            return new Submitted(reg.number(), reg.childName(), reg.parentName(), f.thanks());
        }
    }

    private Form formFor(String token) {
        Form f = repo.get().form();
        if (token == null || !token.equals(f.token())) {
            throw ApiException.notFound("This registration link is not valid any more. Please ask the academy for the new link.");
        }
        return f;
    }

    private void throttle(String address, Instant now) {
        if (address == null) return;
        Deque<Instant> times = recent.computeIfAbsent(address, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && times.peekFirst().isBefore(now.minus(Duration.ofHours(1)))) times.pollFirst();
            if (times.size() >= PER_HOUR) {
                throw ApiException.conflict("Too many registrations from this connection. Please try again in an hour, "
                        + "or contact the academy.");
            }
            times.addLast(now);
        }
    }

    /* ======================= the pool, for the office ======================= */

    /**
     * A registration with where it stands: still in the pool, or placed (and where).
     *
     * @param maybeStudent an existing student with the same name, who may be this child already
     */
    public record Row(Registration reg, String status, Placement placed, Integer age, String maybeStudent) {}

    public record Placement(String studentId, String name, String category, String session, String day, String time,
                            boolean active) {}

    public List<Row> list() {
        Roster r = roster.load();
        return repo.get().items().stream()
                .sorted(Comparator.comparing(Registration::submittedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(x -> row(x, r)).toList();
    }

    public Row get(String id) {
        return row(find(id), roster.load());
    }

    public Row update(String id, RegistrationInput in) {
        Clean c = clean(in, false);
        synchronized (this) {
            Registration old = find(id);
            Registration dup = duplicateOf(repo.get(), c, id);
            if (dup != null) throw ApiException.conflict("That matches another registration: " + dup.childName() + " (" + dup.number() + ").");
            Registration next = c.toRegistration(old.id(), old.number(), old.submittedAt(), old)
                    .placed(old.studentId(), old.placedAt());
            repo.update(b -> {
                b.items().replaceAll(x -> x.id().equals(id) ? next : x);
                return b;
            });
            return row(next, roster.load());
        }
    }

    /** Removes the registration only; a student already made from it stays on the Students page. */
    public synchronized void delete(String id) {
        find(id);
        repo.update(b -> {
            b.items().removeIf(x -> x.id().equals(id));
            return b;
        });
    }

    /** Where to place a child: a class and, for classes with sessions, the session. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PlaceInput(String category, String session, BigDecimal specialFee, String name) {}

    /**
     * Places the child in a class: creates the student in students.json (a new SAPA number, the
     * class fee, the session's day and time) and marks the registration as placed. Moving them
     * later is done on the Classes or Students page, like any other student.
     */
    public synchronized Row place(String id, PlaceInput in) {
        Registration reg = find(id);
        Roster r = roster.load();
        Student already = reg.studentId() == null ? null
                : r.students().stream().filter(s -> s.id().equals(reg.studentId())).findFirst().orElse(null);
        if (already != null) {
            throw ApiException.conflict(reg.childName() + " is already placed (" + already.id() + ", "
                    + (blank(already.session()) ? already.category() : already.session()) + "). Move them on the Classes page.");
        }
        if (in == null || blank(in.category())) throw ApiException.badRequest("Pick the class.");
        String name = blank(in.name()) ? reg.childName() : in.name().trim();
        String phone = blank(reg.whatsapp()) ? reg.phone() : reg.whatsapp();
        List<String> notes = new ArrayList<>();
        notes.add("Registered online " + reg.number());
        if (!blank(reg.medical())) notes.add("Medical: " + reg.medical());
        Student s = students.create(new StudentInput(name, in.category().trim(), blank(in.session()) ? "" : in.session().trim(),
                in.specialFee(), true, reg.parentName(), phone, String.join(" · ", notes), "", "",
                customFields(reg), reg.dateOfBirth()));
        Instant now = clock.instant();
        repo.update(b -> {
            b.items().replaceAll(x -> x.id().equals(id) ? x.placed(s.id(), now) : x);
            return b;
        });
        return get(id);
    }

    /** Fills the extra student fields set up in Settings that match a question on the form. */
    private Map<String, String> customFields(Registration reg) {
        Map<String, String> out = new LinkedHashMap<>();
        for (AppSettings.StudentField f : settings.get().studentFields()) {
            String l = f.label().toLowerCase(Locale.ROOT);
            String v = l.contains("birth") || l.equals("dob") ? reg.dateOfBirth()
                    : l.contains("school") ? reg.school()
                    : l.contains("grade") ? reg.grade()
                    : l.contains("email") ? reg.email()
                    : l.contains("gender") ? reg.gender()
                    : l.contains("address") ? reg.address()
                    : l.contains("emergency") ? join(reg.emergencyName(), reg.emergencyPhone())
                    : l.contains("medical") || l.contains("allerg") ? reg.medical()
                    : l.contains("course") || l.contains("instrument") ? reg.interest()
                    : null;
            if (!blank(v)) out.put(f.key(), v);
        }
        return out;
    }

    /* ======================= form management ======================= */

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FormInput(Boolean open, String title, String intro, String closedMessage, String thanks) {}

    public record FormView(Form form, int total, int inPool, int placed, Instant lastAt) {}

    public FormView form() {
        RegistrationBook b = repo.get();
        Roster r = roster.load();
        List<Row> rows = b.items().stream().map(x -> row(x, r)).toList();
        int placed = (int) rows.stream().filter(x -> PLACED.equals(x.status())).count();
        Instant last = b.items().stream().map(Registration::submittedAt).filter(Objects::nonNull)
                .max(Comparator.naturalOrder()).orElse(null);
        return new FormView(b.form(), rows.size(), rows.size() - placed, placed, last);
    }

    public synchronized FormView saveForm(FormInput in) {
        if (in == null) throw ApiException.badRequest("Nothing to save.");
        repo.update(b -> {
            Form f = b.form();
            return new RegistrationBook(b.items(), new Form(in.open() == null ? f.open() : in.open(), f.token(),
                    keep(in.title(), f.title(), 120), keep(in.intro(), f.intro(), 1000),
                    keep(in.closedMessage(), f.closedMessage(), 600), keep(in.thanks(), f.thanks(), 600)));
        });
        return form();
    }

    /** A new link: the old one stops working, for when it was shared somewhere it should not be. */
    public synchronized FormView newLink() {
        repo.update(b -> {
            Form f = b.form();
            return new RegistrationBook(b.items(), new Form(f.open(), RegistrationRepository.newToken(), f.title(),
                    f.intro(), f.closedMessage(), f.thanks()));
        });
        return form();
    }

    /* ======================= export ======================= */

    private static final List<String> HEADER = List.of("Registration no.", "Submitted", "Status", "Student no.",
            "Placed in class", "Session", "Child's name", "Preferred name", "Date of birth", "Age", "Gender", "School",
            "Grade", "Course", "Preferred class", "Preferred days", "Music experience", "Parent / guardian", "Relation",
            "Phone", "WhatsApp", "Email", "Address", "Emergency contact", "Emergency phone", "Medical / allergies",
            "How they heard of us", "Message from parent", "Photo consent", "Office note");

    public List<List<String>> table() {
        List<List<String>> out = new ArrayList<>();
        out.add(HEADER);
        for (Row x : list()) {
            Registration g = x.reg();
            Placement p = x.placed();
            out.add(List.of(s(g.number()), g.submittedAt() == null ? "" : g.submittedAt().atZone(clock.getZone()).toLocalDateTime()
                            .withSecond(0).withNano(0).toString().replace('T', ' '),
                    PLACED.equals(x.status()) ? "Placed" : "In pool", p == null ? "" : s(p.studentId()),
                    p == null ? "" : s(p.category()), p == null ? "" : s(p.session()),
                    s(g.childName()), s(g.preferredName()), s(g.dateOfBirth()), x.age() == null ? "" : x.age().toString(),
                    s(g.gender()), s(g.school()), s(g.grade()), s(g.interest()), s(g.preferredClass()),
                    g.preferredDays() == null ? "" : String.join(", ", g.preferredDays()), s(g.experience()),
                    s(g.parentName()), s(g.relation()), s(g.phone()), s(g.whatsapp()), s(g.email()), s(g.address()),
                    s(g.emergencyName()), s(g.emergencyPhone()), s(g.medical()), s(g.howHeard()), s(g.message()),
                    Boolean.TRUE.equals(g.photoConsent()) ? "Yes" : "No", s(g.adminNote())));
        }
        return out;
    }

    public String csv() {
        StringBuilder b = new StringBuilder("﻿");   // so Excel reads the Sinhala and Tamil names right
        for (List<String> row : table()) {
            b.append(String.join(",", row.stream().map(RegistrationService::csvCell).toList())).append("\r\n");
        }
        return b.toString();
    }

    public byte[] xlsx() {
        return XlsxWriter.write("Registrations", table());
    }

    private static String csvCell(String v) {
        String t = v == null ? "" : v;
        if (!t.isEmpty() && "=+-@".indexOf(t.charAt(0)) >= 0 && !t.matches("^[-+]?\\d[\\d ]*$")) t = "'" + t;   // no formulas
        return t.contains(",") || t.contains("\"") || t.contains("\n") || t.contains("\r")
                ? "\"" + t.replace("\"", "\"\"") + "\"" : t;
    }

    /* ======================= helpers ======================= */

    private Registration find(String id) {
        return repo.get().items().stream().filter(x -> x.id().equals(id)).findFirst()
                .orElseThrow(() -> ApiException.notFound("That registration was not found. It may have been deleted."));
    }

    private Row row(Registration x, Roster r) {
        Student st = x.studentId() == null ? null
                : r.students().stream().filter(s -> s.id().equals(x.studentId())).findFirst().orElse(null);
        Placement p = st == null ? null : new Placement(st.id(), st.name(), st.category(), st.session(), st.day(), st.time(), st.active());
        String maybe = null;
        if (st == null) {
            String n = norm(x.childName());
            maybe = r.students().stream().filter(s -> norm(s.name()).equals(n)).findFirst()
                    .map(s -> s.name() + " (" + s.id() + ")").orElse(null);
        }
        return new Row(x, st == null ? POOL : PLACED, p, age(x.dateOfBirth()), maybe);
    }

    private Integer age(String dob) {
        try {
            return dob == null ? null : Period.between(LocalDate.parse(dob), LocalDate.now(clock)).getYears();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Same child: the same name and either the same birthday or the same parent's phone. */
    private static Registration duplicateOf(RegistrationBook book, Clean c, String exceptId) {
        String n = norm(c.childName);
        String phone = tail(c.phone);
        for (Registration x : book.items()) {
            if (x.id().equals(exceptId) || !norm(x.childName()).equals(n)) continue;
            if (Objects.equals(x.dateOfBirth(), c.dateOfBirth) || (!phone.isEmpty() && phone.equals(tail(x.phone())))) return x;
        }
        return null;
    }

    /** REG-2026-0001, counting afresh each year. */
    private String nextNumber(RegistrationBook book, Instant now) {
        String prefix = "REG-" + now.atZone(clock.getZone()).getYear() + "-";
        int max = 0;
        for (Registration x : book.items()) {
            if (x.number() != null && x.number().startsWith(prefix)) {
                try {
                    max = Math.max(max, Integer.parseInt(x.number().substring(prefix.length())));
                } catch (NumberFormatException ignored) {
                    // a number typed by hand; skip it
                }
            }
        }
        return prefix + String.format("%04d", max + 1);
    }

    /** The checked and tidied answers. */
    private final class Clean {
        String childName, preferredName, dateOfBirth, gender, school, grade, interest, preferredClass, experience,
                parentName, relation, phone, whatsapp, email, address, emergencyName, emergencyPhone, medical,
                howHeard, message, adminNote, submissionKey;
        List<String> preferredDays;
        boolean photoConsent, agreed;

        Registration toRegistration(String id, String number, Instant submittedAt, Registration old) {
            Instant now = clock.instant();
            return new Registration(id, number, submittedAt, old == null ? submissionKey : old.submissionKey(),
                    childName, preferredName, dateOfBirth, gender, school, grade, interest, preferredClass,
                    preferredDays, experience, parentName, relation, phone, whatsapp, email, address, emergencyName,
                    emergencyPhone, medical, howHeard, message, photoConsent,
                    old == null ? agreed : Boolean.TRUE.equals(old.agreed()), old == null ? null : adminNote,
                    null, null, old == null ? null : now);
        }
    }

    private Clean clean(RegistrationInput in, boolean parent) {
        if (in == null) throw ApiException.badRequest("Please fill in the form.");
        Clean c = new Clean();
        c.childName = name(in.childName(), "the child's full name");
        c.preferredName = text(in.preferredName(), 60);
        if (blank(in.dateOfBirth())) throw ApiException.badRequest("Please enter the child's date of birth.");
        try {
            LocalDate dob = LocalDate.parse(in.dateOfBirth().trim());
            LocalDate today = LocalDate.now(clock);
            if (dob.isAfter(today)) throw ApiException.badRequest("The date of birth cannot be in the future.");
            if (dob.isBefore(today.minusYears(100))) throw ApiException.badRequest("Please check the date of birth.");
            c.dateOfBirth = dob.toString();
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("Please enter the date of birth as a date.");
        }
        c.gender = text(in.gender(), 30);
        c.school = text(in.school(), 120);
        c.grade = text(in.grade(), 30);
        c.interest = text(in.interest(), 80);
        c.preferredClass = text(in.preferredClass(), 40);
        if (!blank(c.preferredClass) && roster.load().category(c.preferredClass) == null) {
            throw ApiException.badRequest("Please pick the class from the list.");
        }
        c.preferredDays = in.preferredDays() == null ? List.of()
                : in.preferredDays().stream().filter(WEEK::contains).distinct().sorted(Comparator.comparingInt(WEEK::indexOf)).toList();
        c.experience = text(in.experience(), 200);
        c.parentName = name(in.parentName(), "the parent or guardian's name");
        c.relation = text(in.relation(), 30);
        if (parent && blank(c.relation)) throw ApiException.badRequest("Please say how you are related to the child.");
        c.phone = phone(in.phone(), "Phone number", true);
        c.whatsapp = phone(in.whatsapp(), "WhatsApp number", false);
        c.email = text(in.email(), 120);
        if (!blank(c.email) && !EMAIL.matcher(c.email).matches()) throw ApiException.badRequest("Please check the email address, e.g. name@gmail.com.");
        c.address = text(in.address(), 300);
        c.emergencyName = text(in.emergencyName(), 80);
        c.emergencyPhone = phone(in.emergencyPhone(), "Emergency contact number", false);
        c.medical = text(in.medical(), 600);
        c.howHeard = text(in.howHeard(), 80);
        c.message = text(in.message(), 1000);
        c.photoConsent = Boolean.TRUE.equals(in.photoConsent());
        c.agreed = Boolean.TRUE.equals(in.agreed());
        if (parent && !c.agreed) throw ApiException.badRequest("Please tick the box to agree to the academy's terms.");
        c.adminNote = text(in.adminNote(), 1000);
        c.submissionKey = blank(in.submissionKey()) ? null : text(in.submissionKey(), 64);
        return c;
    }

    private static String name(String v, String what) {
        String t = text(v, 80);
        if (t == null || t.replaceAll("[^\\p{L}]", "").length() < 2) throw ApiException.badRequest("Please enter " + what + ".");
        return t;
    }

    /** 0710407740, +44 7700 900123 → kept as typed but tidied; 9 to 15 digits. */
    static String phone(String v, String what, boolean required) {
        if (blank(v)) {
            if (required) throw ApiException.badRequest("Please enter the " + what.toLowerCase(Locale.ROOT) + ".");
            return null;
        }
        String t = v.trim();
        if (!t.matches("^\\+?[0-9 ()\\-]{7,24}$")) throw ApiException.badRequest(what + ": use numbers only, e.g. 071 040 7740.");
        String digits = t.replaceAll("\\D", "");
        if (!t.startsWith("+") && digits.startsWith("0") && digits.length() != 10) {
            throw ApiException.badRequest(what + ": a Sri Lankan number has 10 digits, e.g. 071 040 7740.");
        }
        if (digits.length() < 9 || digits.length() > 15) throw ApiException.badRequest(what + " looks too short or too long.");
        return t.replaceAll("\\s+", " ");
    }

    private static String text(String v, int max) {
        if (v == null) return null;
        String t = v.replaceAll("[\\p{Cntrl}&&[^\\n]]", "").trim();
        if (t.isEmpty()) return null;
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static String keep(String v, String old, int max) {
        return v == null ? old : Objects.requireNonNullElse(text(v, max), old);
    }

    static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    /** the last 9 digits, so 0710407740 and +94 71 040 7740 match */
    private static String tail(String phone) {
        if (phone == null) return "";
        String d = phone.replaceAll("\\D", "");
        return d.length() > 9 ? d.substring(d.length() - 9) : d;
    }

    private static String join(String a, String b) {
        return String.join(" ", java.util.stream.Stream.of(a, b).filter(x -> !blank(x)).toList());
    }

    private static String s(String v) {
        return v == null ? "" : v;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
