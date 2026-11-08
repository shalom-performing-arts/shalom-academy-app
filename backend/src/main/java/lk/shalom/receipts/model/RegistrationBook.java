package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Online registrations, kept in data/registrations.json: the children parents registered through
 * the public form (the "registration pool"), and the form's own settings.
 *
 * <p>A registration is never a student by itself. It becomes one when the office places the
 * child in a class, which creates the student in students.json the usual way and links the two
 * through {@link Registration#studentId}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RegistrationBook(List<Registration> items, Form form) {

    /**
     * One child, as their parent filled in the form.
     *
     * @param number        the registration number given to the parent, e.g. REG-2026-0001
     * @param submissionKey sent by the form so a double tap on Submit saves only once
     * @param dateOfBirth   yyyy-MM-dd
     * @param interest      the course the parent picked, from the courses in Settings
     * @param preferredClass the class the parent thinks fits (Kids, Junior …); a wish, not a placement
     * @param studentId     set once the office places the child in a class
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Registration(
            String id,
            String number,
            Instant submittedAt,
            String submissionKey,
            String childName,
            String preferredName,
            String dateOfBirth,
            String gender,
            String school,
            String grade,
            String interest,
            String preferredClass,
            List<String> preferredDays,
            String experience,
            String parentName,
            String relation,
            String phone,
            String whatsapp,
            String email,
            String address,
            String emergencyName,
            String emergencyPhone,
            String medical,
            String howHeard,
            String message,
            Boolean photoConsent,
            Boolean agreed,
            String adminNote,
            String studentId,
            Instant placedAt,
            Instant updatedAt
    ) {
        public Registration placed(String student, Instant at) {
            return new Registration(id, number, submittedAt, submissionKey, childName, preferredName, dateOfBirth,
                    gender, school, grade, interest, preferredClass, preferredDays, experience, parentName, relation,
                    phone, whatsapp, email, address, emergencyName, emergencyPhone, medical, howHeard, message,
                    photoConsent, agreed, adminNote, student, at, updatedAt);
        }
    }

    /**
     * The public form.
     *
     * @param open   false stops new registrations; the link then shows {@code closedMessage}
     * @param token  the secret part of the public link; a new one retires the old link
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Form(boolean open, String token, String title, String intro, String closedMessage, String thanks) {

        public static final String TITLE = "Student Registration";
        public static final String INTRO = "Welcome! Please fill in this form to register your child at the academy. "
                + "It takes about 3 minutes. Fields marked * are required.";
        public static final String CLOSED = "Registrations are closed at the moment. "
                + "Please contact the academy and we will let you know when places open.";
        public static final String THANKS = "Thank you! We have received your registration. "
                + "We will contact you on WhatsApp to confirm a class and time.";

        public Form withDefaults(String freshToken) {
            return new Form(open, blank(token) ? freshToken : token, blank(title) ? TITLE : title,
                    blank(intro) ? INTRO : intro, blank(closedMessage) ? CLOSED : closedMessage,
                    blank(thanks) ? THANKS : thanks);
        }

        private static boolean blank(String s) {
            return s == null || s.isBlank();
        }
    }

    public static RegistrationBook empty() {
        return new RegistrationBook(new ArrayList<>(), new Form(true, null, null, null, null, null));
    }

    public RegistrationBook clean(String freshToken) {
        Form f = form == null ? new Form(true, null, null, null, null, null) : form;
        return new RegistrationBook(items == null ? new ArrayList<>() : new ArrayList<>(items), f.withDefaults(freshToken));
    }
}
