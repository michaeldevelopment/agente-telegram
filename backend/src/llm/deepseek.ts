import OpenAI from "openai";
import { env, requireEnv } from "../config/env.js";

/**
 * Cliente de DeepSeek. La API es compatible con la de OpenAI, así que se usa
 * su SDK con otra baseURL.
 */

let cliente: OpenAI | null = null;

export function deepseek(): OpenAI {
  if (!cliente) {
    cliente = new OpenAI({
      apiKey: requireEnv("DEEPSEEK_API_KEY", "el agente (spec 05)"),
      baseURL: "https://api.deepseek.com",
      timeout: 60_000,
      maxRetries: 0, // los reintentos los gobierna callWithRetry, no el SDK
    });
  }
  return cliente;
}

/**
 * ⚠️ `deepseek-chat` y `deepseek-reasoner` están RETIRADOS desde el
 * 24-jul-2026. El modelo vigente es `deepseek-flash`.
 */
export const MODEL = env.DEEPSEEK_MODEL;

/** Una tool call tal como la devuelve el modelo. `arguments` es un STRING JSON. */
export type ToolCallLlm = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type MensajeLlm =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallLlm[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Definición de una tool en el formato que espera la API (function calling). */
export type ToolDefLlm = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

export type UsoDeepSeek = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

export type RespuestaLlm = {
  texto: string;
  /** Vacío si el modelo respondió con texto en vez de llamar a una tool. */
  toolCalls: ToolCallLlm[];
  /**
   * El mensaje `assistant` TAL CUAL lo devolvió el modelo, listo para
   * re-anexar al historial antes de los resultados de las tools. Omitirlo
   * rompe el contexto y el modelo repite la llamada (ver agent/loop.ts).
   */
  mensajeAssistant: MensajeLlm;
  uso: { hit: number; miss: number; output: number };
  latenciaMs: number;
  finish: string | null;
};

export class SinSaldo extends Error {
  constructor() {
    super("DeepSeek sin saldo (402)");
    this.name = "SinSaldo";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Llama al modelo con reintentos.
 *
 * Lo que NO se reintenta: 400, 401, 422 (culpa nuestra, el reintento daría
 * igual) y 402 (saldo agotado: tampoco se arregla insistiendo, y conviene
 * distinguirlo del 429 porque pide una acción humana).
 */
export async function callWithRetry(
  messages: MensajeLlm[],
  opts: {
    maxTokens?: number; temperature?: number; intentos?: number;
    /**
     * ⚠️ El orden de este array entra en el PREFIJO CACHEADO. Reordenarlo
     * rompe el cache de todos los clientes a la vez: fíjalo en
     * tools/registry.ts, nunca lo construyas iterando un objeto.
     */
    tools?: ToolDefLlm[];
  } = {},
): Promise<RespuestaLlm> {
  const intentos = opts.intentos ?? 3;
  let ultimo: unknown;

  for (let i = 0; i < intentos; i++) {
    const t0 = Date.now();
    try {
      const res = await deepseek().chat.completions.create({
        model: MODEL,
        messages: messages as never,
        // 👇 NO NEGOCIABLE. El thinking viene ENCENDIDO de fábrica con
        // esfuerzo `high`, y esos tokens se cobran a precio de output:
        // son 17× en costo y 5–20 s de latencia para decir "claro, ¿qué día
        // te queda mejor?". Ver memoria/thinking-mode-apagado.md
        reasoning_effort: "none",
        temperature: opts.temperature ?? 0.3,
        // Techo de seguridad: el default sin thinking es 8K.
        max_tokens: opts.maxTokens ?? 400,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" as const } : {}),
      } as never);

      const u = (res.usage ?? {}) as UsoDeepSeek;
      const eleccion = res.choices?.[0];
      const msg = eleccion?.message;
      const toolCalls = (msg?.tool_calls ?? []) as ToolCallLlm[];

      return {
        texto: msg?.content ?? "",
        toolCalls,
        mensajeAssistant: {
          role: "assistant",
          content: msg?.content ?? null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        uso: {
          hit: u.prompt_cache_hit_tokens ?? 0,
          miss: u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0,
          output: u.completion_tokens ?? 0,
        },
        latenciaMs: Date.now() - t0,
        finish: eleccion?.finish_reason ?? null,
      };
    } catch (e: unknown) {
      ultimo = e;
      const status = (e as { status?: number })?.status;

      if (status === 402) throw new SinSaldo();
      if (status === 400 || status === 401 || status === 422) throw e;

      // 429, 5xx, timeout: transitorio. Backoff con jitter.
      if (i < intentos - 1) await sleep(400 * 2 ** i + Math.random() * 200);
    }
  }
  throw ultimo;
}
