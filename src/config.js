function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Не задана обязательная переменная окружения: ${name}`);
  }

  return value.trim();
}

export const config = {
  botToken: requireEnvironmentVariable("BOT_TOKEN"),
  databaseUrl: requireEnvironmentVariable("DATABASE_URL"),
  nodeEnv: process.env.NODE_ENV || "production",
  port: Number.parseInt(process.env.PORT || "3000", 10),
  adminId: process.env.ADMIN_ID
    ? Number.parseInt(process.env.ADMIN_ID, 10)
    : null
};
