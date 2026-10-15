# Instalar TecjuridicosApp en Azure (plan gratuito F1, para pruebas)

Con esta guía la app queda en una dirección propia, por ejemplo `https://juanmaapp-tec.azurewebsites.net`, y los empleados ingresan con su cuenta de Microsoft 365. Cada vez que se actualice el código en GitHub, la app se publica sola en Azure.

## Costo

| Concepto | Costo |
|---|---|
| Servidor Azure App Service, plan **F1 (gratuito)** | US$ 0 |
| Registro de la app en Microsoft Entra (inicio de sesión con Microsoft) | US$ 0, viene con Microsoft 365 |
| NomosAI (API de Anthropic), solo si configura la clave | Se paga según el uso |

Azure pide una suscripción. Si la cuenta es nueva, puede pedir una tarjeta para verificar la identidad; con el plan F1 no se cobra.

## Límites del plan gratuito

- **Se duerme** tras unos 20 minutos sin uso. La primera visita después tarda 30 a 60 segundos.
- **Tiene un límite de 60 minutos de procesador al día.** Si se pasa, Azure la detiene hasta las 7:00 p. m. de Colombia (medianoche UTC).
- Mientras duerme **no corren** las consultas a la Rama Judicial de las 7, 13 y 17 h, ni los recordatorios automáticos de pago y agenda.
- Microsoft no garantiza disponibilidad en este plan.

Para el uso diario de la firma se pasa al plan **B1**, de pago, desde la misma pantalla y sin reinstalar ni perder datos (vea el final de esta guía).

---

## Paso 1. Crear la aplicación web

1. Entre a https://portal.azure.com con la cuenta de Microsoft 365 de la firma, preferiblemente una de administrador.
2. Arriba, en el buscador, escriba **App Services** y pulse **+ Crear → Aplicación web**.
3. Llene así:
   - **Grupo de recursos:** *Crear nuevo* → `juanmaapp`
   - **Nombre:** `juanmaapp-tec`, o el que prefiera. Será la dirección `https://juanmaapp-tec.azurewebsites.net`.
   - **Publicar:** Código
   - **Pila del entorno de ejecución:** Node 22 LTS
   - **Sistema operativo:** Linux
   - **Región:** una cercana, por ejemplo *East US* o *Brazil South*. Si el plan gratuito no aparece, pruebe otra región.
   - **Plan de Linux:** *Crear nuevo* → `juanmaapp-plan`
   - **Plan de precios:** pulse *Explorar planes de precios* y elija **Gratis F1**.
4. Pulse **Revisar y crear → Crear** y espere a que termine. Luego pulse **Ir al recurso**.

Anote la dirección que aparece en **Información general → Dominio predeterminado** (en algunos portales la página se llama **Introducción**). Azure ahora agrega un código único y la región, por ejemplo `juanmaapp-tec-efasc4bqgtc8djhp.westus3-01.azurewebsites.net`; use esa dirección completa en `PUBLIC_URL` y en la URI de redirección del paso 2.

## Paso 2. Registrar la app en Microsoft (para el inicio de sesión)

1. En el buscador del portal escriba **Microsoft Entra ID** y ábralo.
2. Menú **Registros de aplicaciones → + Nuevo registro**:
   - **Nombre:** TecjuridicosApp
   - **Tipos de cuenta compatibles:** *Solo las cuentas de este directorio organizativo* (inquilino único). Así solo entran cuentas de la firma.
   - **URI de redirección:** tipo **Web** y la dirección
     `https://juanmaapp-tec.azurewebsites.net/api/auth/microsoft/callback`
     (cambie `juanmaapp-tec` por el nombre que eligió).
   - Pulse **Registrar**.
3. En **Información general** copie:
   - **Id. de aplicación (cliente)** → será `MS_CLIENT_ID`
   - **Id. de directorio (inquilino)** → será `MS_TENANT_ID`
4. Menú **Certificados y secretos → + Nuevo secreto de cliente**: descripción `TecjuridicosApp`, vencimiento de 24 meses. Copie de inmediato la columna **Valor** (no el "Id. de secreto"), porque después no se vuelve a mostrar. Será `MS_CLIENT_SECRET`.
   - Anote la fecha de vencimiento. Antes de esa fecha cree un secreto nuevo y cámbielo en el paso 3; si no, nadie podrá ingresar con Microsoft.
5. Menú **Permisos de API**: deje el permiso *User.Read* que viene por defecto. Si es administrador, pulse **Conceder consentimiento de administrador** para que a los empleados no se les pregunte nada.

## Paso 3. Configurar la aplicación web

En el App Service (`juanmaapp-tec`):

1. Menú **Configuración → Variables de entorno**, pestaña **Configuración de la aplicación**. Agregue cada una con **+ Agregar**:

   | Nombre | Valor |
   |---|---|
   | `DB_PATH` | `/home/data/juanmaapp.db` |
   | `PUBLIC_URL` | `https://juanmaapp-tec.azurewebsites.net` |
   | `COOKIE_SECURE` | `1` |
   | `TRUST_PROXY` | `1` |
   | `PROOF_SECRET` | un texto largo inventado, de 40 o más letras y números |
   | `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` |
   | `MS_TENANT_ID` | el Id. de directorio del paso 2 |
   | `MS_CLIENT_ID` | el Id. de aplicación del paso 2 |
   | `MS_CLIENT_SECRET` | el valor del secreto del paso 2 |
   | `ANTHROPIC_API_KEY` | opcional por ahora: la clave de Anthropic, para NomosAI y jurisprudencia |

   Para enviar correos (firmas, recordatorios, reportes), agregue también:

   | Nombre | Valor |
   |---|---|
   | `SMTP_HOST` | `smtp.office365.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | el buzón que enviará, por ejemplo `notificaciones@tecjuridicos.co` |
   | `SMTP_PASS` | la contraseña de ese buzón |
   | `MAIL_FROM` | `TEC Jurídicos <notificaciones@tecjuridicos.co>` |

   En Microsoft 365 el envío por SMTP debe estar permitido para ese buzón: Centro de administración de Microsoft 365 → Usuarios → el buzón → Correo → *Administrar aplicaciones de correo electrónico* → activar **SMTP autenticado**. Si la organización tiene activados los "valores predeterminados de seguridad", el administrador debe permitirlo.

   Pulse **Aplicar** y confirme.

2. Menú **Configuración → Configuración**:
   - Pestaña *Configuración general*: active **Credenciales de publicación de autenticación básica de SCM**, que GitHub necesita para publicar, y pulse **Aplicar**.
   - Pestaña *Configuración de la pila*: revise **Node 22 LTS** y escriba en **Comando de inicio** `node --disable-warning=ExperimentalWarning server.js`. Pulse **Aplicar**.

## Paso 4. Conectar GitHub para publicar

1. En el App Service, **Información general** (o **Introducción**) **→ Descargar perfil de publicación**. Ese archivo contiene una contraseña: no lo comparta; si se expuso, use **Restablecer perfil de publicación** y descargue uno nuevo. Se descarga un archivo `.PublishSettings`; ábralo con el Bloc de notas y copie todo el contenido.
2. En GitHub, abra el repositorio → **Settings → Secrets and variables → Actions**:
   - Pestaña **Secrets → New repository secret:** nombre `AZURE_WEBAPP_PUBLISH_PROFILE`; en el valor pegue el contenido del archivo.
   - Pestaña **Variables → New repository variable:** nombre `AZURE_WEBAPP_NAME`, valor `juanmaapp-tec` (el nombre del paso 1).
3. Publique por primera vez de una de estas dos formas:
   - Pestaña **Actions** → *Azure · TecjuridicosApp* → **Run workflow**. Este botón aparece cuando el flujo está en la rama `main`.
   - O avíseme y yo subo un cambio que dispara la publicación.

   La publicación tarda de 3 a 5 minutos. Primero corre las pruebas automáticas: si alguna falla, no publica.

## Paso 5. Primer ingreso

1. Abra `https://juanmaapp-tec.azurewebsites.net`. La primera carga puede tardar hasta un minuto.
2. Pulse **Crear la cuenta de Gerencia con Microsoft** e ingrese con su cuenta de Microsoft 365. Quedará como Gerencia.
3. En **Usuarios** cree a cada empleado con **el mismo correo de su cuenta de Microsoft** y deje la contraseña vacía. Ellos ingresan con **Ingresar con la cuenta de Microsoft**.
   - Si alguien sin usuario en TecjuridicosApp intenta entrar, la app se lo impide y le indica que pida a Gerencia que lo cree.
   - Los roles, oficinas y permisos se manejan en TecjuridicosApp, no en Microsoft.
4. Pase sus datos del enlace de prueba: en **Reportes** exporte Clientes y Expedientes a Excel, y cárguelos en **Importar**. También puede importar directamente el Excel de su servidor anterior.

## Datos y copias de seguridad

- La base de datos queda en `/home/data/juanmaapp.db`, en el almacenamiento permanente de la app. No se borra al reiniciar ni al publicar versiones nuevas.
- **Para descargar una copia:** App Service → **Herramientas de desarrollo → Herramientas avanzadas → Ir** → menú *Debug console → Bash* → carpeta `data` → descargue `juanmaapp.db`. Hágalo con regularidad mientras esté en el plan gratuito.

## Pasar al plan B1 (uso diario de la firma)

App Service → **Configuración → Escalar verticalmente (plan de App Service)** → elija **B1** → **Seleccionar**. Luego, en **Configuración → Configuración general**, active **Siempre activado** para que corran las consultas programadas y los recordatorios. No se reinstala nada y los datos se conservan. Costo aproximado: US$ 13 al mes; confírmelo en la calculadora de precios de Azure para su región.

## Si algo falla

| Mensaje o síntoma | Qué revisar |
|---|---|
| "El inicio de sesión con Microsoft no está configurado" | Falta alguna de `MS_TENANT_ID`, `MS_CLIENT_ID` o `MS_CLIENT_SECRET`, o el Id. de directorio está mal copiado |
| Microsoft muestra un error de "redirect URI" | La URI del paso 2 debe ser exactamente `https://<su-app>.azurewebsites.net/api/auth/microsoft/callback`, y `PUBLIC_URL` debe coincidir con esa dirección |
| "La clave de la app en Microsoft (secreto) no es válida o venció" | Copió el Id. del secreto en vez del Valor, o el secreto venció: cree uno nuevo |
| "La cuenta … no está registrada en TecjuridicosApp" | Cree el usuario en **Usuarios** con ese mismo correo |
| La página no carga o dice "Application Error" | App Service → **Supervisión → Flujo de registro**. Revise que el comando de inicio y la versión de Node (22) sean los del paso 3 |
| La app se detuvo a mitad del día | Se agotaron los 60 minutos diarios del plan gratuito; vuelve a las 7:00 p. m. de Colombia |
| GitHub Actions falla en "Deploy" | El perfil de publicación está mal copiado, o la autenticación básica de SCM está desactivada |
