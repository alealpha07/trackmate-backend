# Trackmate Backend

Backend for Trackmate, written in Node.js and TypeScript with Express and Prisma.
It serves the API used by the Android app: tracks, travels, users, quests and posts.

## Requirements

- Node.js 20 or newer, with npm
- Docker (optional)

## Development

```bash
git clone https://github.com/alealpha07/trackmate-backend.git
cd trackmate-backend
cp example.env .env   # then fill in the values
npm install
npm run db:migrate
npm run db:generate
npm run db:seed       # optional
npm run dev
```

## Docker

Copy `example.docker-compose.yml` to `docker-compose.yml`, fill in the environment variables, then:

```bash
docker-compose build
docker-compose up
```

## Author

Alessandro Prati
