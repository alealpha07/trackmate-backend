# Trackmate Backend

The API behind the Trackmate Android app, plus the web route planner. For what the app does, see the
[frontend README](https://github.com/alealpha07/trackmate-frontend).

## Tech stack

- Node.js 22, TypeScript, Express
- Prisma with SQLite
- Passport for login sessions
- OpenStreetMap data from Overpass, Copernicus elevation data, Stadia Maps and Photon for place search
- Web planner in plain HTML, CSS and JavaScript, with MapLibre GL

## Development

You need Node.js 22 and npm.

```bash
git clone https://github.com/alealpha07/trackmate-backend.git
cd trackmate-backend
cp example.env .env   # then fill in the values
npm install
npm run db:migrate
npm run db:seed       # optional
npm run dev
```

The server listens on the port set in `.env` (3000 in the example). The seed creates three users: admin/admin,
user/user and guest/guest. The web route planner is at http://localhost:3000/plan.

## Docker

```bash
cp example.docker-compose.yml docker-compose.yml   # then fill in the values
docker compose up --build
```

The database, uploads and map caches are kept in the folders mounted by the compose file.

## License

MIT, see [LICENSE](LICENSE).

## Author

Alessandro Prati
