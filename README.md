# 📦 StockFácil

App para emprendedores: gestión de stock, ventas, gastos y ganancias desde un **panel web** y un **bot de Telegram**.

| Parte | Tecnología | Deploy |
|---|---|---|
| Base de datos + login | Supabase (Postgres, Auth, RLS, Realtime) | supabase.com |
| Bot de Telegram | Node 20 + Express + Telegraf (webhook) | Render |
| Panel / Dashboard | React + Vite + Recharts | Vercel |

```
stockfacil/
├── supabase/schema.sql   ← tablas, triggers de stock, seguridad, funciones del dashboard
├── backend/              ← bot de Telegram (Render)
├── frontend/             ← panel web (Vercel)
└── render.yaml           ← blueprint de Render
```

## Qué hace

**✨ Asistente IA (web y Telegram)**: hablale o escribile en lenguaje natural ("vendí 2 remeras negras", "pagué 3500 de envío", "¿cómo vengo este mes?"). Mandale una **foto** de un artículo y lo reconoce comparándolo con tu catálogo: te dice cuál es, su stock y precio, y ejecuta lo que pidas (vender, reponer, actualizar la foto) o lo da de alta con nombre, categoría, color y descripción. También entiende **audios** (micrófono en la web y notas de voz en Telegram).

Usa **modelos de IA gratuitos**: Google Gemini (`gemini-3.5-flash-lite`, plan gratis de AI Studio) por defecto. Opcionalmente Groq (Whisper gratis para audios) y OpenRouter (modelos `:free`) como respaldo automático si se agota el cupo.

**🖼️ Fichas completas**: foto, marca, código de barras, peso, largo/ancho/alto, talle, color, material y descripción comercial.

**🔌 Integración con tiendas**: `GET /api/v1/catalog` con header `X-Api-Key` devuelve el catálogo (precio, stock, fotos, medidas, peso) para conectar tu web de ventas.

**Panel web**
- **Dashboard** por período (hoy, 7 y 30 días, mes, año): ventas, ganancia bruta y neta, margen, gastos, invertido en mercadería, entradas/salidas y balance de caja, gráficos diarios, más vendidos, alertas de stock bajo, capital inmovilizado en stock y ganancia potencial, histórico total. Se actualiza solo cuando cargás algo desde Telegram.
- **Productos**: alta/edición, costo, precio, margen, stock mínimo, stock inicial; botones rápidos Vender / Reponer / Ajustar.
- **Movimientos**: ventas, compras, gastos, otros ingresos y ajustes, con filtro y "deshacer" (el stock se revierte solo).
- **Configuración**: datos del negocio, moneda, vincular uno o varios chats de Telegram.

**Bot de Telegram**
```
/alta Remera negra | 10 | 5000 | 9500 | 3   (nombre | cant | costo | precio | stock mín)
/venta Remera negra | 2                     (usa el precio cargado, o agregá | precio)
/compra Remera negra | 20 | 4800            (repone stock y recalcula costo promedio)
/gasto 3500 | envío
/ingreso 20000 | aporte de capital
/ajuste Remera negra | -1 | fallada
/precio Remera negra | 9900
/stock [búsqueda]   /bajo   /resumen hoy|semana|mes|anio   /ultimos   /deshacer
```
Busca productos por nombre parcial o SKU y entiende números como `1.500,50`.

**Reglas de negocio (en la base de datos, no se pueden saltear)**
- El stock sólo cambia con movimientos; no puede quedar negativo.
- La compra recalcula el **costo promedio ponderado**; cada venta guarda el costo del momento, así la ganancia histórica no cambia si después actualizás costos.
- Cada usuario sólo ve su negocio (Row Level Security).

---

## Despliegue paso a paso

### 1) Supabase
1. Creá un proyecto en <https://supabase.com>.
2. **SQL Editor → New query** → pegá todo `supabase/schema.sql` → **Run**.
3. **Authentication → URL Configuration**: en *Site URL* poné la URL de Vercel (la tenés en el paso 4; podés volver después).
4. **Project Settings → API**: copiá `Project URL`, `anon public key` y `service_role key`.

> Si no querés confirmación por email: *Authentication → Providers → Email → Confirm email* desactivado.

Después corré también **`supabase/migration_002_asistente_fotos.sql`** (fotos, medidas, API key).

> ⚠️ En Render, `SUPABASE_SERVICE_ROLE_KEY` debe ser la clave **secret** (`sb_secret_...`) o la **service_role**, nunca la publishable. Si la cargás mal, el bot dice "código inválido". Abrí `https://<tu-backend>.onrender.com/health` para verificarlo.

### 2) Bot de Telegram
1. Hablale a **@BotFather** → `/newbot` → elegí nombre y usuario (ej. `MiStockBot`).
2. Guardá el **token**.

### 3) Render (bot)
1. Subí esta carpeta a un repo de GitHub.
2. En Render: **New → Blueprint** → elegí el repo (usa `render.yaml`).
3. Completá las variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (la **service_role**, secreta)
   - `TELEGRAM_BOT_TOKEN`
   - `FRONTEND_URL` (URL de Vercel)
   - `GEMINI_API_KEY` — **gratis** en <https://aistudio.google.com/apikey> (activa el asistente: texto, fotos y audios)
   - Opcionales: `GROQ_API_KEY` (gratis en <https://console.groq.com>, transcribe audios con Whisper y sirve de respaldo), `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (un modelo `:free`), `AI_MODEL` para cambiar el modelo de Gemini (ej. `gemini-3.6-flash`, mejor visión pero menos cupo diario)
4. Deploy. Render define `RENDER_EXTERNAL_URL` y el bot registra el webhook solo. Verificá `https://tu-servicio.onrender.com/health`.

> En el plan gratis Render "duerme" el servicio tras 15 min sin uso: el primer mensaje puede tardar ~30-50 s en responder. Para evitarlo, usá un plan pago o un ping externo (ej. UptimeRobot a `/health` cada 10 min).

### 4) Vercel (panel)
1. **Add New → Project** → elegí el repo → **Root Directory: `frontend`** (Vercel detecta Vite).
2. Variables de entorno:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (la **anon**, nunca la service role)
   - `VITE_TELEGRAM_BOT_USERNAME` (sin @)
   - `VITE_API_URL` (URL del backend en Render, ej. `https://stockfacil-bot.onrender.com`)
3. Deploy. Volvé a Supabase y poné esa URL como *Site URL*.

### 5) Uso
1. Entrá al panel, creá tu cuenta y el negocio.
2. **Configuración → Generar código** → "Abrir en Telegram" (o enviá `/vincular CODIGO` al bot).
3. ¡Listo! Cargá productos y ventas desde donde quieras.

---

## Desarrollo local

```bash
# Backend (sin PUBLIC_URL funciona por polling)
cd backend && cp .env.example .env   # completar
npm install && npm run dev

# Frontend
cd frontend && cp .env.example .env  # completar
npm install && npm run dev           # http://localhost:5173
```

## Ideas para seguir
- Varios usuarios por negocio (socios/empleados con roles).
- Clientes y ventas a cuenta corriente / fiado.
- Ventas con varios productos (ticket) y medios de pago.
- Exportar a Excel / PDF.
- Fotos de productos con Supabase Storage.
- Audios por Telegram (transcripción en el servidor).
- Publicar automáticamente en Mercado Libre / Tiendanube usando el catálogo.
