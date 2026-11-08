package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Category;
import lk.shalom.receipts.model.Roster.Session;
import lk.shalom.receipts.model.Roster.SessionInput;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;
import lk.shalom.receipts.repository.PaymentRepository;
import lk.shalom.receipts.repository.RosterRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Adding, changing and moving students; sessions and class fees. The Students tab, in the app. */
@Service
public class StudentService {

    private final RosterRepository roster;
    private final PaymentRepository payments;
    private final MonthService months;

    public StudentService(RosterRepository roster, PaymentRepository payments, MonthService months) {
        this.roster = roster;
        this.payments = payments;
        this.months = months;
    }

    public Roster roster() {
        return roster.load();
    }

    public synchronized Student create(StudentInput in) {
        validate(in, null);
        Student s = roster.create(in);
        months.syncNewest();
        return s;
    }

    public synchronized Student update(String id, StudentInput in) {
        validate(in, id);
        Student s = roster.update(id, in);
        if (s == null) throw ApiException.notFound("No student with id " + id + ".");
        months.syncNewest();
        return s;
    }

    /** Only for a student entered by mistake. Anyone who has paid is set Inactive instead. */
    public synchronized void delete(String id) {
        if (payments.findAll().stream().anyMatch(p -> id.equals(p.studentId()))) {
            throw ApiException.conflict("This student has payments recorded, so they cannot be deleted. "
                    + "Set them to Inactive instead: their history stays and their fee stops.");
        }
        if (!roster.delete(id)) throw ApiException.notFound("No student with id " + id + ".");
        months.syncNewest();
    }

    public synchronized Session saveSession(SessionInput in, boolean create) {
        if (in == null || in.name() == null || in.name().isBlank()) throw ApiException.badRequest("Give the session a name.");
        Roster r = roster.load();
        boolean exists = r.sessions().stream().anyMatch(s -> s.name().equalsIgnoreCase(in.name().trim()));
        if (create && exists) throw ApiException.conflict("There is already a session called " + in.name().trim() + ".");
        if (!create && !exists) throw ApiException.notFound("No session called " + in.name() + ".");
        if (in.category() != null && !in.category().isBlank() && category(r, in.category()) == null) {
            throw ApiException.badRequest("No class called " + in.category() + ".");
        }
        if (in.max() != null && in.max() < 0) throw ApiException.badRequest("The class size cannot be negative.");
        String rename = in.rename() == null ? "" : in.rename().trim();
        boolean renaming = !create && !rename.isEmpty() && !rename.equalsIgnoreCase(in.name().trim());
        if (renaming && r.sessions().stream().anyMatch(s -> s.name().equalsIgnoreCase(rename))) {
            throw ApiException.conflict("There is already a session called " + rename + ".");
        }
        Session s = roster.saveSession(in, create);
        if (renaming) months.renameEverywhere("session", in.name().trim(), rename);
        months.syncNewest();
        return s;
    }

    /** Only once nobody active is in it; inactive students who were are left without a session. */
    public synchronized void deleteSession(String name) {
        Roster r = roster.load();
        long active = r.students().stream().filter(st -> st.active() && name.equalsIgnoreCase(st.session())).count();
        if (active > 0) {
            throw ApiException.conflict(active + " active student" + (active == 1 ? " is" : "s are") + " still in " + name
                    + ". Move them to another session first.");
        }
        if (!roster.deleteSession(name)) throw ApiException.notFound("No session called " + name + ".");
        months.syncNewest();
    }

    public synchronized List<Category> saveCategories(List<Roster.CategoryInput> in) {
        if (in == null || in.isEmpty()) throw ApiException.badRequest("There must be at least one class.");
        Set<String> seen = new HashSet<>();
        for (Roster.CategoryInput c : in) {
            if (c.name() == null || c.name().isBlank()) throw ApiException.badRequest("Every class needs a name.");
            if (!seen.add(c.name().trim().toLowerCase())) throw ApiException.badRequest("Two classes are called " + c.name() + ".");
            if (c.fee() != null && c.fee().signum() < 0) throw ApiException.badRequest("A fee cannot be negative.");
            String billing = c.billing() == null ? Category.MONTHLY : c.billing();
            if (!List.of(Category.MONTHLY, Category.TERM, Category.PAYG).contains(billing)) {
                throw ApiException.badRequest("Billing is monthly, per term, or pay as you go.");
            }
            if (Category.TERM.equals(billing) && (c.termMonths() == null || c.termMonths().isEmpty())) {
                throw ApiException.badRequest(c.name() + " is billed per term: pick the months the term fee is due.");
            }
            for (Roster.FeeChange f : c.changes() == null ? List.<Roster.FeeChange>of() : c.changes()) {
                MonthService.check(f.from());
                if (f.fee() == null || f.fee().signum() < 0) throw ApiException.badRequest("A new fee needs an amount.");
            }
        }
        Roster r = roster.load();
        for (Category old : r.categories()) {
            boolean kept = in.stream().anyMatch(c -> old.name().equalsIgnoreCase(c.from() != null && !c.from().isBlank()
                    ? c.from().trim() : c.name().trim()));
            boolean used = r.students().stream().anyMatch(s -> old.name().equalsIgnoreCase(s.category()))
                    || r.sessions().stream().anyMatch(s -> old.name().equalsIgnoreCase(s.category()));
            if (!kept && used) {
                throw ApiException.conflict(old.name() + " still has students or sessions, so it cannot be removed. "
                        + "Move them to another class first.");
            }
        }
        List<Category> out = roster.saveCategories(in);
        for (Roster.CategoryInput c : in) {
            if (c.from() != null && !c.from().isBlank() && !c.from().trim().equals(c.name().trim())) {
                months.renameEverywhere("category", c.from().trim(), c.name().trim());
            }
        }
        months.syncNewest();
        return out;
    }

    private void validate(StudentInput in, String id) {
        if (in == null || in.name() == null || in.name().isBlank()) throw ApiException.badRequest("Enter the student's name.");
        Roster r = roster.load();
        String name = in.name().trim();
        // names are how receipts find a student, so two the same would be ambiguous
        r.students().stream()
                .filter(s -> s.name().equalsIgnoreCase(name) && !s.id().equals(id))
                .findFirst().ifPresent(s -> {
                    throw ApiException.conflict("There is already a student called " + s.name() + " (" + s.id()
                            + "). Add something to tell them apart, such as a second name.");
                });
        if (in.category() == null || category(r, in.category()) == null) {
            throw ApiException.badRequest("Pick the class: " + String.join(", ",
                    r.categories().stream().map(Category::name).toList()) + ".");
        }
        if (in.session() != null && !in.session().isBlank()) {
            Session s = r.sessions().stream().filter(x -> x.name().equalsIgnoreCase(in.session().trim())).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("No session called " + in.session() + "."));
            if (!s.category().isEmpty() && !s.category().equalsIgnoreCase(in.category())) {
                throw ApiException.badRequest(s.name() + " is a " + s.category() + " session, not " + in.category() + ".");
            }
        }
        BigDecimal fee = in.specialFee();
        if (fee != null && fee.signum() < 0) throw ApiException.badRequest("A fee cannot be negative.");
        if (in.dateOfBirth() != null && !in.dateOfBirth().isBlank()) {
            try {
                java.time.LocalDate dob = java.time.LocalDate.parse(in.dateOfBirth().trim());
                if (dob.isAfter(java.time.LocalDate.now()) || dob.getYear() < 1920) {
                    throw ApiException.badRequest("Please check the date of birth.");
                }
            } catch (java.time.format.DateTimeParseException e) {
                throw ApiException.badRequest("Enter the date of birth as a date.");
            }
        }
    }

    private static Category category(Roster r, String name) {
        return r.categories().stream().filter(c -> c.name().equalsIgnoreCase(name.trim())).findFirst().orElse(null);
    }
}
