// Login and register pages: both log in on success and go to the planner.
import { api, applyTranslations } from "./common.js";

applyTranslations();

const form = document.querySelector("form");
const error = document.getElementById("error");
const submit = form.querySelector("button[type=submit]");

// Already logged in: skip the form
api("GET", "/auth/user").then(() => location.replace("/plan"), () => {});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    try {
        if (form.dataset.mode === "register") await api("POST", "/auth/register", data);
        await api("POST", "/auth/login", { username: data.username, password: data.password });
        location.replace("/plan");
    } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
    } finally {
        submit.disabled = false;
    }
});
