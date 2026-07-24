import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaffOrAdmin } from "@/lib/adminGuards";
import { sanitizeSearchTerm } from "@/lib/security";

// Promociones: agrega clientes del Turnero por SUMA REAL de turnos.
// - Turnos = suma del campo real `cantidad_turnos` (NO cantidad de filas).
// - Solo personas con nombre Y teléfono válidos (no vacíos ni espacios).
// - Sin búsqueda: Top 10 por SUM(turnos). Con búsqueda: solo coincidencias.
// La agregación se hace server-side (en el route handler): el navegador solo
// recibe el Top 10 o los resultados de búsqueda, nunca todos los turnos.

const TOP_N = 10;
const MAX_BUSQUEDA = 50;

// Turnos reales de un registro del Turnero. Es el mismo criterio que usa el
// resumen del propio Turnero: cantidad_turnos con fallback 1 para datos viejos
// (null/0). NO cuenta filas.
function turnosDeRegistro(t: { cantidad_turnos: number | null }): number {
  return Number(t.cantidad_turnos) || 1;
}

// Normaliza teléfono a solo dígitos para agrupar/buscar sin importar guiones,
// espacios o prefijos de formato.
const soloDigitos = (s: string) => s.replace(/\D/g, "");

export async function GET(req: Request) {
  const auth = await requireStaffOrAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);

  const q = sanitizeSearchTerm(searchParams.get("q")).trim();
  const diasRaw = Number(searchParams.get("dias") || 30);
  const dias = Number.isFinite(diasRaw) && diasRaw > 0 ? diasRaw : 30;
  const historico = searchParams.get("historico") === "true";

  let query = supabaseAdmin
    .from("turnos_stand")
    .select("nombre, telefono, fecha, total, cantidad_turnos")
    .neq("estado", "cancelado")
    .not("nombre", "is", null)
    .not("telefono", "is", null)
    .limit(20000);

  if (!historico) {
    const fechaDesde = new Date();
    fechaDesde.setDate(fechaDesde.getDate() - dias);
    query = query.gte("fecha", fechaDesde.toISOString().slice(0, 10));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Error cargando clientes de promociones" },
      { status: 500 }
    );
  }

  type Cliente = {
    nombre: string;
    telefono: string;
    nombre_norm: string;
    telefono_norm: string;
    cantidad_turnos: number;
    total_gastado: number;
    ultimo_turno: string;
  };

  // Agrupa por persona: (nombre normalizado + teléfono normalizado). El teléfono
  // es el identificador fuerte; normalizar evita duplicar por formato, sin
  // mezclar personas distintas (nombres distintos con igual teléfono no se unen).
  const map = new Map<string, Cliente>();

  for (const t of data ?? []) {
    const nombre = String(t.nombre ?? "").trim().replace(/\s+/g, " ");
    const telefono = String(t.telefono ?? "").trim();
    // Excluye nombre/teléfono null, vacíos o solo espacios.
    if (!nombre || !telefono) continue;

    const nombreNorm = nombre.toLowerCase();
    const telefonoNorm = soloDigitos(telefono) || telefono.toLowerCase();
    const clave = `${nombreNorm}|${telefonoNorm}`;

    const turnos = turnosDeRegistro(t);
    const monto = Number(t.total || 0);
    const fecha = t.fecha ?? "";

    const actual = map.get(clave);
    if (!actual) {
      map.set(clave, {
        nombre,
        telefono,
        nombre_norm: nombreNorm,
        telefono_norm: telefonoNorm,
        cantidad_turnos: turnos,
        total_gastado: monto,
        ultimo_turno: fecha,
      });
    } else {
      actual.cantidad_turnos += turnos;
      actual.total_gastado += monto;
      if (fecha > actual.ultimo_turno) actual.ultimo_turno = fecha;
    }
  }

  let clientes = Array.from(map.values());
  clientes.sort((a, b) => b.cantidad_turnos - a.cantidad_turnos);

  if (q.length >= 2) {
    // Con búsqueda: solo coincidencias por nombre o teléfono (sin Top 10 general).
    const qLower = q.toLowerCase();
    const qDigits = soloDigitos(q);
    clientes = clientes
      .filter(
        (c) =>
          c.nombre_norm.includes(qLower) ||
          (qDigits.length > 0 && c.telefono_norm.includes(qDigits))
      )
      .slice(0, MAX_BUSQUEDA);
  } else {
    // Sin búsqueda: Top 10 por SUMA de turnos.
    clientes = clientes.slice(0, TOP_N);
  }

  const salida = clientes.map((c) => ({
    nombre: c.nombre,
    telefono: c.telefono,
    cantidad_turnos: c.cantidad_turnos,
    total_gastado: c.total_gastado,
    ultimo_turno: c.ultimo_turno,
  }));

  return NextResponse.json({ clientes: salida });
}
