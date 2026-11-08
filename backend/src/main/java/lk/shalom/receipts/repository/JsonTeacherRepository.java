package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.TeacherBook;
import lk.shalom.receipts.model.TeacherBook.Holiday;
import lk.shalom.receipts.model.TeacherBook.Slot;
import lk.shalom.receipts.model.TeacherBook.Teacher;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.UnaryOperator;

/**
 * Keeps teachers, their attendance and salary in data/teachers.json.
 *
 * <p>The first time it runs it is filled from the academy's attendance workbook
 * (teacher-attendance-salary-v2.xlsx): the three teachers, the weekly timetable, the rates and
 * the holidays. PINs are not set, so nobody can check in until the office gives each teacher one.
 */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonTeacherRepository implements TeacherRepository {

    private final JsonFile<TeacherBook> file;
    private TeacherBook current;

    public JsonTeacherRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        Path path = Path.of(dataDir, "teachers.json");
        this.file = new JsonFile<>(mapper, path, new TypeReference<>() {}, TeacherBook::empty);
        boolean fresh = !Files.exists(path);
        this.current = fresh ? fromWorkbook() : file.read().clean();
        if (fresh) file.write(current);
    }

    @Override
    public synchronized TeacherBook get() {
        return current;
    }

    /** Applies a change and saves it, as one step, so two phones checking in at once cannot clash. */
    @Override
    public synchronized TeacherBook update(UnaryOperator<TeacherBook> change) {
        current = change.apply(current).clean();
        file.write(current);
        return current;
    }

    /* ---------------- the starting point, from the workbook ---------------- */

    static TeacherBook fromWorkbook() {
        TeacherBook b = TeacherBook.empty();
        b.teachers().addAll(List.of(
                new Teacher("ijini", "Ijini", "", "#e8457c", true, null, null),
                new Teacher("patali", "Patali", "", "#3567e8", true, null, null),
                new Teacher("amaya", "Amaya", "", "#0f9f6e", true, null, null)));
        b.schedule().addAll(timetable());
        b.holidays().addAll(List.of(
                new Holiday("2026-10-25", "Vap Full Moon Poya Day", false),
                new Holiday("2026-11-08", "Deepawali Festival Day", false),
                new Holiday("2026-11-24", "Ill Full Moon Poya Day", false),
                new Holiday("2026-12-23", "Unduwap Full Moon Poya Day", false),
                new Holiday("2026-12-25", "Christmas Day", true),
                new Holiday("2027-01-15", "Tamil Thai Pongal Day", true),
                new Holiday("2027-01-22", "Duruthu Full Moon Poya Day", false),
                new Holiday("2027-02-04", "Independence Day", true),
                new Holiday("2027-02-20", "Navam Full Moon Poya Day", false),
                new Holiday("2027-03-06", "Mahasivarathri Day", false),
                new Holiday("2027-03-10", "Eid-Ul-Fitr", false),
                new Holiday("2027-03-22", "Medin Full Moon Poya Day", false),
                new Holiday("2027-03-26", "Good Friday", false)));
        return b.clean();
    }

    /** The 16 classes a week from the workbook. Ids are stable so imported ticks find their class. */
    static List<Slot> timetable() {
        List<Slot> out = new ArrayList<>();
        Object[][] rows = {
                {"Wednesday", "15:30", "Kids", "Kids 1"}, {"Wednesday", "17:00", "Junior", "Junior 2"}, {"Wednesday", "18:15", "Adult", "Adult 3"},
                {"Thursday", "15:30", "Youth", "Youth 1"}, {"Thursday", "17:00", "Kids", "Kids 2"},
                {"Friday", "15:30", "Junior", "Junior 1"}, {"Friday", "17:00", "Youth", "Youth 2"},
                {"Saturday", "09:30", "Youth", "Youth 1"}, {"Saturday", "11:30", "Kids", "Kids 2"},
                {"Saturday", "15:00", "Kids", "Kids 3"}, {"Saturday", "16:30", "Junior", "Junior 4"},
                {"Sunday", "09:30", "Choir", "Choir 1"}, {"Sunday", "11:00", "Kids", "Kids 2"}, {"Sunday", "12:30", "Kids", "Kids 3"},
                {"Sunday", "15:00", "Youth", "Youth 4"}, {"Sunday", "17:00", "Junior", "Junior 5"},
        };
        for (Object[] r : rows) {
            String day = (String) r[0], start = (String) r[1], cat = (String) r[2];
            String id = day.substring(0, 3).toLowerCase() + "-" + start.replace(":", "") + "-" + cat.toLowerCase();
            out.add(new Slot(id, day, start, 60, cat, (String) r[3]));
        }
        return out;
    }
}
