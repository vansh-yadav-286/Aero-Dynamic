import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/db", () => ({
  db: {
    airportProfiles: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/data/airports", () => ({
  globalAirports: [{ code: "TST", lat: 10, lng: 20 }],
}));

import { db } from "../../src/lib/db";
import { fetchWeatherSeverity } from "../../src/lib/services/weather";

const mockedFindAirport = db.airportProfiles.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("OPENWEATHER_API_KEY", "test-weather-key");
  mockedFindAirport.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchWeatherSeverity", () => {
  test("uses OpenWeatherMap for the airport coordinates", async () => {
    mockedFindAirport.mockResolvedValue({ weatherStationId: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: "Test Airport",
      weather: [{ id: 800, main: "Clear", description: "clear sky" }],
      main: { temp: 18 },
      wind: { speed: 4 },
      visibility: 10000,
      clouds: { all: 5 },
      dt: 1700000000,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWeatherSeverity("TST");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.origin).toBe("https://api.openweathermap.org");
    expect(requestUrl.pathname).toBe("/data/2.5/weather");
    expect(requestUrl.searchParams.get("lat")).toBe("10");
    expect(requestUrl.searchParams.get("lon")).toBe("20");
    expect(requestUrl.searchParams.get("units")).toBe("metric");
    expect(requestUrl.searchParams.get("appid")).toBe("test-weather-key");
    expect(result.severityIndex).toBeGreaterThanOrEqual(0.1);
    expect(result.severityIndex).toBeLessThanOrEqual(1);
    expect(result.rawConditions).toContain("clear sky");
  });

  test("does not substitute an unrelated default location when geocoding fails", async () => {
    mockedFindAirport.mockResolvedValue({ weatherStationId: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWeatherSeverity("UNKNOWN")).rejects.toThrow(
      "Could not resolve weather coordinates for airport UNKNOWN."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fails when the OpenWeatherMap API key is missing", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "");

    await expect(fetchWeatherSeverity("TST")).rejects.toThrow(
      "OPENWEATHER_API_KEY is not configured."
    );
    expect(mockedFindAirport).not.toHaveBeenCalled();
  });
});
