import express, { NextFunction, Request, Response } from "express";
import passport from "passport";
import { User, Vehicle } from "../generated/prisma/client.js";
import { sanitizeParams, prisma, isAuthenticated, PUBLIC_USER, deleteUserSessions } from "../utils.js";
import { checkPassword, hashPassword, passwordProblem } from "../passportConfig.js";
import { passwordLimit, registerLimit } from "../limits.js";
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;
const router = express.Router();

router.post("/register", registerLimit, async (request: Request, response: Response): Promise<any> => {
    try {
        const requiredParams = ["username", "password", "confirmPassword"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        if (typeof sanitizedParams.username !== "string" || !USERNAME_PATTERN.test(sanitizedParams.username)) {
            return response.status(422).send(response.__("register.errors.username"));
        }
        const problem = passwordProblem(sanitizedParams.password);
        if (problem) {
            return response.status(422).send(response.__(problem));
        }

        const user = await prisma.user.findUnique({ where: { username: sanitizedParams.username } });
        if (!!user) {
            return response.status(422).send(response.__("register.errors.username-taken"));
        }
        if (sanitizedParams.password != sanitizedParams.confirmPassword) {
            return response.status(422).send(response.__("register.errors.passwords-not-match"));
        }

        await prisma.user.create({
            data: {
                username: sanitizedParams.username,
                password: await hashPassword(sanitizedParams.password),
                // all vehicles by default
                vehicles: { create: Object.values(Vehicle).map((vehicle) => ({ vehicle })) }
            }
        })
        response.send(response.__("register.success"));
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

router.post("/login", passwordLimit, (request: Request, response: Response, next: NextFunction) => {
    passport.authenticate("local", (error: Error, user: User | false, info: any) => {
        if (error) return next(error);
        if (!user) return response.status(401).send(response.__(info.message));
        request.logIn(user, (error) => {
            if (error) return next(error);
            response.send(response.__("login.success"));
        })
    })(request, response, next)
})

router.put("/password", isAuthenticated, passwordLimit, async (request: Request, response: Response, next: NextFunction): Promise<any> => {
    try {
        const requiredParams = ["oldPassword", "newPassword"];
        const { sanitizedParams, missingParams } = sanitizeParams(requiredParams, request.body);
        if (missingParams.length > 0) {
            return response.status(422).send(response.__("server.missing-params") + missingParams.map((p => response.__(p))).join(", "));
        }
        const user = request.user as User;
        if (!(await checkPassword(user.id, sanitizedParams.oldPassword))) {
            return response.status(403).send(response.__("auth.errors.wrong-password"));
        }
        const problem = passwordProblem(sanitizedParams.newPassword);
        if (problem) {
            return response.status(422).send(response.__(problem));
        }

        await prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(sanitizedParams.newPassword) } });
        // logIn regenerates the session, then every other device is logged out
        request.logIn(user, async (error) => {
            if (error) return next(error);
            try {
                await deleteUserSessions(user.id, request.sessionID);
                response.send(response.__("auth.success.password"));
            } catch (error) {
                next(error);
            }
        });
    } catch (error) {
        response.status(500).send(response.__("server.error"));
        console.error(error);
    }
})

router.get("/user", isAuthenticated, async (request: Request, response: Response): Promise<any> => {
    try {
        const user = await prisma.user.findUnique({ where: { id: (request.user as User).id }, select: PUBLIC_USER });
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
