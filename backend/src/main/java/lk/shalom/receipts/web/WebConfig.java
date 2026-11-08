package lk.shalom.receipts.web;

import lk.shalom.receipts.auth.AuthInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final String[] origins;
    private final AuthInterceptor auth;

    public WebConfig(@Value("${app.cors-origins}") String[] origins, AuthInterceptor auth) {
        this.origins = origins;
        this.auth = auth;
    }

    /** Everything under /api needs a sign-in, except signing in and the registration form. */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(auth)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/auth/login", "/api/auth/teacher", "/api/auth/teachers",
                        "/api/public/register/**");   // the parents' registration form
    }

    /**
     * Lets the Angular app call the API from another origin. In development the Angular dev
     * server proxies /api, so this only matters when the frontend is hosted separately.
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(origins)
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowedHeaders("Authorization", "Content-Type")
                .exposedHeaders("Content-Disposition");
    }
}
