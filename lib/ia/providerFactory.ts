import type { IAProvider } from "@/lib/ia/provider";
import { AnthropicProvider } from "@/lib/ia/providerAnthropic";
import { FakeProviderDefault } from "@/lib/ia/providerFake";
import { getProveedor } from "@/lib/ia/config";

// Selección de proveedor según IA_PROVIDER. La API key vive solo en el entorno.
export function crearProvider(): IAProvider | null {
  const prov = getProveedor();
  if (prov === "fake") return new FakeProviderDefault();
  if (prov === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null; // no configurada
    return new AnthropicProvider(key);
  }
  return null;
}
