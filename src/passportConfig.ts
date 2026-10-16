import Local from "passport-local";
const LocalStrategy = Local.Strategy;
import bcrypt from "bcryptjs";
import { prisma } from "./utils.js";
import { DoneCallback, PassportStatic } from "passport";
import { User } from "./generated/prisma/client.js";

const BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after 72 bytes
const PASSWORD_MAX_BYTES = 72;
// unknown usernames cost a compare too, so timing doesn't tell which exist
const DUMMY_HASH = bcrypt.hashSync("not-a-password", BCRYPT_COST);

export function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_COST);
}

export async function checkPassword(userId: number, password: unknown): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!user || typeof password !== "string") return false;
    return bcrypt.compare(password, user.password);
}

// a locale key, or null when the password is fine
export function passwordProblem(password: unknown): string | null {
    // spaces around it don't count, so a blank password is too short
    if (typeof password !== "string" || password.trim().length < PASSWORD_MIN_LENGTH) return "register.errors.password-short";
    if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) return "register.errors.password-long";
    return null;
}

function initialize(passport: PassportStatic) {
    const authenticateUser = async (username: unknown, password: unknown, done: Function) => {
        try {
            if (typeof username !== "string" || typeof password !== "string") {
                return done(null, false, { message: "auth.errors.wrong-credentials" });
            }
            const user = await prisma.user.findUnique({ where: { username: username } });
            const passwordsAreMatching = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
            if (user && passwordsAreMatching) {
                return done(null, user);
            }
            else {
                return done(null, false, { message: "auth.errors.wrong-credentials" });
            }
        } catch (error) {
            return done(error);
        }
    };

    passport.use(new LocalStrategy({
        usernameField:"username"
    }, authenticateUser));

    passport.serializeUser((user: Express.User,done:DoneCallback) => done(null, (user as User).id));

    
    passport.deserializeUser(async (id:number,done:DoneCallback) => {
        try {
            const user = await prisma.user.findUnique({ where: { id: id } });
            if(!user){
                return done(null,false);
            }
            return done(null,user);
        } catch (error) {
            return done(error);
        }
    })
}

export default initialize;
