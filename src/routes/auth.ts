import express, { Request, Response } from "express";
import bcrypt from "bcryptjs";
import passport from "passport";
import { User } from "@prisma/client";
import { sanitizeParams, prisma, isAuthenticated } from "../utils";
const PASSWORD_SALT = 10;
const router = express.Router();

router.post("/register", async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["username", "password", "confirmPassword"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }

        const user = await prisma.user.findUnique({ where: { username: sanitizedParams.username } });
        if (!!user) {
            return response.status(422).send(response.__("register.errors.username-taken"));
        }
        if (sanitizedParams.password != sanitizedParams.confirmPassword) {
            return response.status(422).send(response.__("register.errros.passwords-not-match"));
        }

        const hashedPassword = await bcrypt.hash(sanitizedParams.password, PASSWORD_SALT);
        await prisma.user.create({
            data: {
                username: sanitizedParams.username,
                password: hashedPassword
            }
        })
        response.send(response.__("register.success"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

router.post("/login", async (request: Request, response: Response, next) => {
    passport.authenticate("local", (error: Error, user: User, info: any) => {
        if (error) throw error;
        if (!user) return response.status(401).send(response.__(info.message));
        request.logIn(user, (error) => {
            response.send(response.__("login.success"));
        })
    })(request, response, next)
})

router.get("/user", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const user = await prisma.user.findUnique({ where: { id: (request.user as User).id } });
        response.send(user);
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

router.post("/logout", (request: Request, response: Response, next) => {
    request.logOut((err) => {
        if (err) {
            return next(err);
        }
        response.send(response.__("logout.success"));
    });
})

export default router;