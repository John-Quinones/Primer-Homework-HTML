# Registro de cambios de TecjuridicosApp (antes JuanMaApp)

Cada cambio publicado lleva un número consecutivo desde el inicio del proyecto. La app muestra el número que está corriendo (en la pantalla de ingreso y al pie del menú lateral). El número es la cantidad de cambios guardados en la carpeta `juanmaapp/` del repositorio, así que no se repite ni se salta.

| N.º | Fecha | Cambio |
|---|---|---|
| 1 | 14/10/2026 | Primera versión: generador de borradores con NomosAI (derechos de petición, contratos y poderes), con enlace de pago Bold, bloque de firma electrónica y control de frases de IA. |
| 2 | 14/10/2026 | Marca TEC Jurídicos aplicada a la app. |
| 3 | 14/10/2026 | Paleta oficial (azul marino, azul, plata) y logo de la columna "T". |
| 4 | 14/10/2026 | Clientes, catálogo de tipos de proceso y subprocesos, expedientes, y primera vista previa. |
| 5 | 14/10/2026 | Importación desde Excel/CSV exportado de Access. |
| 6 | 14/10/2026 | Jurisprudencia: búsqueda en altas cortes, análisis de sentencias y verificación de citas; nuevo panel de inicio. |
| 7 | 14/10/2026 | Usuarios con roles, oficinas (Ibagué principal), reportes en Excel y PDF, enlace web. |
| 8 | 14/10/2026 | Agenda (tareas, audiencias y términos con alertas), consulta de procesos en la Rama Judicial, directorio de despachos, departamentos y municipios (DIVIPOLA), roles propios. |
| 9 | 14/10/2026 | Documentos: plantillas propias y de ejemplo (contratos, poderes, peticiones, demandas), subprocesos de segundo orden y orden por uso. |
| 10 | 14/10/2026 | Enlace con datos reales (sin datos de ejemplo); Pagos y cartera (cobros, cuotas, recibos, recordatorios); calidad del cliente, afiliado y estados Activo / Archivo provisional / Archivo definitivo; firma electrónica; correo con trazabilidad. |
| 11 | 14/10/2026 | El enlace rescata lo registrado en las versiones de prueba anteriores, sin los datos de ejemplo. |
| 12 | 14/10/2026 | Permiso de Pagos para los roles en datos guardados antes del módulo. |
| 13 | 14/10/2026 | Importación del Excel del servidor de la firma (área, tipo, fecha, estado 1/2, radicado, carpeta, despacho, honorarios y pagos). |
| 14 | 14/10/2026 | Instalación en Azure (plan gratuito) e ingreso con la cuenta de Microsoft 365. |
| 15 | 14/10/2026 | Guía de Azure ajustada a la dirección real de la app y al portal actual. |
| 16 | 14/10/2026 | Corrección: el listado de departamentos y municipios no se estaba publicando. Primera publicación en Azure. |
| 17 | 14/10/2026 | La app muestra el número de cambio publicado; este registro de cambios. |
| 18 | 14/10/2026 | La app pasa a llamarse **TecjuridicosApp**: pantallas, PDF, correos, reportes y documentos de Word. Los datos y la dirección de Azure no cambian. |
| 19 | 14/10/2026 | Clientes: persona natural o jurídica. Natural: nombres y apellidos por separado, corregidos solos a mayúscula inicial (JoHN → John). Jurídica: razón social, NIT y representante legal. Los clientes existentes se separan solos en nombres y apellidos. Azure publica solo cuando se indique. |
| 20 | 14/10/2026 | Ayuda en la app: botón **?** en cada módulo que explica para qué sirve, con sugerencias de uso; los campos muestran un ejemplo y, al escribir, una sugerencia de redacción o contenido. |
| 21 | 14/10/2026 | Al ver un expediente, desde Clientes o desde Expedientes, se muestra su **número de carpeta**: en la tarjeta del expediente y en el título al abrirlo; el campo "No. Carpeta" aparece de primero en el formulario. |
| 22 | 14/10/2026 | Las sugerencias que aparecen debajo de los campos se ven en gris claro con transparencia, igual que el ejemplo que aparece dentro de cada recuadro. |
| 23 | 14/10/2026 | Los campos de correo electrónico sugieren al escribir @gmail.com, @hotmail.com y @outlook.com (por ejemplo, «maria» ofrece maria@gmail.com). |
| 24 | 14/10/2026 | Solo **Gerencia** puede borrar (clientes, expedientes, tareas, plantillas, catálogo, sentencias guardadas, oficinas y roles); a los demás roles no les aparece el botón y el servidor lo rechaza. Cada borrado pide confirmación y dice qué se va a eliminar (nombre del cliente, carpeta del expediente). |
| 25 | 14/10/2026 | Módulo Expedientes: nueva columna **Carpeta** con el número de carpeta de cada expediente y casilla para buscar por carpeta, cliente o radicado. |
| 26 | 15/10/2026 | Botón **Portales** en cada expediente con radicado (Expedientes, Clientes y Consulta de procesos): copia el radicado y abre la Rama Judicial, Publicaciones Procesales, TYBA o SAMAI, y sugiere el portal según el radicado (SAMAI para lo contencioso administrativo). La consulta automática sigue siendo con la Rama Judicial en la versión del servidor. |
| 27 | 15/10/2026 | Portales: la consulta de la Rama Judicial aparece como **Justicia Siglo XXI** (es la consulta pública de ese sistema) y TYBA como Justicia Siglo XXI Web. |
| 28 | 15/10/2026 | Expedientes: casilla **Consulta automática** en cada expediente con radicado para marcar cuáles se consultan solos en la Rama Judicial y cuáles no. Consulta de procesos: cada actuación muestra la **decisión notificada** (auto o sentencia, con su texto), y la fijación en estado indica qué auto notifica; el reporte por correo y WhatsApp la incluye. |
| 29 | 15/10/2026 | Documentos: las minutas de Word de la firma se preparan solas para llenarse; la app encuentra los espacios en blanco (líneas, XXXX, [NOMBRE], texto resaltado) y sugiere el dato del cliente o del expediente que va en cada uno. Expedientes y Despachos: filtros por departamento → ciudad o circuito → área → despacho (en Civil también los juzgados promiscuos y de pequeñas causas). |
| 30 | 14/10/2026 | Clientes: buscador por **nombres**, **apellidos**, **cédula o NIT** o **ciudad** (o en todo). No importan tildes, mayúsculas ni el orden de las palabras («lopez eduardo» encuentra a Eduardo Alfredo Urueña López) y la cédula se encuentra con o sin puntos. |
| 31 | 14/10/2026 | Pagos y cartera: botón **Registrar pago** para anotar a mano lo que pagó el cliente (también pagos anteriores, con su fecha). La cartera muestra por cliente **Honorarios**, **Total pagado** (todos los pagos, aunque no estén ligados a un cobro) y **Saldo**, y arriba el total pagado por los clientes. |
| 32 | 14/10/2026 | Documentos: cada documento (plantilla, minuta de Word o borrador de NomosAI) se puede **descargar en Word o PDF**, **guardar en el expediente** (Word y PDF; se ven en Expedientes → Documentos), **enviar por correo** con ambos archivos adjuntos o **enviar por WhatsApp** al celular del cliente con el mensaje listo. Corrección: al hacer clic en Guardar mientras se veía una sugerencia bajo un campo, el clic se perdía. |
| 33 | 14/10/2026 | Firma electrónica: cada firmante recibe el **código OTP por correo, SMS o WhatsApp** (elige en la página de firma; SMS y WhatsApp requieren configurar el servicio en el servidor). El **PDF firmado** (texto o PDF cargado) lleva la **estampa de cada firma** (firma dibujada, nombre, documento, fecha y hora, medio de verificación) en la página y posición elegidas, el pie de verificación en cada página y el certificado al final; se puede guardar en el expediente. **Notificación por correo** a los firmantes cuando todos firman, con enlace para descargar el documento firmado, y aviso a quien lo envió si alguien no firma. |
| 34 | 14/10/2026 | Ajuste técnico para publicar el enlace de prueba con la nueva librería de PDF (sin cambios visibles). |
| 35 | 14/10/2026 | Pagos: los recibos se numeran en consecutivo desde el **N.º 1155** (luego 1156, 1157…); el número del próximo recibo se ve y se ajusta en Ajustes de cobro y nunca retrocede. Los recordatorios de pago respetan la **Ley 2300 de 2023**: solo de lunes a viernes de 7:00 a. m. a 7:00 p. m. y sábados de 8:00 a. m. a 3:00 p. m., nunca domingos ni festivos de Colombia. |
