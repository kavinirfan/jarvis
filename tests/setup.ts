// Tests never use real credentials or services: mock AI + mock search, in-memory Postgres.
process.env.JARVIS_PROVIDER_MODE = "mock";
process.env.GEMINI_API_KEY = "";
process.env.TAVILY_API_KEY = "";
process.env.BRAVE_SEARCH_API_KEY = "";
process.env.DATABASE_URL = "";
