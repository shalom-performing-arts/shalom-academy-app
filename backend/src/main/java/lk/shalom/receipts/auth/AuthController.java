package lk.shalom.receipts.auth;

import jakarta.servlet.http.HttpServletRequest;
import lk.shalom.receipts.model.TeacherBook.Teacher;
import lk.shalom.receipts.service.ApiException;
import lk.shalom.receipts.service.TeacherService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final LoginThrottle throttle;
    private final TeacherService teachers;

    public AuthController(AuthService auth, LoginThrottle throttle, TeacherService teachers) {
        this.auth = auth;
        this.throttle = throttle;
        this.teachers = teachers;
    }

    public record TeacherLogin(String teacherId, String pin) {}

    public record TeacherLoginResponse(String token, String teacherId, String name) {}

    public record LoginRequest(String password) {}

    public record LoginResponse(String token) {}

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest body, HttpServletRequest request) throws InterruptedException {
        String address = request.getRemoteAddr();
        long wait = throttle.waitFor(address).toSeconds();
        if (wait > 0) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "Too many wrong passwords. Try again in " + Math.max(1, (wait + 59) / 60) + " minute(s).");
        }
        if (body == null || !auth.checkPassword(body.password())) {
            throttle.failed(address);
            Thread.sleep(600);   // makes guessing slow even before the lockout
            throw new ApiException(HttpStatus.UNAUTHORIZED, "That password is not right.");
        }
        throttle.succeeded(address);
        return new LoginResponse(auth.issueToken());
    }

    /** A teacher signs in with their name and PIN, to check in from their phone. */
    @PostMapping("/teacher")
    public TeacherLoginResponse teacher(@RequestBody TeacherLogin body, HttpServletRequest request) throws InterruptedException {
        String address = request.getRemoteAddr();
        long wait = throttle.waitFor(address).toSeconds();
        if (wait > 0) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "Too many wrong PINs. Try again in " + Math.max(1, (wait + 59) / 60) + " minute(s).");
        }
        Optional<Teacher> t = body == null ? Optional.empty() : teachers.checkPin(body.teacherId(), body.pin());
        if (t.isEmpty()) {
            throttle.failed(address);
            Thread.sleep(600);   // makes guessing slow even before the lockout
            throw new ApiException(HttpStatus.UNAUTHORIZED, "That PIN is not right.");
        }
        throttle.succeeded(address);
        String stamp = teachers.pinStamp(t.get().id()).orElseThrow();
        return new TeacherLoginResponse(auth.issueTeacherToken(t.get().id(), stamp), t.get().id(), t.get().name());
    }

    /** The teachers who can sign in, for the list on the sign-in screen. Names only. */
    @GetMapping("/teachers")
    public List<Map<String, String>> teacherNames() {
        return teachers.signInList();
    }

    /** Lets the app check a saved sign-in is still good, and whose it is. The interceptor does the checking. */
    @GetMapping("/check")
    public Map<String, Object> check(HttpServletRequest request) {
        Object teacher = request.getAttribute(AuthInterceptor.TEACHER);
        return teacher == null ? Map.of("ok", true, "role", "office")
                : Map.of("ok", true, "role", "teacher", "teacherId", teacher);
    }
}
