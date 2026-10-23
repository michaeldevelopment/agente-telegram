import { closeDb, sql } from "../src/db/client.js";

/**
 * Ejecuta una consulta y la imprime en texto plano. Para los scripts de humo.
 *
 *   printf '%s' "select count(*) from services" | npx tsx scripts/q.ts
 *
 * Existe porque `psql` no está instalado en todas las máquinas y los smoke
 * no pueden depender de que lo esté. El driver ya lo tenemos.
 *
 * ⚠️ El SQL entra por STDIN, no por argv. En Windows `npx` es un .cmd y
 * destroza las comillas internas: un `where direction='out'` pasado como
 * argumento llegaba mutilado, la consulta devolvía TODAS las filas y el
 * smoke daba un falso positivo. Un test que miente es peor que no tenerlo.
 *
 * Salida: una línea por fila, columnas separadas por tabulador, sin cabecera
 * ni espacios — igual que `psql -tAc`, que es lo que esperan los scripts.
 */

async function leerStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(Buffer.from(t));
  return Buffer.concat(trozos).toString("utf8");
}

const consulta = (await leerStdin()).trim();
if (!consulta) {
  console.error('uso: printf \'%s\' "<sql>" | npx tsx scripts/q.ts');
  process.exit(2);
}

sql
  .unsafe(consulta)
  .then((filas: unknown) => {
    for (const fila of filas as Record<string, unknown>[]) {
      process.stdout.write(
        Object.values(fila)
          .map((v) => (v === null || v === undefined ? "" : String(v)))
          .join("\t") + "\n",
      );
    }
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(closeDb);
