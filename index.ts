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

// Initialize Express app
const app = express();
app.use(express.json());

// Enable CORS for all origins
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
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
async function searchLocation(city: string): Promise<GeocodingResult[]> {
  try {
    const response = await axios.get<GeocodingResponse>(
      `https://geocoding-api.open-meteo.com/v1/search`,
      {
        params: {
          name: city,
          count: 5,
          language: "en",
          format: "json",
        },
      }
    );

    if (!response.data.results || response.data.results.length === 0) {
      return [];
    }

    return response.data.results.map((result) => ({
      name: result.name,
      country: result.country,
      lat: result.latitude,
      lon: result.longitude,
    }));
  } catch (error) {
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
  try {
    const response = await axios.get<WeatherApiResponse>(
      `https://api.open-meteo.com/v1/forecast`,
      {
        params: {
          latitude,
          longitude,
          current: "temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m",
          hourly: "temperature_2m,weather_code,precipitation_probability",
          daily: "weather_code,temperature_2m_max,temperature_2m_min",
          timezone: "auto",
          forecast_days: 7,
        },
      }
    );

    const { current, hourly, daily } = response.data;

    // Process current weather
    const currentWeather = {
      time: current.time,
      temperature: current.temperature_2m,
      weather: translateWeatherCode(current.weather_code),
      weather_code: current.weather_code,
      humidity: current.relative_humidity_2m,
      wind_speed: current.wind_speed_10m,
    };

    // Process next 12 hours
    const now = new Date(current.time);
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

    // Process next 7 days
    const next7Days = daily.time.slice(0, 7).map((time, index) => ({
      date: time,
      weather: translateWeatherCode(daily.weather_code[index]),
      weather_code: daily.weather_code[index],
      temperature_max: daily.temperature_2m_max[index],
      temperature_min: daily.temperature_2m_min[index],
    }));

    return {
      current: currentWeather,
      next_12_hours: next12Hours,
      next_7_days: next7Days,
    };
  } catch (error) {
    throw new Error("Weather data currently unavailable");
  }
}

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
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

  try {
    if (name === "search_location") {
      const validated = SearchLocationInputSchema.parse(args);
      const results = await searchLocation(validated.city);
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
      const validated = GetCompleteForecastInputSchema.parse(args);
      const forecast = await getCompleteForecast(
        validated.latitude,
        validated.longitude
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(forecast, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
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
app.get("/sse", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const transport = new SSEServerTransport("/messages", res);
  const transportId = `${Date.now()}-${Math.random()}`;
  activeTransports.set(transportId, transport);

  res.on("close", () => {
    activeTransports.delete(transportId);
  });

  await server.connect(transport);
});

// Messages endpoint for POST requests
app.post("/messages", async (req: Request, res: Response) => {
  try {
    // Find the appropriate transport (in a real scenario, you'd match by session ID)
    // For simplicity, we'll use the first active transport or create a new one
    const transport = activeTransports.values().next().value;
    
    if (transport) {
      // The transport will handle the message through the server
      res.json({ status: "ok" });
    } else {
      res.status(400).json({ error: "No active SSE connection" });
    }
  } catch (error) {
    res.status(500).json({ error: "Weather data currently unavailable" });
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Weather Forecast MCP Server running on port ${PORT}`);
  console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
  console.log(`Messages endpoint: http://0.0.0.0:${PORT}/messages`);
});

