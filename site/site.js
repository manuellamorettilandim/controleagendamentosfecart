(() => {
  const current = window.location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll("nav a").forEach((link) => {
    const href = new URL(link.href).pathname.replace(/\/$/, "") || "/";
    if (href === current) link.classList.add("active");
  });
})();
