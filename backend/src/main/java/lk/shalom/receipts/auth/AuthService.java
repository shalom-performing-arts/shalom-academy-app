package lk.shalom.receipts.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;

/**
 * One shared password for the whole app, and the sign-in tokens issued for it.
 *
 * <p>The password comes from {@code APP_PASSWORD} when that is set; otherwise from
 * {@code data/password.txt}, which is created with a random password on first start.
 *
 * <p>A token is {@code <expiry>.<signature>}, signed with a key derived from the password. It
 * needs no server-side storage, so a restart keeps everyone signed in, while changing the
 * password signs everyone out.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    static final Duration TOKEN_LIFETIME = Duration.ofDays(30);

    private final byte[] password;
    private final byte[] signingKey;
    private final Clock clock;

    @Autowired
    public AuthService(@Value("${app.password:}") String configured,
                       @Value("${app.data-dir}") String dataDir) {
        this(resolvePassword(configured, Path.of(dataDir, "password.txt")), Clock.systemUTC());
    }

    AuthService(String password, Clock clock) {
        this.password = password.getBytes(StandardCharsets.UTF_8);
        this.signingKey = sha256(("shalom-receipts-token|" + password).getBytes(StandardCharsets.UTF_8));
        this.clock = clock;
    }

    /** True when the given password is the app's password. Compared in constant time. */
    public boolean checkPassword(String attempt) {
        if (attempt == null) {
            return false;
        }
        return MessageDigest.isEqual(sha256(attempt.getBytes(StandardCharsets.UTF_8)), sha256(password));
    }

    public String issueToken() {
        long expires = clock.instant().plus(TOKEN_LIFETIME).getEpochSecond();
        return expires + "." + sign(String.valueOf(expires));
    }

    public boolean isValid(String token) {
        if (token == null) {
            return false;
        }
        int dot = token.indexOf('.');
        if (dot <= 0) {
            return false;
        }
        String expires = token.substring(0, dot);
        String signature = token.substring(dot + 1);
        try {
            if (Long.parseLong(expires) < clock.instant().getEpochSecond()) {
                return false;
            }
        } catch (NumberFormatException e) {
            return false;
        }
        return MessageDigest.isEqual(sign(expires).getBytes(StandardCharsets.US_ASCII),
                signature.getBytes(StandardCharsets.US_ASCII));
    }

    /** Who a token belongs to: the office (admin), or one teacher. */
    public record Principal(boolean admin, String teacherId, String pinStamp) {
        public static final Principal OFFICE = new Principal(true, null, null);
    }

    /**
     * A teacher's sign-in: {@code t~<teacherId>~<pinStamp>~<expiry>.<signature>}. The PIN stamp
     * changes with the PIN, so giving a teacher a new PIN signs out their old phone.
     */
    public String issueTeacherToken(String teacherId, String pinStamp) {
        long expires = clock.instant().plus(TOKEN_LIFETIME).getEpochSecond();
        String payload = "t~" + teacherId + "~" + pinStamp + "~" + expires;
        return payload + "." + sign(payload);
    }

    /** The owner of a valid token, or null. */
    public Principal principal(String token) {
        if (token == null) return null;
        if (!token.startsWith("t~")) return isValid(token) ? Principal.OFFICE : null;
        int dot = token.lastIndexOf('.');
        if (dot <= 0) return null;
        String payload = token.substring(0, dot);
        if (!MessageDigest.isEqual(sign(payload).getBytes(StandardCharsets.US_ASCII),
                token.substring(dot + 1).getBytes(StandardCharsets.US_ASCII))) return null;
        String[] parts = payload.split("~");
        if (parts.length != 4) return null;
        try {
            if (Long.parseLong(parts[3]) < clock.instant().getEpochSecond()) return null;
        } catch (NumberFormatException e) {
            return null;
        }
        return new Principal(false, parts[1], parts[2]);
    }

    private String sign(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
            byte[] sig = mac.doFinal(value.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(sig);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] sha256(byte[] in) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(in);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    static String resolvePassword(String configured, Path file) {
        if (configured != null && !configured.isBlank()) {
            log.info("Using the password from APP_PASSWORD.");
            return configured.trim();
        }
        try {
            if (Files.exists(file)) {
                String saved = Files.readString(file, StandardCharsets.UTF_8).trim();
                if (!saved.isEmpty()) {
                    log.info("Using the password from {}.", file.toAbsolutePath());
                    return saved;
                }
            }
            String generated = randomPassword();
            Files.createDirectories(file.toAbsolutePath().getParent());
            Files.writeString(file, generated + System.lineSeparator(), StandardCharsets.UTF_8);
            log.warn("No password was set, so one was created: {}  (saved in {}; edit that file or set "
                    + "APP_PASSWORD to change it)", generated, file.toAbsolutePath());
            return generated;
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read or create " + file, e);
        }
    }

    /** 12 characters without look-alikes (0/O, 1/l/I), easy to read out over the phone. */
    private static String randomPassword() {
        String alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 12; i++) {
            if (i > 0 && i % 4 == 0) {
                sb.append('-');
            }
            sb.append(alphabet.charAt(rnd.nextInt(alphabet.length())));
        }
        return sb.toString();
    }
}
