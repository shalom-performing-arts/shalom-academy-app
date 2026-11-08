package lk.shalom.receipts;

import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class ReceiptsApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(ReceiptsApiApplication.class, args);
	}

	/**
	 * {@code --app.import-only=true}: start, let the JSON files be copied into the database (that
	 * happens while starting up), then stop. Used once, from the office computer, to fill the
	 * cloud database — see import-to-cloud.ps1.
	 */
	@Bean
	@ConditionalOnProperty(name = "app.import-only", havingValue = "true")
	ApplicationRunner importOnly(ApplicationContext context) {
		return args -> {
			System.out.println("Import finished. Stopping.");
			System.exit(SpringApplication.exit(context, () -> 0));
		};
	}

}
