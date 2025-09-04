# Trackmate Backend

The backend service for **Trackmate**, built with **Node.js** and **TypeScript**.  
It provides APIs for managing routes, user data, challenges, and social interactions.  
The project uses **Prisma** as the ORM and supports both local development and Docker-based deployments.

---

## Features

- **RESTful API** for mobile app integration  
- **Prisma ORM** for database access and migrations  
- Environment-based configuration with `.env`  
- Docker support for containerized deployment  

---

## Prerequisites

Before setting up the project, ensure you have the following installed:

- **Node.js v20+**  
- **npm** (comes with Node.js)  
- **Prisma CLI** (installed via npm scripts)  
- **Docker** (optional, for containerized setup)  

---

## Setup for Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/alealpha07/trackmate-backend.git
   cd trackmate-backend
    ```

2. **Configure Environment Variables:**

   * Copy the file `example.env` to a new file named `.env`
   * Open `.env` and update the fields with your configuration 

3. **Install Dependencies:**

   ```bash
   npm install
   ```

4. **Run Database Migrations:**

   ```bash
   npm run db:migrate
   npm run db:generate
   ```

5. **Seed the Database (optional):**

   ```bash
   npm run db:seed
   ```

6. **Start the Development Server:**

   ```bash
   npm run dev
   ```

---

## Running with Docker

1. **Configure Docker Compose:**

   * Copy `example.docker-compose.yml` to `docker-compose.yml`
   * Add environment variables and fill in all required fields

2. **Build and Start the Containers:**

   ```bash
   docker-compose build
   docker-compose up
   ```

The backend should now be running in a containerized environment.

---

## Authors

* **Alessandro Prati** – *Lead Developer*
