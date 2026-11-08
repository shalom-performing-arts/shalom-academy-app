package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;
import lk.shalom.receipts.repository.JsonMonthRepository;
import lk.shalom.receipts.repository.JsonPaymentRepository;
import lk.shalom.receipts.repository.JsonRegistrationRepository;
import lk.shalom.receipts.repository.JsonRosterRepository;
import lk.shalom.receipts.repository.JsonSettingsRepository;
import lk.shalom.receipts.service.RegistrationService.FormInput;
import lk.shalom.receipts.service.RegistrationService.PlaceInput;
import lk.shalom.receipts.service.RegistrationService.RegistrationInput;
import lk.shalom.receipts.service.RegistrationService.Row;
import lk.shalom.receipts.service.RegistrationService.Submitted;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RegistrationServiceTest {

    static final ZoneId SL = ZoneId.of("Asia/Colombo");

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();
    JsonRosterRepository roster;
    StudentService students;
    RegistrationService service;
    String token;

    @BeforeEach
    void setUp() throws Exception {
        Files.writeString(dir.resolve("students.json"), """
                {"classes":[{"name":"Forte","category":"Kids","day":"Wednesday","time":"3:30 - 4:30 PM","max":10},
                            {"name":"Andante","category":"Junior","day":"Saturday","time":"4:30 - 5:30 PM"}],
                 "students":[
                  {"id":"s01","name":"Giana Neshi","sapaId":"SAPA-1000","category":"Kids","className":"Forte","fee":8000,"active":true}
                 ]}
                """);
        String d = dir.toString();
        roster = new JsonRosterRepository(mapper, d);
        JsonPaymentRepository payments = new JsonPaymentRepository(mapper, d);
        JsonSettingsRepository settings = new JsonSettingsRepository(mapper, d);
        MonthService months = new MonthService(new JsonMonthRepository(mapper, d), payments, roster, settings);
        students = new StudentService(roster, payments, months);
        Clock clock = Clock.fixed(LocalDateTime.parse("2026-11-07T10:00").atZone(SL).toInstant(), SL);
        service = new RegistrationService(new JsonRegistrationRepository(mapper, d), roster, settings, students, clock);
        token = service.form().form().token();
    }

    static RegistrationInput child(String name, String dob, String phone, String key) {
        return new RegistrationInput(name, null, dob, "Female", "Musaeus College", "Grade 3", "Guitar and Vocal", "Kids",
                List.of("Saturday", "Wednesday", "Funday"), "None", "Nadeesha Perera", "Mother", phone, null,
                "nadeesha@gmail.com", "12 Galle Road, Colombo", null, null, "Peanut allergy", "Facebook", null,
                true, true, null, key, null);
    }

    @Test
    void parentSubmitsAndTheChildLandsInThePool() {
        Submitted s = service.submit(token, child("Amaya Perera", "2018-05-14", "071 040 7740", "k1"), "1.1.1.1");
        assertThat(s.number()).isEqualTo("REG-2026-0001");
        Submitted s2 = service.submit(token, child("Kavin Perera", "2016-01-02", "071 040 7740", "k2"), "1.1.1.1");
        assertThat(s2.number()).isEqualTo("REG-2026-0002");

        List<Row> rows = service.list();
        assertThat(rows).hasSize(2);
        Row amaya = rows.stream().filter(r -> r.reg().childName().equals("Amaya Perera")).findFirst().orElseThrow();
        assertThat(amaya.status()).isEqualTo(RegistrationService.POOL);
        assertThat(amaya.age()).isEqualTo(8);
        assertThat(amaya.reg().preferredDays()).containsExactly("Wednesday", "Saturday");   // in week order, junk dropped
        assertThat(amaya.reg().submittedAt()).isNotNull();
        // not a student until placed
        assertThat(roster.load().students()).hasSize(1);
    }

    @Test
    void theSameChildCannotBeRegisteredTwice() {
        service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", "k1"), "1.1.1.1");
        // a double tap on Submit: the same registration back, nothing new saved
        assertThat(service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", "k1"), "1.1.1.1").number())
                .isEqualTo("REG-2026-0001");
        // the same name and birthday, filled in again
        assertThatThrownBy(() -> service.submit(token, child("amaya  perera", "2018-05-14", "0779999999", "k2"), "1.1.1.1"))
                .hasMessageContaining("already registered (REG-2026-0001)");
        // the same name and parent's phone, written another way
        assertThatThrownBy(() -> service.submit(token, child("Amaya Perera", "2018-06-01", "+94 71 040 7740", "k3"), "1.1.1.1"))
                .hasMessageContaining("already registered");
        assertThat(service.list()).hasSize(1);
    }

    @Test
    void theFormChecksTheAnswers() {
        assertThatThrownBy(() -> service.submit(token, child("", "2018-05-14", "0710407740", null), null))
                .hasMessageContaining("child's full name");
        assertThatThrownBy(() -> service.submit(token, child("Amaya", "2030-01-01", "0710407740", null), null))
                .hasMessageContaining("future");
        assertThatThrownBy(() -> service.submit(token, child("Amaya", "2018-05-14", "07104077", null), null))
                .hasMessageContaining("10 digits");
        assertThatThrownBy(() -> service.submit(token, child("Amaya", "2018-05-14", "call me", null), null))
                .hasMessageContaining("numbers only");
        RegistrationInput badEmail = new RegistrationInput("Amaya", null, "2018-05-14", null, null, null, null, null, null,
                null, "Nadeesha", "Mother", "0710407740", null, "nadeesha@", null, null, null, null, null, null, false, true,
                null, null, null);
        assertThatThrownBy(() -> service.submit(token, badEmail, null)).hasMessageContaining("email");
        RegistrationInput notAgreed = new RegistrationInput("Amaya", null, "2018-05-14", null, null, null, null, null, null,
                null, "Nadeesha", "Mother", "0710407740", null, null, null, null, null, null, null, null, false, false,
                null, null, null);
        assertThatThrownBy(() -> service.submit(token, notAgreed, null)).hasMessageContaining("agree");
        // a UK number is fine
        assertThat(service.submit(token, child("Amaya Perera", "2018-05-14", "+44 7700 900123", null), null).number()).isNotBlank();
    }

    @Test
    void aClosedFormOrAnOldLinkTakesNothing() {
        service.saveForm(new FormInput(false, null, null, null, null));
        assertThat(service.publicForm(token).open()).isFalse();
        assertThatThrownBy(() -> service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", null), null))
                .hasMessageContaining("closed");
        service.saveForm(new FormInput(true, null, null, null, null));
        service.newLink();
        assertThatThrownBy(() -> service.publicForm(token)).hasMessageContaining("not valid");
        assertThat(service.publicForm(service.form().form().token()).classes()).contains("Kids", "Junior");
    }

    @Test
    void placingAChildMakesThemAStudentInTheClass() {
        service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", "k1"), null);
        String id = service.list().getFirst().reg().id();

        Row placed = service.place(id, new PlaceInput("Kids", "Forte", null, null));
        assertThat(placed.status()).isEqualTo(RegistrationService.PLACED);
        assertThat(placed.placed().session()).isEqualTo("Forte");
        assertThat(placed.placed().day()).isEqualTo("Wednesday");

        Student s = roster.load().students().stream().filter(x -> x.name().equals("Amaya Perera")).findFirst().orElseThrow();
        assertThat(s.id()).isEqualTo("SAPA-1001");
        assertThat(s.session()).isEqualTo("Forte");
        assertThat(s.parent()).isEqualTo("Nadeesha Perera");
        assertThat(s.phone()).isEqualTo("0710407740");
        assertThat(s.note()).contains("REG-2026-0001").contains("Peanut allergy");
        assertThat(s.active()).isTrue();
        assertThat(s.dateOfBirth()).isEqualTo("2018-05-14");   // for the birthday card

        // placing again is refused: they are moved on the Classes page like anyone else
        assertThatThrownBy(() -> service.place(id, new PlaceInput("Junior", "Andante", null, null)))
                .hasMessageContaining("already placed");

        // deleted on the Students page (entered by mistake): back in the pool
        students.delete(s.id());
        assertThat(service.get(id).status()).isEqualTo(RegistrationService.POOL);
    }

    @Test
    void placingChecksTheClassLikeTheStudentsPage() {
        service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", null), null);
        String id = service.list().getFirst().reg().id();
        assertThatThrownBy(() -> service.place(id, new PlaceInput("Junior", "Forte", null, null)))
                .hasMessageContaining("Kids session");
        assertThat(service.get(id).status()).isEqualTo(RegistrationService.POOL);
    }

    @Test
    void aStudentsBirthdayIsKeptAndChecked() {
        Student g = roster.load().students().getFirst();
        StudentInput base = new StudentInput(g.name(), g.category(), g.session(), g.specialFee(), true, g.parent(), g.phone(),
                g.note(), g.country(), g.family(), g.custom(), "2017-03-09");
        assertThat(students.update(g.id(), base).dateOfBirth()).isEqualTo("2017-03-09");
        // an editor that does not know the field (null) leaves it alone
        StudentInput other = new StudentInput(g.name(), g.category(), g.session(), g.specialFee(), true, "New parent", g.phone(),
                g.note(), g.country(), g.family(), g.custom());
        assertThat(students.update(g.id(), other).dateOfBirth()).isEqualTo("2017-03-09");
        assertThatThrownBy(() -> students.update(g.id(), new StudentInput(g.name(), g.category(), g.session(), null, true,
                null, null, null, null, null, null, "2031-01-01"))).hasMessageContaining("date of birth");
        assertThatThrownBy(() -> students.update(g.id(), new StudentInput(g.name(), g.category(), g.session(), null, true,
                null, null, null, null, null, null, "9 March"))).hasMessageContaining("date of birth");
        // blank clears it
        assertThat(students.update(g.id(), new StudentInput(g.name(), g.category(), g.session(), null, true,
                null, null, null, null, null, null, "")).dateOfBirth()).isEmpty();
    }

    @Test
    void anExistingStudentWithTheSameNameIsPointedOut() {
        service.submit(token, child("Giana Neshi", "2017-03-03", "0710407740", null), null);
        assertThat(service.list().getFirst().maybeStudent()).isEqualTo("Giana Neshi (SAPA-1000)");
    }

    @Test
    void theOfficeCanEditAndDelete() {
        service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", null), null);
        Row r = service.list().getFirst();
        RegistrationInput edit = new RegistrationInput("Amaya Nethmi Perera", null, "2018-05-14", "Female", null, null,
                null, "Junior", List.of(), null, "Nadeesha Perera", "Mother", "0710407740", "0779999999", null, null,
                null, null, null, null, null, true, null, "Called on 8 Nov", null, null);
        Row after = service.update(r.reg().id(), edit);
        assertThat(after.reg().childName()).isEqualTo("Amaya Nethmi Perera");
        assertThat(after.reg().adminNote()).isEqualTo("Called on 8 Nov");
        assertThat(after.reg().number()).isEqualTo("REG-2026-0001");
        assertThat(after.reg().agreed()).isTrue();
        service.delete(r.reg().id());
        assertThat(service.list()).isEmpty();
    }

    @Test
    void exportsOpenInExcel() throws Exception {
        service.submit(token, child("Amaya Perera", "2018-05-14", "0710407740", null), null);
        assertThat(service.csv()).contains("Registration no.").contains("REG-2026-0001").contains("Amaya Perera");
        List<String> names = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(service.xlsx()))) {
            for (ZipEntry e; (e = zip.getNextEntry()) != null; ) names.add(e.getName());
        }
        assertThat(names).contains("xl/workbook.xml", "xl/worksheets/sheet1.xml", "[Content_Types].xml");
        assertThat(XlsxWriter.column(0)).isEqualTo("A");
        assertThat(XlsxWriter.column(29)).isEqualTo("AD");
    }
}
