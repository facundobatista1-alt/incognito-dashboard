# Deploy de la app de ventas

La app necesita un hosting Node porque usa `server.js` para Tienda Nube y stock.
La opcion mas simple es Render.

## Comandos

- Build: `npm install`
- Start: `npm start`

## Variables de entorno

Configurar estas variables en el panel del hosting. No subir `.env`.

```env
APP_PASSWORD=
APP_SESSION_SECRET=
TIENDANUBE_CLIENT_ID=
TIENDANUBE_CLIENT_SECRET=
TIENDANUBE_REDIRECT_URI=
TIENDANUBE_STORE_ID=
TIENDANUBE_ACCESS_TOKEN=
DECREMENT_SECRET=
STOCK_DECREMENT_URL=https://incognito-stock.netlify.app/.netlify/functions/decrement-stock
STOCK_LIST_URL=https://incognito-stock.netlify.app/.netlify/functions/list-stock-items
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STATE_TABLE=ventas_app_state
APP_STATE_ID=default
```

Antes de activar Supabase, ejecutar `supabase-ventas-state.sql` en el SQL Editor.
La `SUPABASE_SERVICE_ROLE_KEY` va solo en Render/local `.env`, nunca en el frontend.

## Migrar precios SKU desde un navegador viejo

Despues de configurar Supabase y redeployar, abrir 