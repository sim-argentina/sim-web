import { Roboto } from "next/font/google";

// Atribución de texto "Google Maps" que exigen las políticas de Places API
// cuando se muestra contenido de Google fuera de un mapa de Google
// (https://developers.google.com/maps/documentation/places/web-service/policies):
// Roboto 400, blanco sobre fondo oscuro, 12–16 px, sin traducir (translate="no"),
// sin cortar en dos líneas ni cambiar mayúsculas.
const roboto = Roboto({ weight: "400", subsets: ["latin"], display: "swap" });

export default function AtribucionGoogleMaps() {
  return (
    <span translate="no" className={`${roboto.className} whitespace-nowrap text-xs text-white`}>
      Google Maps
    </span>
  );
}
