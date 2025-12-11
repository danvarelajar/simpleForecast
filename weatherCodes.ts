/**
 * Weather code mapping based on WMO Weather interpretation codes
 * Maps numeric codes from Open-Meteo API to human-readable strings
 */
export const weatherCodeMap: Record<number, string> = {
  // Clear sky
  0: "Clear",
  
  // Mainly clear, partly cloudy, and overcast
  1: "Mainly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  
  // Fog and depositing rime fog
  45: "Foggy",
  48: "Depositing Rime Fog",
  
  // Drizzle
  51: "Light Drizzle",
  53: "Moderate Drizzle",
  55: "Dense Drizzle",
  56: "Light Freezing Drizzle",
  57: "Dense Freezing Drizzle",
  
  // Rain
  61: "Slight Rain",
  63: "Moderate Rain",
  65: "Heavy Rain",
  66: "Light Freezing Rain",
  67: "Heavy Freezing Rain",
  
  // Snow fall
  71: "Slight Snow Fall",
  73: "Moderate Snow Fall",
  75: "Heavy Snow Fall",
  77: "Snow Grains",
  
  // Rain showers
  80: "Slight Rain Showers",
  81: "Moderate Rain Showers",
  82: "Violent Rain Showers",
  85: "Slight Snow Showers",
  86: "Heavy Snow Showers",
  
  // Thunderstorm
  95: "Thunderstorm",
  96: "Thunderstorm with Slight Hail",
  99: "Thunderstorm with Heavy Hail",
};

/**
 * Converts a numeric weather code to a human-readable string
 * @param code - The numeric weather code from Open-Meteo API
 * @returns Human-readable weather description
 */
export function translateWeatherCode(code: number): string {
  return weatherCodeMap[code] || "Unknown";
}

