// IA SIM · Bloque 4E — Ensamblado server-side de la proyección de cierre. Arma la distribución
// histórica real (últimos ~90 días) y el calendario de días futuros del mes SEGÚN EL CRONOGRAMA
// real (nunca asume días abiertos sin cronograma), y llama al motor puro de percentiles.

import { getMesVista } from "@/lib/cronogramaServer";
import { estadoPeriodoCalendario } from "@/lib/ia/periodo";
import { ventanaMes, diasEnMes } from "@/lib/ia/analisis/periodos";
import { construirSerieDiaria } from "@/lib/ia/analisis/serieDiaria";
import { proyectarCierre, type DiaHistorico, type DiaFuturo, type ResultadoProyeccion } from "@/lib/ia/analisis/proyeccion";

export type ParamsProyeccion = { anio: number; mes: number };
const VENTANA_HISTORICA_DIAS = 90;

export type ResultadoProyeccionServer =
  | { ok: false; motivo: string }
  | { ok: true; periodo: string; fechaCorte: string; cronogramaOficial: boolean; cronogramaExiste: boolean; facturacion: ResultadoProyeccion; turnos: ResultadoProyeccion };

function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

export async function ejecutarProyeccion(p: ParamsProyeccion): Promise<ResultadoProyeccionServer> {
  const cal = estadoPeriodoCalendario(p.anio, p.mes);
  if (cal.periodo_calendario === "finalizado") {
    return { ok: false, motivo: `${p.anio}-${String(p.mes).padStart(2, "0")} ya finalizó: no hay un cierre que proyectar (usá comparar_periodos para ver el resultado real).` };
  }
  const hoyCba = cal.hoy_cordoba;
  const ventanaMesActual = ventanaMes(p.anio, p.mes);

  const desdeHistorico = sumarDias(hoyCba, -VENTANA_HISTORICA_DIAS);
  const hastaHistorico = sumarDias(hoyCba, -1); // hasta AYER, para no solapar con "real acumulado"
  const [serieHistorica, serieMesActual, vista] = await Promise.all([
    construirSerieDiaria(desdeHistorico, hastaHistorico),
    construirSerieDiaria(ventanaMesActual.desde, hoyCba),
    getMesVista(p.anio, p.mes),
  ]);

  const historicoFacturacion: DiaHistorico[] = serieHistorica.map((d) => ({ fecha: d.fecha, diaSemana: d.diaSemana, valor: d.facturacion }));
  const historicoTurnos: DiaHistorico[] = serieHistorica.map((d) => ({ fecha: d.fecha, diaSemana: d.diaSemana, valor: d.turnos }));
  const realFacturacion = serieMesActual.reduce((a, d) => a + d.facturacion, 0);
  const realTurnos = serieMesActual.reduce((a, d) => a + d.turnos, 0);

  const cronogramaExiste = vista.estado !== "inexistente";
  const cronogramaOficial = vista.estado === "confirmado";
  const diasVistaPorFecha = new Map(vista.dias.map((d) => [d.fecha, d]));
  const totalDias = diasEnMes(p.anio, p.mes);
  const diasFuturos: DiaFuturo[] = [];
  for (let dia = Number(hoyCba.slice(8, 10)) + 1; dia <= totalDias; dia++) {
    const fecha = `${p.anio}-${String(p.mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const [y, m, d] = fecha.split("-").map(Number);
    const diaSemana = new Date(y, m - 1, d).getDay();
    const diaVista = diasVistaPorFecha.get(fecha);
    // Sin cronograma para ese día: NO se asume abierto (conservador, tal como pide la regla).
    const abierto = cronogramaExiste && diaVista ? !diaVista.cerrado : false;
    diasFuturos.push({ fecha, diaSemana, abierto });
  }

  const base = { historico: historicoFacturacion, diasFuturosDelPeriodo: diasFuturos, realAcumuladoPeriodoActual: realFacturacion, fechaCorte: hoyCba, cronogramaOficial };
  const facturacion = proyectarCierre(base);
  const turnos = proyectarCierre({ ...base, historico: historicoTurnos, realAcumuladoPeriodoActual: realTurnos });

  return { ok: true, periodo: `${p.anio}-${String(p.mes).padStart(2, "0")}`, fechaCorte: hoyCba, cronogramaOficial, cronogramaExiste, facturacion, turnos };
}
