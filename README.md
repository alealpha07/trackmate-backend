# Trackmate Backend

The API behind the Trackmate Android app, plus the web route planner. For what the app does, see the
[frontend README](https://github.com/alealpha07/trackmate-frontend).

## Tech stack

- Node.js 24, TypeScript 7 (ES modules), Express 5
- Prisma 7 with SQLite (better-sqlite3 driver adapter)
- Passport for login sessions
- OpenStreetMap data from Overpass, Copernicus elevation data, Stadia Maps and Photon for place search
- Web planner in plain HTML, CSS and JavaScript, with MapLibre GL, light and dark, in English, Italian and German

## Development

You need Node.js 24 and npm.

```bash
git clone https://github.com/alealpha07/trackmate-backend.git
cd trackmate-backend
cp example.env .env   # then fill in the values
npm install
npm run db:generate   # Prisma client, into src/generated
npm run db:migrate
npm run db:seed       # optional
npm run dev           # tsx, restarts on changes
```

`npm run build` compiles to `dist/` and `npm start` runs it. Prisma 7 no longer generates the client or seeds after a
migration, so run `db:generate` again after changing `prisma/schema.prisma`.

The server listens on the port set in `.env` (3000 in the example). The seed creates three users, giulia (Parma),
marco (Milano) and lena (Berlin), all with the password `trackmate`. Each has three tracks around their city, two
of them posted, plus friends, likes and each other's travels. The web route planner is at http://localhost:3000/plan.

## Tests

```bash
npm test               # type-checks the tests, then runs them with Vitest
npm run test:watch
npm run test:coverage  # report in coverage/
npm run test:e2e       # the web pages in headless Chromium, with Playwright
```

The tests run offline: each test file gets its own migrated SQLite database, upload folder and
caches in a temporary directory. Outside services point at a closed local port, and any request to a public host
fails. Route planning runs on two OpenStreetMap tiles in `test/fixtures/osm/`.

`test/unit/` tests the routing and helpers directly, `test/http/` calls the API with supertest: authorization on every
route, owner checks, the data export and account deletion, and each feature. Valhalla, Photon and Overpass are
replaced by small local fakes.

`test/e2e/` drives the login, register, legal and planner pages in Chromium, on desktop and phone sizes. Playwright
starts its own server on port 3917 with a temporary database. Map tiles are replaced by a blank image, and a test
fails on any request to another host or any console error. The first time, install the browser with
`npx playwright install chromium`.

## Routing benchmark

```bash
npm run benchmark                                # every stage
npm run benchmark -- --only routes,analyze       # some stages: data, valhalla, routes, analyze, figures
npm run benchmark -- --cities milan,parma        # some cities
npm run benchmark -- --only analyze,figures --lang en  # tables, charts and maps in en, it or de
```

Compares Shortest, Safest and Safest with the app's default filters, and Valhalla's bicycle routes, in Milan, Parma,
Turin, Berlin, Munich and Frankfurt. There are 30 seeded random pairs per city, 1.5 to 6 km apart in a straight line.
The planner runs in process. Every route is scored with the same risk model, and Valhalla's route is matched onto the
OpenStreetMap graph through its way ids. The data stage also measures, per city, how much of the map carries the tags
the risk model otherwise fills in with a default.

## Docker

```bash
cp example.docker-compose.yml docker-compose.yml   # then fill in the values
docker compose up --build
```

The database, uploads and map caches are kept in the folders mounted by the compose file.

## Credits and data licences

- Map tiles © [Stadia Maps](https://stadiamaps.com/), map style © [OpenMapTiles](https://openmaptiles.org/), map data
  © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License.
- Routes are planned on OpenStreetMap data read through the [Overpass API](https://overpass-api.de/), on the instances
  run by NextGIS OÜ and FOSSGIS e.V.
- Turn-by-turn directions come from [Valhalla](https://github.com/valhalla/valhalla) on the FOSSGIS e.V. server.
- Place search uses [Stadia Maps](https://stadiamaps.com/) and [Photon](https://photon.komoot.io/) by komoot.
- Elevation data produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
  2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge
  of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus
  WorldDEM-30.
- The web planner uses [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) (BSD-3-Clause) and
  [Roboto](https://github.com/googlefonts/roboto) (SIL Open Font License 1.1), both served by the backend.

The same credits are on the web at `/credits` and in the app.

## License

MIT, see [LICENSE](LICENSE).

## Author

Alessandro Prati
