import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env — the catalogue and " +
      "compliance suites run against a real Postgres, by design.",
  );
}
