# Estadisticas Nube Local

Prototipo local para explorar estadisticas similares a Estadisticas Nube usando datos de Tiendanube.

## Abrir

```bash
npm install
npm start
```

Luego abrir:

```text
http://localhost:3050
```

## Publicar en Render

Esta app puede correr en Render sin Supabase ni base de datos. Consulta la API de Tiendanube en vivo y usa las variables de entorno de Render.

1. Subir este proyecto a un repositorio.
2. En Render, crear un **Web Service** desde ese repositorio.
3. Usar:

```text
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
```

Tambien se incluye `render.yaml`, asi que Render puede detectar la configuracion automaticamente.

4. En **Environment Variables** de Render cargar:

```text
APP_BASE_URL=https://tu-app.onrender.com
APP_PASSWORD=una-clave-para-vos-y-mariano
TIENDANUBE_CLIENT_ID=
TIENDANUBE_CLIENT_SECRET=
TIENDANUBE_STORE_ID=
TIENDANUBE_ACCESS_TOKEN=
TIENDANUBE_AUTH_BASE=https://www.tiendanube.com
APP_CONTACT_EMAIL=
```

`COOKIE_SECRET` puede generarlo Render automaticamente si se usa `render.yaml`.

5. En Partners Nube, cambiar la URL de redireccion/callback a:

```text
https://tu-app.onrender.com/auth/tiendanube/callback
```

6. El link para compartir queda:

```text
https://tu-app.onrender.com
```

Mariano entra con esa URL y la clave configurada en `APP_PASSWORD`.

## Datos

Sin credenciales, la app usa datos demo para poder revisar la experiencia completa.

Para leer ordenes reales, esta app usa una aplicacion creada en Partners Nube.

1. En Partners Nube, configurar la URL de redireccion/callback:

```text
http://localhost:3050/auth/tiendanube/callback
```

2. Copiar `.env.example` a `.env` y completar el ID y secreto de la app:

```text
TIENDANUBE_CLIENT_ID=
TIENDANUBE_CLIENT_SECRET=
APP_CONTACT_EMAIL=
```

3. Iniciar la app y abrir:

```text
http://localhost:3050/auth/tiendanube/start
```

Al autorizar la tienda, la app guarda automaticamente en `.env` el `TIENDANUBE_STORE_ID` y el `TIENDANUBE_ACCESS_TOKEN`.

Si Partners Nube no acepta una URL `localhost`, usar una URL publica temporal como ngrok, cambiar `APP_BASE_URL` en `.env` y cargar esa misma URL en Partners. Por ejemplo:

```text
APP_BASE_URL=https://tu-url.ngrok-free.app
```

## Incluido en esta primera version

- Ventas por dia.
- Resumen del periodo.
- Pago y financiacion.
- Variantes por color y talle.
- Provincias, categorias, edad y hora del dia.
- Tabla de productos con vendidos, velocidad, stock, dias de stock y facturacion.
- Ordenes completas por ventas, productos vendidos y facturacion.
- Carritos abandonados por carritos, productos e importes.
- Exportacion CSV de productos.

## Siguiente etapa

- Persistir historico local para no depender de consultar toda la API cada vez.
- Conectar carritos abandonados reales si el endpoint disponible para la tienda lo permite.
- Enriquecer productos con categorias, variantes, imagenes y stock desde el recurso de productos.
- Agregar filtros por producto, variante, categoria, provincia, ciudad, medio de pago y envio.
- Agregar comparacion de periodos.
