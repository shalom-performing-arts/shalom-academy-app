package lk.shalom.receipts.service;

import lk.shalom.receipts.auth.AuthService;
import lk.shalom.receipts.repository.JsonTeacherRepository;
import lk.shalom.receipts.model.TeacherBook.Site;
import lk.shalom.receipts.service.TeacherService.CheckIn;
import lk.shalom.receipts.service.TeacherService.Unmark;
import lk.shalom.receipts.service.TeacherService.PayLine;
import lk.shalom.receipts.service.TeacherService.SlotState;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TeacherServiceTest {

    static final ZoneId SL = ZoneId.of("Asia/Colombo");
    // the academy, and a point about 60 m away
    static final double LAT = 6.9271, LNG = 79.8612;

    @TempDir
    Path dir;

    TeacherService at(String localDateTime) {
        Clock c = Clock.fixed(LocalDateTime.parse(localDateTime).atZone(SL).toInstant(), SL);
        return new TeacherService(new JsonTeacherRepository(JsonMapper.builder().build(), dir.toString()), c);
    }

    @Test
    void payPeriodsRunFromThe26thToThe25th() {
        assertThat(TeacherService.periodOf(LocalDate.parse("2026-10-25"))).isEqualTo("2026-10");
        assertThat(TeacherService.periodOf(LocalDate.parse("2026-10-26"))).isEqualTo("2026-11");
        assertThat(TeacherService.periodOf(LocalDate.parse("2026-12-30"))).isEqualTo("2027-01");
        assertThat(TeacherService.periodStart("2026-10")).isEqualTo(LocalDate.parse("2026-09-26"));
        assertThat(TeacherService.periodEnd("2026-10")).isEqualTo(LocalDate.parse("2026-10-25"));
    }

    @Test
    void salaryIsWeekdayAndWeekendClassesPlusTransportPlusAdjustment_likeTheWorkbook() {
        TeacherService s = at("2026-11-04T10:00");
        // Wednesday 28 Oct and Thursday 29 Oct are weekdays; Saturday 31 Oct a weekend
        s.setMark("2026-10-28", "wed-1530-kids", "ijini", true);
        s.setMark("2026-10-29", "thu-1530-youth", "ijini", true);
        s.setMark("2026-10-31", "sat-0930-youth", "ijini", true);
        s.setMark("2026-10-31", "sat-0930-youth", "patali", true);   // two teachers in one class: both paid
        s.setAdjustment("2026-11", "patali", new BigDecimal("-500"), "advance");

        PayLine ijini = line(s, "ijini"), patali = line(s, "patali"), amaya = line(s, "amaya");
        assertThat(ijini.weekday()).isEqualTo(2);
        assertThat(ijini.weekend()).isEqualTo(1);
        assertThat(ijini.total()).isEqualByComparingTo("7000");          // 2×700 + 1×600 + 5000
        assertThat(patali.total()).isEqualByComparingTo("5100");         // 600 + 5000 − 500
        assertThat(amaya.total()).isEqualByComparingTo("0");             // no class, no transport
        assertThat(s.salary("2026-11").total()).isEqualByComparingTo("12100");
    }

    @Test
    void aClassOffHolidayCannotBeTickedAndNeverCounts() {
        TeacherService s = at("2026-12-20T10:00");
        assertThatThrownBy(() -> s.setMark("2026-12-25", "fri-1530-junior", "ijini", true))
                .hasMessageContaining("Christmas Day");
        // a holiday with classes as usual (a Poya) counts normally
        s.setMark("2026-12-23", "wed-1530-kids", "ijini", true);
        assertThat(line(s, "ijini").weekday()).isEqualTo(1);
    }

    @Test
    void markingNeedsTheTeacherAtTheAcademyAndOpensShortlyBeforeTheClass() {
        TeacherService s = at("2026-11-04T15:00");   // Wednesday; Kids 1 is at 3:30 PM
        s.saveSetup(new TeacherService.SetupInput(null, null, null, new Site(LAT, LNG, 150, 45, 15)));

        assertThatThrownBy(() -> s.checkIn("ijini", new CheckIn("wed-1530-kids", 6.95, 79.86, 20.0)))
                .hasMessageContaining("km from the academy");
        assertThatThrownBy(() -> s.checkIn("ijini", new CheckIn("wed-1800-junior", LAT, LNG, 10.0)))
                .hasMessageContaining("not on today's timetable");
        assertThatThrownBy(() -> s.checkIn("ijini", new CheckIn("wed-1815-adult", LAT, LNG, 10.0)))
                .hasMessageContaining("opens at 5:30 PM");

        s.checkIn("ijini", new CheckIn("wed-1530-kids", LAT + 0.0005, LNG, 15.0));   // ~55 m away
        assertThat(state(s, "wed-1530-kids")).isEqualTo(SlotState.COMPLETE);
        // marking twice keeps one mark
        s.checkIn("ijini", new CheckIn("wed-1530-kids", LAT, LNG, 15.0));
        assertThat(line(s, "ijini").weekday()).isEqualTo(1);
    }

    @Test
    void aClassCanBeMarkedAnyTimeLaterThatDayAndCountsAsTaught() {
        TeacherService s = at("2026-11-04T21:30");   // Kids 1 ended at 4:30 PM
        s.saveSetup(new TeacherService.SetupInput(null, null, null, new Site(LAT, LNG, 150, 45, 15)));
        s.checkIn("ijini", new CheckIn("wed-1530-kids", LAT, LNG, 10.0));
        assertThat(state(s, "wed-1530-kids")).isEqualTo(SlotState.COMPLETE);
        var who = s.sheet("2026-11").days().stream().filter(d -> d.date().equals("2026-11-04")).findFirst().orElseThrow()
                .classes().stream().filter(c -> c.slot().id().equals("wed-1530-kids")).findFirst().orElseThrow().teachers().getFirst();
        assertThat(who.finished()).isTrue();
        assertThat(line(s, "ijini").weekday()).isEqualTo(1);
    }

    @Test
    void aTeacherCanTakeBackTheirOwnMarkTheSameDay() {
        TeacherService s = at("2026-11-04T16:00");
        s.saveSetup(new TeacherService.SetupInput(null, null, null, new Site(LAT, LNG, 150, 45, 15)));
        s.checkIn("ijini", new CheckIn("wed-1530-kids", LAT, LNG, 10.0));
        s.unmark("ijini", new Unmark("wed-1530-kids"));
        assertThat(state(s, "wed-1530-kids")).isEqualTo(SlotState.OPEN);
        assertThat(line(s, "ijini").weekday()).isEqualTo(0);
        // and mark it again
        s.checkIn("ijini", new CheckIn("wed-1530-kids", LAT, LNG, 10.0));
        assertThat(line(s, "ijini").weekday()).isEqualTo(1);

        // the office's tick stays with the office
        s.setMark("2026-11-04", "wed-1700-junior", "ijini", true);
        assertThatThrownBy(() -> s.unmark("ijini", new Unmark("wed-1700-junior")))
                .hasMessageContaining("office marked");
        // once the period is paid, changes go through the office
        s.setPaid("2026-11", "ijini", true);
        assertThatThrownBy(() -> s.unmark("ijini", new Unmark("wed-1530-kids")))
                .hasMessageContaining("already been paid");
    }

    private static SlotState state(TeacherService s, String slot) {
        return s.me("ijini").today().stream().filter(c -> c.slot().id().equals(slot)).findFirst().orElseThrow().state();
    }

    @Test
    void aTeacherSignsInWithTheirPinAndANewPinEndsTheOldSignIn() {
        TeacherService s = at("2026-11-04T10:00");
        String pin = s.setPin("amaya", "4321");
        assertThat(s.checkPin("amaya", pin)).isPresent();
        assertThat(s.checkPin("amaya", "0000")).isEmpty();
        assertThat(s.signInList()).extracting(m -> m.get("name")).containsExactly("Amaya");

        AuthService auth = new AuthService("office-pass", dir.toString());
        String token = auth.issueTeacherToken("amaya", s.pinStamp("amaya").orElseThrow());
        assertThat(auth.principal(token).teacherId()).isEqualTo("amaya");
        assertThat(auth.principal(token).admin()).isFalse();
        assertThat(auth.principal(token + "x")).isNull();

        s.setPin("amaya", "9999");
        assertThat(s.pinStamp("amaya")).isNotEqualTo(java.util.Optional.of(auth.principal(token).pinStamp()));
    }

    private static PayLine line(TeacherService s, String id) {
        List<PayLine> lines = s.salary(TeacherService.periodOf(s.today())).lines();
        return lines.stream().filter(l -> l.teacherId().equals(id)).findFirst().orElseThrow();
    }
}
