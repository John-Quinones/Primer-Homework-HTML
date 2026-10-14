# Instalar JuanMaApp en internet (Render)

El enlace de prueba sirve para revisar la app y trabajar con datos reales, pero hay funciones que solo trabajan con la app instalada en un servidor: la consulta en la Rama Judicial, la búsqueda de jurisprudencia en las relatorías oficiales, los correos (enlaces de firma, códigos, correo con trazabilidad, recordatorios de pago y reportes) y el WhatsApp automático.

Esta guía usa Render porque el repositorio ya trae la configuración (`render.yaml` y `juanmaapp/Dockerfile`). Costo aproximado: plan Starter más 1 GB de disco, unos 8 USD al mes, más el consumo de la API de Anthropic.

## Lo que necesita antes

1. La cuenta de GitHub donde está este repositorio.
2. Una clave de la API de Anthropic (console.anthropic.com → API Keys). Es la que usa NomosAI para redactar y para la jurisprudencia.
3. Una cuenta de correo para enviar (SMTP). Sirve la de Google Workspace o Microsoft 365 de la firma:
   - Google Workspace: servidor `smtp.gmail.com`, puerto `587`, usuario el correo completo y una "contraseña de aplicación".
   - Microsoft 365: servidor `smtp.office365.com`, puerto `587`.

## Pasos

1. Entre a https://dashboard.render.com y conéctelo con GitHub.
2. **New → Blueprint** y elija este repositorio. Render lee `render.yaml` y crea el servicio `juanmaapp` con su disco.
3. Render pide los valores que faltan:

   | Variable | Qué poner |
   |---|---|
   | `ANTHROPIC_API_KEY` | La clave de Anthropic |
   | `SMTP_HOST` | `smtp.gmail.com` o `smtp.office365.com` |
   | `SMTP_USER` / `SMTP_PASS` | Usuario y contraseña de aplicación del correo |
   | `MAIL_FROM` | Remitente, por ejemplo `TEC Jurídicos <notificaciones@tecjuridicos.co>` |
   | `PUBLIC_URL` | La dirección del servicio, por ejemplo `https://juanmaapp.onrender.com` (va en los enlaces de firma) |

4. Cree el servicio y espere a que diga **Live**. Abra la dirección: la primera pantalla pide crear la cuenta de **Gerencia** (con contraseña de mínimo 10 caracteres).
5. En **Usuarios** cree las oficinas y los usuarios. En **Despachos** cargue el directorio oficial de la Rama Judicial (vea abajo).

### WhatsApp automático (opcional)

Requiere una cuenta de WhatsApp Business en Meta con una plantilla aprobada de un parámetro. Agregue en Render `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` y `WHATSAPP_TEMPLATE`. Sin esto, los recordatorios se mandan con el botón "Abrir en WhatsApp", que abre el chat del cliente con el mensaje listo.

### Dominio propio (opcional)

En Render → Settings → Custom Domains agregue, por ejemplo, `app.tecjuridicos.co` y cree el registro CNAME que Render indique. Luego cambie `PUBLIC_URL`.

## Pasar los datos del enlace de prueba

Lo que se registró en el enlace de prueba queda guardado en el enlace. Para llevarlo a la app instalada, exporte desde **Reportes** (Clientes y Expedientes en Excel) y cárguelo en **Importar** de la app instalada; los cobros y recibos se registran de nuevo o se importan desde Excel cuando se habilite esa importación.

## Directorio de despachos de la Rama Judicial

La página https://www.ramajudicial.gov.co/directorio-cuentas-de-correo-electronico publica el directorio de correos de los despachos. Descargue el archivo (Excel o CSV) y cárguelo en **Despachos → Cargar directorio**. La app reconoce las columnas de departamento, ciudad, despacho, especialidad, correo y teléfono, y actualiza los que ya existen. Repita la carga cuando la Rama publique una edición nueva.

## Copias de seguridad

La base de datos queda en el disco del servicio (`/data/juanmaapp.db`). Render toma instantáneas diarias del disco. Para una copia fuera de Render, programe con el equipo técnico una exportación periódica del archivo `/data/juanmaapp.db`.

## Datos personales

La app guarda datos personales de clientes. Úsela solo con HTTPS (Render lo da por defecto, y `COOKIE_SECURE=1` ya está configurado) y trate los datos según la Ley 1581 de 2012.
