package lk.shalom.receipts.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class AuthServiceTest {

    static final Instant NOW = Instant.parse("2026-11-03T10:00:00Z");

    static AuthService at(String password, Instant now) {
        return new AuthService(password, Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test
    void checksThePassword() {
        AuthService auth = at("secret", NOW);
        assertThat(auth.checkPassword("secret")).isTrue();
        assertThat(auth.checkPassword("Secret")).isFalse();
        assertThat(auth.checkPassword("")).isFalse();
        assertThat(auth.checkPassword(null)).isFalse();
    }

    @Test
    void anIssuedTokenIsValidUntilItExpires() {
        String token = at("secret", NOW).issueToken();

        assertThat(at("secret", NOW.plus(Duration.ofDays(29))).isValid(token)).isTrue();
        assertThat(at("secret", NOW.plus(Duration.ofDays(31))).isValid(token)).isFalse();
    }

    @Test
    void changingThePasswordSignsEveryoneOut() {
        String token = at("secret", NOW).issueToken();
        assertThat(at("another", NOW).isValid(token)).isFalse();
    }

    @Test
    void aTamperedTokenIsRefused() {
        AuthService auth = at("secret", NOW);
        String token = auth.issueToken();
        String later = (Long.parseLong(token.substring(0, token.indexOf('.'))) + 999999) + token.substring(token.indexOf('.'));

        assertThat(auth.isValid(later)).isFalse();
        assertThat(auth.isValid("garbage")).isFalse();
        assertThat(auth.isValid(null)).isFalse();
    }

    @Test
    void createsAndThenReusesAPasswordFile(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("password.txt");

        String first = AuthService.resolvePassword("", file);
        String second = AuthService.resolvePassword(null, file);

        assertThat(first).hasSize(14).isEqualTo(second);
        assertThat(Files.readString(file).trim()).isEqualTo(first);
        assertThat(AuthService.resolvePassword("from-env", file)).isEqualTo("from-env");
    }

    @Test
    void locksOutAfterFiveWrongPasswords() {
        Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
        LoginThrottle throttle = new LoginThrottle(clock);
        for (int i = 0; i < LoginThrottle.MAX_FAILURES - 1; i++) {
            throttle.failed("1.2.3.4");
        }
        assertThat(throttle.waitFor("1.2.3.4")).isZero();

        throttle.failed("1.2.3.4");

        assertThat(throttle.waitFor("1.2.3.4")).isPositive();
        assertThat(throttle.waitFor("5.6.7.8")).isZero();
        assertThat(new LoginThrottle(Clock.offset(clock, Duration.ofMinutes(6))).waitFor("1.2.3.4")).isZero();
    }
}
