import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { crearEmpleado, listarActivos, listarArchivados } from "@/lib/empleadosServer";

// Integración contra la DB real (SIM WEB). Crea SOLO fixtures ZZTEST y los ELIMINA
// al final. NO toca los integrantes reales (Ramiro/Francisco/Federico).
// Ejecutar: npx tsx --env-file=.env.local lib/empleados.integration.ts

const PREFIJO = "ZZTEST_EMP_";
const A_NORM = "zztest_alias_compartido";

async function limpiar() {
  const { data } = await supabaseAdmin.from("empleados").select("id").ilike("nombre_formal", PREFIJO + "%");
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) {
    // on delete cascade limpia los alias.
    await supabaseAdmin.from("empleados").delete().in("id", ids);
  }
}

async function main() {
  await limpiar();
  try {
    // ── 1) Seed correcto ────────────────────────────────────────────────────
    const activos = await listarActivos();
    const byName = (n: string) => activos.find((e) => e.nombre_formal === n);
    const ramiro = byName("Ramiro");
    const fran = byName("Francisco");
    const fede = byName("Federico");
    assert.ok(ramiro && fran && fede, "seed: existen Ramiro, Francisco, Federico");
    assert.equal(ramiro!.es_fallback, true, "seed: Ramiro es fallback");
    assert.equal(ramiro!.activo, true, "seed: Ramiro activo");
    assert.equal(fran!.es_fallback, false, "seed: Francisco no fallback");
    const franNorm = fran!.empleado_aliases.map((a) => a.alias_normalizado).sort();
    assert.deepEqual(franNorm, ["fran", "francisco"], "seed: alias de Francisco");
    const fedeNorm = fede!.empleado_aliases.map((a) => a.alias_normalizado).sort();
    assert.deepEqual(fedeNorm, ["fede", "federico"], "seed: alias de Federico");

    // ── 1b) Seed idempotente: no se puede duplicar un alias sembrado ─────────
    // (el UNIQUE sobre alias_normalizado es lo que hace idempotente al seed).
    const { data: dupEmp } = await supabaseAdmin
      .from("empleados").insert({ nombre_formal: PREFIJO + "dup" }).select("id").single();
    const dupId = dupEmp!.id as string;
    const { error: dupErr } = await supabaseAdmin
      .from("empleado_aliases").insert({ empleado_id: dupId, alias: "Ramiro", alias_normalizado: "ramiro" });
    assert.equal((dupErr as { code?: string } | null)?.code, "23505", "idempotencia: alias 'ramiro' duplicado rechazado (23505)");

    // ── 2) Nunca dos fallbacks ───────────────────────────────────────────────
    const { error: fbErr } = await supabaseAdmin
      .from("empleados").update({ es_fallback: true }).eq("id", dupId);
    assert.equal((fbErr as { code?: string } | null)?.code, "23505", "dos fallbacks imposible (índice único parcial, 23505)");

    // ── 3) El fallback (Ramiro) no puede archivarse ──────────────────────────
    const { error: archFbErr } = await supabaseAdmin
      .from("empleados").update({ activo: false }).eq("id", ramiro!.id);
    assert.equal((archFbErr as { code?: string } | null)?.code, "23514", "archivar fallback rechazado por CHECK (23514)");
    const ramiroReload = (await listarActivos()).find((e) => e.id === ramiro!.id);
    assert.ok(ramiroReload && ramiroReload.activo, "Ramiro sigue activo tras intento de archivado");

    // ── 4) Conflicto de alias entre integrantes ──────────────────────────────
    const a = await crearEmpleado(PREFIJO + "A", [{ alias: "ZZ Compartido", alias_normalizado: A_NORM }]);
    assert.equal(a.ok, true, "crea integrante A");
    const b = await crearEmpleado(PREFIJO + "B", [{ alias: "zz compartido", alias_normalizado: A_NORM }]);
    assert.equal(b.ok, false, "crear B con alias en conflicto falla");
    if (!b.ok) assert.equal(b.status, 409, "conflicto de alias → 409");
    // Atomicidad: como la creación de B falló, B NO debe existir (rollback del RPC).
    const { data: bRows } = await supabaseAdmin.from("empleados").select("id").eq("nombre_formal", PREFIJO + "B");
    assert.equal((bRows ?? []).length, 0, "atomicidad: B no quedó creado a medias");

    // ── 5) Archivados no desaparecen de la consulta administrativa ────────────
    const c = await crearEmpleado(PREFIJO + "C", [{ alias: "ZZ C", alias_normalizado: "zztest_c" }]);
    assert.equal(c.ok, true, "crea integrante C");
    if (c.ok) {
      const { error: archErr } = await supabaseAdmin
        .from("empleados").update({ activo: false }).eq("id", c.empleado.id);
      assert.equal(archErr, null, "archivar integrante normal OK");
      const archivados = await listarArchivados();
      assert.ok(archivados.some((e) => e.id === c.empleado.id), "el archivado aparece en listarArchivados");
      assert.ok(!(await listarActivos()).some((e) => e.id === c.empleado.id), "el archivado NO aparece en activos");
    }

    // ── 6) RLS deny-by-default: el rol anon NO puede leer la tabla ────────────
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: anonData } = await anon.from("empleados").select("id").limit(1);
    assert.equal((anonData ?? []).length, 0, "RLS: anon no obtiene filas (deny-by-default)");

    console.log("OK — empleados (integración): seed correcto/idempotente, ≤1 fallback, fallback no archivable, conflicto de alias atómico (409), archivados visibles al admin, RLS deny-by-default para anon.");
  } finally {
    await limpiar();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
