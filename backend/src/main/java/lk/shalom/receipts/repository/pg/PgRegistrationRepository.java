package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.RegistrationBook;
import lk.shalom.receipts.model.RegistrationBook.Form;
import lk.shalom.receipts.model.RegistrationBook.Registration;
import lk.shalom.receipts.repository.RegistrationRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.UnaryOperator;

/** Online registrations (the registrations table) and the public form (registration_form). */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgRegistrationRepository implements RegistrationRepository {

    private final Db db;
    private RegistrationBook current;

    public PgRegistrationRepository(Db db) {
        this.db = db;
    }

    @Override
    public synchronized RegistrationBook get() {
        if (current == null) {
            current = load();
            if (db.count("registration_form") == 0) db.inTx(() -> writeForm(current.form()));   // keep the link once made
        }
        return current;
    }

    @Override
    public synchronized RegistrationBook update(UnaryOperator<RegistrationBook> change) {
        RegistrationBook now = get();
        RegistrationBook before = new RegistrationBook(List.copyOf(now.items()), now.form());
        RegistrationBook after = change.apply(now).clean(RegistrationRepository.newToken());
        try {
            db.inTx(() -> write(before, after));
        } catch (RuntimeException e) {
            current = null;
            throw e;
        }
        current = after;
        return after;
    }

    private RegistrationBook load() {
        List<Form> forms = db.jdbc.query("select * from registration_form where id = 1", (rs, n) -> new Form(
                rs.getBoolean("open"), rs.getString("token"), rs.getString("title"), rs.getString("intro"),
                rs.getString("closed_message"), rs.getString("thanks")));
        List<Registration> items = db.jdbc.query("""
                select r.*, date_of_birth::text as dob from registrations r
                order by submitted_at nulls first, number""", (rs, n) -> new Registration(
                rs.getString("id"), rs.getString("number"), Db.instant(rs, "submitted_at"), rs.getString("submission_key"),
                rs.getString("child_name"), rs.getString("preferred_name"), rs.getString("dob"), rs.getString("gender"),
                rs.getString("school"), rs.getString("grade"), rs.getString("interest"), rs.getString("preferred_class"),
                Db.strings(rs, "preferred_days"), rs.getString("experience"), rs.getString("parent_name"),
                rs.getString("relation"), rs.getString("phone"), rs.getString("whatsapp"), rs.getString("email"),
                rs.getString("address"), rs.getString("emergency_name"), rs.getString("emergency_phone"),
                rs.getString("medical"), rs.getString("how_heard"), rs.getString("message"), Db.bool(rs, "photo_consent"),
                Db.bool(rs, "agreed"), rs.getString("admin_note"), rs.getString("student_id"), Db.instant(rs, "placed_at"),
                Db.instant(rs, "updated_at")));
        return new RegistrationBook(new ArrayList<>(items), forms.isEmpty() ? null : forms.getFirst())
                .clean(RegistrationRepository.newToken());
    }

    private void write(RegistrationBook before, RegistrationBook after) {
        if (!Objects.equals(before.form(), after.form()) || db.count("registration_form") == 0) writeForm(after.form());
        Db.Changes<Registration, String> c = Db.diff(before.items(), after.items(), Registration::id, false);
        for (String id : c.deletes()) db.jdbc.update("delete from registrations where id = ?", id);
        for (Db.At<Registration> at : c.upserts()) {
            Registration r = at.item();
            // a student removed since (or not in this database) is simply not linked
            String student = r.studentId() != null
                    && db.jdbc.queryForObject("select count(*) from students where id = ?", Integer.class, r.studentId()) > 0
                    ? r.studentId() : null;
            db.jdbc.update("""
                    insert into registrations (id, number, submitted_at, submission_key, child_name, preferred_name, date_of_birth,
                        gender, school, grade, interest, preferred_class, preferred_days, experience, parent_name, relation, phone,
                        whatsapp, email, address, emergency_name, emergency_phone, medical, how_heard, message, photo_consent,
                        agreed, admin_note, student_id, placed_at, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?::date, ?, ?, ?, ?, ?, ?::text[], ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (id) do update set number = excluded.number, submitted_at = excluded.submitted_at,
                        submission_key = excluded.submission_key, child_name = excluded.child_name,
                        preferred_name = excluded.preferred_name, date_of_birth = excluded.date_of_birth, gender = excluded.gender,
                        school = excluded.school, grade = excluded.grade, interest = excluded.interest,
                        preferred_class = excluded.preferred_class, preferred_days = excluded.preferred_days,
                        experience = excluded.experience, parent_name = excluded.parent_name, relation = excluded.relation,
                        phone = excluded.phone, whatsapp = excluded.whatsapp, email = excluded.email, address = excluded.address,
                        emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone,
                        medical = excluded.medical, how_heard = excluded.how_heard, message = excluded.message,
                        photo_consent = excluded.photo_consent, agreed = excluded.agreed, admin_note = excluded.admin_note,
                        student_id = excluded.student_id, placed_at = excluded.placed_at, updated_at = excluded.updated_at""",
                    r.id(), r.number(), Db.ts(r.submittedAt()), r.submissionKey(), r.childName(), r.preferredName(),
                    Db.blankToNull(r.dateOfBirth()), r.gender(), r.school(), r.grade(), r.interest(), r.preferredClass(),
                    Db.textArray(r.preferredDays()), r.experience(), r.parentName(), r.relation(), r.phone(), r.whatsapp(),
                    r.email(), r.address(), r.emergencyName(), r.emergencyPhone(), r.medical(), r.howHeard(), r.message(),
                    r.photoConsent(), r.agreed(), r.adminNote(), student, Db.ts(r.placedAt()), Db.ts(r.updatedAt()));
        }
    }

    private void writeForm(Form f) {
        db.jdbc.update("""
                insert into registration_form (id, open, token, title, intro, closed_message, thanks) values (1, ?, ?, ?, ?, ?, ?)
                on conflict (id) do update set open = excluded.open, token = excluded.token, title = excluded.title,
                    intro = excluded.intro, closed_message = excluded.closed_message, thanks = excluded.thanks""",
                f.open(), f.token(), f.title(), f.intro(), f.closedMessage(), f.thanks());
    }
}
