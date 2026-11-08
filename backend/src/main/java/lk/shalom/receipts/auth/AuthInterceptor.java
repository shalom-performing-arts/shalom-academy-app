package lk.shalom.receipts.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lk.shalom.receipts.auth.AuthService.Principal;
import lk.shalom.receipts.service.TeacherService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Every /api call except signing in needs {@code Authorization: Bearer <token>}.
 *
 * <p>The office's token opens everything. A teacher's token opens only their own check-in
 * ({@code /api/me}), and stops working when the teacher is switched off or given a new PIN.
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    /** set on the request for a teacher's calls: their id */
    public static final String TEACHER = "teacherId";

    private final AuthService auth;
    private final TeacherService teachers;

    public AuthInterceptor(AuthService auth, TeacherService teachers) {
        this.auth = auth;
        this.teachers = teachers;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if ("OPTIONS".equals(request.getMethod())) {
            return true;   // CORS preflight carries no credentials
        }
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        String token = header != null && header.startsWith("Bearer ") ? header.substring(7).trim() : null;
        Principal who = auth.principal(token);
        if (who == null) {
            return refuse(response, HttpServletResponse.SC_UNAUTHORIZED, "Please sign in.");
        }
        if (who.admin()) {
            return true;
        }
        if (!teachers.pinStamp(who.teacherId()).map(s -> s.equals(who.pinStamp())).orElse(false)) {
            return refuse(response, HttpServletResponse.SC_UNAUTHORIZED, "Please sign in again.");
        }
        String path = request.getRequestURI();
        if (path.startsWith("/api/me") || path.equals("/api/auth/check")) {
            request.setAttribute(TEACHER, who.teacherId());
            return true;
        }
        return refuse(response, HttpServletResponse.SC_FORBIDDEN, "This part of the app is for the office.");
    }

    private static boolean refuse(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"message\":\"" + message + "\"}");
        return false;
    }
}
