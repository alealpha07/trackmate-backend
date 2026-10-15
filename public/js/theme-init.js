// a classic script in <head>, so the saved theme is on before the first paint
try {
    const theme = localStorage.getItem("trackmate.theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
