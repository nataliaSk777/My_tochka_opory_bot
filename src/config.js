function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Не задана обязательная переменная окружения: ${name}`
    );
  }

  return value;
}

export const config = {
  botToken: requireEnv("BOT_TOKEN"),
  databaseUrl: requireEnv("DATABASE_URL"),
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "production"
};
