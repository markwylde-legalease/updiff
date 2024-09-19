# Updiff

Updiff is a web application change detection tool that monitors specified URLs for visual changes over time. It captures screenshots, compares them, and provides a visual timeline of changes.

## Features

- Automated screenshot capture of specified URLs
- Visual comparison of screenshots to detect changes
- Timeline view of changes for each monitored URL
- Web-based dashboard to view results
- Mac OS notifications for detected changes and errors

## Prerequisites

- Node.js (version 22 or later)
- npm (comes with Node.js)
- Docker (optional, for containerized deployment)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/markwylde-legalease/updiff.git
   cd updiff
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Install Playwright dependencies:
   ```
   npx playwright install-deps
   npx playwright install
   ```

## Configuration

Edit the `URLS` array in `lib/index.ts` to specify the websites you want to monitor.

## Usage

### Running locally

Start the application:

```
npm start
```

The application will start monitoring the specified URLs and create a local server. Access the dashboard at `http://localhost:3000`.

### Running with Docker

1. Build the Docker image:
   ```
   docker build -t updiff .
   ```

2. Run the container:
   ```
   docker run -p 3000:3000 updiff
   ```

Access the dashboard at `http://localhost:3000`.

## Dashboard

The dashboard displays:
- A table of monitored URLs with their last change and check times
- A timeline for each URL showing changes over time
- Screenshots of changes
- Diff images when changes are detected

## Notifications

The application sends Mac OS notifications for:
- Detected changes
- Check failures

## License

This project is licensed under the MIT License.
