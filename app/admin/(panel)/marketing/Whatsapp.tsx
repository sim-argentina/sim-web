"use client";

import { useCallback, useEffect, useState } from "react";
import { VARIABLES_WHATSAPP, type VariableWhatsapp } from "@/lib/marketing/whatsappCloud";
import type { Diagnostico } from "@/lib/marketing/whatsappServer";
import { Seccion, Tarjeta, btnBorde, fecha } from "./ui";

// Marketing · diagnóstico de WhatsApp Cloud API (solo admin). No muestra
// secretos ni dice "conectado" porque existan variables: "verificada" exige que
// Meta haya llamado (verificación del webhook o un evento firmado de la cuenta).

const ESTADO: Record<Diagnostico["estado"], { titulo: string; nota: string; alerta: boolean }> = {
  sin_configurar: { titulo: "Sin configurar", nota: "No hay ninguna variable de WhatsApp en este entorno.", alerta: true },
  configuracion_incompleta: { titulo: "Configuración incompleta", nota: "Faltan variables o alguna es inválida (ver abajo).", alerta: true },
  presente_sin_verificar: { titulo: "Presente, sin verificar", nota: "Están las variables, pero Meta todavía no verificó el webhook ni mandó un evento firmado.", alerta: true },
  verificada: { titulo: "Verificada", nota: "Meta verificó el webhook o llegó un evento firmado de la cuenta de SIM.", alerta: false },
};

const RESULTADO: Record<string, string> = {
  sin_envio: "Sin envío real asociado", ignorado: "Ignorado (no es una baja)", baja_registrada: "Baja registrada",
  baja_repetida: "Baja ya registrada", reanudacion_registrada: "Reanudación de Meta (no revierte bajas)",
  telefono_no_normalizable: "Teléfono que no se puede normalizar", error: "Error (5 intentos)",
  estado_enviado: "Enviado", estado_entregado: "Entregado", estado_leido: "Leído", estado_fallido: "No entregado",
  estado_fallido_baja: "No entregado + baja (131050)",
};

export default function Whatsapp() {
  const [d, setD] = useState<Diagnostico | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/marketing/whatsapp", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setError(j?.error || "No se pudo cargar el diagnóstico."); return; }
      setD(j as Diagnostico);
      setError("");
    } catch {
      setError("Error de conexión.");
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function reprocesar() {
    setOcupado(true);
    setAviso("");
    try {
      const res = await fetch("/api/admin/marketing/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "reprocesar" }) });
      const j = await res.json().catch(() => null);
      setAviso(res.ok ? `Procesados ${j.resultado.procesados} · con error ${j.resultado.con_error} · pendientes ${j.resultado.pendientes}.` : j?.error || "No se pudo procesar.");
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  if (error && !d) return <p className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 font-bold text-red-300">{error}</p>;
  if (!d) return <p className="text-white/60">Cargando…</p>;
  const e = ESTADO[d.estado];
  const c = d.config;
  const vars = Object.keys(VARIABLES_WHATSAPP) as VariableWhatsapp[];
  const rechazos = Object.entries(d.rechazos);

  return (
    <>
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <Tarjeta titulo="Integración" valor={e.titulo} nota={e.nota} alerta={e.alerta} />
        <Tarjeta titulo="Envíos reales" valor={c.enviosReales.habilitado ? "Habilitados" : "Bloqueados"}
          nota={c.enviosReales.habilitado ? "El bloqueo está abierto, pero las campañas solo corren en simulación en esta etapa." : c.enviosReales.motivo}
          alerta={c.enviosReales.habilitado} />
        <Tarjeta titulo="Versión de la API" valor={c.version ?? "Sin definir"} nota={c.numeroFinal ? `Número …${c.numeroFinal} · cuenta …${c.cuentaFinal ?? "?"}` : "Sin número configurado"} alerta={!c.version} />
        <Tarjeta titulo="Bandeja del webhook" valor={`${d.conteos.pendientes} pendientes`} nota={`${d.conteos.total} eventos · ${d.conteos.con_error} con error`} alerta={d.conteos.pendientes > 0 || d.conteos.con_error > 0} />
      </div>
      {!d.instalado && (
        <p className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          La bandeja del webhook no está instalada en esta base (falta <code className="text-white">db/marketing-whatsapp.sql</code>).
        </p>
      )}
      {aviso && <p role="status" className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/90">{aviso}</p>}

      <Seccion titulo="Configuración">
        <div className="divide-y divide-white/10 text-sm">
          {vars.map((k) => {
            const estado = c.invalidas.includes(k) ? "inválida" : c.presentes.includes(k) ? "presente" : "falta";
            return (
              <div key={k} className="grid gap-1 py-2 md:grid-cols-[280px_90px_1fr]">
                <code className="text-white/85">{k}</code>
                <span className={`text-xs font-black uppercase ${estado === "presente" ? "text-green-400" : estado === "falta" ? "text-yellow-300" : "text-red-400"}`}>{estado}</span>
                <span className="text-xs text-white/55">{VARIABLES_WHATSAPP[k]}</span>
              </div>
            );
          })}
          <div className="grid gap-1 py-2 md:grid-cols-[280px_90px_1fr]">
            <code className="text-white/85">MARKETING_WHATSAPP_ENVIOS_REALES</code>
            <span className={`text-xs font-black uppercase ${c.enviosReales.pedido ? "text-red-400" : "text-green-400"}`}>{c.enviosReales.pedido ? "true" : "apagado"}</span>
            <span className="text-xs text-white/55">Bloqueo de envíos reales. Solo el literal &quot;true&quot; lo abre; tener credenciales no habilita nada.</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-white/40">Se muestran nombres y presencia, nunca valores. De los IDs, solo los últimos 4 dígitos.</p>
      </Seccion>

      <Seccion titulo="Verificación y rechazos">
        <ul className="space-y-1 text-sm text-white/70">
          <li>Verificación del webhook (GET de Meta): {fecha(d.verificacion.webhook_verificado_en)}</li>
          <li>Último evento firmado de la cuenta de SIM: {fecha(d.verificacion.ultimo_evento_firmado_en)}</li>
          <li>Último error de procesamiento: {d.ultimo_error ? `${fecha(d.ultimo_error.en)} · ${d.ultimo_error.detalle}` : "ninguno"}</li>
        </ul>
        {rechazos.length > 0 ? (
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {rechazos.map(([m, r]) => (
              <div key={m} className="rounded-xl border border-white/10 bg-black p-3 text-sm">
                <p className="font-black text-white/85">{m.replace(/_/g, " ")}</p>
                <p className="text-xs text-white/50">{r.n} · último {fecha(r.ultimo_en)}</p>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-xs text-white/40">Sin rechazos (firma inválida, cuenta o número ajenos, configuración ausente).</p>}
      </Seccion>

      <Seccion titulo="Últimos eventos" accion={<button type="button" className={btnBorde} disabled={ocupado || !d.instalado} onClick={() => void reprocesar()}>{ocupado ? "Procesando…" : "Reprocesar pendientes"}</button>}>
        {d.ultimos.length === 0 ? <p className="text-sm text-white/50">Todavía no llegó ningún evento.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs font-black uppercase tracking-[0.12em] text-white/35">
                <tr><th className="px-2 py-2">Recibido</th><th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Detalle</th><th className="px-2 py-2">Teléfono</th><th className="px-2 py-2">Resultado</th><th className="px-2 py-2">Intentos</th></tr>
              </thead>
              <tbody>
                {d.ultimos.map((x) => (
                  <tr key={x.id} className="border-t border-white/10">
                    <td className="px-2 py-2 text-white/50">{fecha(x.recibido_en)}</td>
                    <td className="px-2 py-2 font-black uppercase text-white/80">{x.tipo}</td>
                    <td className="px-2 py-2 text-white/60">{x.estado_meta ?? x.intencion ?? x.preferencia ?? "—"}{x.error_codigo ? ` · ${x.error_codigo}` : ""}</td>
                    <td className="px-2 py-2 font-mono text-white/70">{x.wa_id ?? "—"}</td>
                    <td className="px-2 py-2 text-white/70">{x.procesado_en ? (RESULTADO[x.resultado ?? ""] ?? x.resultado) : <span className="text-yellow-300">Pendiente{x.ultimo_error ? ` · ${x.ultimo_error}` : ""}</span>}</td>
                    <td className="px-2 py-2 text-white/50">{x.intentos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-white/40">
          Sin textos de conversación: de un mensaje entrante solo se guarda si es un pedido inequívoco de baja. Reanudaciones de Meta registradas: {d.reanudaciones_meta} (no revierten una baja local).
          Envíos registrados: {d.envios.simulados} simulados · {d.envios.reales} reales. Una aceptación de la API no es un cobro: Meta cobra lo entregado y lo informa en el webhook.
        </p>
      </Seccion>
    </>
  );
}
