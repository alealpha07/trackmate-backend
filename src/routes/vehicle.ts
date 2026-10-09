import express, { Request, Response } from "express";
import { isAuthenticated } from "../utils";
import { VEHICLES } from "../vehicles";

const router = express.Router();

router.get("/", isAuthenticated, (request: Request, response: Response) => {
    response.json(VEHICLES);
});

export default router;
