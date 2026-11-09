import { db } from "../db";
import { globalAirports } from "../data/airports";

type Coordinates = { lat: number; lon: number };

type OpenWeatherResponse = {
  name?: string;
  weather?: Array<{ id: number; main: string; description: string }>;
  main?: { temp?: number };
  wind?: { speed?: number; gust?: number };
  visibility?: number;
  clouds?: { all?: number };
  dt?: number;
};

function parseCoordinates(value: string): Coordinates | null {
  const parts = value.split(",");
  if (parts.length !== 2) return null;

  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 || lat > 90 ||
    lon < -180 || lon > 180
  ) {
    return null;
  }

  return { lat, lon };
}

async function resolveAirportCoordinates(
  airportCode: string,
  weatherStationId: string | null | undefined,
  apiKey: string
): Promise<Coordinates> {
  const location = (weatherStationId || airportCode).trim();
  const coordinates = parseCoordinates(location);
  if (coordinates) return coordinates;

  const normalizedCode = location.toUpperCase();
  const airport = globalAirports.find(item => item.code.toUpperCase() === normalizedCode)
    || globalAirports.find(item => item.code.toUpperCase() === airportCode.toUpperCase());

  if (airport) {
    return { lat: airport.lat, lon: airport.lng };
  }

  // Resolve unfamiliar airport/city names with OpenWeatherMap's geocoder.
  const geocodeUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
  geocodeUrl.searchParams.set("q", location);
  geocodeUrl.searchParams.set("limit", "1");
  geocodeUrl.searchParams.set("appid", apiKey);

  const response = await fetch(geocodeUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`OpenWeatherMap geocoding failed: ${response.status} ${response.statusText}`);
  }

  const results = await response.json() as Array<{ lat?: number; lon?: number }>;
  const result = results[0];

  if (
    !result ||
    typeof result.lat !== "number" ||
    typeof result.lon !== "number" ||
    !Number.isFinite(result.lat) ||
    !Number.isFinite(result.lon)
  ) {
    throw new Error(`Could not resolve weather coordinates for airport ${airportCode}.`);
  }

  return { lat: result.lat, lon: result.lon };
}

function calculateWeatherSeverity(data: OpenWeatherResponse): number {
  const windSpeed = data.wind?.speed;
  const temperature = data.main?.temp;

  if (typeof windSpeed !== "number" || typeof temperature !== "number") {
    throw new Error("OpenWeatherMap response is missing wind speed or temperature.");
  }

  // Demonstration-only indicator. These heuristic weights/thresholds are
  // not an aviation-approved weather model and must be validated before use.
  const windFactor = windSpeed < 5
    ? 0.1
    : Math.min(1, 0.1 + ((windSpeed - 5) / 25) * 0.9);

  let temperatureFactor = 0;
  if (temperature < -10) temperatureFactor = 1;
  else if (temperature < 0) temperatureFactor = (0 - temperature) / 10;
  else if (temperature > 40) temperatureFactor = 1;
  else if (temperature > 30) temperatureFactor = (temperature - 30) / 10;

  const conditionCode = data.weather?.[0]?.id ?? 0;
  let conditionFactor = 0.1;

  if (conditionCode >= 200 && conditionCode < 300) conditionFactor = 0.95;
  else if (conditionCode === 511) conditionFactor = 0.95;
  else if (conditionCode >= 500 && conditionCode < 600) {
    conditionFactor = conditionCode >= 502 || conditionCode >= 522 ? 0.9 : 0.65;
  } else if (conditionCode >= 600 && conditionCode < 700) {
    conditionFactor = 0.8;
  } else if ([711, 721, 731, 741, 751, 761, 762, 771, 781].includes(conditionCode)) {
    conditionFactor = 0.7;
  }

  let visibilityFactor = 0.1;
  if (typeof data.visibility === "number") {
    if (data.visibility < 1000) visibilityFactor = 0.95;
    else if (data.visibility < 3000) visibilityFactor = 0.75;
    else if (data.visibility < 5000) visibilityFactor = 0.55;
  } else {
    // Missing visibility is unknown, not evidence of good visibility.
    visibilityFactor = 0.4;
  }

  const windAndTemperature = (windFactor * 0.7) + (temperatureFactor * 0.3);
  return Math.min(1, Math.max(0.1, windAndTemperature, conditionFactor, visibilityFactor));
}

/**
 * Fetches current weather from OpenWeatherMap for an airport code.
 * Coordinates must be resolved from a configured station, known airport,
 * or geocoding result. It never substitutes weather from an unrelated city.
 */
export async function fetchWeatherSeverity(airportCode: string): Promise<{
  rawConditions: string;
  severityIndex: number;
  rawData: OpenWeatherResponse;
}> {
  const apiKey = process.env.OPENWEATHER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENWEATHER_API_KEY is not configured.");
  }

  const airport = await db.airportProfiles.findUnique({
    where: { code: airportCode },
    select: { weatherStationId: true },
  });

  const { lat, lon } = await resolveAirportCoordinates(
    airportCode,
    airport?.weatherStationId,
    apiKey
  );

  const weatherUrl = new URL("https://api.openweathermap.org/data/2.5/weather");
  weatherUrl.searchParams.set("lat", String(lat));
  weatherUrl.searchParams.set("lon", String(lon));
  weatherUrl.searchParams.set("appid", apiKey);
  weatherUrl.searchParams.set("units", "metric");

  const response = await fetch(weatherUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenWeatherMap request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const weatherData = await response.json() as OpenWeatherResponse;
  const windSpeed = weatherData.wind?.speed;
  const temperature = weatherData.main?.temp;
  const visibility = weatherData.visibility;
  const condition = weatherData.weather?.[0]?.description ?? "unknown conditions";

  if (typeof windSpeed !== "number" || typeof temperature !== "number") {
    throw new Error("OpenWeatherMap returned incomplete weather data.");
  }

  const severityIndex = calculateWeatherSeverity(weatherData);
  const visibilityText = typeof visibility === "number"
    ? `visibility ${(visibility / 1000).toFixed(1)} km`
    : "visibility unavailable";

  return {
    rawConditions: `Wind ${windSpeed} m/s, Temp ${temperature}°C, ${condition}, ${visibilityText}`,
    severityIndex,
    rawData: weatherData,
  };
}
