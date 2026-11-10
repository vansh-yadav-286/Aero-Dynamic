import { db } from "./db";

/**
 * Gets a configuration value from the SystemConfig table, falling back to a default value.
 */
export async function getSystemConfig(key: string, defaultValue: string): Promise<string> {
  try {
    const config = await db.systemConfig.findUnique({
      where: { key },
    });
    return config ? config.value : defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Retrieves the system-wide safety/risk threshold on a 0–10 scale.
 */
export async function getRiskThreshold(): Promise<number> {
  const valueStr = await getSystemConfig("RISK_THRESHOLD", "7.5");
  const parsed = Number(valueStr);

  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 7.5;
}
