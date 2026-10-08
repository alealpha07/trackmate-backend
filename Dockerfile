FROM node:22
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
CMD ["sh", "-c", "npx prisma migrate dev && node dist/index.js"]
