package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.RegistrationBook;

import java.util.function.UnaryOperator;

/** Online registrations and the public form. */
public interface RegistrationRepository {

    RegistrationBook get();

    /** Applies a change and saves it as one step, so two people changing it at once cannot overwrite each other. */
    RegistrationBook update(UnaryOperator<RegistrationBook> change);

    /** A hard-to-guess link part for the public form, such as "k7m2qx9atp4w". */
    static String newToken() {
        String alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
        java.security.SecureRandom random = new java.security.SecureRandom();
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 12; i++) b.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return b.toString();
    }
}
