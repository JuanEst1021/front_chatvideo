import { WebSocketServer } from 'ws';
import http from 'http';

// Crear servidor HTTP básico
const server = http.createServer();

// Crear servidor WebSocket
const wss = new WebSocketServer({ server });

// Map para almacenar usuarios por roomId
// roomId -> { userId -> { ws, name, id } }
const rooms = new Map();

wss.on('connection', (ws) => {
  console.log('[WS] Cliente conectado');
  
  let userId = null;
  let roomId = null;
  let userName = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('[MSG]', message.type, '|', message);

      if (message.type === 'join') {
        // Usuario se une a una sala
        userId = message.userId || `user-${Date.now()}-${Math.random()}`;
        roomId = message.roomId;
        userName = message.name;

        // Crear sala si no existe
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Map());
        }

        // Añadir usuario a la sala
        const room = rooms.get(roomId);
        room.set(userId, { ws, name: userName, id: userId });

        console.log(`[ROOM] ${userName} se unió a ${roomId}. Total: ${room.size}`);

        // Notificar al usuario que se unió
        ws.send(
          JSON.stringify({
            type: 'system',
            text: `Bienvenido ${userName} a la sala ${roomId}`,
            at: Date.now(),
          })
        );

        // Notificar a otros en la sala
        broadcastToRoom(roomId, {
          type: 'system',
          text: `${userName} se unió a la sala`,
          at: Date.now(),
        }, userId);

      } else if (message.type === 'message' && roomId && userId) {
        // Usuario envía mensaje
        const broadcastMsg = {
          type: 'message',
          id: `msg-${Date.now()}-${Math.random()}`,
          user: { name: userName },
          text: message.text,
          at: Date.now(),
        };

        console.log(`[CHAT] ${userName}: ${message.text}`);

        // Enviar a todos en la sala (incluyendo al remitente)
        broadcastToRoom(roomId, broadcastMsg);

      } else if (message.type === 'typing' && roomId && userId) {
        // Usuario está escribiendo
        broadcastToRoom(
          roomId,
          {
            type: 'typing',
            userId: userId,
            userName: userName,
          },
          userId
        );
      }
    } catch (error) {
      console.error('[ERROR]', error.message);
    }
  });

  ws.on('close', () => {
    if (roomId && userId) {
      const room = rooms.get(roomId);
      if (room) {
        const userName = room.get(userId)?.name || 'Desconocido';
        room.delete(userId);
        console.log(`[LEAVE] ${userName} salió de ${roomId}. Total: ${room.size}`);

        // Notificar a otros que el usuario se fue
        if (room.size > 0) {
          broadcastToRoom(roomId, {
            type: 'system',
            text: `${userName} salió de la sala`,
            at: Date.now(),
          });
        } else {
          // Eliminar sala si está vacía
          rooms.delete(roomId);
          console.log(`[ROOM] ${roomId} eliminada (vacía)`);
        }
      }
    }
    console.log('[WS] Cliente desconectado');
  });

  ws.on('error', (error) => {
    console.error('[WS ERROR]', error.message);
  });
});

// Función para enviar mensaje a todos en una sala
function broadcastToRoom(roomId, message, excludeUserId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(message);
  room.forEach((user, userId) => {
    if (excludeUserId && userId === excludeUserId) return;
    if (user.ws.readyState === 1) {
      user.ws.send(payload);
    }
  });
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chat WebSocket Server running on ws://localhost:${PORT}`);
  console.log(`📊 Ready to handle real-time messages\n`);
});
