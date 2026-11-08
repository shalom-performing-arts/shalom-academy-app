package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Receipt.LineItem;
import lk.shalom.receipts.model.Receipt.Person;
import lk.shalom.receipts.model.Roster.Category;
import lk.shalom.receipts.model.Roster.SessionInput;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;
import lk.shalom.receipts.repository.JsonMonthRepository;
import lk.shalom.receipts.repository.JsonPaymentRepository;
import lk.shalom.receipts.repository.JsonReceiptRepository;
import lk.shalom.receipts.repository.JsonRosterRepository;
import lk.shalom.receipts.repository.JsonSettingsRepository;
import lk.shalom.receipts.service.MonthService.MonthView;
import lk.shalom.receipts.service.MonthService.Row;
import lk.shalom.receipts.service.PaymentService.PaymentInput;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Students, months, payments and receipts working together, on real JSON files in a temp folder. */
class PaymentFlowTest {

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();
    JsonRosterRepository roster;
    JsonPaymentRepository paymentRepo;
    MonthService months;
    PaymentService payments;
    ReceiptService receipts;
    StudentService students;

    static final String NOV = "2026-11";

    @BeforeEach
    void setUp() throws Exception {
        // the shape of the real students.json: no categories block, no specialFee, extra fields
        Files.writeString(dir.resolve("students.json"), """
                {"classes":[{"name":"Forte","family":"Dynamics","meaning":"loud and strong","symbol":"f","symbolStyle":"italic"},
                            {"name":"Legato","family":"Articulation","meaning":"smooth","symbol":"","symbolStyle":"plain"}],
                 "students":[
                  {"id":"s01","name":"Giana Neshi","sapaId":"SAPA-1000","category":"Kids","className":"Forte","classDay":"Wednesday","classTime":"3:30 PM","fee":8000,"active":true,"song":"Waka Waka","result":{"x":1}},
                  {"id":"s02","name":"Yulia Samarasekara","sapaId":"SAPA-1001","category":"Kids","className":"Forte","classDay":"Wednesday","classTime":"3:30 PM","fee":8000,"active":true},
                  {"id":"s03","name":"Thenul Munasinghe","sapaId":"SAPA-1002","category":"Kids","className":"Forte","fee":0,"active":true},
                  {"id":"s04","name":"Fabin Mihel","sapaId":"SAPA-1003","category":"Kids","className":"Forte","fee":6000,"active":true},
                  {"id":"s05","name":"Zaki Azhar","sapaId":"SAPA-1004","category":"Youth","className":"Legato","fee":7000,"active":true},
                  {"id":"s06","name":"Old Student","sapaId":"SAPA-1005","category":"Youth","className":"Legato","fee":7000,"active":false}
                 ]}
                """);
        String d = dir.toString();
        roster = new JsonRosterRepository(mapper, d);
        paymentRepo = new JsonPaymentRepository(mapper, d);
        JsonSettingsRepository settings = new JsonSettingsRepository(mapper, d);
        months = new MonthService(new JsonMonthRepository(mapper, d), paymentRepo, roster, settings);
        payments = new PaymentService(paymentRepo, months, roster, settings);
        receipts = new ReceiptService(new JsonReceiptRepository(mapper, d), payments);
        students = new StudentService(roster, paymentRepo, months);
    }

    private Row row(MonthView v, String id) {
        return v.rows().stream().filter(r -> r.studentId().equals(id)).findFirst().orElseThrow();
    }

    private static Receipt receipt(String number, String month, List<Person> people, List<LineItem> items) {
        Person first = people.getFirst();
        return new Receipt(null, number, "2026-11-03", people, first.name(), first.id(), "", "Guitar and Vocal",
                first.session(), "", "", month, 2026, null, items, BigDecimal.ONE, "Bank Transfer", "Rebeccah Nayomi",
                "", "", "", null, null);
    }

    private static Person person(String name, String id) {
        return new Person(name, id, "Kids", "Guitar and Vocal", "", "", "Forte");
    }

    @Test
    void oneReceiptForThreeBrothersAndSistersMarksAllThreePaid() {
        List<Person> kids = List.of(person("Giana Neshi", "SAPA-1000"), person("Yulia Samarasekara", "SAPA-1001"),
                person("Fabin Mihel", "SAPA-1003"));
        Receipt r = receipts.create(receipt("SAPA-3", "November", kids, List.of(
                new LineItem("monthly", "November Class Fee", "Giana Neshi", new BigDecimal("8000")),
                new LineItem("monthly", "November Class Fee", "Yulia Samarasekara", new BigDecimal("8000")),
                new LineItem("monthly", "November Class Fee", "Fabin Mihel", new BigDecimal("6000")))));

        assertThat(r.total()).isEqualByComparingTo("22000");
        MonthView v = months.view(NOV);
        for (Person p : kids) {
            Row row = row(v, p.id());
            assertThat(row.status()).as(p.name()).isEqualTo("Paid");
            assertThat(row.payments()).extracting(lk.shalom.receipts.model.Payment::receiptNumber).containsExactly("SAPA-3");
        }
    }

    @Test
    void classFeesAndSpecialFeesAreWorkedOutFromAnOldFile() {
        var r = roster.load();
        assertThat(r.categories()).extracting(Category::name).startsWith("Kids", "Junior", "Youth", "Adult", "Online");
        assertThat(r.categories().getFirst().fee()).isEqualByComparingTo("8000");
        Student fabin = r.students().stream().filter(s -> s.name().equals("Fabin Mihel")).findFirst().orElseThrow();
        assertThat(fabin.specialFee()).isEqualByComparingTo("6000");
        Student thenul = r.students().stream().filter(s -> s.name().startsWith("Thenul")).findFirst().orElseThrow();
        assertThat(thenul.fee()).isEqualByComparingTo("0");
        Student giana = r.students().getFirst();
        assertThat(giana.specialFee()).isNull();
        assertThat(r.sessions().getFirst().category()).isEqualTo("Kids");
    }

    @Test
    void aMonthShowsEveryActiveStudentWithTheirStatus() {
        MonthView v = months.view(NOV);

        assertThat(v.started()).isFalse();
        assertThat(v.rows()).hasSize(5);                         // the inactive one is left out
        assertThat(row(v, "SAPA-1002").status()).isEqualTo(MonthService.FREE);
        assertThat(row(v, "SAPA-1000").status()).isEqualTo(MonthService.PENDING);
        assertThat(v.totals().expected()).isEqualByComparingTo("29000");   // 8000 + 8000 + 0 + 6000 + 7000
    }

    @Test
    void markingPaidWithoutAnAmountPaysTheFeeAndAPartPaymentIsPartial() {
        payments.create(new PaymentInput("SAPA-1000", NOV, null, null, null, null, null));
        payments.create(new PaymentInput("SAPA-1004", NOV, null, new BigDecimal("3000"), "Cash", "2026-11-02", null));

        MonthView v = months.view(NOV);
        assertThat(v.started()).isTrue();
        assertThat(row(v, "SAPA-1000").status()).isEqualTo(MonthService.PAID);
        assertThat(row(v, "SAPA-1000").payments().getFirst().paidTo()).isEqualTo("Shalom Academy");
        assertThat(row(v, "SAPA-1004").status()).isEqualTo(MonthService.PARTIAL);
        assertThat(row(v, "SAPA-1004").outstanding()).isEqualByComparingTo("4000");
        assertThat(v.totals().collected()).isEqualByComparingTo("11000");
        assertThat(v.totals().byPaidTo()).extracting(MonthService.PaidTo::name).containsExactly("Shalom Academy", "Cash");

        assertThatThrownBy(() -> payments.create(new PaymentInput("SAPA-1000", NOV, null, null, null, null, null)))
                .isInstanceOf(ApiException.class).hasMessageContaining("nothing left to pay");
    }

    @Test
    void issuingAReceiptMarksTheFeePaidAndLinksAFeeAlreadyTicked() {
        // Yulia's fee was ticked on the Payments page first
        payments.create(new PaymentInput("SAPA-1001", NOV, null, null, "Cash", null, null));

        Receipt saved = receipts.create(receipt("SAPA-1", "November",
                List.of(person("Giana Neshi", "SAPA-1000"), person("Yulia Samarasekara", "SAPA-1001")),
                List.of(new LineItem("monthly", "November Class Fee", "Giana Neshi", new BigDecimal("8000")),
                        new LineItem("monthly", "November Class Fee", "Yulia Samarasekara", new BigDecimal("8000")),
                        new LineItem("admission", "Admission Fee", "Giana Neshi", new BigDecimal("5000")))));

        MonthView v = months.view(NOV);
        assertThat(row(v, "SAPA-1000").status()).isEqualTo(MonthService.PAID);
        assertThat(row(v, "SAPA-1000").extra()).isEqualByComparingTo("5000");
        assertThat(row(v, "SAPA-1001").payments()).singleElement()
                .satisfies(p -> assertThat(p.receiptId()).isEqualTo(saved.id()));    // linked, not doubled
        assertThat(paymentRepo.findAll()).hasSize(3);
        assertThat(paymentRepo.findByReceipt(saved.id())).allSatisfy(p -> assertThat(p.paidTo()).isEqualTo("Rebeccah Nayomi"));

        // re-saving with one line fewer drops that payment
        receipts.update(saved.id(), receipt("SAPA-1", "November",
                List.of(person("Giana Neshi", "SAPA-1000"), person("Yulia Samarasekara", "SAPA-1001")),
                List.of(new LineItem("monthly", "November Class Fee", "Giana Neshi", new BigDecimal("8000")),
                        new LineItem("monthly", "November Class Fee", "Yulia Samarasekara", new BigDecimal("8000")))));
        assertThat(paymentRepo.findAll()).hasSize(2);

        // deleting the receipt but keeping the payments leaves them paid
        receipts.delete(saved.id(), false);
        assertThat(paymentRepo.findAll()).hasSize(2).allSatisfy(p -> assertThat(p.receiptId()).isNull());
        assertThat(row(months.view(NOV), "SAPA-1000").status()).isEqualTo(MonthService.PAID);
    }

    @Test
    void deletingAReceiptCanRemoveItsPayments() {
        Receipt saved = receipts.create(receipt("SAPA-2", "November", List.of(person("Giana Neshi", "SAPA-1000")),
                List.of(new LineItem("monthly", "November Class Fee", "", new BigDecimal("8000")))));
        receipts.delete(saved.id(), true);
        assertThat(paymentRepo.findAll()).isEmpty();
        assertThat(row(months.view(NOV), "SAPA-1000").status()).isEqualTo(MonthService.PENDING);
    }

    @Test
    void rosterChangesReachTheNewestMonthOnlyForStudentsWhoHaveNotPaid() {
        months.start("2026-10");
        payments.create(new PaymentInput("SAPA-1000", NOV, null, null, null, null, null));   // starts November

        Student giana = roster.load().students().getFirst();
        Student yulia = roster.load().students().get(1);
        students.update(giana.id(), new StudentInput(giana.name(), "Kids", "Forte", new BigDecimal("9000"), true, null, null, null, null));
        students.update(yulia.id(), new StudentInput(yulia.name(), "Kids", "Forte", new BigDecimal("9000"), true, null, null, null, null));

        MonthView nov = months.view(NOV);
        assertThat(row(nov, "SAPA-1000").fee()).isEqualByComparingTo("8000");   // already paid: kept
        assertThat(row(nov, "SAPA-1001").fee()).isEqualByComparingTo("9000");   // not paid: follows
        assertThat(row(months.view("2026-10"), "SAPA-1001").fee()).isEqualByComparingTo("8000");   // older month frozen

        Student added = students.create(new StudentInput("New Kid", "Kids", "Forte", null, true, "Mrs. Kid", "0771234567", null, null));
        assertThat(added.id()).isEqualTo("SAPA-1006");
        assertThat(added.fee()).isEqualByComparingTo("8000");
        assertThat(row(months.view(NOV), "SAPA-1006").status()).isEqualTo(MonthService.PENDING);
    }

    @Test
    void savingAStudentKeepsFieldsTheAppDoesNotManage() throws Exception {
        Student giana = roster.load().students().getFirst();
        students.update(giana.id(), new StudentInput(giana.name(), "Kids", "Forte", null, true, "Mrs. Neshi", null, null, null));

        String json = Files.readString(dir.resolve("students.json"));
        assertThat(json).contains("\"song\" : \"Waka Waka\"", "\"parent\" : \"Mrs. Neshi\"", "\"categories\"");
        assertThat(json).contains("\"specialFee\" : 6000");   // Fabin's special fee, now stored
    }

    @Test
    void validatesStudents() {
        assertThatThrownBy(() -> students.create(new StudentInput("giana neshi", "Kids", "Forte", null, true, null, null, null, null)))
                .hasMessageContaining("already a student");
        assertThatThrownBy(() -> students.create(new StudentInput("Someone", "Youth", "Forte", null, true, null, null, null, null)))
                .hasMessageContaining("Kids session");
        assertThatCode(() -> students.delete("SAPA-1000")).doesNotThrowAnyException();   // nothing paid yet
        payments.create(new PaymentInput("SAPA-1001", NOV, null, null, null, null, null));
        assertThatThrownBy(() -> students.delete("SAPA-1001")).hasMessageContaining("Inactive");
    }

    @Test
    void sessionsKeepTheirSizeAndShowFreePlaces() {
        students.saveSession(new SessionInput("Forte", "Kids", "Wednesday", "3:30 - 4:30 PM", 3, null, null, null, null), false);

        var forte = months.view(NOV).sessions().stream().filter(s -> s.name().equals("Forte")).findFirst().orElseThrow();
        assertThat(forte.max()).isEqualTo(3);
        assertThat(forte.students()).isEqualTo(4);
        assertThat(forte.free()).isEqualTo(-1);                          // over by one
        assertThat(roster.load().students().getFirst().time()).isEqualTo("3:30 - 4:30 PM");
    }

    @Test
    void aMonthsFeeCanBeChangedForOneStudentAndAnotherRemark() {
        months.updateDue(NOV, "SAPA-1000", new MonthService.DueUpdate(new BigDecimal("4000"), null, "Half month"));
        Row r = row(months.view(NOV), "SAPA-1000");
        assertThat(r.fee()).isEqualByComparingTo("4000");
        assertThat(r.feeOverridden()).isTrue();
        assertThat(r.remark()).isEqualTo("Half month");

        months.updateDue(NOV, "SAPA-1000", new MonthService.DueUpdate(null, true, null));
        assertThat(row(months.view(NOV), "SAPA-1000").fee()).isEqualByComparingTo("8000");
    }

    @Test
    void csvHasOneLinePerStudent() {
        payments.create(new PaymentInput("SAPA-1000", NOV, null, null, null, "2026-11-01", null));
        String[] lines = months.csv(NOV).split("\r\n");
        assertThat(lines).hasSize(6);
        assertThat(lines[1]).contains("\"Giana Neshi\"", "\"Paid\"", "\"Shalom Academy\"", "\"2026-11-01\"");
    }
}
