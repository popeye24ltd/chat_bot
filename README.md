# Perfect Polish WhatsApp bot

Asistente en español que recibe mensajes por WhatsApp Cloud API, genera respuestas con Gemini y conserva el contexto reciente de cada cliente por separado. Los mensajes de clientes distintos se procesan concurrentemente; los del mismo cliente se mantienen en orden.

## Despliegue en VPS (Ubuntu + Docker Compose)

Necesitas un VPS con Ubuntu, un dominio o subdominio apuntando a su IP pública, y una app de Meta con WhatsApp Cloud API.

### 1. Instalar Docker

En el VPS, instala Docker Engine y el complemento Docker Compose siguiendo la guía oficial de Docker para Ubuntu: <https://docs.docker.com/engine/install/ubuntu/>.

### 2. Copiar el proyecto

Desde tu computadora, copia esta carpeta al VPS (por ejemplo, con `scp` o Git). En el VPS:

```sh
cd /ruta/perfect-polish
cp .env.example .env
nano .env
```

Completa como mínimo:

- `META_APP_SECRET`: secreto de la app de Meta.
- `WEBHOOK_VERIFY_TOKEN`: valor aleatorio elegido por ti; debe coincidir con el token de verificación del webhook.
- `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`: credenciales del número de WhatsApp Cloud API.
- `GEMINI_API_KEY`: clave de Gemini.
- `BUSINESS_SERVICES`, `BUSINESS_LOCATION`, `BUSINESS_HOURS` y `BUSINESS_CONTACT`: datos reales de Perfect Polish.

Protege el archivo de credenciales:

```sh
chmod 600 .env
```

No subas `.env` al repositorio ni lo compartas. El servicio se publica solo en `127.0.0.1:8080`; si cambias el puerto, actualiza el mapeo en `docker-compose.yml`, la variable `PORT` y el destino de `proxy_pass` en la configuración de Nginx.

### 3. Iniciar el bot

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f perfect-polish-bot
```

El contenedor se reinicia automáticamente si el VPS reinicia. La imagen corre como usuario sin privilegios, con sistema de archivos de solo lectura y comprobación de salud en `/healthz`.

### 4. Configurar HTTPS con Nginx

Instala Nginx y Certbot en el VPS, copia [deploy/nginx-perfect-polish.conf.example](./deploy/nginx-perfect-polish.conf.example) a `/etc/nginx/sites-available/perfect-polish` y cambia `TU-DOMINIO` por tu dominio real. Habilita el sitio y valida la configuración:

```sh
sudo ln -s /etc/nginx/sites-available/perfect-polish /etc/nginx/sites-enabled/perfect-polish
sudo nginx -t
sudo systemctl reload nginx
```

Emite el certificado con Certbot para Nginx siguiendo la guía oficial: <https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal>. Cuando el certificado esté instalado y el dominio responda por HTTPS, configura en Meta la URL:

```text
https://TU-DOMINIO/webhook
```

Usa el mismo `WEBHOOK_VERIFY_TOKEN` y suscríbete al campo `messages`. Asegúrate de permitir los puertos 80 y 443 en el firewall del VPS; no expongas directamente el puerto 8080.

### Actualizar el bot

Después de subir cambios al VPS:

```sh
docker compose up -d --build
docker compose logs --tail=100 perfect-polish-bot
```

## Ejecución local sin Docker

Requiere Node.js 20.6 o posterior:

```sh
node --env-file=.env src/server.js
```

## Concurrencia y contexto

- Una cola por número mantiene el orden de los mensajes de cada cliente.
- `MAX_CONCURRENT_GEMINI_REQUESTS` limita las llamadas simultáneas a Gemini entre chats.
- El historial es independiente por cliente, limitado por `MAX_HISTORY_MESSAGES` y expira según `CONVERSATION_TTL_MINUTES`.
- El historial y la deduplicación de webhooks viven en memoria: se reinician al reiniciar el proceso y no se comparten entre varias réplicas. Un único contenedor es adecuado para empezar en un VPS; para escalar horizontalmente o requerir recuperación, usa una cola y almacenamiento compartidos (por ejemplo Redis).
- El webhook valida `X-Hub-Signature-256` con el secreto de la app de Meta. Los IDs ya procesados se deduplican durante la vida del proceso; los fallos de Gemini o WhatsApp se reintentan hasta tres veces con pausas breves antes de registrarse en los logs.
- Configura los datos reales del negocio antes de atender clientes: el asistente no inventa precios ni disponibilidad.

## Pruebas

```sh
npm test
```

Las pruebas verifican el orden por cliente, el límite de concurrencia, la firma y verificación del webhook, la comprobación de salud, el reconocimiento rápido de mensajes y la separación de conversaciones.
