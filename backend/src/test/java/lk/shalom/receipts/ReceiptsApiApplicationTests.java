package lk.shalom.receipts;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** The app starts. On the JSON files, so it needs no database; the database is tested in repository/pg. */
@SpringBootTest(properties = { "app.data-dir=target/test-data/context", "app.password=test-password" })
@ActiveProfiles("json")
class ReceiptsApiApplicationTests {

	@Test
	void contextLoads() {
	}

}
