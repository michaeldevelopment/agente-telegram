/**
 * Tipo para lo que va a una columna `jsonb`.
 *
 * `Record<string, unknown>` NO sirve: postgres.js exige un `JSONValue` real,
 * y `unknown` deja pasar funciones, symbols y undefined, que no son JSON.
 * Tenerlo tipado evita escribir en la base cosas que luego no se pueden leer.
 */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [clave: string]: Json };

export type JsonObjeto = { [clave: string]: Json };
