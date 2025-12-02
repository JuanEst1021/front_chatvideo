# EISC-Meet Chat Server

## Descripción
Este es un servidor WebSocket en tiempo real para manejar el chat de EISC-Meet. Permite que múltiples usuarios se comuniquen en salas de chat simultáneamente.

## Instalación

```bash
cd d:\front_chatvideo\eisc-meet
npm install
```

## Uso

### Iniciar el servidor de chat

```bash
npm run chat-server
```

El servidor se iniciará en `ws://localhost:3000` por defecto.

### Iniciar el cliente frontend

En otra terminal:

```bash
npm run dev
```

El cliente estará disponible en `http://localhost:5173`.

## Características

✅ **Chat en tiempo real** - Mensajes instantáneos entre usuarios
✅ **Salas múltiples** - Cada reunión tiene su propia sala de chat
✅ **Sistema de usuarios** - Cada usuario tiene un ID único
✅ **Notificaciones** - Avisos cuando usuarios entran/salen
✅ **Manejo de errores** - Desconexión automática y reconexión

## Protocolo de mensajes

### Unirse a una sala
```json
{
  "type": "join",
  "userId": "user-123",
  "name": "Juan",
  "roomId": "room-xyz"
}
```

### Enviar mensaje
```json
{
  "type": "message",
  "text": "Hola a todos!"
}
```

### Respuesta del servidor - Mensaje recibido
```json
{
  "type": "message",
  "id": "msg-456",
  "user": { "name": "Juan" },
  "text": "Hola a todos!",
  "at": 1701432000000
}
```

### Respuesta del servidor - Evento de sistema
```json
{
  "type": "system",
  "text": "Juan se unió a la sala",
  "at": 1701432000000
}
```

## Troubleshooting

Si el chat no funciona:

1. Asegúrate de que el servidor está corriendo: `npm run chat-server`
2. Verifica que el puerto 3000 no esté en uso
3. Abre las DevTools (F12) y mira la consola para mensajes de error
4. Comprueba que la URL en `.env` es correcta: `VITE_CHAT_WS_URL=ws://localhost:3000`

## Arquitectura

- **Frontend**: React + WebSocket (nativo)
- **Backend**: Node.js + ws (librería WebSocket)
- **Protocolo**: JSON sobre WebSocket
- **Salas**: Map de Map para almacenar usuarios por sala
