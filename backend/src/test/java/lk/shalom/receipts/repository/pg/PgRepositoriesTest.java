package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.SessionInput;
import lk.shalom.receipts.model.Roster.StudentInput;
import lk.shalom.receipts.repository.JsonMonthRepository;
import lk.shalom.receipts.repository.JsonPaymentRepository;
import lk.shalom.receipts.repository.JsonReceiptRepository;
import lk.shalom.receipts.repository.JsonRegistrationRepository;
import lk.shalom.receipts.repository.JsonRollRepository;
import lk.shalom.receipts.repository.JsonRosterRepository;
import lk.shalom.receipts.repository.JsonSettingsRepository;
import lk.shalom.receipts.repository.JsonTeacherRepository;
import lk.shalom.receipts.service.MonthService;
import lk.shalom.receipts.service.RegistrationService;
import lk.shalom.receipts.service.StudentService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * The database repositories, against a real PostgreSQL (PG_TEST_URL, by default the development
 * database on port 5433). Skipped when there is no database to talk to.
 *
 * <p>The heart of it: the academy's real data files, imported, read back exactly as the files
 * read; and the app's own changes saved and read back by a fresh start.
 */
class PgRepositoriesTest {

    static final String URL = System.getenv().getOrDefault("PG_TEST_URL", "jdbc:postgresql://localhost:5433/shalom_test");
    static final Path REAL_DATA = Path.of("data");
    static DriverManagerDataSource ds;
    static boolean up;

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();
    Db db;

    @BeforeAll
    static void connect() {
        ds = new DriverManagerDataSource(URL, System.getenv().getOrDefault("PG_TEST_USER", "shalom"),
                System.getenv().getOrDefault("PG_TEST_PASSWORD", "shalom-dev"));
        try (Connection c = ds.getConnection()) {
            up = c.isValid(2);
        } catch (Exception e) {
            up = false;
        }
    }

    @BeforeEach
    void freshDatabase() throws Exception {
        assumeTrue(up, "no test database at " + URL);
        Flyway flyway = Flyway.configure().dataSource(ds).cleanDisabled(false).locations("classpath:db/migration").load();
        flyway.clean();
        flyway.migrate();
        db = new Db(new JdbcTemplate(ds), new TransactionTemplate(new DataSourceTransactionManager(ds)), mapper);
        // a copy of the real files, so nothing here can touch them
        if (Files.isDirectory(REAL_DATA)) {
            try (Stream<Path> files = Files.list(REAL_DATA)) {
                for (Path f : files.filter(p -> p.toString().endsWith(".json")).toList()) {
                    Files.copy(f, dir.resolve(f.getFileName()));
                }
            }
        }
    }

    /** a fresh set of repositories, as after a restart */
    record Repos(PgSettingsRepository settings, PgRosterRepository roster, PgMonthRepository months,
                 PgReceiptRepository receipts, PgPaymentRepository payments, PgRollRepository roll,
                 PgTeacherRepository teachers, PgRegistrationRepository registrations) {}

    Repos repos() {
        return new Repos(new PgSettingsRepository(db), new PgRosterRepository(db), new PgMonthRepository(db),
                new PgReceiptRepository(db), new PgPaymentRepository(db), new PgRollRepository(db),
                new PgTeacherRepository(db), new PgRegistrationRepository(db));
    }

    JsonImport importer(Repos r) {
        return importer(r, dir);
    }

    /** an empty data folder: a brand-new academy */
    JsonImport fresh(Repos r) throws Exception {
        Path fresh = Files.createDirectories(dir.resolve("fresh"));
        Files.writeString(fresh.resolve("students.json"), "{}");   // a student file with nobody in it yet
        return importer(r, fresh);
    }

    @Test
    void anEmptyDatabaseWithNoFilesWaitsForTheImport() throws Exception {
        // the cloud server starting before the data has been copied up: it must not mark the
        // import as done, or the real import would be skipped
        Repos pg = repos();
        importer(pg, Files.createDirectories(dir.resolve("nothing"))).afterSingletonsInstantiated();
        assertThat(db.count("app_meta")).isZero();
        assumeTrue(Files.exists(dir.resolve("students.json")), "no data files to import");
        importer(repos(), dir).afterSingletonsInstantiated();
        assertThat(db.count("students")).isPositive();
        assertThat(db.count("app_meta")).isEqualTo(1);
    }

    JsonImport importer(Repos r, Path from) {
        return new JsonImport(db, mapper, from.toString(), r.settings(), r.roster(), r.months(), r.receipts(), r.payments(),
                r.roll(), r.teachers(), r.registrations());
    }

    @Test
    void theRealDataReadsBackExactlyAsTheFiles() {
        assumeTrue(Files.exists(dir.resolve("students.json")), "no data files to import");
        importer(repos()).afterSingletonsInstantiated();
        Repos pg = repos();   // a restart: nothing cached
        String d = dir.toString();

        Roster files = new JsonRosterRepository(mapper, d).load();
        Roster table = pg.roster().load();
        assertThat(table.students()).hasSize(files.students().size()).isEqualTo(files.students());
        assertThat(table.sessions()).isEqualTo(files.sessions());
        assertThat(table.categories()).isEqualTo(files.categories());
        // the spreadsheet's own details (ages, songs, results) are kept
        // (as content: the order of fields inside a record does not matter)
        assertThat(mapper.readTree(same(pg.roster().raw().get("students"))))
                .isEqualTo(mapper.readTree(same(new JsonRosterRepository(mapper, d).raw().get("students"))));

        assertThat(same(pg.settings().get())).isEqualTo(same(new JsonSettingsRepository(mapper, d).get()));
        assertThat(same(pg.months().findAll())).isEqualTo(same(new JsonMonthRepository(mapper, d).findAll()));
        assertThat(same(pg.receipts().findAll())).isEqualTo(same(new JsonReceiptRepository(mapper, d).findAll()));
        assertThat(same(sorted(pg.payments().findAll(), "id"))).isEqualTo(same(sorted(new JsonPaymentRepository(mapper, d).findAll(), "id")));

        var rollFile = new JsonRollRepository(mapper, d).get();
        var rollDb = pg.roll().get();
        assertThat(same(sorted(rollDb.entries(), "date", "session", "studentId")))
                .isEqualTo(same(sorted(rollFile.entries(), "date", "session", "studentId")));
        assertThat(same(sorted(rollDb.makeups(), "id"))).isEqualTo(same(sorted(rollFile.makeups(), "id")));

        var tFile = new JsonTeacherRepository(mapper, d).get();
        var tDb = pg.teachers().get();
        assertThat(tDb.teachers()).isEqualTo(tFile.teachers());
        assertThat(tDb.schedule()).isEqualTo(tFile.schedule());
        assertThat(tDb.holidays()).isEqualTo(tFile.holidays());
        assertThat(same(tDb.rates())).isEqualTo(same(tFile.rates()));
        assertThat(tDb.site()).isEqualTo(tFile.site());
        assertThat(same(sorted(tDb.attendance(), "date", "slotId", "teacherId")))
                .isEqualTo(same(sorted(tFile.attendance(), "date", "slotId", "teacherId")));
        assertThat(same(tDb.adjustments())).isEqualTo(same(tFile.adjustments()));
        assertThat(same(tDb.payouts())).isEqualTo(same(tFile.payouts()));

        var gFile = new JsonRegistrationRepository(mapper, d).get();
        assertThat(same(pg.registrations().get())).isEqualTo(same(gFile));

        // once only: a second start leaves everything alone
        int students = db.count("students");
        importer(repos()).afterSingletonsInstantiated();
        assertThat(db.count("students")).isEqualTo(students);
        assertThat(db.jdbc.queryForObject("select value from app_meta where key = 'json-import'", String.class)).contains("Imported");
    }

    @Test
    void studentChangesAreSavedAndSurviveARestart() throws Exception {
        Repos pg = repos();
        fresh(pg).afterSingletonsInstantiated();
        MonthService months = new MonthService(pg.months(), pg.payments(), pg.roster(), pg.settings());
        StudentService students = new StudentService(pg.roster(), pg.payments(), months);
        students.saveCategories(List.of(new Roster.CategoryInput("Kids", null, new BigDecimal("8000"), "monthly", List.of(), true, List.of()),
                new Roster.CategoryInput("Junior", null, new BigDecimal("7000"), "monthly", List.of(), true, List.of())));
        students.saveSession(new SessionInput("Forte", "Kids", "Wednesday", "3:30 - 4:30 PM", 10, "loud", "Dynamics", "f", "italic"), true);
        var amaya = students.create(new StudentInput("Amaya Perera", "Kids", "Forte", null, true, "Nadeesha", "0710407740", "", "",
                "", null, "2018-05-14"));
        var kavin = students.create(new StudentInput("Kavin Perera", "Kids", "Forte", new BigDecimal("6000"), true, "Nadeesha", "0710407740", "", ""));
        assertThat(amaya.id()).isEqualTo("SAPA-1000");
        assertThat(kavin.fee()).isEqualByComparingTo("6000");

        // renaming the session takes its students along
        students.saveSession(new SessionInput("Forte", "Kids", "Saturday", "9:30 - 10:30 AM", 12, null, null, null, null, "Fortissimo"), false);
        Repos restart = repos();
        Roster r = restart.roster().load();
        assertThat(r.sessions()).extracting(Roster.Session::name).containsExactly("Fortissimo");
        assertThat(r.students()).extracting(Roster.Student::session).containsOnly("Fortissimo");
        assertThat(r.students()).extracting(Roster.Student::day).containsOnly("Saturday");
        assertThat(r.students().getFirst().fee()).isEqualByComparingTo("8000");
        assertThat(r.students().getFirst().dateOfBirth()).isEqualTo("2018-05-14");   // the birthday, in its own column
        assertThat(db.jdbc.queryForObject("select date_of_birth::text from students where id = 'SAPA-1000'", String.class))
                .isEqualTo("2018-05-14");
        // and the class rename takes students and sessions along
        students.saveCategories(List.of(new Roster.CategoryInput("Little Kids", "Kids", new BigDecimal("8500"), "monthly", List.of(), true, List.of()),
                new Roster.CategoryInput("Junior", null, new BigDecimal("7000"), "monthly", List.of(), true, List.of())));
        r = repos().roster().load();
        assertThat(r.students()).extracting(Roster.Student::category).containsOnly("Little Kids");
        assertThat(r.sessions().getFirst().category()).isEqualTo("Little Kids");
        assertThat(r.students().stream().filter(s -> s.name().equals("Amaya Perera")).findFirst().orElseThrow().fee())
                .isEqualByComparingTo("8500");

        // a class still in use cannot go; the database would refuse it too
        assertThatThrownBy(() -> students.saveCategories(List.of(
                new Roster.CategoryInput("Junior", null, new BigDecimal("7000"), "monthly", List.of(), true, List.of()))))
                .hasMessageContaining("still has students");

        students.delete(kavin.id());
        assertThat(repos().roster().load().students()).extracting(Roster.Student::name).containsExactly("Amaya Perera");
    }

    @Test
    void registrationsAttendanceAndTeachersAreSaved() throws Exception {
        Repos pg = repos();
        fresh(pg).afterSingletonsInstantiated();
        MonthService months = new MonthService(pg.months(), pg.payments(), pg.roster(), pg.settings());
        StudentService students = new StudentService(pg.roster(), pg.payments(), months);
        students.saveCategories(List.of(new Roster.CategoryInput("Kids", null, new BigDecimal("8000"), "monthly", List.of(), true, List.of())));
        students.saveSession(new SessionInput("Forte", "Kids", "Wednesday", "3:30 - 4:30 PM", 10, null, null, null, null), true);

        var reg = new RegistrationService(pg.registrations(), pg.roster(), pg.settings(), students);
        String token = reg.form().form().token();
        assertThat(repos().registrations().get().form().token()).isEqualTo(token);   // the link survives a restart
        var sent = reg.submit(token, new RegistrationService.RegistrationInput("Amaya Perera", null, "2018-05-14", null, null,
                null, null, "Kids", List.of("Saturday", "Wednesday"), null, "Nadeesha Perera", "Mother", "0710407740", null,
                null, null, null, null, null, null, null, true, true, null, "k1", null), null).number();
        assertThat(sent).startsWith("REG-");
        assertThatThrownBy(() -> reg.submit(token, new RegistrationService.RegistrationInput("Amaya Perera", null, "2018-05-14",
                null, null, null, null, null, null, null, "Xavier Perera", "Mother", "0779999999", null, null, null, null, null, null, null,
                null, false, true, null, "k2", null), null)).hasMessageContaining("already registered");
        String id = reg.list().getFirst().reg().id();
        reg.place(id, new RegistrationService.PlaceInput("Kids", "Forte", null, null));

        Repos restart = repos();
        var saved = restart.registrations().get().items().getFirst();
        assertThat(saved.studentId()).isEqualTo("SAPA-1000");
        assertThat(saved.preferredDays()).containsExactly("Wednesday", "Saturday");
        assertThat(saved.dateOfBirth()).isEqualTo("2018-05-14");
        // the student goes: the registration is back in the pool, in the database too
        students.delete("SAPA-1000");
        assertThat(db.jdbc.queryForObject("select student_id from registrations", String.class)).isNull();

        // attendance: a mark, changed, then cleared
        pg.roll().update(b -> {
            b.entries().add(new lk.shalom.receipts.model.RollBook.Entry("2026-11-04", "Forte", "SAPA-1000", "Amaya Perera",
                    "P", null, "office", "Office", Instant.parse("2026-11-04T10:00:00Z")));
            return b;
        });
        pg.roll().update(b -> {
            b.entries().replaceAll(e -> new lk.shalom.receipts.model.RollBook.Entry(e.date(), e.session(), e.studentId(),
                    e.studentName(), "L", "bus late", e.by(), e.byName(), e.at()));
            return b;
        });
        assertThat(repos().roll().get().entries()).singleElement()
                .satisfies(e -> assertThat(e.status() + " " + e.note()).isEqualTo("L bus late"));
        pg.roll().update(b -> { b.entries().clear(); return b; });
        assertThat(db.count("attendance")).isZero();

        // teachers: a new academy starts with the workbook timetable; then a check-in
        var t = restart.teachers().get();
        assertThat(t.schedule()).hasSize(16);
        pg.teachers().update(b -> {
            b.attendance().add(new lk.shalom.receipts.model.TeacherBook.Mark("2026-11-04", b.schedule().getFirst().id(),
                    b.teachers().getFirst().id(), "office", Instant.parse("2026-11-04T10:00:00Z"), null, null, null, null));
            return b;
        });
        assertThat(repos().teachers().get().attendance()).hasSize(1);
        assertThat(repos().teachers().get().rates()).isEqualTo(t.rates());

        // and the time a teacher reported at the academy
        pg.teachers().update(b -> {
            b.arrivals().add(new lk.shalom.receipts.model.TeacherBook.Arrival("2026-11-04", b.teachers().getFirst().id(),
                    Instant.parse("2026-11-04T09:42:00Z"), 6.9271, 79.8612, 12.0, 8.0));
            return b;
        });
        assertThat(repos().teachers().get().arrivals()).singleElement()
                .satisfies(a -> assertThat(a.at()).isEqualTo(Instant.parse("2026-11-04T09:42:00Z")));

        // and a class moved to another day, then taken back
        pg.teachers().update(b -> {
            b.moves().add(new lk.shalom.receipts.model.TeacherBook.ClassMove("mv1", "Pianissimo", "Adult", "wed-1815-adult",
                    "2026-11-12", "2026-11-14", "18:00", 60, "Rain", Instant.parse("2026-11-11T10:00:00Z")));
            return b;
        });
        assertThat(repos().teachers().get().moves()).singleElement().satisfies(m -> {
            assertThat(m.toDate()).isEqualTo("2026-11-14");
            assertThat(m.start()).isEqualTo("18:00");
        });
        repos().teachers().update(b -> { b.moves().clear(); return b; });
        assertThat(repos().teachers().get().moves()).isEmpty();
    }

    @Test
    void theFeeWorkbookImportsIntoTheDatabase() throws Exception {
        assumeTrue(Files.exists(dir.resolve("students.json")), "no data files to import");
        importer(repos(), dir).afterSingletonsInstantiated();
        Repos pg = repos();
        var monthService = new lk.shalom.receipts.service.MonthService(pg.months(), pg.payments(), pg.roster(), pg.settings());
        var paymentService = new lk.shalom.receipts.service.PaymentService(pg.payments(), monthService, pg.roster(), pg.settings());
        var receiptService = new lk.shalom.receipts.service.ReceiptService(pg.receipts(), paymentService);
        var workbook = new lk.shalom.receipts.service.WorkbookImport(pg.roster(), pg.payments(), pg.months(), monthService,
                receiptService, pg.settings());

        workbook.apply(lk.shalom.receipts.service.WorkbookImportTest.workbook());

        // read back as after a restart
        Repos again = repos();
        var nov = again.payments().findByMonth("2026-11");
        assertThat(nov).extracting(lk.shalom.receipts.model.Payment::studentName)
                .containsExactlyInAnyOrder("Giana Neshi", "Thenul Munasinghe", "Zaki Azhar");
        assertThat(again.roster().load().sessions()).extracting(lk.shalom.receipts.model.Roster.Session::name)
                .containsExactly("Forte", "Legato");
        assertThat(again.roster().load().students().stream().filter(lk.shalom.receipts.model.Roster.Student::active)
                .map(lk.shalom.receipts.model.Roster.Student::name))
                .containsExactlyInAnyOrder("Giana Neshi", "Thenul Munasinghe", "Zaki Azhar", "Himath Mandiv", "Ian Karunaratne");
        assertThat(again.receipts().findAll()).noneMatch(r -> "November 2026".equals(r.period()));
        var view = new lk.shalom.receipts.service.MonthService(again.months(), again.payments(), again.roster(), again.settings())
                .view("2026-11");
        assertThat(view.totals().collected()).isEqualByComparingTo("14000");
        assertThat(view.totals().expected()).isEqualByComparingTo("28000");
        // and importing the same workbook again changes nothing more
        var twice = workbook.preview(lk.shalom.receipts.service.WorkbookImportTest.workbook());
        assertThat(twice.added()).isEmpty();
        assertThat(twice.inactivated()).isEmpty();
    }

    /* ---------------- comparing ---------------- */

    private static final Pattern INSTANT = Pattern.compile("\"(\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?Z)\"");

    /**
     * As JSON, with times to the microsecond (what PostgreSQL keeps; Windows clocks give a tenth
     * of one more) and amounts without trailing zeros.
     */
    String same(Object value) {
        String json = mapper.writeValueAsString(value);
        Matcher m = INSTANT.matcher(json);
        StringBuilder out = new StringBuilder();
        while (m.find()) m.appendReplacement(out, "\"" + Instant.parse(m.group(1)).truncatedTo(ChronoUnit.MICROS) + "\"");
        m.appendTail(out);
        return out.toString().replaceAll("(\\d+)\\.0+(?=[,}\\]])", "$1");
    }

    @SuppressWarnings("unchecked")
    <T> List<T> sorted(List<T> list, String... fields) {
        Comparator<T> c = Comparator.comparing(x -> key(x, fields));
        return list.stream().sorted(c).toList();
    }

    private String key(Object x, String... fields) {
        StringBuilder b = new StringBuilder();
        for (String f : fields) {
            try {
                b.append(x.getClass().getMethod(f).invoke(x)).append('|');
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
        return b.toString();
    }
}
