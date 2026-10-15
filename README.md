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
