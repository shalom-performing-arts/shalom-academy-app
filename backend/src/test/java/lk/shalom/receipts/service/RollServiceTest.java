package lk.shalom.receipts.service;

import lk.shalom.receipts.model.RollBook;
import lk.shalom.receipts.repository.JsonRollRepository;
import lk.shalom.receipts.repository.JsonRosterRepository;
import lk.shalom.receipts.repository.JsonTeacherRepository;
import lk.shalom.receipts.service.RollService.MarkInput;
import lk.shalom.receipts.service.RollService.RollClass;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RollServiceTest {

    static final ZoneId SL = ZoneId.of("Asia/Colombo");

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() throws Exception {
        // Wednesday has three sessions, written out of order
        Files.writeString(dir.resolve("students.json"), """
                {"classes":[
                  {"name":"Pianissimo","category":"Adult","day":"Wednesday","time":"6:15 - 7:15 PM"},
                  {"name":"Forte","category":"Kids","day":"Wednesday","time":"3:30 - 4:30 PM"},
                  {"name":"Moderato","category":"Junior","day":"Wednesday","time":"5:00 - 6:00 PM"},
                  {"name":"Fortissimo","category":"Kids","day":"Saturday","time":"11:30 AM - 12:30 PM"}],
                 "students":[
                  {"id":"s01","name":"Giana Neshi","sapaId":"SAPA-1000","category":"Kids","className":"Forte","fee":8000,"active":true},
                  {"id":"s02","name":"Yulia Samarasekara","sapaId":"SAPA-1001","category":"Kids","className":"Forte","fee":8000,"active":true},
                  {"id":"s03","name":"Ryley Rabot","sapaId":"SAPA-1002","category":"Kids","className":"Forte","fee":8000,"active":true},
                  {"id":"s04","name":"Gone Student","sapaId":"SAPA-1003","category":"Kids","className":"Forte","fee":8000,"active":false},
                  {"id":"s05","name":"Romain Perera","sapaId":"SAPA-1004","category":"Junior","className":"Moderato","fee":7000,"active":true}
                 ]}
                """);
    }

    RollService at(String localDateTime) {
        Clock c = Clock.fixed(LocalDateTime.parse(localDateTime).atZone(SL).toInstant(), SL);
        String d = dir.toString();
        return new RollService(new JsonRosterRepository(mapper, d), new JsonRollRepository(mapper, d),
                new JsonTeacherRepository(mapper, d), c);
    }

    @Test
    void classTimesAreReadTheWayTheyAreWritten() {
        assertThat(RollService.times("3:30 - 4:30 PM")).isEqualTo(new RollService.Times(LocalTime.of(15, 30), LocalTime.of(16, 30)));
        assertThat(RollService.times("11:30 AM - 12:30 PM").start()).isEqualTo(LocalTime.of(11, 30));
        assertThat(RollService.times("11:30 - 12:30 PM").start()).isEqualTo(LocalTime.of(11, 30));
        assertThat(RollService.times("9:30 - 10:30 AM").start()).isEqualTo(LocalTime.of(9, 30));
        assertThat(RollService.times("12:30 - 1:30 PM")).isEqualTo(new RollService.Times(LocalTime.of(12, 30), LocalTime.of(13, 30)));
    }

    @Test
    void todaysClassesComeInTimeOrderAndOpenOnTheOneOnNow() {
        var day = at("2026-11-04T17:10").day(LocalDate.parse("2026-11-04"));   // Wednesday, during Moderato
        assertThat(day.classes()).extracting(c -> c.session().name()).containsExactly("Forte", "Moderato", "Pianissimo");
        assertThat(day.classes()).extracting(RollClass::state).containsExactly("done", "now", "next");
        assertThat(day.focus()).isEqualTo("Moderato");
        // the register: active students of that session only
        assertThat(day.classes().getFirst().students()).extracting(RollService.RollStudent::name)
                .containsExactly("Giana Neshi", "Yulia Samarasekara", "Ryley Rabot");

        var before = at("2026-11-04T15:20").day(LocalDate.parse("2026-11-04"));  // 10 minutes before Forte
        assertThat(before.classes()).extracting(RollClass::state).containsExactly("now", "next", "later");
    }

    @Test
    void markingOneByOneOrAllPresentAtOnce() {
        RollService s = at("2026-11-04T15:40");
        s.mark(new MarkInput("2026-11-04", "Forte", "SAPA-1001", RollBook.ABSENT, "sick"), "ijini", "Ijini");
        RollClass c = s.allPresent("2026-11-04", "Forte", "patali", "Patali");
        // all-present leaves the absent student as she is
        assertThat(c.present()).isEqualTo(2);
        assertThat(c.absent()).isEqualTo(1);
        assertThat(c.unmarked()).isZero();
        assertThat(c.students()).filteredOn(x -> x.id().equals("SAPA-1001")).first()
                .satisfies(x -> { assertThat(x.status()).isEqualTo("A"); assertThat(x.note()).isEqualTo("sick"); });
        assertThat(c.markedBy()).isEqualTo("Patali");

        // a late arrival changes P to L and keeps any note; clearing removes the mark
        c = s.mark(new MarkInput("2026-11-04", "Forte", "SAPA-1000", RollBook.LATE, null), "amaya", "Amaya");
        assertThat(c.late()).isEqualTo(1);
        c = s.mark(new MarkInput("2026-11-04", "Forte", "SAPA-1000", null, null), "amaya", "Amaya");
        assertThat(c.unmarked()).isEqualTo(1);
    }

    @Test
    void aClassCanOnlyBeMarkedOnItsOwnDayAndNotAhead() {
        RollService s = at("2026-11-04T15:40");
        assertThatThrownBy(() -> s.mark(new MarkInput("2026-11-05", "Forte", "SAPA-1000", "P", null), "office", "Office"))
                .hasMessageContaining("meets on Wednesday");
        assertThatThrownBy(() -> s.mark(new MarkInput("2026-11-11", "Forte", "SAPA-1000", "P", null), "office", "Office"))
                .hasMessageContaining("not happened yet");
        assertThatThrownBy(() -> s.mark(new MarkInput("2026-11-04", "Forte", "SAPA-1000", "X", null), "office", "Office"))
                .hasMessageContaining("P, L or A");
    }

    @Test
    void theMonthLooksLikeThePaperRegister() {
        RollService s = at("2026-11-12T10:00");
        s.mark(new MarkInput("2026-11-04", "Forte", "SAPA-1000", "P", null), "office", "Office");
        s.mark(new MarkInput("2026-11-11", "Forte", "SAPA-1000", "A", null), "ijini", "Ijini");
        s.mark(new MarkInput("2026-11-04", "Forte", "SAPA-1001", "L", null), "office", "Office");
        var m = s.month("Forte", "2026-11");
        assertThat(m.dates()).extracting(RollService.MonthDate::label).containsExactly("4 Nov", "11 Nov", "18 Nov", "25 Nov");
        assertThat(m.dates()).extracting(RollService.MonthDate::future).containsExactly(false, false, true, true);
        assertThat(m.dates().get(1).markedBy()).isEqualTo("Ijini");
        var giana = m.rows().getFirst();
        assertThat(giana.cells()).extracting(RollService.Cell::status).containsExactly("P", "A", null, null);
        assertThat(giana.rate()).isEqualTo(50);
        assertThat(m.rows().get(1).rate()).isEqualTo(100);   // late still counts as attended
        assertThat(m.rows().get(2).rate()).isNull();         // nothing marked yet
    }

    @Test
    void aCoverUpClassMakesUpTheOneMissed() {
        // Giana misses Forte on Wednesday 4 Nov and comes to Fortissimo on Saturday 7 Nov instead
        RollService s = at("2026-11-07T11:40");
        var booked = s.book(new RollService.BookInput("SAPA-1000", "Forte", "2026-11-04", "Fortissimo", "2026-11-07", "family trip"),
                "office", "Office");
        assertThat(booked.status()).isEqualTo("booked");
        assertThat(booked.toLabel()).startsWith("Fortissimo · Sat 7 Nov");

        // Wednesday shows her absent, with the cover-up noted
        var wed = s.day(LocalDate.parse("2026-11-04")).classes().getFirst();
        var giana = wed.students().stream().filter(x -> x.id().equals("SAPA-1000")).findFirst().orElseThrow();
        assertThat(giana.status()).isEqualTo("A");
        assertThat(giana.makeupNote()).isEqualTo("Cover-up booked: Fortissimo · Sat 7 Nov");

        // Saturday's Fortissimo lists her as a cover-up
        var sat = s.day(LocalDate.parse("2026-11-07")).classes().getFirst();
        assertThat(sat.covers()).isEqualTo(1);
        var cover = sat.students().stream().filter(x -> x.id().equals("SAPA-1000")).findFirst().orElseThrow();
        assertThat(cover.coverFor()).isEqualTo("Forte · Wed 4 Nov");

        // marked present there: Wednesday becomes "made up" and counts as attended
        s.mark(new MarkInput("2026-11-07", "Fortissimo", "SAPA-1000", "P", null), "patali", "Patali");
        giana = s.day(LocalDate.parse("2026-11-04")).classes().getFirst().students().stream()
                .filter(x -> x.id().equals("SAPA-1000")).findFirst().orElseThrow();
        assertThat(giana.status()).isEqualTo("M");
        assertThat(giana.note()).isEqualTo("Made up: Fortissimo · Sat 7 Nov");
        var month = s.month("Forte", "2026-11");
        assertThat(month.rows().getFirst().madeUp()).isEqualTo(1);
        assertThat(month.rows().getFirst().rate()).isEqualTo(100);
        // and she is not a stray row on Fortissimo's own register
        assertThat(s.month("Fortissimo", "2026-11").rows()).extracting(RollService.MonthRow::id).doesNotContain("SAPA-1000");

        // marked absent at the cover-up instead: Wednesday is absent again
        s.mark(new MarkInput("2026-11-07", "Fortissimo", "SAPA-1000", "A", null), "patali", "Patali");
        assertThat(s.makeups("2026-11")).extracting(RollService.MakeupOut::status).containsExactly("missed");
        assertThat(s.month("Forte", "2026-11").rows().getFirst().cells().getFirst().status()).isEqualTo("A");

        // a second booking for the same missed class is refused; cancelling clears it all
        assertThatThrownBy(() -> s.book(new RollService.BookInput("SAPA-1000", "Forte", "2026-11-04", "Fortissimo", "2026-11-07", null),
                "office", "Office")).hasMessageContaining("already has a cover-up");
        s.cancel(booked.id(), "office", "Office");
        assertThat(s.makeups("2026-11")).isEmpty();
        assertThat(s.day(LocalDate.parse("2026-11-07")).classes().getFirst().covers()).isZero();
    }

    @Test
    void cancellingACoverUpForAClassStillToComeLeavesNoMark() {
        RollService s = at("2026-11-07T10:00");
        var m = s.book(new RollService.BookInput("SAPA-1000", "Forte", "2026-11-11", "Fortissimo", "2026-11-14", "exam"),
                "office", "Office");
        s.cancel(m.id(), "office", "Office");
        assertThat(s.day(LocalDate.parse("2026-11-11")).classes().getFirst().students())
                .filteredOn(x -> x.id().equals("SAPA-1000")).extracting(RollService.RollStudent::status).containsOnlyNulls();
    }

    @Test
    void aCoverUpMustBeInAnotherSessionOnItsOwnDay() {
        RollService s = at("2026-11-07T10:00");
        assertThatThrownBy(() -> s.book(new RollService.BookInput("SAPA-1000", "Forte", "2026-11-04", "Forte", "2026-11-11", null),
                "office", "Office")).hasMessageContaining("different session");
        assertThatThrownBy(() -> s.book(new RollService.BookInput("SAPA-1000", "Forte", "2026-11-04", "Fortissimo", "2026-11-08", null),
                "office", "Office")).hasMessageContaining("meets on Saturday");
    }
}
