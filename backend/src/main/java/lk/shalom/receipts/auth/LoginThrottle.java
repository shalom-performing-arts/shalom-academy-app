package lk.shalom.receipts.auth;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Slows down password guessing: after {@value #MAX_FAILURES} wrong passwords from one address,
 * that address must wait {@link #LOCKOUT} before trying again.
 */
@Component
public class LoginThrottle {

    static final int MAX_FAILURES = 5;
    static final Duration LOCKOUT = Duration.ofMinutes(5);

    private record Failures(int count, Instant lastAt) {}

    private final Map<String, Failures> byAddress = new ConcurrentHashMap<>();
    private final Clock clock;

    @Autowired
    public LoginThrottle() {
        this(Clock.systemUTC());
    }

    LoginThrottle(Clock clock) {
        this.clock = clock;
    }

    /** How long this address must still wait, or zero when it may try. */
    public Duration waitFor(String address) {
        Failures f = byAddress.get(address);
        if (f == null || f.count() < MAX_FAILURES) {
            return Duration.ZERO;
        }
        Duration left = Duration.between(clock.instant(), f.lastAt().plus(LOCKOUT));
        if (left.isNegative() || left.isZero()) {
            byAddress.remove(address);
            return Duration.ZERO;
        }
        return left;
    }

    public void failed(String address) {
        byAddress.merge(address, new Failures(1, clock.instant()),
                (old, n) -> new Failures(old.count() + 1, n.lastAt()));
    }

    public void succeeded(String address) {
        byAddress.remove(address);
    }
}
