import { setMyCommands } from "../src/telegram/api.js";

/**
 * Registra el menú "/" en @BotFather vía API, para no tener que hacerlo a
 * mano chateando con @BotFather. Correr una vez (o cada vez que cambien los
 * tres comandos de la spec 07).
 *
 *   npm run set-commands
 */
async function main() {
  await setMyCommands([
    { command: "start", description: "Empezar o retomar la conversación" },
    { command: "ayuda", description: "Qué puede hacer este asistente" },
    { command: "humano", description: "Hablar con una persona del equipo" },
  ]);
  console.log("✓ comandos registrados: /start · /ayuda · /humano");
}

main().catch((e) => {
  console.error(`\n✖ ${e instanceof Error ? e.message : e}\n`);
  process.exitCode = 1;
});
