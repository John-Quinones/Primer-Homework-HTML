// Legal documents of the firm (personal-data policy, privacy, cookies, terms,
// privacy notice, authorization) and the separate consent items a client
// accepts or declines. Colombian law: Ley 1581 de 2012, Decreto 1074 de 2015
// (which compiles Decreto 1377 de 2013), Ley 1266 de 2008, Ley 1123 de 2007.
// Dependency-free: served to the page as window.JuanmaLegal (browser-module.js).

// Firm data. An empty value shows as [COMPLETAR: …] in every document until
// Gerencia fills it in here. The documents carry the App's version (each new
// version is a new version of the documents), and each stored authorization
// keeps the SHA-256 of the exact text that was accepted.
export const FIRM = {
  brand: "TEC Jurídicos",
  legal_name: "Tecjuridicos S.A.S.",
  nit: "901.269.714-4",
  address: "",
  city: "Ibagué (Tolima)",
  email: "gerencia@tecjuridicos.com",
  phone: "314 415 6914",
  website: "tecjuridicos.com",
  privacy_officer: "Área Jurídica",
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
let appVersion = null;
/** The server passes the App's version (src/version.js); the page reads window.JUANMA_VERSION. */
export function setLegalVersion(v) { appVersion = v || null; }
/** Version of the legal documents = version of the App (2.4, …) and the date it was published. */
export function legalVersion() {
  const v = appVersion || (typeof window !== "undefined" && window.JUANMA_VERSION) || {};
  const [y, m, d] = String(v.date || "").split("-").map(Number);
  return { name: String(v.name || v.change || "local"), date: y && m && d ? `${d} de ${MONTHS[m - 1]} de ${y}` : "" };
}
const V = () => legalVersion();

/** The data policies go to a client only once: with the services contract (user's rule, version 2.8). */
export function isServiceContract(title) {
  return /contrato/i.test(title || "") && /prestaci[oó]n\s+de\s+(los\s+)?servicios/i.test(title || "");
}
const META = (since = true) => `<p class="legal-meta">Versión ${V().name} de TecjuridicosApp${V().date ? ` · ${since ? "vigente desde el " : ""}${V().date}` : ""}</p>`;

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LABELS = { legal_name: "razón social", nit: "NIT", address: "dirección de la sede principal", email: "correo para datos personales",
  phone: "teléfono", website: "sitio web", privacy_officer: "cargo o área responsable de datos personales" };
const F = (key) => (FIRM[key] ? esc(FIRM[key]) : `<mark class="legal-fill">[COMPLETAR: ${LABELS[key] || key}]</mark>`);
const WHO = () => `<strong>${esc(FIRM.brand)}</strong> (${F("legal_name")}, NIT ${F("nit")})`;
const CONTACT = () => `<ul>
  <li>Correo electrónico: ${F("email")}</li>
  <li>Dirección: ${F("address")}, ${esc(FIRM.city)}</li>
  <li>Teléfono: ${F("phone")}</li>
  <li>Área responsable: ${F("privacy_officer")}</li>
</ul>`;
const LINK = (id, text) => `<a href="legal.html#${id}" data-legal="${id}">${text}</a>`;

const tratamiento = () => `
${META()}
<h3>1. Responsable del tratamiento</h3>
<p>${WHO()}, firma de abogados con domicilio en ${esc(FIRM.city)}, es responsable del tratamiento de los datos personales que recoge en la prestación de sus servicios jurídicos y en el uso de TecjuridicosApp, su sistema de gestión de clientes y expedientes. Datos de contacto:</p>
${CONTACT()}

<h3>2. Marco legal</h3>
<p>Esta política aplica el artículo 15 de la Constitución Política (habeas data), la Ley Estatutaria 1581 de 2012, el Decreto Único 1074 de 2015 (capítulo 25, que compiló el Decreto 1377 de 2013), la Ley Estatutaria 1266 de 2008, modificada por la Ley 2157 de 2021, en lo relativo a información financiera, crediticia y comercial, el artículo 74 de la Constitución y el numeral 9 del artículo 28 de la Ley 1123 de 2007 (secreto profesional del abogado), la Ley 527 de 1999 (mensajes de datos y firma electrónica) y la Ley 2300 de 2023 (canales y horarios de contacto para cobranza).</p>

<h3>3. Definiciones</h3>
<ul>
  <li><strong>Dato personal:</strong> información vinculada o que pueda asociarse a una persona natural determinada o determinable.</li>
  <li><strong>Dato sensible:</strong> el que afecta la intimidad del titular o cuyo uso indebido puede generar su discriminación, como datos de salud, origen racial o étnico, orientación política, convicciones religiosas, pertenencia a sindicatos, vida sexual y datos biométricos.</li>
  <li><strong>Titular:</strong> persona natural cuyos datos son objeto de tratamiento.</li>
  <li><strong>Tratamiento:</strong> cualquier operación sobre datos personales: recolección, almacenamiento, uso, circulación o supresión.</li>
  <li><strong>Responsable:</strong> quien decide sobre la base de datos y el tratamiento; en este caso, ${esc(FIRM.brand)}.</li>
  <li><strong>Encargado:</strong> quien trata datos por cuenta del responsable, como los proveedores de alojamiento, correo y mensajería.</li>
  <li><strong>Autorización:</strong> consentimiento previo, expreso e informado del titular.</li>
  <li><strong>Transmisión y transferencia:</strong> envío de datos a un encargado (transmisión) o a otro responsable (transferencia), dentro o fuera de Colombia.</li>
</ul>

<h3>4. Principios</h3>
<p>El tratamiento sigue los principios de legalidad, finalidad, libertad, veracidad o calidad, transparencia, acceso y circulación restringida, seguridad y confidencialidad del artículo 4 de la Ley 1581 de 2012. Además, toda la información que el cliente confía a la firma está cubierta por el <strong>secreto profesional</strong>, que se mantiene aun después de terminado el encargo.</p>

<h3>5. Titulares y datos que tratamos</h3>
<ul>
  <li><strong>Clientes y sus representantes:</strong> nombres, tipo y número de documento, NIT y representante legal, dirección, ciudad, correo, teléfono, datos del proceso o asunto, hechos, pruebas y documentos que aporten, honorarios, pagos y recibos, y su firma electrónica o manuscrita.</li>
  <li><strong>Contrapartes, terceros y apoderados</strong> que aparecen en los procesos: los datos que constan en el expediente judicial o administrativo o que el cliente suministra para su defensa.</li>
  <li><strong>Funcionarios, abogados y contratistas</strong> de la firma: datos de identificación, contacto, tarjeta profesional, rol, oficina, credenciales de acceso y registro de actividad en TecjuridicosApp.</li>
  <li><strong>Firmantes y destinatarios</strong> de documentos y correos enviados desde la app: nombre, documento, correo o teléfono, y la evidencia técnica de la firma, apertura o acuse (fecha y hora, dirección IP y navegador).</li>
  <li><strong>Proveedores y aspirantes:</strong> datos de contacto, tributarios, bancarios y hoja de vida.</li>
</ul>

<h3>6. Finalidades</h3>
<ol>
  <li>Prestar la asesoría y la representación judicial, extrajudicial y administrativa contratada: estudiar el caso, redactar documentos, radicar actuaciones, asistir a audiencias y comunicarse con autoridades y contrapartes.</li>
  <li>Abrir y mantener el expediente del cliente, consultar el estado de sus procesos en los portales de la Rama Judicial y de la jurisdicción de lo contencioso administrativo, y avisarle de actuaciones, audiencias y términos.</li>
  <li>Celebrar y ejecutar el contrato de prestación de servicios: facturar, registrar pagos, expedir recibos, gestionar la cartera y enviar recordatorios de pago según la Ley 2300 de 2023.</li>
  <li>Enviar documentos para firma electrónica y correos con trazabilidad, y conservar la evidencia de cada envío, firma, apertura y acuse.</li>
  <li>Preparar borradores de documentos con herramientas de inteligencia artificial bajo la revisión de un abogado de la firma.</li>
  <li>Con autorización separada del titular, consultar su información en las centrales de riesgo, reportar el cumplimiento o el incumplimiento de las obligaciones derivadas del contrato de servicios y mantener actualizada esa información, conforme a la ${LINK("centrales", "Autorización para centrales de riesgo")}.</li>
  <li>Cumplir obligaciones legales, contables, tributarias y disciplinarias, y atender requerimientos de autoridades.</li>
  <li>Garantizar la seguridad de la información: control de accesos por rol y oficina, bitácora de auditoría y prevención de fraudes.</li>
  <li>Gestionar la relación con funcionarios, contratistas y proveedores.</li>
</ol>
<p>Los datos no se venden, no se usan para publicidad de terceros y no se usan para finalidades distintas sin una nueva autorización.</p>

<h3>7. Datos sensibles y de niños, niñas y adolescentes</h3>
<p>En asuntos laborales, de seguridad social, familia, salud o víctimas, el caso puede requerir datos sensibles como historias clínicas, dictámenes de pérdida de capacidad laboral o información sobre la vida familiar. Solo se tratan con autorización <strong>explícita</strong> del titular, cuando son necesarios para el encargo, con acceso restringido al equipo que lleva el caso. El titular <strong>no está obligado</strong> a autorizar el tratamiento de datos sensibles (artículos 5 y 6 de la Ley 1581 de 2012).</p>
<p>Los datos de niños, niñas y adolescentes se tratan solo cuando el asunto lo exige, respetando su interés superior y con autorización de su representante legal (artículo 7 de la Ley 1581 de 2012).</p>

<h3>8. Autorización</h3>
<p>La firma pide autorización previa, expresa e informada al titular, por escrito, en la oficina con firma en pantalla o por un enlace privado en el que el titular marca por separado cada autorización. TecjuridicosApp guarda la prueba de cada respuesta: qué texto se aceptó o rechazó, la versión del documento y su huella SHA-256, la fecha y hora, el medio, la dirección IP y el navegador o, si fue en la oficina, la firma y el funcionario que la registró.</p>
<p>No se requiere autorización, conforme al artículo 10 de la Ley 1581 de 2012, cuando la información la pide una autoridad en ejercicio de sus funciones o por orden judicial, cuando se trata de datos de naturaleza pública (como los que constan en expedientes judiciales públicos), en casos de urgencia médica o sanitaria, para fines históricos, estadísticos o científicos, y para datos del registro civil.</p>

<h3>9. Derechos del titular</h3>
<p>Conforme al artículo 8 de la Ley 1581 de 2012, el titular puede:</p>
<ul>
  <li>Conocer, actualizar y rectificar sus datos.</li>
  <li>Pedir prueba de la autorización otorgada.</li>
  <li>Ser informado del uso que se ha dado a sus datos.</li>
  <li>Presentar quejas ante la Superintendencia de Industria y Comercio, después de agotar el trámite ante la firma.</li>
  <li>Revocar la autorización o pedir la supresión de sus datos cuando no exista un deber legal o contractual de conservarlos.</li>
  <li>Acceder en forma gratuita a sus datos.</li>
</ul>

<h3>10. Consultas y reclamos</h3>
<p>El titular, sus causahabientes o su representante pueden presentar consultas y reclamos al correo ${F("email")} o por escrito en ${F("address")}, indicando su nombre, documento, datos de contacto, la descripción de lo que pide y los documentos que quiera hacer valer.</p>
<ul>
  <li><strong>Consultas:</strong> se responden en máximo diez (10) días hábiles desde su recibo. Si no es posible, se informa el motivo y la nueva fecha, que no superará cinco (5) días hábiles adicionales.</li>
  <li><strong>Reclamos</strong> (corrección, actualización, supresión o incumplimiento): se responden en máximo quince (15) días hábiles, prorrogables por ocho (8) días hábiles más con aviso al titular. Si el reclamo está incompleto, se pide completarlo dentro de los cinco (5) días siguientes; pasados dos (2) meses sin respuesta, se entiende desistido. Mientras se tramita, el dato se marca como «reclamo en trámite».</li>
</ul>
<p>Antes de acudir a la Superintendencia de Industria y Comercio, el titular debe agotar este trámite ante la firma (artículo 16 de la Ley 1581 de 2012).</p>

<h3>11. Deberes de la firma y de sus encargados</h3>
<p>La firma cumple los deberes de los artículos 17 y 18 de la Ley 1581 de 2012: garantizar el ejercicio del habeas data, conservar la prueba de la autorización, informar la finalidad, mantener la información segura, veraz y actualizada, tramitar consultas y reclamos en los términos legales e informar a la Superintendencia de Industria y Comercio los incidentes de seguridad. Cuando aplique, inscribe sus bases de datos en el Registro Nacional de Bases de Datos.</p>

<h3>12. Encargados y transferencias internacionales</h3>
<p>Para operar TecjuridicosApp, la firma usa proveedores que tratan datos por su cuenta, con contratos que les exigen confidencialidad y seguridad:</p>
<ul>
  <li><strong>Microsoft</strong> (Azure y Microsoft 365): alojamiento del sistema y de la base de datos, inicio de sesión y envío de correos.</li>
  <li><strong>Meta</strong> (WhatsApp Business): avisos y códigos de verificación por WhatsApp, cuando el titular elige ese medio.</li>
  <li><strong>Anthropic</strong> (Claude): preparación de borradores de documentos con inteligencia artificial, siempre revisados por un abogado.</li>
  <li><strong>Google</strong> (Google Fonts): tipografías de la aplicación; recibe la dirección IP del navegador, no datos de clientes.</li>
</ul>
<p>Algunos de estos servidores están en los Estados Unidos, país que la Superintendencia de Industria y Comercio reconoce con nivel adecuado de protección (Circular Externa 005 de 2017). La consulta de procesos se hace en los portales oficiales de la Rama Judicial y de la jurisdicción de lo contencioso administrativo.</p>

<h3>13. Seguridad</h3>
<p>La firma aplica medidas técnicas y administrativas razonables: acceso con usuario y contraseña robusta o con la cuenta de Microsoft 365 de la firma, contraseñas guardadas con cifrado de una vía, cierre de sesión por inactividad, límite de intentos de ingreso, permisos por rol y por oficina, conexión cifrada (HTTPS), bitácora de auditoría que no se puede editar ni borrar, y compromisos de confidencialidad de funcionarios y contratistas.</p>

<h3>14. Conservación</h3>
<p>Los datos se conservan mientras dure la relación con el titular y, después, el tiempo necesario para atender reclamaciones, responder por la gestión profesional y cumplir obligaciones legales: los soportes contables, diez (10) años (artículo 28 de la Ley 962 de 2005), y los expedientes, en principio diez (10) años desde la terminación del encargo. La prueba de las autorizaciones se conserva mientras se traten los datos y por el mismo término.</p>

<h3>15. Vigencia y cambios</h3>
<p>Esta política rige desde el ${V().date || "día de su publicación"}, con la versión ${V().name} de TecjuridicosApp. Los cambios sustanciales se informan a los titulares antes de aplicarlos, por correo o en la propia aplicación, y cada versión queda identificada con su número y fecha.</p>`;

const privacidad = () => `
${META()}
<p>Esta política explica, en lenguaje sencillo, qué información maneja ${WHO()} en TecjuridicosApp y en sus páginas públicas (firma electrónica, acuse de correo, verificación de documentos y autorizaciones), y cómo la protege. Complementa la ${LINK("tratamiento", "Política de tratamiento de datos personales")}.</p>

<h3>1. Qué información recogemos</h3>
<ul>
  <li><strong>La que usted nos da:</strong> sus datos de identificación y contacto, los hechos y documentos de su caso, y la información de pagos.</li>
  <li><strong>La de su proceso:</strong> número de radicado, despacho y actuaciones, consultadas en los portales oficiales de la Rama Judicial y de la jurisdicción de lo contencioso administrativo.</li>
  <li><strong>La evidencia técnica de lo que hace en nuestras páginas:</strong> cuando firma, abre un correo, descarga un anexo o responde una autorización, guardamos la fecha y hora, la dirección IP y el navegador, para probar que el acto ocurrió.</li>
  <li><strong>La de los funcionarios de la firma:</strong> su cuenta, sus permisos y cada cambio que hacen en la aplicación (bitácora de auditoría).</li>
</ul>

<h3>2. Para qué la usamos</h3>
<p>Para llevar su caso, mantenerle informado, preparar y firmar documentos, registrar pagos y recordarle vencimientos, cumplir la ley y proteger la información. No vendemos ni alquilamos sus datos y no los usamos para publicidad.</p>

<h3>3. Quién puede verla</h3>
<ul>
  <li>Dentro de la firma, solo los funcionarios con permiso para ello y de la oficina que lleva su caso. Todo acceso queda registrado.</li>
  <li>Las autoridades judiciales y administrativas ante las que actuamos por usted, y quienes la ley autorice.</li>
  <li>Nuestros proveedores tecnológicos (alojamiento, correo, WhatsApp, inteligencia artificial para borradores), solo para prestar el servicio y bajo confidencialidad. La lista está en la Política de tratamiento de datos personales.</li>
</ul>

<h3>4. Secreto profesional</h3>
<p>Lo que usted confía a sus abogados está protegido por el secreto profesional (artículo 74 de la Constitución y Ley 1123 de 2007). Nuestros funcionarios y contratistas firman compromisos de confidencialidad.</p>

<h3>5. Inteligencia artificial</h3>
<p>Algunos borradores se preparan con un asistente de inteligencia artificial (Claude, de Anthropic). Solo se envían los datos necesarios para el documento, el proveedor los trata por cuenta de la firma conforme a sus condiciones de servicio, y todo borrador lo revisa y ajusta un abogado antes de usarse. Ninguna decisión sobre su caso la toma una máquina.</p>

<h3>6. Cómo la protegemos</h3>
<p>Conexión cifrada, contraseñas robustas guardadas con cifrado de una vía, cierre de sesión por inactividad, permisos por rol, copias en servidores de Microsoft y una bitácora que no se puede alterar. Los documentos firmados llevan una huella SHA-256 y un código de verificación para comprobar que nadie los modificó.</p>

<h3>7. Cuánto tiempo la guardamos</h3>
<p>Mientras dure nuestra relación y, después, el tiempo que exige la ley o el necesario para responder por la gestión, como se explica en la Política de tratamiento de datos personales.</p>

<h3>8. Sus derechos</h3>
<p>Puede conocer, actualizar, rectificar y pedir la supresión de sus datos, pedir prueba de su autorización y revocarla, escribiendo a ${F("email")}. Respondemos consultas en 10 días hábiles y reclamos en 15 días hábiles.</p>

<h3>9. Cambios</h3>
<p>Si cambiamos esta política se lo informaremos antes de aplicar el cambio. Cada versión queda numerada y fechada.</p>`;

const cookies = () => `
${META()}
<p>Las cookies son pequeños archivos que un sitio guarda en su navegador. TecjuridicosApp usa <strong>solo cookies técnicas, necesarias para funcionar</strong>, y almacenamiento local del navegador para recordar preferencias. <strong>No usamos cookies de publicidad, de analítica ni de redes sociales</strong>, y no rastreamos su navegación en otros sitios.</p>

<h3>1. Cookies que usamos</h3>
<table class="legal-table">
  <thead><tr><th>Nombre</th><th>Para qué sirve</th><th>Duración</th><th>Tipo</th></tr></thead>
  <tbody>
    <tr><td><code>jm_session</code></td><td>Mantener abierta la sesión del funcionario que ingresó. Es inaccesible para otros scripts (HttpOnly) y solo viaja a nuestro servidor.</td><td>Hasta 12 horas; se cierra antes tras horas sin uso o al salir.</td><td>Propia, técnica</td></tr>
    <tr><td><code>jm_ms</code></td><td>Proteger el ingreso con la cuenta de Microsoft 365 (verifica que la respuesta de Microsoft corresponde a su navegador).</td><td>10 minutos</td><td>Propia, técnica</td></tr>
  </tbody>
</table>
<p>Las páginas públicas para clientes y terceros (firma electrónica, acuse de correo, verificación y autorizaciones) no instalan cookies: el enlace privado que recibe es la llave de acceso.</p>

<h3>2. Almacenamiento local del navegador</h3>
<table class="legal-table">
  <thead><tr><th>Nombre</th><th>Para qué sirve</th><th>Duración</th></tr></thead>
  <tbody>
    <tr><td><code>tecjuridicos-display-v1</code></td><td>Recordar el tamaño de letra, la vista (web o celular) y el modo día o noche.</td><td>Hasta que usted lo borre</td></tr>
    <tr><td><code>juanmaapp-data-v1</code>, <code>juanmaapp-current</code></td><td>Solo en el enlace de prueba: copia local de los datos y usuario elegido.</td><td>Hasta que usted lo borre</td></tr>
  </tbody>
</table>

<h3>3. Servicios de terceros</h3>
<ul>
  <li><strong>Google Fonts:</strong> descarga las tipografías; Google recibe la dirección IP del navegador. No instala cookies desde nuestra aplicación.</li>
  <li><strong>Microsoft:</strong> si ingresa con Microsoft 365, la página de inicio de sesión de Microsoft usa sus propias cookies, regidas por la política de privacidad de Microsoft.</li>
</ul>

<h3>4. Cómo controlarlas</h3>
<p>Puede ver y borrar las cookies y el almacenamiento local en la configuración de su navegador (Chrome, Edge, Safari o Firefox: «Privacidad» o «Cookies y datos de sitios»). Si bloquea las cookies técnicas no podrá iniciar sesión en la aplicación.</p>

<h3>5. Marco legal</h3>
<p>En Colombia la información que se obtiene mediante cookies, cuando identifica a una persona, se rige por la Ley 1581 de 2012. Cualquier cookie nueva que no sea técnica se informará y se pedirá su autorización antes de usarla.</p>`;

const terminos = () => `
${META()}
<h3>1. Objeto</h3>
<p>Estos términos regulan el uso de TecjuridicosApp, el sistema de gestión jurídica de ${WHO()}, por sus funcionarios y contratistas, y el uso de sus páginas públicas por clientes y terceros. Usar la aplicación implica aceptarlos.</p>

<h3>2. Cuentas y acceso</h3>
<ul>
  <li>Las cuentas las crea Gerencia; son personales e intransferibles. Cada usuario responde por lo que se haga con su cuenta y debe avisar de inmediato cualquier uso no autorizado.</li>
  <li>Cada usuario ve y modifica solo lo que su rol y sus oficinas le permiten. Solo Gerencia elimina información.</li>
  <li>La firma registra en la bitácora quién hizo cada cambio, cuándo y desde qué dispositivo.</li>
</ul>

<h3>3. Uso aceptable</h3>
<p>La aplicación solo se usa para los asuntos de la firma. Está prohibido extraer o divulgar información de clientes fuera de lo que exige el encargo, cargar contenido ilícito, intentar vulnerar la seguridad o acceder a información sin permiso. El incumplimiento puede acarrear la suspensión de la cuenta y las acciones disciplinarias, civiles y penales que correspondan.</p>

<h3>4. Confidencialidad y datos personales</h3>
<p>Toda la información de clientes está sujeta al secreto profesional y a la ${LINK("tratamiento", "Política de tratamiento de datos personales")}. La obligación de confidencialidad continúa después de terminada la relación con la firma.</p>

<h3>5. Borradores con inteligencia artificial</h3>
<p>Los documentos que prepara NomosAI son <strong>borradores</strong>. El abogado responsable debe revisarlos, verificar las normas y la jurisprudencia citadas y ajustarlos antes de firmarlos o radicarlos. La responsabilidad profesional sobre cada documento es del abogado que lo usa.</p>

<h3>6. Consulta de procesos</h3>
<p>La información de procesos proviene de los portales oficiales de la Rama Judicial y de la jurisdicción de lo contencioso administrativo, que pueden presentar retrasos, errores o interrupciones. No reemplaza la revisión del expediente ni el control de términos por el abogado responsable.</p>

<h3>7. Firma electrónica y correo con trazabilidad</h3>
<p>La firma electrónica de la aplicación (enlace privado con código de verificación o firma presencial en pantalla) es un método de firma electrónica conforme a la Ley 527 de 1999 y al Decreto 1074 de 2015, que identifica al firmante y deja evidencia de su voluntad. El correo con trazabilidad conserva prueba de envío, apertura, descarga y acuse; no es un servicio de correo electrónico certificado acreditado ante el ONAC.</p>

<h3>8. Páginas públicas</h3>
<p>Quien recibe un enlace privado para firmar, ver un correo o responder una autorización debe usarlo personalmente y no compartirlo. Al usarlo, se registra la evidencia descrita en la ${LINK("privacidad", "Política de privacidad")}.</p>

<h3>9. Disponibilidad</h3>
<p>La firma procura que la aplicación esté disponible y segura, pero puede haber interrupciones por mantenimiento o por fallas de proveedores o de internet. Los plazos judiciales siguen corriendo: ante una falla, use los medios alternos.</p>

<h3>10. Propiedad intelectual</h3>
<p>La aplicación, su diseño, sus plantillas y su contenido pertenecen a ${esc(FIRM.brand)} o a sus licenciantes. Los documentos de cada caso pertenecen al cliente y a la firma según el contrato de servicios.</p>

<h3>11. Ley aplicable</h3>
<p>Estos términos se rigen por las leyes de Colombia. Las controversias se resolverán ante los jueces de ${esc(FIRM.city)}, sin perjuicio de los mecanismos de protección de datos ante la Superintendencia de Industria y Comercio.</p>

<h3>12. Cambios</h3>
<p>La firma puede actualizar estos términos; cada versión queda numerada y fechada y se informa en la aplicación.</p>`;

const aviso = () => `
${META(false)}
<p><strong>Responsable:</strong> ${WHO()}, ${F("address")}, ${esc(FIRM.city)}. Correo: ${F("email")}. Teléfono: ${F("phone")}.</p>
<p><strong>Finalidades:</strong> sus datos personales se usarán para prestarle los servicios jurídicos contratados; llevar su expediente y consultar sus procesos; comunicarle actuaciones, audiencias y términos; ejecutar el contrato, registrar pagos y enviarle recordatorios de cobro; firmar documentos electrónicamente y conservar su evidencia; preparar borradores con herramientas tecnológicas revisadas por un abogado; y cumplir obligaciones legales.</p>
<p><strong>Datos sensibles:</strong> no está obligado(a) a autorizar el tratamiento de datos sensibles (como los de salud) ni a responder preguntas sobre ellos o sobre niños, niñas y adolescentes. Si los autoriza, solo se usarán para su caso.</p>
<p><strong>Sus derechos:</strong> conocer, actualizar, rectificar y suprimir sus datos, pedir prueba de la autorización, saber cómo se han usado, revocar la autorización y presentar quejas ante la Superintendencia de Industria y Comercio (artículo 8 de la Ley 1581 de 2012).</p>
<p><strong>Cómo ejercerlos:</strong> escriba a ${F("email")} o acuda a nuestra sede.</p>
<p><strong>Política completa:</strong> consulte la ${LINK("tratamiento", "Política de tratamiento de datos personales")}, la ${LINK("privacidad", "Política de privacidad")} y la ${LINK("cookies", "Política de cookies")}.</p>`;

const autorizacion = () => `
${META(false)}
<p>Como titular de los datos, de manera libre, previa, expresa e informada, y luego de leer el ${LINK("aviso", "Aviso de privacidad")} y la ${LINK("tratamiento", "Política de tratamiento de datos personales")} de ${WHO()}, respondo <strong>por separado</strong> cada una de las siguientes autorizaciones:</p>
<ol>
  <li><strong>Tratamiento de datos personales</strong> para las finalidades de la política: prestación de los servicios jurídicos, expediente, consulta de procesos, contrato, pagos y cumplimiento legal.</li>
  <li><strong>Datos sensibles</strong> (salud, historia clínica, dictámenes, vida familiar u otros) estrictamente necesarios para mi caso. Sé que esta autorización es <strong>facultativa</strong>.</li>
  <li><strong>Política de privacidad</strong>, incluida la evidencia técnica que se registra cuando uso las páginas de la firma.</li>
  <li><strong>Política de cookies</strong> de la aplicación y sus páginas públicas.</li>
  <li><strong>Centrales de riesgo:</strong> consulta de mi información, reporte del cumplimiento o incumplimiento de mis obligaciones, previa comunicación con veinte (20) días calendario de anticipación, y su actualización, conforme a la ${LINK("centrales", "Autorización para centrales de riesgo")} (Ley 1266 de 2008, modificada por la Ley 2157 de 2021).</li>
  <li><strong>Comunicaciones</strong> por correo electrónico, WhatsApp y llamada sobre mi caso y mis pagos, en los horarios de la Ley 2300 de 2023.</li>
</ol>
<p>Sé que puedo conocer, actualizar, rectificar y suprimir mis datos y revocar cualquiera de estas autorizaciones escribiendo a ${F("email")}, y que la firma conserva la prueba de esta respuesta: el texto aceptado o rechazado, su versión, la fecha y hora y el medio por el que respondí.</p>`;

const centrales = () => `
${META(false)}
<p>En mi calidad de titular de la información, actuando de manera libre, voluntaria, previa, expresa e informada, autorizo a ${WHO()}, o a quien en el futuro ostente la calidad de acreedor por cesión o subrogación de las obligaciones a mi cargo (en adelante, <strong>EL ACREEDOR</strong>), para que, conforme a la Ley Estatutaria 1266 de 2008, modificada por la Ley 2157 de 2021, y a la Ley 1581 de 2012, realice las siguientes actividades:</p>

<h3>1. Consulta</h3>
<p>Consultar, solicitar y verificar, en cualquier tiempo, en DataCrédito Experian, TransUnion (CIFIN) o en cualquier otro operador de bancos de datos de información financiera, crediticia, comercial y de servicios, mi comportamiento y mi capacidad de pago, con el fin de analizar, celebrar y hacer seguimiento a la relación contractual de prestación de servicios profesionales.</p>

<h3>2. Reporte</h3>
<p>Reportar a dichos operadores datos sobre el nacimiento, la modificación, el cumplimiento, el incumplimiento y la extinción de las obligaciones dinerarias que adquiera con EL ACREEDOR, en especial las derivadas del contrato de prestación de servicios profesionales y de sus honorarios. Ningún reporte negativo se hará sin la <strong>comunicación previa</strong> que exige el artículo 12 de la Ley 1266 de 2008, enviada con al menos veinte (20) días calendario de anticipación a la dirección física, al correo electrónico o al teléfono que tenga registrados, para que pueda pagar la obligación o controvertir el monto, la cuota o la fecha de exigibilidad.</p>

<h3>3. Actualización y rectificación</h3>
<p>Actualizar y rectificar la información reportada cada vez que cambie la situación de la obligación (abonos, pagos, acuerdos, refinanciaciones o extinción), en los términos que fija la ley, de manera que lo reportado sea veraz, completo, exacto, actualizado y comprobable.</p>

<h3>4. Permanencia de la información</h3>
<p>Conozco que la información negativa permanece en los bancos de datos por el doble del tiempo de la mora, sin exceder cuatro (4) años contados desde la fecha en que se pague o se extinga la obligación, conforme al artículo 13 de la Ley 1266 de 2008, modificado por la Ley 2157 de 2021, y que la información positiva permanece de manera indefinida.</p>

<h3>5. Mis derechos</h3>
<p>Puedo conocer, actualizar y rectificar la información reportada, y presentar peticiones, consultas y reclamos ante EL ACREEDOR, como fuente, y ante el operador. Las consultas se responden en máximo diez (10) días hábiles y los reclamos en máximo quince (15) días hábiles, prorrogables en los casos que prevé la ley. Si no recibo respuesta oportuna o no estoy conforme, puedo acudir a la Superintendencia de Industria y Comercio. Las peticiones a EL ACREEDOR se presentan a ${F("email")} o en ${F("address")}.</p>

<h3>6. Alcance y vigencia</h3>
<p>Esta autorización es independiente de las demás autorizaciones de tratamiento de datos; puedo concederla o negarla sin que ello afecte las otras. Estará vigente mientras subsista cualquier obligación a mi cargo con EL ACREEDOR y durante el término de permanencia de la información que establece la ley. Su revocatoria no procede respecto de obligaciones vigentes o en mora, por existir un deber legal y contractual de reportar su estado.</p>`;

export const LEGAL_DOCS = [
  { id: "tratamiento", title: "Política de tratamiento de datos personales", short: "Datos personales", get html() { return tratamiento(); } },
  { id: "privacidad", title: "Política de privacidad", short: "Privacidad", get html() { return privacidad(); } },
  { id: "cookies", title: "Política de cookies", short: "Cookies", get html() { return cookies(); } },
  { id: "terminos", title: "Términos y condiciones de uso", short: "Términos", get html() { return terminos(); } },
  { id: "aviso", title: "Aviso de privacidad", short: "Aviso", get html() { return aviso(); } },
  { id: "centrales", title: "Autorización para consulta, reporte y actualización en centrales de riesgo", short: "Centrales de riesgo", get html() { return centrales(); } },
  { id: "autorizacion", title: "Autorización para el tratamiento de datos personales", short: "Autorización", get html() { return autorizacion(); } },
];

// What a client authorizes, each item on its own: one checkbox, one stored answer.
export const CONSENT_ITEMS = [
  { key: "datos", doc: "tratamiento", title: "Tratamiento de datos personales",
    label: `Autorizo a ${FIRM.brand} a tratar mis datos personales para las finalidades de su Política de tratamiento de datos personales: prestación de los servicios jurídicos, expediente, consulta de procesos, contrato, pagos y cumplimiento legal.` },
  { key: "sensibles", doc: "tratamiento", title: "Datos sensibles (facultativo)",
    label: `Autorizo de forma expresa el tratamiento de mis datos sensibles (salud, historia clínica, dictámenes, vida familiar u otros) estrictamente necesarios para mi caso. Sé que no estoy obligado(a) a autorizarlo.` },
  { key: "privacidad", doc: "privacidad", title: "Política de privacidad",
    label: `Leí y acepto la Política de privacidad de ${FIRM.brand}, incluida la evidencia técnica (fecha, hora, dirección IP y navegador) que se registra cuando uso sus páginas.` },
  { key: "cookies", doc: "cookies", title: "Política de cookies",
    label: `Leí y acepto la Política de cookies: la aplicación y sus páginas usan solo cookies técnicas y almacenamiento local para funcionar, sin publicidad ni analítica.` },
  { key: "centrales", doc: "centrales", title: "Consulta, reporte y actualización en centrales de riesgo",
    label: `Autorizo a ${FIRM.legal_name} (${FIRM.brand}), NIT ${FIRM.nit}, o a quien ostente en el futuro la calidad de acreedor, para consultar mi información en las centrales de riesgo, reportar el cumplimiento o el incumplimiento de mis obligaciones, previa comunicación con veinte (20) días calendario de anticipación, y mantener actualizada esa información, conforme a la Ley 1266 de 2008, modificada por la Ley 2157 de 2021.` },
  { key: "comunicaciones", doc: "aviso", title: "Comunicaciones por correo, WhatsApp y llamada",
    label: `Autorizo que ${FIRM.brand} me contacte por correo electrónico, WhatsApp y llamada para informarme sobre mi caso y mis pagos, en los horarios que permite la Ley 2300 de 2023.` },
];

export const CONSENT_METHODS = { firma: "Al firmar un documento por enlace", enlace: "Enlace privado", presencial: "En la oficina (firma en pantalla)", revocacion: "Revocación registrada por la firma" };

export const legalDoc = (id) => LEGAL_DOCS.find((d) => d.id === id) || null;
export const consentItem = (key) => CONSENT_ITEMS.find((i) => i.key === key) || null;

/** Plain text of a document (what its SHA-256 is computed over). */
export const legalPlain = (html) => String(html).replace(/<(br|\/p|\/li|\/h3|\/tr)>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** The exact text a client answers for one item: the checkbox sentence plus the full document it refers to. */
export function consentText(key) {
  const item = consentItem(key);
  const doc = item && legalDoc(item.doc);
  if (!doc) return "";
  return `${item.title}\n${item.label}\n\n${doc.title} · versión ${V().name} de TecjuridicosApp${V().date ? ` (${V().date})` : ""}\n${legalPlain(doc.html)}`;
}

/** Latest answer per item from a client's records (oldest first or any order). */
export function consentStatus(records) {
  const out = {};
  for (const item of CONSENT_ITEMS) out[item.key] = null;
  for (const r of [...(records || [])].sort((a, b) => (a.at === b.at ? a.id - b.id : a.at < b.at ? -1 : 1))) {
    if (r.item in out) out[r.item] = r;
  }
  return out;
}

/** Canonical form of one record for the hash chain: any later edit breaks the chain (the drawn signature is appended to it). */
export const consentCanonical = (r, prevHash) => JSON.stringify([prevHash || "", r.client_name, r.client_id_number, r.item, r.granted ? 1 : 0,
  r.method, r.doc_version, r.doc_sha256, r.at, r.ip || "", r.user_agent || "", r.typed_name || "", r.typed_id || "", r.note || "", r.registered_by_name || ""]);

/** The checklist shown before signing a document by link: each policy with its own Sí / No, nothing chosen beforehand. */
export function consentChecklistHtml(items, prefix = "cs") {
  return `<fieldset class="consent-fieldset"><legend>Políticas de datos personales</legend>
  <p class="hint">Antes de firmar, decida <strong>por separado</strong> si acepta o no cada política. Su respuesta no cambia el documento que firma y queda guardada como soporte, con la fecha y la hora.</p>
  <ul class="consent-list">${items.map((i) => {
    const d = legalDoc(i.doc);
    return `<li class="consent-card"><h4>${esc(i.title)}</h4><p class="consent-label">${esc(i.label)}</p>
    <div class="consent-choice" role="radiogroup" aria-label="${esc(i.title)}">
      <label><input type="radio" name="${prefix}_${i.key}" value="si" required /> Sí acepto</label>
      <label><input type="radio" name="${prefix}_${i.key}" value="no" required /> No acepto</label>
    </div>
    <details><summary>Leer: ${esc(d.title)}</summary><div class="legal-doc">${d.html}</div></details></li>`;
  }).join("")}</ul></fieldset>`;
}
/** Answers of that checklist: { answers: { datos: true, … }, missing: [titles not answered] }. */
export function consentAnswers(form, items, prefix = "cs") {
  const answers = {}, missing = [];
  for (const i of items) {
    const v = form.elements[`${prefix}_${i.key}`]?.value;
    if (v === "si" || v === "no") answers[i.key] = v === "si"; else missing.push(i.title);
  }
  return { answers, missing };
}

// ----- e-mail to a signer (version 2.8) -----
// The office decides, for each client, which parts go in the message: every part
// can be left out except the link, and the policies can be chosen one by one.
export const MAIL_PARTS = [
  { key: "greeting", label: "Saludo («Hola …:»)" },
  { key: "message", label: "Mensaje para el firmante" },
  { key: "doc_line", label: "Nombre del documento" },
  { key: "policies", label: "Políticas de datos personales" },
  { key: "code_note", label: "Aviso del código de verificación" },
  { key: "closing", label: "Despedida («TecjuridicosApp»)" },
];

/** What to include, from what the office chose; anything not sent stays included (the old behavior). */
export function mailOptions(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const p of MAIL_PARTS) if (p.key !== "policies") out[p.key] = o[p.key] !== false;
  const keys = CONSENT_ITEMS.map((i) => i.key);
  out.policies = Array.isArray(o.policies) ? keys.filter((k) => o.policies.includes(k)) : keys;
  return out;
}

/**
 * The parts of the e-mail, in order, as text and HTML. ctx: name, message, title, link,
 * code_via, policies ([{ title, url, doc }] already chosen and pending), version.
 */
export function signMailParts(ctx, opts) {
  const o = mailOptions(opts);
  const parts = [];
  if (o.greeting) parts.push({ key: "greeting", text: `Hola ${ctx.name || ""}:`, html: `<p>Hola ${esc(ctx.name || "")}:</p>` });
  const msg = String(ctx.message ?? "").trim() || "Le enviamos un documento para su firma electrónica.";
  if (o.message) parts.push({ key: "message", text: msg, html: `<p>${esc(msg)}</p>` });
  if (o.doc_line) parts.push({ key: "doc_line", text: `Documento: ${ctx.title || ""}`, html: `<p><strong>Documento:</strong> ${esc(ctx.title || "")}</p>` });
  parts.push({ key: "link", text: `Para leerlo y firmarlo, abra este enlace:\n${ctx.link || ""}`,
    html: `<p><a href="${esc(ctx.link || "")}" style="display:inline-block;background:#002b6a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Leer y firmar</a></p>` });
  const pol = ctx.policies || [];
  if (pol.length) {
    const head = `Políticas de datos personales (versión ${ctx.version || legalVersion().name}). En la página de firma decidirá por separado si acepta o no cada una:`;
    parts.push({ key: "policies", text: `${head}\n${pol.map((p) => `[ ] ${p.title}${p.url ? `: ${p.url}` : ""}`).join("\n")}`,
      html: `<p>${esc(head)}</p><ul style="list-style:none;padding-left:0">${pol.map((p) => `<li style="margin:4px 0">&#9744; ${esc(p.title)}${p.url ? ` · <a href="${esc(p.url)}">leer ${esc(p.doc || "")}</a>` : ""}</li>`).join("")}</ul>` });
  }
  if (o.code_note && ctx.code_via) parts.push({ key: "code_note", text: `Al firmar le enviaremos un código de verificación por ${ctx.code_via}.`,
    html: `<p style="color:#666;font-size:12px">Al firmar le enviaremos un código de verificación por ${esc(ctx.code_via)}. Si no esperaba este mensaje, ignórelo.</p>` });
  if (o.closing) parts.push({ key: "closing", text: "TecjuridicosApp", html: "<p>TecjuridicosApp</p>" });
  return parts;
}

/** Policy items to ask with this signature: services contract, chosen in the e-mail, not answered before. */
export function policyItemsToAsk(title, opts, answeredKeys) {
  if (!isServiceContract(title)) return [];
  const chosen = mailOptions(opts).policies, done = new Set(answeredKeys || []);
  return CONSENT_ITEMS.filter((i) => chosen.includes(i.key) && !done.has(i.key));
}
