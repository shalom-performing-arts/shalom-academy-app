package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Category;
import lk.shalom.receipts.model.Roster.SessionInput;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;

import java.util.List;
import java.util.Map;

/** Students, sessions and class fees. */
public interface RosterRepository {

    /** Reads the roster afresh, so a hand-edited students.json shows up without a restart. */
    Roster load();

    /** Adds a student and gives them the next academy number. */
    Student create(StudentInput input);

    Student update(String id, StudentInput input);

    boolean delete(String id);

    /** Adds or changes a session; {@code input.rename()} renames it, taking its students along. */
    Roster.Session saveSession(SessionInput input, boolean create);

    boolean deleteSession(String name);

    /** Replaces the classes, in this order. A class with {@code from} set is a rename. */
    List<Category> saveCategories(List<Roster.CategoryInput> categories);

    /** The whole file as stored, for backups. */
    Map<String, Object> raw();

    void replaceRaw(Map<String, Object> raw);
}
