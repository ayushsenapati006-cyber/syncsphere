import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import YouTube from 'react-youtube';
import { Users, LogOut, MessageSquare, Video, Send, MonitorStop, Mic, MicOff, Camera, CameraOff } from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useVoiceChat } from '../hooks/useVoiceChat';
import { useCameraChat } from '../hooks/useCameraChat';
import { useActiveSpeaker } from '../hooks/useActiveSpeaker';

const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

interface User {
  id: string;
  username: string;
  roomId: string;
}

interface RoomData {
  id: string;
  users: User[];
  videoUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  updatedAt?: number;
  pausedBy?: string | null;
  localReceivedAt?: number;
}

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: string;
}

const VideoPlayer = ({ stream, isLocal }: { stream: MediaStream; isLocal?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video 
      ref={videoRef} 
      autoPlay 
      playsInline 
      muted={isLocal} 
      className="w-full h-full object-cover rounded-xl border border-white/10 shadow-lg bg-slate-900"
    />
  );
};

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);
  return <audio ref={audioRef} autoPlay className="hidden" />;
};

const SpeakerIndicator = ({ stream, username }: { stream: MediaStream; username: string }) => {
  const isSpeaking = useActiveSpeaker(stream);
  if (!isSpeaking) return null;
  return (
    <div className="bg-slate-800/90 border border-violet-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-violet-500/20 text-sm font-medium animate-pulse">
      🎙️ {username} is speaking...
    </div>
  );
};

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const username = searchParams.get('username') || 'Guest';
  const navigate = useNavigate();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const roomDataRef = useRef<RoomData | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'users'>('chat');
  const [playerState, setPlayerState] = useState<number>(-1);
  
  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Video state
  const [videoInput, setVideoInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const playerRef = useRef<any>(null);
  const isSyncingRef = useRef(false);

  // WebRTC
  const { localStream, remoteStreams, isSharingScreen, startScreenShare, stopScreenShare } = useWebRTC(socket, roomId || '');
  const { localAudioStream, remoteAudioStreams, isVoiceActive, joinVoiceChat, leaveVoiceChat } = useVoiceChat(socket, roomId || '');
  const { localVideoStream, remoteVideoStreams, isCameraActive, joinCameraChat, leaveCameraChat } = useCameraChat(socket, roomId || '');

  useEffect(() => {
    if (!roomId) {
      navigate('/');
      return;
    }

    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.emit('join_room', { roomId, username });

    newSocket.on('room_update', (data: RoomData) => {
      const enrichedData = { ...data, localReceivedAt: Date.now() };
      setRoomData(enrichedData);
      roomDataRef.current = enrichedData;
      if (enrichedData.videoUrl && enrichedData.videoUrl !== videoId) {
        setVideoId(enrichedData.videoUrl);
      }
    });

    newSocket.on('receive_message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, { ...msg, id: Math.random().toString() }]);
    });

    newSocket.on('video_played', (time: number) => {
      setRoomData(prev => prev ? { ...prev, isPlaying: true, pausedBy: null } : prev);
      if (playerRef.current) {
        isSyncingRef.current = true;
        playerRef.current.seekTo(time, true);
        playerRef.current.playVideo();
        setTimeout(() => isSyncingRef.current = false, 1000);
      }
    });

    newSocket.on('video_paused', (data: any) => {
      const time = typeof data === 'number' ? data : data.currentTime;
      const pausedBy = typeof data === 'number' ? undefined : data.pausedBy;
      setRoomData(prev => prev ? { ...prev, isPlaying: false, pausedBy } : prev);
      
      if (playerRef.current) {
        isSyncingRef.current = true;
        playerRef.current.seekTo(time, true);
        playerRef.current.pauseVideo();
        setTimeout(() => isSyncingRef.current = false, 1000);
      }
    });

    newSocket.on('video_seeked', (time: number) => {
      if (playerRef.current) {
        isSyncingRef.current = true;
        playerRef.current.seekTo(time, true);
        setTimeout(() => isSyncingRef.current = false, 1000);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId, username, navigate, videoId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  const handleLeave = () => {
    navigate('/');
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;
    
    socket.emit('send_message', { roomId, username, message: chatInput });
    setChatInput('');
  };


  const extractVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const handleSyncVideo = (e: React.FormEvent) => {
    e.preventDefault();
    let vId = extractVideoId(videoInput);
    
    // If regex fails, try basic URL parsing as fallback
    if (!vId) {
      try {
        if (videoInput.includes('youtu.be/')) {
          vId = videoInput.split('youtu.be/')[1]?.split('?')[0];
        } else {
          const url = new URL(videoInput.startsWith('http') ? videoInput : `https://${videoInput}`);
          vId = url.searchParams.get('v');
        }
      } catch (error) {
        console.error('Invalid URL');
      }
    }

    if (vId && socket) {
      socket.emit('sync_video', { roomId, videoUrl: vId });
      setVideoInput('');
    } else {
      console.error('Could not extract video ID from URL');
    }
  };

  // YouTube Player Event Handlers
  const onPlayerReady = (event: any) => {
    playerRef.current = event.target;
    
    // Sync initial state for late joiners
    const currentRoomData = roomDataRef.current;
    if (currentRoomData) {
      let actualTime = currentRoomData.currentTime || 0;
      
      // Calculate elapsed time caused by iframe load delay
      if (currentRoomData.isPlaying && currentRoomData.localReceivedAt) {
        const elapsedSeconds = (Date.now() - currentRoomData.localReceivedAt) / 1000;
        actualTime += elapsedSeconds;
      }

      isSyncingRef.current = true;
      if (actualTime > 0) {
        playerRef.current.seekTo(actualTime, true);
      }
      
      if (currentRoomData.isPlaying) {
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo();
      }
      setTimeout(() => isSyncingRef.current = false, 1500);
    }
  };

  const onPlayerStateChange = (event: any) => {
    setPlayerState(event.data);
    
    if (isSyncingRef.current || !socket || !playerRef.current) return;

    const currentTime = playerRef.current.getCurrentTime();

    if (event.data === 1) { // PLAYING
      socket.emit('play_video', { roomId, currentTime });
    } else if (event.data === 2) { // PAUSED
      socket.emit('pause_video', { roomId, currentTime });
    } else if (event.data === 3) { // BUFFERING (usually scrubbing timeline)
      socket.emit('seek_video', { roomId, currentTime });
    }
  };

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1,
      modestbranding: 1,
      rel: 0,
    },
  };

  const remoteStreamsArray = Array.from(remoteStreams.entries());
  const remoteAudioStreamsArray = Array.from(remoteAudioStreams.values());
  const remoteCameraStreamsArray = Array.from(remoteVideoStreams.entries());
  const hasScreens = isSharingScreen || remoteStreamsArray.length > 0 || isCameraActive || remoteCameraStreamsArray.length > 0;

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden relative">
      {/* Hidden Audio Players */}
      {remoteAudioStreamsArray.map((stream, idx) => (
        <AudioPlayer key={idx} stream={stream} />
      ))}
      
      {/* Active Speakers Overlay */}
      <div className="absolute top-20 right-80 mr-6 z-50 flex flex-col gap-2 pointer-events-none">
        {localAudioStream && <SpeakerIndicator stream={localAudioStream} username={`${username} (You)`} />}
        {roomData?.users.map(u => {
          if (u.username === username) return null;
          const stream = remoteAudioStreams.get(u.id);
          if (!stream) return null;
          return <SpeakerIndicator key={u.id} stream={stream} username={u.username} />;
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Top Navbar */}
        <header className="h-16 glass flex items-center justify-between px-6 z-10 border-b border-white/5">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">
              SyncSphere
            </h1>
            <div className="bg-slate-800/50 px-3 py-1 rounded-md border border-slate-700 font-mono text-sm tracking-wider shadow-inner">
              Room: {roomId}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {!isCameraActive ? (
              <button 
                onClick={joinCameraChat}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-all border border-slate-700 shadow-md hover:shadow-slate-700/50"
              >
                <Camera className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium hidden sm:inline">Camera</span>
              </button>
            ) : (
              <button 
                onClick={leaveCameraChat}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg transition-all shadow-md shadow-violet-500/25"
              >
                <CameraOff className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">Stop Cam</span>
              </button>
            )}

            {!isVoiceActive ? (
              <button 
                onClick={joinVoiceChat}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-all border border-slate-700 shadow-md hover:shadow-slate-700/50"
              >
                <Mic className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium hidden sm:inline">Join Voice</span>
              </button>
            ) : (
              <button 
                onClick={leaveVoiceChat}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg transition-all shadow-md shadow-violet-500/25"
              >
                <MicOff className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">Leave Voice</span>
              </button>
            )}

            {!isSharingScreen ? (
              <button 
                onClick={startScreenShare}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-all border border-slate-700 shadow-md hover:shadow-slate-700/50"
              >
                <Video className="w-4 h-4 text-pink-400" />
                <span className="text-sm font-medium">Share Screen</span>
              </button>
            ) : (
              <button 
                onClick={stopScreenShare}
                className="flex items-center gap-2 bg-pink-600 hover:bg-pink-500 text-white px-4 py-2 rounded-lg transition-all shadow-md shadow-pink-500/25"
              >
                <MonitorStop className="w-4 h-4" />
                <span className="text-sm font-medium">Stop Sharing</span>
              </button>
            )}
            
            <button 
              onClick={handleLeave}
              className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-4 py-2 rounded-lg transition-colors border border-red-500/20"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">Leave</span>
            </button>
          </div>
        </header>

        {/* Video & Screen Share Area */}
        <main className="flex-1 p-6 flex flex-col gap-4">
          {/* WebRTC Screens Row */}
          {hasScreens && (
            <div className="flex gap-4 h-48 sm:h-64 overflow-x-auto p-2 glass rounded-2xl border border-white/5 shadow-xl">
              {isSharingScreen && localStream && (
                <div className="relative aspect-video h-full flex-shrink-0">
                  <VideoPlayer stream={localStream} isLocal={true} />
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">You (Sharing)</div>
                </div>
              )}
              {remoteStreamsArray.map(([peerId, stream]) => (
                <div key={peerId} className="relative aspect-video h-full flex-shrink-0">
                  <VideoPlayer stream={stream} />
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">Remote Screen</div>
                </div>
              ))}
              {isCameraActive && localVideoStream && (
                <div className="relative aspect-video h-full flex-shrink-0">
                  <VideoPlayer stream={localVideoStream} isLocal={true} />
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">You (Camera)</div>
                </div>
              )}
              {remoteCameraStreamsArray.map(([peerId, stream]) => {
                const u = roomData?.users.find(u => u.id === peerId);
                return (
                  <div key={peerId} className="relative aspect-video h-full flex-shrink-0">
                    <VideoPlayer stream={stream} />
                    <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">{u?.username || 'Camera'}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex-1 glass-panel rounded-2xl border border-white/5 flex items-center justify-center overflow-hidden relative shadow-2xl">
             {!videoId ? (
               <div className="text-slate-500 flex flex-col items-center">
                 <Video className="w-16 h-16 mb-4 opacity-50 text-violet-400" />
                 <p className="text-lg">No video playing. Paste a YouTube URL to start syncing.</p>
               </div>
             ) : (
                <div className="absolute inset-0 w-full h-full relative">
                  <YouTube 
                    videoId={videoId} 
                    opts={opts as any} 
                    onReady={onPlayerReady}
                    onStateChange={onPlayerStateChange}
                    className="w-full h-full"
                    iframeClassName="w-full h-full"
                  />
                  {playerState === 3 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none z-10 backdrop-blur-sm">
                      <div className="glass px-6 py-3 rounded-full text-white font-medium flex items-center gap-3 animate-pulse">
                        <div className="w-5 h-5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
                        Buffering...
                      </div>
                    </div>
                  )}
                  {playerState === 2 && roomData?.pausedBy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none z-10 backdrop-blur-sm">
                      <div className="glass px-6 py-3 rounded-full text-white font-medium flex items-center gap-2">
                        <MonitorStop className="w-5 h-5 text-violet-400" />
                        Paused by {roomData.pausedBy}
                      </div>
                    </div>
                  )}
                </div>
             )}
          </div>
          
          {/* Controls Area */}
          <div className="h-20 glass rounded-xl border border-white/5 flex items-center px-6 shadow-xl shrink-0">
             <input 
               type="text" 
               placeholder="Paste YouTube URL here (e.g. https://www.youtube.com/watch?v=...)"
               value={videoInput}
               onChange={(e) => setVideoInput(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && handleSyncVideo(e as any)}
               className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all placeholder-slate-500"
             />
             <button 
               onClick={handleSyncVideo}
               className="ml-4 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-8 py-3 rounded-lg font-medium transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-violet-500/25"
             >
               Load Video
             </button>
          </div>
        </main>
      </div>

      {/* Right Sidebar (Chat & Users) */}
      <aside className="w-80 glass-panel border-l border-white/5 flex flex-col z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.2)]">
        {/* Sidebar Tabs */}
        <div className="flex p-2 gap-2 border-b border-white/5 bg-slate-900/40">
          <button 
            onClick={() => setActiveTab('chat')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'chat' 
                ? 'bg-slate-800 text-white shadow-md' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Chat
          </button>
          <button 
            onClick={() => setActiveTab('users')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'users' 
                ? 'bg-slate-800 text-white shadow-md' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Users className="w-4 h-4" />
            Users
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'users' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-1">
                Online — {roomData?.users.length || 0}
              </h3>
              {roomData?.users.map((user) => (
                <div key={user.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-800/50 transition-colors cursor-pointer group">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center text-sm font-bold shadow-lg">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-slate-900 rounded-full group-hover:scale-110 transition-transform"></div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-200">
                      {user.username} {user.username === username ? '(You)' : ''}
                    </span>
                    <span className="text-xs text-green-400">Watching</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col h-full bg-slate-900/20">
               <div className="flex-1 overflow-y-auto p-4 space-y-4">
                 {messages.map((msg) => (
                   <div key={msg.id} className={`flex flex-col ${msg.username === username ? 'items-end' : 'items-start'}`}>
                     <span className="text-xs text-slate-500 mb-1 px-1">{msg.username}</span>
                     <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${
                       msg.username === username 
                         ? 'bg-violet-600 text-white rounded-br-sm' 
                         : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700'
                     }`}>
                       {msg.message}
                     </div>
                   </div>
                 ))}
                 <div ref={chatEndRef} />
               </div>
               <div className="p-4 border-t border-white/5 bg-slate-900/50">
                 <form onSubmit={handleSendMessage} className="relative flex items-center">
                   <input 
                     type="text" 
                     value={chatInput}
                     onChange={(e) => setChatInput(e.target.value)}
                     placeholder="Message room..."
                     className="w-full bg-slate-800 border border-slate-700 rounded-full pl-4 pr-12 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all placeholder-slate-500"
                   />
                   <button 
                     type="submit"
                     disabled={!chatInput.trim()}
                     className="absolute right-1.5 p-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-full transition-colors"
                   >
                     <Send className="w-4 h-4" />
                   </button>
                 </form>
               </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
