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
    origin: "*",
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
let waitingQueue = [];          // socketIds
const userRooms = new Map();    // socketId -> roomId

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

  /* ---- FIND STRANGER ---- */
  socket.on("find_partner", () => {
    waitingQueue = waitingQueue.filter(id => id !== socket.id);

    let partnerId = waitingQueue.shift();

    if (partnerId) {
      const roomId = [socket.id, partnerId].sort().join("_");

      socket.join(roomId);
      io.to(partnerId).socketsJoin(roomId);

      userRooms.set(socket.id, roomId);
      userRooms.set(partnerId, roomId);

      socket.emit("match_found", { roomId, initiator: true });
      io.to(partnerId).emit("match_found", { roomId, initiator: false });

      console.log(`Matched ${socket.id} ↔ ${partnerId}`);
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting");
    }
  });

  /* =======================
     🔥 WEBRTC SIGNALING
  ======================= */

  socket.on("webrtc_offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("webrtc_offer", offer);
  });

  socket.on("webrtc_answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("webrtc_answer", answer);
  });

  socket.on("webrtc_ice_candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("webrtc_ice_candidate", candidate);
  });

  /* ---- LEAVE CHAT ---- */
  socket.on("leave_chat", () => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit("partner_disconnected");

    socket.leave(roomId);
    userRooms.delete(socket.id);
  });

  /* ---- DISCONNECT ---- */
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    waitingQueue = waitingQueue.filter(id => id !== socket.id);

    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit("partner_disconnected");
      userRooms.delete(socket.id);
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
