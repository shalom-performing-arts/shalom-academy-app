package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Payment;
import lk.shalom.receipts.repository.JsonMonthRepository;
import lk.shalom.receipts.repository.JsonPaymentRepository;
import lk.shalom.receipts.repository.JsonReceiptRepository;
import lk.shalom.receipts.repository.JsonRosterRepository;
import lk.shalom.receipts.repository.JsonSettingsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The office's fee workbook, laid out as the real one is, brought into the app. */
public class WorkbookImportTest {

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();
    JsonRosterRepository roster;
    JsonPaymentRepository paymentRepo;
    MonthService months;
    ReceiptService receipts;
    WorkbookImport importer;

    static final String NOV = "2026-11";

    @BeforeEach
    void setUp() throws Exception {
        Files.writeString(dir.resolve("students.json"), """
                {"classes":[{"name":"Forte","category":"Kids","day":"Monday","time":"3:30 - 4:30 PM","max":8,"symbol":"f","symbolStyle":"italic"},
                            {"name":"Legato","category":"Youth","day":"Thursday","time":"3:30 - 4:30 PM","max":15},
                            {"name":"Gone","category":"Youth","day":"Friday","time":"1:00 - 2:00 PM"}],
                 "students":[
                  {"id":"s01","name":"Giana Neshi","sapaId":"SAPA-1000","category":"Kids","className":"Forte","fee":8000,"active":true,"parent":"Mrs Neshi","phone":"0771234567"},
                  {"id":"s02","name":"Himath Mandinu","sapaId":"SAPA-1001","category":"Youth","className":"Legato","fee":7000,"active":true},
                  {"id":"s03","name":"Zaki Azhar","sapaId":"SAPA-1002","category":"Kids","className":"Forte","fee":7000,"active":true},
                  {"id":"s04","name":"Left Already","sapaId":"SAPA-1003","category":"Youth","className":"Gone","fee":7000,"active":true}
                 ]}
                """);
        String d = dir.toString();
        roster = new JsonRosterRepository(mapper, d);
        paymentRepo = new JsonPaymentRepository(mapper, d);
        JsonSettingsRepository settings = new JsonSettingsRepository(mapper, d);
        JsonMonthRepository monthRepo = new JsonMonthRepository(mapper, d);
        months = new MonthService(monthRepo, paymentRepo, roster, settings);
        PaymentService payments = new PaymentService(paymentRepo, months, roster, settings);
        receipts = new ReceiptService(new JsonReceiptRepository(mapper, d), payments);
        importer = new WorkbookImport(roster, paymentRepo, monthRepo, months, receipts, settings);

        // what the app held before: a November payment for Giana (dated), and an October one for Zaki
        paymentRepo.save(new Payment("p1", "SAPA-1000", "Giana Neshi", NOV, Payment.MONTHLY, new BigDecimal("8000"),
                "Shalom Academy", "2026-11-03", null, null, null, Instant.now()));
        paymentRepo.save(new Payment("p2", "SAPA-1002", "Zaki Azhar", "2026-10", Payment.MONTHLY, new BigDecimal("6000"),
                "Shalom Academy", "2026-10-05", null, null, null, Instant.now()));
        paymentRepo.save(new Payment("p3", "SAPA-1001", "Himath Mandinu", NOV, Payment.MONTHLY, new BigDecimal("1000"),
                "Cash", "2026-11-02", null, null, null, Instant.now()));
    }

    /** The real workbook's sheets, cut down: same headings, same columns. */
    public static Map<String, List<List<String>>> workbook() {
        Map<String, List<List<String>>> s = new LinkedHashMap<>();
        s.put("Dashboard", rows(
                r("", "SHALOM ACADEMY OF PERFORMING ARTS"),
                r("", "Year", "2026.0"),
                r("", "Month", "November"),
                r("", "WHERE THE MONEY IS"),
                r("", "Shalom Academy", "", "", "Rebeccah Nayomi", "", "", "Cash"),
                r("", "8000", "", "", "0", "", "", "6000"),
                r(""),
                r("", "bank account      2 payments", "", "", "bank account      0 payments", "", "", "handed over      1 payments"),
                r("", "Total number of students", "5"),
                r("", "Total expected monthly income", "28000"),
                r("", "Total amount collected", "14000")));
        s.put("Students", rows(
                r("SHALOM ACADEMY OF PERFORMING ARTS", "", "", "", "", "", "", "", "Default monthly fee (Rs.)"),
                r("STUDENTS AND MONTHLY FEES", "", "", "Month   November 2026", "", "", "", "", "Kids", "8000.0"),
                r("", "", "", "", "", "", "", "", "Youth", "7000.0"),
                r("No", "Student Name", "Active", "Special fee (type here)", "Monthly fee (Rs.)", "Notes"),
                r("KIDS   FORTE      Wednesday 3:30 - 4:30 PM", "", "", "", "8000", "class fee", "8"),
                r("1", "Giana Neshi", "Active", "", "8000", ""),
                r("2", "Thenul Munasinghe", "Active", "1.0E-6", "0.000001", ""),
                r("3", "Zaki Azhar", "Active", "6000.0", "6000", ""),
                r("", "", "Active", "", "0", ""),
                r("KIDS CLASS TOTAL", "", "", "3", "14000", ""),
                r("YOUTH   LEGATO      Thursday 3:30 - 4:30 PM", "", "", "", "7000", "class fee", "15"),
                r("1", "Himath Mandiv", "Active", "", "7000", ""),
                r("2", "Ian Karunaratne (comes late)", "Active", "", "7000", ""),
                r("3", "Tharuki Perera", "Inactive", "", "0", "")));
        s.put("Sessions", rows(
                r("Class", "Session", "What it means", "Day and Time", "Max", "Students now"),
                r("Kids", "Forte", "loud and strong", "Wednesday 3:30 - 4:30 PM", "8.0", "3"),
                r("Youth", "Legato", "smooth and connected", "Thursday 3:30 - 4:30 PM", "15.0", "2"),
                r("ALL", "2")));
        s.put("Kids", rows(
                r("No", "Student Name", "", "Status", "Paid to", "Note", "Remark", "fee", "collected", "cash", "owing", "rank", "session"),
                r("Forte      Wednesday 3:30 - 4:30 PM"),
                r("1", "Giana Neshi", "1", "Paid", "Shalom Academy", "", "Admission fee 5000 was given.", "8000", "8000", "0", "0", "", "Forte"),
                r("2", "Thenul Munasinghe", "1", "Paid", "Shalom Academy", "", "", "0.000001", "0.000001", "0", "0", "", "Forte"),
                r("3", "Zaki Azhar", "1", "Paid", "Cash", "", "", "6000", "6000", "6000", "0", "", "Forte")));
        s.put("Youth", rows(
                r("No", "Student Name", "Paid", "Status", "Paid to", "Note", "Remark", "fee", "collected", "cash", "owing", "rank", "session"),
                r("Legato      Thursday 3:30 - 4:30 PM"),
                r("1", "Himath Mandiv", "", "Pending", "Shalom Academy", "", "", "7000", "0", "0", "1", "1", "Legato"),
                r("2", "Ian Karunaratne (comes late)", "", "Pending", "Shalom Academy", "", "", "7000", "0", "0", "1", "2", "Legato")));
        return s;
    }

    @Test
    void thePreviewListsEveryChangeAndSavesNothing() {
        var p = importer.preview(workbook());
        assertThat(p.monthLabel()).isEqualTo("November 2026");
        assertThat(p.checks()).allSatisfy(c -> assertThat(c.ok()).as(c.what() + ": " + c.workbook() + " vs " + c.app()).isTrue());
        assertThat(p.added()).containsExactly("Thenul Munasinghe (Forte)", "Ian Karunaratne (Legato)", "Tharuki Perera (Legato)");
        assertThat(p.renamed()).extracting(WorkbookImport.Rename::to).containsExactly("Himath Mandiv");
        assertThat(p.inactivated()).containsExactly("Left Already");
        assertThat(p.sessionsChanged()).anySatisfy(x -> assertThat(x).startsWith("Forte").contains("Wednesday"));
        assertThat(p.sessionsRemoved()).containsExactly("Gone");
        assertThat(p.paymentsRemoved().count()).isEqualTo(2);
        assertThat(p.paymentsAdded().count()).isEqualTo(3);           // the free place is a Rs.0 payment, as the workbook records it
        // nothing saved yet
        assertThat(roster.load().students()).extracting(lk.shalom.receipts.model.Roster.Student::name).contains("Himath Mandinu");
        assertThat(paymentRepo.findByMonth(NOV)).hasSize(2);
    }

    @Test
    void importingMakesTheAppMatchTheWorkbook() {
        importer.apply(workbook());

        var r = roster.load();
        var giana = r.students().stream().filter(s -> s.name().equals("Giana Neshi")).findFirst().orElseThrow();
        assertThat(giana.id()).isEqualTo("SAPA-1000");          // a matched child keeps their number and details
        assertThat(giana.parent()).isEqualTo("Mrs Neshi");
        var himath = r.students().stream().filter(s -> s.id().equals("SAPA-1001")).findFirst().orElseThrow();
        assertThat(himath.name()).isEqualTo("Himath Mandiv");    // renamed to the workbook's spelling, history kept
        var ian = r.students().stream().filter(s -> s.name().equals("Ian Karunaratne")).findFirst().orElseThrow();
        assertThat(ian.id()).isEqualTo("SAPA-1005");            // after Thenul, the other new child
        assertThat(ian.note()).isEqualTo("comes late");
        assertThat(r.students().stream().filter(s -> s.name().equals("Left Already")).findFirst().orElseThrow().active()).isFalse();
        assertThat(r.students().stream().filter(s -> s.name().equals("Tharuki Perera")).findFirst().orElseThrow().active()).isFalse();
        assertThat(r.sessions()).extracting(lk.shalom.receipts.model.Roster.Session::name).containsExactly("Forte", "Legato");
        var forte = r.sessions().getFirst();
        assertThat(forte.day()).isEqualTo("Wednesday");
        assertThat(forte.symbol()).isEqualTo("f");               // what the workbook does not hold is kept

        // November: exactly the workbook's payments; October untouched
        List<Payment> nov = paymentRepo.findByMonth(NOV);
        assertThat(nov).extracting(Payment::studentName, Payment::amount, Payment::paidTo).containsExactlyInAnyOrder(
                org.assertj.core.groups.Tuple.tuple("Giana Neshi", new BigDecimal("8000"), "Shalom Academy"),
                org.assertj.core.groups.Tuple.tuple("Thenul Munasinghe", BigDecimal.ZERO, "Shalom Academy"),
                org.assertj.core.groups.Tuple.tuple("Zaki Azhar", new BigDecimal("6000"), "Cash"));
        assertThat(nov.stream().filter(p -> p.studentName().equals("Giana Neshi")).findFirst().orElseThrow().date()).isEqualTo("2026-11-03");
        assertThat(paymentRepo.findByMonth("2026-10")).hasSize(1);

        var v = months.view(NOV);
        assertThat(v.totals().expected()).isEqualByComparingTo("28000");     // 8000 + 0 + 6000 + 7000 + 7000
        assertThat(v.totals().collected()).isEqualByComparingTo("14000");
        assertThat(v.rows().stream().filter(x -> x.name().equals("Thenul Munasinghe")).findFirst().orElseThrow().status()).isEqualTo("Free place");
        assertThat(v.rows().stream().filter(x -> x.name().equals("Giana Neshi")).findFirst().orElseThrow().remark()).isEqualTo("Admission fee 5000 was given.");
    }

    @Test
    void importingTwiceChangesNothingMore() {
        importer.apply(workbook());
        var again = importer.preview(workbook());
        assertThat(again.added()).isEmpty();
        assertThat(again.renamed()).isEmpty();
        assertThat(again.moved()).isEmpty();
        assertThat(again.inactivated()).isEmpty();
        assertThat(again.paymentsAdded().count()).isEqualTo(again.paymentsRemoved().count());
    }

    @Test
    void aFileThatIsNotTheWorkbookIsRefused() {
        assertThatThrownBy(() -> importer.preview(Map.of("Sheet1", rows(r("hello")))))
                .hasMessageContaining("which month");
        assertThatThrownBy(() -> importer.preview(new byte[]{1, 2, 3})).isInstanceOf(ApiException.class);
    }

    @Test
    void theReaderReadsAnXlsxFile() {
        byte[] x = XlsxWriter.write("Kids", List.of(List.of("No", "Student Name", "fee"), List.of("1", "Giana Neshi", "8000")));
        var sheets = XlsxReader.read(x);
        assertThat(sheets.get("Kids").get(1)).containsExactly("1", "Giana Neshi", "8000");
    }

    private static List<List<String>> rows(List<String>... rs) {
        return new ArrayList<>(Arrays.asList(rs));
    }

    private static List<String> r(String... cells) {
        return List.of(cells);
    }
}
