import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();

/* =======================
   MIDDLEWARE
======================= */
app.use(
  cors({
    origin: "*", // allow all (safe for now)
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

/* =======================
   HEALTH CHECK
======================= */
app.get("/", (req, res) => {
  res.status(200).send("Ullu Chat Server is running 🚀");
});

/* =======================
   SERVER SETUP
======================= */
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

/* =======================
   IN-MEMORY STORAGE
======================= */

// waiting users
let waitingQueue = [];

// socketId -> roomId
const userRooms = new Map();

// roomId -> messages[]
const roomMessages = new Map();

/* =======================
   HELPERS
======================= */
const broadcastUserCount = () => {
  io.emit("user_count", io.engine.clientsCount);
};

/* =======================
   SOCKET LOGIC
======================= */
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  broadcastUserCount();

  /* ---- FIND PARTNER ---- */
  socket.on("find_partner", () => {
    // remove self if already waiting
    waitingQueue = waitingQueue.filter(
      (u) => u.socketId !== socket.id
    );

    let partner = null;

    while (waitingQueue.length > 0) {
      const candidate = waitingQueue.shift();
      const candidateSocket = io.sockets.sockets.get(candidate.socketId);

      if (candidateSocket && !candidateSocket.disconnected) {
        partner = candidateSocket;
        break;
      }
    }

    if (partner) {
      const roomId = [socket.id, partner.id].sort().join("_");

      socket.join(roomId);
      partner.join(roomId);

      userRooms.set(socket.id, roomId);
      userRooms.set(partner.id, roomId);

      // initialize messages if not exists
      if (!roomMessages.has(roomId)) {
        roomMessages.set(roomId, []);
      }

      const previousMessages = roomMessages.get(roomId);

      socket.emit("match_found", { roomId, initiator: false });
      partner.emit("match_found", { roomId, initiator: true });

      socket.emit("previous_messages", previousMessages);
      partner.emit("previous_messages", previousMessages);

      console.log(`Matched ${socket.id} ↔ ${partner.id}`);
    } else {
      waitingQueue.push({ socketId: socket.id });
      socket.emit("waiting", { message: "Looking for a match..." });
    }
  });

  /* ---- MESSAGE ---- */
  socket.on("message", (data) => {
    const roomId = data.roomId;
    if (!roomId) return;

    const message = {
      sender: "Stranger",
      text: data.text,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    if (!roomMessages.has(roomId)) {
      roomMessages.set(roomId, []);
    }

    roomMessages.get(roomId).push(message);

    socket.to(roomId).emit("message", {
      ...message,
      type: "incoming",
    });
  });

  /* ---- LEAVE CHAT ---- */
  socket.on("leave_chat", () => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit("partner_disconnected");

    socket.leave(roomId);
    userRooms.delete(socket.id);
    roomMessages.delete(roomId);
  });

  /* ---- USER COUNT ---- */
  socket.on("request_user_count", () => {
    socket.emit("user_count", io.engine.clientsCount);
  });

  /* ---- DISCONNECT ---- */
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    waitingQueue = waitingQueue.filter(
      (u) => u.socketId !== socket.id
    );

    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit("partner_disconnected");
      userRooms.delete(socket.id);
      roomMessages.delete(roomId);
    }

    broadcastUserCount();
  });
});

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
