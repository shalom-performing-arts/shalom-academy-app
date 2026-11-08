package lk.shalom.receipts.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * When the website is built into the backend (the Cloud Run container), its pages are served from
 * here too. A page address such as /payments or /register/abc123 is not a file: the browser app
 * handles it, so those requests get the app's index.html. API calls and real files pass through.
 *
 * <p>In development the website runs on its own (ng serve) and there is no index.html here, so
 * this does nothing.
 */
@Component
public class SpaFallback extends OncePerRequestFilter {

    private final boolean hasSite = new ClassPathResource("static/index.html").exists();

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!hasSite || !"GET".equals(request.getMethod())) return true;
        String path = request.getRequestURI();
        String last = path.substring(path.lastIndexOf('/') + 1);
        return path.startsWith("/api/") || path.equals("/api") || path.equals("/") || last.contains(".");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        request.getRequestDispatcher("/index.html").forward(request, response);
    }
}
