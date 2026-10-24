import { JWT } from "google-auth-library";
import { requireEnv } from "../config/env.js";

/**
 * Autenticación de Service Account sobre un calendario compartido.
 *
 * Sin pantalla de consentimiento, sin verificación de Google, sin
 * `refresh_token` que rote: 5 minutos de puesta en marcha (ver §8.1).
 *
 * ⚠️ Límite de las Service Accounts creadas desde el 2-mar-2020: NO pueden
 * invitar asistentes sin delegación de dominio (requiere Google Workspace).
 * Por eso los eventos de la spec 10 se crean sin `attendees`.
 */

let cliente: JWT | null = null;

/**
 * `google-auth-library` cachea y renueva el access token (~1 h) por su
 * cuenta; `cliente` aquí solo evita reconstruir el objeto JWT en cada
 * llamada, no gestiona el token en sí.
 */
function jwt(): JWT {
  if (!cliente) {
    const email = requireEnv("GOOGLE_SA_EMAIL", "Google Calendar (spec 08)");
    const keyB64 = requireEnv("GOOGLE_SA_PRIVATE_KEY", "Google Calendar (spec 08)");

    // La clave en BASE64 evita toda la clase de bugs de los \n literales al
    // pegar el JSON de la Service Account directo en una env var.
    const key = Buffer.from(keyB64, "base64").toString("utf8");
    if (!key.includes("BEGIN PRIVATE KEY")) {
      throw new Error(
        "GOOGLE_SA_PRIVATE_KEY no parece una clave privada válida tras decodificar " +
          "base64 — ¿se guardó el JSON crudo en vez de la clave en base64?",
      );
    }

    cliente = new JWT({
      email,
      key,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
  }
  return cliente;
}

/** Token de acceso Bearer para las llamadas REST directas (freebusy, events). */
export async function accessToken(): Promise<string> {
  const { token } = await jwt().getAccessToken();
  if (!token) throw new Error("Google no devolvió un access token");
  return token;
}

export function calendarId(): string {
  return requireEnv("GOOGLE_CALENDAR_ID", "Google Calendar (spec 08)");
}

/** Para los tests: fuerza a reconstruir el cliente (p. ej. tras cambiar env vars). */
export function _soloParaPruebas_resetCliente(): void {
  cliente = null;
}
