package lk.shalom.receipts.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.regex.Pattern;

/**
 * How long browsers may keep the website's files, so a second visit opens without downloading
 * the app again:
 * <ul>
 *   <li>the built code ({@code main-2JVQVD33.js}, {@code styles-AB12CD34.css}): a year. Its name
 *       changes whenever its content does, so a new version is never missed;</li>
 *   <li>the page itself and app addresses (/payments …): always checked, so a deploy shows at once;</li>
 *   <li>pictures, fonts and icons: a day.</li>
 * </ul>
 * The API is not touched: its answers are never kept.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class StaticCacheHeaders extends OncePerRequestFilter {

    private static final Pattern HASHED = Pattern.compile(".*-[A-Z0-9]{8}\\.(js|css)$");

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !"GET".equals(request.getMethod()) || path.startsWith("/api/") || path.equals("/api");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        String last = path.substring(path.lastIndexOf('/') + 1);
        if (HASHED.matcher(path).matches()) {
            response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (last.isEmpty() || !last.contains(".") || last.endsWith(".html")) {
            response.setHeader("Cache-Control", "no-cache");
        } else {
            response.setHeader("Cache-Control", "public, max-age=86400");
        }
        chain.doFilter(request, response);
    }
}
