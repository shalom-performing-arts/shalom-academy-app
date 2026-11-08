package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Category;
import lk.shalom.receipts.model.Roster.Session;
import lk.shalom.receipts.model.Roster.SessionInput;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The roster: students, sessions and classes, worked on in the shape of students.json:
 * {@code { "categories": [...], "classes": [...], "students": [...] }}. Where that is kept is up to
 * the subclass: the JSON file ({@link JsonRosterRepository}) or the database.
 *
 * <p>The file carries more than this app manages (ages, songs, adjudication results). Records
 * are edited in place as maps, so every field the app does not know about is written back
 * untouched.
 *
 * <p>Older copies of the file have no "categories" block and no "specialFee". Both are worked
 * out on reading: a class's fee is the fee most of its students pay, and a student paying
 * something else has a special fee. They are stored the first time anything is saved.
 */
public abstract class AbstractRosterRepository implements RosterRepository {

    /** The order classes appear in everywhere. */
    public static final List<String> CATEGORY_ORDER = List.of("Kids", "Junior", "Youth", "Adult", "Online");

    /** The whole roster in the shape of students.json: categories, classes (sessions) and students. */
    protected abstract Map<String, Object> readRaw();

    /** Stores the whole roster, as {@link #readRaw()} gives it. */
    protected abstract void writeRaw(Map<String, Object> raw);

    /* ---------------- reading ---------------- */

    @Override
    public synchronized Roster load() {
        return view(readRaw());
    }

    /** This month, "2026-11": the class fee shown on the Students page is the one charged now. */
    public static String thisMonth() {
        return YearMonth.now(ZoneId.of("Asia/Colombo")).toString();
    }

    private static Roster view(Map<String, Object> raw) {
        List<Map<String, Object>> students = maps(raw.get("students"));
        List<Category> categories = categories(raw, students);
        Map<String, Category> byCategory = new HashMap<>();
        categories.forEach(c -> byCategory.put(c.name().toLowerCase(), c));
        String now = thisMonth();
        boolean migrated = raw.containsKey("categories");

        List<Session> sessions = sessions(raw.get("classes"), students);
        Map<String, Session> byName = sessions.stream()
                .collect(Collectors.toMap(s -> s.name().toLowerCase(), Function.identity(), (a, b) -> a));

        List<Student> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, Object> s : students) {
            String name = text(s, "name", "Name", "student", "studentName");
            // the same name twice is the same child entered twice, not two children
            if (name.isEmpty() || !seen.add(name.toLowerCase())) {
                continue;
            }
            String category = text(s, "category", "Category", "group");
            String session = text(s, "class", "className", "course", "instrument");
            Session sess = byName.get(session.toLowerCase());
            Category cat = byCategory.get(category.toLowerCase());
            BigDecimal cf = cat == null ? null : cat.feeOn(now);
            BigDecimal stored = money(s.containsKey("fee") ? s.get("fee") : s.get("monthlyFee"));
            BigDecimal special = migrated ? money(s.get("specialFee"))
                    : (stored != null && (cf == null || stored.compareTo(cf) != 0) ? stored : null);
            out.add(new Student(
                    name,
                    text(s, "sapaId", "studentNo", "key", "code", "id", "studentId", "ID"),
                    category,
                    sess != null && !sess.day().isEmpty() ? sess.day() : text(s, "classDay", "day", "Day", "classday"),
                    sess != null && !sess.time().isEmpty() ? sess.time() : text(s, "classTime", "time", "Time", "classtime"),
                    session,
                    special != null ? special : cf,
                    special,
                    !Boolean.FALSE.equals(s.get("active")),
                    text(s, "parent"),
                    text(s, "phone"),
                    text(s, "note", "notes"),
                    text(s, "country"),
                    text(s, "family"),
                    custom(s.get("custom")),
                    text(s, "dateOfBirth", "dob", "birthday")
            ));
        }
        return new Roster(out, sessions, categories);
    }

    private static Map<String, String> custom(Object v) {
        Map<String, String> out = new LinkedHashMap<>();
        if (v instanceof Map<?, ?> m) {
            m.forEach((k, val) -> {
                if (k != null && val != null && !String.valueOf(val).isBlank()) out.put(String.valueOf(k), String.valueOf(val));
            });
        }
        return out;
    }

    private static List<Category> categories(Map<String, Object> raw, List<Map<String, Object>> students) {
        if (raw.get("categories") instanceof List<?>) {
            return maps(raw.get("categories")).stream()
                    .map(AbstractRosterRepository::category)
                    .filter(c -> !c.name().isEmpty())
                    .toList();
        }
        // the fee most active students in the class pay
        Map<String, Map<BigDecimal, Integer>> counts = new LinkedHashMap<>();
        for (Map<String, Object> s : students) {
            if (Boolean.FALSE.equals(s.get("active"))) continue;
            BigDecimal fee = money(s.get("fee"));
            if (fee == null || fee.signum() == 0) continue;
            counts.computeIfAbsent(text(s, "category"), k -> new HashMap<>()).merge(fee, 1, Integer::sum);
        }
        List<Category> out = new ArrayList<>();
        Set<String> names = new HashSet<>(counts.keySet());
        names.addAll(CATEGORY_ORDER);
        for (String name : sortCategories(names)) {
            if (name.isEmpty()) continue;
            BigDecimal common = counts.getOrDefault(name, Map.of()).entrySet().stream()
                    .max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
            out.add(defaultsFor(name, common));
        }
        return out;
    }

    /** Online classes are paid as they go and have no sessions; every other class is monthly. */
    private static Category defaultsFor(String name, BigDecimal fee) {
        boolean online = "online".equalsIgnoreCase(name);
        return new Category(name, online ? null : fee, online ? Category.PAYG : Category.MONTHLY, List.of(), !online, List.of());
    }

    private static Category category(Map<String, Object> c) {
        String name = text(c, "name");
        Category d = defaultsFor(name, money(c.get("fee")));
        String billing = text(c, "billing");
        List<Integer> termMonths = c.get("termMonths") instanceof List<?> l
                ? l.stream().map(o -> integer(o)).filter(i -> i != null && i >= 1 && i <= 12).distinct().sorted().toList()
                : List.of();
        List<Roster.FeeChange> changes = maps(c.get("changes")).stream()
                .map(m -> new Roster.FeeChange(text(m, "from"), money(m.get("fee"))))
                .filter(f -> f.from().matches("\\d{4}-(0[1-9]|1[0-2])"))
                .sorted(java.util.Comparator.comparing(Roster.FeeChange::from))
                .toList();
        return new Category(name, money(c.get("fee")),
                billing.isEmpty() ? d.billingMode() : billing,
                termMonths,
                c.get("usesSessions") instanceof Boolean b ? b : d.hasSessions(),
                changes);
    }

    private static Map<String, Object> write(Category c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", c.name());
        m.put("fee", c.fee());
        m.put("billing", c.billingMode());
        if (Category.TERM.equals(c.billingMode())) m.put("termMonths", c.termMonths() == null ? List.of() : c.termMonths());
        m.put("usesSessions", c.hasSessions());
        if (c.changes() != null && !c.changes().isEmpty()) {
            m.put("changes", c.changes().stream().map(f -> {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("from", f.from());
                x.put("fee", f.fee());
                return x;
            }).toList());
        }
        return m;
    }

    private static List<Session> sessions(Object list, List<Map<String, Object>> students) {
        List<Session> out = new ArrayList<>();
        for (Map<String, Object> c : maps(list)) {
            String name = text(c, "name");
            if (name.isEmpty()) continue;
            List<Map<String, Object>> in = students.stream()
                    .filter(s -> name.equalsIgnoreCase(text(s, "className"))).toList();
            out.add(new Session(name, text(c, "family"), text(c, "meaning"), text(c, "symbol"), text(c, "symbolStyle"),
                    orElse(text(c, "category"), () -> mostCommon(in, "category")),
                    orElse(text(c, "day"), () -> mostCommon(in, "classDay")),
                    orElse(text(c, "time"), () -> mostCommon(in, "classTime")),
                    integer(c.get("max"))));
        }
        return out;
    }

    /* ---------------- writing ---------------- */

    @Override
    public synchronized Student create(StudentInput input) {
        Map<String, Object> raw = readRaw();
        Roster current = view(raw);
        List<Map<String, Object>> students = mutableStudents(raw);
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("id", "s" + (students.size() + 1));
        s.put("key", randomKey());
        s.put("sapaId", nextNumber(current.students()));
        apply(s, input, current);
        students.add(s);
        persist(raw, current);
        return find(view(raw), (String) s.get("sapaId")).orElseThrow();
    }

    @Override
    public synchronized Student update(String id, StudentInput input) {
        Map<String, Object> raw = readRaw();
        Roster current = view(raw);
        Map<String, Object> s = mutableStudents(raw).stream()
                .filter(m -> id.equals(text(m, "sapaId", "studentNo", "key", "code", "id")))
                .findFirst().orElse(null);
        if (s == null) return null;
        apply(s, input, current);
        persist(raw, current);
        return find(view(raw), id).orElseThrow();
    }

    @Override
    public synchronized boolean delete(String id) {
        Map<String, Object> raw = readRaw();
        Roster current = view(raw);
        boolean removed = mutableStudents(raw).removeIf(m -> id.equals(text(m, "sapaId")));
        if (removed) persist(raw, current);
        return removed;
    }

    @Override
    public synchronized Session saveSession(SessionInput in, boolean create) {
        Map<String, Object> raw = readRaw();
        Roster current = view(raw);
        List<Map<String, Object>> classes = mutableList(raw, "classes");
        Map<String, Object> c = classes.stream().filter(m -> in.name().equalsIgnoreCase(text(m, "name")))
                .findFirst().orElse(null);
        if (c == null) {
            c = new LinkedHashMap<>();
            c.put("name", in.name().trim());
            classes.add(c);
        }
        putText(c, "category", in.category());
        putText(c, "day", in.day());
        putText(c, "time", in.time());
        if (in.max() == null || in.max() <= 0) c.remove("max"); else c.put("max", in.max());
        if (in.meaning() != null) putText(c, "meaning", in.meaning());
        if (in.family() != null) putText(c, "family", in.family());
        if (in.symbol() != null) putText(c, "symbol", in.symbol());
        if (in.symbolStyle() != null) putText(c, "symbolStyle", in.symbolStyle());
        String name = in.name().trim();
        String newName = in.rename() == null || in.rename().isBlank() ? name : in.rename().trim();
        c.put("name", newName);

        // students in the session take its name, day and time, so receipts show the right one
        for (Map<String, Object> s : mutableStudents(raw)) {
            if (name.equalsIgnoreCase(text(s, "className"))) {
                s.put("className", newName);
                if (in.day() != null && !in.day().isBlank()) s.put("classDay", in.day().trim());
                if (in.time() != null && !in.time().isBlank()) s.put("classTime", in.time().trim());
            }
        }
        persist(raw, current);
        return view(raw).sessions().stream().filter(x -> x.name().equalsIgnoreCase(newName)).findFirst().orElseThrow();
    }

    @Override
    public synchronized boolean deleteSession(String name) {
        Map<String, Object> raw = readRaw();
        Roster current = view(raw);
        boolean removed = mutableList(raw, "classes").removeIf(m -> name.equalsIgnoreCase(text(m, "name")));
        if (!removed) return false;
        // anyone still listed there (only inactive students can be) is left without a session
        for (Map<String, Object> s : mutableStudents(raw)) {
            if (name.equalsIgnoreCase(text(s, "className"))) s.remove("className");
        }
        persist(raw, current);
        return true;
    }

    @Override
    public synchronized List<Category> saveCategories(List<Roster.CategoryInput> categories) {
        Map<String, Object> raw = readRaw();
        Roster current = view(raw);
        persist(raw, current);   // fixes every student's special fee against the old class fees first

        // a renamed class takes its students and sessions with it
        for (Roster.CategoryInput c : categories) {
            if (c.from() == null || c.from().isBlank() || c.from().trim().equals(c.name().trim())) continue;
            for (Map<String, Object> s : mutableStudents(raw)) {
                if (c.from().trim().equalsIgnoreCase(text(s, "category"))) s.put("category", c.name().trim());
            }
            for (Map<String, Object> s : mutableList(raw, "classes")) {
                if (c.from().trim().equalsIgnoreCase(text(s, "category"))) s.put("category", c.name().trim());
            }
        }
        raw.put("categories", categories.stream()
                .map(c -> write(new Category(c.name().trim(), c.fee(), c.billing(), c.termMonths(), c.usesSessions(),
                        c.changes() == null ? List.of() : c.changes())))
                .toList());
        persist(raw, view(raw));
        return view(raw).categories();
    }

    @Override
    public synchronized Map<String, Object> raw() {
        return readRaw();
    }

    @Override
    public synchronized void replaceRaw(Map<String, Object> raw) {
        writeRaw(raw);
    }

    /** Sets the fields the app manages; everything else on the record is left as it was. */
    private static void apply(Map<String, Object> s, StudentInput in, Roster current) {
        s.put("name", in.name().trim());
        s.put("category", in.category().trim());
        String session = in.session() == null ? "" : in.session().trim();
        if (session.isEmpty()) {
            s.remove("className");
        } else {
            s.put("className", session);
            current.sessions().stream().filter(x -> x.name().equalsIgnoreCase(session)).findFirst().ifPresent(x -> {
                if (!x.day().isEmpty()) s.put("classDay", x.day());
                if (!x.time().isEmpty()) s.put("classTime", x.time());
            });
        }
        if (in.specialFee() == null) s.remove("specialFee"); else s.put("specialFee", in.specialFee());
        s.put("active", in.active() == null || in.active());
        putText(s, "parent", in.parent());
        putText(s, "phone", in.phone());
        putText(s, "note", in.note());
        putText(s, "country", in.country());
        putText(s, "family", in.family());
        if (in.dateOfBirth() != null) putText(s, "dateOfBirth", in.dateOfBirth());
        if (in.custom() != null) {
            Map<String, String> custom = new LinkedHashMap<>();
            in.custom().forEach((k, v) -> { if (k != null && v != null && !v.isBlank()) custom.put(k, v.trim()); });
            if (custom.isEmpty()) s.remove("custom"); else s.put("custom", custom);
        }
    }

    /**
     * Writes the file, making sure every record states its special fee (or none) and its
     * actual fee, and that the class fees are stored. Anything reading the file afterwards,
     * including older tools, sees the same fee the app charges.
     */
    private void persist(Map<String, Object> raw, Roster before) {
        Map<String, Student> byId = before.students().stream()
                .collect(Collectors.toMap(Student::id, Function.identity(), (a, b) -> a));
        if (!raw.containsKey("categories")) {
            raw.put("categories", before.categories().stream().map(AbstractRosterRepository::write).toList());
            for (Map<String, Object> s : mutableStudents(raw)) {
                Student st = byId.get(text(s, "sapaId"));
                if (st != null && !s.containsKey("specialFee") && st.specialFee() != null) {
                    s.put("specialFee", st.specialFee());
                }
            }
        }
        // the fee charged now, for anything that reads "fee" directly
        Map<String, BigDecimal> classFee = new HashMap<>();
        String now = thisMonth();
        for (Map<String, Object> c : maps(raw.get("categories"))) {
            Category cat = category(c);
            classFee.put(cat.name().toLowerCase(), cat.feeOn(now));
        }
        for (Map<String, Object> s : mutableStudents(raw)) {
            BigDecimal special = money(s.get("specialFee"));
            BigDecimal fee = special != null ? special : classFee.get(text(s, "category").toLowerCase());
            if (fee == null) s.remove("fee"); else s.put("fee", fee);
        }
        writeRaw(raw);
    }

    private static Optional<Student> find(Roster r, String id) {
        return r.students().stream().filter(s -> s.id().equals(id)).findFirst();
    }

    /** SAPA-1144 after SAPA-1143. */
    private static String nextNumber(List<Student> students) {
        int max = 999;
        for (Student s : students) {
            String id = s.id();
            if (id != null && id.matches("SAPA-\\d+")) max = Math.max(max, Integer.parseInt(id.substring(5)));
        }
        return "SAPA-" + (max + 1);
    }

    private static String randomKey() {
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 6; i++) sb.append(alphabet.charAt(rnd.nextInt(alphabet.length())));
        return sb.toString();
    }

    /* ---------------- helpers ---------------- */

    public static List<String> sortCategories(Collection<String> names) {
        List<String> out = new ArrayList<>(names);
        out.sort((a, b) -> {
            int ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
            if (ia < 0 && ib < 0) return a.compareToIgnoreCase(b);
            return Integer.compare(ia < 0 ? 99 : ia, ib < 0 ? 99 : ib);
        });
        return out;
    }

    private static List<Map<String, Object>> mutableStudents(Map<String, Object> raw) {
        return mutableList(raw, "students");
    }

    /**
     * The list stored under {@code key}, as a mutable list of mutable records, put back into
     * {@code raw} so that changes to it are what gets written. Call it again after any other
     * call for the same key: each call installs a fresh list.
     */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> mutableList(Map<String, Object> raw, String key) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (raw.get(key) instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof LinkedHashMap<?, ?> m) out.add((Map<String, Object>) m);
                else if (o instanceof Map<?, ?> m) out.add(new LinkedHashMap<>((Map<String, Object>) m));
            }
        }
        raw.put(key, out);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object list) {
        if (!(list instanceof List<?> l)) return List.of();
        return l.stream().filter(Map.class::isInstance).map(o -> (Map<String, Object>) o).toList();
    }

    private static void putText(Map<String, Object> m, String key, String value) {
        if (value == null || value.isBlank()) m.remove(key); else m.put(key, value.trim());
    }

    /** The first non-blank value among the given keys. "-" and "—" count as blank. */
    static String text(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v == null) continue;
            String t = String.valueOf(v).trim();
            if (!t.isEmpty() && !t.equals("-") && !t.equals("—")) return t;
        }
        return "";
    }

    private static String orElse(String v, java.util.function.Supplier<String> fallback) {
        return v.isEmpty() ? fallback.get() : v;
    }

    private static String mostCommon(List<Map<String, Object>> rows, String key) {
        return rows.stream().map(r -> text(r, key)).filter(s -> !s.isEmpty())
                .collect(Collectors.groupingBy(Function.identity(), Collectors.counting()))
                .entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse("");
    }

    /** A fee from the file. Below one rupee counts as a free place (the workbook stored 0.000001). */
    private static BigDecimal money(Object v) {
        if (v == null) return null;
        try {
            BigDecimal d = new BigDecimal(String.valueOf(v).trim());
            return d.compareTo(BigDecimal.ONE) < 0 ? BigDecimal.ZERO : d.stripTrailingZeros().scale() <= 0
                    ? d.setScale(0, java.math.RoundingMode.UNNECESSARY) : d;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    private static Integer integer(Object v) {
        if (v == null) return null;
        try {
            int n = new BigDecimal(String.valueOf(v).trim()).intValue();
            return n > 0 ? n : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
