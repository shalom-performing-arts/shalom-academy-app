package lk.shalom.receipts.service;

import lk.shalom.receipts.model.AppSettings;
import lk.shalom.receipts.model.AppSettings.FeeType;
import lk.shalom.receipts.model.AppSettings.SiblingDiscount;
import lk.shalom.receipts.model.AppSettings.StudentField;
import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Receipt.LineItem;
import lk.shalom.receipts.model.Receipt.Person;
import lk.shalom.receipts.model.Roster.CategoryInput;
import lk.shalom.receipts.model.Roster.FeeChange;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Classes, billing rules, fee types and custom fields set up from the app rather than in code. */
class FlexibilityTest {

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();
    JsonRosterRepository roster;
    JsonSettingsRepository settings;
    JsonPaymentRepository paymentRepo;
    MonthService months;
    PaymentService payments;
    ReceiptService receipts;
    StudentService students;

    @BeforeEach
    void setUp() throws Exception {
        Files.writeString(dir.resolve("students.json"), """
                {"categories":[{"name":"Kids","fee":8000},{"name":"Youth","fee":7000},{"name":"Online","fee":null}],
                 "classes":[{"name":"Forte","category":"Kids","day":"Wednesday","time":"3:30 - 4:30 PM","max":8},
                            {"name":"Legato","category":"Youth","day":"Thursday","time":"3:30 - 4:30 PM","max":15}],
                 "students":[
                  {"name":"Anna Perera","sapaId":"SAPA-1000","category":"Kids","className":"Forte","active":true,"family":"Perera"},
                  {"name":"Ben Perera","sapaId":"SAPA-1001","category":"Kids","className":"Forte","active":true,"family":"Perera"},
                  {"name":"Cara Silva","sapaId":"SAPA-1002","category":"Youth","className":"Legato","active":true},
                  {"name":"Dan Online","sapaId":"SAPA-1003","category":"Online","active":true,"country":"UK"}
                 ]}
                """);
        String d = dir.toString();
        roster = new JsonRosterRepository(mapper, d);
        settings = new JsonSettingsRepository(mapper, d);
        paymentRepo = new JsonPaymentRepository(mapper, d);
        months = new MonthService(new JsonMonthRepository(mapper, d), paymentRepo, roster, settings);
        payments = new PaymentService(paymentRepo, months, roster, settings);
        receipts = new ReceiptService(new JsonReceiptRepository(mapper, d), payments);
        students = new StudentService(roster, paymentRepo, months);
    }

    private static Row row(MonthView v, String id) {
        return v.rows().stream().filter(r -> r.studentId().equals(id)).findFirst().orElseThrow();
    }

    private void saveSettings(java.util.function.UnaryOperator<AppSettings> change) {
        settings.save(change.apply(settings.get()));
    }

    private static AppSettings with(AppSettings s, SiblingDiscount d, List<FeeType> types, List<StudentField> fields) {
        return new AppSettings(s.academyName(), s.tagline(), s.motto(), s.address(), s.phone(), s.whatsapp(), s.email(),
                s.logo(), s.signature(), s.signName(), s.signTitle(), s.signStyle(), s.prefix(), s.numFormat(),
                s.currency(), s.currencyWord(), s.theme(), s.classes(), s.admissionFee(), s.footer(), s.paidToOptions(),
                s.paymentMethods(), types == null ? s.feeTypes() : types, d == null ? s.siblingDiscount() : d,
                fields == null ? s.studentFields() : fields);
    }

    private static CategoryInput cat(String name, BigDecimal fee) {
        return new CategoryInput(name, null, fee, "monthly", List.of(), true, List.of());
    }

    @Test
    void onlineIsPayAsYouGoWithoutSessions() {
        var online = roster.load().category("Online");
        assertThat(online.billingMode()).isEqualTo("payg");
        assertThat(online.hasSessions()).isFalse();
        assertThat(row(months.view("2026-11"), "SAPA-1003").fee()).isNull();
    }

    @Test
    void theSecondSiblingGetsTheDiscount() {
        saveSettings(s -> with(s, new SiblingDiscount(true, "percent", new BigDecimal("25")), null, null));

        MonthView v = months.view("2026-11");
        assertThat(row(v, "SAPA-1000").fee()).isEqualByComparingTo("8000");
        assertThat(row(v, "SAPA-1001").fee()).isEqualByComparingTo("6000");
        assertThat(row(v, "SAPA-1001").discount()).isEqualByComparingTo("2000");
        assertThat(row(v, "SAPA-1002").discount()).isEqualByComparingTo("0");   // no family

        // a fixed amount instead
        saveSettings(s -> with(s, new SiblingDiscount(true, "amount", new BigDecimal("1500")), null, null));
        assertThat(row(months.view("2026-11"), "SAPA-1001").fee()).isEqualByComparingTo("6500");
    }

    @Test
    void aSiblingOnASpecialFeeIsNotDiscountedAgain() {
        saveSettings(s -> with(s, new SiblingDiscount(true, "percent", new BigDecimal("50")), null, null));
        Student ben = roster.load().students().get(1);
        students.update(ben.id(), new StudentInput(ben.name(), "Kids", "Forte", new BigDecimal("5000"), true,
                null, null, null, null, "Perera", null));

        MonthView v = months.view("2026-11");
        assertThat(row(v, "SAPA-1001").fee()).isEqualByComparingTo("5000");
        assertThat(row(v, "SAPA-1000").fee()).isEqualByComparingTo("8000");   // no longer has a discounted sibling
    }

    @Test
    void termBillingChargesOnlyInTermMonths() {
        students.saveCategories(List.of(
                new CategoryInput("Kids", null, new BigDecimal("8000"), "monthly", List.of(), true, List.of()),
                new CategoryInput("Youth", null, new BigDecimal("20000"), "term", List.of(1, 5, 9), true, List.of()),
                new CategoryInput("Online", null, null, "payg", List.of(), false, List.of())));

        assertThat(row(months.view("2027-01"), "SAPA-1002").fee()).isEqualByComparingTo("20000");
        Row feb = row(months.view("2027-02"), "SAPA-1002");
        assertThat(feb.status()).isEqualTo(MonthService.NOT_DUE);
        assertThat(months.view("2027-02").totals().expected()).isEqualByComparingTo("16000");   // just the two Kids

        assertThatThrownBy(() -> students.saveCategories(List.of(
                new CategoryInput("Kids", null, new BigDecimal("8000"), "term", List.of(), true, List.of()),
                cat("Youth", new BigDecimal("7000")), cat("Online", null))))
                .hasMessageContaining("pick the months");
    }

    @Test
    void aScheduledFeeChangeStartsInItsMonthAndLeavesEarlierMonthsAlone() {
        months.start("2026-11");   // November starts on the old fee
        students.saveCategories(List.of(
                new CategoryInput("Kids", null, new BigDecimal("8000"), "monthly", List.of(), true,
                        List.of(new FeeChange("2027-01", new BigDecimal("9000")))),
                cat("Youth", new BigDecimal("7000")),
                new CategoryInput("Online", null, null, "payg", List.of(), false, List.of())));

        assertThat(row(months.view("2026-11"), "SAPA-1000").fee()).isEqualByComparingTo("8000");
        assertThat(row(months.view("2026-12"), "SAPA-1000").fee()).isEqualByComparingTo("8000");
        assertThat(row(months.view("2027-01"), "SAPA-1000").fee()).isEqualByComparingTo("9000");
    }

    @Test
    void renamingAClassCarriesItsStudentsSessionsAndMonths() {
        payments.create(new PaymentInput("SAPA-1000", "2026-11", null, null, null, null, null));
        students.saveCategories(List.of(
                new CategoryInput("Little Ones", "Kids", new BigDecimal("8000"), "monthly", List.of(), true, List.of()),
                cat("Youth", new BigDecimal("7000")),
                new CategoryInput("Online", null, null, "payg", List.of(), false, List.of())));

        var r = roster.load();
        assertThat(r.students().getFirst().category()).isEqualTo("Little Ones");
        assertThat(r.sessions().getFirst().category()).isEqualTo("Little Ones");
        assertThat(row(months.view("2026-11"), "SAPA-1000").category()).isEqualTo("Little Ones");
        assertThat(months.view("2026-11").categories().getFirst().collected()).isEqualByComparingTo("8000");
    }

    @Test
    void aClassWithStudentsCannotBeRemovedButAnEmptyOneCanBeAddedAndRemoved() {
        assertThatThrownBy(() -> students.saveCategories(List.of(cat("Kids", BigDecimal.ONE), cat("Online", null))))
                .hasMessageContaining("Youth still has students");

        students.saveCategories(List.of(cat("Kids", new BigDecimal("8000")), cat("Youth", new BigDecimal("7000")),
                cat("Online", null), cat("Seniors", new BigDecimal("5000"))));
        assertThat(roster.load().categories()).extracting(c -> c.name()).endsWith("Seniors");
        students.saveCategories(List.of(cat("Kids", new BigDecimal("8000")), cat("Youth", new BigDecimal("7000")),
                cat("Online", null)));
        assertThat(roster.load().categories()).hasSize(3);
    }

    @Test
    void renamingASessionMovesItsStudentsAndDeletingNeedsItEmpty() {
        months.start("2026-11");
        students.saveSession(new SessionInput("Forte", "Kids", "Wednesday", "3:30 - 4:30 PM", 8, null, null, null, null, "Fortissimo"), false);

        assertThat(roster.load().students().getFirst().session()).isEqualTo("Fortissimo");
        assertThat(row(months.view("2026-11"), "SAPA-1000").session()).isEqualTo("Fortissimo");

        assertThatThrownBy(() -> students.deleteSession("Fortissimo")).hasMessageContaining("Move them");
        students.saveSession(new SessionInput("Spare", "Kids", "Monday", "", null, null, null, null, null), true);
        students.deleteSession("Spare");
        assertThat(roster.load().sessions()).extracting(s -> s.name()).doesNotContain("Spare");
    }

    @Test
    void customFeeTypesCanBePaidAndPutOnReceipts() {
        List<FeeType> types = new ArrayList<>(settings.get().feeTypes());
        types.add(new FeeType(null, "Exam fee", new BigDecimal("2500")));
        saveSettings(s -> with(s, null, types, null));
        assertThat(settings.get().feeTypes()).extracting(FeeType::id).containsExactly("monthly", "admission", "exam-fee");

        payments.create(new PaymentInput("SAPA-1002", "2026-11", "exam-fee", new BigDecimal("2500"), null, null, null));
        assertThatThrownBy(() -> payments.create(new PaymentInput("SAPA-1002", "2026-11", "made-up", BigDecimal.TEN, null, null, null)))
                .hasMessageContaining("not one of the fee types");

        Receipt r = receipts.create(new Receipt(null, "SAPA-9", "2026-11-03",
                List.of(new Person("Cara Silva", "SAPA-1002", "Youth", "", "", "", "Legato")),
                "Cara Silva", "SAPA-1002", "Youth", "", "Legato", "", "", "November", 2026, null,
                List.of(new LineItem("monthly", "November Class Fee", "", new BigDecimal("7000")),
                        new LineItem("exam-fee", "Exam fee", "", new BigDecimal("2500"))),
                null, "Cash", "Cash", "", "", "", null, null));

        // the exam fee paid earlier is linked to the receipt, not doubled
        Row cara = row(months.view("2026-11"), "SAPA-1002");
        assertThat(cara.payments()).hasSize(2).allSatisfy(p -> assertThat(p.receiptId()).isEqualTo(r.id()));
        assertThat(cara.extra()).isEqualByComparingTo("2500");
    }

    @Test
    void customStudentFieldsAndTheFamilyAreSaved() throws Exception {
        saveSettings(s -> with(s, null, null, List.of(new StudentField(null, "School", "text", null, true),
                new StudentField(null, "Instrument", "select", List.of("Guitar", "Ukulele"), false))));
        assertThat(settings.get().studentFields()).extracting(StudentField::key).containsExactly("school", "instrument");

        Student cara = roster.load().students().get(2);
        students.update(cara.id(), new StudentInput(cara.name(), "Youth", "Legato", null, true, null, null, null, null,
                "Silva", Map.of("school", "Ladies' College", "instrument", "Ukulele")));

        Student saved = roster.load().students().get(2);
        assertThat(saved.family()).isEqualTo("Silva");
        assertThat(saved.custom()).containsEntry("school", "Ladies' College").containsEntry("instrument", "Ukulele");
        assertThat(Files.readString(dir.resolve("students.json"))).contains("\"custom\"");
    }

    /** A months.json written before discounts and term billing existed must still load. */
    @Test
    void monthsSavedByTheEarlierVersionStillLoad() throws Exception {
        Files.writeString(dir.resolve("months.json"), """
                [{"month":"2026-11","createdAt":"2026-11-03T10:00:00Z","dues":[
                  {"studentId":"SAPA-1000","name":"Anna Perera","category":"Kids","session":"Forte",
                   "fee":8000,"active":true,"feeOverridden":false,"remark":""}]}]
                """);
        MonthService reopened = new MonthService(new JsonMonthRepository(mapper, dir.toString()), paymentRepo, roster, settings);

        Row anna = row(reopened.view("2026-11"), "SAPA-1000");
        assertThat(anna.fee()).isEqualByComparingTo("8000");
        assertThat(anna.status()).isEqualTo(MonthService.PENDING);
    }

    @Test
    void olderSettingsGetTheBuiltInListsFilledIn() {
        AppSettings s = settings.get();
        assertThat(s.paymentMethods()).contains("Bank Transfer", "Cash");
        assertThat(s.feeTypes()).extracting(FeeType::id).containsExactly("monthly", "admission");
        assertThat(s.siblingDiscount().enabled()).isFalse();
    }
}
