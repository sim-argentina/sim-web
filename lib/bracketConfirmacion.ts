// Palabra de confirmación del reinicio de un campeonato de eliminación.
//
// Vive en su propio módulo PURO (sin supabaseAdmin) para que la comparta el modal
// del admin —un componente cliente— y la validación del servidor. Una sola fuente:
// si alguna vez cambia, no puede quedar la UI pidiendo una palabra y el backend
// esperando otra.
export const CONFIRMACION_REINICIO = "REINICIAR";
