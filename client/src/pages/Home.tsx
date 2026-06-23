import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MonitorPlay, Users, Sparkles } from 'lucide-react';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const navigate = useNavigate();

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return alert('Please enter a username');
    const newRoom = generateRoomId();
    navigate(`/room/${newRoom}?username=${encodeURIComponent(username)}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return alert('Please enter a username');
    if (!roomId.trim()) return alert('Please enter a room ID');
    navigate(`/room/${roomId.toUpperCase()}?username=${encodeURIComponent(username)}`);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass w-full max-w-4xl rounded-2xl overflow-hidden flex flex-col md:flex-row shadow-2xl"
      >
        {/* Left Side - Hero */}
        <div className="md:w-1/2 p-10 flex flex-col justify-center bg-gradient-to-br from-violet-600/20 to-pink-600/20 relative">
          <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-violet-500 rounded-xl shadow-lg shadow-violet-500/30">
                <MonitorPlay className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">
                SyncSphere
              </h1>
            </div>
            <p className="text-slate-300 text-lg mb-8 leading-relaxed">
              Watch videos, share your screen, and hang out with friends in perfect sync. The ultimate co-watching experience.
            </p>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 text-slate-400">
                <Users className="w-5 h-5 text-violet-400" />
                <span>Real-time sync for up to 100 users</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                <Sparkles className="w-5 h-5 text-pink-400" />
                <span>Premium glassmorphic design</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Forms */}
        <div className="md:w-1/2 p-10 flex flex-col justify-center border-t md:border-t-0 md:border-l border-white/10 glass-panel">
          <div className="mb-8">
            <label className="block text-sm font-medium text-slate-400 mb-2">Choose your avatar name</label>
            <input 
              type="text" 
              placeholder="e.g. Ayush"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all placeholder-slate-600"
            />
          </div>

          <div className="space-y-6">
            <form onSubmit={handleCreateRoom}>
              <button 
                type="submit"
                className="w-full bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold py-3 px-4 rounded-xl transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-violet-500/25 flex items-center justify-center gap-2"
              >
                <MonitorPlay className="w-5 h-5" />
                Create New Room
              </button>
            </form>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-700/50"></div>
              <span className="flex-shrink-0 mx-4 text-slate-500 text-sm">or join existing</span>
              <div className="flex-grow border-t border-slate-700/50"></div>
            </div>

            <form onSubmit={handleJoinRoom} className="flex gap-2">
              <input 
                type="text" 
                placeholder="ROOM ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all uppercase placeholder-slate-600 tracking-widest"
                maxLength={6}
              />
              <button 
                type="submit"
                className="bg-slate-700/80 hover:bg-slate-600 text-white font-semibold py-3 px-6 rounded-xl transition-all border border-slate-600"
              >
                Join
              </button>
            </form>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
