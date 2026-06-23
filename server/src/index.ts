import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

interface Room {
  id: string;
  users: User[];
  videoUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  updatedAt: number;
  pausedBy?: string | null;
}

interface User {
  id: string;
  username: string;
  roomId: string;
}

const rooms = new Map<string, Room>();
const users = new Map<string, User>();

function getComputedRoom(room: Room): Room {
  if (room.isPlaying && room.updatedAt) {
    const elapsed = (Date.now() - room.updatedAt) / 1000;
    return {
      ...room,
      currentTime: room.currentTime + elapsed,
      updatedAt: Date.now()
    };
  }
  return room;
}

io.on('connection', (socket: Socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);

    const user: User = { id: socket.id, username, roomId };
    users.set(socket.id, user);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { id: roomId, users: [], videoUrl: null, isPlaying: false, currentTime: 0, updatedAt: Date.now(), pausedBy: null });
    }

    const room = rooms.get(roomId)!;
    room.users.push(user);

    io.to(roomId).emit('room_update', getComputedRoom(room));
    console.log(`${username} joined room ${roomId}`);
  });

  socket.on('leave_room', () => {
    handleDisconnect(socket);
  });

  socket.on('sync_video', (data: { roomId: string; videoUrl: string }) => {
    const room = rooms.get(data.roomId);
    if (room) {
      room.videoUrl = data.videoUrl;
      io.to(data.roomId).emit('room_update', getComputedRoom(room));
    }
  });

  socket.on('play_video', (data: { roomId: string; currentTime: number }) => {
    const room = rooms.get(data.roomId);
    if (room) {
      room.isPlaying = true;
      room.currentTime = data.currentTime;
      room.updatedAt = Date.now();
      room.pausedBy = null;
      socket.to(data.roomId).emit('video_played', data.currentTime);
    }
  });

  socket.on('pause_video', (data: { roomId: string; currentTime: number }) => {
    const room = rooms.get(data.roomId);
    const user = users.get(socket.id);
    if (room && user) {
      room.isPlaying = false;
      room.currentTime = data.currentTime;
      room.updatedAt = Date.now();
      room.pausedBy = user.username;
      socket.to(data.roomId).emit('video_paused', { currentTime: data.currentTime, pausedBy: user.username });
    }
  });

  socket.on('seek_video', (data: { roomId: string; currentTime: number }) => {
    const room = rooms.get(data.roomId);
    if (room) {
      room.currentTime = data.currentTime;
      room.updatedAt = Date.now();
      socket.to(data.roomId).emit('video_seeked', data.currentTime);
    }
  });
  
  socket.on('send_message', (data: { roomId: string; message: string; username: string }) => {
    io.to(data.roomId).emit('receive_message', {
      username: data.username,
      message: data.message,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });

  // --- WebRTC Signaling ---

  socket.on('start_screen_share', ({ roomId }) => {
    socket.to(roomId).emit('user_started_screen_share', socket.id);
  });

  socket.on('stop_screen_share', ({ roomId }) => {
    socket.to(roomId).emit('user_stopped_screen_share', socket.id);
  });

  socket.on('webrtc_offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc_offer', {
      senderId: socket.id,
      offer
    });
  });

  socket.on('webrtc_answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc_answer', {
      senderId: socket.id,
      answer
    });
  });

  socket.on('webrtc_ice_candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc_ice_candidate', {
      senderId: socket.id,
      candidate
    });
  });

  // --- Voice Chat Signaling (Full Mesh) ---

  socket.on('user_joined_voice', ({ roomId }) => {
    // Notify others in the room that this user wants to connect voice
    socket.to(roomId).emit('user_joined_voice', socket.id);
  });

  socket.on('user_left_voice', ({ roomId }) => {
    socket.to(roomId).emit('user_left_voice', socket.id);
  });

  socket.on('voice_webrtc_offer', ({ targetId, offer }) => {
    io.to(targetId).emit('voice_webrtc_offer', {
      senderId: socket.id,
      offer
    });
  });

  socket.on('voice_webrtc_answer', ({ targetId, answer }) => {
    io.to(targetId).emit('voice_webrtc_answer', {
      senderId: socket.id,
      answer
    });
  });

  socket.on('voice_webrtc_ice_candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('voice_webrtc_ice_candidate', {
      senderId: socket.id,
      candidate
    });
  });

  // --- Camera Chat Signaling (Full Mesh) ---

  socket.on('user_joined_camera', ({ roomId }) => {
    socket.to(roomId).emit('user_joined_camera', socket.id);
  });

  socket.on('user_left_camera', ({ roomId }) => {
    socket.to(roomId).emit('user_left_camera', socket.id);
  });

  socket.on('camera_webrtc_offer', ({ targetId, offer }) => {
    io.to(targetId).emit('camera_webrtc_offer', {
      senderId: socket.id,
      offer
    });
  });

  socket.on('camera_webrtc_answer', ({ targetId, answer }) => {
    io.to(targetId).emit('camera_webrtc_answer', {
      senderId: socket.id,
      answer
    });
  });

  socket.on('camera_webrtc_ice_candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('camera_webrtc_ice_candidate', {
      senderId: socket.id,
      candidate
    });
  });
});

function handleDisconnect(socket: Socket) {
  const user = users.get(socket.id);
  if (user) {
    const room = rooms.get(user.roomId);
    if (room) {
      room.users = room.users.filter((u) => u.id !== socket.id);
      if (room.users.length === 0) {
        rooms.delete(user.roomId);
      } else {
        io.to(user.roomId).emit('room_update', getComputedRoom(room));
        io.to(user.roomId).emit('user_stopped_screen_share', socket.id);
        io.to(user.roomId).emit('user_left_voice', socket.id);
        io.to(user.roomId).emit('user_left_camera', socket.id);
      }
    }
    users.delete(socket.id);
    socket.leave(user.roomId);
    console.log(`${user.username} disconnected`);
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
