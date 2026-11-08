package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.repository.JsonMonthRepository;
import lk.shalom.receipts.repository.JsonPaymentRepository;
import lk.shalom.receipts.repository.JsonReceiptRepository;
import lk.shalom.receipts.repository.JsonRegistrationRepository;
import lk.shalom.receipts.repository.JsonRollRepository;
import lk.shalom.receipts.repository.JsonRosterRepository;
import lk.shalom.receipts.repository.JsonSettingsRepository;
import lk.shalom.receipts.repository.JsonTeacherRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The move from the JSON files to the database. On the first start against an empty database,
 * everything in data/*.json is copied in, in one transaction: all of it or none of it. The files
 * themselves are left exactly as they were, as a backup.
 *
 * <p>It runs once. Afterwards app_meta holds the date and what was copied, and the files are
 * never read again (they can still be restored through Settings → Backup).
 */
@Component
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class JsonImport implements SmartInitializingSingleton {

    static final String DONE = "json-import";
    private static final Logger log = LoggerFactory.getLogger(JsonImport.class);

    private final Db db;
    private final JsonMapper mapper;
    private final String dataDir;
    private final PgSettingsRepository settings;
    private final PgRosterRepository roster;
    private final PgMonthRepository months;
    private final PgReceiptRepository receipts;
    private final PgPaymentRepository payments;
    private final PgRollRepository roll;
    private final PgTeacherRepository teachers;
    private final PgRegistrationRepository registrations;

    public JsonImport(Db db, JsonMapper mapper, @Value("${app.data-dir}") String dataDir, PgSettingsRepository settings,
                      PgRosterRepository roster, PgMonthRepository months, PgReceiptRepository receipts,
                      PgPaymentRepository payments, PgRollRepository roll, PgTeacherRepository teachers,
                      PgRegistrationRepository registrations) {
        this.db = db;
        this.mapper = mapper;
        this.dataDir = dataDir;
        this.settings = settings;
        this.roster = roster;
        this.months = months;
        this.receipts = receipts;
        this.payments = payments;
        this.roll = roll;
        this.teachers = teachers;
        this.registrations = registrations;
    }

    /** Before the app takes any requests: the web server starts after this. */
    @Override
    public void afterSingletonsInstantiated() {
        if (!db.jdbc.queryForList("select value from app_meta where key = ?", String.class, DONE).isEmpty()) return;
        boolean empty = db.count("students") == 0 && db.count("receipts") == 0 && db.count("payments") == 0;
        if (empty && !Files.exists(Path.of(dataDir, "students.json"))) {
            // an empty database and no files to fill it from: in the cloud, before the data has been
            // copied up from the office computer. Nothing is marked, so that copy still runs later.
            log.info("The database is empty and there are no data files in {}; waiting for the import.",
                    Path.of(dataDir).toAbsolutePath());
            return;
        }
        Map<String, Integer> counts = empty ? copy() : Map.of();
        String note = empty ? "Imported " + counts + " from " + Path.of(dataDir).toAbsolutePath()
                : "The database already had data; nothing imported.";
        db.jdbc.update("insert into app_meta (key, value) values (?, ?)", DONE, note + " at " + Instant.now());
        log.info(note);
    }

    private Map<String, Integer> copy() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        db.inTx(() -> {
            settings.save(new JsonSettingsRepository(mapper, dataDir).get());

            Map<String, Object> raw = new JsonRosterRepository(mapper, dataDir).raw();
            roster.replaceRaw(raw);
            counts.put("students", roster.load().students().size());

            var m = new JsonMonthRepository(mapper, dataDir).findAll();
            months.replaceAll(m);
            counts.put("months", m.size());

            var r = new JsonReceiptRepository(mapper, dataDir).findAll();
            receipts.replaceAll(r);
            counts.put("receipts", r.size());

            var p = new JsonPaymentRepository(mapper, dataDir).findAll();
            payments.replaceAll(p);
            counts.put("payments", p.size());

            var a = new JsonRollRepository(mapper, dataDir).get();
            roll.update(x -> a);
            counts.put("attendance", a.entries().size());
            counts.put("cover-ups", a.makeups().size());

            var t = new JsonTeacherRepository(mapper, dataDir).get();
            teachers.update(x -> t);
            counts.put("teachers", t.teachers().size());
            counts.put("teacher check-ins", t.attendance().size());

            var g = new JsonRegistrationRepository(mapper, dataDir).get();
            registrations.update(x -> g);
            counts.put("registrations", g.items().size());
        });
        return counts;
    }
}
