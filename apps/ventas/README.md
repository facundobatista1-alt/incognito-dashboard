# Tablero Operativo de Ventas — Ustic

App local para gestionar pedidos de venta con integración a **Tiendanube**.

---

## Estructura del proyecto

```
├── public/               ← Frontend (servido por Express)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── server.js             ← Backend Express (NO se sirve al navegador)
├── tiendanube.js         ← Lógica OAuth + normalización de pedidos TN
├── package.json
├── .env.example          ← Plantilla de variables de entorno
├── .env                  ← Variables reales (NO commitear)
└── .gitignore
```

> Los archivos `index.html`, `app.js` y `styles.css` de la **raíz** son la
> versión original sin backend. Podés abrirlos directo en el navegador para
> probar la app sin servidor. La versión con integración Tiendanube está en
> `public/`.

---

## Cómo correr la app

### Requisitos previos

- **Node.js 18+** instalado ([nodejs.org](https://nodejs.org))

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar la plantilla de variables de entorno
cp .env.example .env

# 3. (Opcional) Completar las credenciales en .env — ver sección OAuth

# 4. Arrancar el servidor
npm start
```

La app queda disponible en **http://localhost:3000**.

Para desarrollo con recarga automática (Node 18+):

```bash
npm run dev
```

---

## Variables de entorno

| Variable | Descripción | Requerida para |
|---|---|---|
| `PORT` | Puerto del servidor (default: `3000`) | Siempre |
| `TIENDANUBE_CLIENT_ID` | ID de la app registrada en Tiendanube | OAuth |
| `TIENDANUBE_CLIENT_SECRET` | Secret de la app | OAuth |
| `TIENDANUBE_REDIRECT_URI` | URI de callback (ej. `http://localhost:3000/auth/tiendanube/callback`) | OAuth |
| `TIENDANUBE_STORE_ID` | ID de la tienda (se obtiene luego del OAuth) | Importar pedidos |
| `TIENDANUBE_ACCESS_TOKEN` | Token de acceso (se obtiene luego del OAuth) | Importar pedidos |

---

## Cómo conectar OAuth de Tiendanube

### Paso 1 — Crear la app en Tiendanube Partners

1. Ingresá a [https://partners.tiendanube.com](https://partners.tiendanube.com).
2. Creá una nueva aplicación (o usá una existente).
3. Configurá la **URI de redirección** como `http://localhost:3000/auth/tiendanube/callback`.
4. Anotá el **Client ID** y el **Client Secret**.

### Paso 2 — Completar el `.env`

```env
TIENDANUBE_CLIENT_ID=tu_client_id
TIENDANUBE_CLIENT_SECRET=tu_client_secret
TIENDANUBE_REDIRECT_URI=http://localhost:3000/auth/tiendanube/callback
```

### Paso 3 — Obtener el token

1. Arrancá el servidor (`npm start`).
2. Abrí en el navegador: **http://localhost:3000/auth/tiendanube**
3. Se va a abrir la pantalla de autorización de Tiendanube.
4. Autorizá la app.
5. Tiendanube te va a redirigir al callback y vas a ver en pantalla:
   ```
   TIENDANUBE_ACCESS_TOKEN=xxx
   TIENDANUBE_STORE_ID=yyy
   ```
6. Copiá esos dos valores al `.env` y reiniciá el servidor.

A partir de ese momento el botón **"Importar Tienda Nube"** en la app va a
traer los pedidos reales de tu tienda.

> ⚠️ **Nota:** Los tokens de Tiendanube no vencen automáticamente en la API
> v1, pero si la app es desinstalada de la tienda tenés que repetir el proceso.

---

## Endpoints disponibles

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del servidor y variables configuradas |
| `GET` | `/auth/tiendanube` | Inicia el flujo OAuth (redirige a Tiendanube) |
| `GET` | `/auth/tiendanube/callback` | Recibe el código y obtiene el token |
| `GET` | `/api/tiendanube/orders` | Devuelve pedidos normalizados listos para la app |

### Parámetros de `/api/tiendanube/orders`

| Query param | Default | Descripción |
|---|---|---|
| `mercadoPagoAccount` | `FB` | Cuenta activa para pedidos de Mercado Pago |
| `transferAccount` | `EG` | Cuenta activa para pedidos de Transferencia |

El frontend envía automáticamente las cuentas activas seleccionadas en la app.

---

## Reglas de importación aplicadas

- **Mercado Pago aprobado** → entra directo a "En preparacion".
- **Transferencia** → entra a "A definir" (queda marcada para revisión manual).
- **Abonar al recibir + Flux** (o mensajería local equivalente) → entra a "A definir".
- **Abonar al recibir + otra empresa de envío** → **no se importa**.
- **Cancelados** → **no se importan**.
- **Deduplicación** por número de orden de Tiendanube (`storeOrderNumber`).

---

## Reglas de cuenta y comisión

| Medio de pago | Cuenta asignada | Comisión |
|---|---|---|
| Mercado Pago | Cuenta activa MP (FB o MV) | 9.8% |
| Transferencia | Cuenta activa transferencia (EG o AD) | 0% |
| Abonar al recibir | Siempre Flux | 0% |

---

## Qué falta completar si no tenés credenciales

Sin credenciales de Tiendanube, la app igual funciona completa:

- **Carga manual** de pedidos: operativa.
- **Flujo de estados** (Preparación → Armado → Rotulado → Despachado): operativo.
- **Filtros** por medio de pago, empresa de envío y SKU: operativos.
- **Backup diario** en Excel: operativo.
- **Botón "Importar Tienda Nube"**: carga los **pedidos de demo** y muestra un
  aviso en pantalla indicando que el backend no está disponible.

Cuando tengas las credenciales, completá el `.env` y el botón va a traer los
pedidos reales sin ningún otro cambio.

---

## Notas de la integración Tiendanube

- La función `detectPaymentMethod` en `tiendanube.js` usa heurísticas sobre
  `payment_provider_id` y `payment_method`. Si tu tienda usa gateways no
  contemplados, revisá esa función y ajustá los keywords.
- `purchasePrice` no está disponible en la API de Tiendanube (es un dato
  interno tuyo); los pedidos importados lo traen en `0` para completar
  manualmente.
- La API de Tiendanube v1 pagina los resultados. El endpoint actual trae las
  primeras 20 órdenes abiertas. Para paginación completa habría que leer el
  header `Link` de la respuesta e iterar.
