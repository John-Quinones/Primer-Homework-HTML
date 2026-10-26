# Cobro automático con Bold (v2.2.73)

Pedido de John (26/10/2026, hilo «Integrar cobro automático con Bold»): link de pago por cobro/cuota, correo «Cyber LegalTech» y webhook que concilia el pago solo. Su ejemplo era Node/Express genérico; se adaptó a la App.

## Cómo funciona
- **Llaves (solo variables de entorno en Azure, nunca en el repo ni en el chat):** `BOLD_API_KEY` = llave de identidad (Panel Bold → Integraciones → Llaves de API); `BOLD_WEBHOOK_SECRET` = llave secreta que firma los webhooks. `BOLD_WEBHOOK_TEST=1` acepta el sandbox (Bold firma con clave vacía).
- **Link:** `src/bold.js` → `POST https://integrations.api.bold.co/online/link/v1`, header `Authorization: x-api-key <llave>`, `amount_type: CLOSE`, `reference` = `TJ-C<id cobro>-<8 hex>`. Se guarda en `bold_links` y en `charges.pay_link`. Se reutiliza si el saldo no cambió; un link escrito a mano se respeta (no se concilia solo) salvo «Renovar». Botón «Link Bold» en Pagos → Cobros (solo si hay `BOLD_API_KEY`) y automático en «Recordar».
- **Correo:** `src/plantillas/cobro-cyber.html` + `src/email-cobro.js` (variables nombreCliente, concepto, monto, fechaLimite, linkPago; escapa valores; sin link muestra «Datos para el pago»). Lo usa `remind()` de `payments.js` para el canal correo.
- **Webhook:** `POST /api/webhooks/bold`, público, antes de los parsers JSON. Firma: HMAC-SHA256 hex del cuerpo crudo **en Base64**, header `x-bold-signature`. Responde 200 rápido; Bold reintenta 5 veces si no. `SALE_APPROVED` crea el recibo (método «Bold (tarjeta / PSE)», `created_by` nulo, nota «Conciliado automáticamente»); idempotente por `payment_id`+`type` en `bold_events`. `VOID_APPROVED` anula el recibo. Referencia desconocida o cobro anulado → `sin_conciliar` + bitácora «Pago Bold sin conciliar».
- Tablas nuevas: `bold_links`, `bold_events` (no tocan datos existentes). Pruebas: `test/v2-2-72-bold.test.js`.
- Solo el servidor (Azure) recibe webhooks; el enlace de pruebas no.

- **Pruebas (26/10/2026, v2.2.73):** John ya configuró API y webhook de prueba en Azure. `BOLD_WEBHOOK_TEST=1` acepta la firma del sandbox (clave vacía); abrir `/api/webhooks/bold` en el navegador muestra el estado (sin llaves); `GET /api/payments/bold-events` (Gerencia) lista lo reportado. Al fijar las llaves definitivas, quitar `BOLD_WEBHOOK_TEST`.

## Pendiente de John
URL pública del webhook (Azure: `https://<app>/api/webhooks/bold`), registrarla en Bold con eventos Venta aprobada/rechazada (y anulación), y cargar las dos llaves en Azure.
