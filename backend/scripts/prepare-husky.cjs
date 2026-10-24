// Instala los git hooks de Husky SOLO en un checkout local de desarrollo.
//
// `prepare` lo ejecuta `npm install` automáticamente, incluso en el build de
// producción (Railway, Docker, CI). Ahí no hay `.git` en este directorio
// (el repo raíz queda un nivel arriba y el build solo empaqueta `backend/`),
// y encima `husky` es una devDependency que ni se instala — por diseño,
// un build de producción no debe poder fallar por culpa de una herramienta
// de desarrollo. Antes esto era un `node ... || exit 1` sin guardia: un
// `npm install` en Railway tumbaba el build entero.
try {
  const fs = require("node:fs");
  const path = require("node:path");
  const { execFileSync } = require("node:child_process");

  const raiz = path.join(__dirname, "..", "..");
  const huskyBin = path.join(__dirname, "..", "node_modules", "husky", "bin.js");

  if (!fs.existsSync(path.join(raiz, ".git"))) {
    process.exit(0); // no es un checkout del repo (build empaquetado, etc.)
  }
  if (!fs.existsSync(huskyBin)) {
    process.exit(0); // devDependencies no instaladas (build de producción)
  }

  execFileSync(process.execPath, [huskyBin, "backend/.husky"], { cwd: raiz, stdio: "inherit" });
} catch {
  // Nunca tumbar `npm install` por esto.
  process.exit(0);
}
