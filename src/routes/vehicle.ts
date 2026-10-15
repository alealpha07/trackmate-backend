import express, { Request, Response } from "express";
import { isAuthenticated } from "../utils.js";
import { VEHICLES } from "../vehicles.js";

const router = express.Router();

router.get("/", isAuthenticated, (request: Request, response: Response) => {
    response.json(VEHICLES);
});

export default router;
