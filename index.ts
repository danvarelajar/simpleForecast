import express, { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { z } from "zod";
import { translateWeatherCode } from "./weatherCodes.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";
const MCP_API_KEY = process.env.MCP_API_KEY;
const REQUIRE_API_KEY =
  process.env.REQUIRE_API_KEY === "true" || process.env.REQUIRE_API_KEY === "1";

// Debug logging utility
function debugLog(...args: any[]): void {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[DEBUG ${timestamp}]`, ...args);
  }
}

function debugError(message: string, error: any): void {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.error(`[DEBUG ERROR ${timestamp}] ${message}`, error);
  }
}

function getClientApiKey(req: Request): string | undefined {
  const raw = req.header("x-api-key") ?? req.header("X-Api-Key");
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function requireApiKey(req: Request, res: Response, next: () => void): void {
  if (!REQUIRE_API_KEY) return next();

  // If REQUIRE_API_KEY is enabled but no key is configured, fail closed.
  if (!MCP_API_KEY) {
    debugError(
      `[AUTH] REQUIRE_API_KEY is enabled but MCP_API_KEY is not set. Rejecting request.`,
      { path: req.path, method: req.method }
    );
    res.status(500).type("text/plain").send("Server misconfigured (missing MCP_API_KEY)");
    return;
  }

  const provided = getClientApiKey(req);
  if (!provided || provided !== MCP_API_KEY) {
    debugLog(`[AUTH] Unauthorized request`, {
      method: req.method,
      path: req.path,
      ip: req.ip,
      hasKey: Boolean(provided),
    });
    res.status(401).type("text/plain").send("unauthorized");
    return;
  }

  next();
}

// Initialize Express app
const app = express();
app.use(express.json());

// Enable CORS for all origins
app.use((req, res, next) => {
  debugLog(`[CORS] ${req.method} ${req.path} from ${req.ip}`);
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Initialize MCP Server
const server = new Server(
  {
    name: "weather-forecast-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Zod schemas for tool inputs
const SearchLocationInputSchema = z.object({
  city: z.string().min(1, "City name is required"),
});

const GetCompleteForecastInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Geocoding API response type
interface GeocodingResult {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

// Location search result (what we return from searchLocation)
interface LocationSearchResult {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

// Weather API response types
interface CurrentWeather {
  time: string;
  temperature_2m: number;
  weather_code: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
}

interface HourlyWeather {
  time: string[];
  temperature_2m: number[];
  weather_code: number[];
  precipitation_probability: number[];
}

interface DailyWeather {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
}

interface WeatherApiResponse {
  current: CurrentWeather;
  hourly: HourlyWeather;
  daily: DailyWeather;
}

// Tool: search_location
async function searchLocation(city: string): Promise<LocationSearchResult[]> {
  debugLog(`[search_location] Starting search for city: "${city}"`);
  try {
    const apiUrl = `https://geocoding-api.open-meteo.com/v1/search`;
    const params = {
      name: city,
      count: 5,
      language: "en",
      format: "json",
    };
    debugLog(`[search_location] API Request:`, { url: apiUrl, params });

    const response = await axios.get<GeocodingResponse>(apiUrl, { params });
    debugLog(`[search_location] API Response status:`, response.status);
    debugLog(`[search_location] API Response data:`, JSON.stringify(response.data, null, 2));

    if (!response.data.results || response.data.results.length === 0) {
      debugLog(`[search_location] No results found for city: "${city}"`);
      return [];
    }

    const results = response.data.results.map((result) => ({
      name: result.name,
      country: result.country,
      lat: result.latitude,
      lon: result.longitude,
    }));
    debugLog(`[search_location] Found ${results.length} location(s):`, results);
    return results;
  } catch (error) {
    debugError(`[search_location] Error searching for city: "${city}"`, error);
    throw new Error("Weather data currently unavailable");
  }
}

// Tool: get_complete_forecast
async function getCompleteForecast(
  latitude: number,
  longitude: number
): Promise<{
  current: any;
  next_12_hours: any[];
  next_7_days: any[];
}> {
  debugLog(`[get_complete_forecast] Starting forecast request for coordinates:`, { latitude, longitude });
  try {
    const apiUrl = `https://api.open-meteo.com/v1/forecast`;
    const params = {
      latitude,
      longitude,
      current: "temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m",
      hourly: "temperature_2m,weather_code,precipitation_probability",
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
      forecast_days: 7,
    };
    debugLog(`[get_complete_forecast] API Request:`, { url: apiUrl, params });

    const response = await axios.get<WeatherApiResponse>(apiUrl, { params });
    debugLog(`[get_complete_forecast] API Response status:`, response.status);
    debugLog(`[get_complete_forecast] API Response headers:`, response.headers);

    const { current, hourly, daily } = response.data;
    debugLog(`[get_complete_forecast] Raw data received:`, {
      current_time: current.time,
      hourly_count: hourly.time.length,
      daily_count: daily.time.length,
    });

    // Process current weather
    const currentWeather = {
      time: current.time,
      temperature: current.temperature_2m,
      weather: translateWeatherCode(current.weather_code),
      weather_code: current.weather_code,
      humidity: current.relative_humidity_2m,
      wind_speed: current.wind_speed_10m,
    };
    debugLog(`[get_complete_forecast] Processed current weather:`, currentWeather);

    // Process next 12 hours
    const now = new Date(current.time);
    debugLog(`[get_complete_forecast] Current time: ${now.toISOString()}`);
    const next12Hours: any[] = [];
    
    for (let i = 0; i < hourly.time.length; i++) {
      const hourTime = new Date(hourly.time[i]);
      const hoursDiff = (hourTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursDiff >= 0 && hoursDiff < 12) {
        next12Hours.push({
          time: hourly.time[i],
          temperature: hourly.temperature_2m[i],
          weather: translateWeatherCode(hourly.weather_code[i]),
          weather_code: hourly.weather_code[i],
          precipitation_probability: hourly.precipitation_probability[i],
        });
      }
    }
    debugLog(`[get_complete_forecast] Processed ${next12Hours.length} hours for next 12h forecast`);

    // Process next 7 days
    const next7Days = daily.time.slice(0, 7).map((time, index) => ({
      date: time,
      weather: translateWeatherCode(daily.weather_code[index]),
      weather_code: daily.weather_code[index],
      temperature_max: daily.temperature_2m_max[index],
      temperature_min: daily.temperature_2m_min[index],
    }));
    debugLog(`[get_complete_forecast] Processed ${next7Days.length} days for 7-day forecast`);

    const result = {
      current: currentWeather,
      next_12_hours: next12Hours,
      next_7_days: next7Days,
    };
    debugLog(`[get_complete_forecast] Forecast processing complete`);
    return result;
  } catch (error) {
    debugError(`[get_complete_forecast] Error getting forecast for coordinates:`, { latitude, longitude, error });
    throw new Error("Weather data currently unavailable");
  }
}

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog(`[MCP] ListToolsRequest received`);
  return {
    tools: [
      {
        name: "search_location",
        description:
          "Search for locations by city name. Returns up to 5 matching locations with their coordinates.",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "The city name to search for",
            },
          },
          required: ["city"],
        },
      },
      {
        name: "get_complete_forecast",
        description:
          "Get complete weather forecast including current conditions, next 12 hours, and next 7 days for a specific location.",
        inputSchema: {
          type: "object",
          properties: {
            latitude: {
              type: "number",
              description: "Latitude coordinate (-90 to 90)",
            },
            longitude: {
              type: "number",
              description: "Longitude coordinate (-180 to 180)",
            },
          },
          required: ["latitude", "longitude"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  debugLog(`[MCP] CallToolRequest received:`, { tool: name, arguments: args });

  try {
    if (name === "search_location") {
      debugLog(`[MCP] Processing search_location tool`);
      const validated = SearchLocationInputSchema.parse(args);
      debugLog(`[MCP] Validated input:`, validated);
      const results = await searchLocation(validated.city);
      debugLog(`[MCP] search_location completed, returning ${results.length} result(s)`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    if (name === "get_complete_forecast") {
      debugLog(`[MCP] Processing get_complete_forecast tool`);
      const validated = GetCompleteForecastInputSchema.parse(args);
      debugLog(`[MCP] Validated input:`, validated);
      const forecast = await getCompleteForecast(
        validated.latitude,
        validated.longitude
      );
      debugLog(`[MCP] get_complete_forecast completed successfully`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(forecast, null, 2),
          },
        ],
      };
    }

    debugLog(`[MCP] Unknown tool requested: ${name}`);
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      debugError(`[MCP] Validation error for tool ${name}:`, error.errors);
      return {
        content: [
          {
            type: "text",
            text: `Invalid input: ${error.errors.map((e) => e.message).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const errorMessage =
      error instanceof Error ? error.message : "Weather data currently unavailable";
    debugError(`[MCP] Error processing tool ${name}:`, error);

    return {
      content: [
        {
          type: "text",
          text: errorMessage,
        },
      ],
      isError: true,
    };
  }
});

// Store active transports
const activeTransports = new Map<string, SSEServerTransport>();

// SSE endpoint
app.get("/sse", requireApiKey, async (req: Request, res: Response) => {
  debugLog(`[SSE] New SSE connection request from ${req.ip}`);
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  activeTransports.set(sessionId, transport);
  debugLog(
    `[SSE] SSE connection established, sessionId: ${sessionId}, active transports: ${activeTransports.size}`
  );

  // In debug mode, log all outbound messages sent over SSE so we can verify
  // whether responses (e.g. tools/list) are being emitted to the client.
  if (DEBUG) {
    const originalSend = transport.send.bind(transport);
    transport.send = async (message: any) => {
      debugLog(`[SSE -> client] Sending message`, { sessionId, message });
      return await originalSend(message);
    };
  }

  // Cleanup when the SSE connection closes.
  res.on("close", () => {
    activeTransports.delete(sessionId);
    debugLog(
      `[SSE] SSE connection closed, sessionId: ${sessionId}, remaining transports: ${activeTransports.size}`
    );
  });

  res.on("error", (error) => {
    debugError(`[SSE] SSE connection error for sessionId ${sessionId}:`, error);
  });

  await server.connect(transport); // connect() calls transport.start() internally
  debugLog(`[SSE] MCP server connected to sessionId ${sessionId}`);
});

// Messages endpoint for POST requests
app.post("/messages", requireApiKey, async (req: Request, res: Response) => {
  const sessionId =
    typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  debugLog(`[POST /messages] Received message from ${req.ip}`, {
    sessionId,
    body: req.body,
    headers: req.headers,
  });
  try {
    if (!sessionId) {
      debugLog(`[POST /messages] Missing sessionId query param`);
      res.status(400).type("text/plain").send("Missing sessionId");
      return;
    }

    const transport = activeTransports.get(sessionId);
    debugLog(`[POST /messages] Active transports: ${activeTransports.size}`);

    if (!transport) {
      debugLog(`[POST /messages] Unknown sessionId: ${sessionId}`);
      res.status(404).type("text/plain").send("Unknown sessionId");
      return;
    }

    // NOTE: express.json() already parsed the body; pass it to avoid re-reading the stream.
    await transport.handlePostMessage(req, res, req.body);
    debugLog(`[POST /messages] Message accepted for sessionId ${sessionId}`);
  } catch (error) {
    debugError(`[POST /messages] Error processing message:`, error);
    res.status(500).json({ error: "Weather data currently unavailable" });
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  debugLog(`[HEALTH] Health check requested from ${req.ip}`);
  res.json({ status: "ok" });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Weather Forecast MCP Server running on port ${PORT}`);
  console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
  console.log(`Messages endpoint: http://0.0.0.0:${PORT}/messages`);
  console.log(`Debug mode: ${DEBUG ? "ENABLED" : "DISABLED"}`);
  console.log(`API key required: ${REQUIRE_API_KEY ? "YES" : "NO"}`);
  if (DEBUG) {
    console.log(`[DEBUG] Debug logging is active - all operations will be logged`);
  }
});

