package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.TeacherBook;

import java.util.function.UnaryOperator;

/** Teachers, the timetable, their attendance and salary. */
public interface TeacherRepository {

    TeacherBook get();

    /** Applies a change and saves it as one step, so two people changing it at once cannot overwrite each other. */
    TeacherBook update(UnaryOperator<TeacherBook> change);
}
