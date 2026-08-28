import { strict as assert } from "node:assert";
import { consolidarFuentes } from "@/lib/fuentesConsolidadas";

// Ejecutar: npx tsx lib/fuentesConsolidadas.test.ts

// Variantes de Instagram se agrupan; el resto se preserva; (not set) intacto.
{
  const raw = [
    { label: "ig / social", value: 10 },
    { label: "l.instagram.com / referral", value: 5 },
    { label: "instagram.com / referral", value: 3 },
    { label: "google / organic", value: 20 },
    { label: "(not set)", value: 4 },
  ];
  const out = consolidarFuentes(raw);
  const insta = out.find((f) => f.label === "Instagram");
  assert.ok(insta && insta.value === 18, "agrupa ig + l.instagram + instagram.com = 18");
  assert.ok(out.some((f) => f.label === "google / organic" && f.value === 20), "preserva google/organic");
  assert.ok(out.some((f) => f.label === "(not set)" && f.value === 4), "preserva (not set), no reasigna");
  assert.equal(out[0].label, "google / organic", "ordenado por valor desc");
}

// Facebook agrupa sus variantes; no toca fuentes ambiguas.
{
  const raw = [
    { label: "m.facebook.com / referral", value: 6 },
    { label: "facebook / cpc", value: 2 },
    { label: "bigcommerce / referral", value: 9 }, // "ig" dentro de "big" NO debe matchear
    { label: "signal / referral", value: 1 }, // "ig" dentro de "signal" NO debe matchear
  ];
  const out = consolidarFuentes(raw);
  assert.ok(out.some((f) => f.label === "Facebook" && f.value === 8), "facebook variants = 8");
  assert.ok(out.some((f) => f.label === "bigcommerce / referral"), "no falso-positivo por 'ig' en 'big'");
  assert.ok(out.some((f) => f.label === "signal / referral"), "no falso-positivo por 'ig' en 'signal'");
}

// Sin variantes agrupables → salida equivalente al raw (no aporta consolidación).
{
  const raw = [{ label: "google / organic", value: 5 }, { label: "(direct) / (none)", value: 3 }];
  const out = consolidarFuentes(raw);
  assert.equal(out.length, raw.length, "sin agrupamientos, misma cantidad");
}

console.log("OK — fuentesConsolidadas: agrupa Instagram/Facebook inequívocos, preserva el resto y (not set), sin falsos positivos.");
