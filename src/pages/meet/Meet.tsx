import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type ChatMessage =
  | { type: "system"; id: string; text: string; at: number }
  | { type: "user"; id: string; user: string; text: string; at: number };

type MediaState = { mic: boolean; cam: boolean };

type RemotePeer = {
  id: string;
  stream: MediaStream | null;
  media: MediaState;
};

type ChatWsData =
  | { type: "system"; text?: string; at?: number }
  | {
      type: "message";
      id?: string;
      user?: { name?: string };
      text?: string;
      at?: number;
    };

type SignalData =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

const CHAT_URL = import.meta.env.VITE_CHAT_WS_URL || "ws://localhost:3000";
const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || "http://localhost:9000";

export default function Meet() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("sala1");
  const [joined, setJoined] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStreamAvailable, setLocalStreamAvailable] = useState(false);

  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);

  // Generar ID único para este usuario
  const userIdRef = useRef(`user-${crypto.randomUUID()}`);
  const userId = userIdRef.current;

  // refs
  const chatSocketRef = useRef<WebSocket | null>(null);
  const rtcSocketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // mapa de PeerConnection por id remoto
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(
    new Map()
  );

  // ---------- utilidades ----------
  function pushMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  function updateRemoteMedia(id: string, fn: (p: RemotePeer) => RemotePeer) {
    setRemotePeers((prev) => {
      const exists = prev.find((p) => p.id === id);
      if (!exists) return prev;
      return prev.map((p) => (p.id === id ? fn(p) : p));
    });
  }

  function ensureRemotePeer(id: string) {
    setRemotePeers((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [
        ...prev,
        { id, stream: null, media: { mic: true, cam: true } } as RemotePeer,
      ];
    });
  }

  // ---------- conexión al chat ----------
  function connectChat(currentName: string, currentRoom: string) {
    const ws = new WebSocket(CHAT_URL);
    chatSocketRef.current = ws;

    ws.onopen = () => {
      console.log("Chat WebSocket connected");
      ws.send(
        JSON.stringify({
          type: "join",
          userId: userId,
          name: currentName,
          roomId: currentRoom,
        })
      );
    };

    ws.onmessage = (ev) => {
      let data: ChatWsData | null = null;
      try {
        data = JSON.parse(ev.data) as ChatWsData;
      } catch {
        return;
      }

      if (data.type === "system") {
        pushMessage({
          type: "system",
          id: crypto.randomUUID(),
          text: String(data.text || ""),
          at: data.at ?? Date.now(),
        });
      } else if (data.type === "message") {
        pushMessage({
          type: "user",
          id: data.id ?? crypto.randomUUID(),
          user: data.user?.name ?? "Desconocido",
          text: String(data.text || ""),
          at: data.at ?? Date.now(),
        });
      }
    };

    ws.onerror = (error) => {
      console.error("Chat WebSocket error:", error);
      pushMessage({
        type: "system",
        id: crypto.randomUUID(),
        text: "Error al conectar el chat",
        at: Date.now(),
      });
    };

    ws.onclose = () => {
      console.log("Chat WebSocket closed");
      chatSocketRef.current = null;
    };
  }

  function sendChatMessage(e: React.FormEvent) {
    e.preventDefault();
    const ws = chatSocketRef.current;
    const text = chatInput.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not ready. State:", ws?.readyState);
      pushMessage({
        type: "system",
        id: crypto.randomUUID(),
        text: "Chat no conectado. Intenta de nuevo.",
        at: Date.now(),
      });
      return;
    }

    ws.send(
      JSON.stringify({
        type: "message",
        text,
      })
    );
    setChatInput("");
  }

  // chat send removed because chat panel is hidden in the Meet-style layout

  // ---------- WebRTC / signaling ----------
  const rtcSocket = useMemo<Socket | null>(() => {
    // se crea pero solo se usa realmente después de join
    return io(SIGNALING_URL, { autoConnect: false });
  }, []);

  useEffect(() => {
    rtcSocketRef.current = rtcSocket;
    return () => {
      if (rtcSocket) {
        rtcSocket.disconnect();
      }
      rtcSocketRef.current = null;
    };
  }, [rtcSocket]);

  async function setupLocalStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = stream;
    setLocalStreamAvailable(true);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    // aplicar estado actual de mic/cam
    stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }

  // ensure we have a preview stream (used before joining)
  async function ensurePreviewStream() {
    if (!localStreamRef.current) {
      try {
        await setupLocalStream();
      } catch {
        // ignore permission errors here - UI will still work
      }
    } else {
      // update enabled flags
      const s = localStreamRef.current;
      s.getAudioTracks().forEach((t) => (t.enabled = micOn));
      s.getVideoTracks().forEach((t) => (t.enabled = camOn));
      if (localVideoRef.current && localVideoRef.current.srcObject !== s) {
        localVideoRef.current.srcObject = s;
      }
    }
  }

  // keep local video element attached to the current local stream
  useEffect(() => {
    const s = localStreamRef.current;
    if (localVideoRef.current && s) {
      if (localVideoRef.current.srcObject !== s) {
        localVideoRef.current.srcObject = s;
      }
    }
  }, [localStreamAvailable, joined, camOn]);

  // auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function createPeerConnection(remoteId: string): RTCPeerConnection {
    let pc = peerConnectionsRef.current.get(remoteId);
    if (pc) return pc;

    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // enviar candidatos
    pc.onicecandidate = (ev) => {
      if (ev.candidate && rtcSocketRef.current) {
        rtcSocketRef.current.emit("signal", remoteId, rtcSocketRef.current.id, {
          type: "candidate",
          candidate: ev.candidate,
        });
      }
    };

    // cuando recibo media remota
    pc.ontrack = (ev) => {
      ensureRemotePeer(remoteId);
      const [stream] = ev.streams;
      setRemotePeers((prev) =>
        prev.map((p) => (p.id === remoteId ? { ...p, stream } : p))
      );
    };

    // añadir mis tracks
    const local = localStreamRef.current;
    if (local) {
      for (const track of local.getTracks()) {
        pc.addTrack(track, local);
      }
    }

    peerConnectionsRef.current.set(remoteId, pc);
    return pc;
  }

  function cleanupConnections() {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    setRemotePeers([]);
  }

  function setupSignaling(currentName: string, currentRoom: string) {
    if (!rtcSocketRef.current) return;
    const socket = rtcSocketRef.current;

    socket.connect();

    socket.on("connect", () => {
      socket.emit("join", { name: currentName, roomId: currentRoom });
    });

    // lista de peers existentes cuando entro
    socket.on("introduction", async (peerIds: string[]) => {
      for (const id of peerIds) {
        if (id === socket.id) continue;
        ensureRemotePeer(id);
        const pc = createPeerConnection(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("signal", id, socket.id, {
          type: "offer",
          sdp: offer,
        });
      }
    });

    // alguien nuevo entra (solo para mostrar en UI si quieres)
    socket.on("newUserConnected", (id: string) => {
      if (id === socket.id) return;
      ensureRemotePeer(id);
    });

    // señalización
    socket.on("signal", async (to: string, from: string, data: SignalData) => {
      if (to !== socket.id) return;

      ensureRemotePeer(from);
      const pc = createPeerConnection(from);

      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", from, socket.id, {
          type: "answer",
          sdp: answer,
        });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "candidate" && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {
          // ignorar errores de ICE
        }
      }
    });

    // estado de mic/cam de otros
    socket.on(
      "media:update",
      ({ id, mic, cam }: { id: string; mic: boolean; cam: boolean }) => {
        ensureRemotePeer(id);
        updateRemoteMedia(id, (p) => ({
          ...p,
          media: { mic, cam },
        }));
      }
    );

    socket.on("userDisconnected", (id: string) => {
      peerConnectionsRef.current.get(id)?.close();
      peerConnectionsRef.current.delete(id);
      setRemotePeers((prev) => prev.filter((p) => p.id !== id));
    });
  }

  async function doJoin(n: string, r: string) {
    await setupLocalStream();
    connectChat(n, r);
    setupSignaling(n, r);
    setJoined(true);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const r = roomId.trim();
    if (!n || !r) return;

    await doJoin(n, r);
  }

  async function createRoom(e?: React.MouseEvent) {
    e?.preventDefault();
    const n = name.trim();
    if (!n) return;
    const newId = `room-${crypto.randomUUID().slice(0, 8)}`;
    setRoomId(newId);
    await doJoin(n, newId);
  }

  function handleLeave() {
    setJoined(false);
    // chat
    if (chatSocketRef.current) {
      chatSocketRef.current.close();
      chatSocketRef.current = null;
    }
    // rtc
    if (rtcSocketRef.current) {
      rtcSocketRef.current.disconnect();
    }
    cleanupConnections();
    // detener cámara/mic
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStreamAvailable(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    }
  }

  async function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    if (!localStreamRef.current) {
      await ensurePreviewStream();
    }
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => (t.enabled = next));
    }
    rtcSocketRef.current?.emit("media:update", {
      mic: next,
      cam: camOn,
    });
  }

  async function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    if (!localStreamRef.current) {
      await ensurePreviewStream();
    }
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((t) => (t.enabled = next));
    }
    rtcSocketRef.current?.emit("media:update", {
      mic: micOn,
      cam: next,
    });
  }

  // ---------- UI ----------
  if (!joined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-slate-50 p-4">
        <form
          onSubmit={handleJoin}
          className="backdrop-blur-xl bg-gradient-to-br from-slate-800/40 to-purple-900/20 p-8 rounded-3xl shadow-2xl flex flex-col gap-6 w-full max-w-md border border-purple-500/20"
        >
          <div className="text-center">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent mb-2">eisc-meet</h1>
            <p className="text-slate-400 text-sm">Conecta, comparte, colabora</p>
          </div>

          <div className="space-y-4">
            {/* preview video */}
            <div className="relative">
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl overflow-hidden h-56 border border-purple-500/30 shadow-lg relative group">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
              <div className="flex gap-2 mt-3 justify-between">
                <button
                  type="button"
                  onClick={() => void ensurePreviewStream()}
                  className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-xs font-medium transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/20 flex items-center justify-center gap-2"
                >
                  <span>👁️</span> Vista
                </button>
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                    micOn ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg shadow-emerald-500/30" : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/30"
                  }`}
                >
                  <span>{micOn ? "🎤" : "🔇"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleCam()}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                    camOn ? "bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 shadow-lg shadow-blue-500/30" : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/30"
                  }`}
                >
                  <span>{camOn ? "📹" : "🚫"}</span>
                </button>
              </div>
            </div>

            {/* inputs */}
            <div className="space-y-3">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-purple-300">👤 Tu nombre</span>
                <input
                  className="px-4 py-3 rounded-xl bg-slate-900/50 border border-purple-500/30 outline-none text-white placeholder-slate-500 focus:border-purple-500/60 focus:bg-slate-900/70 transition-all duration-200 backdrop-blur-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Juan Pérez"
                  required
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-purple-300">🏠 ID de sala</span>
                <input
                  className="px-4 py-3 rounded-xl bg-slate-900/50 border border-purple-500/30 outline-none text-white placeholder-slate-500 focus:border-purple-500/60 focus:bg-slate-900/70 transition-all duration-200 backdrop-blur-sm"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Ej: sala1"
                  required
                />
              </label>
            </div>
          </div>

          {/* buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-white transition-all duration-200 shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>✨</span> Entrar
            </button>
            <button
              type="button"
              onClick={(e) => void createRoom(e)}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 font-semibold text-white transition-all duration-200 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>🚀</span> Nueva
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-900/20 to-slate-950 text-slate-50 flex flex-col overflow-hidden">
      {/* top header bar */}
      <header className="px-6 py-4 border-b border-purple-500/10 backdrop-blur-md bg-gradient-to-r from-slate-900/30 to-purple-900/20">
        <div className="flex justify-between items-center max-w-7xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">eisc-meet</h1>
            <p className="text-xs text-slate-400 mt-1">Sala: <span className="font-semibold text-purple-300">{roomId}</span></p>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-300">{name}</p>
            <p className="text-xs text-slate-500 mt-1">En línea</p>
          </div>
        </div>
      </header>

      {/* participants grid + chat */}
      <div className="flex-1 flex gap-6 p-8 overflow-hidden">
        {/* videos area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl">
            <div className="flex gap-6 flex-wrap justify-center items-start">
              {/* local tile */}
              <div className="relative group">
                <div className="w-80 h-96 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-purple-500/20 transition-all duration-300 group-hover:border-purple-500/50 group-hover:shadow-2xl group-hover:shadow-purple-500/20">
                  {localStreamRef.current && camOn ? (
                    <>
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    </>
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-900/40 to-slate-900/40 flex flex-col items-center justify-center gap-6">
                      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-6xl font-bold shadow-lg shadow-purple-500/40">
                        {name ? name[0].toUpperCase() : "U"}
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold">{name || "Tú"}</div>
                        <div className="text-xs text-slate-400 mt-1">Cámara apagada</div>
                      </div>
                    </div>
                  )}
                  <div className="absolute left-4 bottom-4 text-xs font-medium text-white bg-black/40 backdrop-blur px-3 py-1 rounded-full border border-white/20">
                    👤 {name.slice(0, 8) || "Tú"}
                  </div>
                  <div className="absolute right-4 bottom-4 flex gap-2">
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${micOn ? "bg-emerald-500/80 text-white" : "bg-red-500/80 text-white"}  backdrop-blur`}>
                      {micOn ? "🎤" : "🔇"}
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium ${camOn ? "bg-blue-500/80 text-white" : "bg-red-500/80 text-white"}  backdrop-blur`}>
                      {camOn ? "📹" : "❌"}
                    </div>
                  </div>
                </div>
              </div>

              {remotePeers.length === 0 ? (
                // empty placeholders
                Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="relative group">
                    <div className="w-80 h-96 bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-3xl shadow-2xl overflow-hidden border border-purple-500/10 transition-all duration-300 hover:border-purple-500/30 flex items-center justify-center backdrop-blur">
                      <div className="flex flex-col items-center gap-4 text-slate-400">
                        <div className="text-5xl opacity-30">👥</div>
                        <div className="text-center">
                          <div className="text-sm font-medium">Esperando...</div>
                          <div className="text-xs mt-1 opacity-60">Participante {i + 1}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                remotePeers.map((peer) => (
                  <div key={peer.id} className="relative group">
                    <div className="w-80 h-96 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-purple-500/20 transition-all duration-300 group-hover:border-purple-500/50 group-hover:shadow-2xl group-hover:shadow-purple-500/20">
                      {peer.stream ? (
                        <>
                          <video
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover"
                            ref={(el) => {
                              if (el && peer.stream && el.srcObject !== peer.stream) {
                                el.srcObject = peer.stream;
                              }
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                        </>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-900/40 to-slate-900/40 flex flex-col items-center justify-center gap-6">
                          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center text-6xl font-bold shadow-lg shadow-blue-500/40">
                            {peer.id.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-semibold">{peer.id}</div>
                            <div className="text-xs text-slate-400 mt-1">Conectando...</div>
                          </div>
                        </div>
                      )}
                      <div className="absolute left-4 bottom-4 text-xs font-medium text-white bg-black/40 backdrop-blur px-3 py-1 rounded-full border border-white/20">
                        👤 {peer.id.slice(0, 8)}
                      </div>
                      <div className="absolute right-4 bottom-4 flex gap-2">
                        <div className={`px-2 py-1 rounded-full text-xs font-medium ${peer.media.mic ? "bg-emerald-500/80" : "bg-red-500/80"}  text-white backdrop-blur`}>
                          {peer.media.mic ? "🎤" : "🔇"}
                        </div>
                        <div className={`px-2 py-1 rounded-full text-xs font-medium ${peer.media.cam ? "bg-blue-500/80" : "bg-red-500/80"}  text-white backdrop-blur`}>
                          {peer.media.cam ? "📹" : "❌"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* chat panel */}
        <div className="w-80 flex flex-col bg-gradient-to-b from-slate-800/40 to-slate-900/40 rounded-3xl border border-purple-500/20 shadow-2xl overflow-hidden backdrop-blur">
          {/* chat header */}
          <div className="px-4 py-3 border-b border-purple-500/20 bg-gradient-to-r from-slate-900/50 to-purple-900/30">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>💬</span> Chat
              <span className={`ml-auto w-2 h-2 rounded-full ${
                chatSocketRef.current?.readyState === WebSocket.OPEN 
                  ? "bg-emerald-500 animate-pulse" 
                  : "bg-red-500"
              }`} title={chatSocketRef.current?.readyState === WebSocket.OPEN ? "Conectado" : "Desconectado"} />
            </h2>
            <p className="text-xs text-slate-400 mt-1">{messages.length} mensajes</p>
          </div>

          {/* messages container */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin scrollbar-thumb-purple-500/40 scrollbar-track-transparent">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400">
                <div className="text-center">
                  <div className="text-4xl mb-2">💭</div>
                  <div className="text-xs">No hay mensajes aún</div>
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.type === "system" ? (
                  <div key={m.id} className="text-center">
                    <p className="text-xs text-slate-500 italic px-2 py-1 bg-slate-900/40 rounded-lg inline-block">
                      {m.text}
                    </p>
                  </div>
                ) : (
                  <div key={m.id} className="flex flex-col gap-1 animate-fade-in">
                    <span className="text-xs font-semibold text-purple-300">{m.user}</span>
                    <div className="bg-gradient-to-r from-slate-700/50 to-purple-800/30 px-3 py-2 rounded-xl text-sm text-white break-words border border-purple-500/20">
                      {m.text}
                    </div>
                    <span className="text-xs text-slate-500 px-1">
                      {new Date(m.at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )
              )
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* message input */}
          <form
            onSubmit={sendChatMessage}
            className="px-4 py-3 border-t border-purple-500/20 bg-gradient-to-r from-slate-900/50 to-purple-900/30 flex-shrink-0"
          >
            <div className="flex gap-2">
              <input
                autoComplete="off"
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900/60 border border-purple-500/40 outline-none text-white placeholder-slate-400 focus:border-purple-500/80 focus:bg-slate-900/80 transition-all duration-200 text-sm"
                placeholder="Escribe un mensaje..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatSocketRef.current?.readyState !== WebSocket.OPEN}
              />
              <button
                type="submit"
                disabled={chatSocketRef.current?.readyState !== WebSocket.OPEN || !chatInput.trim()}
                className="px-3 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-slate-600 disabled:to-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-all duration-200 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 flex items-center justify-center"
                title="Enviar mensaje"
              >
                <span>📤</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* bottom control bar */}
      <div className="fixed left-0 right-0 bottom-8 flex justify-center px-4">
        <div className="backdrop-blur-xl bg-gradient-to-r from-slate-900/80 to-purple-900/40 px-8 py-4 rounded-full flex items-center gap-6 shadow-2xl border border-purple-500/30 hover:border-purple-500/60 transition-all duration-300">
          <button
            onClick={() => void toggleMic()}
            className={`p-3 rounded-full font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
              micOn 
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg shadow-emerald-500/40 hover:shadow-emerald-500/60" 
                : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/40 hover:shadow-red-500/60"
            }`}
            title={micOn ? "Desactivar micrófono" : "Activar micrófono"}
          >
            <span className="text-xl">{micOn ? "🎤" : "🔇"}</span>
            <span className="hidden sm:inline text-sm font-semibold">{micOn ? "Mic" : "Mudo"}</span>
          </button>

          <button
            onClick={() => void toggleCam()}
            className={`p-3 rounded-full font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
              camOn 
                ? "bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 shadow-lg shadow-blue-500/40 hover:shadow-blue-500/60" 
                : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/40 hover:shadow-red-500/60"
            }`}
            title={camOn ? "Desactivar cámara" : "Activar cámara"}
          >
            <span className="text-xl">{camOn ? "📹" : "🚫"}</span>
            <span className="hidden sm:inline text-sm font-semibold">{camOn ? "Cámara" : "Apagada"}</span>
          </button>

          <div className="h-10 w-px bg-slate-600/30" />

          <button
            onClick={handleLeave}
            className="p-3 px-6 rounded-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 font-semibold transition-all duration-200 shadow-lg shadow-red-500/40 hover:shadow-red-500/60 flex items-center justify-center gap-2 hover:scale-105 active:scale-95"
            title="Terminar reunión"
          >
            <span className="text-xl">☎️</span>
            <span className="text-sm font-bold hidden sm:inline">Colgar</span>
          </button>
        </div>
      </div>
    </main>
  );
}
