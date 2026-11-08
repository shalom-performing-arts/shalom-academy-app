# The whole app in one container, for Google Cloud Run:
# the website (Angular) is built, placed inside the backend (Spring Boot), and both are served
# from one address, so the website and its /api share one https origin.
#
#   gcloud run deploy  (see deploy-cloudrun.ps1)  builds this in Google Cloud Build;
#   Docker is not needed on the office computer.

# ---------- 1. the website ----------
FROM node:22-alpine AS site
WORKDIR /site
COPY frontend/package.json frontend/package-lock.json ./
# the lock file is made on Windows; Linux needs a few extra optional packages, so if the strict
# install finds them missing, fall back to a normal install that adds them
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build --configuration production

# ---------- 2. the backend, with the website inside ----------
FROM eclipse-temurin:21-jdk AS api
WORKDIR /api
COPY backend/.mvn .mvn
COPY backend/mvnw backend/pom.xml ./
RUN chmod +x mvnw
COPY backend/src src
COPY --from=site /site/dist/frontend/browser/ src/main/resources/static/
RUN ./mvnw -B -q -DskipTests package && cp target/receipts-api-*.jar app.jar

# ---------- 3. what runs ----------
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=api /api/app.jar /tmp/app.jar
# A small, quick-starting Java: Cloud Run starts the app when the first person arrives,
# so start-up time matters more than peak speed for one academy.
ENV JAVA_TOOL_OPTIONS="-XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:MaxRAMPercentage=75 -Xss512k -Djava.security.egd=file:/dev/urandom" \
    DATA_DIR=/tmp/data \
    TZ=Asia/Colombo
# Start-up cache (class data sharing): the app is unpacked and started once here, at build time,
# and the Java classes it loads are saved ready-made in app.jsa, so each real start skips that
# work. The trial start needs no database (file storage, no migrations) and stops as soon as the
# app is ready. If it ever fails, the app simply starts without the cache.
RUN java -Djarmode=tools -jar /tmp/app.jar extract --destination /app && rm /tmp/app.jar \
 && (APP_STORAGE=json DATA_DIR=/tmp/train java -XX:ArchiveClassesAtExit=app.jsa \
        -Dspring.context.exit=onRefresh -Dspring.flyway.enabled=false -jar app.jar \
     || echo "start-up cache skipped") \
 && rm -rf /tmp/train
EXPOSE 8080
CMD ["java", "-XX:SharedArchiveFile=app.jsa", "-Xshare:auto", "-jar", "app.jar"]
