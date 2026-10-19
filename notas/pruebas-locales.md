# Pruebas locales

- `npm test` en `juanmaapp/` corre todas las pruebas (node --test).
- Las peticiones POST al servidor local necesitan el encabezado `X-JuanMa: 1`.
- No usar `pkill -f` con un patrón que coincida con el propio comando: mata la terminal.
- App de pruebas local: `npm run preview` y abrir `preview/juanmaapp-preview.html` con Playwright. Abre en «crear administrador»: llenar nombre y correo y enviar el formulario.
- `npm run preview` se detiene si el clon es superficial; traer historia con `git fetch --depth=1000`.
- El contenedor no alcanza Azure ni los portales judiciales: lo que dependa de ellos lo prueba John.
- Contraseñas de prueba: que no contengan el nombre ni el correo del usuario (la App las rechaza).
