# Weather Forecast MCP Server

A production-ready Model Context Protocol (MCP) server that serves comprehensive Open-Meteo weather data via HTTP/SSE.

## Features

- **Current Weather**: Real-time temperature, weather conditions, humidity, and wind speed
- **Next 12 Hours**: Hourly forecast for the next 12 hours with precipitation probability
- **Next 7 Days**: Daily forecast with min/max temperatures and weather conditions
- **Location Search**: Search for cities worldwide and get their coordinates

## Quick Start with Docker Compose

### Prerequisites

- Docker
- Docker Compose

### Running the Server

1. Build and start the container:
```bash
docker-compose up -d
```

2. Check the logs:
```bash
docker-compose logs -f
```

3. Test the health endpoint:
```bash
curl http://localhost:3000/health
```

4. Stop the container:
```bash
docker-compose down
```

### Environment Variables

You can customize the port by setting the `PORT` environment variable:

```bash
PORT=8080 docker-compose up -d
```

#### Debug Mode

Enable detailed debug logging for troubleshooting LLM integrations:

```bash
DEBUG=true docker-compose up -d
```

Or set it in `docker-compose.yml`:
```yaml
environment:
  - DEBUG=true
```

When debug mode is enabled, the server will log:
- All incoming requests (SSE, POST, GET)
- Tool calls and their arguments
- API requests and responses
- Data processing steps
- Errors with full stack traces
- Connection lifecycle events

View debug logs:
```bash
docker-compose logs -f
```

## Development

### Local Development (without Docker)

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. Start the server:
```bash
npm start
```

Or run in development mode with auto-reload:
```bash
npm run dev
```

## API Endpoints

- `GET /sse` - SSE endpoint for MCP server connection
- `POST /messages` - Messages endpoint for MCP protocol
- `GET /health` - Health check endpoint

## MCP Tools

### search_location

Search for locations by city name.

**Input:**
```json
{
  "city": "New York"
}
```

**Output:**
```json
[
  {
    "name": "New York",
    "country": "United States",
    "lat": 40.7128,
    "lon": -74.0060
  }
]
```

### get_complete_forecast

Get complete weather forecast for a location.

**Input:**
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

**Output:**
```json
{
  "current": {
    "time": "2024-01-01T12:00",
    "temperature": 15.5,
    "weather": "Clear",
    "weather_code": 0,
    "humidity": 65,
    "wind_speed": 10.2
  },
  "next_12_hours": [...],
  "next_7_days": [...]
}
```

## License

MIT

